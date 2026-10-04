import type { CSSProperties } from 'react';

const paths: Record<string, string> = {
  radio: 'M4 9h16v11H4z M6 9l11-6 M8 14h.01 M8 17h.01 M12 13h5 M12 16h5',
  send: 'M12 20V4 M6 10l6-6 6 6 M4 16v4h16v-4',
  receive: 'M12 4v12 M6 10l6 6 6-6 M4 16v4h16v-4',
  book: 'M3 4h6a3 3 0 013 3v14a4 4 0 00-4-3H3z M21 4h-6a3 3 0 00-3 3v14a4 4 0 014-3h5z',
  bolt: 'M13 2L4 14h7l-1 8 10-13h-7z',
  chart: 'M4 3v17h17 M8 15v-4 M13 15V7 M18 15v-7',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  chevron: 'M9 5l7 7-7 7',
  sound: 'M3 9h4l5-4v14l-5-4H3z M16 8a6 6 0 010 8 M19 5a10 10 0 010 14',
  mute: 'M3 9h4l5-4v14l-5-4H3z M16 9l5 6 M21 9l-5 6',
  play: 'M7 4l14 8-14 8z',
  stop: 'M6 6h12v12H6z',
  reset: 'M4 10a8 8 0 118 10 M4 4v6h6',
  check: 'M4 12l5 5L20 6',
  close: 'M5 5l14 14 M19 5L5 19',
  chat: 'M4 4h16v12H9l-5 5z M8 8h8 M8 12h5',
  logout: 'M10 4H4v16h6 M9 12h12 M16 7l5 5-5 5',
  shield: 'M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6',
  target:
    'M12 2v4 M12 18v4 M2 12h4 M18 12h4 M19 12a7 7 0 11-14 0 7 7 0 0114 0 M14 12a2 2 0 11-4 0 2 2 0 014 0',
};

export function Icon({
  name,
  size = 18,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name] ?? paths.radio} />
    </svg>
  );
}
