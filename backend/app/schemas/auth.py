"""인증 API 요청/응답 모델. 검증 문구는 사용자에게 그대로 보여줄 수 있는 한국어."""
from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field

from app.core.security import (
    PASSWORD_MAX_LENGTH,
    normalize_email,
    reject_script_patterns,
    validate_password_policy,
)

Email = Annotated[str, AfterValidator(normalize_email)]
# 사용자에게 다시 보여지는 텍스트는 F-02-2 스크립트 패턴 거절을 적용한다.
SafeText = Annotated[str, AfterValidator(reject_script_patterns)]


class SignupRequest(BaseModel):
    email: Email
    password: Annotated[str, AfterValidator(validate_password_policy)]
    display_name: Annotated[SafeText, Field(min_length=1, max_length=50)] | None = None


class LoginRequest(BaseModel):
    email: Email
    # 로그인에는 가입 규칙을 적용하지 않는다(해시 비교만). 너무 긴 입력만 차단.
    password: Annotated[str, Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)]


class SocialLoginRequest(BaseModel):
    provider: Literal["google"]  # Apple 은 개발자 계정 비용으로 제외
    id_token: Annotated[str, Field(min_length=20, max_length=4096)]  # Google Identity Services 가 준 credential(ID 토큰)


class RefreshRequest(BaseModel):
    refresh_token: Annotated[str, Field(min_length=20, max_length=512)]


class LogoutRequest(BaseModel):
    refresh_token: Annotated[str, Field(min_length=20, max_length=512)]


class UserOut(BaseModel):
    user_id: UUID
    email: str
    display_name: str
    profile_image: str | None = None


class AuthResponse(BaseModel):
    user: UserOut
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int  # access_token 유효 시간(초)
    is_new_user: bool = False
