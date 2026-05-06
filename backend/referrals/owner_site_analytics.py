"""
Site-scoped owner analytics for the LK dashboard (KPIs, daily series, recent sales).

Aggregates referrals (SiteMembership), widget leads with referral attribution
(ReferralLeadEvent with non-null partner — excludes organic submits without ref),
and partner-attributed visits/orders for members of the site.
Sales KPIs include paid orders plus pending orders with a positive amount (form submitted
with sum before payment confirmation).
"""
from __future__ import annotations

from datetime import date, datetime, time as dt_time, timedelta
from decimal import Decimal
from typing import Any, Optional

from django.db.models import Count, F, Q, Sum
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone

from .models import Commission, Order, ReferralLeadEvent, ReferralVisit, Site, SiteMembership
from .services_partner_dashboard_formatting import mask_email_for_partner_dashboard


def partner_ids_for_site_referrers(site: Site) -> list[int]:
    """PartnerProfile ids for users who joined this site as referrers (CTA membership)."""
    ids: set[int] = set()
    qs = SiteMembership.objects.filter(site=site).select_related("user", "partner")
    for m in qs:
        if m.partner_id:
            ids.add(int(m.partner_id))
            continue
        user = m.user
        pp = getattr(user, "partner_profile", None)
        if pp is not None:
            ids.add(int(pp.pk))
    return sorted(ids)


def _parse_period(raw: str | None) -> str:
    s = (raw or "").strip().lower()
    if s in ("7d", "30d", "3m", "6m", "1y", "all"):
        return s
    return "7d"


def _since_for_period(period: str):
    now = timezone.now()
    if period == "7d":
        return now - timedelta(days=7)
    if period == "30d":
        return now - timedelta(days=30)
    if period == "3m":
        return now - timedelta(days=90)
    if period == "6m":
        return now - timedelta(days=180)
    if period == "1y":
        return now - timedelta(days=365)
    return None


def _local_date(d) -> date:
    return timezone.localtime(d).date()


def _start_of_day(d: date):
    return timezone.make_aware(datetime.combine(d, dt_time.min))


def _series_start_date(*, site: Site, since: Optional[datetime], now) -> date:
    if since is not None:
        return _local_date(since)
    cap = _local_date(now) - timedelta(days=364)
    site_d = _local_date(site.created_at)
    return max(cap, site_d)


def build_site_owner_analytics_payload(
    *,
    site: Site,
    period: str | None = None,
) -> dict[str, Any]:
    period_key = _parse_period(period)
    since = _since_for_period(period_key)
    now = timezone.now()
    tz = timezone.get_current_timezone()
    partner_ids = partner_ids_for_site_referrers(site)

    def memberships_qs():
        q = SiteMembership.objects.filter(site=site)
        if since is not None:
            q = q.filter(created_at__gte=since)
        return q

    def leads_qs():
        q = ReferralLeadEvent.objects.filter(site=site, partner__isnull=False)
        if since is not None:
            q = q.filter(created_at__gte=since)
        return q

    def visits_qs():
        if not partner_ids:
            return ReferralVisit.objects.none()
        q = ReferralVisit.objects.filter(partner_id__in=partner_ids)
        if since is not None:
            q = q.filter(created_at__gte=since)
        return q

    def sales_visible_qs():
        """Paid orders, or pending with amount (webhook / form with sum but no paid flag yet)."""
        if not partner_ids:
            return Order.objects.none()
        q = Order.objects.filter(partner_id__in=partner_ids).filter(
            Q(status=Order.Status.PAID)
            | Q(status=Order.Status.PENDING, amount__gt=0)
        )
        if since is not None:
            q = q.filter(
                Q(status=Order.Status.PAID, paid_at__gte=since)
                | Q(status=Order.Status.PAID, paid_at__isnull=True, created_at__gte=since)
                | Q(status=Order.Status.PENDING, amount__gt=0, created_at__gte=since)
            )
        return q

    def commissions_qs():
        if not partner_ids:
            return Commission.objects.none()
        q = Commission.objects.filter(partner_id__in=partner_ids)
        if since is not None:
            q = q.filter(created_at__gte=since)
        return q

    referrals_count = memberships_qs().count()
    visits_count = visits_qs().count()
    leads_count = leads_qs().count()

    paid_all = sales_visible_qs()
    sales_count = paid_all.count()
    amount_agg = paid_all.aggregate(total=Sum("amount"))
    sales_amount = amount_agg["total"] if amount_agg["total"] is not None else Decimal("0.00")

    comm_agg = commissions_qs().aggregate(total=Sum("commission_amount"))
    commissions_total = comm_agg["total"] if comm_agg["total"] is not None else Decimal("0.00")

    funnel_sales = sales_count
    funnel_visits = visits_count
    funnel_leads = leads_count

    series_start = _series_start_date(site=site, since=since, now=now)
    series_end = _local_date(now)
    day_keys: list[date] = []
    d = series_start
    while d <= series_end:
        day_keys.append(d)
        d += timedelta(days=1)

    series_from = _start_of_day(series_start)

    leads_by_day: dict[date, dict[str, int]] = {}
    for row in (
        ReferralLeadEvent.objects.filter(
            site=site,
            partner__isnull=False,
            created_at__gte=series_from,
            created_at__lte=now,
        )
        .annotate(day=TruncDate("created_at", tzinfo=tz))
        .values("day")
        .annotate(leads=Count("id"))
    ):
        dd = row["day"]
        if dd is None:
            continue
        if hasattr(dd, "date"):
            dd = dd.date()
        leads_by_day[dd] = {"leads": int(row["leads"])}

    visits_by_day: dict[date, dict[str, int]] = {}
    if partner_ids:
        for row in (
            ReferralVisit.objects.filter(partner_id__in=partner_ids, created_at__gte=series_from, created_at__lte=now)
            .annotate(day=TruncDate("created_at", tzinfo=tz))
            .values("day")
            .annotate(visits=Count("id"))
        ):
            dd = row["day"]
            if dd is None:
                continue
            if hasattr(dd, "date"):
                dd = dd.date()
            visits_by_day[dd] = {"visits": int(row["visits"])}

    sales_by_day: dict[date, dict[str, Any]] = {}
    commissions_by_day: dict[date, dict[str, Any]] = {}
    if partner_ids:
        merged_sales: dict[date, dict[str, Decimal | int]] = {}

        def _merge_sales_day(dd: date, cnt: int, amt: Decimal) -> None:
            cur = merged_sales.setdefault(dd, {"sales_count": 0, "sales_amount": Decimal("0.00")})
            cur["sales_count"] = int(cur["sales_count"]) + cnt
            cur["sales_amount"] = Decimal(cur["sales_amount"]) + amt

        paid_base = Order.objects.filter(partner_id__in=partner_ids, status=Order.Status.PAID).annotate(
            eff_ts=Coalesce("paid_at", "created_at"),
        )
        for row in (
            paid_base.filter(eff_ts__gte=series_from, eff_ts__lte=now)
            .annotate(day=TruncDate(F("eff_ts"), tzinfo=tz))
            .values("day")
            .annotate(sales_count=Count("id"), sales_amount=Sum("amount"))
        ):
            dd = row["day"]
            if dd is None:
                continue
            if hasattr(dd, "date"):
                dd = dd.date()
            amt = row["sales_amount"] if row["sales_amount"] is not None else Decimal("0.00")
            _merge_sales_day(dd, int(row["sales_count"]), Decimal(amt))

        for row in (
            Order.objects.filter(
                partner_id__in=partner_ids,
                status=Order.Status.PENDING,
                amount__gt=0,
                created_at__gte=series_from,
                created_at__lte=now,
            )
            .annotate(day=TruncDate("created_at", tzinfo=tz))
            .values("day")
            .annotate(sales_count=Count("id"), sales_amount=Sum("amount"))
        ):
            dd = row["day"]
            if dd is None:
                continue
            if hasattr(dd, "date"):
                dd = dd.date()
            amt = row["sales_amount"] if row["sales_amount"] is not None else Decimal("0.00")
            _merge_sales_day(dd, int(row["sales_count"]), Decimal(amt))

        for dd, v in merged_sales.items():
            sales_by_day[dd] = {
                "sales_count": int(v["sales_count"]),
                "sales_amount": str(Decimal(v["sales_amount"]).quantize(Decimal("0.01"))),
            }

        for row in (
            Commission.objects.filter(partner_id__in=partner_ids, created_at__gte=series_from, created_at__lte=now)
            .annotate(day=TruncDate("created_at", tzinfo=tz))
            .values("day")
            .annotate(commissions=Sum("commission_amount"))
        ):
            dd = row["day"]
            if dd is None:
                continue
            if hasattr(dd, "date"):
                dd = dd.date()
            cmt = row["commissions"] if row["commissions"] is not None else Decimal("0.00")
            commissions_by_day[dd] = {"commissions": str(Decimal(cmt).quantize(Decimal("0.01")))}

    by_day: list[dict[str, Any]] = []
    for k in day_keys:
        lb = leads_by_day.get(k, {})
        vb = visits_by_day.get(k, {})
        sb = sales_by_day.get(k, {})
        cb = commissions_by_day.get(k, {})
        by_day.append(
            {
                "date": k.isoformat(),
                "leads": int(lb.get("leads", 0)),
                "visits": int(vb.get("visits", 0)),
                "sales_count": int(sb.get("sales_count", 0)),
                "sales_amount": str(sb.get("sales_amount", "0.00")),
                "commissions": str(cb.get("commissions", "0.00")),
            }
        )

    recent_orders: list[dict[str, Any]] = []
    if partner_ids:
        ro = (
            Order.objects.filter(partner_id__in=partner_ids)
            .filter(
                Q(status=Order.Status.PAID)
                | Q(status=Order.Status.PENDING, amount__gt=0)
            )
            .annotate(sort_ts=Coalesce("paid_at", "created_at"))
            .order_by("-sort_ts", "-pk")[:50]
        )
        for o in ro:
            ts = o.paid_at or o.created_at
            recent_orders.append(
                {
                    "id": o.id,
                    "at": ts.isoformat() if ts else o.created_at.isoformat(),
                    "amount": str(o.amount),
                    "currency": o.currency or "",
                    "status": o.status,
                    "ref_code": (o.ref_code or "")[:32],
                    "customer_email_masked": mask_email_for_partner_dashboard(o.customer_email or ""),
                }
            )

    return {
        "site_public_id": str(site.public_id),
        "period": period_key,
        "since": since.isoformat() if since else None,
        "kpis": {
            "referrals_count": referrals_count,
            "visits_count": visits_count,
            "leads_count": leads_count,
            "sales_count": sales_count,
            "sales_amount": str(Decimal(sales_amount).quantize(Decimal("0.01"))),
            "commissions_total": str(Decimal(commissions_total).quantize(Decimal("0.01"))),
        },
        "funnel": {
            "visits": funnel_visits,
            "leads": funnel_leads,
            "sales": funnel_sales,
        },
        "series": {
            "by_day": by_day,
            "chart_window_days": len(day_keys),
            "chart_capped_to_365d": period_key == "all",
        },
        "recent_sales": recent_orders,
    }
