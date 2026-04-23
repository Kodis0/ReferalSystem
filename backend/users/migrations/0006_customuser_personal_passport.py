# Generated manually for profile / passport fields

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0005_customuser_avatar_data_url"),
    ]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="patronymic",
            field=models.CharField(blank=True, default="", max_length=150, verbose_name="отчество"),
        ),
        migrations.AddField(
            model_name="customuser",
            name="birth_date",
            field=models.DateField(blank=True, null=True, verbose_name="дата рождения"),
        ),
        migrations.AddField(
            model_name="customuser",
            name="passport_series",
            field=models.CharField(blank=True, default="", max_length=16, verbose_name="серия паспорта"),
        ),
        migrations.AddField(
            model_name="customuser",
            name="passport_number",
            field=models.CharField(blank=True, default="", max_length=32, verbose_name="номер паспорта"),
        ),
        migrations.AddField(
            model_name="customuser",
            name="passport_issued_by",
            field=models.TextField(blank=True, default="", verbose_name="кем выдан"),
        ),
        migrations.AddField(
            model_name="customuser",
            name="passport_issue_date",
            field=models.DateField(blank=True, null=True, verbose_name="дата выдачи"),
        ),
        migrations.AddField(
            model_name="customuser",
            name="passport_registration_address",
            field=models.TextField(blank=True, default="", verbose_name="адрес регистрации"),
        ),
    ]
