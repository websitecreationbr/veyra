// Ícones simples (traço 1.75). Decorativos por padrão: aria-hidden; o rótulo fica no botão/link que os contém.
const PATHS: Record<string, string> = {
  home: "M4 11.5 12 5l8 6.5M6.5 10v8.5a.5.5 0 0 0 .5.5h3.5v-5h3v5H17a.5.5 0 0 0 .5-.5V10",
  flow: "M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h-.5A2.5 2.5 0 0 1 4 12.5z",
  wallet: "M4 8.5A2.5 2.5 0 0 1 6.5 6H18a1 1 0 0 1 1 1v2M4 8.5V16a2 2 0 0 0 2 2h11.5a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H6.5A2.5 2.5 0 0 1 4 6.5M15.5 13.5h.01",
  calendar: "M6.5 5.5h11A2.5 2.5 0 0 1 20 8v9.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V8a2.5 2.5 0 0 1 2.5-2.5zM4 10h16M8.5 3.5v3M15.5 3.5v3",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  mic: "M12 15.5a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5.5a3 3 0 0 0 3 3zM6.5 12.5a5.5 5.5 0 0 0 11 0M12 18v2.5",
  send: "M5 12h13M13 6l6 6-6 6",
  check: "M5.5 12.5l4 4 9-9.5",
  undo: "M9 7 5 11l4 4M5 11h8a5 5 0 0 1 0 10h-2",
  bell: "M7 16.5V11a5 5 0 0 1 10 0v5.5l1.5 1.5h-13zM10 20.5a2 2 0 0 0 4 0",
  chevronRight: "M9.5 6l6 6-6 6",
  chevronLeft: "M14.5 6l-6 6 6 6",
  trash: "M5 7h14M10 7V5h4v2M7 7l.8 11.2a1 1 0 0 0 1 .8h6.4a1 1 0 0 0 1-.8L17 7M10.5 11v5M13.5 11v5",
  repeat: "M6 10V9a3 3 0 0 1 3-3h8.5M15 3.5 17.5 6 15 8.5M18 14v1a3 3 0 0 1-3 3H6.5M9 20.5 6.5 18 9 15.5",
  alert: "M12 8.5v4.5M12 16.5h.01M10.3 4.6 3.6 16.2A2 2 0 0 0 5.3 19h13.4a2 2 0 0 0 1.7-2.8L13.7 4.6a2 2 0 0 0-3.4 0z",
  flame: "M12 20.5c3.3 0 5.5-2.2 5.5-5.2 0-2.4-1.5-4-2.7-5.3-.5 1-1.2 1.6-2 1.8.3-2.8-.9-5.2-3.3-6.8.1 3-1.6 4.6-2.7 6.3-.6 1-.8 2-.8 3.2 0 2.9 2.2 6 6 6z",
  logout: "M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M14 8l4 4-4 4M18 12H9.5",
  plus: "M12 5v14M5 12h14",
  circle: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  clock: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 8v4.5l3 1.5",
  sparkle: "M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--brand)" />
      <path d="M19 20l13 26 13-26" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
