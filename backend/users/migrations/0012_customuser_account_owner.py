import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0011_customuser_telegram_id"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="account_owner",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="account_additional_users",
                to=settings.AUTH_USER_MODEL,
                verbose_name="владелец аккаунта",
            ),
        ),
    ]
