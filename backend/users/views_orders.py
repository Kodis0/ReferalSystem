import logging

from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from referrals.services import order_webhook_auth_failure, upsert_order_from_tilda_payload

logger = logging.getLogger(__name__)


@method_decorator(csrf_exempt, name="dispatch")
class OrderReceiveView(APIView):
    """
    Приём заказов с Тильды (и аналогичных вебхуков): сохраняем Order, привязываем атрибуцию,
    при оплаченном статусе создаём Commission (идемпотентно).

    Полный контракт полей (имена, dedupe, paid/pending, ref) — в модуле
    ``referrals.services`` (``extract_tilda_order_fields`` / ``upsert_order_from_tilda_payload``)
    и в ``backend/README.md``.

    Production: set ``ORDER_WEBHOOK_SHARED_SECRET`` and send the same value in
    ``X-Order-Webhook-Secret`` or ``Authorization: Bearer …``. With ``DJANGO_DEBUG=False``,
    an unset secret returns 503 so the endpoint cannot be left accidentally open.
    """

    authentication_classes = []
    permission_classes = []

    def post(self, request, *args, **kwargs):
        auth_err = order_webhook_auth_failure(request)
        if auth_err:
            code, body = auth_err
            return Response(body, status=code)
        try:
            session_key = request.session.session_key
            user = request.user if request.user.is_authenticated else None
            order, created = upsert_order_from_tilda_payload(
                request.data,
                session_key=session_key,
                customer_user=user,
            )
            return Response(
                {
                    "status": "ok",
                    "order_id": order.id,
                    "created": created,
                    "order_status": order.status,
                    "dedupe_key": order.dedupe_key,
                },
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            logger.exception("Order webhook processing failed")
            return Response(
                {"status": "error", "message": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )
