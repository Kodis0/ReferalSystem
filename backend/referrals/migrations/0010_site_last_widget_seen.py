from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("referrals", "0009_project_is_default"),
    ]

    operations = [
        migrations.AddField(
            model_name="site",
            name="last_widget_seen_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="site",
            name="last_widget_seen_origin",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]
