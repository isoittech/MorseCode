import ssl
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from ldap3 import Tls
from ldap3.core.exceptions import LDAPSocketOpenError

from backend.app.auth import AuthenticationFailed, DirectoryUnavailable, authenticate
from backend.app.config import Settings


def settings(**kwargs):
    return Settings(
        _env_file=None,
        ldap_user_search_base="ou=People,dc=example,dc=org",
        ldap_allow_plaintext=True,
        **kwargs,
    )


class FakeConnection:
    instances = []
    bind_ok = True
    found = True

    def __init__(self, server, **kwargs):
        self.kwargs = kwargs
        self.result = {"result": 0}
        self.entries = []
        self.closed = False
        self.search_args = None
        self.instances.append(self)

    def open(self):
        pass

    def bind(self):
        if self.kwargs["password"] and not self.bind_ok:
            self.result = {"result": 49}
            return False
        return True

    def start_tls(self):
        return True

    def search(self, *args, **kwargs):
        self.search_args = (args, kwargs)
        if self.found:
            self.entries = [
                SimpleNamespace(
                    entry_dn="uid=tester,ou=People,dc=example,dc=org",
                    entry_attributes_as_dict={"uid": ["tester"], "displayName": ["訓練生"]},
                )
            ]

    def unbind(self):
        self.closed = True


@pytest.fixture(autouse=True)
def fake_ldap():
    FakeConnection.instances = []
    FakeConnection.bind_ok = True
    FakeConnection.found = True
    with patch("backend.app.auth.Connection", FakeConnection):
        yield


def test_username_search_then_binds_resolved_dn():
    user = authenticate(settings(), "tester", "secret")
    assert user["id"] == "ldap:tester"
    assert user["display_name"] == "訓練生"
    search, login = FakeConnection.instances
    assert search.kwargs["password"] is None
    assert search.search_args[0][1] == "(uid=tester)"
    assert login.kwargs["user"] == "uid=tester,ou=People,dc=example,dc=org"
    assert login.kwargs["password"] == "secret"
    assert all(c.closed for c in FakeConnection.instances)
    assert "password" not in user


def test_ldap_filter_injection_is_escaped():
    authenticate(settings(), "*)(uid=*)", "secret")
    assert FakeConnection.instances[0].search_args[0][1] == r"(uid=\2a\29\28uid=\2a\29)"


def test_empty_password_cannot_anonymously_authenticate():
    with pytest.raises(AuthenticationFailed):
        authenticate(settings(), "tester", "")
    assert not FakeConnection.instances


@pytest.mark.parametrize("mode", ["local", "hybrid"])
def test_admin_uses_env_password_without_ldap_or_profile_secrets(mode):
    config = settings(morse_auth_mode=mode, morse_admin_password="独立した管理者のパスワード123")
    user = authenticate(config, " admin ", "独立した管理者のパスワード123")
    assert user == {
        "id": "local:admin",
        "username": "admin",
        "display_name": "admin",
        "demo": False,
    }
    assert not FakeConnection.instances


@pytest.mark.parametrize("password", ["", "wrong", "test-admin-password "])
def test_admin_failure_never_falls_back_to_ldap(password):
    config = settings(morse_admin_password="test-admin-password")
    with pytest.raises(AuthenticationFailed):
        authenticate(config, "admin", password)
    assert not FakeConnection.instances


def test_admin_has_no_default_password_and_local_mode_never_uses_ldap():
    config = Settings(_env_file=None, morse_auth_mode="local", ldap_url="", ldap_search_filter="")
    assert not config.admin_enabled
    for username in ("admin", "tester"):
        with pytest.raises(AuthenticationFailed):
            authenticate(config, username, "test-admin-password")
    assert not FakeConnection.instances


def test_ldap_only_keeps_directory_authentication_for_admin_name():
    config = settings(morse_auth_mode="ldap", morse_admin_password="local-password-disabled")
    user = authenticate(config, "admin", "directory-password")
    assert user["id"].startswith("ldap:")
    assert len(FakeConnection.instances) == 2


def test_wrong_password_and_unknown_user_are_rejected():
    FakeConnection.bind_ok = False
    with pytest.raises(AuthenticationFailed):
        authenticate(settings(), "tester", "wrong")
    FakeConnection.found = False
    with pytest.raises(AuthenticationFailed):
        authenticate(settings(), "absent", "secret")


def test_plaintext_requires_explicit_opt_in():
    config = settings()
    config.ldap_allow_plaintext = False
    with pytest.raises(DirectoryUnavailable, match="暗号化"):
        authenticate(config, "tester", "secret")


def test_tls_verifies_certificates_by_default():
    with patch("backend.app.auth.Tls", wraps=Tls) as tls:
        authenticate(settings(ldap_url="ldaps://localhost:636"), "tester", "secret")
    assert tls.call_args.kwargs["validate"] == ssl.CERT_REQUIRED


def test_tls_failure_is_not_downgraded_to_plaintext():
    with (
        patch.object(FakeConnection, "start_tls", return_value=False),
        pytest.raises(DirectoryUnavailable),
    ):
        authenticate(settings(ldap_starttls=True), "tester", "secret")


def test_service_bind_failure_is_not_reported_as_bad_user_password():
    FakeConnection.bind_ok = False
    with pytest.raises(DirectoryUnavailable):
        authenticate(
            settings(ldap_bind_dn="cn=service", ldap_bind_credentials="secret"), "tester", "secret"
        )


def test_dn_login_cannot_escape_search_base():
    with pytest.raises(AuthenticationFailed):
        authenticate(
            settings(ldap_login_uses_username=False), "uid=tester,dc=other,dc=org", "secret"
        )


def test_directory_failure_has_no_internal_details():
    with (
        patch.object(FakeConnection, "open", side_effect=LDAPSocketOpenError("internal details")),
        pytest.raises(DirectoryUnavailable) as failure,
    ):
        authenticate(settings(), "tester", "secret")
    assert "internal details" not in str(failure.value)
