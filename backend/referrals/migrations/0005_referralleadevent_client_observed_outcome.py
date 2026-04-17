# Client-observed form outcome (separate axis from submission_stage / submit_attempt)

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("referrals", "0004_referralleadevent_dedup_and_submission_stage"),
    ]

    operations = [
        migrations.AddField(
            model_name="referralleadevent",
            name="client_observed_outcome",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "Not reported"),
                    ("success_observed", "Client observed success (not a confirmed conversion)"),
                    ("failure_observed", "Client observed failure (heuristic)"),
                    ("not_observed", "No confirmation / inconclusive (not a failure)"),
                ],
                db_index=True,
                default="",
                help_text="Browser-reported observation only; not server-confirmed success.",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="referralleadevent",
            name="client_outcome_source",
            field=models.CharField(
                blank=True,
                default="",
                help_text="e.g. tilda_dom_heuristic, inline_payload.",
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name="referralleadevent",
            name="client_outcome_reason",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Short opaque reason from client (no PII).",
                max_length=255,
            ),
        ),
        migrations.AddField(
            model_name="referralleadevent",
            name="client_outcome_observed_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When the client last reported an observed outcome.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="referralleadevent",
            name="client_outcome_event_id",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Last client idempotency key applied for outcome reporting.",
                max_length=64,
            ),
        ),
    ]
