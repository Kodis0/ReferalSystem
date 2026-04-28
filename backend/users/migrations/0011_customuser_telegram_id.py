from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0010_supportticket_is_closed"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="telegram_id",
            field=models.BigIntegerField(blank=True, db_index=True, null=True, unique=True),
        ),
    ]
