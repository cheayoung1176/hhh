-- =====================================================================
-- Aether Doc AI — Supabase 테이블 설계 (기능명세서 Rev.3, 5.1.3 ERD 기준)
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 전체 붙여넣기 → Run
-- 여러 번 실행해도 안전하게 만들었어요 (이미 있으면 건너뜀).
--
-- 임베딩: gemini-embedding-2, 768차원 (ai.py 의 EMBED_DIM 과 같아야 함)
-- 사용자: Supabase Auth(auth.users)를 그대로 사용 (F-01 소셜, F-01-1 이메일 로그인)
-- 서버(FastAPI)는 secret(service_role) 키로 접근하므로 RLS를 우회한다.
--   → 서버 코드에서 owner_id 검사를 반드시 한다 (명세서 5.1.5 소유자 기준 접근 제어).
-- 앱(브라우저)은 publishable(anon) 키 + 로그인 토큰으로 접근 → 아래 RLS 정책이 본인 데이터만 허용.
-- =====================================================================

create extension if not exists vector;

-- ---------------------------------------------------------------- documents (F-03 ~ F-06-1, F-10)
create table if not exists public.documents (
  doc_id        uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  title         text not null,                 -- 화면에 보이는 이름 (F-06-1 이름 변경 대상)
  file_name     text not null,                 -- 업로드한 원래 파일 이름
  file_size     bigint not null check (file_size > 0 and file_size <= 52428800),  -- 50MB (F-03)
  storage_key   text,                          -- 저장소(pdfs 버킷) 안의 경로
  status        text not null default 'progress'
                check (status in ('progress', 'success', 'fail')),                  -- F-05
  progress      int  not null default 0 check (progress between 0 and 100),
  stage         text,                          -- 분석 단계 이름 (텍스트 추출, 임베딩 등)
  error_code    text,                          -- 실패 이유 (encrypted_pdf, no_text …)
  page_count    int,
  two_column    boolean,
  page_sizes    jsonb,                         -- [{width, height}] 하이라이트 좌표 변환용
  toc           jsonb,                         -- [{title, level, page}]           (F-10 목차)
  summary       text,                          --                                    (F-10 요약)
  points        jsonb,                         -- [{title, text, page}]            (핵심 포인트)
  keywords      jsonb,                         -- [{k, n}]                          (F-10, F-11)
  doc_type      text,                          -- F-28 (Phase 1)
  domain_mode   text,                          -- F-25 (Phase 1)
  started_at    timestamptz,                   -- 분석 시작 시각 (F-04-1 지연 안내 기준)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.documents add column if not exists started_at timestamptz;  -- 예전 SQL로 만든 경우 대비
create index if not exists documents_owner_idx on public.documents (owner_id, created_at desc);

-- ---------------------------------------------------------------- doc_chunks (F-08, F-09, F-13)
create table if not exists public.doc_chunks (
  chunk_id        bigint generated always as identity primary key,
  doc_id          uuid not null references public.documents(doc_id) on delete cascade,
  owner_id        uuid not null references auth.users(id) on delete cascade,  -- 검색 시 사용자 격리 (5.1.5)
  chunk_index     int  not null,
  section         text[] not null default '{}',   -- 섹션 경로 ["Ⅱ. 관련 연구", "2.1 문서 요약"]
  page_num        int  not null,                  -- 시작 페이지 (출처 칩 p.N)
  page_end        int  not null,
  rect            float8[],                       -- [x0, y0, x1, y1] 시작 페이지의 영역 (F-09)
  highlights      jsonb not null default '[]',    -- [{page, rect}] 칠할 사각형 전체
  text            text not null,                  -- [문서 제목 | 섹션] 머리말 포함 (임베딩 입력)
  body            text not null,                  -- 화면에 보여줄 본문
  char_start      int,
  char_end        int,
  embedding       vector(768),
  embedding_model text not null,                  -- 임베딩 모델을 바꿀 때 다시 만들 조각을 고르는 기준
  unique (doc_id, chunk_index)
);
create index if not exists doc_chunks_doc_idx on public.doc_chunks (doc_id);
-- 참고: 문서 하나 안에서만 찾을 때는 조각 수가 적어서 인덱스 없이도 빠르다.
-- 여러 문서를 함께 찾는 F-13 을 만들 때 아래 줄의 주석을 풀어 빠른 검색 인덱스를 추가한다.
-- create index doc_chunks_embedding_idx on public.doc_chunks using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------- chat_sessions / messages (F-08, F-12, F-22)
create table if not exists public.chat_sessions (
  session_id  uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references public.documents(doc_id) on delete cascade,  -- F-12: 문서 삭제 시 함께 소멸
  owner_id    uuid not null references auth.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists chat_sessions_doc_idx on public.chat_sessions (doc_id, updated_at desc);

create table if not exists public.messages (
  message_id  bigint generated always as identity primary key,
  session_id  uuid not null references public.chat_sessions(session_id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  turn_id     uuid not null default gen_random_uuid(),   -- SSE payload 의 turn_id (F-08)
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  sources     jsonb not null default '[]',               -- [{chunk_id, page_num, rect, highlights}] (F-09)
  confidence  real,                                      -- F-22 (Phase 1)
  created_at  timestamptz not null default now()
);
create index if not exists messages_session_idx on public.messages (session_id, created_at);


-- ---------------------------------------------------------------- auth_identities (F-01, F-01-1, F-02-1)
-- 비밀번호 해시(password_hash)는 Supabase Auth(auth.users)가 bcrypt 로 보관한다. 여기에는 저장하지 않는다.
create table if not exists public.auth_identities (
  identity_id  bigint generated always as identity primary key,
  user_id      uuid references auth.users(id) on delete cascade,
  provider     text not null check (provider in ('google', 'apple', 'local')),
  email        text not null,
  failed_count int  not null default 0,          -- F-02-1 연속 실패 횟수 (자체 로그인만)
  locked_until timestamptz,                      -- F-02-1 잠금 해제 시각
  created_at   timestamptz not null default now(),
  unique (email, provider)
);

-- ---------------------------------------------------------------- 검색 함수: 문서 하나 안에서 비슷한 조각 찾기
create or replace function public.match_chunks(
  p_doc_id   uuid,
  p_owner_id uuid,
  p_query    vector(768),
  p_count    int default 6
)
returns table (
  chunk_id bigint, chunk_index int, section text[], page_num int, page_end int,
  rect float8[], highlights jsonb, body text, similarity float
)
language sql stable
as $$
  select c.chunk_id, c.chunk_index, c.section, c.page_num, c.page_end,
         c.rect, c.highlights, c.body,
         1 - (c.embedding <=> p_query) as similarity
  from public.doc_chunks c
  where c.doc_id = p_doc_id
    and c.owner_id = p_owner_id          -- 다른 사람 조각이 섞이지 않게 (5.1.5)
    and c.embedding is not null
  order by c.embedding <=> p_query
  limit p_count;
$$;

-- ---------------------------------------------------------------- RLS: 앱에서 본인 데이터만 보이게
alter table public.documents     enable row level security;
alter table public.doc_chunks    enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.messages      enable row level security;
alter table public.auth_identities enable row level security;  -- 정책 없음 = 앱(브라우저)에서는 접근 불가, 서버만 사용

do $$
declare t text;
begin
  foreach t in array array['documents', 'doc_chunks', 'chat_sessions', 'messages'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- 파일 저장소: 원본 PDF (비공개)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- 저장 경로 규칙: pdfs/{사용자 id}/{문서 id}.pdf  → 본인 폴더만 읽기 가능
drop policy if exists "own pdfs read" on storage.objects;
create policy "own pdfs read" on storage.objects for select to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);
