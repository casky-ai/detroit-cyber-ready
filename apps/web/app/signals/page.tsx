'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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

export default function SignalsFeedPage() {
  const [signals, setSignals] = useState<SignalRow[] | null>(null);

  useEffect(() => {
    fetch('/api/signals')
      .then((r) => r.json())
      .then((d) => setSignals(d.signals ?? []));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/" className="text-xs text-muted-foreground hover:underline">
        ← City readiness board
      </Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold">Threat Intelligence Feed</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Every signal is shown, whether or not it matched anything in Detroit&apos;s inventory — that is what
        proves this system filters rather than alarms.
      </p>

      {!signals && <p className="text-sm text-muted-foreground">Loading…</p>}
      {signals?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No signals polled yet. Trigger a poll from <code>/api/signals/poll</code> or inject the demo signal
          from the readiness board.
        </p>
      )}

      <div className="space-y-3">
        {signals?.map((s) => {
          const affectedServices = [...new Set(s.matches.map((m) => m.service_slug))];
          return (
            <Card key={s.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">{s.external_id}</CardTitle>
                  <Badge variant="outline" className="text-[10px]">
                    {s.source}
                  </Badge>
                  <Badge variant={s.provenance === 'live' ? 'default' : 'outline'} className="text-[10px]">
                    {s.provenance === 'live' ? 'Live' : 'Simulated'}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(s.published_at).toLocaleDateString()}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{s.title}</p>
                {s.vendor_project && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {s.vendor_project} / {s.product}
                  </p>
                )}
                {affectedServices.length > 0 ? (
                  <p className="mt-2 text-xs text-status-at-risk">
                    Matched {affectedServices.length} Detroit service{affectedServices.length === 1 ? '' : 's'}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-status-ok">No Detroit exposure found</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
