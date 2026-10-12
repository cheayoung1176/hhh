"""Postgres 연결 풀 (psycopg 3 async).

중요한 규칙
 1) 풀의 연결은 autocommit=True 다. 쓰기가 여러 개 묶여야 하면 `async with conn.transaction():` 을 쓴다.
 2) 트랜잭션 블록 안에서 예외를 던지면 그 안의 변경이 전부 롤백된다.
    '실패 횟수 기록 후 에러 응답' 같은 경우엔 블록을 빠져나온 뒤에 raise 해야 한다. (auth_service.login_local 참고)
 3) 모든 SQL 은 파라미터 바인딩(%(name)s)만 쓴다. 문자열 포맷으로 SQL 을 만들지 않는다.
"""
from __future__ import annotations

from collections.abc import AsyncIterator

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import Settings

_pool: AsyncConnectionPool | None = None


async def init_pool(settings: Settings) -> None:
    global _pool
    _pool = AsyncConnectionPool(
        conninfo=settings.database_url,
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
        kwargs={
            "autocommit": True,
            "row_factory": dict_row,
            "prepare_threshold": None,  # Supabase pooler(transaction 모드) 호환
        },
        check=AsyncConnectionPool.check_connection,  # 풀러가 끊어버린 유휴 연결을 꺼내기 전에 걸러냄
        open=False,
    )
    await _pool.open(wait=True, timeout=20)


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("DB pool is not initialised")
    return _pool


async def get_conn() -> AsyncIterator[AsyncConnection]:
    """FastAPI 의존성. 한 요청 안에서는 같은 연결을 공유한다."""
    async with get_pool().connection() as conn:
        yield conn
