import { useCallback, useEffect, useRef, useState } from 'react';
import { codeFor, decode, dotMs, MorseAudio, symbolFor } from '../lib/morse';

export function useKeyer(wpm: number, enabled: boolean, audio: MorseAudio) {
  const [groups, setGroups] = useState<number[][]>([]);
  const [current, setCurrent] = useState<number[]>([]);
  const [down, setDown] = useState(false);
  const [method, setMethod] = useState<'key' | 'paddle'>('key');
  const [lastPulse, setLastPulse] = useState<{ duration: number; symbol: string } | null>(null);
  const [notice, setNotice] = useState('');
  const groupsRef = useRef<number[][]>([]);
  const currentRef = useRef<number[]>([]);
  const started = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const commit = useCallback(() => {
    clearTimeout(timer.current);
    if (currentRef.current.length) {
      groupsRef.current = [...groupsRef.current, [...currentRef.current]];
      currentRef.current = [];
      setGroups(groupsRef.current);
      setCurrent([]);
    }
    return groupsRef.current;
  }, []);

  const append = useCallback(
    (duration: number) => {
      if (currentRef.current.length >= 10 || groupsRef.current.length >= 40) {
        setNotice('符号が多すぎます。入力を消去してやり直してください。');
        return;
      }
      if (duration < 10 || duration > 10000) {
        setNotice('打鍵時間が範囲外です。10 ms〜10秒で入力してください。');
        return;
      }
      currentRef.current = [...currentRef.current, duration];
      setCurrent(currentRef.current);
      setLastPulse({ duration, symbol: symbolFor(duration, wpm) });
      setNotice('');
      clearTimeout(timer.current);
      timer.current = setTimeout(commit, 3 * dotMs(wpm));
    },
    [wpm, commit],
  );

  const cancel = useCallback(() => {
    started.current = null;
    setDown(false);
    audio.key(false);
  }, [audio]);

  const press = useCallback(() => {
    if (!enabled || started.current !== null) return;
    clearTimeout(timer.current);
    started.current = performance.now();
    setDown(true);
    void audio
      .unlock()
      .then(() => {
        if (started.current !== null) audio.key(true);
      })
      .catch(() => setNotice('音声を開始できません。音量とブラウザーの設定を確認してください。'));
  }, [audio, enabled]);

  const release = useCallback(() => {
    if (started.current === null) return;
    const duration = performance.now() - started.current;
    cancel();
    if (enabled) append(duration);
  }, [append, cancel, enabled]);

  const paddle = useCallback(
    (symbol: '.' | '-') => {
      if (!enabled) return;
      setMethod('paddle');
      append(dotMs(wpm) * (symbol === '.' ? 1 : 3));
      void audio.play([symbol], wpm, () => {}).catch(() => setNotice('音声を開始できません。'));
    },
    [append, audio, enabled, wpm],
  );

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    cancel();
    groupsRef.current = [];
    currentRef.current = [];
    setGroups([]);
    setCurrent([]);
    setLastPulse(null);
    setMethod('key');
    setNotice('');
  }, [cancel]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!enabled || event.code !== 'Space') return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],button:not([data-keyer])',
        )
      )
        return;
      event.preventDefault();
      if (!event.repeat) press();
    }
    function keyup(event: KeyboardEvent) {
      if (event.code === 'Space') release();
    }
    function blur() {
      cancel();
      commit();
    }
    function visibility() {
      if (document.hidden) blur();
    }
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      clearTimeout(timer.current);
      cancel();
    };
  }, [enabled, press, release, cancel, commit]);

  return {
    groups,
    current,
    down,
    method,
    lastPulse,
    notice,
    press,
    release,
    cancel,
    paddle,
    commit,
    reset,
    decoded: groups.map((g) => decode(codeFor(g, wpm))).join(''),
    currentCode: codeFor(current, wpm),
  };
}
