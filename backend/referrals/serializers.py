from rest_framework import serializers


class ReferralCaptureSerializer(serializers.Serializer):
    ref = serializers.CharField(max_length=64, trim_whitespace=True)
    landing_url = serializers.CharField(required=False, allow_blank=True, default="")
    utm_source = serializers.CharField(required=False, allow_blank=True, default="")
    utm_medium = serializers.CharField(required=False, allow_blank=True, default="")
    utm_campaign = serializers.CharField(required=False, allow_blank=True, default="")
