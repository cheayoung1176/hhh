"""순수 보안 유틸리티.

DB·설정·웹 프레임워크에 의존하지 않는다 (단위 테스트가 쉽도록 설정값은 인자로 받는다).

- 비밀번호 해시: 표준 라이브러리 scrypt (OWASP 권장 알고리즘 중 하나, 추가 의존성 없음)
- Access Token: HS256 JWT (짧은 수명)
- Refresh Token: 서버가 만든 랜덤 문자열. DB 에는 SHA-256 해시만 저장한다.
- 입력 검증: 이메일 / 비밀번호 규칙(F-01-1), 스크립트 패턴 거절(F-02-2)

SQL Injection 은 '필터링'이 아니라 '파라미터 바인딩'으로 막는다 (모든 쿼리는 %(name)s 사용).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import jwt

# ----------------------------------------------------------------------
# 비밀번호 해시 (scrypt)
# ----------------------------------------------------------------------
_SCRYPT_N = 2**15  # 메모리 ≈ 32MB, 해시 1회 ≈ 0.1초
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32
_SCRYPT_N_MAX = 2**17  # DB 값이 변조돼도 터무니없는 비용을 요구하지 못하게 상한


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    # maxmem 기본값(32MB)은 n=2**15, r=8 에서 한계라서 넉넉히 올린다.
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=128 * n * r * 2, dklen=dklen
    )


def hash_password(password: str) -> str:
    """'scrypt$N$r$p$salt$hash' 형식 문자열을 돌려준다. CPU 를 쓰므로 async 코드에서는 threadpool 로 호출."""
    salt = os.urandom(16)
    dk = _scrypt(password, salt, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P, _SCRYPT_DKLEN)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64e(salt)}${_b64e(dk)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, dk_b64 = encoded.split("$")
        if scheme != "scrypt":
            return False
        n, r, p = int(n), int(r), int(p)
        if not (2 <= n <= _SCRYPT_N_MAX) or n & (n - 1) or not (1 <= r <= 16) or not (1 <= p <= 4):
            return False
        expected = _b64d(dk_b64)
        actual = _scrypt(password, _b64d(salt_b64), n, r, p, len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


@lru_cache(maxsize=1)
def dummy_password_hash() -> str:
    """존재하지 않는 이메일로 로그인할 때도 해시 비교 시간을 똑같이 쓰기 위한 가짜 해시.
    (응답 시간 차이로 계정 존재 여부를 알아내는 공격 방지 — F-01-1 '계정 존재 여부 비노출')"""
    return hash_password(secrets.token_urlsafe(16))


# ----------------------------------------------------------------------
# JWT (Access) / Refresh Token
# ----------------------------------------------------------------------
JWT_ALGORITHM = "HS256"


class TokenError(Exception):
    """Access Token 이 없거나 변조/만료됨."""


def create_access_token(
    user_id: str, *, secret: str, issuer: str, ttl_minutes: int, now: datetime | None = None
) -> str:
    now = now or datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iss": issuer,
        "iat": now,
        "exp": now + timedelta(minutes=ttl_minutes),
        "typ": "access",
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str, *, secret: str, issuer: str) -> str:
    """유효하면 user_id(sub) 문자열을, 아니면 TokenError 를 던진다."""
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],  # 알고리즘 고정 (alg=none 공격 방지)
            issuer=issuer,
            leeway=10,  # 기기 간 시계 오차 허용(초)
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
    except jwt.PyJWTError as e:
        raise TokenError(str(e)) from e
    if payload.get("typ") != "access":
        raise TokenError("wrong token type")
    return payload["sub"]


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def new_refresh_token() -> tuple[str, str]:
    """(클라이언트에 줄 원문, DB 에 저장할 해시)"""
    raw = secrets.token_urlsafe(48)
    return raw, hash_refresh_token(raw)


# ----------------------------------------------------------------------
# 입력 검증 (F-01-1, F-02-2)
# ----------------------------------------------------------------------
INVALID_STRING_MESSAGE = "유효하지 않은 문자열이 포함되어 있습니다"  # F-02-2 명세 문구

PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
PASSWORD_POLICY_MESSAGE = "비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다."
EMAIL_FORMAT_MESSAGE = "올바른 이메일 형식이 아닙니다."

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$")

# F-02-2: 허용하지 않는 스크립트 패턴. HTML 태그 시작, javascript: 류 URL, 인라인 이벤트 핸들러.
_SCRIPT_RE = re.compile(
    r"<\s*/?\s*[a-zA-Z!]"
    r"|\b(?:javascript|vbscript)\s*:"
    r"|\bdata\s*:\s*text/html"
    r"|\bon[a-z]{3,}\s*=",
    re.IGNORECASE,
)


def normalize_email(value: str) -> str:
    v = value.strip().lower()
    if len(v) > 254 or not _EMAIL_RE.match(v):
        raise ValueError(EMAIL_FORMAT_MESSAGE)
    return v


def validate_password_policy(value: str) -> str:
    """가입 시에만 적용 (로그인 때는 규칙 검사 없이 해시 비교만)."""
    if (
        not (PASSWORD_MIN_LENGTH <= len(value) <= PASSWORD_MAX_LENGTH)
        or not re.search(r"[A-Za-z]", value)
        or not re.search(r"\d", value)
    ):
        raise ValueError(PASSWORD_POLICY_MESSAGE)
    return value


def reject_script_patterns(value: str) -> str:
    """사용자에게 다시 보여지는 텍스트(이름, 검색어, 채팅 등)용. 비밀번호에는 쓰지 않는다."""
    if "\x00" in value or _SCRIPT_RE.search(value):
        raise ValueError(INVALID_STRING_MESSAGE)
    return value


def safe_display_name(candidate: str | None, fallback: str) -> str:
    """외부(구글)에서 온 이름처럼 '거절' 대신 '대체'가 필요한 곳에서 사용."""
    for text in (candidate, fallback):
        if text:
            text = text.strip()[:50]
            try:
                return reject_script_patterns(text) if text else fallback
            except ValueError:
                continue
    return "user"
