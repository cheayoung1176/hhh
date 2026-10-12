"""Postgres 기반 작업 큐 (F-04-1 '고정 타임아웃 없는 백그라운드 분석').

이 파일이 큐 구현의 유일한 접점이다. 나중에 Redis/Celery 가 필요해지면 이 파일의 함수 시그니처를 유지한 채
내부만 바꾸면 된다 (호출하는 쪽은 enqueue / dequeue / heartbeat / complete / fail 만 안다).

사용 규칙
 - `conn` 은 autocommit 연결(app.core.db 풀의 기본값). 각 함수는 SQL 1문장이라 원자적이다.
 - API 서버: 업로드/재분석 때 `enqueue()`  (재분석 F-05-1 = documents.status 를 progress 로 되돌리고 enqueue)
 - 워커 프로세스: 루프에서 `reap_stale()` → `dequeue()` → 처리하면서 주기적으로 `heartbeat()` → `complete()` / `fail()`
 - 워커가 죽으면 heartbeat 가 멈춘다 → stale_seconds 뒤 다른 워커가 같은 job 을 다시 가져간다 (최대 max_attempts 회)
 - fail() 이 'failed' 를 돌려주면(재시도 소진) 호출자가 documents.status = 'fail', fail_reason 을 기록해야 한다.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

if TYPE_CHECKING:
    from psycopg import AsyncConnection

DEFAULT_STALE_SECONDS = 300  # 이 시간 동안 heartbeat 가 없으면 워커 사망으로 간주
RETRY_BASE_SECONDS = 30  # 재시도 대기: 30초, 60초, 120초 ...

SQL_ENQUEUE = """
INSERT INTO jobs (doc_id, kind)
VALUES (%(doc_id)s, %(kind)s)
ON CONFLICT (doc_id, kind) WHERE status IN ('queued', 'running') DO NOTHING
RETURNING job_id
"""

# SKIP LOCKED: 워커가 여러 개여도 같은 job 을 중복으로 가져가지 않는다.
SQL_DEQUEUE = """
WITH next AS (
    SELECT job_id FROM jobs
    WHERE (status = 'queued' AND run_after <= now())
       OR (status = 'running' AND attempts < max_attempts
           AND locked_at < now() - make_interval(secs => %(stale_seconds)s::int))
    ORDER BY run_after, created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
UPDATE jobs j
SET status = 'running', attempts = j.attempts + 1, locked_at = now()
FROM next
WHERE j.job_id = next.job_id
RETURNING j.job_id, j.doc_id, j.kind, j.attempts, j.max_attempts
"""

# 시도 횟수를 다 쓰고도 heartbeat 가 끊긴 job → failed 처리하고 문서를 알려준다
SQL_REAP_STALE = """
UPDATE jobs
SET status = 'failed', locked_at = NULL,
    last_error = COALESCE(last_error, 'worker stopped responding')
WHERE status = 'running' AND attempts >= max_attempts
  AND locked_at < now() - make_interval(secs => %(stale_seconds)s::int)
RETURNING job_id, doc_id
"""

SQL_HEARTBEAT = "UPDATE jobs SET locked_at = now() WHERE job_id = %(job_id)s AND status = 'running'"
SQL_COMPLETE = "UPDATE jobs SET status = 'done', locked_at = NULL WHERE job_id = %(job_id)s AND status = 'running'"
SQL_FAIL = """
UPDATE jobs
SET status = %(status)s::job_status,
    run_after = now() + make_interval(secs => %(delay)s::int),
    locked_at = NULL,
    last_error = %(error)s
WHERE job_id = %(job_id)s AND status = 'running'
RETURNING status
"""


async def enqueue(conn: AsyncConnection, doc_id: UUID | str, kind: str = "analyze") -> UUID | None:
    """job 을 넣는다. 같은 문서에 이미 대기/실행 중인 job 이 있으면 None (재분석 버튼 연타 방지)."""
    cur = await conn.execute(SQL_ENQUEUE, {"doc_id": doc_id, "kind": kind})
    row = await cur.fetchone()
    return row["job_id"] if row else None


async def dequeue(conn: AsyncConnection, stale_seconds: int = DEFAULT_STALE_SECONDS) -> dict[str, Any] | None:
    """처리할 job 하나를 가져와 running 으로 표시한다. 없으면 None."""
    cur = await conn.execute(SQL_DEQUEUE, {"stale_seconds": stale_seconds})
    return await cur.fetchone()


async def reap_stale(conn: AsyncConnection, stale_seconds: int = DEFAULT_STALE_SECONDS) -> list[dict[str, Any]]:
    """재시도를 다 쓴 죽은 job 을 failed 로 정리. 반환된 doc_id 의 documents.status 를 'fail' 로 바꿔야 한다."""
    cur = await conn.execute(SQL_REAP_STALE, {"stale_seconds": stale_seconds})
    return await cur.fetchall()


async def heartbeat(conn: AsyncConnection, job_id: UUID | str) -> None:
    await conn.execute(SQL_HEARTBEAT, {"job_id": job_id})


async def complete(conn: AsyncConnection, job_id: UUID | str) -> None:
    await conn.execute(SQL_COMPLETE, {"job_id": job_id})


async def fail(
    conn: AsyncConnection, job: dict[str, Any], error: str, *, retry: bool = True
) -> str:
    """실패 기록. 재시도 여지가 있으면 backoff 후 'queued', 아니면 'failed' 를 돌려준다.

    retry=False 는 재시도해도 소용없는 실패(예: 글자 없는 스캔본 PDF)에 쓴다.
    'failed' 가 반환되면 호출자가 documents.status = 'fail' 로 바꿔야 한다.
    """
    will_retry = retry and job["attempts"] < job["max_attempts"]
    delay = RETRY_BASE_SECONDS * 2 ** (job["attempts"] - 1) if will_retry else 0
    cur = await conn.execute(
        SQL_FAIL,
        {
            "job_id": job["job_id"],
            "status": "queued" if will_retry else "failed",
            "delay": delay,
            "error": error[:2000],
        },
    )
    row = await cur.fetchone()
    return str(row["status"]) if row else "failed"
