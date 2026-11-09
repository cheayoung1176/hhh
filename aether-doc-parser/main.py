"""
Aether Doc AI — API 서버 (FastAPI)
엔드포인트는 기능명세서 Rev.3 의 5.1.4 API 목록을 따른다. 규칙은 service.py 에 있다.

실행:  uvicorn main:app --reload        →  http://localhost:8000/docs 에서 직접 시험

로그인 토큰: 모든 문서·대화 API 는  Authorization: Bearer <access_token>  이 필요하다.
  개발 중(로그인 화면을 만들기 전)에는 .env 에 AUTH_DEV_BYPASS=1 과 DEV_USER_ID 를 넣으면
  토큰 없이 그 사용자로 동작한다. ⚠️ 배포할 때는 반드시 지울 것.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import BackgroundTasks, Depends, FastAPI, File, Header, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

import ai
from doc_parser import ParseError, process_pdf_bytes
from service import MAX_UPLOAD_BYTES, AppError, Service
from supa import SupaError, SupabaseRepo

load_dotenv()

ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX") or None
DEV_BYPASS = os.getenv("AUTH_DEV_BYPASS") == "1" and bool(os.getenv("DEV_USER_ID"))
if DEV_BYPASS:
    import re as _re
    _uid = os.getenv("DEV_USER_ID", "").strip()
    if not _re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", _uid):
        raise RuntimeError(f".env 의 DEV_USER_ID 는 xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx 모양의 User UID 여야 해요. "
                           f"지금 값의 앞부분: '{_uid[:12]}…' (SUPABASE_URL 과 자리가 바뀌지 않았는지 확인해 주세요)")
    os.environ["DEV_USER_ID"] = _uid
    print("⚠️  AUTH_DEV_BYPASS=1: 토큰 없이 개발용 사용자로 동작합니다. 배포할 때는 지우세요.")

app = FastAPI(title="Aether Doc AI API", version="1.0.0",
              description="기능명세서 Rev.3 5.1.4 API 목록 구현 (F-01 ~ F-12)")
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_origin_regex=ALLOWED_ORIGIN_REGEX,
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["*"])

_service: Service | None = None

try:  # 서버가 켜질 때 .env 의 Supabase 설정을 미리 검사해서 알려준다
    SupabaseRepo()
except RuntimeError as _e:
    print(f"\n❌ Supabase 설정 오류: {_e}\n")


def svc() -> Service:
    global _service
    if _service is None:
        _service = Service(SupabaseRepo())
    return _service


# ---------------------------------------------------------------- 오류 응답: 모두 {"error": {code, message, ...}}
def error(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message, **extra}})


@app.exception_handler(AppError)
async def app_error(_: Request, e: AppError):
    return error(e.status, e.code, e.message, **e.extra)


@app.exception_handler(SupaError)
async def supa_error(_: Request, e: SupaError):
    print(e)
    return error(502, "storage_error", "저장소 연결에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.")


@app.exception_handler(ai.AIError)
async def ai_error(_: Request, e: ai.AIError):
    return error(503, e.code, e.message)


@app.exception_handler(Exception)
async def unexpected_error(_: Request, e: Exception):
    import traceback
    traceback.print_exception(e)  # 서버 터미널에 전체 기록
    return error(500, "server_error", "서버에서 예상하지 못한 문제가 생겼어요.", detail=f"{type(e).__name__}: {str(e)[:200]}")


# ---------------------------------------------------------------- 로그인 사용자 확인 (5.1.5 소유자 기준 접근 제어)
def current_user(authorization: str | None = Header(None), access_token: str | None = Query(None)) -> str:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    token = token or access_token  # 상태 SSE 처럼 헤더를 못 붙이는 경우를 위해 ?access_token= 도 허용
    if not token and DEV_BYPASS:
        return os.environ["DEV_USER_ID"]
    return svc().verify_token(token)


def sse_response(gen) -> StreamingResponse:
    return StreamingResponse(gen, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- 기본
@app.get("/")
def root():
    return {"service": "Aether Doc AI API", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    return {"status": "ok", "dev_bypass": DEV_BYPASS}


# ================================================================ 인증 (F-01 ~ F-02-1)
class EmailPassword(BaseModel):
    email: str
    password: str


class Refresh(BaseModel):
    refresh_token: str


class Social(BaseModel):
    provider: str = "google"
    id_token: str
    nonce: str | None = None


class Recover(BaseModel):
    email: str
    redirect_to: str | None = None


@app.post("/auth/signup", tags=["인증"], summary="F-01-1 이메일 회원가입")
def signup(body: EmailPassword):
    return svc().signup(body.email, body.password)


@app.post("/auth/login", tags=["인증"], summary="F-01-1 이메일 로그인 (F-02-1 5회 실패 시 5분 잠금)")
def login(body: EmailPassword):
    return svc().login(body.email, body.password)


@app.post("/auth/refresh", tags=["인증"], summary="F-02 세션 유지 (Refresh Token → 새 토큰)")
def refresh(body: Refresh):
    return svc().refresh(body.refresh_token)


@app.post("/auth/social", tags=["인증"], summary="F-01 소셜 로그인 (Google id_token)")
def social(body: Social):
    return svc().social(body.provider, body.id_token, body.nonce)


@app.post("/auth/recover", tags=["인증"], summary="F-01-1 비밀번호 찾기 (재설정 메일 발송)")
def recover(body: Recover):
    return svc().recover(body.email, body.redirect_to)


class Reset(BaseModel):
    access_token: str
    password: str


@app.post("/auth/reset", tags=["인증"], summary="F-01-1 새 비밀번호 설정 (재설정 메일의 링크 토큰)")
def reset(body: Reset):
    return svc().reset_password(body.access_token, body.password)


# ================================================================ 문서 (F-03 ~ F-07)
@app.post("/documents", tags=["문서"], status_code=201, summary="F-03 PDF 업로드 → 백그라운드 분석 시작")
async def upload(background: BackgroundTasks, file: UploadFile = File(...), user: str = Depends(current_user)):
    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        data.extend(chunk)
        if len(data) > MAX_UPLOAD_BYTES:
            return error(413, "too_large", "파일 하나는 최대 50MB까지 업로드할 수 있습니다.")
    doc = await run_in_threadpool(svc().create_document, user, file.filename or "document.pdf", bytes(data))
    background.add_task(svc().analyze, doc["doc_id"], user)
    return doc


@app.get("/documents", tags=["문서"], summary="F-05·F-06 문서 목록 (sort: latest | name | size)")
def list_documents(sort: str = Query("latest"), user: str = Depends(current_user)):
    return {"documents": svc().list_documents(user, sort)}


@app.get("/documents/{doc_id}", tags=["문서"], summary="상세페이지 메타데이터 + 원문 PDF 주소 (F-05-1)")
def get_document(doc_id: str, user: str = Depends(current_user)):
    return svc().get_document(doc_id, user)


@app.get("/documents/{doc_id}/status", tags=["문서"], summary="F-05 분석 상태 (한 번 조회)")
def status(doc_id: str, user: str = Depends(current_user)):
    return svc().status(doc_id, user)


@app.get("/documents/{doc_id}/events", tags=["문서"], summary="F-04-1·F-05 분석 상태 실시간 (SSE)")
def events(doc_id: str, user: str = Depends(current_user)):
    svc().status(doc_id, user)  # 없는 문서면 스트림을 열기 전에 404
    return sse_response(svc().status_events(doc_id, user))


class Rename(BaseModel):
    title: str


@app.patch("/documents/{doc_id}", tags=["문서"], summary="F-06-1 이름변경")
def rename(doc_id: str, body: Rename, user: str = Depends(current_user)):
    return svc().rename(doc_id, user, body.title)


@app.delete("/documents/{doc_id}", tags=["문서"], status_code=204, summary="F-06-1 삭제 (원본·임베딩·대화 전체 파기)")
def delete(doc_id: str, user: str = Depends(current_user)):
    svc().delete(doc_id, user)


@app.post("/documents/{doc_id}/reanalyze", tags=["문서"], summary="F-05-1 재분석 시도 (재업로드 없음)")
def reanalyze(doc_id: str, background: BackgroundTasks, user: str = Depends(current_user)):
    doc = svc().reanalyze(doc_id, user)
    background.add_task(svc().analyze, doc_id, user)
    return doc


# ================================================================ 분석 결과 (F-10)
@app.get("/documents/{doc_id}/summary", tags=["분석 결과"], summary="F-10 [요약]")
def summary(doc_id: str, user: str = Depends(current_user)):
    return svc().summary(doc_id, user)


@app.get("/documents/{doc_id}/toc", tags=["분석 결과"], summary="F-10 [목차]")
def toc(doc_id: str, user: str = Depends(current_user)):
    return svc().toc(doc_id, user)


@app.get("/documents/{doc_id}/keywords", tags=["분석 결과"], summary="F-10·F-11 [키워드]")
def keywords(doc_id: str, user: str = Depends(current_user)):
    return svc().keywords(doc_id, user)


# ================================================================ 대화 (F-08, F-09, F-12)
@app.post("/documents/{doc_id}/sessions", tags=["대화"], status_code=201, summary="대화 세션 시작")
def create_session(doc_id: str, user: str = Depends(current_user)):
    return svc().create_session(doc_id, user)


@app.get("/documents/{doc_id}/sessions", tags=["대화"], summary="F-12 문서별 대화 세션 목록")
def list_sessions(doc_id: str, user: str = Depends(current_user)):
    return {"sessions": svc().list_sessions(doc_id, user)}


@app.get("/sessions/{session_id}/messages", tags=["대화"], summary="F-12 과거 대화 열람 (읽기 전용)")
def get_messages(session_id: str, user: str = Depends(current_user)):
    return svc().messages(session_id, user)


class Ask(BaseModel):
    content: str


@app.post("/sessions/{session_id}/messages", tags=["대화"],
          summary="F-08 질문 → 답변 스트리밍 (SSE), 마지막 이벤트에 F-09 출처 좌표")
def ask(session_id: str, body: Ask, user: str = Depends(current_user)):
    ctx = svc().prepare_chat(session_id, user, body.content)  # 검사 실패는 스트림을 열기 전에 JSON 오류로
    return sse_response(svc().stream_chat(ctx))


# ================================================================ 개발용: 파서만 시험 (DB 없이)
@app.post("/parse", tags=["개발용"], summary="PDF 파싱·청킹 결과만 보기 (저장하지 않음)")
async def parse(file: UploadFile = File(...), include_text: bool = Query(False)):
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        return error(413, "too_large", "파일 하나는 최대 50MB까지 업로드할 수 있습니다.")
    if b"%PDF" not in data[:1024]:
        return error(415, "not_pdf", "PDF 파일만 업로드할 수 있습니다.")
    try:
        return await run_in_threadpool(process_pdf_bytes, data, file.filename or "document.pdf", include_text)
    except ParseError as e:
        return error(e.status, e.code, e.message)
