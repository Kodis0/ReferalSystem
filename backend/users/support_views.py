"""Список и создание обращений в поддержку из ЛК."""

from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from .models import SupportTicket

SUPPORT_TYPE_TITLE_RU = {
    "help-question": "По общему вопросу",
    "help-problem": "По техническому вопросу",
    "help-claim": "Для отработки претензии",
}

ALLOWED_SUPPORT_TYPE_SLUGS = frozenset(SUPPORT_TYPE_TITLE_RU.keys())


def _preview_from_body(body: str, max_len: int = 160) -> str:
    text = body.strip().replace("\r\n", "\n")
    if not text:
        return "…"
    first_line = text.split("\n", 1)[0].strip()
    if len(first_line) > max_len:
        return first_line[: max_len - 1] + "…"
    return first_line


def _ticket_list_item(ticket: SupportTicket) -> dict:
    return {
        "id": str(ticket.id),
        "type_slug": ticket.type_slug,
        "type_title": SUPPORT_TYPE_TITLE_RU.get(ticket.type_slug, ticket.type_slug),
        "target_label": ticket.target_label or "",
        "preview": _preview_from_body(ticket.body),
        "created_at": ticket.created_at.isoformat(),
        "is_closed": bool(ticket.is_closed),
    }


def _ticket_detail(ticket: SupportTicket) -> dict:
    return {
        **(_ticket_list_item(ticket)),
        "body": ticket.body,
        "attachment_names": ticket.attachment_names or "",
    }


class SupportTicketListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = SupportTicket.objects.filter(user=request.user).order_by("-created_at")
        return Response({"tickets": [_ticket_list_item(t) for t in qs]}, status=status.HTTP_200_OK)

    def post(self, request):
        data = request.data
        type_slug = (data.get("type_slug") or "").strip()
        body = (data.get("body") or "").strip()
        target_key = (data.get("target_key") or "").strip()[:512]
        target_label = (data.get("target_label") or "").strip()[:512]
        attachment_names = (data.get("attachment_names") or "").strip()

        if type_slug not in ALLOWED_SUPPORT_TYPE_SLUGS:
            return Response(
                {"detail": "Неизвестный тип обращения.", "code": "invalid_type_slug"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not body:
            return Response(
                {"detail": "Введите текст сообщения.", "code": "empty_body"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ticket = SupportTicket.objects.create(
            user=request.user,
            type_slug=type_slug,
            target_key=target_key,
            target_label=target_label,
            body=body,
            attachment_names=attachment_names,
        )
        return Response(_ticket_detail(ticket), status=status.HTTP_201_CREATED)


class SupportTicketRetrieveView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, ticket_id):
        ticket = get_object_or_404(SupportTicket, id=ticket_id, user=request.user)
        return Response(_ticket_detail(ticket), status=status.HTTP_200_OK)

    def patch(self, request, ticket_id):
        ticket = get_object_or_404(SupportTicket, id=ticket_id, user=request.user)
        data = request.data
        if "is_closed" in data:
            ticket.is_closed = bool(data["is_closed"])
            ticket.save(update_fields=["is_closed"])
            return Response(_ticket_detail(ticket), status=status.HTTP_200_OK)
        return Response(
            {"detail": "Нет допустимых полей для обновления.", "code": "no_patch_fields"},
            status=status.HTTP_400_BAD_REQUEST,
        )
