from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('users/', include('users.urls')),  # все маршруты users
    path('referrals/', include('referrals.urls')),
    path('public/v1/', include('referrals.public_urls')),
]
