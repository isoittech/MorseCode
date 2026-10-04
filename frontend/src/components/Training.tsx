import { useEffect, useRef, useState } from 'react';
import { useKeyer } from '../hooks/useKeyer';
import { api, errorMessage } from '../lib/api';
import { ALPHABET, codeFor, decode, displayCode, dotMs, MorseAudio } from '../lib/morse';
import { MODE_LABELS, type Exercise, type Result } from '../types';
import { Icon } from './Icon';

export function Training({
  exercise,
  result,
  onResult,
  onNext,
  onHelp,
  onLive,
  loading,
  targetAccuracy,
}: {
  exercise: Exercise;
  result: Result | null;
  onResult: (result: Result) => void;
  onNext: () => void;
  onHelp: () => void;
  onLive: (signal: string) => void;
  loading: boolean;
  targetAccuracy: number;
}) {
  const [audio] = useState(() => new MorseAudio());
  const [muted, setMuted] = useState(false);
  const [frequency, setFrequency] = useState(600);
  const [playing, setPlaying] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [listened, setListened] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const started = useRef(performance.now());
  const keyer = useKeyer(
    exercise.wpm,
    exercise.mode === 'send' && !result && !busy && !playing,
    audio,
  );
  const sendMode = exercise.mode === 'send';
  const quiz = exercise.mode === 'knowledge' || exercise.mode === 'decision';
  useEffect(() => {
    if (exercise.mode !== 'decision' || result) return;
    const timer = setInterval(() => setElapsed((performance.now() - started.current) / 1000), 100);
    return () => clearInterval(timer);
  }, [exercise.mode, result]);
  useEffect(() => () => audio.dispose(), [audio]);
  useEffect(() => {
    audio.muted = muted;
    if (muted) {
      audio.stop();
      setPlaying(false);
    }
  }, [audio, muted]);
  useEffect(() => {
    audio.frequency = frequency;
  }, [audio, frequency]);
  useEffect(() => {
    onLive(keyer.groups.map((g) => codeFor(g, exercise.wpm)).join(' ') + ' ' + keyer.currentCode);
  }, [keyer.groups, keyer.currentCode, exercise.wpm, onLive]);

  async function listen() {
    if (playing) {
      audio.stop();
      setPlaying(false);
      return;
    }
    setError('');
    setMuted(false);
    audio.muted = false;
    setPlaying(true);
    try {
      await audio.play(exercise.signal, exercise.wpm, () => {
        setPlaying(false);
        setListened(true);
      });
    } catch (e) {
      setError(errorMessage(e));
      setPlaying(false);
    }
  }

  async function submit() {
    setBusy(true);
    setError('');
    audio.stop();
    setPlaying(false);
    const characters = keyer.commit();
    try {
      const value = await api<Result>('/attempts', {
        method: 'POST',
        body: JSON.stringify({
          exercise_id: exercise.id,
          answer,
          characters,
          input_method: keyer.method,
          elapsed_ms: performance.now() - started.current,
        }),
      });
      onResult(value);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    !keyer.down &&
    !result &&
    (sendMode ? keyer.groups.length > 0 || keyer.current.length > 0 : Boolean(answer.trim()));
  return (
    <>
      <div className="section-title">
        <div>
          <span className="eyebrow">
            {sendMode ? 'TRANSMISSION' : quiz ? 'FIELD EXERCISE' : 'RECEPTION'} / TRAINING CONSOLE
          </span>
          <h1>{MODE_LABELS[exercise.mode]}</h1>
          <p>
            {sendMode
              ? '正しく打つ。その繰り返しが、反射になる。'
              : quiz
                ? '知識を確かめ、現場で使える判断力に変える。'
                : '点と線を数えず、一つのリズムとして聴き取る。'}
          </p>
        </div>
        <div className="level-badge">
          LEVEL <b>0{exercise.level}</b>
        </div>
      </div>
      <section className="mission-card">
        <header>
          <span className="eyebrow">CURRENT MISSION</span>
          <span className="tag">{exercise.title}</span>
        </header>
        <div className="mission-instruction">
          <span className="mission-number">{sendMode ? 'TX' : quiz ? 'HQ' : 'RX'}</span>
          <p>{exercise.prompt}</p>
        </div>
        {sendMode ? (
          <div className="target-row" aria-label={`送信目標 ${exercise.target}`}>
            {[...exercise.target].map((c, index) => (
              <div
                key={index}
                className={`target-letter ${keyer.groups[index] ? (decode(codeFor(keyer.groups[index], exercise.wpm)) === c ? 'correct' : 'incorrect') : index === keyer.groups.length ? 'active' : ''}`}
              >
                <b>{c}</b>
                <small>
                  {showHint ? displayCode(ALPHABET[c]) : String(index + 1).padStart(2, '0')}
                </small>
              </div>
            ))}
            <button
              className="hint-toggle"
              aria-pressed={showHint}
              onClick={() => setShowHint(!showHint)}
            >
              <Icon name="book" size={15} />
              {showHint ? '符号を隠す' : '符号を見る'}
            </button>
          </div>
        ) : (
          !quiz && (
            <div className="receive-mission">
              <span className="receive-symbol">{result ? result.expected : '? ? ?'}</span>
              <span>{result ? '受信した文字列' : `${exercise.signal.length}文字の受信課題`}</span>
            </div>
          )
        )}
        <footer>
          <span>
            <Icon name="target" size={14} />{' '}
            {quiz ? '正答とその理由を身につける' : `目標精度 ${targetAccuracy}%以上を目指す`}
          </span>
          <span>{quiz ? 'ONE DECISION AT A TIME' : `${exercise.wpm} WPM · 国際モールス`}</span>
        </footer>
      </section>

      {quiz ? (
        <section className="quiz-panel">
          <header>
            <span className="eyebrow">YOUR DECISION</span>
            <span>最も適切なものを選択</span>
          </header>
          <div className="quiz-options">
            {exercise.options.map((option, i) => (
              <button
                key={option}
                className={`quiz-option ${answer === option ? 'selected' : ''} ${result?.expected === option ? 'answer-correct' : ''}`}
                disabled={!!result}
                onClick={() => setAnswer(option)}
              >
                <span>{String(i + 1).padStart(2, '0')}</span>
                {option}
                <i>{answer === option && <Icon name="check" size={17} />}</i>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section
          className={`signal-console ${keyer.down || playing ? 'transmitting' : ''}`}
          aria-label="信号コンソール"
        >
          <header>
            <span>
              <span className="status-dot" />
              {keyer.down
                ? 'KEY DOWN'
                : playing
                  ? 'SIGNAL PLAYING'
                  : result
                    ? 'TRANSMISSION COMPLETE'
                    : 'SIGNAL MONITOR'}
            </span>
            <div>
              <button
                className="icon-button"
                aria-label={muted ? '音を有効にする' : '音を消す'}
                aria-pressed={!muted}
                onClick={() => setMuted(!muted)}
              >
                <Icon name={muted ? 'mute' : 'sound'} size={15} />
              </button>
              <label className="frequency-label">
                <select
                  aria-label="音の周波数"
                  value={frequency}
                  onChange={(e) => setFrequency(Number(e.target.value))}
                >
                  <option value={400}>400 Hz</option>
                  <option value={600}>600 Hz</option>
                  <option value={800}>800 Hz</option>
                </select>
              </label>
            </div>
          </header>
          <div className="monitor-screen">
            <div className="monitor-ruler">
              <span>0</span>
              <span>250</span>
              <span>500</span>
              <span>750</span>
              <span>1000 ms</span>
            </div>
            <div className="signal-trace" aria-hidden="true">
              {sendMode &&
                [...keyer.groups.flat(), ...keyer.current]
                  .slice(-22)
                  .map((duration, i) => (
                    <span key={i} style={{ width: Math.max(4, Math.min(72, duration / 4)) }} />
                  ))}
              {keyer.down && <span className="active-pulse" />}
              {playing && (
                <div className="listening-bars">
                  {Array.from({ length: 19 }, (_, i) => (
                    <i key={i} style={{ animationDelay: `${i * 0.07}s` }} />
                  ))}
                </div>
              )}
            </div>
            <div className="signal-readout">
              <span className="readout-label">{sendMode ? 'LIVE DECODE' : 'AUDIO CHANNEL'}</span>
              <strong>
                {sendMode
                  ? keyer.decoded || '—'
                  : playing
                    ? '受信中'
                    : listened
                      ? '再生完了'
                      : '受信待機'}
              </strong>
              <span className="current-signal">
                {sendMode ? displayCode(keyer.currentCode) || '· · ·' : `${exercise.wpm} WPM`}
              </span>
            </div>
            {sendMode && (
              <div className="live-verdict" role="status">
                {keyer.notice ||
                  (keyer.groups.length
                    ? keyer.decoded === exercise.target.slice(0, keyer.groups.length)
                      ? '✓ ここまでの符号は正確。その調子。'
                      : '△ 目標と異なる符号を検出。符号と区切りを確認。'
                    : 'キーを短く押すと短点、長く押すと長点。')}
              </div>
            )}
          </div>
          {sendMode ? (
            <>
              <div className="keyer-controls">
                <button
                  data-keyer="true"
                  aria-label="打鍵キー"
                  className={`key-pad ${keyer.down ? 'pressed' : ''}`}
                  disabled={!!result || busy || playing}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    keyer.press();
                  }}
                  onPointerUp={keyer.release}
                  onPointerCancel={keyer.cancel}
                  onLostPointerCapture={keyer.cancel}
                >
                  <span className="key-contact" />
                  <b>{keyer.down ? 'TRANSMITTING' : '押して打鍵する'}</b>
                  <span>SPACE KEY / TAP & HOLD</span>
                  <kbd>SPACE</kbd>
                </button>
                <div className="paddle-controls">
                  <span>補助入力</span>
                  <button
                    disabled={!!result || busy || playing}
                    onClick={() => keyer.paddle('.')}
                    aria-label="短点を入力"
                  >
                    ·<small>短点</small>
                  </button>
                  <button
                    disabled={!!result || busy || playing}
                    onClick={() => keyer.paddle('-')}
                    aria-label="長点を入力"
                  >
                    −<small>長点</small>
                  </button>
                  <button
                    className="commit-char"
                    disabled={!!result || keyer.down || !keyer.current.length}
                    onClick={() => keyer.commit()}
                  >
                    文字確定
                    <Icon name="check" size={14} />
                  </button>
                </div>
              </div>
              <div className="console-footer">
                <span>
                  <span className="tiny-dot" />
                  文字間 {Math.round(3 * dotMs(exercise.wpm))} ms で自動確定
                </span>
                <button disabled={!!result || busy} onClick={keyer.reset}>
                  <Icon name="reset" size={13} />
                  入力を消去
                </button>
              </div>
            </>
          ) : (
            <div className="receiver-controls">
              <button
                className="button listen-button"
                onClick={() => void listen()}
                disabled={!!result}
              >
                <Icon name={playing ? 'stop' : 'play'} size={16} />
                {playing ? '再生を停止' : listened ? 'もう一度聴く' : '信号を聴く'}
              </button>
              <label>
                受信した文字列
                <input
                  aria-label="受信した文字列"
                  autoComplete="off"
                  placeholder="例：KMK"
                  maxLength={40}
                  value={answer}
                  disabled={!!result}
                  onChange={(e) => setAnswer(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canSubmit) void submit();
                  }}
                />
              </label>
              <small>音を聴いてから回答してください。何度でも再生できます。</small>
            </div>
          )}
        </section>
      )}

      {!quiz && (
        <div className="metrics-strip">
          <div>
            <span>設定速度</span>
            <b>
              {exercise.wpm}
              <small>WPM</small>
            </b>
          </div>
          <div>
            <span>{result ? '符号正解率' : '直前の打鍵'}</span>
            <b>
              {result
                ? result.accuracy
                : keyer.lastPulse
                  ? Math.round(keyer.lastPulse.duration)
                  : '—'}
              <small>{result ? '%' : 'ms'}</small>
            </b>
          </div>
          <div>
            <span>長短点の精度</span>
            <b>
              {result?.rhythm ?? '—'}
              <small>
                {result?.rhythm != null
                  ? '%'
                  : keyer.method === 'paddle'
                    ? '補助入力'
                    : '判定後に表示'}
              </small>
            </b>
          </div>
        </div>
      )}
      {exercise.mode === 'decision' && (
        <div className="decision-timer">
          <span>判断時間</span>
          <b>
            {result ? (result.elapsed_ms / 1000).toFixed(1) : elapsed.toFixed(1)}
            <small>秒</small>
          </b>
          <span>目標：正確に、15秒以内</span>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div
          className={`result-banner ${result.accuracy === 100 ? 'success' : 'review'}`}
          role="status"
        >
          <Icon name={result.accuracy === 100 ? 'check' : 'target'} />
          <div>
            <b>
              {result.accuracy === 100
                ? '任務完了。正確な通信だ。'
                : `要復習 / 正解率 ${result.accuracy}%`}
            </b>
            <p>{result.feedback.join(' ')}</p>
          </div>
        </div>
      )}
      <div className="training-actions">
        <button className="button secondary" onClick={onHelp}>
          <Icon name="chat" size={15} />
          ヒントをもらう
        </button>
        {result ? (
          <button className="button primary" onClick={onNext} disabled={loading}>
            次の課題へ
            <Icon name="arrow" size={16} />
          </button>
        ) : (
          <button className="button primary" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? '判定中…' : '判定する'}
            <Icon name="arrow" size={16} />
          </button>
        )}
      </div>
      <div className="field-note">
        <span>FIELD NOTE</span>
        <p>
          {quiz
            ? '分からないことを、分からないまま送信しない。それも通信技術。'
            : '速さは、正確さの後についてくる。まずは一文字ずつ、同じリズムで。'}
        </p>
      </div>
    </>
  );
}
