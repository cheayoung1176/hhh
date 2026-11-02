"""
doc_parser.py 출처 좌표 검증 (코드를 고치지 않고 CLI 출력만 검사)

  python test_rect.py                         samples/ 5개 자동 검사
  python test_rect.py --render                + 청크 3개씩 하이라이트 PNG 저장 (out/)

FAIL: 요청된 규칙 위반 / WARN(의심): 규칙은 지키지만 실제 위치가 부정확할 수 있는 항목
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).parent
SAMPLES = ROOT / "samples"
OUT = ROOT / "out"
FILES = ["plain", "report", "paper_2col", "contract", "scanned"]
EXPECTED_ERROR = {"scanned": "no_text"}
RENDER = ["paper_2col", "contract"]
RENDER_COUNT = 3
EPS = 0.02  # 좌표 반올림 오차 허용


def run_parser(name: str):
    """python doc_parser.py <파일> --json 실행. (종료코드, 결과 dict 또는 None, stdout)"""
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    p = subprocess.run(
        [sys.executable, "doc_parser.py", str(SAMPLES / f"{name}.pdf"), "--json"],
        cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8",
    )
    m = re.search(r"^\{$", p.stdout, re.M)  # 미리보기 출력 뒤에 JSON이 이어진다
    return p.returncode, json.loads(p.stdout[m.start():]) if m else None, p.stdout


def valid_rect(r) -> bool:
    return isinstance(r, list) and len(r) == 4 and r[0] < r[2] and r[1] < r[3]


def in_page(r, size) -> bool:
    return (r[0] >= -EPS and r[1] >= -EPS
            and r[2] <= size["width"] + EPS and r[3] <= size["height"] + EPS)


def contains(outer, inner) -> bool:
    return (outer[0] <= inner[0] + EPS and outer[1] <= inner[1] + EPS
            and outer[2] >= inner[2] - EPS and outer[3] >= inner[3] - EPS)


def check_chunk(c, doc) -> list[str]:
    """요청된 규칙 검사. 위반 메시지 목록을 돌려준다."""
    errs = []
    sizes = doc["page_sizes"]
    pn, rect, hl = c.get("page_num"), c.get("rect"), c.get("highlights")
    if not isinstance(pn, int) or pn < 1:
        errs.append(f"page_num 잘못됨: {pn}")
    if not valid_rect(rect):
        errs.append(f"rect 잘못됨: {rect}")
    if not hl:
        errs.append("highlights 비어 있음")
        return errs
    if c["page_start"] > c["page_end"]:
        errs.append(f"page_start {c['page_start']} > page_end {c['page_end']}")
    for h in hl:
        if not valid_rect(h["rect"]):
            errs.append(f"highlight rect 잘못됨: {h}")
        if not c["page_start"] <= h["page"] <= c["page_end"]:
            errs.append(f"highlight p.{h['page']} 가 범위 p.{c['page_start']}-{c['page_end']} 밖")
        if not 1 <= h["page"] <= len(sizes):
            errs.append(f"highlight p.{h['page']} 가 문서 범위 밖")
        elif not in_page(h["rect"], sizes[h["page"] - 1]):
            errs.append(f"highlight 가 페이지 밖: p.{h['page']} {h['rect']} / {sizes[h['page'] - 1]}")
    if valid_rect(rect) and isinstance(pn, int) and 1 <= pn <= len(sizes):
        if not in_page(rect, sizes[pn - 1]):
            errs.append(f"rect 가 페이지 밖: {rect} / {sizes[pn - 1]}")
        start = [h for h in hl if h["page"] == c["page_start"]]
        if not start:
            errs.append(f"시작 페이지 p.{c['page_start']} 에 highlight 없음")
        for h in start:
            if valid_rect(rect) and not contains(rect, h["rect"]):
                errs.append(f"rect {rect} 가 시작 페이지 highlight {h['rect']} 를 감싸지 않음")
    return errs


# ---------------------------------------------------------------- 의심 항목 (실제 PDF 대조)
def squash(t: str) -> str:
    return re.sub(r"\s+", "", t)


def pdf_lines(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b.get("type") != 0:
            continue
        for ln in b["lines"]:
            text = squash("".join(s["text"] for s in ln["spans"]))
            if text:
                out.append((text, ln["bbox"]))
    return out


def center_in(bbox, r) -> bool:
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    return r[0] <= cx <= r[2] and r[1] <= cy <= r[3]


def overlay_check(c, pdf, two_col_pages) -> list[str]:
    """사각형이 잡은 글자와 청크 본문을 대조하고, 좌우 단이 합쳐졌는지 본다.
    샘플에 같은 문장이 반복되므로 '본문에 있는 줄인가'가 아니라 글자 수와 위치로 판단한다."""
    warns = []
    body = squash(c["body"])
    captured = 0
    for pno in sorted({h["page"] for h in c["highlights"]}):
        page = pdf[pno - 1]
        boxes = [h["rect"] for h in c["highlights"] if h["page"] == pno]
        mid = page.rect.width / 2
        lines = pdf_lines(page)
        inside = [(t, b) for t, b in lines if any(center_in(b, r) for r in boxes)]
        captured += sum(len(t) for t, _ in inside)
        foreign = [t for t, _ in inside if t not in body]
        if foreign:
            warns.append(f"p.{pno} 사각형 안에 본문이 아닌 줄 {len(foreign)}개: {foreign[0][:30]}")
        if pno in two_col_pages:
            for r in boxes:  # 왼쪽 단 줄과 오른쪽 단 줄이 한 사각형에 같이 있으면 합쳐진 것
                held = [b for _, b in inside if center_in(b, r)]
                if any(b[2] < mid for b in held) and any(b[0] > mid for b in held):
                    warns.append(f"p.{pno} highlight 가 좌우 단을 합침: {r}")
        if pno == c["page_num"]:
            others = [t for t, b in lines if center_in(b, c["rect"]) and not any(center_in(b, r) for r in boxes)]
            if others:
                warns.append(f"p.{pno} rect 안에 이 청크가 아닌 줄 {len(others)}개: {others[0][:30]}")
    if captured != len(body):
        warns.append(f"사각형이 잡은 글자 {captured} != 본문 글자 {len(body)}")
    return warns


# ---------------------------------------------------------------- 렌더링
def pick_chunks(chunks, n=RENDER_COUNT):
    """사각형이 여러 개인 청크(단·페이지를 넘는 청크)부터 고른다."""
    order = sorted(chunks, key=lambda c: (-len(c["highlights"]), c["index"]))
    return sorted(order[:n], key=lambda c: c["index"])


def render(name, chunks):
    OUT.mkdir(exist_ok=True)
    saved = []
    for c in pick_chunks(chunks):
        for pno in sorted({h["page"] for h in c["highlights"]}):
            pdf = pymupdf.open(SAMPLES / f"{name}.pdf")  # 그린 내용이 다음 청크에 남지 않게 새로 연다
            page = pdf[pno - 1]
            for h in c["highlights"]:
                if h["page"] == pno:
                    page.draw_rect(pymupdf.Rect(h["rect"]), color=None, fill=(1, 0.9, 0), fill_opacity=0.4, overlay=True)
            if pno == c["page_num"]:  # 단일 rect 는 빨간 점선으로 구분
                page.draw_rect(pymupdf.Rect(c["rect"]), color=(1, 0, 0), width=0.8, dashes="[4 3] 0", overlay=True)
            path = OUT / f"{name}_{c['id']}_p{pno}.png"
            page.get_pixmap(dpi=110).save(path)
            pdf.close()
            saved.append(path.name)
    return saved


def main():
    do_render = "--render" in sys.argv
    fails = warns = 0
    for name in FILES:
        code, result, stdout = run_parser(name)
        print(f"\n===== {name}.pdf (exit={code})")
        if name in EXPECTED_ERROR:
            ok = code != 0 and f"[{EXPECTED_ERROR[name]}]" in stdout
            print(f"  {'PASS' if ok else 'FAIL'} 예상 오류 {EXPECTED_ERROR[name]}: {stdout.strip()[:60]}")
            fails += not ok
            continue
        if result is None:
            print("  FAIL JSON 출력을 찾지 못함")
            fails += 1
            continue
        doc, chunks = result["doc"], result["chunks"]
        if len(doc["page_sizes"]) != doc["page_count"]:
            print(f"  FAIL page_sizes {len(doc['page_sizes'])}개 / 페이지 {doc['page_count']}개")
            fails += 1
        pdf = pymupdf.open(SAMPLES / f"{name}.pdf")
        for c in chunks:
            errs = check_chunk(c, doc)
            ws = overlay_check(c, pdf, set(doc["two_column_pages"])) if not errs else []
            tag = "FAIL" if errs else "WARN" if ws else "PASS"
            print(f"  {tag} {c['id']} p.{c['page_start']}-{c['page_end']} 사각형 {len(c['highlights'])}개 rect={c['rect']}")
            for e in errs:
                print(f"       FAIL {e}")
            for w in ws:
                print(f"       WARN {w}")
            fails += len(errs)
            warns += len(ws)
        pdf.close()
        if do_render and name in RENDER:
            print("  PNG:", ", ".join(render(name, chunks)))
    print(f"\n합계: 실패 {fails} / 의심 {warns}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
