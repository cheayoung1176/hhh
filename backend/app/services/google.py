"""Google ID 토큰 검증 (F-01).

프론트가 Google Identity Services 로 받은 credential(ID 토큰)을 보내면,
서버가 서명·audience·만료를 검증하고 sub/email 을 꺼낸다.
google-auth 의 검증은 동기(네트워크로 인증서 조회)라서 호출하는 쪽에서 threadpool 로 실행한다.
"""
from __future__ import annotations

import logging

from app.core.errors import AppError

log = logging.getLogger("app.google")

_AUTH_FAILED = "구글 로그인에 실패했습니다. 다시 시도해 주세요."


def verify_google_id_token(token: str, client_id: str) -> dict[str, str | None]:
    if not client_id:
        raise AppError(503, "GOOGLE_NOT_CONFIGURED", "구글 로그인이 아직 설정되지 않았습니다.")

    # 무거운 import 는 실제로 쓸 때만 (앱 시작 시간 단축, 테스트에서 불필요한 의존 방지)
    from google.auth import exceptions as g_exceptions
    from google.auth.transport import requests as g_requests
    from google.oauth2 import id_token as g_id_token

    try:
        claims = g_id_token.verify_oauth2_token(token, g_requests.Request(), client_id)
    except g_exceptions.TransportError as e:
        log.warning("google certs fetch failed: %s", type(e).__name__)
        raise AppError(503, "SOCIAL_AUTH_UNAVAILABLE", "구글 인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.") from e
    except ValueError as e:  # 서명/aud/iss/exp 불일치
        raise AppError(401, "SOCIAL_AUTH_FAILED", _AUTH_FAILED) from e

    if not claims.get("sub") or not claims.get("email") or not claims.get("email_verified"):
        raise AppError(401, "SOCIAL_AUTH_FAILED", _AUTH_FAILED)

    return {
        "sub": str(claims["sub"]),
        "email": str(claims["email"]),
        "name": claims.get("name"),
        "picture": claims.get("picture"),
    }
