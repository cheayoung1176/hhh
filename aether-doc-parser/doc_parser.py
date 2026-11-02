"""
Aether Doc Parser — PDF 텍스트 추출 + 계층형 청킹 (앱용)

입력:  PDF 바이트 1개
출력:  문서 정보, 목차(제목·단계·페이지), 청크 목록(본문 + 섹션 경로 + 페이지 번호)

처리 순서
  1. PDF 열기 (암호·손상·스캔본 검사)
  2. 페이지별 블록/줄 수집 (글자 크기·굵기 포함)
  3. 머리글·바닥글·러닝헤더·페이지 번호 제거
  4. 페이지마다 1단/2단 자동 판단 → 읽기 순서 정렬
  5. 제목(heading) 판별 → 단계(level) 부여
     - 논문:   Ⅰ. / 1. / 1.1 / 서론·결론
     - 보고서: 제1장 / 제1절 / 가. / 1) / (1)
     - 계약서: 제1조(목적)
     - 서식 없는 제목: 큰 글씨, 굵은 짧은 줄
  6. 참고문헌 구간 제외 (그 뒤 새 장이 시작되면 다시 포함)
  7. 청킹
     - 제목이 있으면: 섹션 단위 계층형 청킹 ([문서 제목 | 섹션 경로] 머리말 포함)
     - 제목이 없으면: 페이지 단위 청킹 ([문서 제목 | p.N] 머리말 포함)
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from pathlib import Path

import pymupdf

# ---------------------------------------------------------------- 설정값
MAX_CHUNK_CHARS = 1200   # 청크 최대 글자 수
MIN_CHUNK_CHARS = 150    # 이보다 짧은 섹션은 다음 섹션과 합침
SPLIT_OVERLAP = 150      # 긴 문단을 강제로 자를 때 겹치는 글자 수
MAX_LEVEL = 6
MIN_CHARS_PER_PAGE = 15  # 페이지당 평균 글자가 이보다 적으면 스캔본으로 판단


class ParseError(Exception):
    """앱에 그대로 전달할 수 있는 오류 (code는 화면 분기용, message는 사용자 안내용)."""

    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


# ---------------------------------------------------------------- 제목 판별 규칙
ROMAN = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ"
ROMAN_HEAD = re.compile(rf"^\s*(?:[{ROMAN}]+|[IVX]+(?=\.))\s*\.?\s*\S")
# "32 GB" 같은 숫자+단위는 제외: 최상위 번호는 "1." 처럼 점이 있어야 함. "1.1." 도 허용
ARABIC_HEAD = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,2})+\.?|\d{1,2}\.)\s*(?=[가-힣A-Za-z(\[「『\"'])")
CHAPTER_HEAD = re.compile(r"^\s*제\s*(?:\d+|[一二三四五六七八九十]+)\s*(편|부|장|절|관)(?=\s|$|[.:·])")
ARTICLE_HEAD = re.compile(r"^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?\s*[(（\[]")
HANGUL_HEAD = re.compile(r"^\s*[가나다라마바사아자차카타파하]\s*[.)]\s*\S")
PAREN_HEAD = re.compile(r"^\s*(?:\(\d{1,2}\)|\d{1,2}\))\s*\S")
NUM_PREFIX = rf"(?:(?:[{ROMAN}]+|[IVX]+|\d{{1,2}})\s*\.\s*)?"
KEYWORD_HEAD = re.compile(
    rf"^\s*{NUM_PREFIX}(초\s*록|요\s*약|개\s*요|목\s*차|서\s*론|본\s*론|결\s*론|머리말|맺음말|들어가며|나가며|"
    r"참고\s*문헌|참고\s*자료|부\s*록|abstract|summary|contents|introduction|conclusions?|"
    r"references?|bibliography|appendix)\s*$",
    re.I,
)
REF_HEAD = re.compile(rf"^\s*{NUM_PREFIX}(참고\s*문헌|참고\s*자료|references?|bibliography)\s*$", re.I)
SENTENCE_DONE = re.compile(r"[.!?。:;”\"')\]]\s*$")
PAGE_NO = re.compile(r"^[\s\d\-–—/|.]+$|^\s*(?:page|p\.)\s*\d+(?:\s*(?:/|of)\s*\d+)?\s*$", re.I)


def letters(t: str) -> int:
    return len(re.findall(r"[A-Za-z가-힣]", t))


def heading_style(text: str, size: float, bold: bool, body_size: float, allow_plain_bold: bool):
    """제목이면 스타일 키를, 아니면 None을 돌려준다. 단계는 HeadingLevels가 정한다."""
    t = text.strip()
    if len(t) < 2 or len(t) > 80 or letters(t) < 2:
        return None
    if KEYWORD_HEAD.match(t):
        return "kw"
    m = CHAPTER_HEAD.match(t)
    if m and len(t) <= 50:
        return "ch:" + m.group(1)
    if ARTICLE_HEAD.match(t) and len(t) <= 60:
        return "article"
    strong = size >= body_size * 1.05 or bold
    big = size >= body_size * 1.3 and len(t) <= 60
    if strong:
        if ROMAN_HEAD.match(t):
            return "roman"
        m = ARABIC_HEAD.match(t)
        if m:
            depth = len(m.group(1).rstrip(".").split("."))
            return f"num{depth}"
        if HANGUL_HEAD.match(t):
            return "hangul"
        if PAREN_HEAD.match(t):
            return "paren"
    if big:
        return "size"
    # 굵은 짧은 줄 (서식 번호 없는 소제목). 문장으로 끝나면 제외
    if allow_plain_bold and bold and len(t) <= 40 and not re.search(r"(다|요|음|함)\s*[.!?]?$|[.!?。]$", t):
        return "bold"
    return None


class HeadingLevels:
    """처음 나온 제목 스타일부터 1단계, 새 스타일이 나오면 한 단계 깊게.
    이미 나온 스타일이 다시 나오면 그 단계로 돌아간다 (문서마다 다른 번호 체계에 대응)."""

    WEAK = ("bold", "size")  # 번호 없이 굵기·크기로만 잡은 제목

    def __init__(self):
        self.stack: list[str] = []

    def level(self, style: str) -> int:
        if style == "kw":  # 서론·결론·참고문헌 등은 항상 최상위
            self.stack = [s for s in self.stack[:1] if s not in self.WEAK]
            return 1
        if style in self.stack:
            i = self.stack.index(style)
            self.stack = self.stack[: i + 1]
            return i + 1
        if style not in self.WEAK:
            # 번호 체계가 있는 제목은 굵기·크기만으로 잡은 제목보다 항상 위 단계
            self.stack = [s for s in self.stack if s not in self.WEAK]
        if len(self.stack) >= MAX_LEVEL:
            return MAX_LEVEL
        self.stack.append(style)
        return len(self.stack)


# ---------------------------------------------------------------- 1. PDF 열기
def open_pdf(data: bytes):
    try:
        pdf = pymupdf.open(stream=data, filetype="pdf")
    except Exception as e:  # 손상된 파일
        raise ParseError("broken_pdf", "PDF 파일을 열 수 없어요. 파일이 손상되었을 수 있어요.") from e
    if pdf.needs_pass:
        raise ParseError("encrypted_pdf", "암호가 걸린 PDF는 분석할 수 없어요. 암호를 해제한 뒤 다시 올려 주세요.")
    if pdf.page_count == 0:
        raise ParseError("empty_pdf", "페이지가 없는 PDF예요.")
    return pdf


# ---------------------------------------------------------------- 2. 블록 수집
def collect_pages(pdf):
    size_counter: Counter = Counter()
    pages = []
    for page in pdf:
        W, H = page.rect.width, page.rect.height
        blocks = []
        for b in page.get_text("dict")["blocks"]:
            if b.get("type") != 0:
                continue
            x0, y0, x1, y1 = b["bbox"]
            if y1 < H * 0.06 or y0 > H * 0.94:  # 머리글/바닥글 영역
                continue
            lines = []
            line_boxes = []  # lines 와 같은 순서의 줄 좌표 (출처 하이라이트용)
            for ln in b["lines"]:
                spans = [s for s in ln["spans"] if s["text"].strip()]
                if not spans:
                    continue
                # 공백만 든 span 도 이어 붙여야 띄어쓰기가 남는다 (글자 크기·굵기 계산에서만 뺀다)
                text = unicodedata.normalize("NFC", "".join(s["text"] for s in ln["spans"])).strip()
                n = sum(len(s["text"]) for s in spans)
                size = sum(s["size"] * len(s["text"]) for s in spans) / max(n, 1)
                bold_chars = sum(len(s["text"]) for s in spans if (s["flags"] & 16) or "bold" in s["font"].lower())
                lines.append((text, size, bold_chars > n / 2))
                line_boxes.append(tuple(ln["bbox"]))
                size_counter[round(size * 2) / 2] += len(text)
            if lines:
                blocks.append({"bbox": (x0, y0, x1, y1), "lines": lines, "line_boxes": line_boxes})
        pages.append((W, H, blocks))
    return pages, size_counter


# ---- 출처 좌표(box) 도우미.  box = [page, x0, y0, x1, y1]  (page 는 1부터, 좌표는 PDF 포인트·좌상단 원점)
def make_box(page, bboxes):
    """여러 bbox 를 하나로 합친 box 1개."""
    bs = list(bboxes)
    return [page,
            round(min(b[0] for b in bs), 2), round(min(b[1] for b in bs), 2),
            round(max(b[2] for b in bs), 2), round(max(b[3] for b in bs), 2)]


def merge_boxes(boxes, max_gap=14.0):
    """같은 페이지에서 세로로 이어지고 가로로 겹치는 box 는 하나로 합친다.
    (2단 문서에서 왼쪽·오른쪽 단을 한 덩어리로 뭉개지 않기 위해 가로로 겹치지 않으면 따로 둔다.
    전체 폭 블록과 한쪽 단이 합쳐져 반대쪽 단을 덮지 않도록 넓은 쪽 기준으로 겹침을 잰다)"""
    out = []
    for pg, x0, y0, x1, y1 in boxes:
        if out and out[-1][0] == pg:
            _, lx0, ly0, lx1, ly1 = out[-1]
            overlap = min(x1, lx1) - max(x0, lx0)
            wider = max(x1 - x0, lx1 - lx0)
            if wider > 0 and overlap >= 0.6 * wider and y0 - ly1 <= max_gap:
                out[-1] = [pg, min(x0, lx0), min(y0, ly0), max(x1, lx1), max(y1, ly1)]
                continue
        out.append([pg, x0, y0, x1, y1])
    return out


def block_text(b) -> str:
    return " ".join(t for t, _, _ in b["lines"])


def remove_noise(pages):
    """매 페이지 반복되는 러닝헤더와 페이지 번호 블록을 제거."""
    key = lambda b: re.sub(r"\d+", "#", block_text(b))
    freq: Counter = Counter()
    for _, _, blocks in pages:
        for k in {key(b) for b in blocks}:
            freq[k] += 1
    n = len(pages)

    def running(b):
        return n >= 4 and freq[key(b)] >= max(3, 0.4 * n) and len(key(b)) < 100

    cleaned = []
    for W, H, blocks in pages:
        blocks = [b for b in blocks if not running(b) and not PAGE_NO.match(block_text(b))]
        cleaned.append((W, H, blocks))
    return cleaned


# ---------------------------------------------------------------- 3. 1단/2단 자동 판단 + 읽기 순서
def split_columns(blocks, W):
    """블록을 wide(가운데를 가로지름) / left / right 로 나눈다."""
    wide, left, right = [], [], []
    lo, hi = W * 0.47, W * 0.53
    for b in blocks:
        x0, _, x1, _ = b["bbox"]
        if (x1 - x0) > 0.6 * W or (x0 < lo and x1 > hi):
            wide.append(b)
        elif (x0 + x1) / 2 < W / 2:
            left.append(b)
        else:
            right.append(b)
    return wide, left, right


def is_two_column(blocks, W) -> bool:
    """왼쪽 단과 오른쪽 단에 본문이 고르게 있고, 가운데를 가로지르는 본문이 적으면 2단."""
    wide, left, right = split_columns(blocks, W)
    chars = lambda bs: sum(len(block_text(b)) for b in bs)
    cl, cr, cw = chars(left), chars(right), chars(wide)
    total = cl + cr + cw
    if total < 200:
        return False
    return cl >= 0.2 * total and cr >= 0.2 * total and cw <= 0.5 * total


def order_blocks(blocks, W, two_column: bool):
    by_y = lambda b: (b["bbox"][1], b["bbox"][0])
    if not two_column:
        return sorted(blocks, key=lambda b: (round(b["bbox"][1]), b["bbox"][0]))
    wide, left, right = split_columns(blocks, W)
    # 가로지르는 블록(제목·표·그림 설명)을 경계로 띠를 나누고, 띠마다 왼쪽 단 → 오른쪽 단 순서로 읽는다
    out, used = [], set()
    for w in sorted(wide, key=by_y):
        cut = w["bbox"][1]
        for col in (left, right):
            for b in sorted(col, key=by_y):
                if id(b) not in used and (b["bbox"][1] + b["bbox"][3]) / 2 < cut:
                    out.append(b)
                    used.add(id(b))
        out.append(w)
    for col in (left, right):
        out.extend(b for b in sorted(col, key=by_y) if id(b) not in used)
    return out


# ---------------------------------------------------------------- 4. 요소화 (제목 / 문단)
def join_lines(lines):
    out = ""
    for t in lines:
        if not out:
            out = t
        elif out.endswith("-") and t[:1].islower():
            out = out[:-1] + t
        else:
            out += " " + t
    return out


def extract_elements(pages, body_size):
    """[(kind, level, text, page), ...] 와 페이지별 2단 여부를 돌려준다."""
    elements = []
    two_col_pages = []
    levels = HeadingLevels()
    skipping_refs = False
    max_size_p0 = max((s for b in pages[0][2] for _, s, _ in b["lines"]), default=body_size)

    def add_heading(text, level, page, boxes, weak=False):
        nonlocal skipping_refs
        if REF_HEAD.match(text):
            skipping_refs = True  # 참고문헌 구간 시작: 제목도 본문도 넣지 않음
            return
        if skipping_refs and level == 1:
            skipping_refs = False  # 새 최상위 장(부록 등)이 시작되면 다시 포함
        if not skipping_refs:
            elements.append(("weak_heading" if weak else "heading", level, text, page, boxes))

    def add_para(text, page, boxes):
        if skipping_refs or not text.strip():
            return
        # 페이지·단 경계에서 끊긴 문단 이어 붙이기: 앞 문단이 문장 부호로 끝나지 않으면 같은 문단으로 본다
        if (elements and elements[-1][0] == "para" and not SENTENCE_DONE.search(elements[-1][2])
                and len(elements[-1][2]) + len(text) <= MAX_CHUNK_CHARS):  # 목록처럼 부호 없는 글이 끝없이 합쳐지지 않게
            k, lv, prev, pg, bx = elements[-1]
            elements[-1] = (k, lv, prev + " " + text, pg, bx + boxes)
            return
        elements.append(("para", 0, text, page, boxes))

    for pno, (W, H, blocks) in enumerate(pages):
        page = pno + 1
        two = is_two_column(blocks, W)
        if two:
            two_col_pages.append(page)
        for b in order_blocks(blocks, W, two):
            first_text, first_size, first_bold = b["lines"][0]
            total = block_text(b)
            block_box = [make_box(page, [b["bbox"]])]

            # 문서 제목: 첫 페이지의 가장 큰 글씨
            if pno == 0 and max_size_p0 > body_size * 1.4 and first_size >= max_size_p0 - 0.5 and len(total) <= 200:
                elements.append(("title", 0, total, page, block_box))
                continue

            if len(b["lines"]) <= 2:
                style = heading_style(total, first_size, first_bold, body_size, allow_plain_bold=True)
                if style:
                    add_heading(total, levels.level(style), page, block_box, weak=style in HeadingLevels.WEAK)
                    continue

            # 소제목이 본문 단락과 한 블록으로 묶인 경우, 소제목 줄에서 블록을 쪼갠다
            seg, seg_boxes = [], []
            for li, (t, sz, bd) in enumerate(b["lines"]):
                style = None
                if len(b["lines"]) > 1 and len(t) <= 60:
                    style = heading_style(t, sz, bd, body_size, allow_plain_bold=False)
                    if style in ("size",):  # 큰 글씨만으로 블록 중간 줄을 제목으로 보지 않음
                        style = None
                if style:
                    if seg:
                        add_para(join_lines(seg), page, [make_box(page, seg_boxes)])
                        seg, seg_boxes = [], []
                    add_heading(t, levels.level(style), page, [make_box(page, [b["line_boxes"][li]])])
                else:
                    seg.append(t)
                    seg_boxes.append(b["line_boxes"][li])
            if seg:
                add_para(join_lines(seg), page, [make_box(page, seg_boxes)])
    return elements, two_col_pages


def resolve_weak_headings(elements):
    """번호 체계가 있는 제목이 있는 문서에서는, 첫 번호 제목보다 앞에 있는
    '굵기·크기로만 잡은 제목'(저자명, 소속 등)을 본문으로 돌린다."""
    first = next((i for i, e in enumerate(elements) if e[0] == "heading"), None)
    out = []
    for i, (kind, level, text, page, boxes) in enumerate(elements):
        if kind == "weak_heading":
            kind = "para" if first is not None and i < first else "heading"
            level = 0 if kind == "para" else level
        out.append((kind, level, text, page, boxes))
    return out


def merge_title(elements):
    """여러 줄로 나뉜 문서 제목을 하나로 합친다."""
    out, idx = [], None
    for kind, level, text, page, boxes in elements:
        if kind == "title":
            if idx is None:
                idx = len(out)
                out.append(("title", 0, text, page, boxes))
            else:
                out[idx] = ("title", 0, out[idx][2] + " " + text, page, out[idx][4] + boxes)
        else:
            out.append((kind, level, text, page, boxes))
    return out


def clean_title(title: str) -> str:
    t = re.sub(r"[★☆*†‡]+", "", title)
    return re.sub(r"\s+", " ", t).strip()


# ---------------------------------------------------------------- 5. 문서 구조
def build_doc(name, elements):
    raw_title = next((t for k, _, t, _, _ in elements if k == "title"), None)
    title = clean_title(raw_title) if raw_title else Path(name).stem
    pieces, parts, pos = [], [], 0
    for kind, level, text, page, boxes in elements:
        pieces.append({"kind": kind, "level": level, "text": text, "page": page, "boxes": boxes,
                       "start": pos, "end": pos + len(text)})
        parts.append(text)
        pos += len(text) + 1  # "\n" 구분자
    full_text = "\n".join(parts)

    sections, heads, cur = [], {}, None
    for p in pieces:
        if p["kind"] == "heading":
            L = p["level"]
            heads = {k: v for k, v in heads.items() if k < L}
            heads[L] = p["text"]
            cur = {"path": [heads[k] for k in sorted(heads)], "pieces": [p]}
            sections.append(cur)
        elif p["kind"] == "para":
            if cur is None:
                cur = {"path": ["(앞부분)"], "pieces": []}
                sections.append(cur)
            cur["pieces"].append(p)
    toc = [{"title": p["text"], "level": p["level"], "page": p["page"]} for p in pieces if p["kind"] == "heading"]
    return {"title": title, "full_text": full_text, "pieces": pieces, "sections": sections, "toc": toc}


# ---------------------------------------------------------------- 6. 청킹
SENT_END = re.compile(r"[.!?。](?=\s)|\n")


def windows(text, start, end, size, overlap):
    """긴 구간을 size 이하로 자른다. 가능하면 문장 끝에서 자르고,
    다음 조각은 겹치는 구간 안의 문장 시작부터 시작한다."""
    s = start
    while s < end:
        e = min(s + size, end)
        if e < end:
            lo = s + int(size * 0.6)
            ends = list(SENT_END.finditer(text, lo, e))
            if ends:
                e = ends[-1].end()
        yield s, e
        if e >= end:
            break
        ns = max(e - overlap, s + 1)
        m = SENT_END.search(text, ns, e)
        if m and m.end() < e:
            ns = m.end()
        while ns < e and text[ns].isspace():
            ns += 1
        s = ns


class ChunkWriter:
    def __init__(self, doc):
        self.ft = doc["full_text"]
        self.title = doc["title"]
        self.out = []

    def emit(self, s, e, path, pages, label, boxes):
        body = self.ft[s:e].strip()
        if not body:
            return
        highlights = merge_boxes(boxes)  # 화면에 칠할 사각형들 (정확한 출처 표시용)
        page_start = min(pages)
        first = [h for h in highlights if h[0] == page_start] or highlights[:1]
        # DB doc_chunks.rect 용 단일 사각형: 시작 페이지에 속한 영역 전체를 감싸는 박스
        rect = make_box(page_start, [h[1:] for h in first])[1:] if first else None
        self.out.append({
            "id": f"c{len(self.out):04d}",
            "index": len(self.out),
            "section": path,
            "page_start": page_start,
            "page_end": max(pages),
            "page_num": page_start,                       # DB doc_chunks.page_num
            "rect": rect,                                 # DB doc_chunks.rect = [x0,y0,x1,y1]
            "highlights": [{"page": h[0], "rect": h[1:]} for h in highlights],
            "text": f"[{self.title} | {label}]\n{body}",  # 임베딩에 넣을 텍스트
            "body": body,                                  # 화면에 보여줄 본문
            "start": s,
            "end": e,
        })

    def group(self, pieces, path, label_fn, max_chars, break_on_page=False, min_chars=0):
        group = []

        def flush():
            if group:
                boxes = [bx for p in group for bx in p["boxes"]]
                pages = [bx[0] for bx in boxes]  # 페이지를 넘어 이어 붙인 문단은 box 쪽에 실제 페이지가 있다
                self.emit(group[0]["start"], group[-1]["end"], path, pages, label_fn(pages), boxes)
                group.clear()

        for p in pieces:
            if p["end"] - p["start"] > max_chars:  # 문단 하나가 너무 길면 겹치게 강제 분할
                flush()
                pages = [bx[0] for bx in p["boxes"]]
                for s, e in windows(self.ft, p["start"], p["end"], max_chars, SPLIT_OVERLAP):
                    # 문단 안을 글자 단위로 자른 조각: 줄 좌표를 글자 위치에 매핑하지 않으므로 문단 전체 영역을 쓴다
                    self.emit(s, e, path, pages, label_fn(pages), p["boxes"])
                continue
            if group:
                too_long = p["end"] - group[0]["start"] > max_chars
                new_page = break_on_page and p["page"] != group[-1]["page"] and group[-1]["end"] - group[0]["start"] >= min_chars
                if too_long or new_page:
                    flush()
            group.append(p)
        flush()


def page_label(pages):
    a, b = min(pages), max(pages)
    return f"p.{a}" if a == b else f"p.{a}-{b}"


def common_path(a, b):
    out = []
    for x, y in zip(a, b):
        if x != y:
            break
        out.append(x)
    return out


def hierarchical_chunks(doc, max_chars=MAX_CHUNK_CHARS, min_chars=MIN_CHUNK_CHARS):
    """섹션 단위로 자르고, 각 청크 앞에 [문서 제목 | 섹션 경로]를 붙인다.
    너무 짧은 섹션은 이웃 섹션과 합치고, 경로는 두 섹션의 공통 상위 경로로 표시한다."""
    span = lambda sec: sec["pieces"][-1]["end"] - sec["pieces"][0]["start"]

    def merge(a, b):
        path = common_path(a["path"], b["path"]) or (a["path"] if span(a) >= span(b) else b["path"])
        return {"path": path, "pieces": a["pieces"] + b["pieces"]}

    secs = [{"path": s["path"], "pieces": list(s["pieces"])} for s in doc["sections"] if s["pieces"]]
    merged, carry = [], None
    for i, s in enumerate(secs):
        if carry:
            s, carry = merge(carry, s), None
        if span(s) < min_chars and i < len(secs) - 1:
            carry = s
        else:
            merged.append(s)
    if carry:
        merged.append(carry)
    if len(merged) >= 2 and span(merged[-1]) < min_chars:  # 마지막 섹션이 짧으면 앞 섹션과 합친다
        last = merged.pop()
        merged[-1] = merge(merged[-1], last)

    w = ChunkWriter(doc)
    for sec in merged:
        label = " > ".join(sec["path"])
        w.group(sec["pieces"], sec["path"], lambda _p, label=label: label, max_chars)
    return w.out


def page_chunks(doc, max_chars=MAX_CHUNK_CHARS, min_chars=MIN_CHUNK_CHARS):
    """제목 구조가 없는 문서: 페이지 경계에서 자르되, 너무 짧은 페이지는 다음 페이지와 합친다."""
    w = ChunkWriter(doc)
    paras = [p for p in doc["pieces"] if p["kind"] == "para"]
    w.group(paras, [], page_label, max_chars, break_on_page=True, min_chars=min_chars)
    return w.out


# ---------------------------------------------------------------- 7. 공개 함수
def process_pdf_bytes(data: bytes, name: str = "document.pdf", include_text: bool = False) -> dict:
    """PDF 바이트를 받아 문서 정보·목차·청크를 돌려준다. 실패하면 ParseError."""
    pdf = open_pdf(data)
    try:
        page_count = pdf.page_count
        pages, size_counter = collect_pages(pdf)
    finally:
        pdf.close()

    page_sizes = [{"width": round(W, 2), "height": round(H, 2)} for W, H, _ in pages]
    total_chars = sum(size_counter.values())
    if not size_counter or total_chars < MIN_CHARS_PER_PAGE * page_count:
        raise ParseError(
            "no_text",
            "PDF에서 글자를 찾지 못했어요. 스캔한 이미지로 된 문서는 아직 분석할 수 없어요.",
        )
    body_size = size_counter.most_common(1)[0][0]
    pages_without_text = [i + 1 for i, (_, _, bs) in enumerate(pages) if not bs]

    pages = remove_noise(pages)
    elements, two_col_pages = extract_elements(pages, body_size)
    elements = merge_title(resolve_weak_headings(elements))
    doc = build_doc(name, elements)

    has_headings = bool(doc["toc"])
    chunks = hierarchical_chunks(doc) if has_headings else page_chunks(doc)
    if not chunks:
        raise ParseError("no_text", "본문으로 쓸 수 있는 글자를 찾지 못했어요.")

    pages_with_text = page_count - len(pages_without_text)
    result = {
        "doc": {
            "name": name,
            "title": doc["title"],
            "page_count": page_count,
            "page_sizes": page_sizes,  # 하이라이트 좌표를 화면 배율로 바꿀 때 사용 (PDF 포인트)
            "two_column": len(two_col_pages) > pages_with_text / 2,
            "two_column_pages": two_col_pages,
            "pages_without_text": pages_without_text,
            "char_count": len(doc["full_text"]),
        },
        "toc": doc["toc"],
        "chunks": chunks,
        "stats": {
            "chunking": "hierarchical" if has_headings else "page",
            "chunk_count": len(chunks),
            "avg_chunk_chars": sum(len(c["body"]) for c in chunks) // len(chunks),
            "heading_count": len(doc["toc"]),
        },
    }
    if include_text:
        result["full_text"] = doc["full_text"]
    return result


if __name__ == "__main__":
    # 로컬 확인용: python doc_parser.py 파일.pdf
    import json
    import sys

    if len(sys.argv) < 2:
        print("사용법: python doc_parser.py 파일.pdf")
        raise SystemExit(1)
    path = Path(sys.argv[1])
    try:
        r = process_pdf_bytes(path.read_bytes(), path.name)
    except ParseError as e:
        print(f"[{e.code}] {e.message}")
        raise SystemExit(1)
    d = r["doc"]
    print(f"제목: {d['title']}")
    print(f"페이지: {d['page_count']} | 2단: {d['two_column']} {d['two_column_pages']} | 글자 수: {d['char_count']}")
    print(f"청킹: {r['stats']['chunking']} | 청크 {r['stats']['chunk_count']}개 (평균 {r['stats']['avg_chunk_chars']}자)")
    print("\n[목차]")
    for h in r["toc"]:
        print("  " * (h["level"] - 1) + f"- {h['title']}  (p.{h['page']})")
    print("\n[청크 미리보기]")
    for c in r["chunks"][:5]:
        print(f"{c['id']} p.{c['page_start']}-{c['page_end']} rect={c['rect']} {' > '.join(c['section'])}")
        print("   " + c["body"][:80].replace("\n", " ") + "…")
    if "--json" in sys.argv:
        print(json.dumps(r, ensure_ascii=False, indent=2))
