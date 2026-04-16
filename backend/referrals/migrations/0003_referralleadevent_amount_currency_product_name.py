from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("referrals", "0002_site_and_lead_events"),
    ]

    operations = [
        migrations.AddField(
            model_name="referralleadevent",
            name="amount",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Optional monetary amount from widget (not an order).",
                max_digits=12,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="referralleadevent",
            name="currency",
            field=models.CharField(blank=True, default="", max_length=8),
        ),
        migrations.AddField(
            model_name="referralleadevent",
            name="product_name",
            field=models.CharField(blank=True, default="", max_length=512),
        ),
        migrations.AlterField(
            model_name="site",
            name="config_json",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Optional widget keys: amount_selector, currency (literal), "
                "product_name_selector (CSS selectors resolved in the browser).",
            ),
        ),
    ]
