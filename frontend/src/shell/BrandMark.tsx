/**
 * The app's mark, the same drawing as the tray and the taskbar icons. Its colours are the fixed
 * --mark-* tokens; only the signal ring takes the mode's colour.
 */
export function BrandMark({ ring }: { ring: string }) {
  return (
    <svg className="shell-mark" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--mark-ground)" />
      <path d="M7 45 A26 26 0 1 1 57 45" fill="none" stroke={ring} strokeWidth="6" strokeLinecap="round" />
      <ellipse cx="32" cy="32" rx="15" ry="16" fill="var(--mark-silver)" />
      <rect x="19.5" y="28" width="25" height="10.5" rx="5.25" fill="var(--mark-visor)" />
      <circle cx="27" cy="33.25" r="4.6" fill="var(--mark-eye)" />
      <path d="M13 54 c0 -4 8 -7 19 -7 s19 3 19 7 v1 h-38 z" fill="var(--mark-steel)" />
    </svg>
  );
}
