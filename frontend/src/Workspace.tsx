import { useCallback, useEffect, useRef, useState } from 'react';
import { Coach, CoachProvider } from './components/Coach';
import { Icon } from './components/Icon';
import { Introduction } from './components/Introduction';
import { Progress, Reference, SettingsForm } from './components/Library';
import { Training } from './components/Training';
import { Walkthrough } from './components/Walkthrough';
import './components/onboarding.css';
import { api, errorMessage } from './lib/api';
import {
  MODE_LABELS,
  type Exercise,
  type Mode,
  type Page,
  type Preferences,
  type Result,
  type Stats,
  type User,
} from './types';

const NAV: { id: Page; label: string; icon: string; tag?: string }[] = [
  { id: 'send', label: '送信訓練', icon: 'send', tag: 'TX' },
  { id: 'receive', label: '受信訓練', icon: 'receive', tag: 'RX' },
  { id: 'knowledge', label: '知識ドリル', icon: 'book', tag: '01' },
  { id: 'decision', label: '判断ドリル', icon: 'bolt', tag: '02' },
  { id: 'progress', label: '訓練記録', icon: 'chart' },
  { id: 'reference', label: '符号リファレンス', icon: 'grid' },
  { id: 'settings', label: '訓練設定', icon: 'settings' },
  { id: 'introduction', label: 'はじめてのモールス', icon: 'book' },
];

export default function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <CoachProvider>
      <Station user={user} onLogout={onLogout} />
    </CoachProvider>
  );
}

function Station({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [page, setPage] = useState<Page>('send');
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [liveSignal, setLiveSignal] = useState('');
  const [helpRequest, setHelpRequest] = useState(0);
  const [tourActive, setTourActive] = useState(false);
  const [tourPending, setTourPending] = useState(false);
  const [onboardingError, setOnboardingError] = useState('');
  const requestSequence = useRef(0);
  const navRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const loadExercise = useCallback(async (mode: Mode) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError('');
    setLiveSignal('');
    try {
      const next = await api<Exercise>(`/exercises/next?mode=${mode}`, { method: 'POST' });
      if (requestSequence.current !== sequence) return false;
      setExercise(next);
      return true;
    } catch (e) {
      if (requestSequence.current === sequence) setError(errorMessage(e));
      return false;
    } finally {
      if (requestSequence.current === sequence) setLoading(false);
    }
  }, []);
  const initialize = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const [p, s] = await Promise.all([api<Preferences>('/preferences'), api<Stats>('/stats')]);
      setPreferences(p);
      setStats(s);
      if (p.onboarding_seen) {
        setPage('send');
        await loadExercise('send');
      } else {
        setPage('introduction');
        setLoading(false);
      }
    } catch (e) {
      setError(errorMessage(e));
      setLoading(false);
    }
  }, [loadExercise]);
  useEffect(() => {
    void initialize();
  }, [initialize]);

  async function saveOnboardingSeen() {
    setOnboardingError('');
    try {
      await api<Preferences>('/onboarding/seen', { method: 'POST' });
    } catch (e) {
      setOnboardingError(
        '案内の表示済み状態を保存できませんでした。練習は続けられます。' + errorMessage(e),
      );
    }
  }
  function rememberOnboarding() {
    if (!preferences || preferences.onboarding_seen) return;
    setPreferences({ ...preferences, onboarding_seen: true });
    void saveOnboardingSeen();
  }
  function navigate(next: Page) {
    if (next !== 'introduction') rememberOnboarding();
    setPage(next);
    setError('');
    if (next in MODE_LABELS) void loadExercise(next as Mode);
    else {
      requestSequence.current++;
      setLoading(false);
      setLiveSignal('');
    }
    mainRef.current?.scrollTo({ top: 0 });
  }
  async function startTour() {
    rememberOnboarding();
    setTourPending(true);
    setPage('send');
    const loaded = await loadExercise('send');
    setTourPending(false);
    if (loaded) setTourActive(true);
  }
  const endTour = useCallback(() => {
    setTourActive(false);
    mainRef.current?.scrollTo({ top: 0 });
    mainRef.current?.scrollIntoView({ block: 'start' });
    mainRef.current?.focus({ preventScroll: true });
  }, []);
  function complete(value: Result) {
    setResult(value);
    void api<Stats>('/stats')
      .then(setStats)
      .catch((e) => setError('判定は保存済みです。成績の再取得に失敗しました：' + errorMessage(e)));
  }
  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
      onLogout();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const todayProgress =
    stats && preferences ? Math.min(100, (stats.today / preferences.daily_goal) * 100) : 0;
  return (
    <div className="station-app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="radio" size={22} />
          </div>
          <span>
            MORSE<span className="brand-sub">FIELD STATION</span>
          </span>
          <span className="brand-divider" />
          <span className="topbar-title">通信訓練ステーション</span>
        </div>
        <div className="station-indicators">
          <span>INTL. MORSE</span>
          <span>
            <span className="status-dot" />
            {user.demo ? 'DEMO SESSION' : 'TRAINING SESSION'}
          </span>
          <span className="station-number">STATION / 01</span>
        </div>
      </header>
      <div className="station-layout">
        <aside className="sidebar">
          <div className="sidebar-section-label">
            TRAINING MENU<span>01 — 04</span>
          </div>
          <nav aria-label="訓練メニュー" ref={navRef}>
            {NAV.map((item) => (
              <div
                key={item.id}
                className={
                  item.id === 'progress' || item.id === 'introduction' ? 'nav-section-break' : ''
                }
              >
                {item.id === 'progress' && (
                  <div className="sidebar-section-label">FIELD RESOURCES</div>
                )}
                {item.id === 'introduction' && (
                  <div className="sidebar-section-label">GETTING STARTED</div>
                )}
                <button
                  className={`nav-item ${page === item.id ? 'active' : ''}`}
                  data-tour={item.id === 'send' ? 'send-menu' : undefined}
                  aria-current={page === item.id ? 'page' : undefined}
                  disabled={tourPending || tourActive || !preferences}
                  onClick={() => navigate(item.id)}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  {item.tag && <small>{item.tag}</small>}
                  {page === item.id && !item.tag && <Icon name="chevron" size={13} />}
                </button>
              </div>
            ))}
            <div>
              <button
                className="nav-item"
                onClick={() => void startTour()}
                disabled={tourPending || tourActive || !preferences}
              >
                <Icon name="target" size={17} />
                <span>操作ガイド</span>
              </button>
            </div>
          </nav>
          <div className="daily-goal">
            <header>
              <Icon name="target" size={16} />
              <span>本日の訓練目標</span>
            </header>
            <div>
              <b>{stats?.today ?? 0}</b>
              <span>/ {preferences?.daily_goal ?? '—'} 課題</span>
              <small>{Math.round(todayProgress)}%</small>
            </div>
            <div className="progress-track">
              <i style={{ width: `${todayProgress}%` }} />
            </div>
            <p>
              {todayProgress >= 100
                ? '目標達成。積み重ねが力になる。'
                : '毎日の積み重ねが、確かな技術に。'}
            </p>
          </div>
          <div className="sidebar-bottom">
            <div className="operator">
              <div className="operator-avatar">
                {(user.display_name || user.username).slice(0, 1).toUpperCase()}
              </div>
              <div>
                <span>OPERATOR</span>
                <b>{user.display_name}</b>
              </div>
              <button className="icon-button" aria-label="ログアウト" onClick={() => void logout()}>
                <Icon name="logout" size={17} />
              </button>
            </div>
            <div className="sidebar-version">
              <span>FIELD STATION v0.1</span>
              <span>● READY</span>
            </div>
          </div>
        </aside>
        <main className="training-main" id="main" ref={mainRef} tabIndex={-1}>
          <div className="breadcrumb">
            <span>TRAINING GROUND</span>
            <Icon name="chevron" size={11} />
            <b>{NAV.find((item) => item.id === page)?.label}</b>
            <span className="breadcrumb-line" />
          </div>
          {onboardingError && (
            <div className="error workspace-error" role="alert">
              {onboardingError}
              <button onClick={() => void saveOnboardingSeen()}>表示済み状態の保存を再試行</button>
            </div>
          )}
          {error && (
            <div className="error workspace-error" role="alert">
              {error}
              <button
                onClick={() => {
                  if (!stats || !preferences) void initialize();
                  else if (page in MODE_LABELS) void loadExercise(page as Mode);
                  else
                    void api<Stats>('/stats')
                      .then(setStats)
                      .then(() => setError(''))
                      .catch((e) => setError(errorMessage(e)));
                }}
              >
                再読み込み
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-panel">
              <div className="loading-signal">· − ·</div>
              <p>訓練課題を準備しています…</p>
            </div>
          ) : page === 'introduction' ? (
            <Introduction
              firstVisit={!preferences?.onboarding_seen}
              onTour={() => void startTour()}
              onSkip={() => navigate('send')}
              busy={tourPending}
            />
          ) : page === 'reference' ? (
            <Reference />
          ) : page === 'progress' && stats && preferences ? (
            <Progress stats={stats} preferences={preferences} />
          ) : page === 'settings' && preferences ? (
            <SettingsForm preferences={preferences} onSave={setPreferences} />
          ) : exercise && page === exercise.mode ? (
            <Training
              key={exercise.id}
              exercise={exercise}
              result={result?.id === exercise.id ? result : null}
              onResult={complete}
              onNext={() => void loadExercise(page as Mode)}
              onHelp={() => setHelpRequest((n) => n + 1)}
              onLive={setLiveSignal}
              loading={loading}
              targetAccuracy={preferences?.target_accuracy ?? 90}
              paused={tourActive || tourPending}
            />
          ) : (
            !error && <div className="empty-state">メニューから訓練を選択してください。</div>
          )}
        </main>
        <Coach
          exercise={page in MODE_LABELS && !loading && !tourActive ? exercise : null}
          result={page === 'introduction' || tourActive ? null : result}
          liveSignal={tourActive ? '' : liveSignal}
          helpRequest={helpRequest}
          introductory={page === 'introduction'}
        />
      </div>
      <footer className="station-footer">
        <span>
          <span className="tiny-dot" /> MORSE TRAINING SYSTEM
        </span>
        <span>PRECISION · RHYTHM · READINESS</span>
        <span>国際モールス / LATIN + NUMERIC</span>
      </footer>
      {tourActive && exercise && !loading && (
        <Walkthrough wpm={exercise.wpm} onEnd={endTour} onError={setError} />
      )}
    </div>
  );
}
