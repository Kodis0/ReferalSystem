from django.urls import path
from .views import (
    RegisterView,
    LoginView,
    LoginPageView,
    DashboardView,
    MyTokenObtainPairView,
    GoogleIdTokenLoginView,
    GitHubOAuthStartView,
    GitHubOAuthCallbackView,
    CurrentUserView,
    MyProgramsView,
    MyProgramDetailView,
    SiteCtaJoinView,
)
from rest_framework_simplejwt.views import TokenRefreshView
from .views_orders import OrderReceiveView

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('site/join/', SiteCtaJoinView.as_view(), name='site_cta_join'),
    path('login/', LoginView.as_view(), name='login'),
    path('login-page/', LoginPageView.as_view(), name='login-page'),
    path('token/', MyTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/google/', GoogleIdTokenLoginView.as_view(), name='token_google'),
    path('token/github/start/', GitHubOAuthStartView.as_view(), name='github_oauth_start'),
    path('token/github/callback/', GitHubOAuthCallbackView.as_view(), name='github_oauth_callback'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('dashboard/', DashboardView.as_view(), name='dashboard'),
    path('me/programs/<uuid:site_public_id>/', MyProgramDetailView.as_view(), name='my_program_detail'),
    path('me/programs/', MyProgramsView.as_view(), name='my_programs'),
    path('me/', CurrentUserView.as_view(), name='current_user'),  # 🔹 текущий пользователь
    path('api/orders/', OrderReceiveView.as_view(), name='receive_order'),
]
