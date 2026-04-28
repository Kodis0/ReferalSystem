"""Список и создание обращений в поддержку из ЛК."""

import re

from django.http import FileResponse, Http404
from django.utils import timezone
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from .models import SupportTicket
from .support_attachments import (
    added_attachment_names_ordered,
    attachment_disk_path,
    guess_content_type,
    save_new_attachments,
    split_attachment_names,
    safe_attachment_filename,
)

SUPPORT_TYPE_TITLE_RU = {
    "help-question": "По общему вопросу",
    "help-problem": "По техническому вопросу",
    "help-claim": "Для отработки претензии",
}

ALLOWED_SUPPORT_TYPE_SLUGS = frozenset(SUPPORT_TYPE_TITLE_RU.keys())

# Согласовано с `SupportTicketDetailPage` (thread).
SUPPORT_THREAD_SEP = "\n\n[SUPPORT]\n\n"
USER_THREAD_SEP = "\n\n[USER]\n\n"


def _normalize_thread_newlines(s: str) -> str:
    return (s or "").replace("\r\n", "\n")


def _split_user_round(text: str) -> list[str]:
    raw = text.rstrip()
    if not raw:
        return []
    return [p.rstrip() for p in raw.split(USER_THREAD_SEP) if p.rstrip()]


def _strip_embedded_attachment_lines(text: str) -> str:
    t = _normalize_thread_newlines(text)
    t = re.sub(r"\n\nВложения \(имена файлов\):[^\n]*", "", t)
    t = re.sub(r"^\[USER\]\s*$", "", t, flags=re.MULTILINE | re.IGNORECASE)
    t = re.sub(r"^\[SUPPORT\]\s*$", "", t, flags=re.MULTILINE | re.IGNORECASE)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _thread_segment_texts(body: str) -> list[str]:
    s = _normalize_thread_newlines(body).strip()
    if not s:
        return []
    if SUPPORT_THREAD_SEP not in s:
        return _split_user_round(s)
    parts = s.split(SUPPORT_THREAD_SEP)
    out: list[str] = []
    for i, piece in enumerate(parts):
        piece = piece.rstrip()
        if not piece:
            continue
        if i % 2 == 0:
            out.extend(_split_user_round(piece))
        else:
            out.append(piece)
    return out


def _last_message_preview_from_body(body: str) -> str:
    segments = _thread_segment_texts(body)
    if not segments:
        return "…"
    last = _strip_embedded_attachment_lines(segments[-1])
    return last if last else "…"


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
        "last_message_preview": _last_message_preview_from_body(ticket.body),
        "created_at": ticket.created_at.isoformat(),
        "is_closed": bool(ticket.is_closed),
    }


def _ticket_detail(ticket: SupportTicket) -> dict:
    return {
        **(_ticket_list_item(ticket)),
        "body": ticket.body,
        "attachment_names": ticket.attachment_names or "",
        "closed_at": ticket.closed_at.isoformat() if ticket.closed_at else None,
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

        is_multipart = request.content_type and "multipart/form-data" in request.content_type
        if is_multipart:
            append_body = (request.POST.get("append_body") or "").strip()
            attachment_names = (request.POST.get("attachment_names") or "").strip()
            data = {"append_body": append_body, "attachment_names": attachment_names}
        else:
            data = request.data

        if "append_body" in data:
            append_body = (data.get("append_body") or "").strip()
            if not append_body:
                return Response(
                    {"detail": "Введите текст сообщения.", "code": "empty_append_body"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if ticket.is_closed:
                return Response(
                    {"detail": "Нельзя добавить сообщение в закрытый тикет.", "code": "ticket_closed"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            tb = (ticket.body or "").rstrip()
            ticket.body = tb + ("\n\n" if tb else "") + append_body
            update_fields = ["body"]
            if "attachment_names" in data:
                new_names = (data.get("attachment_names") or "").strip()
                if is_multipart:
                    added = added_attachment_names_ordered(ticket.attachment_names, new_names)
                    upload_list = request.FILES.getlist("files")
                    if added:
                        try:
                            save_new_attachments(ticket.id, added, upload_list)
                        except ValueError as e:
                            code = str(e)
                            detail = {
                                "FILES_MISMATCH": "Число файлов не совпадает с новыми именами вложений.",
                                "FILE_TOO_LARGE": "Файл слишком большой (максимум 50 МБ).",
                                "invalid_filename": "Недопустимое имя файла.",
                            }.get(code, "Не удалось сохранить вложения.")
                            return Response(
                                {"detail": detail, "code": code.lower()},
                                status=status.HTTP_400_BAD_REQUEST,
                            )
                    elif upload_list:
                        return Response(
                            {"detail": "Лишние файлы без новых имён вложений.", "code": "unexpected_files"},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                ticket.attachment_names = new_names
                update_fields.append("attachment_names")
            ticket.save(update_fields=update_fields)
            return Response(_ticket_detail(ticket), status=status.HTTP_200_OK)

        if "is_closed" in data and not is_multipart:
            closed = bool(data["is_closed"])
            ticket.is_closed = closed
            ticket.closed_at = timezone.now() if closed else None
            ticket.save(update_fields=["is_closed", "closed_at"])
            return Response(_ticket_detail(ticket), status=status.HTTP_200_OK)
        return Response(
            {"detail": "Нет допустимых полей для обновления.", "code": "no_patch_fields"},
            status=status.HTTP_400_BAD_REQUEST,
        )


class SupportTicketAttachmentView(APIView):
    """Отдаёт файл вложения; доступ только владельцу тикета. Аудио — для воспроизведения в ЛК (JWT в заголовке)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, ticket_id, filename):
        ticket = get_object_or_404(SupportTicket, id=ticket_id, user=request.user)
        try:
            safe = safe_attachment_filename(filename)
        except ValueError:
            raise Http404()
        if safe not in split_attachment_names(ticket.attachment_names):
            raise Http404()
        path = attachment_disk_path(ticket_id, safe)
        if not path.is_file():
            raise Http404()
        return FileResponse(
            path.open("rb"),
            content_type=guess_content_type(safe),
            as_attachment=False,
        )

    def delete(self, request, ticket_id, filename):
        """Удаляет вложение с диска и из списка имён; доступ только владельцу тикета."""
        ticket = get_object_or_404(SupportTicket, id=ticket_id, user=request.user)
        try:
            safe = safe_attachment_filename(filename)
        except ValueError:
            raise Http404()
        names = split_attachment_names(ticket.attachment_names)
        if safe not in names:
            raise Http404()
        new_list = [n for n in names if n != safe]
        ticket.attachment_names = ", ".join(new_list)
        ticket.save(update_fields=["attachment_names"])
        path = attachment_disk_path(ticket_id, safe)
        try:
            if path.is_file():
                path.unlink()
        except OSError:
            pass
        return Response(_ticket_detail(ticket), status=status.HTTP_200_OK)
