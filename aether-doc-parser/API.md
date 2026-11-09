# Aether Doc AI API (기능명세서 Rev.3 5.1.4 구현)

서버를 켠 뒤 **http://localhost:8000/docs** 에서 모든 API를 화면으로 시험할 수 있어요.

## 파일 구성
| 파일 | 역할 |
|---|---|
| `main.py` | FastAPI 경로 (화면과 주고받기만) |
| `service.py` | 기능 규칙 F-01 ~ F-12 (명세서 문구·예외 정책) |
| `supa.py` | Supabase 연결 (DB · 파일 저장소 · 로그인) |
| `ai.py` | Gemini 연결 (임베딩 · 스트리밍 답변 · 요약/키워드) |
| `doc_parser.py` | PDF 추출 · 2단 판단 · 계층형 청킹 · 좌표 |
| `supabase/schema.sql` | 테이블 · 검색 함수 · RLS · 저장소 |
| `smoke_api.py` | 실제 서버로 전체 흐름 확인 |

## 엔드포인트
| 영역 | 경로 | 기능 |
|---|---|---|
| 인증 | `POST /auth/signup` `{email, password}` | F-01-1 회원가입 (8자 이상, 영문+숫자) |
| | `POST /auth/login` `{email, password}` | F-01-1 로그인, F-02-1 5회 실패 시 5분 잠금 (423) |
| | `POST /auth/refresh` `{refresh_token}` | F-02 세션 유지 |
| | `POST /auth/social` `{provider:"google", id_token}` | F-01 Google 로그인 (이메일 계정과 자동 병합 안 함) |
| | `POST /auth/recover` `{email, redirect_to?}` | 비밀번호 찾기 (재설정 메일 발송) |
| | `POST /auth/reset` `{access_token, password}` | 메일 링크의 토큰으로 새 비밀번호 설정 |
| 문서 | `POST /documents` (multipart `file`) | F-03 업로드 → 백그라운드 분석 |
| | `GET /documents?sort=latest\|name\|size` | F-05·F-06 목록 |
| | `GET /documents/{id}` | 상세 메타데이터 + `pdf_url`(1시간 유효) |
| | `GET /documents/{id}/events` (SSE) | F-04-1·F-05 상태 실시간 |
| | `PATCH /documents/{id}` `{title}` | F-06-1 이름변경 |
| | `DELETE /documents/{id}` | F-06-1 삭제 (Cascade) |
| | `POST /documents/{id}/reanalyze` | F-05-1 재분석 |
| 분석 결과 | `GET /documents/{id}/summary · toc · keywords` | F-10 |
| 대화 | `POST /documents/{id}/sessions` | 세션 시작 |
| | `GET /documents/{id}/sessions` | F-12 세션 목록 |
| | `GET /sessions/{id}/messages` | F-12 과거 대화 (읽기 전용) |
| | `POST /sessions/{id}/messages` `{content}` (SSE) | F-08 스트리밍 답변 + F-09 출처 |

모든 문서·대화 API는 `Authorization: Bearer <access_token>` 이 필요해요.
SSE 처럼 헤더를 붙이기 어려우면 `?access_token=...` 으로 보내도 돼요.

## 오류 형식
```json
{ "error": { "code": "analysis_in_progress", "message": "문서를 분석하고 있어요. 잠시만 기다려 주세요." } }
```
`message` 는 명세서 문구 그대로라서 화면에 바로 보여주면 돼요.

| code | HTTP | 명세서 |
|---|---|---|
| `not_pdf`, `too_large` | 415, 413 | F-03 |
| `encrypted_pdf` | 422 | F-04 (저장하지 않고 즉시 파기) |
| `analysis_in_progress`, `analysis_failed` | 409 | F-05-1 |
| `login_failed` | 401 | F-01-1 |
| `account_locked` (+`retry_after` 초) | 423 | F-02-1 |
| `email_registered` | 409 | F-01 |
| `invalid_input` (+`field`) | 400 | F-02-2 |
| `unauthorized`, `session_expired` | 401 | F-02 |

## 상태 SSE (`GET /documents/{id}/events`)
상태가 바뀔 때마다 한 줄씩 오고, `success`·`fail` 이면 끝나요.
```
data: {"doc_id":"…","status":"progress","progress":45,"stage":"임베딩","delayed":false, …}
data: {"doc_id":"…","status":"progress","progress":75,"stage":"요약 생성","delayed":true,"delay_message":"분석이 예상보다 길어지고 있습니다. 잠시 후 확인해 주세요."}
data: {"doc_id":"…","status":"success","progress":100,"stage":"완료", …}
```

## 대화 SSE (`POST /sessions/{id}/messages`)
명세서 F-08 Event-Stream Payload 형식이에요.
```
data: {"token":"실험 결과 ","turn_id":"550e…","is_final":false}
data: {"token":"정확도가 4.2% 향상[1]","turn_id":"550e…","is_final":false}
data: {"token":"","turn_id":"550e…","is_final":true,
       "content":"실험 결과 정확도가 4.2% 향상되었습니다.",
       "sources":[{"page_num":2,"rect":[51.0,159.7,289.1,437.6],"highlight_color":"#FFF176","highlights":[…]}],
       "none":false,"message_id":12}
```
- 토큰에는 `[1]` 같은 출처 번호가 섞여 와요. 화면은 받는 동안 번호를 숨기고, 마지막 이벤트의 `content` 로 바꿔 보여주세요.
- `sources` 는 F-09 Bounding-Box 형식(`page_num`, `rect`, `highlight_color`)이에요.
- 중간에 끊기면 `"interrupted": true` 와 `"error": {"message": "연결이 일시 중단되었습니다"}` 가 오고, 받은 부분은 `content` 에 남아 있어요.
- 브라우저의 `EventSource` 는 POST 를 못 쓰니 `fetch` 로 스트림을 읽어야 해요.

## 실행 순서
1. `pip install -r requirements.txt`
2. Supabase 설정 (`SETUP_SUPABASE.md`), `.env` 작성 (`.env.example` 참고)
3. 개발 중에는 `.env` 에 `AUTH_DEV_BYPASS=1` 과 `DEV_USER_ID` → 토큰 없이 시험 가능
4. `uvicorn main:app --reload` → http://localhost:8000/docs
5. 다른 터미널에서 `python smoke_api.py` → 전체 흐름 확인

> ⚠️ 배포(Render)할 때는 `AUTH_DEV_BYPASS` 를 넣지 마세요. 넣으면 누구나 테스트 사용자로 접근할 수 있어요.
