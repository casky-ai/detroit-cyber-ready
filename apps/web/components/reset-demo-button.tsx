'use client';

import { useEffect, useState } from 'react';
import { cn } from 'cn';
import { Loader2, RotateCcw } from 'lucide-react';

// Two clicks, not a browser confirm() dialog, so a reset on stage never
// throws a system popup in front of the audience.
export function ResetDemoButton({
  onDone,
  size = 'sm',
  className,
}: {
  onDone?: (removed: number) => void;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'confirm' | 'working' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Step back from "confirm" if the presenter moves on without clicking.
  useEffect(() => {
    if (state !== 'confirm') return;
    const id = setTimeout(() => setState('idle'), 5000);
    return () => clearTimeout(id);
  }, [state]);

  async function reset() {
    setState('working');
    setError(null);
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `status ${res.status}`);
      setState('idle');
      onDone?.(data.removed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={() => (state === 'confirm' ? reset() : setState('confirm'))}
        disabled={state === 'working'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
          size === 'lg' ? 'h-11 px-5 text-base' : 'h-8 px-3 text-sm',
          state === 'confirm'
            ? 'bg-status-critical text-white hover:bg-status-critical/85'
            : 'bg-muted text-foreground hover:bg-accent',
          className
        )}
      >
        {state === 'working' ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RotateCcw className="h-4 w-4" aria-hidden />
        )}
        {state === 'confirm' ? 'Click again to clear all investigations' : state === 'working' ? 'Resetting' : 'Reset demo'}
      </button>
      {state === 'error' && <span className="text-sm text-status-critical">Reset failed: {error}</span>}
    </span>
  );
}
