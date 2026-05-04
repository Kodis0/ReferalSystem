import uuid
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from referrals.gamification import (
    calculate_daily_challenge_base_xp,
    calculate_level,
    calculate_referral_league_id,
    get_streak_multiplier,
    grant_purchase_xp_for_paid_referral_order,
    local_today,
    xp_threshold_for_level,
)
from referrals.gamification_game import replay_daily_challenge
from referrals.models import DailyChallengeAttempt, GamificationProfile, Order, XPEvent
from referrals.services import ensure_partner_profile
from referrals.tests.gamification_autoplay import greedy_moves_until_game_over

User = get_user_model()


class GamificationApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="gamer",
            email="gamer@example.com",
            password="secret12",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _start_and_autoplay_payload(self, *, client_score=None, moves_override=None):
        r = self.client.post("/referrals/gamification/daily-challenge/start/")
        self.assertEqual(r.status_code, 200)
        summ = r.json()
        aa = summ["active_attempt"]
        self.assertIsNotNone(aa)
        aid = aa["attempt_public_id"]
        seed = int(aa["rng_seed"])
        moves = greedy_moves_until_game_over(seed) if moves_override is None else moves_override
        server_score, err = replay_daily_challenge(seed, moves)
        self.assertEqual(err, "")
        cs = server_score if client_score is None else client_score
        return (
            {
                "attempt_id": aid,
                "moves": moves,
                "client_score": cs,
            },
            server_score,
        )

    def test_summary_creates_profile(self):
        self.assertFalse(GamificationProfile.objects.filter(user=self.user).exists())
        r = self.client.get("/referrals/gamification/summary/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(GamificationProfile.objects.filter(user=self.user).exists())
        body = r.json()
        self.assertEqual(body["profile"]["xp_total"], 0)
        self.assertEqual(body["profile"]["streak_days"], 0)
        self.assertEqual(body["lives"]["current"], 5)
        self.assertEqual(body["lives"]["max"], 5)
        self.assertIn("daily_challenge_xp_tiers", body)
        self.assertIn("streak_multiplier_tiers", body)

    def test_summary_profile_league_id_start_without_sales(self):
        r = self.client.get("/referrals/gamification/summary/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["profile"]["league_id"], "start")

    def test_summary_profile_league_id_silver_when_sales_level_streak_gates_met(self):
        partner, _ = ensure_partner_profile(self.user)
        GamificationProfile.objects.update_or_create(
            user=self.user,
            defaults={"xp_total": 3000, "streak_days": 8},
        )
        now = timezone.now()
        Order.objects.create(
            dedupe_key=f"t:sum-lg-{uuid.uuid4().hex}",
            source=Order.Source.TILDA,
            external_id=f"ext-{uuid.uuid4().hex[:8]}",
            payload_fingerprint=uuid.uuid4().hex[:64],
            partner=partner,
            amount=Decimal("80000.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )
        self.assertEqual(calculate_level(3000), 5)
        self.assertEqual(calculate_referral_league_id(80000, 5, 8), "silver")
        r = self.client.get("/referrals/gamification/summary/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["profile"]["league_id"], "silver")
        self.assertEqual(body["referral_sales_rub"], 80000)

    def test_summary_profile_league_id_start_when_level_below_gate_despite_sales(self):
        partner, _ = ensure_partner_profile(self.user)
        GamificationProfile.objects.update_or_create(
            user=self.user,
            defaults={"xp_total": 0, "streak_days": 100},
        )
        now = timezone.now()
        Order.objects.create(
            dedupe_key=f"t:sum-lg-{uuid.uuid4().hex}",
            source=Order.Source.TILDA,
            external_id=f"ext-{uuid.uuid4().hex[:8]}",
            payload_fingerprint=uuid.uuid4().hex[:64],
            partner=partner,
            amount=Decimal("80000.00"),
            currency="RUB",
            status=Order.Status.PAID,
            paid_at=now,
        )
        r = self.client.get("/referrals/gamification/summary/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["profile"]["league_id"], "start")

    @patch("referrals.gamification.local_today", return_value=date(2026, 5, 10))
    def test_start_creates_new_attempt_each_call_and_consumes_life(self, _mock):
        r1 = self.client.post("/referrals/gamification/daily-challenge/start/")
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(DailyChallengeAttempt.objects.filter(user=self.user).count(), 1)
        b1 = r1.json()
        self.assertIn("attempt_public_id", b1["active_attempt"])
        self.assertIsNotNone(b1["active_attempt"].get("rng_seed"))
        self.assertEqual(b1["lives"]["current"], 4)
        id1 = b1["active_attempt"]["attempt_public_id"]

        r2 = self.client.post("/referrals/gamification/daily-challenge/start/")
        self.assertEqual(r2.status_code, 200)
        # Предыдущая незавершённая попытка удаляется; остаётся одна активная строка.
        self.assertEqual(DailyChallengeAttempt.objects.filter(user=self.user).count(), 1)
        self.assertEqual(r2.json()["lives"]["current"], 3)
        self.assertNotEqual(r2.json()["active_attempt"]["attempt_public_id"], id1)

    @patch("referrals.gamification.local_today", return_value=date(2026, 5, 10))
    def test_start_forbidden_when_no_lives(self, _mock):
        profile = GamificationProfile.objects.create(user=self.user, lives_current=0, lives_max=5)
        profile.save()
        r = self.client.post("/referrals/gamification/daily-challenge/start/")
        self.assertEqual(r.status_code, 409)
        body = r.json()
        self.assertEqual(body["code"], "no_lives")
        self.assertIn("summary", body)
        self.assertEqual(body["summary"]["lives"]["current"], 0)

    def test_summary_restores_lives_after_four_hours(self):
        profile = GamificationProfile.objects.create(
            user=self.user,
            lives_current=0,
            lives_max=5,
            next_life_at=timezone.now() - timedelta(minutes=1),
        )
        r = self.client.get("/referrals/gamification/summary/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["lives"]["current"], 1)
        profile.refresh_from_db()
        self.assertEqual(profile.lives_current, 1)

    @patch("referrals.gamification.local_today", return_value=date(2026, 5, 10))
    def test_finish_awards_xp_once(self, _mock):
        payload, server_score = self._start_and_autoplay_payload()
        r = self.client.post(
            "/referrals/gamification/daily-challenge/finish/",
            payload,
            format="json",
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertFalse(data["already_completed"])
        base_xp = calculate_daily_challenge_base_xp(server_score)
        self.assertEqual(data["reward"]["base_xp"], base_xp)
        self.assertEqual(data["reward"]["awarded_xp"], base_xp)
        self.assertEqual(data["reward"]["score"], server_score)
        profile = GamificationProfile.objects.get(user=self.user)
        self.assertEqual(profile.xp_total, base_xp)
        self.assertEqual(XPEvent.objects.filter(user=self.user).count(), 1)

    @patch("referrals.gamification.local_today", return_value=date(2026, 5, 10))
    def test_second_finish_does_not_award_again(self, _mock):
        payload, server_score = self._start_and_autoplay_payload()
        self.client.post(
            "/referrals/gamification/daily-challenge/finish/",
            payload,
            format="json",
        )
        r2 = self.client.post(
            "/referrals/gamification/daily-challenge/finish/",
            {
                "attempt_id": payload["attempt_id"],
                "moves": [],
                "client_score": 99_999,
            },
            format="json",
        )
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json()["already_completed"])
        profile = GamificationProfile.objects.get(user=self.user)
        base_xp = calculate_daily_challenge_base_xp(server_score)
        self.assertEqual(profile.xp_total, base_xp)
        self.assertEqual(XPEvent.objects.filter(user=self.user).count(), 1)

    @patch("referrals.gamification.local_today")
    def test_streak_increments_next_day(self, mock_today):
        d0 = date(2026, 6, 1)
        mock_today.return_value = d0
        payload, _ = self._start_and_autoplay_payload()
        self.client.post("/referrals/gamification/daily-challenge/finish/", payload, format="json")
        profile = GamificationProfile.objects.get(user=self.user)
        self.assertEqual(profile.streak_days, 1)

        mock_today.return_value = d0 + timedelta(days=1)
        payload2, _ = self._start_and_autoplay_payload()
        self.client.post("/referrals/gamification/daily-challenge/finish/", payload2, format="json")
        profile.refresh_from_db()
        self.assertEqual(profile.streak_days, 2)

    @patch("referrals.gamification.local_today", return_value=date(2026, 6, 20))
    def test_streak_increments_at_most_once_per_day_with_two_rounds(self, _mock):
        payload1, _ = self._start_and_autoplay_payload()
        self.client.post("/referrals/gamification/daily-challenge/finish/", payload1, format="json")
        payload2, _ = self._start_and_autoplay_payload()
        self.client.post("/referrals/gamification/daily-challenge/finish/", payload2, format="json")
        profile = GamificationProfile.objects.get(user=self.user)
        self.assertEqual(profile.streak_days, 1)

    @patch("referrals.gamification.local_today")
    def test_streak_resets_after_skip(self, mock_today):
        d0 = date(2026, 6, 10)
        mock_today.return_value = d0
        payload, _ = self._start_and_autoplay_payload()
        self.client.post("/referrals/gamification/daily-challenge/finish/", payload, format="json")

        mock_today.return_value = d0 + timedelta(days=2)
        payload2, _ = self._start_and_autoplay_payload()
        self.client.post("/referrals/gamification/daily-challenge/finish/", payload2, format="json")
        profile = GamificationProfile.objects.get(user=self.user)
        self.assertEqual(profile.streak_days, 1)

    def test_streak_multiplier_table(self):
        self.assertEqual(get_streak_multiplier(1), Decimal("1.0"))
        self.assertEqual(get_streak_multiplier(2), Decimal("1.1"))
        self.assertEqual(get_streak_multiplier(3), Decimal("1.2"))
        self.assertEqual(get_streak_multiplier(5), Decimal("1.3"))
        self.assertEqual(get_streak_multiplier(7), Decimal("1.5"))
        self.assertEqual(get_streak_multiplier(14), Decimal("1.7"))
        self.assertEqual(get_streak_multiplier(30), Decimal("2.0"))
        self.assertEqual(get_streak_multiplier(100), Decimal("2.0"))

    def test_daily_challenge_base_xp_brackets(self):
        self.assertEqual(calculate_daily_challenge_base_xp(0), 2)
        self.assertEqual(calculate_daily_challenge_base_xp(499), 2)
        self.assertEqual(calculate_daily_challenge_base_xp(500), 4)
        self.assertEqual(calculate_daily_challenge_base_xp(999), 4)
        self.assertEqual(calculate_daily_challenge_base_xp(1000), 7)
        self.assertEqual(calculate_daily_challenge_base_xp(1999), 7)
        self.assertEqual(calculate_daily_challenge_base_xp(2000), 10)

    @patch("referrals.gamification.local_today", return_value=date(2026, 7, 1))
    def test_best_challenge_score_only_increases(self, _mock):
        payload, server_score = self._start_and_autoplay_payload()
        self.client.post("/referrals/gamification/daily-challenge/finish/", payload, format="json")
        profile = GamificationProfile.objects.get(user=self.user)
        self.assertEqual(profile.best_challenge_score, server_score)

    @patch("referrals.gamification.local_today", return_value=date(2026, 7, 2))
    def test_best_challenge_score_next_day_higher_only(self, _mock):
        GamificationProfile.objects.create(user=self.user, best_challenge_score=800)
        payload, server_score = self._start_and_autoplay_payload()
        self.client.post("/referrals/gamification/daily-challenge/finish/", payload, format="json")
        profile = GamificationProfile.objects.get(user=self.user)
        self.assertEqual(profile.best_challenge_score, max(800, server_score))

    @patch("referrals.gamification.local_today", return_value=date(2026, 8, 1))
    def test_xpevent_daily_challenge_idempotency_key_per_attempt(self, _mock):
        payload, server_score = self._start_and_autoplay_payload()
        self.client.post("/referrals/gamification/daily-challenge/finish/", payload, format="json")
        ev = XPEvent.objects.get(user=self.user)
        self.assertEqual(ev.source, XPEvent.Source.DAILY_CHALLENGE)
        self.assertEqual(ev.idempotency_key, f"daily_challenge:{payload['attempt_id']}")
        self.assertEqual(ev.metadata_json.get("score"), server_score)

    def test_finish_without_start_returns_error(self):
        r = self.client.post(
            "/referrals/gamification/daily-challenge/finish/",
            {
                "attempt_id": str(uuid.uuid4()),
                "moves": [],
                "client_score": 100,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "daily_challenge_not_started")
        self.assertFalse(GamificationProfile.objects.filter(user=self.user).exists())

    @patch("referrals.gamification.local_today", return_value=date(2026, 9, 1))
    def test_invalid_placement_returns_400_no_xpevent(self, _mock):
        payload, _ = self._start_and_autoplay_payload()
        bad_moves = list(payload["moves"])
        if bad_moves:
            bad_moves[-1] = {**bad_moves[-1], "row": 99}
        else:
            bad_moves = [{"piece_slot": 0, "row": 0, "col": 0, "client_time_ms": 0}]
        r = self.client.post(
            "/referrals/gamification/daily-challenge/finish/",
            {"attempt_id": payload["attempt_id"], "moves": bad_moves, "client_score": 0},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(XPEvent.objects.filter(user=self.user).count(), 0)

    @patch("referrals.gamification.local_today", return_value=date(2026, 9, 2))
    def test_moves_too_long_rejected(self, _mock):
        self.client.post("/referrals/gamification/daily-challenge/start/")
        summ = self.client.get("/referrals/gamification/summary/").json()
        aid = summ["active_attempt"]["attempt_public_id"]
        long_moves = [{"piece_slot": 0, "row": 0, "col": 0, "client_time_ms": i} for i in range(501)]
        r = self.client.post(
            "/referrals/gamification/daily-challenge/finish/",
            {"attempt_id": aid, "moves": long_moves, "client_score": 0},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    @patch("referrals.gamification.local_today", return_value=date(2026, 9, 4))
    def test_foreign_attempt_rejected(self, _mock):
        other = User.objects.create_user(
            username="other",
            email="other@example.com",
            password="secret12",
        )
        self.client.post("/referrals/gamification/daily-challenge/start/")
        other_client = APIClient()
        other_client.force_authenticate(user=other)
        other_client.post("/referrals/gamification/daily-challenge/start/")
        other_summ = other_client.get("/referrals/gamification/summary/").json()
        foreign_id = other_summ["active_attempt"]["attempt_public_id"]

        payload, _ = self._start_and_autoplay_payload()
        r = self.client.post(
            "/referrals/gamification/daily-challenge/finish/",
            {
                "attempt_id": foreign_id,
                "moves": payload["moves"],
                "client_score": 0,
            },
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json()["code"], "daily_challenge_not_started")

    @patch("referrals.gamification.local_today", return_value=date(2026, 9, 4))
    def test_client_score_mismatch_sets_warning_awards_server_score(self, _mock):
        payload, server_score = self._start_and_autoplay_payload()
        payload = {**payload, "client_score": server_score + 50000}
        r = self.client.post("/referrals/gamification/daily-challenge/finish/", payload, format="json")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertTrue(body["reward"].get("score_mismatch_warning"))
        self.assertEqual(body["reward"]["score"], server_score)
        base_xp = calculate_daily_challenge_base_xp(server_score)
        self.assertEqual(body["reward"]["base_xp"], base_xp)

    def test_leaderboard_requires_auth(self):
        anon = APIClient()
        r = anon.get("/referrals/gamification/daily-challenge/leaderboard/")
        self.assertEqual(r.status_code, 401)

    @patch("referrals.gamification.local_today", return_value=date(2026, 11, 15))
    def test_leaderboard_empty(self, _mock):
        r = self.client.get("/referrals/gamification/daily-challenge/leaderboard/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["challenge_date"], "2026-11-15")
        self.assertEqual(body["limit"], 50)
        self.assertEqual(body["rows"], [])

    @patch("referrals.gamification.local_today", return_value=date(2026, 11, 16))
    def test_leaderboard_orders_by_best_score_today(self, _mock):
        payload_a, score_a = self._start_and_autoplay_payload()
        self.client.post("/referrals/gamification/daily-challenge/finish/", payload_a, format="json")

        user_b = User.objects.create_user(
            username="gamer_b",
            email="gamer_b@example.com",
            password="secret12",
        )
        client_b = APIClient()
        client_b.force_authenticate(user=user_b)
        client_b.post("/referrals/gamification/daily-challenge/start/")
        summ_b = client_b.get("/referrals/gamification/summary/").json()
        aid_b = summ_b["active_attempt"]["attempt_public_id"]
        seed_b = int(summ_b["active_attempt"]["rng_seed"])
        moves_b = greedy_moves_until_game_over(seed_b)
        server_score_b, err_b = replay_daily_challenge(seed_b, moves_b)
        self.assertEqual(err_b, "")
        client_b.post(
            "/referrals/gamification/daily-challenge/finish/",
            {
                "attempt_id": aid_b,
                "moves": moves_b,
                "client_score": server_score_b,
            },
            format="json",
        )

        r = self.client.get("/referrals/gamification/daily-challenge/leaderboard/")
        self.assertEqual(r.status_code, 200)
        rows = r.json()["rows"]
        self.assertEqual(len(rows), 2)
        scores = [rows[0]["score"], rows[1]["score"]]
        self.assertEqual(set(scores), {score_a, server_score_b})
        self.assertEqual(rows[0]["score"], max(score_a, server_score_b))


class LevelCurveTests(TestCase):
    """``xp_threshold_for_level`` uses 150 * (L-1) * L for L >= 2."""

    def test_xp_below_threshold_stays_previous_level(self):
        self.assertEqual(xp_threshold_for_level(2), 300)
        self.assertEqual(calculate_level(299), 1)

    def test_xp_at_threshold_is_exactly_that_level(self):
        self.assertEqual(calculate_level(300), 2)

    def test_level_9_at_10800_xp_and_level_10_at_13500(self):
        self.assertEqual(calculate_level(10799), 8)
        self.assertEqual(calculate_level(10800), 9)
        self.assertEqual(calculate_level(13499), 9)
        self.assertEqual(calculate_level(13500), 10)

    def test_summary_profile_level_follows_new_curve(self):
        user = User.objects.create_user(
            username="lvlchk",
            email="lvlchk@example.com",
            password="secret12",
        )
        GamificationProfile.objects.create(user=user, xp_total=13500)
        client = APIClient()
        client.force_authenticate(user=user)
        r = client.get("/referrals/gamification/summary/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["profile"]["level"], 10)


class ReferralLeagueFormulaTests(TestCase):
    def test_high_sales_low_level_stays_start(self):
        self.assertEqual(calculate_referral_league_id(1_000_000, 1, 100), "start")

    def test_bronze_requires_all_three_gates(self):
        self.assertEqual(calculate_referral_league_id(20_000, 2, 3), "bronze")
        self.assertEqual(calculate_referral_league_id(20_000, 1, 3), "start")


class PurchaseReferralXpGrantTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="seller",
            email="seller@example.com",
            password="secret12",
        )
        self.partner, _ = ensure_partner_profile(self.user)

    def _paid_order(self, **kwargs):
        defaults = {
            "dedupe_key": f"t:xp-{uuid.uuid4().hex}",
            "source": Order.Source.TILDA,
            "external_id": f"ext-{uuid.uuid4().hex[:8]}",
            "payload_fingerprint": uuid.uuid4().hex[:64],
            "partner": self.partner,
            "amount": Decimal("10000.00"),
            "currency": "RUB",
            "status": Order.Status.PAID,
            "paid_at": timezone.now(),
            "customer_email": "buyer@example.com",
        }
        defaults.update(kwargs)
        return Order.objects.create(**defaults)

    def test_purchase_xp_idempotent(self):
        order = self._paid_order()
        self.assertEqual(grant_purchase_xp_for_paid_referral_order(order), 100)
        self.assertEqual(grant_purchase_xp_for_paid_referral_order(order), 0)
        profile = GamificationProfile.objects.get(user=self.user)
        self.assertEqual(profile.xp_total, 100)
        ev = XPEvent.objects.get(user=self.user)
        self.assertEqual(ev.source, XPEvent.Source.PURCHASE_CONFIRMED)
        self.assertEqual(ev.idempotency_key, f"purchase_confirmed:{order.pk}")

    def test_no_partner_skips_xp(self):
        order = self._paid_order(partner=None)
        self.assertEqual(grant_purchase_xp_for_paid_referral_order(order), 0)
        self.assertFalse(GamificationProfile.objects.filter(user=self.user).exists())

    def test_self_referral_skips_xp(self):
        order = self._paid_order(customer_email=self.user.email)
        self.assertEqual(grant_purchase_xp_for_paid_referral_order(order), 0)


class LocalTodayPatchTests(TestCase):
    """Ensure tests patch the same symbol the app uses."""

    def test_local_today_is_django_localdate(self):
        with patch("django.utils.timezone.localdate", return_value=date(2099, 1, 1)):
            self.assertEqual(local_today(), date(2099, 1, 1))
