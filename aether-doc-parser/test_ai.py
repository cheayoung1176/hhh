"""
DB 없이 RAG 전체 흐름을 한 번에 돌려보는 테스트
  PDF 파싱 → 조각 임베딩 → 질문 임베딩 → 비슷한 조각 찾기 → 스트리밍 답변 → 출처 → 요약/키워드

사용법:
  python test_ai.py                                  (샘플 논문 + 기본 질문)
  python test_ai.py samples\\report.pdf "추진 방향은?"   (내 PDF + 내 질문)
무료 등급 기준 요청 수: 임베딩 2번 + 답변 1번 + 분석 1번 정도
"""
import sys
import time
from pathlib import Path

import ai
from doc_parser import ParseError, process_pdf_bytes

TOP_K = 4


def step(title):
    print(f"\n── {title}", flush=True)
    return time.time()


def done(t):
    print(f"   ({time.time() - t:.1f}초)", flush=True)


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "samples/paper_2col.pdf")
    question = sys.argv[2] if len(sys.argv) > 2 else "이 연구에서 정확도는 얼마나 향상됐어?"
    print(f"모델: 답변 {ai.CHAT_MODEL} (예비 {ai.CHAT_FALLBACK_MODEL}) | 임베딩 {ai.EMBED_MODEL} {ai.EMBED_DIM}차원")

    t = step(f"1. PDF 파싱: {path}")
    try:
        doc = process_pdf_bytes(path.read_bytes(), path.name)
    except ParseError as e:
        print(f"   [{e.code}] {e.message}")
        return
    chunks = doc["chunks"]
    title = doc["doc"]["title"]
    print(f"   제목: {title} | 청크 {len(chunks)}개")
    done(t)

    try:
        t = step("2. 조각 임베딩")
        vecs = ai.embed_documents(
            [{"title": f"{title} - {' > '.join(c['section'])}", "text": c["body"]} for c in chunks])
        print(f"   벡터 {len(vecs)}개, 길이 {len(vecs[0])}")
        done(t)

        t = step(f"3. 질문 임베딩 + 비슷한 조각 {TOP_K}개 찾기\n   질문: {question}")
        q = ai.embed_query(question)
        ranked = sorted(range(len(chunks)), key=lambda i: -ai.cosine(q, vecs[i]))[:TOP_K]
        top = [chunks[i] for i in ranked]
        for rank, i in enumerate(ranked, 1):
            c = chunks[i]
            print(f"   [{rank}] 유사도 {ai.cosine(q, vecs[i]):.3f} | p.{c['page_start']} | {' > '.join(c['section'])}")
        done(t)

        t = step("4. 스트리밍 답변")
        print("   ", end="", flush=True)
        full, first = "", None
        for tok in ai.stream_answer(question, top):
            if first is None:
                first = time.time() - t
            full += tok
            print(tok, end="", flush=True)
        print(f"\n   (첫 토큰까지 {first or 0:.1f}초 — 명세서 목표 3초 이내)", flush=True)
        done(t)

        t = step("5. 출처 정리 (F-09)")
        cited = ai.parse_citations(full, top)
        print(f"   근거 없음: {cited['none']}")
        for s in cited["sources"]:
            print(f"   p.{s['page_num']} rect={s['rect']} | {' > '.join(s['section'])}")
        if not cited["sources"] and not cited["none"]:
            print("   (AI가 출처 번호를 붙이지 않았어요)")
        done(t)

        t = step("6. 요약 · 핵심 포인트 · 키워드 (F-10)")
        a = ai.analyze_document(title, chunks)
        print(f"   요약: {a['summary']}")
        for p in a["points"]:
            print(f"   • {p['title']} (p.{p['page']}): {p['text']}")
        print("   키워드: " + ", ".join(f"{k['k']}({k['n']})" for k in a["keywords"]))
        done(t)
    except ai.AIError as e:
        print(f"\n   [AI 오류: {e.code}] {e.message}")
        return

    print("\n모든 단계가 끝났어요. 이 화면 전체를 복사해서 보내주세요.")


if __name__ == "__main__":
    main()
