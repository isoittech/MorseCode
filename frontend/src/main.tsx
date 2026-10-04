import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { createRoot } from 'react-dom/client';
import { Login } from './components/Login';
import { api, ApiError, errorMessage, newId } from './lib/api';
import type { User } from './types';
import './styles.css';

// Some SDKs use randomUUID internally. HTTPS-only availability must not break LAN HTTP.
if (!crypto.randomUUID) Object.defineProperty(crypto, 'randomUUID', { value: newId });
const Workspace = lazy(() => import('./Workspace'));

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error.name, info.componentStack);
  }
  render() {
    if (this.state.failed)
      return (
        <div className="app-error" role="alert">
          <h1>画面の表示に失敗しました</h1>
          <p>保存済みの訓練記録は保持されています。</p>
          <button className="button primary" onClick={() => window.location.reload()}>
            再読み込み
          </button>
        </div>
      );
    return this.props.children;
  }
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<User>('/auth/me')
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) setError(errorMessage(e));
      })
      .finally(() => setLoading(false));
    const expire = () => {
      setUser(null);
      setExpired(true);
    };
    window.addEventListener('morse:session-expired', expire);
    return () => window.removeEventListener('morse:session-expired', expire);
  }, []);
  if (loading)
    return (
      <div className="app-loading">
        <b>MORSE / FIELD STATION</b>
        <p>接続を確認しています…</p>
      </div>
    );
  if (error)
    return (
      <div className="app-error" role="alert">
        <h1>サーバーに接続できません</h1>
        <p>{error}</p>
        <button className="button primary" onClick={() => window.location.reload()}>
          再接続
        </button>
      </div>
    );
  return user ? (
    <Suspense fallback={<div className="app-loading">訓練ステーションを準備中…</div>}>
      <Workspace
        key={user.id}
        user={user}
        onLogout={() => {
          setUser(null);
          setExpired(false);
        }}
      />
    </Suspense>
  ) : (
    <Login onLogin={setUser} expired={expired} />
  );
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
