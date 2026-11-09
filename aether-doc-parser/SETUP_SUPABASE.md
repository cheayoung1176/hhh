# Supabase 설정 안내 (무료 플랜)

Aether Doc AI의 DB(문서·조각·대화), 벡터 검색, PDF 저장소, 로그인을 Supabase 한 곳에서 처리해요.
**카드 등록 없이 무료**로 쓸 수 있어요.

## 1. 가입
1. [supabase.com](https://supabase.com) → **Start your project**
2. **Continue with GitHub** 선택 (Vercel에 쓰던 GitHub 계정으로 하면 편해요)

## 2. 프로젝트 만들기
1. **New project**
2. 입력값
   - Organization: 개인 조직 (Plan: **Free**)
   - Project name: `aether-doc-ai`
   - Database Password: **Generate a password** → 메모장에 따로 저장 (나중에 다시 볼 수 없어요)
   - Region: **Northeast Asia (Seoul)**
3. **Create new project** → 1~2분 기다리기

## 3. 테이블 만들기
1. 왼쪽 메뉴 **SQL Editor** → **New query**
2. `supabase/schema.sql` 파일 내용을 **전체 복사해서 붙여넣기** → 오른쪽 아래 **Run**
3. "destructive operation" 경고가 뜨면 **Run this query** 를 누르세요.
   (정책을 지웠다가 다시 만드는 부분 때문에 뜨는 경고예요. 데이터는 지우지 않아요.)
4. 아래에 `Success. No rows returned` 가 나오면 성공
5. 확인
   - 왼쪽 **Table Editor**: `documents`, `doc_chunks`, `chat_sessions`, `messages`, `auth_identities` 5개가 보여야 해요
   - 왼쪽 **Storage**: `pdfs` 버킷이 보여야 해요

## 4. 개발용 테스트 사용자 만들기
로그인 기능(F-01)을 만들기 전까지는, 테스트 사용자 한 명의 문서로 개발해요.
1. 왼쪽 **Authentication** → **Users** → **Add user** → **Create new user**
2. 이메일·비밀번호 입력, **Auto Confirm User** 체크 → **Create user**
3. 만들어진 사용자를 눌러 **User UID** (`xxxxxxxx-xxxx-…` 모양)를 복사

## 5. 키를 .env 에 넣기
1. 왼쪽 아래 **Project Settings** → **API Keys**
   - **Secret key** (`sb_secret_…`) 를 복사. 화면에 `service_role` 키로 나오면 그걸 써도 돼요.
2. 같은 Project Settings 의 **Data API** (또는 화면 위쪽 **Connect** 버튼)에서 **Project URL** (`https://xxxx.supabase.co`) 복사
3. `aether-doc-parser/.env` 에 아래처럼 추가 (Gemini 키 줄 아래에 이어서)
   ```
   SUPABASE_URL=https://xxxx.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_xxxxxxxx
   DEV_USER_ID=4단계에서_복사한_User_UID
   AUTH_DEV_BYPASS=1
   ```
   `AUTH_DEV_BYPASS=1` 은 로그인 화면을 만들기 전까지 토큰 없이 시험하기 위한 설정이에요. **배포할 때는 지워야 해요.**

> ⚠️ **Secret key 는 비밀번호보다 강한 열쇠예요.** 모든 데이터를 읽고 지울 수 있어요.
> 서버(FastAPI)의 `.env` 와 Render 환경 변수에만 넣고, **Next.js 코드나 GitHub에는 절대 넣지 마세요.**
> 웹 앱(브라우저)에서는 나중에 **Publishable key** (`sb_publishable_…`) 를 써요. 이건 공개돼도 RLS가 막아 줘요.

## 무료 플랜 알아둘 점
- **7일 동안 접속이 없으면 프로젝트가 일시 정지**돼요. 데이터는 그대로 남고, 대시보드에서 **Restore** 를 누르면 다시 켜져요. 발표 전날 한 번 접속해 두세요.
- DB 500MB, 파일 저장소 1GB. 조각 하나가 약 5KB(768차원 벡터 + 본문)라서, 조각 수만 개까지 충분해요. 실제로 먼저 차는 건 PDF 원본 저장소(1GB)일 거예요.
