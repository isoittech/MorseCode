import { HttpAgent } from '@ag-ui/client';
import { CopilotKitContext, CopilotKitCoreReact } from '@copilotkit/react-core/v2/context';
import { useAgent, useAgentContext, useCopilotKit } from '@copilotkit/react-core/v2/headless';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, errorMessage, newId } from '../lib/api';
import { decode } from '../lib/morse';
import type { Exercise, Result } from '../types';
import { Icon } from './Icon';

export function CoachProvider({ children }: { children: ReactNode }) {
  const [context] = useState(() => {
    const coach = new HttpAgent({
      agentId: 'coach',
      threadId: newId(),
      url: '/api/coach',
      headers: { 'X-Morse-Client': 'web' },
      fetch: async (url, init) => {
        const response = await fetch(url, { ...init, credentials: 'same-origin' });
        if (response.status === 401) window.dispatchEvent(new Event('morse:session-expired'));
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(
            typeof body?.detail === 'string' ? body.detail : 'コーチに接続できません。',
          );
        }
        return response;
      },
    });
    // The public headless context avoids importing unused diagram/code renderers.
    // This is the same registry used by the provider's selfManagedAgents prop;
    // authentication and CSRF checks are enforced by our FastAPI endpoint.
    const copilotkit = new CopilotKitCoreReact({
      agents__unsafe_dev_only: { coach },
      credentials: 'same-origin',
    });
    return {
      copilotkit,
      executingToolCallIds: new Set<string>(),
      showIntelligenceIndicator: false,
    };
  });
  return <CopilotKitContext.Provider value={context}>{children}</CopilotKitContext.Provider>;
}

export function Coach({
  exercise,
  result,
  liveSignal,
  helpRequest,
  introductory,
}: {
  exercise: Exercise | null;
  result: Result | null;
  liveSignal: string;
  helpRequest: number;
  introductory: boolean;
}) {
  const { agent, isReady } = useAgent({ agentId: 'coach' });
  const { copilotkit } = useCopilotKit();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [autoReview, setAutoReview] = useState(true);
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking');
  const [sending, setSending] = useState(false);
  const automaticIds = useRef(new Set<string>());
  const autoMessages = useRef(new Set<string>());
  const liveReview = useRef({ exercise: '', lastAt: 0 });
  const previousHelp = useRef(helpRequest);
  const messageEnd = useRef<HTMLDivElement>(null);
  const busy = sending || agent.isRunning;
  useAgentContext({
    description: '現在のモールス訓練の観測値（未確定符号を含む。測定値のみ）',
    value: {
      mode: exercise?.mode ?? null,
      learningContext: introductory
        ? '入門中。国際モールスの短点・長点とE/T/Aを初めて練習しています。専門用語を避けて説明してください。'
        : null,
      prompt: exercise?.prompt ?? null,
      target: exercise?.target ?? null,
      wpm: exercise?.wpm ?? null,
      currentSignal: liveSignal,
      lastResult: result ? JSON.stringify(result) : null,
    },
  });

  useEffect(() => {
    void api<{ available: boolean }>('/coach/status')
      .then((s) => setStatus(s.available ? 'ready' : 'unavailable'))
      .catch(() => setStatus('unavailable'));
  }, []);
  useEffect(() => {
    if (!isReady) return;
    const { unsubscribe } = agent.subscribe({
      onRunErrorEvent: ({ event }) => {
        setError(event.message);
        setStatus('unavailable');
      },
      onTextMessageContentEvent: () => setStatus('ready'),
    });
    return unsubscribe;
  }, [agent, isReady]);
  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [agent.messages, busy, result, error]);

  const send = useCallback(
    async (text: string, automatic = false) => {
      if (!isReady || agent.isRunning || !text.trim()) return;
      setError('');
      setSending(true);
      const id = newId();
      if (automatic) autoMessages.current.add(id);
      // A bounded UI transcript keeps the request and model context size predictable.
      if (agent.messages.length > 30) agent.setMessages(agent.messages.slice(-20));
      agent.addMessage({ id, role: 'user', content: text.trim() });
      try {
        await copilotkit.runAgent({ agent, runId: newId() });
      } catch (e) {
        setError(errorMessage(e));
        setStatus('unavailable');
      } finally {
        setSending(false);
      }
    },
    [agent, copilotkit, isReady],
  );

  useEffect(() => {
    if (
      !result ||
      !autoReview ||
      busy ||
      !isReady ||
      status !== 'ready' ||
      automaticIds.current.has(result.id)
    )
      return;
    automaticIds.current.add(result.id);
    void send(
      '直前の訓練結果を講評してください。誤りと次に直すべき点を、具体的に短く教えてください。',
      true,
    );
  }, [result, autoReview, busy, isReady, status, send]);
  useEffect(() => {
    if (
      !autoReview ||
      busy ||
      !isReady ||
      status !== 'ready' ||
      exercise?.mode !== 'send' ||
      result?.id === exercise.id
    )
      return;
    // Only completed symbols (space-delimited) trigger live coaching. A trailing
    // unfinished character must never be treated as a learner's mistake.
    const completed = liveSignal.split(' ').slice(0, -1).filter(Boolean).map(decode).join('');
    if (!completed || completed === exercise.target.slice(0, completed.length)) return;
    if (
      liveReview.current.exercise === exercise.id ||
      Date.now() - liveReview.current.lastAt < 15000
    )
      return;
    const timer = setTimeout(() => {
      liveReview.current = { exercise: exercise.id, lastAt: Date.now() };
      void send(
        '入力途中の観測で、確定した符号が目標と異なっています。現在の符号を見て、直すべき点を一つだけ短く指摘してください。未確定の符号は採点しないでください。',
        true,
      );
    }, 1400);
    return () => clearTimeout(timer);
  }, [autoReview, busy, isReady, status, exercise, result, liveSignal, send]);
  useEffect(() => {
    if (helpRequest === previousHelp.current) return;
    previousHelp.current = helpRequest;
    if (!busy) void send('今の課題に取り組むためのヒントをください。');
    else setError('コーチが応答中です。終わってからヒントを送信してください。');
  }, [helpRequest, busy, send]);
  useEffect(() => () => agent.abortRun(), [agent]);

  return (
    <aside className="coach-panel" aria-label="AIコーチ">
      <header className="panel-header">
        <span>
          <Icon name="chat" /> コーチ通信
        </span>
        <span className="eyebrow">CH. 03</span>
      </header>
      <div className="coach-identity">
        <div className="coach-avatar">
          <Icon name="radio" size={25} />
        </div>
        <div>
          <b>通信教官</b>
          <span>AI TRAINING COACH</span>
        </div>
        <span
          className={`coach-status ${status}`}
          title={status === 'ready' ? '相談できます。接続は送信時に確認します' : '接続状態'}
        >
          <span className="status-dot" />
          {busy
            ? '応答中'
            : status === 'ready'
              ? '相談可'
              : status === 'checking'
                ? '確認中'
                : '接続待ち'}
        </span>
      </div>
      <label className="auto-review">
        <input
          type="checkbox"
          checked={autoReview}
          onChange={(e) => setAutoReview(e.target.checked)}
        />
        入力ミス・判定後にAI講評<span>AUTO</span>
      </label>
      <div className="chat-messages" aria-live="polite" aria-relevant="additions text">
        <div className="chat-divider">
          <span>訓練チャンネルを開設</span>
        </div>
        <article className="chat-message guide">
          <div className="message-meta">
            <span>FIELD GUIDE</span>
            <span>操作案内</span>
          </div>
          <p>
            {introductory
              ? 'まずはE・T・Aの3文字から。お手本を聴いて、同じリズムを試してみよう。'
              : 'まずは正確さから。短点と長点のリズムを身体に覚えさせよう。'}
          </p>
          <p>
            {introductory
              ? '分からない言葉があれば、そのまま質問して大丈夫。入門の練習は成績に残らない。'
              : '打鍵の判定はすぐ表示される。迷ったときは、ここでコーチに相談できる。'}
          </p>
          <div className="guide-hint">
            <span>·</span>短点 1<span>−</span>長点 3
          </div>
        </article>
        {result && (
          <article className="chat-message observation">
            <div className="message-meta">
              <span>打鍵・回答の自動判定</span>
              <span>{result.accuracy}%</span>
            </div>
            <p>{result.feedback.join(' ')}</p>
          </article>
        )}
        {agent.messages.map((message) => {
          if (
            (message.role !== 'user' && message.role !== 'assistant') ||
            typeof message.content !== 'string' ||
            !message.content
          )
            return null;
          if (autoMessages.current.has(message.id))
            return (
              <div className="chat-divider" key={message.id}>
                <span>訓練結果をコーチに共有</span>
              </div>
            );
          return (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <div className="message-meta">
                <span>{message.role === 'user' ? 'YOU' : '通信教官 / AI'}</span>
              </div>
              <p>{message.content}</p>
            </article>
          );
        })}
        {busy && (
          <div className="thinking">
            <span className="status-dot" /> コーチが観測結果を確認中…
          </div>
        )}
        {error && (
          <div className="error coach-error" role="alert">
            {error}
            <button
              onClick={() => {
                const last = [...agent.messages].reverse().find((m) => m.role === 'user');
                if (last && typeof last.content === 'string') void send(last.content);
              }}
              disabled={busy}
            >
              再試行
            </button>
          </div>
        )}
        <div ref={messageEnd} />
      </div>
      <div className="coach-compose" data-tour="coach">
        <div className="suggestions">
          <button disabled={busy} onClick={() => void send('短点と長点を安定させるコツを教えて。')}>
            打鍵のコツ
          </button>
          <button
            disabled={busy}
            onClick={() => void send('これまでの訓練結果から、次に練習すべき弱点を教えて。')}
          >
            弱点を分析
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim() && !busy) {
              void send(input);
              setInput('');
            }
          }}
        >
          <textarea
            aria-label="コーチへのメッセージ"
            placeholder="コーチに相談する…"
            value={input}
            maxLength={3000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (input.trim() && !busy) {
                  void send(input);
                  setInput('');
                }
              }
            }}
          />
          {busy ? (
            <button
              type="button"
              className="send-chat"
              aria-label="応答を停止"
              onClick={() => agent.abortRun()}
            >
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              className="send-chat"
              aria-label="メッセージを送信"
              disabled={!input.trim() || !isReady}
            >
              <Icon name="arrow" size={18} />
            </button>
          )}
        </form>
        <small>Enter で送信 · Shift + Enter で改行</small>
      </div>
    </aside>
  );
}
