-- =====================================================================
-- 0002_storage.sql — 원본 PDF 저장용 private 버킷 (F-03, F-05-1 재분석에 재사용)
-- Supabase 전용(storage 스키마 필요). 대시보드 Storage 메뉴에서 만들어도 동일하다.
-- 접근은 백엔드가 service_role 키로만 한다. 클라이언트는 버킷에 직접 접근하지 않는다.
-- 객체 경로 규칙: {owner_id}/{doc_id}.pdf
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = 52428800,
      allowed_mime_types = array['application/pdf'];
