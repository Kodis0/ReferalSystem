"""Тесты BrevoApiEmailBackend (HTTPS API вместо SMTP)."""

from unittest.mock import MagicMock, patch

from django.core.mail import EmailMultiAlternatives
from django.core.mail.message import EmailMessage
from django.test import SimpleTestCase, override_settings

from core.email_backends import BrevoApiEmailBackend, BrevoApiEmailBackendError


@override_settings(
    BREVO_API_KEY="secret-api-key",
    BREVO_API_URL="https://api.brevo.com/v3/smtp/email",
    EMAIL_TIMEOUT=10,
    DEFAULT_FROM_EMAIL="webmaster@localhost",
)
class BrevoApiEmailBackendTests(SimpleTestCase):
    def test_requests_post_sends_api_key_header(self):
        with patch("core.email_backends.requests.post") as post:
            post.return_value = MagicMock(status_code=201, text="{}")
            backend = BrevoApiEmailBackend(fail_silently=False)
            msg = EmailMessage(
                subject="S",
                body="Body text",
                from_email="Lumo Referral <noreply@lumoref.ru>",
                to=["dest@example.com"],
            )
            n = backend.send_messages([msg])
            self.assertEqual(n, 1)
            post.assert_called_once()
            headers = post.call_args.kwargs["headers"]
            self.assertEqual(headers["api-key"], "secret-api-key")
            self.assertEqual(headers["Content-Type"], "application/json")

    def test_sender_parsed_from_display_name(self):
        with patch("core.email_backends.requests.post") as post:
            post.return_value = MagicMock(status_code=201, text="{}")
            backend = BrevoApiEmailBackend(fail_silently=False)
            msg = EmailMessage(
                subject="Subj",
                body="Hi",
                from_email="Lumo Referral <noreply@lumoref.ru>",
                to=["a@b.com"],
            )
            backend.send_messages([msg])
            payload = post.call_args.kwargs["json"]
            self.assertEqual(payload["sender"]["email"], "noreply@lumoref.ru")
            self.assertEqual(payload["sender"]["name"], "Lumo Referral")

    def test_recipients_in_to(self):
        with patch("core.email_backends.requests.post") as post:
            post.return_value = MagicMock(status_code=201, text="{}")
            backend = BrevoApiEmailBackend(fail_silently=False)
            msg = EmailMessage(
                subject="X",
                body="y",
                from_email="noreply@lumoref.ru",
                to=["one@test.dev", "two@test.dev"],
            )
            backend.send_messages([msg])
            payload = post.call_args.kwargs["json"]
            self.assertEqual(
                payload["to"],
                [{"email": "one@test.dev"}, {"email": "two@test.dev"}],
            )

    def test_subject_and_text_content(self):
        with patch("core.email_backends.requests.post") as post:
            post.return_value = MagicMock(status_code=201, text="{}")
            backend = BrevoApiEmailBackend(fail_silently=False)
            msg = EmailMessage(
                subject="Тема",
                body="Текст письма",
                from_email="noreply@lumoref.ru",
                to=["u@example.com"],
            )
            backend.send_messages([msg])
            payload = post.call_args.kwargs["json"]
            self.assertEqual(payload["subject"], "Тема")
            self.assertEqual(payload["textContent"], "Текст письма")

    def test_html_alternative_in_payload(self):
        with patch("core.email_backends.requests.post") as post:
            post.return_value = MagicMock(status_code=201, text="{}")
            backend = BrevoApiEmailBackend(fail_silently=False)
            msg = EmailMultiAlternatives(
                subject="H",
                body="plain",
                from_email="noreply@lumoref.ru",
                to=["x@y.z"],
            )
            msg.attach_alternative("<p>HTML</p>", "text/html")
            backend.send_messages([msg])
            payload = post.call_args.kwargs["json"]
            self.assertEqual(payload["textContent"], "plain")
            self.assertEqual(payload["htmlContent"], "<p>HTML</p>")

    def test_http_201_returns_count_one(self):
        with patch("core.email_backends.requests.post") as post:
            post.return_value = MagicMock(status_code=201, text="{}")
            backend = BrevoApiEmailBackend(fail_silently=False)
            msg = EmailMessage(
                subject="S",
                body="B",
                from_email="noreply@lumoref.ru",
                to=["z@z.z"],
            )
            self.assertEqual(backend.send_messages([msg]), 1)

    def test_api_error_fail_silently_false_raises(self):
        with patch("core.email_backends.requests.post") as post:
            post.return_value = MagicMock(status_code=400, text='{"message":"bad"}')
            backend = BrevoApiEmailBackend(fail_silently=False)
            msg = EmailMessage(
                subject="S",
                body="B",
                from_email="noreply@lumoref.ru",
                to=["z@z.z"],
            )
            with self.assertRaises(BrevoApiEmailBackendError) as ctx:
                backend.send_messages([msg])
            self.assertEqual(ctx.exception.status_code, 400)
            self.assertIn("400", str(ctx.exception))

    def test_api_error_fail_silently_true_returns_zero(self):
        with (
            patch("core.email_backends.requests.post") as post,
            patch("core.email_backends.logger.warning"),
        ):
            post.return_value = MagicMock(status_code=502, text="Bad Gateway")
            backend = BrevoApiEmailBackend(fail_silently=True)
            msg = EmailMessage(
                subject="S",
                body="B",
                from_email="noreply@lumoref.ru",
                to=["z@z.z"],
            )
            self.assertEqual(backend.send_messages([msg]), 0)
