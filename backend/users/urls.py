from django.urls import path
from .views import (
    RegisterView,
    LoginView,
    LoginPageView,
    DashboardView,
    MyTokenObtainPairView,
    CurrentUserView,
    MyProgramsView,
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
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('dashboard/', DashboardView.as_view(), name='dashboard'),
    path('me/programs/', MyProgramsView.as_view(), name='my_programs'),
    path('me/', CurrentUserView.as_view(), name='current_user'),  # 🔹 текущий пользователь
    path('api/orders/', OrderReceiveView.as_view(), name='receive_order'),
]
