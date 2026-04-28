# Generated manually: preset SVG avatar for «Общий проект» (is_default).

from django.db import migrations


def forwards_set_default_owner_avatar(apps, schema_editor):
    from referrals.services import default_owner_project_avatar_data_url

    Project = apps.get_model("referrals", "Project")
    url = default_owner_project_avatar_data_url()
    Project.objects.filter(is_default=True).update(avatar_data_url=url)


def backwards_noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("referrals", "0012_site_widget_verification_fields"),
    ]

    operations = [
        migrations.RunPython(forwards_set_default_owner_avatar, backwards_noop),
    ]
