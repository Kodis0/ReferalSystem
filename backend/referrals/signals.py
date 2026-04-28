from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.dispatch import receiver

from referrals.services import ensure_default_owner_project


@receiver(post_save, sender=get_user_model())
def ensure_default_owner_project_on_user_created(sender, instance, created, **kwargs):
    if not created:
        return
    ensure_default_owner_project(instance)
