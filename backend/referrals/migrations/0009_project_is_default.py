from django.conf import settings
from django.db import migrations, models


DEFAULT_OWNER_PROJECT_NAME = "Общий проект"


def forwards_create_default_projects(apps, schema_editor):
    Project = apps.get_model("referrals", "Project")
    app_label, model_name = settings.AUTH_USER_MODEL.split(".")
    User = apps.get_model(app_label, model_name)
    db_alias = schema_editor.connection.alias

    existing_owner_ids = set(
        Project.objects.using(db_alias)
        .filter(is_default=True)
        .values_list("owner_id", flat=True)
    )
    missing_user_ids = (
        User.objects.using(db_alias)
        .exclude(pk__in=existing_owner_ids)
        .values_list("pk", flat=True)
    )
    Project.objects.using(db_alias).bulk_create(
        [
            Project(
                owner_id=user_id,
                is_default=True,
                name=DEFAULT_OWNER_PROJECT_NAME,
                description="",
                avatar_data_url="",
            )
            for user_id in missing_user_ids
        ]
    )


def backwards_unset_default_projects(apps, schema_editor):
    Project = apps.get_model("referrals", "Project")
    db_alias = schema_editor.connection.alias
    Project.objects.using(db_alias).filter(
        is_default=True,
        name=DEFAULT_OWNER_PROJECT_NAME,
    ).delete()


class Migration(migrations.Migration):
    # PostgreSQL can fail to create the index for a new non-null field with a
    # default inside one atomic migration because the table still has pending
    # trigger events in that same transaction.
    atomic = False

    dependencies = [
        ("referrals", "0008_project_and_site_project"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="is_default",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.RunPython(
            forwards_create_default_projects,
            backwards_unset_default_projects,
        ),
    ]
