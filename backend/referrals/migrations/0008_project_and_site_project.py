from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def _metadata_from_site(site):
    cfg = site.config_json if isinstance(site.config_json, dict) else {}
    name = cfg.get("display_name")
    description = cfg.get("description")
    avatar_data_url = cfg.get("avatar_data_url")
    return {
        "name": name.strip() if isinstance(name, str) else "",
        "description": description.strip() if isinstance(description, str) else "",
        "avatar_data_url": avatar_data_url.strip()
        if isinstance(avatar_data_url, str)
        else "",
    }


def forwards_backfill_projects(apps, schema_editor):
    Project = apps.get_model("referrals", "Project")
    Site = apps.get_model("referrals", "Site")
    db_alias = schema_editor.connection.alias

    for site in Site.objects.using(db_alias).filter(project_id__isnull=True).iterator():
        project = Project.objects.using(db_alias).create(
            owner_id=site.owner_id,
            **_metadata_from_site(site),
        )
        Project.objects.using(db_alias).filter(pk=project.pk).update(
            created_at=site.created_at,
            updated_at=site.updated_at,
        )
        Site.objects.using(db_alias).filter(pk=site.pk).update(project_id=project.pk)


def backwards_unset_projects(apps, schema_editor):
    Site = apps.get_model("referrals", "Site")
    Project = apps.get_model("referrals", "Project")
    db_alias = schema_editor.connection.alias

    Site.objects.using(db_alias).update(project_id=None)
    Project.objects.using(db_alias).all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("referrals", "0007_site_lifecycle_and_membership"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Project",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("name", models.CharField(blank=True, default="", max_length=200)),
                ("description", models.TextField(blank=True, default="")),
                ("avatar_data_url", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "owner",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="referral_projects",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddField(
            model_name="site",
            name="project",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="sites",
                to="referrals.project",
            ),
        ),
        migrations.RunPython(
            forwards_backfill_projects,
            backwards_unset_projects,
        ),
    ]
