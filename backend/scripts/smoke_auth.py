"""서버가 떠 있을 때 인증 API 를 처음부터 끝까지 두드려보는 스모크 테스트 (표준 라이브러리만 사용).

    cd backend && uvicorn app.main:app --port 8000      # 터미널 1
    python scripts/smoke_auth.py http://localhost:8000   # 터미널 2

주의: 실제 DB 에 테스트 계정(smoke-xxxx@example.com)이 생긴다. 개발용 DB 에서만 실행할 것.
"""
import json
import sys
import urllib.error
import urllib.request
import uuid

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
passed = failed = 0


def call(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, (json.loads(raw) if raw else None)


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name}  {extra}")


def err_code(body):
    return (body or {}).get("error", {}).get("code")


email = f"smoke-{uuid.uuid4().hex[:8]}@example.com"
pw = "Passw0rd1"

s, b = call("GET", "/health")
check("GET /health", s == 200 and b == {"status": "ok"}, str((s, b)))
s, b = call("GET", "/health/db")
check("GET /health/db (DB 연결)", s == 200 and b.get("db") is True, str((s, b)))

s, b = call("POST", "/auth/signup", {"email": email, "password": "short"})
check("약한 비밀번호 → 422 + 한국어 문구", s == 422 and err_code(b) == "VALIDATION_ERROR" and "8자" in b["error"]["message"], str((s, b)))
s, b = call("POST", "/auth/signup", {"email": email, "password": pw, "display_name": "<script>alert(1)</script>"})
check("이름에 스크립트 → 422 (F-02-2 문구)", s == 422 and b["error"]["message"] == "유효하지 않은 문자열이 포함되어 있습니다", str((s, b)))

s, b = call("POST", "/auth/signup", {"email": email, "password": pw, "display_name": "스모크"})
check("가입 201", s == 201 and b["is_new_user"] and b["user"]["email"] == email, str((s, b)))
access, refresh = b["access_token"], b["refresh_token"]

s, b = call("POST", "/auth/signup", {"email": email.upper(), "password": pw})
check("중복 가입(대문자 이메일도) → 409", s == 409 and err_code(b) == "EMAIL_TAKEN", str((s, b)))

s, b = call("GET", "/auth/me")
check("토큰 없이 /me → 401", s == 401 and err_code(b) == "UNAUTHORIZED", str((s, b)))
s, b = call("GET", "/auth/me", token="garbage")
check("엉터리 토큰 → 401", s == 401, str((s, b)))
s, b = call("GET", "/auth/me", token=access)
check("/me 성공", s == 200 and b["email"] == email, str((s, b)))

s, b = call("POST", "/auth/refresh", {"refresh_token": refresh})
check("refresh 성공(회전)", s == 200 and b["refresh_token"] != refresh, str((s, b)))
new_refresh = b["refresh_token"]
s, b = call("POST", "/auth/refresh", {"refresh_token": refresh})
check("옛 refresh 재사용 → 401 SESSION_EXPIRED", s == 401 and err_code(b) == "SESSION_EXPIRED", str((s, b)))
s, b = call("POST", "/auth/refresh", {"refresh_token": new_refresh})
check("재사용 감지 후 새 refresh 도 폐기됨", s == 401, str((s, b)))

for i in range(4):
    s, b = call("POST", "/auth/login", {"email": email, "password": f"wrong{i}x"})
    check(f"틀린 비밀번호 {i + 1}회 → 401", s == 401 and err_code(b) == "INVALID_CREDENTIALS", str((s, b)))
s, b = call("POST", "/auth/login", {"email": email, "password": "wrong5xx"})
check(
    "5회째 → 423 잠금 모달 문구",
    s == 423 and b["error"]["just_locked"] is True and b["error"]["message"] == "로그인 시도가 5회 실패하여 계정이 5분간 잠깁니다.",
    str((s, b)),
)
s, b = call("POST", "/auth/login", {"email": email, "password": pw})
check("잠금 중엔 올바른 비밀번호도 423", s == 423 and b["error"]["just_locked"] is False, str((s, b)))
s, b = call("POST", "/auth/login", {"email": "nobody-here@example.com", "password": pw})
check("없는 계정 → 401 (잠금 신호 없음)", s == 401 and err_code(b) == "INVALID_CREDENTIALS", str((s, b)))

s, b = call("POST", "/auth/social", {"provider": "apple", "id_token": "x" * 30})
check("apple 은 지원하지 않음 → 422", s == 422, str((s, b)))
s, b = call("POST", "/auth/social", {"provider": "google", "id_token": "x" * 30})
check("가짜 구글 토큰 → 401/503 (GOOGLE_CLIENT_ID 설정에 따라)", s in (401, 503), str((s, b)))

s, _ = call("POST", "/auth/logout", {"refresh_token": "z" * 60})
check("모르는 토큰 logout → 204", s == 204)

print(f"\n== smoke: {passed} passed, {failed} failed ==")
print("(5분 잠금 해제 후 정상 로그인은 자동화하지 않음: 필요하면 DB 에서 locked_until 을 과거로 바꿔서 확인)")
sys.exit(1 if failed else 0)
