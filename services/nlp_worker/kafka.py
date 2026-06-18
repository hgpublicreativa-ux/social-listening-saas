import os
import ssl


def kafka_config() -> dict:
    """Returns extra kwargs for AIOKafkaProducer/Consumer for Upstash SASL or plain."""
    user = os.getenv("KAFKA_SASL_USERNAME")
    pw   = os.getenv("KAFKA_SASL_PASSWORD")
    if user and pw:
        ctx = ssl.create_default_context()
        return dict(
            security_protocol="SASL_SSL",
            sasl_mechanism="SCRAM-SHA-256",
            sasl_plain_username=user,
            sasl_plain_password=pw,
            ssl_context=ctx,
        )
    return {}
