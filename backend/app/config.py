from pathlib import Path
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    morse_host: str = "0.0.0.0"
    morse_port: int = Field(default=7631, ge=1, le=65535)
    morse_database_path: Path = ROOT / ".local/morse.sqlite3"
    morse_demo_enabled: bool = False
    morse_cookie_secure: bool = False
    morse_codex_home: Path = ROOT / ".local/coach-codex"
    ldap_url: str = "ldap://localhost:389"
    ldap_bind_dn: str = ""
    ldap_bind_credentials: str = ""
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
        url = urlsplit(self.ldap_url)
        if url.scheme not in {"ldap", "ldaps"} or not url.hostname:
            raise ValueError("LDAP_URL は ldap:// または ldaps:// で指定してください")
        if self.ldap_starttls and url.scheme == "ldaps":
            raise ValueError("LDAPS と STARTTLS は同時に指定できません")
        if "{{username}}" not in self.ldap_search_filter:
            raise ValueError("LDAP_SEARCH_FILTER に {{username}} が必要です")
        if bool(self.ldap_bind_dn) != bool(self.ldap_bind_credentials):
            raise ValueError("LDAP_BIND_DN と LDAP_BIND_CREDENTIALS は組で指定してください")
        return self

    @property
    def ldap_plaintext(self) -> bool:
        return self.ldap_url.startswith("ldap://") and not self.ldap_starttls
