import ssl
from urllib.parse import urlsplit

from ldap3 import BASE, NONE, SUBTREE, Connection, Server, Tls
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars
from ldap3.utils.dn import parse_dn

from .config import Settings


class AuthenticationFailed(Exception):
    pass


class DirectoryUnavailable(Exception):
    pass


def authenticate(settings: Settings, username: str, password: str) -> dict:
    # Empty passwords may become anonymous binds on some directories.
    if not username.strip() or not password:
        raise AuthenticationFailed
    if settings.ldap_plaintext and not settings.ldap_allow_plaintext:
        raise DirectoryUnavailable("暗号化されていないLDAP接続は無効です")
    if not settings.ldap_user_search_base:
        raise DirectoryUnavailable("LDAPの検索ベースが未設定です")

    url = urlsplit(settings.ldap_url)
    tls = Tls(
        validate=ssl.CERT_REQUIRED if settings.ldap_tls_reject_unauthorized else ssl.CERT_NONE,
        ca_certs_file=settings.ldap_ca_cert_path or None,
    )
    server = Server(
        url.hostname,
        port=url.port or (636 if url.scheme == "ldaps" else 389),
        use_ssl=url.scheme == "ldaps",
        tls=tls,
        get_info=NONE,
        connect_timeout=settings.ldap_connect_timeout_seconds,
    )
    connections: list[Connection] = []

    def bind(identity: str | None, secret: str | None, *, user_bind=False) -> Connection:
        conn = Connection(
            server,
            user=identity,
            password=secret,
            receive_timeout=settings.ldap_connect_timeout_seconds,
            raise_exceptions=False,
            auto_referrals=False,
        )
        connections.append(conn)
        conn.open()
        if settings.ldap_starttls and not conn.start_tls():
            raise DirectoryUnavailable("LDAPのTLS接続に失敗しました")
        if not conn.bind():
            if user_bind and conn.result.get("result") == 49:
                raise AuthenticationFailed
            raise DirectoryUnavailable("LDAPの接続用認証に失敗しました")
        return conn

    try:
        search_conn = bind(settings.ldap_bind_dn or None, settings.ldap_bind_credentials or None)
        filter_value = settings.ldap_search_filter.replace(
            "{{username}}", escape_filter_chars(username.strip())
        )
        if not filter_value.startswith("("):
            filter_value = f"({filter_value})"
        attributes = list(
            dict.fromkeys(
                a
                for a in [
                    settings.ldap_id,
                    settings.ldap_username,
                    settings.ldap_full_name,
                    settings.ldap_email,
                ]
                if a
            )
        )
        search_base = settings.ldap_user_search_base
        search_scope = SUBTREE
        if not settings.ldap_login_uses_username:
            supplied_dn = [(a.casefold(), v.casefold()) for a, v, _ in parse_dn(username.strip())]
            base_dn = [(a.casefold(), v.casefold()) for a, v, _ in parse_dn(search_base)]
            if len(supplied_dn) <= len(base_dn) or supplied_dn[-len(base_dn) :] != base_dn:
                raise AuthenticationFailed
            search_base, search_scope, filter_value = username.strip(), BASE, "(objectClass=*)"
        search_conn.search(
            search_base,
            filter_value,
            search_scope=search_scope,
            attributes=attributes,
            size_limit=2,
            time_limit=settings.ldap_connect_timeout_seconds,
        )
        if search_conn.result.get("result") not in (0, 4):
            raise DirectoryUnavailable("LDAPのユーザー検索に失敗しました")
        if len(search_conn.entries) != 1:
            raise AuthenticationFailed
        entry = search_conn.entries[0]
        # The search locates the actual DN. Never construct a DN from unchecked input.
        bind(entry.entry_dn, password, user_bind=True)
        values = entry.entry_attributes_as_dict

        def attr(name: str, fallback="") -> str:
            value = values.get(name) or [fallback]
            return str(value[0]) if isinstance(value, list) else str(value)

        uid = attr(settings.ldap_id)
        if not uid:
            raise DirectoryUnavailable("LDAPのユーザーID属性が見つかりません")
        return {
            "id": f"ldap:{uid}",
            "username": attr(settings.ldap_username, username),
            "display_name": attr(settings.ldap_full_name, username),
            "demo": False,
        }
    except (LDAPException, OSError, ValueError) as exc:
        raise DirectoryUnavailable(
            "LDAPサーバーに接続できません。管理者に接続設定を確認してください"
        ) from exc
    finally:
        for conn in connections:
            conn.unbind()
