import { useEffect, useState } from 'react';
import { ALPHABET, displayCode, LEVELS, MorseAudio } from '../lib/morse';
import { api, errorMessage } from '../lib/api';
import { MODE_LABELS, type Mode, type Preferences, type Stats } from '../types';
import { Icon } from './Icon';

export function Reference() {
  const [query, setQuery] = useState('');
  const [audio] = useState(() => new MorseAudio());
  const [error, setError] = useState('');
  const [active, setActive] = useState('');
  useEffect(() => () => audio.dispose(), [audio]);
  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">FIELD MANUAL / INTERNATIONAL MORSE</span>
          <h1>符号リファレンス</h1>
          <p>文字を選択すると、その符号を聴けます。</p>
        </div>
        <Icon name="book" size={28} />
      </div>
      <div className="reference-ratios">
        <div>
          <b>·</b>
          <span>短点 / 1単位</span>
        </div>
        <div>
          <b>−</b>
          <span>長点 / 3単位</span>
        </div>
        <div>
          <b>3</b>
          <span>文字間 / 単位</span>
        </div>
        <div>
          <b>7</b>
          <span>単語間 / 単位</span>
        </div>
      </div>
      <input
        className="reference-search"
        aria-label="符号を検索"
        placeholder="文字や符号で検索… A / .-"
        value={query}
        onChange={(e) => setQuery(e.target.value.toUpperCase())}
      />
      <div className="alphabet-grid">
        {Object.entries(ALPHABET)
          .filter(([c, code]) => c.includes(query) || code.includes(query))
          .map(([character, code]) => (
            <button
              key={character}
              className={active === character ? 'active' : ''}
              onClick={() => {
                setActive(character);
                setError('');
                void audio
                  .play([code], 12, () => setActive(''))
                  .catch((e) => {
                    setError(errorMessage(e));
                    setActive('');
                  });
              }}
              aria-label={`${character} ${code} を聴く`}
            >
              <b>{character}</b>
              <span>{displayCode(code)}</span>
              <Icon name="sound" size={13} />
            </button>
          ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="field-note">
        <span>RHYTHM</span>
        <p>符号内の無音は1単位。短点の長さは 1200 ÷ WPM ms。音の形で覚えよう。</p>
      </div>
    </>
  );
}

export function Progress({ stats, preferences }: { stats: Stats; preferences: Preferences }) {
  const [mode, setMode] = useState<Mode | 'all'>('all');
  const history = stats.recent.filter((r) => mode === 'all' || r.mode === mode);
  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">OPERATOR RECORD / PERFORMANCE</span>
          <h1>訓練記録</h1>
          <p>記録を振り返り、次に磨くべき能力を見つける。</p>
        </div>
        <Icon name="chart" size={28} />
      </div>
      <div className="progress-metrics">
        <div>
          <span>総訓練回数</span>
          <b>
            {stats.total}
            <small>回</small>
          </b>
        </div>
        <div>
          <span>最近の平均正解率</span>
          <b>
            {stats.accuracy ?? '—'}
            <small>%</small>
          </b>
        </div>
        <div>
          <span>本日の訓練</span>
          <b>
            {stats.today}
            <small>/ {preferences.daily_goal}</small>
          </b>
        </div>
      </div>
      <section className="paper-panel">
        <h2>
          能力別の正解率<span>RECENT 200</span>
        </h2>
        {(Object.entries(MODE_LABELS) as [Mode, string][]).map(([key, label]) => (
          <div className="ability-row" key={key}>
            <span>{label}</span>
            <div className="progress-track">
              <i style={{ width: `${stats.by_mode[key] ?? 0}%` }} />
            </div>
            <b>{stats.by_mode[key] == null ? '未訓練' : `${stats.by_mode[key]}%`}</b>
          </div>
        ))}
      </section>
      <section className="paper-panel">
        <h2>
          重点復習<span>WEAK CHARACTERS</span>
        </h2>
        {stats.weaknesses.length ? (
          <div className="weak-characters">
            {stats.weaknesses.map((w) => (
              <div key={w.character}>
                <b>{w.character}</b>
                <span>{displayCode(ALPHABET[w.character])}</span>
                <small>
                  {w.accuracy}% / {w.attempts}回
                </small>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Icon name="target" size={25} />
            <p>送信・受信訓練を終えると、文字ごとの習熟度が表示されます。</p>
          </div>
        )}
      </section>
      <section className="paper-panel">
        <h2>
          最近の訓練
          <select
            aria-label="訓練記録の種類"
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode | 'all')}
          >
            <option value="all">すべて</option>
            {Object.entries(MODE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </h2>
        {history.length ? (
          <div className="history-list">
            {history.map((r) => (
              <div key={r.id}>
                <span className={`score ${r.accuracy >= 90 ? 'good' : ''}`}>
                  {r.accuracy}
                  <small>%</small>
                </span>
                <div>
                  <b>{MODE_LABELS[r.mode]}</b>
                  <span>{r.expected}</span>
                </div>
                <time>
                  {new Intl.DateTimeFormat('ja-JP', {
                    timeZone: 'Asia/Tokyo',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date((r.created_at ?? 0) * 1000))}
                </time>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Icon name="chart" size={25} />
            <p>訓練記録はまだありません。最初の一打から始めよう。</p>
          </div>
        )}
      </section>
    </>
  );
}

export function SettingsForm({
  preferences,
  onSave,
}: {
  preferences: Preferences;
  onSave: (value: Preferences) => void;
}) {
  const [value, setValue] = useState(preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">TRAINING PARAMETERS / PERSONAL GOAL</span>
          <h1>訓練設定</h1>
          <p>いまの実力に合わせて、少し先の目標を設定する。</p>
        </div>
        <Icon name="settings" size={28} />
      </div>
      <form
        className="settings-form paper-panel"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setSaved(false);
          void api<Preferences>('/preferences', { method: 'PUT', body: JSON.stringify(value) })
            .then((p) => {
              onSave(p);
              setSaved(true);
            })
            .catch((e) => setError(errorMessage(e)))
            .finally(() => setBusy(false));
        }}
      >
        <fieldset>
          <legend>訓練レベル</legend>
          <div className="level-options">
            {LEVELS.map((level) => (
              <label key={level.level} className={value.level === level.level ? 'selected' : ''}>
                <input
                  type="radio"
                  name="level"
                  value={level.level}
                  checked={value.level === level.level}
                  onChange={() => {
                    setValue({ ...value, level: level.level, wpm: level.wpm });
                    setSaved(false);
                  }}
                />
                <span>
                  <b>
                    0{level.level} / {level.name}
                  </b>
                  <small>
                    {level.level === 1
                      ? '7文字から始める'
                      : level.level === 2
                        ? 'アルファベット全26文字'
                        : 'アルファベット + 数字'}{' '}
                    · {level.length}文字
                  </small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="setting-row">
          <span>
            <b>送受信速度</b>
            <small>次の課題から反映されます。</small>
          </span>
          <div>
            <input
              aria-label="送受信速度"
              type="number"
              min={5}
              max={40}
              required
              value={value.wpm}
              onChange={(e) => {
                setValue({ ...value, wpm: Number(e.target.value) });
                setSaved(false);
              }}
            />
            <span>WPM</span>
          </div>
        </label>
        <label className="setting-row">
          <span>
            <b>1日の訓練目標</b>
            <small>無理なく続けられる回数で。</small>
          </span>
          <div>
            <input
              aria-label="1日の訓練目標"
              type="number"
              min={1}
              max={100}
              required
              value={value.daily_goal}
              onChange={(e) => {
                setValue({ ...value, daily_goal: Number(e.target.value) });
                setSaved(false);
              }}
            />
            <span>課題</span>
          </div>
        </label>
        <label className="setting-row">
          <span>
            <b>目標正解率</b>
            <small>未達の文字を優先して出題します。</small>
          </span>
          <div>
            <input
              aria-label="目標正解率"
              type="number"
              min={80}
              max={100}
              required
              value={value.target_accuracy}
              onChange={(e) => {
                setValue({ ...value, target_accuracy: Number(e.target.value) });
                setSaved(false);
              }}
            />
            <span>%</span>
          </div>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="saved-message" role="status">
            <Icon name="check" size={16} />
            設定を保存しました。次の課題から反映されます。
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? '保存中…' : '設定を保存'}
          <Icon name="check" size={15} />
        </button>
      </form>
      <div className="field-note">
        <span>TRAINING PLAN</span>
        <p>正解率が安定したら、速度を2 WPMずつ上げてみよう。難しく感じたら一段戻して構わない。</p>
      </div>
    </>
  );
}
