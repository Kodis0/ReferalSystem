from django.urls import path
from .views import (
    RegisterView,
    LoginView,
    LoginPageView,
    DashboardView,
    MyTokenObtainPairView,
    GoogleIdTokenLoginView,
    VkOAuthStartView,
    VkOAuthCallbackView,
    TelegramLoginStartView,
    TelegramLoginCallbackView,
    TelegramWidgetLoginView,
    ChangePasswordView,
    CurrentUserView,
    AccountAdditionalUsersListView,
    MyProgramsView,
    MyProgramDetailView,
    ProgramCatalogDetailView,
    ProgramsCatalogView,
    SiteCtaJoinView,
    SiteCtaLeaveView,
)
from rest_framework_simplejwt.views import TokenRefreshView
from .views_orders import OrderReceiveView
from .support_views import (
    SupportTicketAttachmentView,
    SupportTicketListCreateView,
    SupportTicketRetrieveView,
)

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('site/join/', SiteCtaJoinView.as_view(), name='site_cta_join'),
    path('site/leave/', SiteCtaLeaveView.as_view(), name='site_cta_leave'),
    path('login/', LoginView.as_view(), name='login'),
    path('login-page/', LoginPageView.as_view(), name='login-page'),
    path('token/', MyTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/google/', GoogleIdTokenLoginView.as_view(), name='token_google'),
    path('token/vk/start/', VkOAuthStartView.as_view(), name='vk_oauth_start'),
    path('token/vk/callback/', VkOAuthCallbackView.as_view(), name='vk_oauth_callback'),
    path('token/telegram/start/', TelegramLoginStartView.as_view(), name='telegram_login_start'),
    path('token/telegram/callback/', TelegramLoginCallbackView.as_view(), name='telegram_login_callback'),
    path('token/telegram/widget/', TelegramWidgetLoginView.as_view(), name='telegram_widget_login'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('dashboard/', DashboardView.as_view(), name='dashboard'),
    path('programs/<uuid:site_public_id>/', ProgramCatalogDetailView.as_view(), name='program_catalog_detail'),
    path('programs/', ProgramsCatalogView.as_view(), name='programs_catalog'),
    path('me/programs/<uuid:site_public_id>/', MyProgramDetailView.as_view(), name='my_program_detail'),
    path('me/programs/', MyProgramsView.as_view(), name='my_programs'),
    path('me/password/', ChangePasswordView.as_view(), name='change_password'),
    path('me/account-users/', AccountAdditionalUsersListView.as_view(), name='account_additional_users'),
    path('me/', CurrentUserView.as_view(), name='current_user'),  # 🔹 текущий пользователь
    path('me/support-tickets/', SupportTicketListCreateView.as_view(), name='support_tickets'),
    path(
        'me/support-tickets/<uuid:ticket_id>/attachments/<str:filename>/',
        SupportTicketAttachmentView.as_view(),
        name='support_ticket_attachment',
    ),
    path(
        'me/support-tickets/<uuid:ticket_id>/',
        SupportTicketRetrieveView.as_view(),
        name='support_ticket_detail',
    ),
    path('api/orders/', OrderReceiveView.as_view(), name='receive_order'),
]
