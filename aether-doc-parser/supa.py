"""
Supabase 연결 모듈 — DB(PostgREST) · 파일 저장소(Storage) · 로그인(Auth)
서버 전용 secret 키로 접근하므로 RLS를 우회한다. 그래서 모든 조회에 owner_id 조건을 직접 붙인다 (명세서 5.1.5).

service.py 는 이 클래스의 메서드만 부른다. (테스트에서는 같은 메서드를 가진 가짜 저장소로 바꿔 끼운다)
"""
from __future__ import annotations

import os
from urllib.parse import quote

import requests
from dotenv import load_dotenv

load_dotenv()

TIMEOUT = 30  # 초


class SupaError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"Supabase {status}: {body[:300]}")
        self.status = status
        self.body = body


class SupabaseRepo:
    BUCKET = "pdfs"

    def __init__(self, url: str | None = None, key: str | None = None):
        u = (url or os.getenv("SUPABASE_URL", "")).strip().rstrip("/")
        for tail in ("/rest/v1", "/storage/v1", "/auth/v1"):  # 복사할 때 붙어 온 경로는 떼어 낸다
            if u.endswith(tail):
                u = u[: -len(tail)]
        self.url = u
        self.key = (key or os.getenv("SUPABASE_SECRET_KEY", "")).strip()
        if not self.url or not self.key:
            raise RuntimeError(".env 에 SUPABASE_URL 과 SUPABASE_SECRET_KEY 를 넣어 주세요.")
        if not self.url.startswith("https://"):
            raise RuntimeError(f".env 의 SUPABASE_URL 은 https:// 로 시작해야 해요. 지금 값의 앞부분: '{self.url[:12]}…' "
                               "(User UID 와 자리가 바뀌지 않았는지 확인해 주세요)")
        if self.key.startswith(("sb_publishable_", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9u")):
            raise RuntimeError(".env 의 SUPABASE_SECRET_KEY 에 공개용(publishable/anon) 키가 들어 있어요. Secret key 를 넣어 주세요.")
        self.http = requests.Session()

    # ------------------------------------------------------------ 공통
    def _headers(self, extra: dict | None = None, user_token: str | None = None) -> dict:
        h = {"apikey": self.key}
        if user_token:
            h["Authorization"] = f"Bearer {user_token}"
        elif self.key.startswith("eyJ"):  # 예전 service_role(JWT) 키는 Authorization 에도 넣는다
            h["Authorization"] = f"Bearer {self.key}"
        if extra:
            h.update(extra)
        return h

    def _req(self, method, path, *, params=None, json=None, data=None, headers=None, user_token=None, ok=(200, 201, 204)):
        r = self.http.request(method, f"{self.url}{path}", params=params, json=json, data=data,
                              headers=self._headers(headers, user_token), timeout=TIMEOUT)
        if r.status_code not in ok:
            raise SupaError(r.status_code, r.text)
        if r.status_code == 204 or not r.content:
            return None
        ctype = r.headers.get("content-type", "")
        return r.json() if "json" in ctype else r.content

    def _rest(self, method, table, *, params=None, json=None, prefer="return=representation"):
        return self._req(method, f"/rest/v1/{table}", params=params, json=json, headers={"Prefer": prefer})

    @staticmethod
    def _eq(v) -> str:
        return f"eq.{v}"

    # ------------------------------------------------------------ documents
    def create_document(self, row: dict) -> dict:
        return self._rest("POST", "documents", json=row)[0]

    def update_document(self, doc_id: str, fields: dict) -> None:
        self._rest("PATCH", "documents", params={"doc_id": self._eq(doc_id)}, json=fields, prefer="return=minimal")

    def get_document(self, doc_id: str, owner_id: str) -> dict | None:
        rows = self._rest("GET", "documents", params={"select": "*", "doc_id": self._eq(doc_id), "owner_id": self._eq(owner_id)})
        return rows[0] if rows else None

    LIST_COLUMNS = "doc_id,title,file_name,file_size,status,progress,stage,error_code,page_count,created_at,updated_at"

    def list_documents(self, owner_id: str, order: str) -> list[dict]:
        return self._rest("GET", "documents", params={"select": self.LIST_COLUMNS, "owner_id": self._eq(owner_id), "order": order})

    def delete_document(self, doc_id: str, owner_id: str) -> None:
        self._rest("DELETE", "documents", params={"doc_id": self._eq(doc_id), "owner_id": self._eq(owner_id)}, prefer="return=minimal")

    # ------------------------------------------------------------ doc_chunks
    def delete_chunks(self, doc_id: str) -> None:
        self._rest("DELETE", "doc_chunks", params={"doc_id": self._eq(doc_id)}, prefer="return=minimal")

    def insert_chunks(self, rows: list[dict]) -> None:
        for i in range(0, len(rows), 200):  # 한 번에 너무 크게 보내지 않게
            self._rest("POST", "doc_chunks", json=rows[i:i + 200], prefer="return=minimal")

    def match_chunks(self, doc_id: str, owner_id: str, query_vec: list[float], count: int) -> list[dict]:
        body = {"p_doc_id": doc_id, "p_owner_id": owner_id, "p_query": vector_literal(query_vec), "p_count": count}
        return self._req("POST", "/rest/v1/rpc/match_chunks", json=body) or []

    # ------------------------------------------------------------ chat_sessions / messages
    def create_session(self, row: dict) -> dict:
        return self._rest("POST", "chat_sessions", json=row)[0]

    def get_session(self, session_id: str, owner_id: str) -> dict | None:
        rows = self._rest("GET", "chat_sessions", params={"select": "*", "session_id": self._eq(session_id), "owner_id": self._eq(owner_id)})
        return rows[0] if rows else None

    def list_sessions(self, doc_id: str, owner_id: str) -> list[dict]:
        return self._rest("GET", "chat_sessions", params={
            "select": "*", "doc_id": self._eq(doc_id), "owner_id": self._eq(owner_id), "order": "updated_at.desc"})

    def update_session(self, session_id: str, fields: dict) -> None:
        self._rest("PATCH", "chat_sessions", params={"session_id": self._eq(session_id)}, json=fields, prefer="return=minimal")

    def insert_message(self, row: dict) -> dict:
        return self._rest("POST", "messages", json=row)[0]

    def list_messages(self, session_id: str, owner_id: str) -> list[dict]:
        return self._rest("GET", "messages", params={
            "select": "*", "session_id": self._eq(session_id), "owner_id": self._eq(owner_id), "order": "created_at.asc"})

    # ------------------------------------------------------------ auth_identities (F-01, F-01-1, F-02-1)
    def get_identity(self, email: str, provider: str) -> dict | None:
        rows = self._rest("GET", "auth_identities", params={"select": "*", "email": self._eq(email), "provider": self._eq(provider)})
        return rows[0] if rows else None

    def upsert_identity(self, row: dict) -> None:
        self._req("POST", "/rest/v1/auth_identities", params={"on_conflict": "email,provider"}, json=row,
                  headers={"Prefer": "resolution=merge-duplicates,return=minimal"})

    def update_identity(self, email: str, provider: str, fields: dict) -> None:
        self._rest("PATCH", "auth_identities", params={"email": self._eq(email), "provider": self._eq(provider)},
                   json=fields, prefer="return=minimal")

    # ------------------------------------------------------------ Storage (원본 PDF)
    def _obj(self, path: str) -> str:
        return f"/storage/v1/object/{self.BUCKET}/{quote(path)}"

    def upload_pdf(self, path: str, data: bytes) -> None:
        self._req("POST", self._obj(path), data=data, headers={"Content-Type": "application/pdf", "x-upsert": "true"})

    def download_pdf(self, path: str) -> bytes:
        return self._req("GET", self._obj(path))

    def delete_pdf(self, path: str) -> None:
        self._req("DELETE", f"/storage/v1/object/{self.BUCKET}", json={"prefixes": [path]})

    def sign_pdf_url(self, path: str, expires_in: int = 3600) -> str:
        r = self._req("POST", f"/storage/v1/object/sign/{self.BUCKET}/{quote(path)}", json={"expiresIn": expires_in})
        signed = r.get("signedURL") or r.get("signedUrl")
        return f"{self.url}/storage/v1{signed}"

    # ------------------------------------------------------------ Auth (Supabase GoTrue)
    def auth_get_user(self, access_token: str) -> dict | None:
        try:
            return self._req("GET", "/auth/v1/user", user_token=access_token)
        except SupaError as e:
            if e.status in (401, 403):
                return None
            raise

    def auth_signup(self, email: str, password: str) -> dict:
        return self._req("POST", "/auth/v1/signup", json={"email": email, "password": password})

    def auth_password_login(self, email: str, password: str) -> dict | None:
        """성공하면 세션(access_token, refresh_token, user), 비밀번호가 틀리면 None."""
        try:
            return self._req("POST", "/auth/v1/token", params={"grant_type": "password"},
                             json={"email": email, "password": password})
        except SupaError as e:
            if e.status in (400, 401):
                return None
            raise

    def auth_refresh(self, refresh_token: str) -> dict | None:
        try:
            return self._req("POST", "/auth/v1/token", params={"grant_type": "refresh_token"},
                             json={"refresh_token": refresh_token})
        except SupaError as e:
            if e.status in (400, 401):
                return None
            raise

    def auth_id_token(self, provider: str, id_token: str, nonce: str | None = None) -> dict | None:
        body = {"provider": provider, "id_token": id_token}
        if nonce:
            body["nonce"] = nonce
        try:
            return self._req("POST", "/auth/v1/token", params={"grant_type": "id_token"}, json=body)
        except SupaError as e:
            if e.status in (400, 401, 403):
                return None
            raise

    def auth_update_password(self, access_token: str, password: str) -> bool:
        """재설정 링크로 받은 토큰으로 새 비밀번호 저장. 토큰이 만료되면 False."""
        try:
            self._req("PUT", "/auth/v1/user", json={"password": password}, user_token=access_token)
            return True
        except SupaError as e:
            if e.status in (401, 403):
                return False
            raise

    def auth_recover(self, email: str, redirect_to: str | None = None) -> None:
        params = {"redirect_to": redirect_to} if redirect_to else None
        self._req("POST", "/auth/v1/recover", params=params, json={"email": email})


def vector_literal(v: list[float]) -> str:
    """pgvector 가 받는 문자열 형식: [0.1,0.2,...]"""
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"
