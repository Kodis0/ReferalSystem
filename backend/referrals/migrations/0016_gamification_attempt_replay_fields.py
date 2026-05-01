import secrets
import uuid

from django.db import migrations, models


def fill_attempt_public_ids_and_seeds(apps, schema_editor):
    DailyChallengeAttempt = apps.get_model("referrals", "DailyChallengeAttempt")
    for row in DailyChallengeAttempt.objects.all():
        updates = []
        if getattr(row, "public_id", None) is None:
            row.public_id = uuid.uuid4()
            updates.append("public_id")
        if getattr(row, "rng_seed", 0) == 0:
            row.rng_seed = secrets.randbelow(2**31)
            updates.append("rng_seed")
        if updates:
            row.save(update_fields=updates)


class Migration(migrations.Migration):
    dependencies = [
        ("referrals", "0015_gamification"),
    ]

    operations = [
        migrations.AddField(
            model_name="dailychallengeattempt",
            name="public_id",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="dailychallengeattempt",
            name="rng_seed",
            field=models.BigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="dailychallengeattempt",
            name="move_log",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="dailychallengeattempt",
            name="client_reported_score",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="dailychallengeattempt",
            name="validation_error",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
        migrations.RunPython(fill_attempt_public_ids_and_seeds, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="dailychallengeattempt",
            name="public_id",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
