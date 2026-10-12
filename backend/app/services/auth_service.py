"""인증 비즈니스 로직 (F-01, F-01-1, F-02, F-02-1).

SQL 은 모듈 상단 상수로 모아둔다. (테스트에서 실제 Postgres 로 그대로 실행해 검증함)

트랜잭션 규칙: 'DB 에 기록한 뒤 에러를 응답'해야 하는 경우(로그인 실패 횟수 등)에는
에러를 `async with conn.transaction()` 블록 '밖에서' raise 한다. 안에서 raise 하면 기록이 롤백된다.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from psycopg.errors import UniqueViolation
from starlette.concurrency import run_in_threadpool

from app.core import errors
from app.core.errors import AppError
from app.core.security import (
    create_access_token,
    dummy_password_hash,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    normalize_email,
    safe_display_name,
    verify_password,
)
from app.services.google import verify_google_id_token

if TYPE_CHECKING:
    from psycopg import AsyncConnection

    from app.core.config import Settings

# ----------------------------------------------------------------------
# SQL
# ----------------------------------------------------------------------
_USER_COLS = "user_id, email, display_name, profile_image"

SQL_USER_BY_ID = f"SELECT {_USER_COLS} FROM users WHERE user_id = %(user_id)s"
SQL_USER_BY_EMAIL = f"SELECT {_USER_COLS} FROM users WHERE email = %(email)s"
SQL_USER_BY_GOOGLE_SUB = f"""
SELECT u.user_id, u.email, u.display_name, u.profile_image
FROM auth_identities ai JOIN users u ON u.user_id = ai.user_id
WHERE ai.provider = 'google' AND ai.provider_sub = %(sub)s
"""
SQL_INSERT_USER = f"""
INSERT INTO users (email, display_name, profile_image)
VALUES (%(email)s, %(display_name)s, %(profile_image)s)
RETURNING {_USER_COLS}
"""
SQL_INSERT_LOCAL_IDENTITY = """
INSERT INTO auth_identities (user_id, provider, password_hash)
VALUES (%(user_id)s, 'local', %(password_hash)s)
"""
SQL_INSERT_GOOGLE_IDENTITY = """
INSERT INTO auth_identities (user_id, provider, provider_sub)
VALUES (%(user_id)s, 'google', %(sub)s)
"""

# 로그인 조회. 같은 계정의 동시 로그인 시도를 직렬화하려고 identity 행을 잠근다(FOR UPDATE).
# 시간 계산은 앱 서버가 아니라 DB 시계(now())로 통일한다.
SQL_LOGIN_LOOKUP = f"""
SELECT u.user_id, u.email, u.display_name, u.profile_image,
       ai.identity_id, ai.password_hash, ai.failed_count, ai.locked_until,
       (ai.locked_until IS NOT NULL AND ai.locked_until > now()) AS is_locked,
       COALESCE(CEIL(EXTRACT(EPOCH FROM (ai.locked_until - now())))::int, 0) AS retry_after
FROM users u
JOIN auth_identities ai ON ai.user_id = u.user_id AND ai.provider = 'local'
WHERE u.email = %(email)s
FOR UPDATE OF ai
"""
SQL_LOGIN_FAIL = """
UPDATE auth_identities
SET failed_count = %(count)s::int,
    locked_until = CASE WHEN %(count)s::int >= %(max_failures)s::int
                        THEN now() + make_interval(mins => %(lock_minutes)s::int)
                        ELSE NULL END
WHERE identity_id = %(identity_id)s
RETURNING (locked_until IS NOT NULL) AS locked,
          COALESCE(CEIL(EXTRACT(EPOCH FROM (locked_until - now())))::int, 0) AS retry_after
"""
SQL_LOGIN_SUCCESS = """
UPDATE auth_identities SET failed_count = 0, locked_until = NULL
WHERE identity_id = %(identity_id)s
"""

SQL_INSERT_REFRESH = """
INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
VALUES (%(user_id)s, %(token_hash)s, now() + make_interval(days => %(days)s::int))
"""
SQL_PURGE_EXPIRED_REFRESH = "DELETE FROM refresh_tokens WHERE user_id = %(user_id)s AND expires_at < now()"
# 회전: 아직 유효한 토큰을 '원자적으로' 폐기하고 주인을 알려준다. 동시에 두 번 써도 한 번만 성공.
SQL_ROTATE_REFRESH = """
UPDATE refresh_tokens SET revoked_at = now()
WHERE token_hash = %(token_hash)s AND revoked_at IS NULL AND expires_at > now()
RETURNING user_id
"""
# 이미 폐기된 토큰이 다시 들어오면 탈취 의심 → 그 사용자의 모든 토큰을 폐기
SQL_FIND_REVOKED_REFRESH = """
SELECT user_id FROM refresh_tokens
WHERE token_hash = %(token_hash)s AND revoked_at IS NOT NULL AND expires_at > now()
"""
SQL_REVOKE_ALL_REFRESH = "UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = %(user_id)s AND revoked_at IS NULL"
SQL_REVOKE_ONE_REFRESH = "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = %(token_hash)s AND revoked_at IS NULL"


# ----------------------------------------------------------------------
# 내부 헬퍼
# ----------------------------------------------------------------------
async def _one(conn: AsyncConnection, sql: str, params: dict[str, Any]) -> dict[str, Any] | None:
    cur = await conn.execute(sql, params)
    return await cur.fetchone()


def _user_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {k: row[k] for k in ("user_id", "email", "display_name", "profile_image")}


async def _issue_tokens(conn: AsyncConnection, settings: Settings, user_id: Any) -> dict[str, Any]:
    access = create_access_token(
        str(user_id),
        secret=settings.jwt_secret,
        issuer=settings.jwt_issuer,
        ttl_minutes=settings.access_token_ttl_minutes,
    )
    raw, token_hash = new_refresh_token()
    await conn.execute(SQL_PURGE_EXPIRED_REFRESH, {"user_id": user_id})
    await conn.execute(
        SQL_INSERT_REFRESH,
        {"user_id": user_id, "token_hash": token_hash, "days": settings.refresh_token_ttl_days},
    )
    return {
        "access_token": access,
        "refresh_token": raw,
        "token_type": "bearer",
        "expires_in": settings.access_token_ttl_minutes * 60,
    }


def _auth_payload(user_row: dict[str, Any], tokens: dict[str, Any], *, is_new_user: bool = False) -> dict[str, Any]:
    return {"user": _user_dict(user_row), **tokens, "is_new_user": is_new_user}


# ----------------------------------------------------------------------
# F-01-1 회원가입
# ----------------------------------------------------------------------
async def signup(
    conn: AsyncConnection, settings: Settings, *, email: str, password: str, display_name: str | None
) -> dict[str, Any]:
    name = display_name or safe_display_name(None, email.split("@")[0])
    password_hash = await run_in_threadpool(hash_password, password)  # CPU 작업: 이벤트 루프를 막지 않도록
    try:
        async with conn.transaction():
            user = await _one(
                conn, SQL_INSERT_USER, {"email": email, "display_name": name, "profile_image": None}
            )
            assert user is not None
            await conn.execute(
                SQL_INSERT_LOCAL_IDENTITY, {"user_id": user["user_id"], "password_hash": password_hash}
            )
            tokens = await _issue_tokens(conn, settings, user["user_id"])
    except UniqueViolation as e:  # 동시 가입 경쟁까지 DB 유니크 제약이 최종 방어
        raise errors.email_taken() from e
    return _auth_payload(user, tokens, is_new_user=True)


# ----------------------------------------------------------------------
# F-01-1 + F-02-1 이메일 로그인 / 5회 실패 잠금
# ----------------------------------------------------------------------
async def login_local(conn: AsyncConnection, settings: Settings, *, email: str, password: str) -> dict[str, Any]:
    failure: AppError | None = None
    result: dict[str, Any] | None = None

    async with conn.transaction():
        row = await _one(conn, SQL_LOGIN_LOOKUP, {"email": email})

        if row is None:
            # 없는 계정이어도 해시 비교 1회를 수행해 응답 시간을 맞춘다.
            await run_in_threadpool(verify_password, password, dummy_password_hash())
            failure = errors.invalid_credentials()

        elif row["is_locked"]:
            # 잠금 중에는 비밀번호가 맞아도 거절 (입력 필드 비활성화와 동일한 정책)
            failure = errors.account_locked(
                row["retry_after"],
                just_locked=False,
                max_failures=settings.login_max_failures,
                lock_minutes=settings.login_lock_minutes,
            )

        else:
            lock_expired = row["locked_until"] is not None  # 잠금 시간이 지났음 → 실패 카운트 초기화(F-02-1)
            base_failures = 0 if lock_expired else row["failed_count"]
            ok = await run_in_threadpool(verify_password, password, row["password_hash"])

            if ok:
                if row["failed_count"] or lock_expired:
                    await conn.execute(SQL_LOGIN_SUCCESS, {"identity_id": row["identity_id"]})
                tokens = await _issue_tokens(conn, settings, row["user_id"])
                result = _auth_payload(row, tokens)
            else:
                upd = await _one(
                    conn,
                    SQL_LOGIN_FAIL,
                    {
                        "count": base_failures + 1,
                        "max_failures": settings.login_max_failures,
                        "lock_minutes": settings.login_lock_minutes,
                        "identity_id": row["identity_id"],
                    },
                )
                assert upd is not None
                if upd["locked"]:
                    failure = errors.account_locked(
                        upd["retry_after"],
                        just_locked=True,
                        max_failures=settings.login_max_failures,
                        lock_minutes=settings.login_lock_minutes,
                    )
                else:
                    failure = errors.invalid_credentials()

    if failure is not None:  # 트랜잭션이 커밋된 '뒤에' 에러 응답 (실패 카운트가 남도록)
        raise failure
    assert result is not None
    return result


# ----------------------------------------------------------------------
# F-01 구글 로그인
# ----------------------------------------------------------------------
async def login_google(conn: AsyncConnection, settings: Settings, *, id_token: str) -> dict[str, Any]:
    claims = await run_in_threadpool(verify_google_id_token, id_token, settings.google_client_id)
    try:
        email = normalize_email(str(claims["email"]))
    except ValueError as e:
        raise AppError(401, "SOCIAL_AUTH_FAILED", "구글 로그인에 실패했습니다. 다시 시도해 주세요.") from e

    conflict: AppError | None = None
    user: dict[str, Any] | None = None
    is_new = False
    tokens: dict[str, Any] | None = None

    try:
        async with conn.transaction():
            user = await _one(conn, SQL_USER_BY_GOOGLE_SUB, {"sub": claims["sub"]})
            if user is None:
                if await _one(conn, SQL_USER_BY_EMAIL, {"email": email}) is not None:
                    # 같은 이메일의 기존 계정이 있으면 자동 병합하지 않는다 (명세서 F-01)
                    conflict = errors.email_registered_with_password()
                else:
                    name = safe_display_name(claims.get("name"), email.split("@")[0])
                    user = await _one(
                        conn,
                        SQL_INSERT_USER,
                        {"email": email, "display_name": name, "profile_image": claims.get("picture")},
                    )
                    assert user is not None
                    await conn.execute(SQL_INSERT_GOOGLE_IDENTITY, {"user_id": user["user_id"], "sub": claims["sub"]})
                    is_new = True
            if conflict is None:
                assert user is not None
                tokens = await _issue_tokens(conn, settings, user["user_id"])
    except UniqueViolation as e:  # 같은 사용자가 동시에 첫 로그인을 두 번 보낸 경우 등
        raise AppError(409, "CONFLICT", "요청이 겹쳤습니다. 잠시 후 다시 시도해 주세요.") from e

    if conflict is not None:
        raise conflict
    assert user is not None and tokens is not None
    return _auth_payload(user, tokens, is_new_user=is_new)


# ----------------------------------------------------------------------
# F-02 세션 유지: Refresh Token 회전
# ----------------------------------------------------------------------
async def refresh(conn: AsyncConnection, settings: Settings, *, refresh_token: str) -> dict[str, Any]:
    token_hash = hash_refresh_token(refresh_token)
    reuse_detected = False
    result: dict[str, Any] | None = None

    async with conn.transaction():
        rotated = await _one(conn, SQL_ROTATE_REFRESH, {"token_hash": token_hash})
        if rotated is not None:
            user = await _one(conn, SQL_USER_BY_ID, {"user_id": rotated["user_id"]})
            if user is not None:
                tokens = await _issue_tokens(conn, settings, user["user_id"])
                result = _auth_payload(user, tokens)
        else:
            reused = await _one(conn, SQL_FIND_REVOKED_REFRESH, {"token_hash": token_hash})
            if reused is not None:
                reuse_detected = True
                await conn.execute(SQL_REVOKE_ALL_REFRESH, {"user_id": reused["user_id"]})

    _ = reuse_detected  # 필요하면 여기서 보안 로그를 남긴다 (토큰 원문은 기록 금지)
    if result is None:
        raise errors.session_expired()
    return result


async def logout(conn: AsyncConnection, *, refresh_token: str) -> None:
    await conn.execute(SQL_REVOKE_ONE_REFRESH, {"token_hash": hash_refresh_token(refresh_token)})


async def get_user(conn: AsyncConnection, user_id: Any) -> dict[str, Any] | None:
    return await _one(conn, SQL_USER_BY_ID, {"user_id": user_id})
