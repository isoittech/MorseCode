export type Mode = 'send' | 'receive' | 'knowledge' | 'decision';
export type Page = Mode | 'progress' | 'reference' | 'settings' | 'introduction';
export type User = { id: string; username: string; display_name: string; demo: boolean };
export type Preferences = {
  wpm: number;
  level: number;
  daily_goal: number;
  target_accuracy: number;
  onboarding_seen: boolean;
};
export type Exercise = {
  id: string;
  mode: Mode;
  level: number;
  wpm: number;
  title: string;
  prompt: string;
  target: string;
  signal: string[];
  options: string[];
};
export type Result = {
  id: string;
  mode: Mode;
  expected: string;
  actual: string;
  accuracy: number;
  rhythm: number | null;
  wpm: number;
  elapsed_ms: number;
  input_method: 'key' | 'paddle';
  characters: { expected: string; actual: string; correct: boolean }[];
  feedback: string[];
  created_at?: number;
};
export type Stats = {
  total: number;
  today: number;
  streak: number;
  accuracy: number | null;
  by_mode: Record<Mode, number | null>;
  weaknesses: { character: string; accuracy: number; attempts: number }[];
  recent: Result[];
};
export const MODE_LABELS: Record<Mode, string> = {
  send: '送信訓練',
  receive: '受信訓練',
  knowledge: '知識ドリル',
  decision: '判断ドリル',
};
