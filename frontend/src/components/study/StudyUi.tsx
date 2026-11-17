"use client";

import { useEffect, useRef, useId, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";

export function StudyPanel({ title, subtitle, action, children }: {
  title: string; subtitle?: string; action?: ReactNode; children: ReactNode;
}) {
  return <section className="card space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-fg-dim">{subtitle}</p>}</div>
      {action}
    </div>
    {children}
  </section>;
}

export function StudyField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block space-y-1.5 text-sm">
    <span className="font-medium">{label}</span>
    {children}
    {hint && <span className="block text-xs text-fg-dim">{hint}</span>}
  </label>;
}

export function StudyEmpty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border p-8 text-center">
    <p className="font-medium">{title}</p><p className="mt-2 text-sm text-fg-dim">{children}</p>
  </div>;
}

export function StudySubmit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return <button type="submit" className="btn-primary inline-flex items-center gap-2" disabled={busy}>
    {busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}{children}
  </button>;
}

export function StudyDialog({ open, title, close, error, children }: {
  open: boolean; title: string; close: () => void; error?: string | null; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return <dialog ref={ref} onCancel={close} onClose={close} aria-labelledby={label}
    className="m-auto max-h-[90dvh] w-[min(95vw,38rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-6 text-fg shadow-2xl backdrop:bg-black/60">
    <div className="mb-5 flex items-center justify-between gap-4">
      <h2 id={label} className="text-xl font-semibold">{title}</h2>
      <button type="button" onClick={close} className="rounded-lg p-2 hover:bg-surface-2" aria-label="Close dialog"><X className="h-5 w-5" /></button>
    </div>
    {error && <p role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-500">{error}</p>}
    {children}
  </dialog>;
}

export function StudyConfirm({ title, message, busy, error, onConfirm, onCancel }: {
  title: string; message: string; busy: boolean; error?: string | null; onConfirm: () => void; onCancel: () => void;
}) {
  return <StudyDialog open title={title} error={error} close={() => { if (!busy) onCancel(); }}>
    <p className="text-sm text-fg-dim">{message}</p>
    <div className="mt-6 flex justify-end gap-3">
      <button type="button" className="btn-ghost" disabled={busy} onClick={onCancel}>Keep it</button>
      <button type="button" className="btn-primary" disabled={busy} onClick={onConfirm}>Delete</button>
    </div>
  </StudyDialog>;
}

export function StudyMeter({ value, maximum, label }: { value: number; maximum: number; label: string }) {
  const percent = Math.min(100, Math.max(0, maximum > 0 ? value / maximum * 100 : 0));
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={maximum}
    aria-valuenow={Math.min(maximum, Math.max(0, value))} className="h-2 overflow-hidden rounded-full bg-surface-2">
    <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
  </div>;
}
