# Generated manually for lead ingest dedup + semantics

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("referrals", "0003_referralleadevent_amount_currency_product_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="referralleadevent",
            name="submission_stage",
            field=models.CharField(
                choices=[
                    ("submit_attempt", "Submit attempt (not a confirmed conversion)"),
                ],
                db_index=True,
                default="submit_attempt",
                help_text="What the row actually represents (ingest is a submit attempt by default).",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="referralleadevent",
            name="normalized_email",
            field=models.CharField(blank=True, db_index=True, default="", max_length=254),
        ),
        migrations.AddField(
            model_name="referralleadevent",
            name="normalized_phone",
            field=models.CharField(blank=True, db_index=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="referralleadevent",
            name="page_key",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Normalized page path for dedup (URL path only, no query).",
                max_length=512,
            ),
        ),
        migrations.AlterField(
            model_name="referralleadevent",
            name="event_type",
            field=models.CharField(
                choices=[("lead_submitted", "Lead submitted (wire)")],
                db_index=True,
                default="lead_submitted",
                help_text="Public wire name from the widget (v1: lead_submitted).",
                max_length=32,
            ),
        ),
    ]
