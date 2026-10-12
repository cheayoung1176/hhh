"""FastAPI 공통 의존성: 설정, 현재 로그인 사용자."""
from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from psycopg import AsyncConnection

from app.core.config import Settings
from app.core.db import get_conn
from app.core.errors import unauthorized
from app.core.security import TokenError, decode_access_token
from app.schemas.auth import UserOut
from app.services import auth_service

_bearer = HTTPBearer(auto_error=False)  # 기본 403 대신 우리 공통 에러(401)를 쓰려고 auto_error=False


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # 값은 환경변수/.env 에서 읽음


SettingsDep = Annotated[Settings, Depends(get_settings)]
ConnDep = Annotated[AsyncConnection, Depends(get_conn)]


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    conn: ConnDep,
    settings: SettingsDep,
) -> UserOut:
    """Authorization: Bearer <access_token> 을 검증하고 사용자를 DB 에서 다시 확인한다.

    ★ 문서/대화/검색 등 모든 보호된 API 는 이 의존성의 user_id 로 owner_id 를 강제 필터링해야 한다 (§5.1.5).
    """
    if creds is None or creds.scheme.lower() != "bearer":
        raise unauthorized()
    try:
        user_id = decode_access_token(creds.credentials, secret=settings.jwt_secret, issuer=settings.jwt_issuer)
    except TokenError as e:
        raise unauthorized("세션이 만료되었습니다. 다시 로그인해 주세요.") from e
    row = await auth_service.get_user(conn, user_id)
    if row is None:  # 탈퇴/삭제된 계정의 토큰
        raise unauthorized("세션이 만료되었습니다. 다시 로그인해 주세요.")
    return UserOut(**row)


CurrentUser = Annotated[UserOut, Depends(get_current_user)]
