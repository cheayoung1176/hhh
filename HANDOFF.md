# HANDOFF — Aether Doc AI (AI 기반 PDF 문서 분석 및 질의응답 시스템)

> 이 문서는 **새 Claude 세션에 통째로 붙여넣어 작업을 이어가기 위한 인수인계서**다.
> 먼저 이 파일 → `docs/SPEC_DIGEST.md`(명세 문구·수치) → `docs/API.md`(API 계약) 순서로 읽을 것.
> 마지막 갱신: 2026-10-12 (1주차 시작일)

---

## 0. 붙여넣기용 시작 프롬프트 (사용자가 새 세션 첫 메시지로 쓰면 됨)

```
이 프로젝트를 이어서 진행하기 전에 반드시 사용자와 먼저 대화하세요.

1. 인수인계 문서와 기존 기능명세서를 읽고 현재 상태를 요약합니다.

2. 확정된 사항, 미결정 사항, 검증되지 않은 사항을 구분합니다.

3. 사용자가 결정해야 할 사항을 설명하고 질문합니다. 기술 용어만 나열하지 말고 추천안과 이유를 함께 제시합니다.

4. 사용자가 명시적으로 요청하기 전에는 코드 작성, 파일 생성·수정·삭제, 문서 작성 및 추가 구현을 진행하지 않습니다.

5. 사용자가 이미 승인한 범위도 새로운 작업을 시작하기 전에 이번 작업의 목적과 범위를 확인합니다.

현재 단계에서는 작업을 실행하지 말고, 프로젝트 현황과 다음에 결정할 사항만 대화로 설명하세요. 사용자의 명시적인 승인을 받은 뒤에만 해당 작업을 진행하세요.
```

---

## 1. 프로젝트와 사용자

- 학과 프로젝트(인소 3학년, 유채영). **혼자, 약 5주** (시작 2026-10-12, 마감은 11월 중순 — 정확한 날짜는 사용자에게 확인).
- 이미 있는 것: ① 기능명세서 Rev.3(docx, 설계 문서) ② 정적 HTML MVP(`frontend/reference/mvp/`, 가짜 분석 결과로 UX 검증용) ③ Stitch 디자인 시안(`frontend/reference/stitch/`).
- **이제 실제 구현 단계**: 확정 기능 **F-01 ~ F-12** 를 동작하는 서비스로 만든다. (제안 기능 F-13~F-28 은 범위 밖.)
- 사용자는 한국어로 소통하고, 기술 스택 경험이 많지 않다(React/JS/Python 가능). **어려운 선택은 추천 + 이유**로 제시하고 직접 결정하도록 돕는다.

### 사용자가 명확히 요구한 것 (어기지 말 것)
1. **뒷북 구현 금지** — 나중에 뒤집어야 할 구조(예: 출처 좌표를 나중에 추가)를 처음부터 넣는다. 그래서 `doc_chunks.rect`, 작업 큐, 소유자 격리를 1주차에 이미 넣었다.
2. **"전부 JS 로 구현" 안은 기각됨** — Python(FastAPI) 백엔드 + Next.js 프론트로 확정.
3. **Apple 로그인은 제외** (Apple Developer 계정 없음). 다시 제안하지 말 것.
4. 명세서의 **한국어 문구·수치는 그대로** 쓴다 (`docs/SPEC_DIGEST.md`).
5. 추측으로 "된다"고 말하지 말고, **실제로 실행해서 검증한 것과 못 한 것을 구분해서 보고**한다.

---

## 2. 확정된 설계

| 항목 | 결정 |
|---|---|
| 플랫폼 | **반응형 웹만** (앱은 범위 밖. 앱 전용 기능은 모두 Phase 2~3) |
| 프론트 | Next.js(React) + Tailwind + Zustand, Vercel 배포. PDF 뷰어는 react-pdf(pdf.js) + 하이라이트 오버레이 |
| 백엔드 | Python FastAPI (Render/Railway/Fly 등에 배포 — 미정). Vercel 서버리스는 실행 시간 제한 때문에 분석 파이프라인에 부적합 |
| DB·저장소 | Supabase **Postgres + pgvector + Storage 만** 사용. ★ **Supabase Auth 는 쓰지 않는다** — 명세 ERD(`users`/`auth_identities`)와 5회 잠금(F-02-1)을 위해 FastAPI 가 직접 인증(자체 JWT) |
| 분석 처리 | Postgres `jobs` 테이블 + **별도 워커 프로세스**. `app/jobs/queue.py` 의 `enqueue/dequeue/heartbeat/complete/fail/reap_stale` 만 통해서 접근 (나중에 Redis 로 바꿔도 이 파일만 수정) |
| 상태 전달 | 문서 목록 상태는 프론트가 2~3초 **폴링**으로 시작(F-05). 대화 응답(F-08)만 SSE |
| PDF 파싱 | PyMuPDF — 페이지별 텍스트 블록 + 좌표(rect), 암호화 감지, 목차(`get_toc`) |
| 임베딩 | **Voyage `voyage-4`, 1024차원** (`vector(1024)`), 문서는 `input_type="document"`, 질의는 `"query"` |
| LLM | Anthropic Claude API. 요약·키워드는 저렴한 모델(예: `claude-haiku-5-5`), 대화는 `claude-sonnet-5-5` 권장 — **구현 시 모델 ID·가격을 문서에서 다시 확인** |
| 로그인 | Google(GIS ID 토큰 서버 검증) + 이메일. 5회 실패 → 5분 잠금(자체 로그인만) |
| 비밀번호 해시 | 표준 라이브러리 **scrypt** (N=2^15,r=8,p=1). 형식 `scrypt$N$r$p$salt$hash` — 추후 argon2 로 바꿀 때를 위해 접두어로 구분 |
| 토큰 | Access = HS256 JWT 15분 / Refresh = 랜덤 문자열 14일, DB 에는 SHA-256 해시만, **1회용 회전 + 재사용 감지** |

### 일정 (5주)
| 주 | 목표 | 기능 |
|---|---|---|
| 1 | 세팅 + 인증 + 업로드 | F-01, F-01-1, F-02, F-02-1, F-02-2, F-03 |
| 2 | 분석 파이프라인 + 목록 | F-04, F-04-1, F-05, F-05-1, F-06, F-06-1 |
| 3 | 상세페이지 + PDF 뷰어 | F-07, F-10 |
| 4 | RAG 대화 | F-08, F-09, F-11 (★ 가장 큰 위험: 출처 좌표 하이라이트) |
| 5 | 히스토리 + 반응형 + 버그 + 배포 | F-12, 브레이크포인트 전환 상태 유지 |

---

## 3. 현재 상태 (2026-10-12)

### 만들어진 것
```
aether-doc-ai/
├─ HANDOFF.md                      ← 이 파일
├─ docs/SPEC_DIGEST.md             명세서 요약(문구·수치·스키마 그대로)
├─ docs/API.md                     API 계약 + 프론트 연동 메모
├─ supabase/migrations/
│   ├─ 0001_init.sql               확정 기능 범위 전체 스키마 (users, auth_identities, refresh_tokens,
│   │                              documents, doc_analysis, doc_chunks, chat_sessions, messages, jobs)
│   └─ 0002_storage.sql            private 버킷 'documents' (50MB, PDF 만)
├─ backend/
│   ├─ requirements.txt / requirements-dev.txt / .env.example / pytest.ini
│   ├─ app/main.py                 FastAPI 앱 (CORS, 에러 핸들러, /health, /auth 라우터, 시작 시 풀 오픈)
│   ├─ app/core/{config,db,deps,errors,handlers,security}.py
│   ├─ app/api/auth.py             POST /auth/signup|login|social|refresh|logout, GET /auth/me
│   ├─ app/schemas/auth.py         요청/응답 모델 + 한국어 검증 문구
│   ├─ app/services/{auth_service,google}.py
│   ├─ app/jobs/queue.py           Postgres 작업 큐
│   ├─ tests/{test_security,test_schemas}.py   단위 테스트 32개
│   └─ scripts/smoke_auth.py       서버 기동 후 인증 API 를 끝까지 두드리는 스크립트
├─ frontend/reference/             MVP(index.html) + Stitch 시안/DESIGN.md (참고용, 아직 Next.js 코드 없음)
```

### 검증 결과 — 정직하게 구분
**실제로 실행해서 통과한 것** (PostgreSQL 16 에 대해):
- 스키마 마이그레이션 적용 + 제약 14항목: 타 사용자 owner 로 청크/세션 insert 가 **DB 에서 거절**됨, CHECK(rect 길이·page_num·50MB·소문자 이메일·identity 형태), 중복 방지(구글 sub, 활성 job), `updated_at` 트리거, 문서 삭제 시 청크/세션/메시지/job/분석 CASCADE.
- 인증 서비스 38항목(실제 SQL 실행): 가입·중복, 평문 비밀번호/refresh 원문 미저장, 5회 잠금(카운트가 롤백되지 않고 커밋됨), 잠금 중 올바른 비밀번호도 거절, 5분 후 해제·카운트 초기화, 존재하지 않는 계정과 동일한 문구·응답 시간, 구글 신규/재로그인/이메일 충돌(병합 안 함), refresh 회전·재사용 감지(전체 폐기)·만료·logout.
- 작업 큐 27항목: 중복 enqueue 차단, 재시도 backoff(30s→60s…), 시도 소진 → failed, `retry=False`, 죽은 워커 job 재할당·소진 시 reap, `SKIP LOCKED` 로 두 워커가 서로 다른 job 획득.
- 단위 테스트 32개(`cd backend && python -m unittest discover -s tests -t .` 또는 `pytest`): scrypt, JWT(alg=none·만료·타입 위조 거절), 입력 검증, F-02-2 스크립트 패턴.

**아직 한 번도 실행하지 못한 것** (샌드박스에서 pip/PyPI 접근이 막혀 FastAPI·psycopg 설치 불가):
- ⚠ **FastAPI 라우트 연결(`main.py`, `api/auth.py`, `core/deps.py`, `core/handlers.py`, `core/db.py`)** — 문법 컴파일만 했고 서버를 띄워본 적 없음.
- ⚠ 실제 psycopg 드라이버/풀, 실제 Google 토큰 검증(`services/google.py`), 실제 Supabase 연결.
- ⚠ `scripts/smoke_auth.py` 자체.
- → **7번 작업의 1번(서버 기동 + smoke 테스트)이 가장 먼저 할 일.** 여기서 나오는 오류는 연결부 오타·버전 차이일 가능성이 높다.

### 아직 없는 것
- 비밀번호 찾기/재설정(F-01-1) — 이메일 발송 수단 미정(6번)
- F-03 업로드 API, 문서 CRUD, 분석 워커, 조회 API, RAG/SSE — 전부 이후 작업
- 프론트엔드(Next.js) 코드 전무

---

## 4. 아키텍처 규칙 (코드 쓸 때 반드시 지킬 것)

1. **모든 보호된 API 는 `CurrentUser` 의존성의 `user_id` 로 `owner_id` 를 강제 필터링**한다. 문서·청크·세션 조회/수정/삭제 SQL 에는 항상 `owner_id = %(owner_id)s` 가 들어간다. 벡터 검색에도 필수 (타 사용자 데이터 노출은 치명적, 명세 §5.1.5). DB 가 `(doc_id, owner_id)` 복합 FK 로 한 번 더 막아준다 → **`doc_chunks`/`chat_sessions` insert 시 owner_id 는 문서 소유자와 같아야 한다.**
2. **SQL 은 파라미터 바인딩(`%(name)s`)만.** 문자열 포맷으로 SQL 만들기 금지. SQL Injection 은 필터링이 아니라 바인딩으로 막는다. (F-02-2 의 `reject_script_patterns` 는 XSS 용 보조 장치.)
3. **트랜잭션**: 풀 연결은 `autocommit=True`. 여러 쓰기를 묶을 땐 `async with conn.transaction():`. **"DB 에 기록하고 나서 에러 응답"이 필요하면 에러를 블록 밖에서 raise** (안에서 raise 하면 롤백됨 — 로그인 실패 카운트가 그 예. `auth_service.login_local` 참고).
4. **에러는 `AppError`** (`app/core/errors.py`)로 던진다: `{error:{code,message,...}}`. `message` 는 명세서 문구 그대로, `code` 는 영문 상수(프론트가 분기에 사용 — 바꾸지 말 것).
5. **CPU 무거운 작업(해시, PDF 파싱, 임베딩 호출 전후 처리)은 `run_in_threadpool`** 또는 워커 프로세스에서. 이벤트 루프를 막지 않는다.
6. **로그에 문서 본문·비밀번호·토큰 원문을 남기지 않는다.**
7. 새 SQL 은 모듈 상단 `SQL_...` 상수로 모은다 (실제 Postgres 로 그대로 검증하기 쉬움).
8. 새 테이블/컬럼은 `supabase/migrations/000N_*.sql` 로 추가 (0001 을 수정하지 말 것 — 이미 사용자가 실행했을 수 있음).
9. 작업 큐 사용법은 `app/jobs/queue.py` 상단 docstring. 워커는 `reap_stale → dequeue → (heartbeat 주기적) → complete/fail` 루프. `fail()` 이 `'failed'` 를 돌려주면 **호출자가 `documents.status='fail'`, `fail_reason` 을 기록**해야 한다.
10. F-04-1 '분석 지연' 은 DB 에 저장하지 않고 **조회 시 계산**: `status='progress' AND now()-analysis_started_at > 10초 × max(1, page_count/20)`. 분석 파이프라인에 고정 타임아웃은 두지 않는다.

---

## 5. 로컬 실행 순서 (사용자가 처음 해야 할 것)

1. **Supabase 프로젝트 생성** (supabase.com, 무료). Region 은 가까운 곳(예: Seoul).
2. 대시보드 **SQL Editor** 에서 `0001_init.sql` → `0002_storage.sql` 순서로 실행. (pgvector 는 `create extension vector` 가 처리. 실패하면 Database > Extensions 에서 `vector` 켜기)
3. **Connect** 메뉴에서 *Session pooler* 연결 문자열 복사 → `backend/.env` 의 `DATABASE_URL`.
4. `JWT_SECRET` 생성: `python -c "import secrets;print(secrets.token_urlsafe(48))"`.
5. (구글 로그인) Google Cloud Console → OAuth 클라이언트 ID(웹) 생성, 승인된 JavaScript 원본에 `http://localhost:3000` 추가 → `GOOGLE_CLIENT_ID`. *지금 안 해도 이메일 로그인은 동작.*
6. ```
   cd backend
   python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
   pip install -r requirements-dev.txt
   cp .env.example .env   # 값 채우기
   pytest -q
   uvicorn app.main:app --reload --port 8000
   python scripts/smoke_auth.py http://localhost:8000     # 다른 터미널
   ```
7. API 키: **Anthropic 과 Voyage 는 2주차부터 필요** (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`). Anthropic 은 Console 에서 별도 결제(선불)가 필요하고 월 한도를 걸어두는 것을 권장.

---

## 6. 열린 결정 (사용자에게 확인할 것)

1. **Primary 색상**: 명세 §4 = `#3F7BEA`, Stitch DESIGN.md 본문 = `#2563EB`, MVP = `#004ac6`/`#2563eb`. **권장: `#2563EB`(시안·MVP 와 일치)로 통일하고 명세서 색상 표기를 수정.** 상태색(#2196F3/#4CAF50/#F44336)과 하이라이트(#FFF176)는 명세 그대로.
2. **Stitch 시안이 명세와 어긋나는 부분** (그대로 구현하지 말 것):
   - `_2` 로그인 시안의 **“Apple로 로그인”, “로그인 없이 둘러보기”** → 제거 (Apple 제외, 게스트 모드는 명세에 없음)
   - `_1`/`ai` 시안의 **“신뢰도 98%” 숫자 점수, “핵심 토큰 18.2k”** → 숫자 점수는 명세 F-22 가 금지(3단계 태그, 그나마 Phase 1). 확정 기능 범위에서는 표시하지 않음
   - `_3` 시안의 “요약 복사”, “이 페이지 질의” 등은 명세 밖 → 시간 남으면
3. **비밀번호 재설정 메일**: 발송 수단 필요 (Resend 등 무료 티어 권장). 쓸지, 이번엔 제외하고 “준비 중” 처리할지.
4. **Refresh Token 저장 방식**(웹): ① Next.js BFF 가 httpOnly 쿠키로 보관(권장, 안전) ② localStorage(빠름, XSS 위험). docs/API.md 참고.
5. **백엔드 배포처**: Render / Railway / Fly 중 선택 (워커 프로세스를 같이 띄울 수 있어야 함).
6. **업로드 오류 모달 문구**: 명세는 “안내 모달”만 지정(문구 없음). 제안: “PDF 파일만 업로드할 수 있습니다. (최대 50MB)”. 암호화 PDF 문구는 명세 그대로.

---

## 7. 다음 작업 (순서대로)

### 7-1. 서버 기동·스모크 검증 (가장 먼저) — 예상 0.5일
`pytest` 통과 확인 → uvicorn 기동 → `smoke_auth.py` 전부 PASS 확인. 실패하면 원인 수정(연결부 오타/버전 문제 우선 의심). 통과 못 시킨 항목은 사용자에게 그대로 보고.

### 7-2. F-03 업로드 API — 1일
`POST /documents` (multipart, 인증 필요). 순서와 에러:
1. 확장자·Content-Type·**첫 5바이트 `%PDF-`** 검증 → 아니면 400 `INVALID_FILE_TYPE`
2. **50MB(52428800 B) 초과** → 스트리밍으로 읽으며 초과 즉시 중단 → 413 `FILE_TOO_LARGE`  (파일 전체를 메모리에 올리지 말 것)
3. **암호화 PDF 감지**(PyMuPDF `needs_pass`/`is_encrypted`) → 400 `ENCRYPTED_PDF`, 메시지 **“비밀번호가 걸려있는 PDF 파일은 분석할 수 없습니다.”**, 임시 파일 즉시 삭제, **documents 레코드 만들지 않음**
4. Storage 업로드 `{owner_id}/{doc_id}.pdf` (service_role 키, 서버만) → `documents` insert(`status='progress'`, `analysis_started_at=now()`) → `queue.enqueue()` → 201 + 문서 메타
5. 실패 시 보상: DB insert 실패하면 올린 파일 삭제.
제목은 업로드 파일명(F-02-2 적용: 스크립트 패턴이면 거절이 아니라 안전한 이름으로 대체).

### 7-3. 프론트엔드 뼈대 — 2~3일
Next.js + Tailwind + Zustand 세팅, 디자인 토큰(6번 결정 반영), **로그인·회원가입 화면(S-01)**: 구글 버튼 + 이메일 폼, 잠금 모달(423 `just_locked`), 입력 하단 에러, 토큰 저장/갱신(single-flight refresh), 보호 라우트, 앱 셸(모바일 하단 네비 / 태블릿 2단 / 데스크톱 3단 — 빈 껍데기만).

### 7-4. (2주차) 문서 목록·CRUD API + 분석 워커
- API: `GET /documents?sort=recent|name|size`(F-06), `PATCH /documents/{id}`(이름변경, F-02-2), `DELETE /documents/{id}`(**DB cascade + Storage 원본 삭제**, F-06-1), `POST /documents/{id}/reanalyze`(F-05-1: **청크·분석 결과 삭제 → status='progress' → analysis_started_at 갱신 → enqueue**, 재업로드 없음).
- **워커(`backend/worker.py`, 별도 프로세스)** 파이프라인:
  1. Storage 에서 PDF 다운로드 → PyMuPDF 로 열기, `page_count` 저장
  2. 페이지별 `page.get_text("blocks")` → 블록(문단) 단위로 텍스트+bbox 수집. **청크는 페이지를 넘지 않게** 병합(대략 500~800 토큰), 청크 rect = 병합된 블록들의 bbox 합집합 `[x0,y0,x1,y1]` (PDF 포인트 좌표 그대로 저장 ← F-09 의 원천)
  3. 전체 글자 수가 극히 적으면(스캔본) `fail(job, "no_text", retry=False)` → documents `fail`, `fail_reason='no_text'`
  4. Voyage `voyage-4` 임베딩(`input_type="document"`, 1024차원, 배치) → `doc_chunks` insert (**owner_id 포함**)
  5. 요약·키워드(Claude) + 목차(`doc.get_toc()` 우선, 없으면 LLM) → `doc_analysis`
  6. `documents.status='success'`, `analyzed_at`, 그리고 `queue.complete()`
  - 처리 중 주기적 `heartbeat()`. 예외는 `queue.fail()` → `'failed'` 면 문서를 `fail` 로.
  - 같은 문서 재분석 시 기존 청크/분석 먼저 삭제(멱등).

### 7-5. (3~5주차) 상세페이지, RAG 대화, 히스토리
- `GET /documents/{id}/summary|toc|keywords` (F-10, 응답 제한시간 + [재시도] F-07), PDF 원본 열람은 **서버가 짧은 만료 signed URL** 발급.
- 대화 `POST /documents/{id}/sessions`, `POST /sessions/{id}/messages` (SSE): 질의 임베딩(`input_type="query"`) → `SELECT … FROM doc_chunks WHERE owner_id=%s AND doc_id=%s ORDER BY embedding <=> %s::vector LIMIT k` → 컨텍스트 + **최근 5턴** → Claude 스트리밍 → `{token, turn_id, is_final}` 이벤트, 마지막에 `sources:[{page_num, rect}]` 전달 → messages 저장(user/assistant 같은 `turn_id`). 근거 없으면 “문서 내 명확한 근거를 찾지 못했습니다”. 사용자 입력은 F-02-2 적용.
- 프론트 출처 하이라이트: PDF 좌표계 rect 를 현재 확대 비율로 변환해 #FFF176 오버레이. (react-pdf 의 viewport scale 사용 — 좌표 y 축 방향 변환 주의: PyMuPDF 는 좌상단 원점)
- F-12 히스토리: 세션 목록/읽기 전용 복원.

---

## 8. 알려진 한계·주의
- **계정 잠금 DoS**: 타인의 이메일로 5번 틀리면 5분간 잠글 수 있다(명세 F-02-1 의 본질적 트레이드오프). 필요하면 IP 기반 속도 제한을 추가.
- Google 인증서 조회가 로그인마다 발생(캐시 없음) — 규모가 작아 무시 가능.
- scrypt 해시는 요청당 약 80~100ms·메모리 약 32MB 사용. 무료 호스팅의 동시 로그인이 많으면 메모리 주의.
- Supabase **Transaction pooler(6543)** 사용 시 prepared statement 가 깨지는 문제는 `prepare_threshold=None` 으로 이미 대응. Session pooler(5432) 권장.
- `0001_init.sql` 은 pgvector 확장이 필요하다. 로컬 Postgres 에 pgvector 가 없으면 그대로 적용되지 않는다 (검증 때는 `vector(1024)` 를 `float4[]` 로 바꾸고 hnsw 인덱스를 뺀 사본으로 적용함 — 나머지는 원본과 동일).
- 이 프로젝트의 Phase 1+ 기능(F-13~F-28)을 위한 테이블은 의도적으로 없다. 필요해지면 새 마이그레이션으로 추가.

## 9. 명세서 제개정 이력에 추가할 문구 (제출용)
> F-01 소셜 로그인에서 Apple 로그인 제외(Apple Developer 계정 비용), 구현 범위를 반응형 웹으로 한정. 문서 상태 전달은 폴링으로 시작(대화 응답은 SSE 유지). 암호화 PDF 는 업로드 요청 시점에 동기 검사.
