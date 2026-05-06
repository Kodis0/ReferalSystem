"""
Soft-archive Sites instead of hard delete: preserves SiteMembership, public_id, publishable_key.

Use ``Site.objects`` (default manager) for active sites only; ``Site.all_objects`` includes archived rows.
"""

from __future__ import annotations

from typing import Iterable, Optional

from django.utils import timezone

from referrals.models import Site
from referrals.owner_site_activity import log_owner_site_deleted


def normalize_origin_tuple(origins: Iterable[str]) -> tuple[str, ...]:
    """Comparable tuple for allowed_origins equality (trim, lowercase host/path normalization light)."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in origins:
        s = (raw or "").strip().rstrip("/")
        if not s:
            continue
        low = s.lower()
        if low not in seen:
            seen.add(low)
            out.append(low)
    return tuple(sorted(out))


def find_archived_site_for_restore(
    *,
    owner_id: int,
    project_id: Optional[int],
    allowed_origins: list[str],
) -> Optional[Site]:
    """
    Match archived site by owner + project + exact normalized allowed_origins list.
    Returns the most recently archived if multiple match (should be rare).
    """
    want = normalize_origin_tuple(allowed_origins)
    if not want:
        return None
    qs = Site.all_objects.filter(owner_id=owner_id, archived_at__isnull=False).order_by("-archived_at", "-pk")
    if project_id is not None:
        qs = qs.filter(project_id=project_id)
    for site in qs:
        got = normalize_origin_tuple(site.allowed_origins or [])
        if got == want:
            return site
    return None


def archive_site(*, site: Site, actor, via: str) -> None:
    """Mark site archived (hidden from default manager); memberships and keys unchanged."""
    log_owner_site_deleted(site=site, actor=actor, via=via)
    site.archived_at = timezone.now()
    site.save(update_fields=["archived_at", "updated_at"])


def restore_site(site: Site) -> None:
    site.archived_at = None
    site.save(update_fields=["archived_at", "updated_at"])
