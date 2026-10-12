-- =====================================================================
-- Aether Doc AI — 0001_init.sql
-- 기준: 기능명세서 Rev.3 §5.1.3 핵심 데이터 모델 (확정 기능 F-01 ~ F-12 범위)
-- 실행: Supabase Dashboard > SQL Editor 에 통째로 붙여넣기 (또는 `supabase db push`)
--
-- 설계 원칙
--  1) 백엔드(FastAPI)가 DB에 직접 접속해서 모든 권한 검사를 한다 (owner_id 강제).
--     -> 모든 테이블에 RLS를 켜고 정책은 만들지 않는다.
--        (Supabase가 자동 노출하는 PostgREST API 로는 아무것도 못 읽게 막는 용도.
--         백엔드가 쓰는 postgres 접속 role 은 RLS 를 우회한다.)
--  2) 삭제는 FK ON DELETE CASCADE 로 처리한다 (F-06-1 Cascade Delete).
--     단, Storage 의 원본 PDF 는 DB 밖이므로 백엔드가 별도로 지워야 한다.
--  3) 타 사용자 데이터 노출 방지(§5.1.5): doc_chunks / chat_sessions 는
--     (doc_id, owner_id) 복합 FK 로 "문서 소유자 = 청크/세션 소유자" 를 DB 가 강제한다.
--  4) Phase 1+ 테이블(doc_insights, preset_templates, comparisons ...)은 아직 만들지 않는다.
-- =====================================================================

create extension if not exists vector;

-- ---------- ENUM ----------
create type auth_provider    as enum ('google', 'local');              -- Apple 로그인은 제외(개발자 계정 비용)
create type doc_status       as enum ('progress', 'success', 'fail');  -- F-05
create type job_status       as enum ('queued', 'running', 'done', 'failed');
create type message_role     as enum ('user', 'assistant');
create type confidence_level as enum ('high', 'partial', 'low');       -- F-22(Phase 1)용. 지금은 NULL

-- ---------- 공용 트리거 ----------
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =====================================================================
-- 인증 (F-01, F-01-1, F-02, F-02-1)
-- =====================================================================
create table users (
  user_id             uuid primary key default gen_random_uuid(),
  email               text not null unique check (email = lower(email)),  -- 앱에서 소문자 정규화 후 저장
  display_name        text not null,
  profile_image       text,
  default_domain_mode text not null default 'general',                    -- F-25(Phase 1) 대비: 'general' | 'legal' | 'finance'
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();

create table auth_identities (
  identity_id   uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(user_id) on delete cascade,
  provider      auth_provider not null,
  provider_sub  text,                         -- google: ID 토큰의 sub
  password_hash text,                         -- local: scrypt 해시 문자열 (평문/로그 저장 금지)
  failed_count  integer not null default 0,   -- F-02-1 (local 전용)
  locked_until  timestamptz,                  -- F-02-1 (local 전용)
  created_at    timestamptz not null default now(),
  unique (user_id, provider),
  constraint auth_identity_shape check (
       (provider = 'local'  and password_hash is not null and provider_sub is null)
    or (provider = 'google' and provider_sub  is not null and password_hash is null)
  )
);
create unique index auth_identities_provider_sub_key
  on auth_identities (provider, provider_sub) where provider_sub is not null;

-- Refresh Token 은 원문이 아니라 SHA-256 해시만 저장한다. 재발급 때마다 회전(rotation).
create table refresh_tokens (
  token_id   uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(user_id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index refresh_tokens_user_idx on refresh_tokens (user_id);

-- =====================================================================
-- 문서 (F-03 ~ F-07)
-- =====================================================================
create table documents (
  doc_id              uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references users(user_id) on delete cascade,
  title               text not null,
  file_size           bigint not null check (file_size > 0 and file_size <= 52428800),  -- 50MB (F-03)
  storage_key         text not null,                          -- Storage 내 경로. 재분석 때 재사용(F-05-1)
  page_count          integer,
  status              doc_status not null default 'progress', -- F-05
  fail_reason         text,                                   -- 'no_text' | 'parse_error' | 'ai_error' ... (암호화 PDF 는 업로드 시점에 거절하므로 레코드가 없음)
  doc_type            text,                                   -- F-15/F-28용 (Phase 1). 지금은 NULL
  domain_mode         text not null default 'general',        -- F-25용 (Phase 1)
  analysis_started_at timestamptz,                            -- F-04-1: now() - 이 값 > 10초 * (page_count/20) 이면 '지연 안내' 표시
  analyzed_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (doc_id, owner_id)                                   -- 복합 FK 대상
);
create trigger documents_updated_at before update on documents
  for each row execute function set_updated_at();
-- F-06 정렬 3종(최신순 / 이름순 / 용량순)
create index documents_owner_created_idx on documents (owner_id, created_at desc);
create index documents_owner_title_idx   on documents (owner_id, title);
create index documents_owner_size_idx    on documents (owner_id, file_size);

-- F-10 요약 / 목차 / 키워드 (목록 조회를 가볍게 하려고 documents 와 분리)
create table doc_analysis (
  doc_id     uuid primary key references documents(doc_id) on delete cascade,
  summary    text   not null,
  toc        jsonb  not null default '[]'::jsonb,  -- [{"title":"1. 시장 개요","level":1,"page":1}, ...]
  keywords   jsonb  not null default '[]'::jsonb,  -- ["온디바이스 AI","NPU", ...]
  created_at timestamptz not null default now()
);

-- RAG 청크 (F-08, F-09).
-- 파싱 단계에서 page_num + rect 를 반드시 같이 저장한다. (출처 하이라이트 좌표의 원천)
-- 나중에 추가하려면 전체 문서 재분석이 필요하므로 처음부터 넣는다.
create table doc_chunks (
  chunk_id    uuid primary key default gen_random_uuid(),
  doc_id      uuid not null,
  owner_id    uuid not null,                                               -- 격리용 비정규화: 모든 검색에 owner_id 필터 강제(§5.1.5)
  chunk_index integer not null,
  page_num    integer not null check (page_num >= 1),                      -- 1-based
  rect        double precision[] not null check (array_length(rect, 1) = 4), -- [x0, y0, x1, y1] PDF 포인트 좌표
  text        text not null,
  embedding   vector(1024),                                                -- Voyage voyage-4 기본 차원
  unique (doc_id, chunk_index),
  foreign key (doc_id, owner_id) references documents (doc_id, owner_id) on delete cascade
);
create index doc_chunks_owner_doc_idx on doc_chunks (owner_id, doc_id);
create index doc_chunks_embedding_idx on doc_chunks using hnsw (embedding vector_cosine_ops);

-- =====================================================================
-- 대화 (F-08, F-12)
-- =====================================================================
create table chat_sessions (
  session_id     uuid primary key default gen_random_uuid(),
  doc_id         uuid not null,
  owner_id       uuid not null,
  title          text,
  created_at     timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  foreign key (doc_id, owner_id) references documents (doc_id, owner_id) on delete cascade
);
create index chat_sessions_doc_idx on chat_sessions (owner_id, doc_id, last_active_at desc);

create table messages (
  message_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(session_id) on delete cascade,
  turn_id    uuid not null,                                -- SSE payload 의 turn_id. user/assistant 한 쌍이 같은 turn_id
  role       message_role not null,
  content    text not null,
  sources    jsonb not null default '[]'::jsonb,           -- [{"page_num":12,"rect":[x0,y0,x1,y1]}]  (F-09 payload)
  confidence confidence_level,                             -- F-22 (Phase 1). 지금은 NULL
  created_at timestamptz not null default now(),
  unique (turn_id, role)
);
create index messages_session_idx on messages (session_id, created_at);

-- =====================================================================
-- 분석 작업 큐 (F-04-1). Redis/Celery 대신 Postgres 를 큐로 사용.
--   dequeue: SELECT ... FOR UPDATE SKIP LOCKED   (backend/app/jobs/queue.py)
--   서버/워커가 죽어도 job 이 DB 에 남아 재시작 후 이어서 처리된다.
-- =====================================================================
create table jobs (
  job_id       uuid primary key default gen_random_uuid(),
  doc_id       uuid not null references documents(doc_id) on delete cascade,
  kind         text not null default 'analyze',
  status       job_status not null default 'queued',
  attempts     integer not null default 0,
  max_attempts integer not null default 3,
  run_after    timestamptz not null default now(),
  locked_at    timestamptz,                -- 워커 heartbeat. 오래 갱신이 없으면 '워커 사망'으로 보고 재할당
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger jobs_updated_at before update on jobs
  for each row execute function set_updated_at();
create index jobs_poll_idx on jobs (status, run_after);
-- 같은 문서에 대해 대기/실행 중 job 은 1개만 (재분석 버튼 연타 방지)
create unique index jobs_one_active_per_doc
  on jobs (doc_id, kind) where status in ('queued', 'running');

-- =====================================================================
-- RLS: 켜기만 하고 정책은 만들지 않는다 (PostgREST 직접 접근 전면 차단)
-- =====================================================================
alter table users           enable row level security;
alter table auth_identities enable row level security;
alter table refresh_tokens  enable row level security;
alter table documents       enable row level security;
alter table doc_analysis    enable row level security;
alter table doc_chunks      enable row level security;
alter table chat_sessions   enable row level security;
alter table messages        enable row level security;
alter table jobs            enable row level security;
