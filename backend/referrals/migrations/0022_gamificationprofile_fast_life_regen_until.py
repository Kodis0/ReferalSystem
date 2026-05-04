from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("referrals", "0021_gamificationprofile_streak_shields_max"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamificationprofile",
            name="fast_life_regen_until",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
