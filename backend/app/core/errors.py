"""API 에러 규약.

모든 에러 응답은 같은 모양이다:
    {"error": {"code": "ACCOUNT_LOCKED", "message": "사용자에게 보여줄 한국어 문구", ...추가 필드}}

- code    : 프론트가 분기에 쓰는 안정적인 영문 상수 (바꾸지 말 것)
- message : 그대로 화면(모달/토스트)에 보여줄 수 있는 문구. 명세서 문구를 그대로 쓴다.

이 파일은 FastAPI 에 의존하지 않는다 (핸들러 등록은 handlers.py).
"""
from __future__ import annotations

from typing import Any


class AppError(Exception):
    def __init__(self, status_code: int, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extra = extra

    def to_body(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, **self.extra}}


# 자주 쓰는 에러 팩토리 -------------------------------------------------
def unauthorized(message: str = "로그인이 필요합니다.") -> AppError:
    return AppError(401, "UNAUTHORIZED", message)


def invalid_credentials() -> AppError:
    # F-01-1: 계정 존재 여부를 노출하지 않도록 문구 통일 (명세서 문구 그대로)
    return AppError(401, "INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.")


def session_expired() -> AppError:
    # F-02: 세션 만료/토큰 변조 → 클라이언트는 저장소를 파기하고 로그인 화면으로
    return AppError(401, "SESSION_EXPIRED", "세션이 만료되었습니다. 다시 로그인해 주세요.")


def account_locked(retry_after_seconds: int, *, just_locked: bool, max_failures: int, lock_minutes: int) -> AppError:
    if just_locked:
        message = f"로그인 시도가 {max_failures}회 실패하여 계정이 {lock_minutes}분간 잠깁니다."  # F-02-1 명세 문구
    else:
        message = f"계정이 잠겨 있습니다. {max(1, -(-retry_after_seconds // 60))}분 후 다시 시도해 주세요."
    return AppError(
        423, "ACCOUNT_LOCKED", message, retry_after_seconds=retry_after_seconds, just_locked=just_locked
    )


def email_taken() -> AppError:
    return AppError(409, "EMAIL_TAKEN", "이미 가입된 이메일입니다.")


def email_registered_with_password() -> AppError:
    # F-01: 소셜 로그인 시 같은 이메일의 자체 계정이 있으면 병합하지 않고 안내 (명세서 문구 그대로)
    return AppError(
        409, "EMAIL_ALREADY_REGISTERED", "이미 이메일로 가입된 계정입니다. 이메일 로그인을 이용해 주세요."
    )
