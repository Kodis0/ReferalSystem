from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .gamification import (
    build_daily_challenge_leaderboard,
    build_gamification_leaderboard,
    build_gamification_summary,
    build_referral_shop_payload,
    finish_daily_challenge,
    redeem_referral_shop_reward,
    select_active_minigame_frame,
    start_daily_challenge,
)
from .serializers import DailyChallengeFinishSerializer


def _gamification_api_error(detail: str, **extra: object) -> dict:
    return {"detail": detail, "code": detail, **extra}


class GamificationSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(build_gamification_summary(request.user))


class DailyChallengeLeaderboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(build_daily_challenge_leaderboard())


class GamificationShopView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(build_referral_shop_payload(request.user))


class GamificationShopRedeemView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        reward_code = request.data.get("reward_code")
        if reward_code is None or str(reward_code).strip() == "":
            return Response(_gamification_api_error("unknown_reward"), status=status.HTTP_400_BAD_REQUEST)
        raw_crid = request.data.get("client_request_id")
        client_request_id = None if raw_crid is None else str(raw_crid)
        try:
            payload = redeem_referral_shop_reward(
                request.user,
                str(reward_code).strip(),
                client_request_id,
            )
        except DjangoValidationError as exc:
            token = getattr(exc, "code", None)
            if token is None and getattr(exc, "messages", None):
                token = str(exc.messages[0])
            token = str(token or "validation_error")
            return Response(_gamification_api_error(token), status=status.HTTP_400_BAD_REQUEST)
        return Response(payload, status=status.HTTP_200_OK)


class GamificationShopSelectFrameView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        raw = request.data.get("frame_code")
        frame_code = None if raw is None else str(raw).strip()
        if not frame_code:
            return Response(_gamification_api_error("unknown_frame"), status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = select_active_minigame_frame(request.user, frame_code)
        except DjangoValidationError as exc:
            token = getattr(exc, "code", None)
            if token is None and getattr(exc, "messages", None):
                token = str(exc.messages[0])
            token = str(token or "validation_error")
            return Response(_gamification_api_error(token), status=status.HTTP_400_BAD_REQUEST)
        return Response(payload, status=status.HTTP_200_OK)


class GamificationReferralLeaderboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        period = (request.query_params.get("period") or "month").strip().lower()
        try:
            payload = build_gamification_leaderboard(request.user, period)
        except ValueError:
            return Response(
                {"detail": "invalid_period", "code": "invalid_period"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(payload)


class DailyChallengeStartView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            start_daily_challenge(request.user)
        except DjangoValidationError as exc:
            if getattr(exc, "code", None) == "no_lives":
                return Response(
                    {
                        "detail": "no_lives",
                        "code": "no_lives",
                        "summary": build_gamification_summary(request.user),
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            raise
        return Response(build_gamification_summary(request.user))


class DailyChallengeFinishView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = DailyChallengeFinishSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        try:
            vd = serializer.validated_data
            outcome = finish_daily_challenge(
                request.user,
                attempt_public_id=vd["attempt_id"],
                moves=vd["moves"],
                client_score=vd.get("client_score"),
            )
        except DjangoValidationError as exc:
            token = getattr(exc, "code", None)
            if token is None and getattr(exc, "messages", None):
                token = str(exc.messages[0])
            token = str(token or "validation_error")
            return Response(_gamification_api_error(token), status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "summary": outcome.summary,
                "reward": outcome.reward,
                "already_completed": outcome.already_completed,
            },
            status=status.HTTP_200_OK,
        )
