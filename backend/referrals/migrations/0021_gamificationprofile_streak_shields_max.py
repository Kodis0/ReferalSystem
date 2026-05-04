from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("referrals", "0020_gamificationprofile_streak_shields_available"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamificationprofile",
            name="streak_shields_max",
            field=models.PositiveSmallIntegerField(default=3),
        ),
    ]
