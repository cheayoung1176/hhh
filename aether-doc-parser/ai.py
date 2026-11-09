"""
Aether Doc AI — AI 연결 모듈 (임베딩 + 답변 생성)

다른 코드는 이 파일의 아래 함수만 부릅니다. 어느 회사 AI인지는 몰라도 됩니다.
  embed_documents(items)        문서 조각들 → 벡터 목록         (적재 파이프라인)
  embed_query(question)         질문 → 벡터                      (질의 파이프라인)
  stream_answer(q, chunks, h)   찾은 조각으로 답변을 토큰 단위로 (F-08)
  parse_citations(text, chunks) 답변 속 [1] [2] 번호 → 출처 좌표 (F-09)
  analyze_document(title, ch)   요약 · 핵심 포인트 · 키워드       (F-10)

회사를 바꾸려면: .env 의 AI_PROVIDER 와 모델 이름을 바꾸고, 아래에 Provider 클래스를 하나 추가하면 됩니다.
임베딩 모델을 바꾸면 저장된 조각을 모두 다시 임베딩해야 합니다 (DB의 embedding_model 칸으로 구분).
"""
from __future__ import annotations

import json
import math
import os
import re
import time
from typing import Iterator

from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------- 설정 (.env 로 바꿀 수 있음)
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini")
CHAT_MODEL = os.getenv("CHAT_MODEL", "gemini-3.5-flash-lite")
CHAT_FALLBACK_MODEL = os.getenv("CHAT_FALLBACK_MODEL", "gemini-3.1-flash-lite")
EMBED_MODEL = os.getenv("EMBED_MODEL", "gemini-embedding-2")
EMBED_DIM = int(os.getenv("EMBED_DIM", "768"))
TIMEOUT_SECONDS = int(os.getenv("AI_TIMEOUT_SECONDS", "60"))

EMBED_BATCH = 50          # 한 번에 임베딩할 조각 수
HISTORY_TURNS = 5         # 답변할 때 함께 보낼 최근 대화 턴 수 (명세서 F-08)
NOT_FOUND = "문서에서 관련 내용을 찾지 못했습니다."
RETRYABLE = {429, 500, 502, 503, 504}


class AIError(Exception):
    """앱에 그대로 전달할 수 있는 오류. code 는 화면 분기용, message 는 사용자 안내용."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _status(e: Exception):
    code = getattr(e, "code", None) or getattr(e, "status_code", None)
    if isinstance(code, int):
        return code
    if "timeout" in type(e).__name__.lower() or "deadline" in str(e).lower():
        return 504
    return None


def _to_ai_error(e: Exception | None) -> AIError:
    if isinstance(e, AIError):
        return e
    code = _status(e) if e else None
    if code == 429:
        return AIError("rate_limited", "요청이 많아 AI가 잠시 쉬고 있어요. 1분쯤 뒤에 다시 시도해 주세요.")
    if code in (401, 403):
        return AIError("auth_failed", "AI 서비스 인증에 실패했어요. API 키를 확인해 주세요.")
    if code == 404:
        return AIError("model_not_found", "설정한 AI 모델을 찾을 수 없어요. 모델 이름을 확인해 주세요.")
    if code in (500, 502, 503, 504):
        return AIError("ai_unavailable", "AI 서비스가 응답하지 않아요. 잠시 후 다시 시도해 주세요.")
    return AIError("ai_failed", f"AI 처리 중 문제가 생겼어요. ({type(e).__name__ if e else 'unknown'})")


def _retry(fn, attempts: int = 4):
    """일시적인 오류(429·5xx·시간 초과)는 2초, 4초, 8초 기다렸다가 다시 시도한다."""
    delay, last = 2, None
    for i in range(attempts):
        try:
            return fn()
        except AIError:
            raise
        except Exception as e:  # noqa: BLE001 — 회사마다 오류 종류가 달라서 넓게 잡는다
            last = e
            if _status(e) in RETRYABLE and i < attempts - 1:
                time.sleep(delay)
                delay *= 2
                continue
            break
    raise _to_ai_error(last)


def _normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


# ---------------------------------------------------------------- 회사별 연결 (Provider)
class GeminiProvider:
    def __init__(self):
        try:
            from google import genai
            from google.genai import types
        except ImportError as e:
            raise AIError("sdk_missing", "google-genai 패키지가 없어요: pip install google-genai") from e
        key = os.getenv("GEMINI_API_KEY", "").strip()
        if not key:
            raise AIError("no_api_key", ".env 에 GEMINI_API_KEY 가 없어요.")
        self.t = types
        self.client = genai.Client(api_key=key, http_options=types.HttpOptions(timeout=TIMEOUT_SECONDS * 1000))
        self.embed_v2 = EMBED_MODEL.startswith("gemini-embedding-2")
        self._one_by_one = False

    # 임베딩: gemini-embedding-2 는 앞머리 글로, 예전 모델은 task_type 으로 질문/문서를 구분한다
    def embed(self, texts: list[str], kind: str) -> list[list[float]]:
        if not self.embed_v2:
            task = "RETRIEVAL_QUERY" if kind == "query" else "RETRIEVAL_DOCUMENT"
            cfg = self.t.EmbedContentConfig(output_dimensionality=EMBED_DIM, task_type=task)
            r = self.client.models.embed_content(model=EMBED_MODEL, contents=texts, config=cfg)
            return [list(e.values) for e in r.embeddings]

        # gemini-embedding-2 는 여러 형식을 함께 받는 모델이라, 글 목록을 그냥 보내면
        # "한 덩어리"로 보고 벡터 1개로 합친다. 글마다 Content 로 따로 담아 보내고,
        # 그래도 개수가 안 맞으면 하나씩 보낸다.
        cfg = self.t.EmbedContentConfig(output_dimensionality=EMBED_DIM)
        if len(texts) > 1 and not self._one_by_one:
            contents = [self.t.Content(parts=[self.t.Part(text=x)]) for x in texts]
            r = self.client.models.embed_content(model=EMBED_MODEL, contents=contents, config=cfg)
            if len(r.embeddings) == len(texts):
                return [list(e.values) for e in r.embeddings]
            self._one_by_one = True  # 이 방식이 안 되는 것을 확인 → 다음부터 바로 하나씩
        out = []
        for x in texts:
            r = self.client.models.embed_content(model=EMBED_MODEL, contents=x, config=cfg)
            out.append(list(r.embeddings[0].values))
        return out

    def format_query(self, q: str) -> str:
        return f"task: search result | query: {q}" if self.embed_v2 else q

    def format_document(self, title: str, text: str) -> str:
        return f"title: {title or 'none'} | text: {text}" if self.embed_v2 else text

    def _contents(self, messages):
        t = self.t
        return [t.Content(role="user" if m["role"] == "user" else "model", parts=[t.Part(text=m["content"])])
                for m in messages]

    def stream(self, model, system, messages, temperature) -> Iterator[str]:
        cfg = self.t.GenerateContentConfig(system_instruction=system, temperature=temperature)
        for part in self.client.models.generate_content_stream(model=model, contents=self._contents(messages), config=cfg):
            if part.text:
                yield part.text

    def complete(self, model, system, prompt, temperature, json_mode) -> str:
        cfg = self.t.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            response_mime_type="application/json" if json_mode else None,
        )
        r = self.client.models.generate_content(model=model, contents=prompt, config=cfg)
        return r.text or ""


PROVIDERS = {"gemini": GeminiProvider}
_provider = None


def provider():
    global _provider
    if _provider is None:
        cls = PROVIDERS.get(AI_PROVIDER)
        if not cls:
            raise AIError("bad_provider", f"지원하지 않는 AI_PROVIDER 예요: {AI_PROVIDER}")
        _provider = cls()
    return _provider


def _models():
    return [m for m in (CHAT_MODEL, CHAT_FALLBACK_MODEL) if m]


# ---------------------------------------------------------------- 임베딩
def embed_documents(items: list[dict]) -> list[list[float]]:
    """items: [{"title": "문서 제목 - 섹션", "text": "본문"}, ...] → 같은 순서의 벡터 목록"""
    p = provider()
    texts = [p.format_document(it.get("title", ""), it["text"]) for it in items]
    out = []
    for i in range(0, len(texts), EMBED_BATCH):
        batch = texts[i:i + EMBED_BATCH]
        vecs = _retry(lambda b=batch: p.embed(b, "document"))
        if len(vecs) != len(batch):  # 개수가 어긋나면 조용히 넘어가지 않고 바로 알린다
            raise AIError("embed_mismatch", f"임베딩 개수가 맞지 않아요 (보냄 {len(batch)}, 받음 {len(vecs)}).")
        out.extend(_normalize(v) for v in vecs)
    return out


def embed_query(question: str) -> list[float]:
    p = provider()
    return _normalize(_retry(lambda: p.embed([p.format_query(question)], "query"))[0])


# ---------------------------------------------------------------- 답변 (F-08 · F-09)
ANSWER_SYSTEM = f"""너는 사용자가 올린 PDF 문서에 대해서만 답하는 도우미다.
규칙:
1. 사용자 메시지의 [자료]에 있는 내용만 근거로 한국어로 답한다. 자료에 없는 내용은 추측하지 않는다.
2. 근거로 쓴 자료의 번호를 해당 문장 끝 마침표 앞에 [1] 또는 [1][3]처럼 붙인다. 문장마다 가장 직접적인 근거 1~2개만 붙인다.
3. 자료에서 답을 찾을 수 없으면 다른 말 없이 정확히 "{NOT_FOUND}"라고만 답한다.
4. 마크다운 기호(**, #, 목록 기호)를 쓰지 않고 평문으로 3~6문장 이내로 답한다."""


def _context(chunks: list[dict]) -> str:
    lines = []
    for i, c in enumerate(chunks, 1):
        sec = " > ".join(c.get("section") or [])
        where = f"p.{c['page_start']}" + (f", {sec}" if sec else "")
        lines.append(f"[{i}] ({where})\n{c['body']}")
    return "\n\n".join(lines)


def stream_answer(question: str, chunks: list[dict], history: list[dict] | None = None,
                  temperature: float = 0.2) -> Iterator[str]:
    """찾은 조각(chunks)을 근거로 답변을 토큰 단위로 돌려준다.
    history: [{"role": "user"|"assistant", "content": "..."}] (최근 것만 사용)
    첫 토큰이 나오기 전 오류면 다시 시도하거나 예비 모델로 바꾸고,
    답변 도중 끊기면 다시 시도하지 않는다 (이미 받은 텍스트는 화면에 보존 — F-08 예외 정책)."""
    msgs = list(history or [])[-HISTORY_TURNS * 2:]
    msgs.append({"role": "user", "content": f"[자료]\n{_context(chunks)}\n\n[질문]\n{question}"})
    p, last = provider(), None
    for model in _models():
        for attempt in range(3):
            started = False
            try:
                for tok in p.stream(model, ANSWER_SYSTEM, msgs, temperature):
                    started = True
                    yield tok
                return
            except Exception as e:  # noqa: BLE001
                if started:
                    raise _to_ai_error(e)
                last = e
                if _status(e) in RETRYABLE and attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
                break  # 다시 시도해도 안 되는 오류 → 예비 모델로
    raise _to_ai_error(last)


CITE = re.compile(r"\[(\d{1,2})\]")
CITE_GROUP = re.compile(r"\s*\[\d{1,2}\](?:\s*[,，、]?\s*\[\d{1,2}\])*")  # [1], [2] / [1][2] 묶음


def parse_citations(answer: str, chunks: list[dict]) -> dict:
    """답변의 [1] [2] 번호를 출처로 바꾼다.
    돌려주는 값: text(번호를 뺀 답변), sources(page_num·rect·highlights), none(근거 없음 여부)"""
    order = []
    for m in CITE.finditer(answer):
        i = int(m.group(1)) - 1
        if 0 <= i < len(chunks) and i not in order:
            order.append(i)
    text = CITE_GROUP.sub("", answer)
    text = re.sub(r"\s+([.,!?。])", r"\1", text)      # 번호를 뺀 자리에 남은 공백 정리
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    sources = []
    for i in order:
        c = chunks[i]
        sources.append({
            "chunk_id": c.get("chunk_id", c.get("id")),
            "page_num": c.get("page_num", c.get("page_start")),
            "rect": c.get("rect"),
            "highlights": c.get("highlights", []),
            "section": c.get("section", []),
            "highlight_color": "#FFF176",
        })
    return {"text": text, "sources": sources, "none": NOT_FOUND in answer}


# ---------------------------------------------------------------- 요약 · 핵심 포인트 · 키워드 (F-10)
def generate_json(system: str, prompt: str, temperature: float = 0.3) -> dict:
    p, last = provider(), None
    for model in _models():
        try:
            raw = _retry(lambda m=model: p.complete(m, system, prompt, temperature, json_mode=True))
            raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
            return json.loads(raw)
        except (AIError, json.JSONDecodeError) as e:
            last = e
            continue
    if isinstance(last, json.JSONDecodeError):
        raise AIError("bad_ai_output", "AI 응답을 해석하지 못했어요. 다시 시도해 주세요.")
    raise _to_ai_error(last)


ANALYZE_SYSTEM = """너는 문서 분석가다. 주어진 문서 본문만 근거로, 아래 JSON 형식 하나로만 답한다. 마크다운 기호는 쓰지 않는다.
{
  "summary": "문서 전체를 3~4문장으로 요약",
  "points": [ {"title": "15자 이내 핵심 포인트 제목", "text": "1~2문장 설명", "page": 근거 페이지 숫자} ],
  "keywords": ["핵심 개념 키워드", "..."]
}
points 는 4개, keywords 는 6~10개. 페이지 번호는 본문의 [p.N] 표시를 그대로 따른다."""

NOTES_SYSTEM = """너는 문서 분석가다. 주어진 문서 일부만 근거로 핵심 내용을 메모한다. 아래 JSON 하나로만 답한다.
{"notes": [ {"text": "핵심 내용 1문장", "page": 근거 페이지 숫자} ]}
notes 는 6~10개."""


def _groups(blocks: list[str], max_chars: int) -> list[str]:
    out, cur, size = [], [], 0
    for b in blocks:
        if cur and size + len(b) > max_chars:
            out.append("\n".join(cur))
            cur, size = [], 0
        cur.append(b)
        size += len(b) + 1
    if cur:
        out.append("\n".join(cur))
    return out


def analyze_document(title: str, chunks: list[dict], max_chars: int = 60_000) -> dict:
    """긴 문서는 부분별로 메모를 만든 뒤(map) 다시 합쳐서(reduce) 요약한다."""
    blocks = [f"[p.{c['page_start']}] {c['body']}" for c in chunks]
    groups = _groups(blocks, max_chars)
    if len(groups) == 1:
        context = groups[0]
    else:
        notes = []
        for g in groups:
            data = generate_json(NOTES_SYSTEM, f"문서 제목: {title}\n\n[문서 일부]\n{g}")
            notes += [f"[p.{n.get('page', '?')}] {n.get('text', '')}" for n in data.get("notes", [])]
        context = "\n".join(notes)

    data = generate_json(ANALYZE_SYSTEM, f"문서 제목: {title}\n\n[본문]\n{context}")

    # 결과 정리: 형식이 조금 어긋나도 화면이 깨지지 않게
    pages = {c["page_start"] for c in chunks}
    full = "\n".join(c["body"] for c in chunks).lower()
    points = []
    for pt in (data.get("points") or [])[:4]:
        try:
            page = int(pt.get("page"))
        except (TypeError, ValueError):
            page = min(pages) if pages else 1
        points.append({"title": str(pt.get("title", "")).strip(), "text": str(pt.get("text", "")).strip(), "page": page})
    keywords = []
    for k in (data.get("keywords") or [])[:10]:
        k = str(k).strip()
        if k and k.lower() not in {x["k"].lower() for x in keywords}:
            keywords.append({"k": k, "n": max(1, full.count(k.lower()))})  # 등장 횟수는 직접 센다
    keywords.sort(key=lambda x: -x["n"])
    return {"summary": str(data.get("summary", "")).strip(), "points": points, "keywords": keywords,
            "model": CHAT_MODEL}


def cosine(a: list[float], b: list[float]) -> float:
    """정규화된 벡터끼리의 유사도 (DB 없이 테스트할 때 사용)."""
    return sum(x * y for x, y in zip(a, b))
