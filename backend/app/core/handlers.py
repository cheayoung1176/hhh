"""FastAPI 예외 핸들러 등록. 모든 에러를 errors.py 의 공통 모양으로 맞춘다."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.errors import AppError

log = logging.getLogger("app")

_GENERIC_VALIDATION_MESSAGE = "요청 형식이 올바르지 않습니다."


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(exc.to_body(), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = []
        first_custom: str | None = None
        for err in exc.errors():
            # 우리가 만든 검증기(ValueError)의 한국어 문구만 사용자에게 그대로 보여준다.
            msg = str(err.get("msg", ""))
            if err.get("type") == "value_error":
                msg = msg.removeprefix("Value error, ")
                first_custom = first_custom or msg
            else:
                msg = _GENERIC_VALIDATION_MESSAGE
            loc = [str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")]
            fields.append({"field": ".".join(loc), "message": msg})
        return JSONResponse(
            {
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": first_custom or _GENERIC_VALIDATION_MESSAGE,
                    "fields": fields,
                }
            },
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            {"error": {"code": f"HTTP_{exc.status_code}", "message": str(exc.detail)}},
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        # 요청 본문/비밀번호는 절대 로그에 남기지 않는다. 예외 정보만 기록.
        log.exception("unhandled error: %s", type(exc).__name__)
        return JSONResponse(
            {"error": {"code": "INTERNAL_ERROR", "message": "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."}},
            status_code=500,
        )
