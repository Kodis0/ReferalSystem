from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("referrals", "0006_public_leadingestaudit"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="site",
            name="activated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="site",
            name="status",
            field=models.CharField(
                choices=[("draft", "Draft"), ("verified", "Verified"), ("active", "Active")],
                db_index=True,
                default="draft",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="site",
            name="verified_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="SiteMembership",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("ref_code", models.CharField(blank=True, db_index=True, default="", max_length=32)),
                (
                    "joined_via",
                    models.CharField(
                        choices=[("cta_signup", "CTA signup")],
                        default="cta_signup",
                        max_length=32,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "partner",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="site_memberships",
                        to="referrals.partnerprofile",
                    ),
                ),
                (
                    "site",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="memberships",
                        to="referrals.site",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="site_memberships",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="sitemembership",
            constraint=models.UniqueConstraint(fields=("site", "user"), name="uniq_site_membership"),
        ),
        migrations.AddIndex(
            model_name="sitemembership",
            index=models.Index(fields=["site", "-created_at"], name="referrals_s_site_id_0f98fd_idx"),
        ),
        migrations.AddIndex(
            model_name="sitemembership",
            index=models.Index(fields=["user", "-created_at"], name="referrals_s_user_id_09f0a2_idx"),
        ),
    ]
