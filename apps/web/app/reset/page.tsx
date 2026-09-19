'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleCheck } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { PageContainer } from '@/components/page-header';
import { ResetDemoButton } from '@/components/reset-demo-button';

// Presenter utility: clear the board before a run. Visiting this page
// changes nothing on its own; the reset is a deliberate button press.
export default function ResetPage() {
  const [count, setCount] = useState<number | null>(null);
  const [removed, setRemoved] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/demo/reset')
      .then((r) => r.json())
      .then((d) => setCount(d.investigations ?? 0))
      .catch(() => setCount(null));
  }, [removed]);

  return (
    <PageContainer className="max-w-xl py-20">
      <h1 className="text-3xl font-extrabold tracking-tight">Reset the demo</h1>
      <p className="mt-2 text-[15px] text-pretty text-muted-foreground">
        Clears every investigation so the dashboard opens on &ldquo;All systems operational&rdquo;. Threat signals and the
        city inventory are kept.
      </p>

      <p className={removed === null ? 'mt-6 text-sm' : 'hidden'}>
        {count === null
          ? 'Checking the board.'
          : count === 0
            ? 'The board is already clear.'
            : `${count} investigation${count === 1 ? '' : 's'} on the board.`}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {removed === null ? (
          <ResetDemoButton size="lg" onDone={setRemoved} />
        ) : (
          <p className="flex animate-in items-center gap-2 font-semibold text-status-ok fade-in-0 duration-300">
            <CircleCheck className="h-5 w-5" aria-hidden />
            Removed {removed} investigation{removed === 1 ? '' : 's'}. The board is all clear.
          </p>
        )}
        <Link href="/" className={buttonVariants({ variant: removed === null ? 'ghost' : 'default', size: 'lg' })}>
          Go to the dashboard
        </Link>
      </div>
    </PageContainer>
  );
}
