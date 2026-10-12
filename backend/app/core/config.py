"""환경변수 기반 설정. backend/.env 를 읽는다 (.env.example 참고)."""
from __future__ import annotations

from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["dev", "prod"] = "dev"

    # --- DB (Supabase Postgres) ---
    # Supabase 대시보드 > Connect 에서 'Session pooler' 또는 'Direct' 문자열을 쓴다.
    # (Transaction pooler(6543)도 가능하지만 prepared statement 를 끈 상태여야 함 — db.py 에서 이미 끔)
    database_url: str
    db_pool_min: int = 1
    db_pool_max: int = 10

    # --- 인증 ---
    jwt_secret: str = Field(min_length=32)  # `python -c "import secrets;print(secrets.token_urlsafe(48))"`
    jwt_issuer: str = "aether-doc-ai"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 14
    login_max_failures: int = 5  # F-02-1
    login_lock_minutes: int = 5  # F-02-1
    google_client_id: str = ""  # Google Cloud Console 의 OAuth 웹 클라이언트 ID

    # --- CORS ---
    cors_origins: str = "http://localhost:3000"  # 쉼표로 여러 개

    # --- Supabase Storage (2주차 이전: 업로드 F-03 에서 사용) ---
    supabase_url: str = ""
    supabase_service_role_key: str = ""  # 서버 전용 비밀키. 프론트에 절대 노출 금지
    supabase_storage_bucket: str = "documents"

    # --- AI (2주차부터) ---
    anthropic_api_key: str = ""
    voyage_api_key: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
