import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import type { User } from '../types';
import { Icon } from './Icon';

export function Login({ onLogin, expired }: { onLogin: (user: User) => void; expired: boolean }) {
  const [config, setConfig] = useState<{
    demo_enabled: boolean;
    plaintext: boolean;
    notice_emphasis_until: string;
  }>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<typeof config>('/auth/config')
      .then(setConfig)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  async function login(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      onLogin(
        await api<User>('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: username.trim(), password }),
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setPassword('');
    }
  }
  async function demo() {
    setBusy(true);
    setError('');
    try {
      onLogin(await api<User>('/auth/demo', { method: 'POST' }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const emphasized =
    config?.notice_emphasis_until && Date.now() <= Date.parse(config.notice_emphasis_until);
  return (
    <div className="login-page">
      <header className="login-top">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="radio" size={23} />
          </div>
          <span>
            MORSE<span className="brand-sub">FIELD STATION</span>
          </span>
        </div>
        <span className="eyebrow">COMMUNICATION TRAINING SYSTEM / 01</span>
      </header>
      <main className="login-layout">
        <section className="login-intro">
          <div className="eyebrow">
            <span className="status-dot" /> SIGNAL CORPS · TRAINING DIVISION
          </div>
          <h1>
            知識を、反射へ。
            <br />
            <span>一打ずつ、確かな通信へ。</span>
          </h1>
          <p>
            聴く。打つ。判断する。
            <br />
            モールス信号を身体で覚える、あなたのための訓練ステーション。
          </p>
          <div className="login-signal" aria-label="MORSE のモールス信号">
            <span>−−</span>
            <span>−−−</span>
            <span>·−·</span>
            <span>···</span>
            <span>·</span>
            <small>M</small>
            <small>O</small>
            <small>R</small>
            <small>S</small>
            <small>E</small>
          </div>
          <div className="login-capabilities">
            <div>
              <b>01 / TRANSMIT</b>
              <span>打鍵とリズムを磨く</span>
            </div>
            <div>
              <b>02 / RECEIVE</b>
              <span>音を瞬時に読み取る</span>
            </div>
            <div>
              <b>03 / REFLECT</b>
              <span>コーチと弱点を克服</span>
            </div>
          </div>
          <div className="station-stamp">
            FIELD READY<span>PRECISION OVER SPEED</span>
          </div>
        </section>
        <section className="login-card">
          <div className="login-card-label">
            <Icon name="shield" />
            <span>OPERATOR AUTHENTICATION</span>
            <span className="tiny-dot" />
          </div>
          <h2>訓練ステーションに入室</h2>
          <p>組織のアカウントでログインしてください。</p>
          {expired && (
            <p className="notice" role="status">
              セッションが終了しました。もう一度ログインしてください。
            </p>
          )}
          <form onSubmit={(e) => void login(e)}>
            <label>
              ユーザー名<span>USER ID</span>
              <input
                name="username"
                autoComplete="username"
                required
                maxLength={128}
                placeholder="ユーザー名を入力"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              パスワード<span>PASSWORD</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={1024}
                placeholder="パスワードを入力"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary login-button" disabled={busy || !config}>
              {busy ? '認証中…' : 'ログインして訓練を開始'}
              <Icon name="arrow" size={16} />
            </button>
          </form>
          {config?.demo_enabled && (
            <button
              className="button secondary demo-button"
              disabled={busy}
              onClick={() => void demo()}
            >
              体験モードで画面を確認
            </button>
          )}
          {config?.plaintext && (
            <div className={`login-notice ${emphasized ? 'emphasized' : ''}`}>
              <Icon name="shield" size={15} />
              <span>
                この環境は平文LDAP接続を使用しています。信頼できるLAN内で利用してください。
              </span>
            </div>
          )}
          <footer>
            <span className="status-dot" /> 組織アカウント認証<span>LDAP</span>
          </footer>
        </section>
      </main>
      <footer className="login-footer">
        <span>© MORSE FIELD STATION</span>
        <span>INTERNATIONAL MORSE CODE · ITU-R M.1677</span>
        <span>LEARN. PRACTICE. MASTER.</span>
      </footer>
    </div>
  );
}
