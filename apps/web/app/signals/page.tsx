'use client';

import { useEffect, useState } from 'react';
import { cn } from 'cn';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, PageHeader } from '@/components/page-header';

interface SignalMatchRow {
  service_slug: string;
  hops: 0 | 1;
}

interface SignalRow {
  id: string;
  source: string;
  provenance: 'live' | 'synthetic';
  external_id: string;
  kind: string;
  title: string;
  vendor_project: string | null;
  product: string | null;
  published_at: string;
  matches: SignalMatchRow[];
}

type Filter = 'all' | 'matched' | 'clear';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All signals' },
  { id: 'matched', label: 'Detroit exposure' },
  { id: 'clear', label: 'No exposure' },
];

export default function SignalsFeedPage() {
  const [signals, setSignals] = useState<SignalRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    fetch('/api/signals')
      .then((r) => r.json())
      .then((d) => setSignals(d.signals ?? []))
      .catch(() => setSignals([]));
  }, []);

  const matchedCount = signals?.filter((s) => s.matches.length > 0).length ?? 0;
  const visible =
    signals?.filter((s) =>
      filter === 'all' ? true : filter === 'matched' ? s.matches.length > 0 : s.matches.length === 0
    ) ?? null;

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        eyebrow="Detect"
        title="Threat intelligence feed"
        description="Every signal is shown, whether or not it matched anything in Detroit's inventory. That is what proves this system filters rather than alarms."
      />

      <div role="tablist" aria-label="Filter signals" className="mb-4 inline-flex rounded-lg bg-muted p-1">
        {FILTERS.map((f) => {
          const n = !signals ? null : f.id === 'all' ? signals.length : f.id === 'matched' ? matchedCount : signals.length - matchedCount;
          return (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === f.id ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground'
              )}
            >
              {f.label}
              {n !== null && <span className="ml-1.5 font-mono tabular-nums opacity-60">{n}</span>}
            </button>
          );
        })}
      </div>

      {!visible && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      )}

      {visible?.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {signals?.length === 0
              ? 'No signals polled yet. The poll cron populates this feed from CISA KEV.'
              : 'No signals in this view.'}
          </CardContent>
        </Card>
      )}

      <div key={filter} className="stagger space-y-3">
        {visible?.map((s) => {
          const affectedServices = [...new Set(s.matches.map((m) => m.service_slug))];
          const matched = affectedServices.length > 0;
          return (
            <Card key={s.id} className={cn('transition-shadow', matched && 'ring-status-at-risk/40')}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="font-mono text-sm">{s.external_id}</CardTitle>
                  <Badge variant="outline" className="text-[10px]">
                    {s.source}
                  </Badge>
                  <Badge variant={s.provenance === 'live' ? 'default' : 'outline'} className="text-[10px]">
                    {s.provenance === 'live' ? 'Live' : 'Simulated'}
                  </Badge>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {new Date(s.published_at).toLocaleDateString()}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-pretty">{s.title}</p>
                {s.vendor_project && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.vendor_project} / {s.product}
                  </p>
                )}
                {matched ? (
                  <p className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-status-at-risk">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                    Matched {affectedServices.length} Detroit service{affectedServices.length === 1 ? '' : 's'}
                  </p>
                ) : (
                  <p className="mt-2.5 flex items-center gap-1.5 text-xs text-status-ok">
                    <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                    No Detroit exposure found
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageContainer>
  );
}
