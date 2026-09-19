'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface HistoryInvestigation {
  id: string;
  service_slug: string;
  service_name: string;
  status: string;
  priority: 'P1' | 'P2' | 'P3' | 'informational' | null;
  risk_score: number | null;
  escalated: boolean;
  created_at: string;
  ended_at: string | null;
  signal: { external_id: string; title: string } | null;
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryInvestigation[] | null>(null);

  useEffect(() => {
    fetch('/api/investigations')
      .then((r) => r.json())
      .then((d) => setItems(d.investigations ?? []));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/" className="text-xs text-muted-foreground hover:underline">
        ← City readiness board
      </Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold">Investigation History</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Every investigation this deployment has ever run, oldest to newest reversed. This is what repeatability
        looks like across signals, services, and time — not a one-off demo.
      </p>

      {!items && <p className="text-sm text-muted-foreground">Loading…</p>}
      {items?.length === 0 && <p className="text-sm text-muted-foreground">No investigations yet.</p>}

      <div className="space-y-2">
        {items?.map((inv) => (
          <Link key={inv.id} href={`/investigations/${inv.id}`}>
            <Card className="transition-colors hover:bg-accent/40">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-sm">{inv.service_name}</CardTitle>
                  {inv.priority && (
                    <Badge variant={inv.priority === 'P1' ? 'destructive' : 'secondary'} className="text-[10px]">
                      {inv.priority}
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] capitalize text-muted-foreground">
                    {inv.status}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(inv.created_at).toLocaleString()}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {inv.signal ? `${inv.signal.external_id} — ${inv.signal.title}` : 'Signal unavailable'}
                </p>
                {inv.risk_score !== null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Risk {inv.risk_score}/100{inv.escalated ? ' · Escalated' : ''}
                  </p>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
