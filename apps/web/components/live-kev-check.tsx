'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from 'cn';
import { CircleCheck, ExternalLink, Loader2, Radar, ShieldCheck, Siren } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { KevAssessment, KevRow } from '@/lib/kev-live';
import type { DemoStartResponse } from '@/lib/timeline-types';

// Presenter and Q&A tool: fetch the real CISA KEV catalog right now, show
// what the deterministic matcher makes of it, and optionally investigate
// any entry that reaches Detroit with the same agents the demo uses.

interface LiveResult extends KevAssessment {
  fetched_at: string;
  fetched_ms: number;
}

type View = 'newest' | 'reaching';

interface RunState {
  cve: string;
  error?: string;
  investigations?: DemoStartResponse['investigations'];
  done: Record<string, 'running' | 'done' | 'failed'>;
}

const DETROIT = 'America/Detroit';

// CISA sometimes repeats the vendor inside the product ("Cisco IOS XE Web UI").
function productLabel(row: KevRow) {
  return row.product.toLowerCase().startsWith(row.vendor.toLowerCase()) ? row.product : `${row.vendor} ${row.product}`;
}

function Reaches({ row }: { row: KevRow }) {
  if (row.reaches.length === 0) {
    return <span className="text-xs text-muted-foreground">No Detroit exposure</span>;
  }
  const names = row.reaches.map((r) => r.service_name);
  const shown = names.slice(0, 2).join(', ');
  return (
    <span className="text-xs font-semibold text-status-critical">
      Reaches {shown}
      {names.length > 2 ? ` and ${names.length - 2} more` : ''}
      <span className="font-normal text-muted-foreground">
        {row.reaches[0].hops === 0 ? ', directly' : ` via ${row.reaches[0].landed_on.replace(/-/g, ' ')}`}
      </span>
    </span>
  );
}

export function LiveKevCheck({ autoRun = false }: { autoRun?: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [result, setResult] = useState<LiveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('newest');
  const [run, setRun] = useState<RunState | null>(null);
  const sources = useRef<EventSource[]>([]);

  async function check() {
    setState('loading');
    setError(null);
    try {
      const res = await fetch('/api/kev/live', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `status ${res.status}`);
      setResult(data);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  useEffect(() => {
    if (!autoRun) return;
    const id = setTimeout(check, 0);
    return () => clearTimeout(id);
  }, [autoRun]);

  useEffect(() => {
    const open = sources.current;
    return () => open.forEach((es) => es.close());
  }, []);

  async function investigate(cve: string) {
    sources.current.forEach((es) => es.close());
    sources.current = [];
    setRun({ cve, done: {} });
    try {
      const res = await fetch('/api/kev/live/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cve }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `status ${res.status}`);
      const investigations = (data as DemoStartResponse).investigations;
      setRun({ cve, investigations, done: Object.fromEntries(investigations.map((i) => [i.investigation_id, 'running'])) });
      // Opening the stream is what runs each agent, exactly as in the demo.
      for (const inv of investigations) {
        const es = new EventSource(`/api/investigations/${inv.investigation_id}/stream`);
        sources.current.push(es);
        const finish = (outcome: 'done' | 'failed') => {
          es.close();
          setRun((prev) => (prev ? { ...prev, done: { ...prev.done, [inv.investigation_id]: outcome } } : prev));
        };
        es.addEventListener('done', () => finish('done'));
        es.addEventListener('timeout', () => finish('failed'));
      }
    } catch (err) {
      setRun({ cve, done: {}, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const rows = result ? (view === 'newest' ? result.newest : result.reaching) : [];

  return (
    <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-base font-semibold">
            <Radar className="h-4 w-4 text-brand-gold" aria-hidden />
            Live check: the CISA KEV catalog, right now
          </p>
          <p className="mt-1 max-w-[62ch] text-sm text-pretty text-muted-foreground">
            Fetches every actively exploited vulnerability CISA lists, straight from cisa.gov, and runs each one through
            the same deterministic match against Detroit&apos;s inventory. Nothing is stored until you investigate.
          </p>
        </div>
        <Button onClick={check} disabled={state === 'loading'} className="gap-2 font-semibold">
          {state === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Radar className="h-4 w-4" aria-hidden />}
          {state === 'loading' ? 'Fetching from cisa.gov' : result ? 'Check again' : 'Check the live catalog'}
        </Button>
      </div>

      {state === 'error' && <p className="px-5 pb-5 text-sm text-status-critical">Could not reach CISA: {error}</p>}

      {result && (
        <div className="animate-in fade-in-0 duration-300">
          <div className="grid grid-cols-1 gap-3 px-5 sm:grid-cols-3">
            <div className="rounded-lg bg-muted/60 p-3">
              <p className="text-2xl font-extrabold tabular-nums">{result.total.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">
                entries fetched in {result.fetched_ms} ms at{' '}
                {new Date(result.fetched_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: DETROIT })}
              </p>
            </div>
            <div className="rounded-lg bg-status-critical/10 p-3">
              <p className="text-2xl font-extrabold tabular-nums text-status-critical">{result.reaching_total}</p>
              <p className="text-xs text-muted-foreground">reach a Detroit service through its inventory</p>
            </div>
            <div className="rounded-lg bg-status-ok/10 p-3">
              <p className="text-2xl font-extrabold tabular-nums text-status-ok">{(result.total - result.reaching_total).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">filtered out: no Detroit exposure, no alert</p>
            </div>
          </div>

          <div role="tablist" aria-label="Catalog view" className="mx-5 mt-4 inline-flex rounded-lg bg-muted p-1">
            {(
              [
                ['newest', 'Newest additions'],
                ['reaching', `Reaches Detroit (${result.reaching_total})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={view === id}
                onClick={() => setView(id)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring',
                  view === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <ul key={view} className="mt-3 max-h-[28rem] divide-y divide-border/60 overflow-y-auto border-t border-border/60">
            {rows.map((row) => (
              <li key={row.cve} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{row.date_added}</span>
                <a
                  href={`https://nvd.nist.gov/vuln/detail/${row.cve}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-36 shrink-0 items-center gap-1 font-semibold tabular-nums hover:underline"
                >
                  {row.cve}
                  <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden />
                </a>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{productLabel(row)}</span>
                  <Reaches row={row} />
                </span>
                {row.ransomware && (
                  <Badge variant="outline" className="shrink-0 text-[10px] text-status-at-risk">
                    Ransomware use
                  </Badge>
                )}
                {row.reaches.length > 0 ? (
                  <Button
                    size="sm"
                    variant={run?.cve === row.cve ? 'secondary' : 'default'}
                    disabled={!!run && !run.error && Object.values(run.done).some((d) => d === 'running')}
                    onClick={() => investigate(row.cve)}
                    className="shrink-0 gap-1.5"
                  >
                    <Siren className="h-3.5 w-3.5" aria-hidden />
                    Investigate
                  </Button>
                ) : (
                  <ShieldCheck className="h-4 w-4 shrink-0 text-status-ok" aria-label="No Detroit exposure" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {run && (
        <div className="animate-in border-t border-border bg-muted/40 p-5 fade-in-0 duration-300">
          <p className="text-sm font-semibold">
            Investigating {run.cve}
            {run.investigations ? `: ${run.investigations.length} agents, one per affected service` : ''}
          </p>
          {run.error && <p className="mt-2 text-sm text-status-critical">{run.error}</p>}
          {!run.investigations && !run.error && (
            <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Re-reading the entry from cisa.gov and looking up its EPSS score
            </p>
          )}
          {run.investigations && (
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {run.investigations.map((inv) => {
                const status = run.done[inv.investigation_id];
                return (
                  <li key={inv.investigation_id} className="flex items-center gap-3 rounded-lg bg-card p-3 ring-1 ring-foreground/10">
                    {status === 'running' ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-gold" aria-hidden />
                    ) : (
                      <CircleCheck className={cn('h-4 w-4 shrink-0', status === 'failed' ? 'text-status-critical' : 'text-status-ok')} aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{inv.service_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {inv.risk.priority}, risk {inv.risk.score}
                        {inv.risk.escalated ? ', escalated' : ''}
                      </span>
                    </span>
                    {status !== 'running' && (
                      <Link href={`/investigations/${inv.investigation_id}`} className="shrink-0 text-xs font-medium text-brand-gold hover:underline">
                        Open
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {run.investigations && (
            <p className="mt-3 text-xs text-muted-foreground">
              These are real investigations and now appear on the dashboard map. Use Reset demo before the next run.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
