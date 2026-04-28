from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("referrals", "0011_site_owner_activity_log"),
    ]

    operations = [
        migrations.AddField(
            model_name="site",
            name="verification_url",
            field=models.CharField(blank=True, default="", max_length=2048),
        ),
        migrations.AddField(
            model_name="site",
            name="verification_status",
            field=models.CharField(
                choices=[
                    ("not_started", "Not started"),
                    ("pending", "Pending"),
                    ("html_found", "Html found"),
                    ("widget_seen", "Widget seen"),
                    ("failed", "Failed"),
                ],
                db_index=True,
                default="not_started",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="site",
            name="last_verification_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="site",
            name="last_verification_error",
            field=models.TextField(blank=True, default=""),
        ),
    ]
