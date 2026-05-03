"""Authenticated achievements list for LК (`GET /users/api/achievements/`)."""

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from referrals.achievement_service import get_user_achievement_progress, sync_user_achievements


class UserAchievementsListView(APIView):
    """GET — items + summary for the current user (JWT Bearer)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        sync_user_achievements(user)
        return Response(get_user_achievement_progress(user))
