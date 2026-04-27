from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0007_customuser_fio_account_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="phone",
            field=models.CharField(
                default="",
                max_length=32,
                blank=True,
                verbose_name="телефон",
            ),
        ),
    ]
