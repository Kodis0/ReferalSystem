from django.db import migrations, models


def backfill_last_streak_increment_date(apps, schema_editor):
    GamificationProfile = apps.get_model("referrals", "GamificationProfile")
    for row in GamificationProfile.objects.exclude(last_activity_date__isnull=True):
        row.last_streak_increment_date = row.last_activity_date
        row.save(update_fields=["last_streak_increment_date"])


class Migration(migrations.Migration):
    dependencies = [
        ("referrals", "0016_gamification_attempt_replay_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamificationprofile",
            name="lives_current",
            field=models.PositiveSmallIntegerField(default=5),
        ),
        migrations.AddField(
            model_name="gamificationprofile",
            name="lives_max",
            field=models.PositiveSmallIntegerField(default=5),
        ),
        migrations.AddField(
            model_name="gamificationprofile",
            name="next_life_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="gamificationprofile",
            name="last_life_refill_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="gamificationprofile",
            name="last_streak_increment_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_last_streak_increment_date, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="dailychallengeattempt",
            name="uniq_daily_challenge_attempt_user_date",
        ),
        migrations.AddIndex(
            model_name="dailychallengeattempt",
            index=models.Index(fields=["user", "challenge_date"], name="referrals_da_user_date_idx"),
        ),
    ]
