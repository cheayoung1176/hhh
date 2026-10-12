# Aether Doc AI

AI 기반 PDF 문서 분석 및 질의응답 시스템 (기능명세서 Rev.3 확정 기능 F-01 ~ F-12 구현).

| 폴더 | 내용 |
|---|---|
| `HANDOFF.md` | **먼저 읽을 것.** 결정 사항, 현재 상태, 다음 작업, 실행 방법 |
| `docs/SPEC_DIGEST.md` | 명세서 요약 (화면 문구·수치·스키마 그대로) |
| `docs/API.md` | API 계약과 프론트 연동 메모 |
| `supabase/migrations/` | DB 스키마 (Supabase SQL Editor 에서 순서대로 실행) |
| `backend/` | FastAPI 백엔드 (인증 API, 작업 큐) |
| `frontend/` | Next.js 프론트 (아직 코드 없음, `reference/` 에 MVP·디자인 시안) |

스택: Next.js + Tailwind + Zustand (Vercel) / Python FastAPI + PyMuPDF / Supabase (Postgres + pgvector + Storage) / Claude API + Voyage `voyage-4` 임베딩.
