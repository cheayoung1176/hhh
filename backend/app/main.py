"""FastAPI 앱 진입점.  실행:  cd backend && uvicorn app.main:app --reload --port 8000"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from app.api import auth
from app.core.db import close_pool, get_pool, init_pool
from app.core.deps import get_settings
from app.core.handlers import register_error_handlers
from app.core.security import dummy_password_hash


@asynccontextmanager
async def lifespan(_: FastAPI):
    await run_in_threadpool(dummy_password_hash)  # 첫 '없는 계정' 로그인이 느려서 존재 여부가 드러나는 것을 방지
    await init_pool(get_settings())
    yield
    await close_pool()


def create_app() -> FastAPI:
    settings = get_settings()
    is_dev = settings.app_env == "dev"
    app = FastAPI(
        title="Aether Doc AI API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if is_dev else None,  # 운영에서는 API 문서 비공개
        redoc_url=None,
        openapi_url="/openapi.json" if is_dev else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,  # 토큰은 Authorization 헤더로 보낸다 (쿠키 미사용)
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    register_error_handlers(app)
    app.include_router(auth.router)

    @app.get("/health", tags=["health"])
    async def health():
        return {"status": "ok"}

    @app.get("/health/db", tags=["health"])
    async def health_db():
        async with get_pool().connection() as conn:
            cur = await conn.execute("SELECT 1 AS ok")
            row = await cur.fetchone()
        return {"status": "ok", "db": row["ok"] == 1}

    return app


app = create_app()
