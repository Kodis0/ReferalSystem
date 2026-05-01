from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .gamification import (
    build_gamification_summary,
    finish_daily_challenge,
    start_daily_challenge,
)
from .serializers import DailyChallengeFinishSerializer


def _gamification_api_error(detail: str, **extra: object) -> dict:
    return {"detail": detail, "code": detail, **extra}


class GamificationSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(build_gamification_summary(request.user))


class DailyChallengeStartView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        start_daily_challenge(request.user)
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
