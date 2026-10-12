# API 레퍼런스 (현재 구현된 것: 인증 + 헬스체크)

- Base URL(개발): `http://localhost:8000` · 요청/응답은 모두 JSON · 개발 모드에서 `/docs` 에 Swagger UI
- 인증이 필요한 API: `Authorization: Bearer <access_token>` 헤더
- 이후 추가될 API 는 명세서 §5.1.4 의 경로를 따른다 (`/documents`, `/documents/{id}/summary|toc|keywords`, `/documents/{id}/sessions`, `/sessions/{id}/messages`).

## 공통 에러 형식

```json
{ "error": { "code": "ACCOUNT_LOCKED", "message": "화면에 그대로 보여줄 한국어 문구", "...추가 필드": "..." } }
```

| HTTP | code | 언제 | 프론트 처리 |
|---|---|---|---|
| 401 | `UNAUTHORIZED` | 토큰 없음/만료/변조 | refresh 시도 → 실패 시 로그인 화면 |
| 401 | `INVALID_CREDENTIALS` | 이메일/비밀번호 불일치 (계정 존재 여부와 무관하게 동일) | 입력 필드 하단에 `message` 표시 |
| 401 | `SESSION_EXPIRED` | refresh token 무효/만료/재사용 감지 | 저장소 파기 후 로그인 화면 (F-02) |
| 401 | `SOCIAL_AUTH_FAILED` | 구글 토큰 검증 실패 | 에러 토스트, 로그인 화면 유지 (F-01) |
| 409 | `EMAIL_TAKEN` | 가입 시 이미 있는 이메일 | 입력 필드 하단 |
| 409 | `EMAIL_ALREADY_REGISTERED` | 구글 로그인인데 같은 이메일의 자체 계정 존재 | `message` 안내 (병합 안 함, F-01) |
| 409 | `CONFLICT` | 동시 요청 충돌(드묾) | 잠시 후 재시도 |
| 422 | `VALIDATION_ERROR` | 입력 형식 오류. `fields: [{field, message}]` 포함 | `fields[].message` 를 해당 입력 하단에 |
| 423 | `ACCOUNT_LOCKED` | 5회 실패 잠금 중. `retry_after_seconds`, `just_locked` 포함 | `just_locked=true` 이면 잠금 **모달**(F-02-1), 입력 비활성화, 타이머 |
| 503 | `GOOGLE_NOT_CONFIGURED` / `SOCIAL_AUTH_UNAVAILABLE` | 서버 설정 누락 / 구글 서버 연결 불가 | 에러 토스트 |
| 500 | `INTERNAL_ERROR` | 예상 못한 오류 | 일반 에러 토스트 |

`VALIDATION_ERROR` 의 `message` 는 서버 검증기가 만든 한국어 문구(예: “유효하지 않은 문자열이 포함되어 있습니다”)이거나 일반 문구(“요청 형식이 올바르지 않습니다.”).

## 인증 응답 (signup / login / social / refresh 공통)

```json
{
  "user": { "user_id": "uuid", "email": "kim@x.com", "display_name": "김철수", "profile_image": null },
  "access_token": "eyJ...",       // JWT, 15분
  "refresh_token": "…64자…",       // 불투명 랜덤 문자열, 14일, 1회용(회전)
  "token_type": "bearer",
  "expires_in": 900,
  "is_new_user": false
}
```

## 엔드포인트

### `POST /auth/signup` → 201  (F-01-1)
요청: `{ "email", "password", "display_name"? }`
- email: 형식 검증 후 소문자 정규화 / password: 8~128자, 영문+숫자 필수 / display_name: 1~50자, 스크립트 패턴(F-02-2) 거절, 생략하면 이메일 앞부분
- 에러: 409 `EMAIL_TAKEN`, 422 `VALIDATION_ERROR`

### `POST /auth/login` → 200  (F-01-1, F-02-1)
요청: `{ "email", "password" }`
- 연속 5회 실패 → 5번째 응답이 423 `ACCOUNT_LOCKED`(`just_locked: true`, 메시지 “로그인 시도가 5회 실패하여 계정이 5분간 잠깁니다.”).
- 잠금 중에는 비밀번호가 맞아도 423 (`just_locked: false`). 5분 후 자동 해제, 성공 시 카운트 초기화.
- 존재하지 않는 이메일/구글 전용 계정은 401 `INVALID_CREDENTIALS` (잠금 대상 아님, 응답 시간도 동일하게 맞춤).

### `POST /auth/social` → 200  (F-01)
요청: `{ "provider": "google", "id_token": "<Google Identity Services credential>" }`
- 신규면 가입(`is_new_user: true`). 같은 이메일의 자체 계정이 있으면 409 `EMAIL_ALREADY_REGISTERED`.
- 계정 잠금(F-02-1)은 적용되지 않는다.
- 프론트: Google Identity Services(`accounts.google.com/gsi/client`)의 `credential` 값을 그대로 전달. 클라이언트 ID 는 백엔드 `GOOGLE_CLIENT_ID` 와 같아야 한다.

### `POST /auth/refresh` → 200  (F-02)
요청: `{ "refresh_token" }` → 새 토큰 쌍. **이전 refresh_token 은 즉시 무효** — 응답의 새 값으로 반드시 교체 저장.
- 이미 사용된 토큰이 다시 오면 탈취로 간주해 그 사용자의 모든 refresh 토큰을 폐기하고 401 `SESSION_EXPIRED`.
- ⚠ 같은 refresh_token 으로 두 탭이 동시에 갱신하면 한쪽이 위 규칙에 걸릴 수 있다 → 프론트에서 갱신 요청을 **한 번에 하나만**(single-flight) 보낼 것.

### `POST /auth/logout` → 204
요청: `{ "refresh_token" }`. 모르는/이미 폐기된 토큰이어도 204 (멱등). 클라이언트는 저장소도 함께 비운다.

### `GET /auth/me` → 200  `UserOut`
Access Token 검증용. 앱 시작 시 흐름(F-02): 저장된 refresh_token 으로 `/auth/refresh` → 성공하면 홈, 실패하면 로그인 화면.

### `GET /health`, `GET /health/db`
`{"status":"ok"}` / DB 연결 확인.

## 프론트엔드 연동 메모
- **토큰 저장**: 이 백엔드는 토큰을 JSON 본문으로 준다. 브라우저에서 refresh_token 을 `localStorage` 에 두면 XSS 에 취약하므로, 권장은 Next.js Route Handler(BFF)가 refresh_token 을 `httpOnly; Secure; SameSite=Lax` 쿠키로 들고 있다가 백엔드에 대신 전달하는 방식. 시간이 부족하면 localStorage 로 시작하되 F-02-2(입력 이스케이프)와 CSP 로 보완.
- **SSE(대화)**: `EventSource` 는 Authorization 헤더를 못 붙이므로 `fetch` + `ReadableStream` 으로 SSE 를 읽는다.
- **401 처리**: Access Token 만료(401 `UNAUTHORIZED`) → refresh 1회 → 원 요청 재시도 → 그래도 401 이면 로그인 화면.
