from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("referrals", "0019_referral_shop_points"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamificationprofile",
            name="streak_shields_available",
            field=models.PositiveSmallIntegerField(default=0),
        ),
    ]
