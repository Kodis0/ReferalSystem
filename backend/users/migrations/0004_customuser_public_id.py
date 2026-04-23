import secrets

from django.db import migrations, models


def generate_unique_public_id(UserModel):
    while True:
        candidate = secrets.token_hex(4)[:7]
        if not UserModel.objects.filter(public_id=candidate).exists():
            return candidate


def fill_public_ids(apps, schema_editor):
    UserModel = apps.get_model("users", "CustomUser")
    for user in UserModel.objects.filter(models.Q(public_id__isnull=True) | models.Q(public_id="")).iterator():
        user.public_id = generate_unique_public_id(UserModel)
        user.save(update_fields=["public_id"])


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0003_alter_customuser_username"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="public_id",
            field=models.CharField(blank=True, editable=False, max_length=7, null=True),
        ),
        migrations.RunPython(fill_public_ids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="customuser",
            name="public_id",
            field=models.CharField(blank=True, editable=False, max_length=7, unique=True),
        ),
    ]
