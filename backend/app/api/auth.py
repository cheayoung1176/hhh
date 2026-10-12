"""인증 API  (명세서 §5.1.4: POST /auth/social, /auth/signup, /auth/login, /auth/refresh)."""
from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.core.deps import ConnDep, CurrentUser, SettingsDep
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    SignupRequest,
    SocialLoginRequest,
    UserOut,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, conn: ConnDep, settings: SettingsDep):
    """F-01-1 이메일 회원가입. 성공하면 바로 로그인된 상태(토큰 발급)."""
    return await auth_service.signup(
        conn, settings, email=body.email, password=body.password, display_name=body.display_name
    )


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, conn: ConnDep, settings: SettingsDep):
    """F-01-1 이메일 로그인. 5회 연속 실패 시 5분 잠금(F-02-1) → 423 ACCOUNT_LOCKED."""
    return await auth_service.login_local(conn, settings, email=body.email, password=body.password)


@router.post("/social", response_model=AuthResponse)
async def social_login(body: SocialLoginRequest, conn: ConnDep, settings: SettingsDep):
    """F-01 소셜 로그인(현재 google 만). 계정 잠금(F-02-1)은 적용되지 않는다."""
    return await auth_service.login_google(conn, settings, id_token=body.id_token)


@router.post("/refresh", response_model=AuthResponse)
async def refresh(body: RefreshRequest, conn: ConnDep, settings: SettingsDep):
    """F-02 앱 실행 시 세션 유지. Refresh Token 은 1회용(회전) — 응답의 새 토큰으로 교체해서 저장해야 한다."""
    return await auth_service.refresh(conn, settings, refresh_token=body.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: LogoutRequest, conn: ConnDep):
    """Refresh Token 폐기. 이미 폐기됐거나 모르는 토큰이어도 204 (멱등)."""
    await auth_service.logout(conn, refresh_token=body.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser):
    """Access Token 으로 현재 사용자 확인."""
    return user
