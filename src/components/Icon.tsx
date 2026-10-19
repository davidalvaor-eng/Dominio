import type { ReactNode } from "react";

export type IconName =
  | "coin"
  | "star"
  | "tank"
  | "plane"
  | "send"
  | "users"
  | "volume"
  | "mute"
  | "pause"
  | "target"
  | "globe"
  | "trophy"
  | "help"
  | "bolt"
  | "link"
  | "play"
  | "restart"
  | "home"
  | "eye"
  | "swords"
  | "swap"
  | "bot"
  | "city"
  | "alert";

const ICONS: Record<IconName, { fill?: boolean; d: ReactNode }> = {
  coin: {
    d: (
      <>
        <ellipse cx="12" cy="6.5" rx="7" ry="3" />
        <path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
      </>
    ),
  },
  star: { fill: true, d: <path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" /> },
  tank: {
    d: (
      <>
        <path d="M4.5 13h13a2.75 2.75 0 010 5.5h-13a2.75 2.75 0 010-5.5z" />
        <path d="M7.5 13v-3.2h7V13M14.5 11.3H21" />
      </>
    ),
  },
  plane: {
    fill: true,
    d: <path d="M21 15.5v-2l-8-5V3.5a1.5 1.5 0 00-3 0v5l-8 5v2l8-2.5v5l-2 1.5V21l3.5-1 3.5 1v-1.5l-2-1.5v-5z" />,
  },
  send: { d: <path d="M4 12h15M13 6l6 6-6 6" /> },
  users: {
    d: (
      <>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20a6 6 0 0112 0" />
        <circle cx="17.5" cy="9" r="2.5" />
        <path d="M16.5 14.2A5 5 0 0122 19" />
      </>
    ),
  },
  volume: {
    d: (
      <>
        <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4z" />
        <path d="M16.5 9a4 4 0 010 6M19 6.5a7.5 7.5 0 010 11" />
      </>
    ),
  },
  mute: {
    d: (
      <>
        <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4z" />
        <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" />
      </>
    ),
  },
  pause: { d: <path d="M8.5 5v14M15.5 5v14" /> },
  target: {
    d: (
      <>
        <circle cx="12" cy="12" r="7" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        <circle cx="12" cy="12" r="1.2" />
      </>
    ),
  },
  globe: {
    d: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
      </>
    ),
  },
  trophy: { d: <path d="M8 4h8v5a4 4 0 01-8 0V4zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8M9.5 17h5" /> },
  help: {
    d: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.7-2.5 2-2.5 3.5M12 17h.01" />
      </>
    ),
  },
  bolt: { fill: true, d: <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /> },
  link: { d: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /> },
  play: { fill: true, d: <path d="M7 4.5l12.5 7.5L7 19.5z" /> },
  restart: { d: <path d="M3.5 12a8.5 8.5 0 102.5-6M3.5 4v4.5H8" /> },
  home: { d: <path d="M3 11l9-7.5 9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5" /> },
  eye: {
    d: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  swords: {
    d: <path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 6.5L13 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2" />,
  },
  swap: { d: <path d="M7 7h13l-4-4M17 17H4l4 4" /> },
  bot: {
    d: (
      <>
        <rect x="5" y="8" width="14" height="11" rx="2.5" />
        <path d="M12 4.5V8M9.5 13h.01M14.5 13h.01M2.5 13H5M19 13h2.5" />
      </>
    ),
  },
  city: { d: <path d="M3 21h18M5 21V9l5-3v15M10 21V4l7 3v14M14 10h.01M14 13h.01M14 16h.01M7.5 12h.01M7.5 15h.01" /> },
  alert: { d: <path d="M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.5h.01" /> },
};

export function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  const ic = ICONS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      className={`inline-block shrink-0 ${className}`}
      fill={ic.fill ? "currentColor" : "none"}
      stroke={ic.fill ? "none" : "currentColor"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ic.d}
    </svg>
  );
}
