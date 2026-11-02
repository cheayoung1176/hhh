"""
Aether Doc Parser API (FastAPI)

  GET  /health   서버 상태 확인 (Render 슬립 깨우기에도 사용)
  POST /parse    PDF 1개 업로드 → 문서 정보 · 목차 · 청크(JSON)

환경 변수
  ALLOWED_ORIGINS       호출을 허용할 앱 주소, 쉼표로 구분 (기본: http://localhost:3000)
  ALLOWED_ORIGIN_REGEX  주소 패턴 허용 (예: https://.*\\.vercel\\.app  ← Vercel 미리보기 주소용)
  MAX_UPLOAD_MB         업로드 최대 용량 MB (기본: 50)
"""
import os

from fastapi import FastAPI, File, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from doc_parser import ParseError, process_pdf_bytes

MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX") or None

app = FastAPI(title="Aether Doc Parser", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def error(status: int, code: str, message: str) -> JSONResponse:
    """모든 오류는 같은 모양: {"error": {"code": ..., "message": ...}}"""
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


@app.get("/")
def root():
    return {"service": "Aether Doc Parser", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/parse")
async def parse(
    file: UploadFile = File(..., description="분석할 PDF 파일"),
    include_text: bool = Query(False, description="true면 추출한 전체 텍스트(full_text)도 함께 반환"),
):
    name = file.filename or "document.pdf"

    # 용량 제한: 끝까지 읽기 전에 초과하면 바로 중단
    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            return error(413, "too_large", f"파일 하나는 최대 {MAX_UPLOAD_MB}MB까지 올릴 수 있어요.")
    await file.close()

    if not data:
        return error(400, "empty_file", "빈 파일이에요.")
    if b"%PDF" not in data[:1024]:
        return error(415, "not_pdf", "PDF 파일만 분석할 수 있어요.")

    try:
        # PDF 처리는 CPU 작업이라 별도 스레드에서 실행 (서버가 다른 요청을 계속 받을 수 있게)
        return await run_in_threadpool(process_pdf_bytes, bytes(data), name, include_text)
    except ParseError as e:
        return error(e.status, e.code, e.message)
    except Exception:
        return error(500, "parse_failed", "문서를 분석하는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.")
