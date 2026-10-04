from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT / ".env", extra="ignore", hide_input_in_errors=True
    )

    morse_host: str = "0.0.0.0"
    morse_port: int = Field(default=7631, ge=1, le=65535)
    morse_database_path: Path = ROOT / ".local/morse.sqlite3"
    morse_demo_enabled: bool = False
    morse_cookie_secure: bool = False
    morse_codex_home: Path = ROOT / ".local/coach-codex"
    morse_auth_mode: Literal["ldap", "local", "hybrid"] = "hybrid"
    morse_admin_password: SecretStr = SecretStr("")
    morse_ai_provider: Literal["codex", "openai", "azure", "bedrock", "anthropic"] = "codex"
    morse_ai_timeout_seconds: int = Field(default=90, ge=5, le=300)
    morse_ai_max_concurrent: int = Field(default=2, ge=1, le=8)
    morse_ai_max_output_tokens: int = Field(default=2048, ge=128, le=16384)
    openai_api_key: SecretStr = SecretStr("")
    openai_model: str = ""
    azure_openai_api_key: SecretStr = SecretStr("")
    azure_openai_endpoint: str = ""
    azure_openai_deployment: str = ""
    anthropic_api_key: SecretStr = SecretStr("")
    anthropic_model: str = ""
    bedrock_model_id: str = ""
    aws_region: str = ""
    aws_default_region: str = ""
    aws_profile: str = ""
    aws_access_key_id: SecretStr = SecretStr("")
    aws_secret_access_key: SecretStr = SecretStr("")
    aws_session_token: SecretStr = SecretStr("")
    ldap_url: str = "ldap://localhost:389"
    ldap_bind_dn: str = ""
    ldap_bind_credentials: SecretStr = SecretStr("")
    ldap_user_search_base: str = ""
    ldap_search_filter: str = "uid={{username}}"
    ldap_ca_cert_path: str = ""
    ldap_tls_reject_unauthorized: bool = True
    ldap_starttls: bool = False
    ldap_login_uses_username: bool = True
    ldap_allow_plaintext: bool = False
    ldap_connect_timeout_seconds: int = Field(default=5, ge=1, le=30)
    ldap_login_notice_emphasis_until: str = ""
    ldap_id: str = "uid"
    ldap_username: str = "uid"
    ldap_email: str = ""
    ldap_full_name: str = "displayName"
    codex_command: str = "codex"
    codex_model: str = ""
    codex_timeout_seconds: int = Field(default=90, ge=5, le=300)
    codex_max_concurrent: int = Field(default=2, ge=1, le=8)

    @model_validator(mode="after")
    def validate_ldap(self):
        if not self.ldap_enabled:
            return self
        url = urlsplit(self.ldap_url)
        if url.scheme not in {"ldap", "ldaps"} or not url.hostname:
            raise ValueError("LDAP_URL は ldap:// または ldaps:// で指定してください")
        if self.ldap_starttls and url.scheme == "ldaps":
            raise ValueError("LDAPS と STARTTLS は同時に指定できません")
        if "{{username}}" not in self.ldap_search_filter:
            raise ValueError("LDAP_SEARCH_FILTER に {{username}} が必要です")
        if bool(self.ldap_bind_dn) != bool(self.ldap_bind_credentials.get_secret_value()):
            raise ValueError("LDAP_BIND_DN と LDAP_BIND_CREDENTIALS は組で指定してください")
        return self

    @model_validator(mode="after")
    def validate_connections(self):
        password = self.morse_admin_password.get_secret_value()
        if password and (len(password) < 12 or len(password) > 1024 or not password.strip()):
            raise ValueError("MORSE_ADMIN_PASSWORD は12〜1024文字で設定してください")
        if self.morse_ai_provider == "azure" and self.azure_openai_endpoint:
            url = urlsplit(self.azure_openai_endpoint)
            if (
                url.scheme != "https"
                or not url.hostname
                or url.username
                or url.password
                or url.query
                or url.fragment
                or url.path.rstrip("/") not in ("", "/openai/v1")
            ):
                raise ValueError(
                    "AZURE_OPENAI_ENDPOINT はHTTPSのリソースURLか /openai/v1/ のURLで指定してください"
                )
        if self.morse_ai_provider == "bedrock" and bool(
            self.aws_access_key_id.get_secret_value()
        ) != bool(self.aws_secret_access_key.get_secret_value()):
            raise ValueError("AWS_ACCESS_KEY_ID と AWS_SECRET_ACCESS_KEY は組で指定してください")
        return self

    @property
    def ldap_enabled(self) -> bool:
        return self.morse_auth_mode in {"ldap", "hybrid"}

    @property
    def admin_enabled(self) -> bool:
        return self.morse_auth_mode in {"local", "hybrid"} and bool(
            self.morse_admin_password.get_secret_value()
        )

    @property
    def azure_base_url(self) -> str:
        endpoint = self.azure_openai_endpoint.rstrip("/")
        return endpoint + ("/" if endpoint.endswith("/openai/v1") else "/openai/v1/")

    @property
    def ldap_plaintext(self) -> bool:
        return self.ldap_url.startswith("ldap://") and not self.ldap_starttls
