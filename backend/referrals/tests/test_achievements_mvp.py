"""Achievement XP idempotency tests for ``_award_achievement_xp`` (merge package scope)."""

from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase

from referrals.achievement_service import _award_achievement_xp
from referrals.models import GamificationProfile, XPEvent

User = get_user_model()


class AchievementXpAwardIdempotencyTests(TestCase):
    """``_award_achievement_xp``: duplicate XPEvent insert must not surface as 500 or double XP."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="xp_idem",
            email="xp_idem@example.com",
            password="secret12",
        )

    def test_second_award_returns_zero_no_double_xp_one_xpevent(self):
        first = _award_achievement_xp(self.user, "TEST_IDEM_CODE", 42)
        self.assertEqual(first, 42)
        second = _award_achievement_xp(self.user, "TEST_IDEM_CODE", 42)
        self.assertEqual(second, 0)
        idem = f"achievement:{self.user.pk}:TEST_IDEM_CODE"
        self.assertEqual(XPEvent.objects.filter(idempotency_key=idem).count(), 1)
        self.assertEqual(GamificationProfile.objects.get(user=self.user).xp_total, 42)

    def test_award_returns_zero_when_xpevent_with_idempotency_key_already_exists(self):
        """Duplicate key path: row visible after failed insert → idempotent no-op."""
        idem = f"achievement:{self.user.pk}:PREEXIST"
        XPEvent.objects.create(
            user=self.user,
            source=XPEvent.Source.ACHIEVEMENT,
            amount=10,
            base_amount=10,
            multiplier=Decimal("1.0000"),
            idempotency_key=idem,
            metadata_json={"achievement_code": "PREEXIST"},
        )
        out = _award_achievement_xp(self.user, "PREEXIST", 10)
        self.assertEqual(out, 0)
        self.assertEqual(XPEvent.objects.filter(idempotency_key=idem).count(), 1)

    @mock.patch.object(XPEvent.objects, "create", side_effect=IntegrityError("other_constraint"))
    def test_integrity_error_without_matching_row_reraises(self, _mock):
        GamificationProfile.objects.create(user=self.user, xp_total=0)
        with self.assertRaises(IntegrityError):
            _award_achievement_xp(self.user, "RAISE_CODE", 50)
        self.assertFalse(
            XPEvent.objects.filter(
                idempotency_key=f"achievement:{self.user.pk}:RAISE_CODE",
            ).exists()
        )
        self.assertEqual(GamificationProfile.objects.get(user=self.user).xp_total, 0)
