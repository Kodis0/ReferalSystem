from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0012_customuser_account_owner"),
    ]

    operations = [
        migrations.AddField(
            model_name="supportticket",
            name="closed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
