# Aether Doc AI — 프론트엔드 (Next.js)

> 긴 PDF, 읽기 전에 먼저 물어보세요.
> 「AI 기반 PDF 문서 분석 및 질의응답 시스템 종합 기능명세서 Rev.3」 기준 구현

- Next.js 16 (App Router) · React 19 · Zustand 5 · pdf.js 6 (public/pdfjs 에 포함)
- 백엔드: FastAPI 서버 (`aether-doc-parser`, Render 배포) + Supabase + Gemini
- 배포: Vercel

## 화면
| 경로 | 내용 |
|---|---|
| `/` | 랜딩 페이지 |
| `/workspace` | 앱 (S-01 로그인 ~ S-11 대화 기록) |

- 모바일(≤767px): 하단 탭(홈/내 문서/AI 대화/설정), 상세 화면 상단 탭 [분석][AI 대화][PDF], 근거 바텀시트
- 태블릿(768–1023px): 상단 탭 + Split View
- 데스크톱(≥1024px): 왼쪽 사이드바 260px + Split View

## 이번 범위에서 뺀 것
Google·Apple 로그인(이메일 로그인만), iOS/Android 앱 빌드, Phase 1 기능(위젯·캘린더는 설정에 자리만 있음)

## 로그인 토큰 보관 (F-02)
- Refresh Token: httpOnly · SameSite=Strict 쿠키 `aether_rt` (`/api/session` 라우트가 설정)
- Access Token: 메모리에만 보관, 401이면 한 번 자동 갱신

## 환경 변수
`.env.example` 을 `.env.local` 로 복사.

| 이름 | 값 |
|---|---|
| `NEXT_PUBLIC_API_URL` | FastAPI 서버 주소 (로컬 `http://127.0.0.1:8000`) |
| `API_URL` | 같은 값 (서버 쪽 `/api/session` 이 사용) |

## 로컬 실행
```bash
npm install
npm run dev     # http://localhost:3000/workspace
npm run build   # 배포 전 빌드 확인
```
FastAPI 서버(`uvicorn main:app --reload`)도 같이 켜 두어야 합니다.
