"""
Aether Doc AI — 기능 로직 (기능명세서 Rev.3 F-01 ~ F-12)

main.py(FastAPI)는 화면과 주고받는 일만 하고, 실제 규칙은 모두 여기에 있다.
저장소(repo)는 supa.SupabaseRepo 를 쓰고, 테스트에서는 같은 메서드를 가진 가짜로 바꿔 끼운다.
"""
from __future__ import annotations

import base64
import json
import math
import re
import time
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import ai
from doc_parser import ParseError, open_pdf, process_pdf_bytes

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
TOP_K = 6                      # 질문 하나에 찾아 쓸 조각 수 (설계 초기값, 5장)
LOCK_AFTER = 5                 # F-02-1: 연속 실패 횟수
LOCK_MINUTES = 5               # F-02-1: 잠금 시간
TOKEN_CACHE_SECONDS = 60
SORTS = {"latest": "created_at.desc", "name": "title.asc", "size": "file_size.desc"}  # F-06

# ---------------------------------------------------------------- 명세서 문구 (그대로 사용)
MSG = {
    "encrypted_pdf": "비밀번호가 걸려있는 PDF 파일은 분석할 수 없습니다.",                       # F-04
    "delayed": "분석이 예상보다 길어지고 있습니다. 잠시 후 확인해 주세요.",                       # F-04-1
    "analysis_in_progress": "문서를 분석하고 있어요. 잠시만 기다려 주세요.",                       # F-05-1
    "analysis_failed": "분석에 실패한 문서예요. [재분석 시도] 또는 [문서 삭제]를 선택해 주세요.",  # F-05-1
    "social_dup": "이미 이메일로 가입된 계정입니다. 이메일 로그인을 이용해 주세요.",              # F-01
    "login_failed": "이메일 또는 비밀번호가 올바르지 않습니다.",                                  # F-01-1
    "locked": "로그인 시도가 5회 실패하여 계정이 5분간 잠깁니다.",                                # F-02-1
    "invalid_input": "유효하지 않은 문자열이 포함되어 있습니다",                                   # F-02-2
    "not_pdf": "PDF 파일만 업로드할 수 있습니다.",                                                 # F-03
    "too_large": "파일 하나는 최대 50MB까지 업로드할 수 있습니다.",                                # F-03
    "session_expired": "로그인이 만료되었습니다. 다시 로그인해 주세요.",                           # F-02
}

# 파서·AI 오류 코드 → 사용자 안내 (분석 실패 카드에 표시)
FAIL_MSG = {
    "no_text": "PDF에서 글자를 찾지 못했어요. 스캔한 이미지로 된 문서는 아직 분석할 수 없어요.",
    "broken_pdf": "PDF 파일이 손상되어 열 수 없어요.",
    "empty_pdf": "페이지가 없는 PDF예요.",
    "encrypted_pdf": MSG["encrypted_pdf"],
    "rate_limited": "AI 요청이 많아 분석하지 못했어요. 잠시 후 [재분석 시도]를 눌러 주세요.",
    "ai_unavailable": "AI 서비스가 응답하지 않아 분석하지 못했어요. 잠시 후 [재분석 시도]를 눌러 주세요.",
}


class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, **extra):
        super().__init__(message)
        self.code, self.message, self.status, self.extra = code, message, status, extra


# ---------------------------------------------------------------- 공통 도우미
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def parse_ts(v) -> datetime | None:
    if not v:
        return None
    if isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


BAD_INPUT = re.compile(
    r"<\s*/?\s*(script|iframe|object|embed|svg|img|style|link|meta|form)\b|javascript\s*:|vbscript\s*:"
    r"|\bon[a-z]+\s*=|data\s*:\s*text/html|<!--",
    re.I,
)


def check_input(text: str, field: str = "input") -> str:
    """F-02-2: 스크립트 패턴이 있으면 거부한다. (DB는 매개변수 방식이라 SQL 주입은 구조적으로 막힌다)"""
    if text and BAD_INPUT.search(text):
        raise AppError("invalid_input", MSG["invalid_input"], 400, field=field)
    return text


def jwt_claims(token: str) -> dict:
    """id_token 의 내용(email 등)만 읽는다. 진짜인지는 Supabase 가 검증한다."""
    try:
        part = token.split(".")[1]
        part += "=" * (-len(part) % 4)
        return json.loads(base64.urlsafe_b64decode(part))
    except Exception:  # noqa: BLE001
        return {}


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def password_ok(pw: str) -> bool:
    """F-01-1 초기안: 8자 이상, 영문+숫자 조합"""
    return len(pw or "") >= 8 and bool(re.search(r"[A-Za-z]", pw)) and bool(re.search(r"\d", pw))


# ---------------------------------------------------------------- 서비스
class Service:
    def __init__(self, repo, now=utcnow):
        self.repo = repo
        self.now = now
        self._token_cache: dict[str, tuple[str, float]] = {}

    # ============================================================ 인증 (F-01 ~ F-02-1)
    def verify_token(self, token: str | None) -> str:
        """로그인 토큰 → 사용자 id. 잘못되거나 만료되면 401 (F-02)."""
        if not token:
            raise AppError("unauthorized", MSG["session_expired"], 401)
        hit = self._token_cache.get(token)
        if hit and hit[1] > time.time():
            return hit[0]
        user = self.repo.auth_get_user(token)
        if not user or not user.get("id"):
            raise AppError("unauthorized", MSG["session_expired"], 401)
        self._token_cache[token] = (user["id"], time.time() + TOKEN_CACHE_SECONDS)
        if len(self._token_cache) > 5000:
            self._token_cache.clear()
        return user["id"]

    @staticmethod
    def _session_payload(s: dict) -> dict:
        user = s.get("user") or {}
        return {
            "access_token": s.get("access_token"),
            "refresh_token": s.get("refresh_token"),
            "expires_in": s.get("expires_in"),
            "user": {"id": user.get("id"), "email": user.get("email")},
        }

    def signup(self, email: str, password: str) -> dict:
        email = normalize_email(email)
        check_input(email, "email")
        if not EMAIL_RE.match(email):
            raise AppError("invalid_email", "이메일 형식이 올바르지 않습니다.", 400, field="email")
        if not password_ok(password):
            raise AppError("weak_password", "비밀번호는 영문과 숫자를 섞어 8자 이상으로 입력해 주세요.", 400, field="password")
        if self.repo.get_identity(email, "local"):
            raise AppError("email_taken", "이미 가입된 이메일입니다. 로그인해 주세요.", 409, field="email")
        if self.repo.get_identity(email, "google"):
            raise AppError("email_taken_social", "이미 Google 계정으로 가입된 이메일입니다. [Google로 계속하기]를 이용해 주세요.", 409, field="email")
        res = self.repo.auth_signup(email, password)  # 비밀번호는 Supabase Auth 가 bcrypt 로 해시해 저장 (평문 저장·로그 금지)
        user = res.get("user") or res
        self.repo.upsert_identity({"user_id": user.get("id"), "provider": "local", "email": email,
                                   "failed_count": 0, "locked_until": None})
        if res.get("access_token"):
            return {"email_confirmation_required": False, "session": self._session_payload(res)}
        return {"email_confirmation_required": True, "session": None,
                "message": "가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요."}

    def login(self, email: str, password: str) -> dict:
        email = normalize_email(email)
        if not EMAIL_RE.match(email) or not password:
            raise AppError("login_failed", MSG["login_failed"], 401)
        now = self.now()
        ident = self.repo.get_identity(email, "local")
        locked_until = parse_ts(ident.get("locked_until")) if ident else None
        if locked_until and locked_until > now:  # F-02-1: 잠금 중이면 비밀번호가 맞아도 거부
            remain = math.ceil((locked_until - now).total_seconds())
            raise AppError("account_locked", MSG["locked"], 423, retry_after=remain, locked_until=iso(locked_until))

        session = self.repo.auth_password_login(email, password)
        if session is None:
            if ident:
                count = 0 if locked_until else int(ident.get("failed_count") or 0)  # 잠금이 끝났으면 0부터 다시
                count += 1
                if count >= LOCK_AFTER:
                    until = now + timedelta(minutes=LOCK_MINUTES)
                    self.repo.update_identity(email, "local", {"failed_count": count, "locked_until": iso(until)})
                    raise AppError("account_locked", MSG["locked"], 423, retry_after=LOCK_MINUTES * 60, locked_until=iso(until))
                self.repo.update_identity(email, "local", {"failed_count": count, "locked_until": None})
            raise AppError("login_failed", MSG["login_failed"], 401)  # 계정 존재 여부를 드러내지 않는 같은 문구

        if ident:
            self.repo.update_identity(email, "local", {"failed_count": 0, "locked_until": None})
        else:  # 대시보드에서 만든 사용자 등 기록이 없던 계정
            self.repo.upsert_identity({"user_id": (session.get("user") or {}).get("id"), "provider": "local",
                                       "email": email, "failed_count": 0, "locked_until": None})
        return self._session_payload(session)

    def refresh(self, refresh_token: str) -> dict:
        s = self.repo.auth_refresh(refresh_token or "")
        if not s:
            raise AppError("session_expired", MSG["session_expired"], 401)
        return self._session_payload(s)

    def social(self, provider: str, id_token: str, nonce: str | None = None) -> dict:
        if provider != "google":  # Apple 로그인은 이번 범위에서 제외
            raise AppError("unsupported_provider", "지원하지 않는 로그인 방식입니다.", 400)
        email = normalize_email(jwt_claims(id_token).get("email", ""))
        if email and self.repo.get_identity(email, "local"):  # F-01: 자동 병합하지 않음
            raise AppError("email_registered", MSG["social_dup"], 409)
        s = self.repo.auth_id_token(provider, id_token, nonce)
        if not s:
            raise AppError("social_failed", "Google 로그인에 실패했어요. 다시 시도해 주세요.", 401)
        user = s.get("user") or {}
        self.repo.upsert_identity({"user_id": user.get("id"), "provider": "google",
                                   "email": normalize_email(user.get("email") or email),
                                   "failed_count": 0, "locked_until": None})
        return self._session_payload(s)

    def recover(self, email: str, redirect_to: str | None = None) -> dict:
        email = normalize_email(email)
        if EMAIL_RE.match(email):
            try:
                self.repo.auth_recover(email, redirect_to)
            except Exception:  # noqa: BLE001 — 계정 존재 여부를 드러내지 않기 위해 항상 같은 응답
                pass
        return {"message": "입력한 이메일로 비밀번호 재설정 링크를 보냈어요. 메일함을 확인해 주세요."}

    def reset_password(self, access_token: str, password: str) -> dict:
        """F-01-1 비밀번호 찾기의 마지막 단계: 메일 링크의 토큰으로 새 비밀번호 설정"""
        if not password_ok(password):
            raise AppError("weak_password", "비밀번호는 영문과 숫자를 섞어 8자 이상으로 입력해 주세요.", 400, field="password")
        user = self.repo.auth_get_user(access_token or "")
        if not user or not self.repo.auth_update_password(access_token, password):
            raise AppError("reset_expired", "재설정 링크가 만료되었어요. 비밀번호 찾기를 다시 요청해 주세요.", 401)
        email = normalize_email(user.get("email", ""))
        if email and self.repo.get_identity(email, "local"):
            self.repo.update_identity(email, "local", {"failed_count": 0, "locked_until": None})  # 잠금도 함께 해제
        return {"message": "비밀번호를 바꿨어요. 새 비밀번호로 로그인해 주세요."}

    # ============================================================ 문서 (F-03 ~ F-07)
    def _target_seconds(self, page_count) -> int:
        """F-04-1 / NFR: 20페이지 기준 10초, 페이지 수에 비례해 확장"""
        return 10 * max(1, math.ceil((page_count or 20) / 20))

    def public_doc(self, d: dict) -> dict:
        delayed = False
        if d.get("status") == "progress" and d.get("started_at"):
            elapsed = (self.now() - parse_ts(d["started_at"])).total_seconds()
            delayed = elapsed > self._target_seconds(d.get("page_count"))
        code = d.get("error_code")
        return {
            "doc_id": d["doc_id"], "title": d["title"], "file_name": d.get("file_name"),
            "file_size": d.get("file_size"), "status": d["status"], "progress": d.get("progress", 0),
            "stage": d.get("stage"), "page_count": d.get("page_count"),
            "error_code": code, "error_message": FAIL_MSG.get(code, "문서를 분석하지 못했어요.") if code else None,
            "delayed": delayed, "delay_message": MSG["delayed"] if delayed else None,
            "created_at": d.get("created_at"), "updated_at": d.get("updated_at"),
        }

    def _doc(self, doc_id: str, owner_id: str) -> dict:
        d = self.repo.get_document(doc_id, owner_id)
        if not d:
            raise AppError("not_found", "문서를 찾을 수 없어요.", 404)
        return d

    def _ready(self, doc_id: str, owner_id: str) -> dict:
        """F-05-1: 완료된 문서만 상세·대화 진입 허용"""
        d = self._doc(doc_id, owner_id)
        if d["status"] == "progress":
            raise AppError("analysis_in_progress", MSG["analysis_in_progress"], 409, progress=d.get("progress"))
        if d["status"] == "fail":
            raise AppError("analysis_failed", MSG["analysis_failed"], 409, error_code=d.get("error_code"))
        return d

    def create_document(self, owner_id: str, file_name: str, data: bytes) -> dict:
        """F-03 업로드: 검증 → 원본 저장 → Progress 상태로 목록에 추가. 분석은 analyze() 가 이어서 한다."""
        file_name = Path(file_name or "document.pdf").name
        check_input(file_name, "file_name")
        if len(data) > MAX_UPLOAD_BYTES:
            raise AppError("too_large", MSG["too_large"], 413)
        if not file_name.lower().endswith(".pdf") or b"%PDF" not in data[:1024]:
            raise AppError("not_pdf", MSG["not_pdf"], 415)
        try:  # F-04: 암호화 PDF는 저장하지 않고 바로 버린다
            open_pdf(data).close()
        except ParseError as e:
            raise AppError(e.code, MSG["encrypted_pdf"] if e.code == "encrypted_pdf" else e.message, 422) from e

        doc_id = str(uuid.uuid4())
        key = f"{owner_id}/{doc_id}.pdf"
        self.repo.upload_pdf(key, data)
        now = iso(self.now())
        row = self.repo.create_document({
            "doc_id": doc_id, "owner_id": owner_id, "title": file_name, "file_name": file_name,
            "file_size": len(data), "storage_key": key, "status": "progress", "progress": 0,
            "stage": "대기 중", "started_at": now, "created_at": now, "updated_at": now,
        })
        return self.public_doc(row)

    def analyze(self, doc_id: str, owner_id: str) -> None:
        """분석 파이프라인 (5.1.2 적재 파이프라인). 고정 타임아웃 없음 (F-04-1)."""
        d = self.repo.get_document(doc_id, owner_id)
        if not d:
            return

        def stage(name, pct, **extra):
            self.repo.update_document(doc_id, {"stage": name, "progress": pct, "updated_at": iso(self.now()), **extra})

        def fail(code):
            self.repo.update_document(doc_id, {"status": "fail", "error_code": code, "stage": "실패",
                                               "updated_at": iso(self.now())})

        try:
            stage("텍스트 추출", 5)
            data = self.repo.download_pdf(d["storage_key"])
            parsed = process_pdf_bytes(data, d["file_name"])
            info, chunks = parsed["doc"], parsed["chunks"]
            stage("문서 구조 분석", 20, page_count=info["page_count"], two_column=info["two_column"],
                  page_sizes=info.get("page_sizes"), toc=parsed["toc"])

            self.repo.delete_chunks(doc_id)  # 이전 시도의 벡터 흔적 제거 (F-05-1)
            title = info["title"]
            rows, batch = [], ai.EMBED_BATCH
            for i in range(0, len(chunks), batch):
                part = chunks[i:i + batch]
                vecs = ai.embed_documents(
                    [{"title": f"{title} - {' > '.join(c['section'])}", "text": c["body"]} for c in part])
                for c, v in zip(part, vecs):
                    rows.append(self._chunk_row(doc_id, owner_id, c, v))
                stage("임베딩", 20 + int(50 * (i + len(part)) / len(chunks)))
            self.repo.insert_chunks(rows)

            stage("요약 생성", 75)
            a = ai.analyze_document(title, chunks)
            stage("키워드 추출", 95, summary=a["summary"], points=a["points"], keywords=a["keywords"])
            self.repo.update_document(doc_id, {"status": "success", "progress": 100, "stage": "완료",
                                               "error_code": None, "updated_at": iso(self.now())})
        except ParseError as e:
            fail(e.code)
            if e.code == "encrypted_pdf":
                self._discard_file(d)
        except ai.AIError as e:
            fail(e.code)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            fail("analysis_failed")

    @staticmethod
    def _chunk_row(doc_id, owner_id, c, vec) -> dict:
        from supa import vector_literal
        return {
            "doc_id": doc_id, "owner_id": owner_id, "chunk_index": c["index"], "section": c["section"],
            "page_num": c["page_start"], "page_end": c["page_end"], "rect": c.get("rect"),
            "highlights": c.get("highlights", []), "text": c["text"], "body": c["body"],
            "char_start": c.get("start"), "char_end": c.get("end"),
            "embedding": vector_literal(vec), "embedding_model": ai.EMBED_MODEL,
        }

    def _discard_file(self, d: dict) -> None:
        try:
            self.repo.delete_pdf(d["storage_key"])
        except Exception:  # noqa: BLE001
            pass

    def list_documents(self, owner_id: str, sort: str = "latest") -> list[dict]:
        if sort not in SORTS:
            raise AppError("bad_sort", "정렬 기준은 latest, name, size 중 하나예요.", 400)
        return [self.public_doc(d) for d in self.repo.list_documents(owner_id, SORTS[sort])]

    def get_document(self, doc_id: str, owner_id: str) -> dict:
        """상세페이지 메타데이터 + 원문 PDF 주소 (F-05-1 통과한 문서만)"""
        d = self._ready(doc_id, owner_id)
        out = self.public_doc(d)
        out.update({"page_sizes": d.get("page_sizes"), "two_column": d.get("two_column"),
                    "pdf_url": self.repo.sign_pdf_url(d["storage_key"], 3600)})
        return out

    def status(self, doc_id: str, owner_id: str) -> dict:
        return self.public_doc(self._doc(doc_id, owner_id))

    def status_events(self, doc_id: str, owner_id: str, poll: float = 1.0, heartbeat: float = 15.0):
        """F-04-1 · F-05: 상태가 바뀔 때마다 SSE 로 보낸다. 완료·실패하면 끝난다."""
        last, beat = None, time.time()
        while True:
            d = self.repo.get_document(doc_id, owner_id)
            if not d:
                yield sse({"doc_id": doc_id, "status": "deleted"})
                return
            s = self.public_doc(d)
            if s != last:
                yield sse(s)
                last = s
            if s["status"] in ("success", "fail"):
                return
            if time.time() - beat > heartbeat:
                yield ": ping\n\n"
                beat = time.time()
            time.sleep(poll)

    def rename(self, doc_id: str, owner_id: str, title: str) -> dict:
        """F-06-1 이름변경"""
        title = (title or "").strip()
        check_input(title, "title")
        if not 1 <= len(title) <= 100:
            raise AppError("bad_title", "문서 이름은 1~100자로 입력해 주세요.", 400, field="title")
        self._doc(doc_id, owner_id)
        self.repo.update_document(doc_id, {"title": title, "updated_at": iso(self.now())})
        return self.public_doc(self._doc(doc_id, owner_id))

    def delete(self, doc_id: str, owner_id: str) -> None:
        """F-06-1 삭제: 원본 파일 + 문서·임베딩·세션·메시지 영구 파기 (DB는 Cascade)"""
        d = self._doc(doc_id, owner_id)
        self._discard_file(d)
        self.repo.delete_document(doc_id, owner_id)

    def reanalyze(self, doc_id: str, owner_id: str) -> dict:
        """F-05-1 [재분석 시도]: Progress 로 즉시 리셋, 벡터 흔적 소거, 저장된 원본으로 다시 분석 (재업로드 없음)"""
        d = self._doc(doc_id, owner_id)
        if d["status"] == "progress":
            raise AppError("analysis_in_progress", MSG["analysis_in_progress"], 409)
        if d.get("error_code") == "encrypted_pdf":
            raise AppError("encrypted_pdf", MSG["encrypted_pdf"], 422)
        self.repo.delete_chunks(doc_id)
        now = iso(self.now())
        self.repo.update_document(doc_id, {
            "status": "progress", "progress": 0, "stage": "대기 중", "error_code": None, "started_at": now,
            "updated_at": now, "summary": None, "points": None, "keywords": None, "toc": None})
        return self.public_doc(self._doc(doc_id, owner_id))

    # ------------------------------------------------------------ 분석 결과 (F-10)
    def summary(self, doc_id: str, owner_id: str) -> dict:
        d = self._ready(doc_id, owner_id)
        return {"doc_id": doc_id, "summary": d.get("summary"), "points": d.get("points") or []}

    def toc(self, doc_id: str, owner_id: str) -> dict:
        d = self._ready(doc_id, owner_id)
        return {"doc_id": doc_id, "toc": d.get("toc") or []}

    def keywords(self, doc_id: str, owner_id: str) -> dict:
        d = self._ready(doc_id, owner_id)
        return {"doc_id": doc_id, "keywords": d.get("keywords") or []}

    # ============================================================ 대화 (F-08, F-09, F-12)
    def create_session(self, doc_id: str, owner_id: str) -> dict:
        self._ready(doc_id, owner_id)
        now = iso(self.now())
        return self.repo.create_session({"doc_id": doc_id, "owner_id": owner_id, "created_at": now, "updated_at": now})

    def list_sessions(self, doc_id: str, owner_id: str) -> list[dict]:
        self._doc(doc_id, owner_id)
        return self.repo.list_sessions(doc_id, owner_id)

    def _session(self, session_id: str, owner_id: str) -> dict:
        s = self.repo.get_session(session_id, owner_id)
        if not s:
            raise AppError("not_found", "대화를 찾을 수 없어요.", 404)
        return s

    def messages(self, session_id: str, owner_id: str) -> dict:
        """F-12: 과거 대화를 읽기 전용으로"""
        s = self._session(session_id, owner_id)
        return {"session": s, "messages": self.repo.list_messages(session_id, owner_id), "read_only": True}

    def prepare_chat(self, session_id: str, owner_id: str, content: str) -> dict:
        """스트리밍을 시작하기 전에 검사할 것을 모두 검사한다 (오류는 일반 JSON 응답으로 돌려주기 위해)."""
        content = (content or "").strip()
        if not content:
            raise AppError("empty_question", "질문을 입력해 주세요.", 400)
        if len(content) > 500:
            raise AppError("too_long", "질문은 500자 이내로 입력해 주세요.", 400)
        check_input(content, "content")
        s = self._session(session_id, owner_id)
        self._ready(s["doc_id"], owner_id)
        history = [{"role": m["role"], "content": m["content"]}
                   for m in self.repo.list_messages(session_id, owner_id)][-ai.HISTORY_TURNS * 2:]
        turn_id = str(uuid.uuid4())
        self.repo.insert_message({"session_id": session_id, "owner_id": owner_id, "turn_id": turn_id,
                                  "role": "user", "content": content, "created_at": iso(self.now())})
        fields = {"updated_at": iso(self.now())}
        if not s.get("title"):
            fields["title"] = content[:40]
        self.repo.update_session(session_id, fields)
        return {"session_id": session_id, "doc_id": s["doc_id"], "owner_id": owner_id, "content": content,
                "history": history, "turn_id": turn_id}

    def stream_chat(self, ctx: dict):
        """F-08: 토큰 단위 SSE. 이벤트 형식은 명세서의 {token, turn_id, is_final}.
        마지막 이벤트(is_final=true)에 번호를 정리한 답변(content)과 출처 좌표(sources, F-09)를 담는다.
        토큰에는 [1] 같은 출처 번호가 섞여 올 수 있으니, 화면은 마지막 content 로 교체해서 보여준다."""
        turn_id, saved, full = ctx["turn_id"], False, ""

        def save(content, sources, interrupted=False):
            nonlocal saved
            if saved:
                return None
            saved = True
            return self.repo.insert_message({
                "session_id": ctx["session_id"], "owner_id": ctx["owner_id"], "turn_id": turn_id,
                "role": "assistant", "content": content or ("(답변이 중단되었습니다)" if interrupted else ""),
                "sources": sources, "created_at": iso(self.now())})

        try:
            try:
                qv = ai.embed_query(ctx["content"])
                hits = self.repo.match_chunks(ctx["doc_id"], ctx["owner_id"], qv, TOP_K)
            except ai.AIError as e:
                save(None, [], interrupted=True)
                yield sse({"token": "", "turn_id": turn_id, "is_final": True, "interrupted": True,
                           "error": {"code": e.code, "message": e.message}})
                return
            chunks = [{"chunk_id": h["chunk_id"], "section": h.get("section") or [], "page_start": h["page_num"],
                       "page_num": h["page_num"], "rect": h.get("rect"), "highlights": h.get("highlights") or [],
                       "body": h["body"]} for h in hits]
            if not chunks:
                full = ai.NOT_FOUND
                yield sse({"token": full, "turn_id": turn_id, "is_final": False})
            else:
                try:
                    for tok in ai.stream_answer(ctx["content"], chunks, ctx["history"]):
                        full += tok
                        yield sse({"token": tok, "turn_id": turn_id, "is_final": False})
                except ai.AIError as e:  # F-08: 받은 텍스트는 보존하고 중단 알림
                    cited = ai.parse_citations(full, chunks)
                    save(cited["text"], cited["sources"], interrupted=True)
                    yield sse({"token": "", "turn_id": turn_id, "is_final": True, "interrupted": True,
                               "content": cited["text"], "sources": cited["sources"],
                               "error": {"code": e.code, "message": "연결이 일시 중단되었습니다"}})
                    return
            cited = ai.parse_citations(full, chunks)
            msg = save(cited["text"], cited["sources"])
            yield sse({"token": "", "turn_id": turn_id, "is_final": True, "content": cited["text"],
                       "sources": cited["sources"], "none": cited["none"],
                       "message_id": (msg or {}).get("message_id")})
        finally:
            if not saved and full:  # 사용자가 중간에 화면을 닫은 경우에도 받은 부분은 남긴다
                cited = ai.parse_citations(full, [])
                save(cited["text"], [], interrupted=True)
