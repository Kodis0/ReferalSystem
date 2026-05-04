from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("referrals", "0018_user_achievement"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamificationprofile",
            name="points_balance",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="gamificationprofile",
            name="points_lifetime_earned",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="gamificationprofile",
            name="points_lifetime_spent",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.CreateModel(
            name="ReferralPointTransaction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("transaction_type", models.CharField(choices=[("purchase_confirmed", "Purchase confirmed"), ("manual_adjustment", "Manual adjustment"), ("reward_spend", "Reward spend"), ("reward_refund", "Reward refund"), ("order_refund_reversal", "Order refund reversal")], db_index=True, max_length=32)),
                ("amount", models.IntegerField()),
                ("idempotency_key", models.CharField(blank=True, max_length=192, null=True, unique=True)),
                ("balance_after", models.IntegerField()),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name="referral_point_transactions",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="referralpointtransaction",
            index=models.Index(fields=["user", "-created_at"], name="referrals_r_user_id_df7188_idx"),
        ),
    ]
