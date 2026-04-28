# Account-wide activity feed: owner FK, site nullable SET_NULL so logs survive site deletion.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def forwards_fill_owner(apps, schema_editor):
    SiteOwnerActivityLog = apps.get_model("referrals", "SiteOwnerActivityLog")
    Site = apps.get_model("referrals", "Site")
    for row in SiteOwnerActivityLog.objects.filter(site_id__isnull=False).only("id", "site_id"):
        own_id = Site.objects.filter(pk=row.site_id).values_list("owner_id", flat=True).first()
        if own_id:
            row.owner_id = own_id
            row.save(update_fields=["owner_id"])


def backwards_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("referrals", "0013_default_owner_project_brand_avatar"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="siteowneractivitylog",
            name="owner",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="site_owner_activity_feed",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.RunPython(forwards_fill_owner, backwards_noop),
        migrations.AlterField(
            model_name="siteowneractivitylog",
            name="site",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="owner_activity_logs",
                to="referrals.site",
            ),
        ),
        migrations.AlterField(
            model_name="siteowneractivitylog",
            name="owner",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="site_owner_activity_feed",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddIndex(
            model_name="siteowneractivitylog",
            index=models.Index(fields=["owner", "-created_at"], name="referrals_s_owner_i_64dcde_idx"),
        ),
    ]
