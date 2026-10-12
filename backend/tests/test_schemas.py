"""요청 스키마 검증 단위 테스트 (DB 불필요)."""
import unittest

from pydantic import ValidationError

from app.schemas.auth import LoginRequest, SignupRequest, SocialLoginRequest


def first_msg(exc: ValidationError) -> str:
    return exc.errors()[0]["msg"].removeprefix("Value error, ")


class SignupSchema(unittest.TestCase):
    def test_ok_and_email_normalized(self):
        r = SignupRequest(email=" A@B.com ", password="abcd1234", display_name="홍길동")
        self.assertEqual(r.email, "a@b.com")

    def test_display_name_optional(self):
        self.assertIsNone(SignupRequest(email="a@b.com", password="abcd1234").display_name)

    def test_weak_password_message(self):
        with self.assertRaises(ValidationError) as cm:
            SignupRequest(email="a@b.com", password="short1")
        self.assertEqual(first_msg(cm.exception), "비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.")

    def test_script_in_name_rejected_with_spec_message(self):
        with self.assertRaises(ValidationError) as cm:
            SignupRequest(email="a@b.com", password="abcd1234", display_name="<script>alert(1)</script>")
        self.assertEqual(first_msg(cm.exception), "유효하지 않은 문자열이 포함되어 있습니다")

    def test_empty_and_long_name_rejected(self):
        for name in ["", "가" * 51]:
            with self.assertRaises(ValidationError):
                SignupRequest(email="a@b.com", password="abcd1234", display_name=name)

    def test_password_may_contain_angle_brackets(self):
        # 비밀번호는 화면에 출력되지 않고 해시로만 쓰이므로 스크립트 패턴 검사를 하지 않는다
        self.assertEqual(SignupRequest(email="a@b.com", password="<b>abc1234").password, "<b>abc1234")


class LoginSchema(unittest.TestCase):
    def test_login_does_not_enforce_signup_policy(self):
        self.assertEqual(LoginRequest(email="a@b.com", password="x").password, "x")

    def test_login_password_bounds(self):
        for pw in ["", "a" * 129]:
            with self.assertRaises(ValidationError):
                LoginRequest(email="a@b.com", password=pw)

    def test_bad_email(self):
        with self.assertRaises(ValidationError) as cm:
            LoginRequest(email="nope", password="x")
        self.assertEqual(first_msg(cm.exception), "올바른 이메일 형식이 아닙니다.")


class SocialSchema(unittest.TestCase):
    def test_only_google(self):
        SocialLoginRequest(provider="google", id_token="a" * 30)
        with self.assertRaises(ValidationError):
            SocialLoginRequest(provider="apple", id_token="a" * 30)

    def test_token_bounds(self):
        with self.assertRaises(ValidationError):
            SocialLoginRequest(provider="google", id_token="short")


if __name__ == "__main__":
    unittest.main()
