import type { ReactNode } from "react";

export function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function UpgradeGate({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="card"><strong>{title}</strong><p className="small muted">{children}</p></div>;
}

export function UpgradeLink({ label }: { label: string }) {
  return <span className="small muted" title="Requires the Spellhound workspace"><LockIcon size={14} /> {label}</span>;
}
