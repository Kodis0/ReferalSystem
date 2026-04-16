from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
import json


@method_decorator(csrf_exempt, name='dispatch')
class OrderReceiveView(APIView):
    """
    Приём заказов с Тильды.
    Пока что просто выводит данные в консоль.
    """
    authentication_classes = []  # без авторизации
    permission_classes = []

    def post(self, request, *args, **kwargs):
        try:
            data = request.data
            print("📦 Новый заказ получен:")
            print(json.dumps(data, indent=2, ensure_ascii=False))
            return Response({"status": "ok", "message": "Данные получены"}, status=status.HTTP_200_OK)
        except Exception as e:
            print("❌ Ошибка при обработке:", e)
            return Response({"status": "error", "message": str(e)}, status=status.HTTP_400_BAD_REQUEST)
