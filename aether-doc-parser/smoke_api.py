"""
실제 서버 + Supabase + Gemini 로 전체 흐름을 한 번에 확인하는 스크립트

준비:  .env 에 AUTH_DEV_BYPASS=1, DEV_USER_ID=<Supabase 테스트 사용자 UID>
순서:  터미널 1) uvicorn main:app --reload
       터미널 2) python smoke_api.py
"""
import json
import sys
import time

import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
PDF = "samples/paper_2col.pdf"
ok_count, fail_count = 0, 0


def check(name, cond, detail=""):
    global ok_count, fail_count
    if cond:
        ok_count += 1
        print(f"  ✅ {name}")
    else:
        fail_count += 1
        print(f"  ❌ {name}  {detail}")


def sse_lines(resp):
    for line in resp.iter_lines(decode_unicode=True):
        if line and line.startswith("data: "):
            yield json.loads(line[6:])


print(f"서버: {BASE}")
h = requests.get(f"{BASE}/health", timeout=10).json()
check("서버 동작 + 개발용 로그인 우회 켜짐", h.get("status") == "ok" and h.get("dev_bypass"), str(h))

print("\n[F-03 업로드]")
r = requests.post(f"{BASE}/documents", files={"file": ("a.txt", b"hello", "text/plain")})
check("PDF 아닌 파일 차단", r.status_code == 415, r.text[:120])
with open(PDF, "rb") as f:
    r = requests.post(f"{BASE}/documents", files={"file": ("paper_2col.pdf", f, "application/pdf")})
check("업로드 성공 → progress", r.status_code == 201 and r.json().get("status") == "progress", r.text[:300])
if r.status_code != 201:
    print("\n업로드가 실패해서 여기서 멈춰요. 위 오류 내용과 서버 터미널의 기록을 보내주세요.")
    sys.exit(1)
doc_id = r.json()["doc_id"]

print("\n[F-05 상태 SSE]")
t0 = time.time()
with requests.get(f"{BASE}/documents/{doc_id}/events", stream=True, timeout=300) as resp:
    for ev in sse_lines(resp):
        print(f"    {time.time() - t0:5.1f}초  {ev.get('status'):8} {ev.get('progress'):>3}%  {ev.get('stage')}"
              + ("  ⏳ 지연 안내" if ev.get("delayed") else ""))
        last = ev
check("분석 완료", last.get("status") == "success", str(last)[:200])

print("\n[F-10 분석 결과]")
s = requests.get(f"{BASE}/documents/{doc_id}/summary").json()
check("요약", bool(s.get("summary")), str(s)[:200])
t = requests.get(f"{BASE}/documents/{doc_id}/toc").json()
check(f"목차 {len(t.get('toc', []))}개", len(t.get("toc", [])) > 0)
k = requests.get(f"{BASE}/documents/{doc_id}/keywords").json()
check("키워드: " + ", ".join(x["k"] for x in k.get("keywords", [])[:5]), len(k.get("keywords", [])) > 0)
d = requests.get(f"{BASE}/documents/{doc_id}").json()
check("원문 PDF 서명 주소", str(d.get("pdf_url", "")).startswith("http"), str(d)[:200])
pdf_ok = requests.get(d.get("pdf_url", "http://x"), timeout=30)
check("서명 주소로 PDF 내려받기", pdf_ok.status_code == 200 and pdf_ok.content[:4] == b"%PDF")

print("\n[F-08 · F-09 대화]")
sess = requests.post(f"{BASE}/documents/{doc_id}/sessions").json()
sid = sess["session_id"]
t0, first, final = time.time(), None, None
with requests.post(f"{BASE}/sessions/{sid}/messages", json={"content": "정확도는 얼마나 향상됐어?"}, stream=True, timeout=120) as resp:
    for ev in sse_lines(resp):
        if not ev["is_final"] and first is None:
            first = time.time() - t0
        if ev["is_final"]:
            final = ev
check(f"첫 토큰 {first or 0:.1f}초 (목표 3초)", first is not None and first < 3)
check("답변: " + (final or {}).get("content", "")[:60], final and final.get("content"))
check("출처: " + ", ".join(f"p.{x['page_num']}" for x in (final or {}).get("sources", [])), final and final.get("sources"))
hist = requests.get(f"{BASE}/sessions/{sid}/messages").json()
check("F-12 히스토리 2개 (질문·답변)", len(hist.get("messages", [])) == 2)

print("\n[F-06 · F-06-1]")
check("목록에 보임", any(x["doc_id"] == doc_id for x in requests.get(f"{BASE}/documents?sort=name").json()["documents"]))
r = requests.patch(f"{BASE}/documents/{doc_id}", json={"title": "<script>x</script>"})
check("이름에 스크립트 → 거부 (F-02-2)", r.status_code == 400)
r = requests.patch(f"{BASE}/documents/{doc_id}", json={"title": "스모크 테스트 문서"})
check("이름 변경", r.ok and r.json()["title"] == "스모크 테스트 문서")
r = requests.delete(f"{BASE}/documents/{doc_id}")
check("삭제", r.status_code == 204)
check("삭제 후 히스토리 소멸", requests.get(f"{BASE}/sessions/{sid}/messages").status_code == 404)

print(f"\n결과: 통과 {ok_count} / 실패 {fail_count}  — 이 화면 전체를 보내주세요.")
