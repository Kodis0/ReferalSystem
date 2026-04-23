from django.db import migrations, models


def backfill_fio(apps, schema_editor):
    CustomUser = apps.get_model("users", "CustomUser")
    for u in CustomUser.objects.iterator():
        parts = [getattr(u, "last_name", None) or "", getattr(u, "first_name", None) or "", getattr(u, "patronymic", None) or ""]
        line = " ".join(p.strip() for p in parts if isinstance(p, str) and p.strip())
        if line and not (getattr(u, "fio", None) or "").strip():
            u.fio = line
            u.save(update_fields=["fio"])


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0006_customuser_personal_passport"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="fio",
            field=models.CharField(blank=True, default="", max_length=400, verbose_name="ФИО"),
        ),
        migrations.AddField(
            model_name="customuser",
            name="account_type",
            field=models.CharField(
                blank=True,
                db_index=True,
                default="individual",
                max_length=24,
                verbose_name="тип аккаунта",
            ),
        ),
        migrations.RunPython(backfill_fio, migrations.RunPython.noop),
    ]
