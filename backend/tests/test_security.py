"""순수 보안 로직 단위 테스트 (DB·네트워크 불필요).  실행: cd backend && pytest -q"""
import time
import unittest
from datetime import datetime, timedelta, timezone

import jwt

from app.core import security as sec

SECRET = "x" * 48
ISS = "aether-doc-ai"


class PasswordHash(unittest.TestCase):
    def test_roundtrip(self):
        h = sec.hash_password("Passw0rd!한글")
        self.assertTrue(h.startswith("scrypt$"))
        self.assertTrue(sec.verify_password("Passw0rd!한글", h))
        self.assertFalse(sec.verify_password("passw0rd!한글", h))

    def test_salt_is_random(self):
        self.assertNotEqual(sec.hash_password("same1234"), sec.hash_password("same1234"))

    def test_plaintext_not_in_hash(self):
        self.assertNotIn("Passw0rd", sec.hash_password("Passw0rd1"))

    def test_malformed_hash_is_false_not_exception(self):
        for bad in ["", "x", "scrypt$1$2", "bcrypt$a$b$c$d$e", "scrypt$abc$8$1$AA$AA", "scrypt$32768$8$1$!!$!!"]:
            self.assertFalse(sec.verify_password("pw", bad), bad)

    def test_absurd_cost_params_rejected(self):
        # 변조된 DB 값으로 서버 메모리를 고갈시키지 못해야 한다
        self.assertFalse(sec.verify_password("pw", "scrypt$1073741824$8$1$AAAA$AAAA"))

    def test_dummy_hash_is_valid_and_cached(self):
        d = sec.dummy_password_hash()
        self.assertIs(d, sec.dummy_password_hash())
        self.assertFalse(sec.verify_password("anything", d))


class AccessToken(unittest.TestCase):
    def mk(self, **kw):
        return sec.create_access_token("user-1", secret=SECRET, issuer=ISS, ttl_minutes=15, **kw)

    def test_roundtrip(self):
        self.assertEqual(sec.decode_access_token(self.mk(), secret=SECRET, issuer=ISS), "user-1")

    def test_expired(self):
        old = datetime.now(timezone.utc) - timedelta(minutes=30)
        with self.assertRaises(sec.TokenError):
            sec.decode_access_token(self.mk(now=old), secret=SECRET, issuer=ISS)

    def test_wrong_secret_issuer(self):
        with self.assertRaises(sec.TokenError):
            sec.decode_access_token(self.mk(), secret="y" * 48, issuer=ISS)
        with self.assertRaises(sec.TokenError):
            sec.decode_access_token(self.mk(), secret=SECRET, issuer="other")

    def test_alg_none_rejected(self):
        now = int(time.time())
        forged = jwt.encode(
            {"sub": "admin", "iss": ISS, "iat": now, "exp": now + 600, "typ": "access"}, key=None, algorithm="none"
        )
        with self.assertRaises(sec.TokenError):
            sec.decode_access_token(forged, secret=SECRET, issuer=ISS)

    def test_other_token_type_rejected(self):
        now = int(time.time())
        t = jwt.encode({"sub": "u", "iss": ISS, "iat": now, "exp": now + 600, "typ": "refresh"}, SECRET, "HS256")
        with self.assertRaises(sec.TokenError):
            sec.decode_access_token(t, secret=SECRET, issuer=ISS)

    def test_missing_claims_rejected(self):
        t = jwt.encode({"sub": "u"}, SECRET, "HS256")
        with self.assertRaises(sec.TokenError):
            sec.decode_access_token(t, secret=SECRET, issuer=ISS)

    def test_garbage(self):
        for bad in ["", "abc", "a.b.c"]:
            with self.assertRaises(sec.TokenError):
                sec.decode_access_token(bad, secret=SECRET, issuer=ISS)


class RefreshToken(unittest.TestCase):
    def test_hash_matches_and_is_not_raw(self):
        raw, h = sec.new_refresh_token()
        self.assertEqual(h, sec.hash_refresh_token(raw))
        self.assertNotIn(raw, h)
        self.assertEqual(len(h), 64)
        self.assertGreaterEqual(len(raw), 60)

    def test_unique(self):
        self.assertNotEqual(sec.new_refresh_token()[0], sec.new_refresh_token()[0])


class Validation(unittest.TestCase):
    def test_email_normalized(self):
        self.assertEqual(sec.normalize_email("  Foo.Bar+x@Example.COM "), "foo.bar+x@example.com")

    def test_email_rejected(self):
        for bad in ["", "a", "a@b", "a@@b.com", "a b@c.com", "@c.com", "a@.com", "a@c.", "a@c.c", "x" * 250 + "@a.com"]:
            with self.assertRaises(ValueError, msg=bad):
                sec.normalize_email(bad)

    def test_password_policy(self):
        self.assertEqual(sec.validate_password_policy("abcd1234"), "abcd1234")
        for bad in ["abc123", "abcdefgh", "12345678", "", "a1" * 65]:  # 짧음 / 숫자없음 / 영문없음 / 빈값 / 130자
            with self.assertRaises(ValueError, msg=bad):
                sec.validate_password_policy(bad)

    def test_script_patterns_blocked(self):
        for bad in [
            "<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "< script>", "</div>", "<!--x-->",
            "javascript:alert(1)", "JaVaScRiPt :x", "data:text/html,<b>", "x onclick=evil()", "a\x00b",
        ]:
            with self.assertRaises(ValueError, msg=bad) as cm:
                sec.reject_script_patterns(bad)
            self.assertEqual(str(cm.exception), "유효하지 않은 문자열이 포함되어 있습니다")

    def test_normal_text_allowed(self):
        for ok in ["홍길동", "Kim O'Brien", "a < 3 and 5 > 2", "3<5", "R&D 팀", "100% 확실", "online shop", "Bob (QA)"]:
            self.assertEqual(sec.reject_script_patterns(ok), ok)

    def test_safe_display_name_fallbacks(self):
        self.assertEqual(sec.safe_display_name("홍길동", "x"), "홍길동")
        self.assertEqual(sec.safe_display_name("<script>x", "kim"), "kim")
        self.assertEqual(sec.safe_display_name(None, "kim"), "kim")
        self.assertEqual(sec.safe_display_name("  ", "kim"), "kim")
        self.assertEqual(sec.safe_display_name("<b>", "<i>"), "user")
        self.assertEqual(len(sec.safe_display_name("가" * 80, "x")), 50)


if __name__ == "__main__":
    unittest.main()
