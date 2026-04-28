"""Хранение файлов вложений support-тикетов на диске (имена в `SupportTicket.attachment_names`)."""

import mimetypes
import os
from pathlib import Path

from django.conf import settings


def support_ticket_dir(ticket_id) -> Path:
    root = getattr(
        settings,
        "SUPPORT_TICKET_ATTACHMENTS_ROOT",
        settings.BASE_DIR / "media" / "support_tickets",
    )
    return Path(root) / str(ticket_id)


def safe_attachment_filename(name: str) -> str:
    base = os.path.basename(str(name or "").strip())
    if not base or base in (".", "..") or ".." in base:
        raise ValueError("invalid_filename")
    if "/" in base or "\\" in base:
        raise ValueError("invalid_filename")
    return base


def split_attachment_names(s: str) -> list:
    return [x.strip() for x in (s or "").split(",") if x.strip()]


def added_attachment_names_ordered(old_raw: str, new_raw: str) -> list:
    """Имена, появившиеся в new по сравнению с old, в порядке перечисления в new."""
    old_set = set(split_attachment_names(old_raw))
    new_list = split_attachment_names(new_raw)
    return [n for n in new_list if n not in old_set]


MAX_SUPPORT_ATTACHMENT_BYTES = 52 * 1024 * 1024


def save_new_attachments(ticket_id, added_names: list, uploaded_files) -> None:
    if len(uploaded_files) != len(added_names):
        raise ValueError("FILES_MISMATCH")
    dest_dir = support_ticket_dir(ticket_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    for upl, expected_name in zip(uploaded_files, added_names):
        safe = safe_attachment_filename(expected_name)
        if upl.size > MAX_SUPPORT_ATTACHMENT_BYTES:
            raise ValueError("FILE_TOO_LARGE")
        path = dest_dir / safe
        with path.open("wb") as out:
            for chunk in upl.chunks():
                out.write(chunk)


def attachment_disk_path(ticket_id, filename: str) -> Path:
    return support_ticket_dir(ticket_id) / safe_attachment_filename(filename)


def guess_content_type(filename: str) -> str:
    ct, _ = mimetypes.guess_type(filename)
    return ct or "application/octet-stream"
