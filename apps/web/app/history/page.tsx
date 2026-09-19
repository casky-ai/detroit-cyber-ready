'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from 'cn';
import { ArrowRight, ClipboardList, ShieldAlert, Siren } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageContainer, PageHeader } from '@/components/page-header';

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

const STATUS_TONE: Record<string, string> = {
  completed: 'text-status-ok',
  failed: 'text-status-critical',
  running: 'text-status-at-risk',
  queued: 'text-muted-foreground',
};

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Siren; label: string; value: number | null; tone?: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg bg-muted', tone)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div>
          {value === null ? (
            <Skeleton className="mb-1 h-6 w-8" />
          ) : (
            <p className={cn('font-mono text-2xl font-semibold tabular-nums leading-none', tone)}>{value}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function HistoryPage() {
  const [items, setItems] = useState<HistoryInvestigation[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/investigations')
      .then((r) => r.json())
      .then((d) => setItems(d.investigations ?? []))
      .catch(() => setItems([]));
  }, []);

  const p1 = items?.filter((i) => i.priority === 'P1').length ?? null;
  const escalated = items?.filter((i) => i.escalated).length ?? null;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="History"
        title="Every investigation, on the record"
        description="Every investigation this deployment has run, newest first. This is what repeatability looks like across signals, services, and time."
      />

      <div className="stagger mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat icon={ClipboardList} label="Investigations run" value={items?.length ?? null} />
        <Stat icon={Siren} label="P1 priority" value={p1} tone="text-status-critical" />
        <Stat icon={ShieldAlert} label="Life-safety escalations" value={escalated} tone="text-brand-gold" />
      </div>

      <Card className="py-0">
        {!items ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">No investigations yet.</p>
            <Link href="/demo" className={buttonVariants({ size: 'sm' })}>
              Run the live demo <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-xs text-muted-foreground">Service</TableHead>
                <TableHead className="text-xs text-muted-foreground">Priority</TableHead>
                <TableHead className="hidden text-xs text-muted-foreground md:table-cell">Signal</TableHead>
                <TableHead className="text-right text-xs text-muted-foreground">Risk</TableHead>
                <TableHead className="hidden text-xs text-muted-foreground sm:table-cell">Status</TableHead>
                <TableHead className="hidden pr-4 text-right text-xs text-muted-foreground lg:table-cell">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="stagger">
              {items.map((inv) => (
                <TableRow
                  key={inv.id}
                  tabIndex={0}
                  role="link"
                  aria-label={`Open ${inv.service_name} investigation`}
                  className="cursor-pointer outline-none focus-visible:bg-muted/60"
                  onClick={() => router.push(`/investigations/${inv.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') router.push(`/investigations/${inv.id}`);
                  }}
                >
                  <TableCell className="pl-4 font-medium">
                    {inv.service_name}
                    {inv.escalated && (
                      <Badge variant="outline" className="ml-2 h-4 px-1.5 text-[10px] text-brand-gold">
                        Escalated
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {inv.priority ? (
                      <Badge variant={inv.priority === 'P1' ? 'destructive' : 'secondary'} className="text-[10px]">
                        {inv.priority}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden max-w-[280px] truncate text-muted-foreground md:table-cell">
                    {inv.signal ? (
                      <>
                        <span className="font-mono text-xs">{inv.signal.external_id}</span>{' '}
                        <span className="text-xs">{inv.signal.title}</span>
                      </>
                    ) : (
                      'Signal unavailable'
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{inv.risk_score ?? '-'}</TableCell>
                  <TableCell className={cn('hidden text-xs capitalize sm:table-cell', STATUS_TONE[inv.status] ?? 'text-muted-foreground')}>
                    {inv.status}
                  </TableCell>
                  <TableCell className="hidden pr-4 text-right font-mono text-xs text-muted-foreground lg:table-cell">
                    {new Date(inv.created_at).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </PageContainer>
  );
}
