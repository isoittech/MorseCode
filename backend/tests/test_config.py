import pytest
from pydantic import ValidationError

from backend.app.config import Settings


def test_secrets_and_invalid_inputs_are_not_printed():
    secret = "secret-unique-never-show"
    settings = Settings(
        _env_file=None,
        morse_admin_password=secret,
        openai_api_key=secret,
        anthropic_api_key=secret,
        azure_openai_api_key=secret,
        aws_access_key_id=secret,
        aws_secret_access_key=secret,
        ldap_bind_dn="cn=test",
        ldap_bind_credentials=secret,
    )
    assert secret not in repr(settings)
    assert secret not in settings.model_dump_json()
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, morse_admin_password="too-short", openai_api_key=secret)
    assert "too-short" not in str(error.value)
    assert secret not in str(error.value)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://example.com",
        "https://user:secret@example.com",
        "https://example.com/?key=secret",
        "https://example.com/openai/deployments/model",
    ],
)
def test_azure_rejects_unsafe_or_wrong_endpoint_shapes(endpoint):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, morse_ai_provider="azure", azure_openai_endpoint=endpoint)


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://resource.openai.azure.com",
        "https://resource.openai.azure.com/",
        "https://resource.openai.azure.com/openai/v1/",
    ],
)
def test_azure_normalizes_resource_and_v1_endpoints(endpoint):
    settings = Settings(_env_file=None, morse_ai_provider="azure", azure_openai_endpoint=endpoint)
    assert settings.azure_base_url == "https://resource.openai.azure.com/openai/v1/"


def test_bedrock_requires_complete_explicit_credentials_only_when_selected():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, morse_ai_provider="bedrock", aws_access_key_id="access-key-only")
    Settings(_env_file=None, morse_ai_provider="codex", aws_access_key_id="unused-key")


@pytest.mark.parametrize("field", ["morse_auth_mode", "morse_ai_provider"])
def test_unknown_modes_fail_early(field):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: "typo"})
