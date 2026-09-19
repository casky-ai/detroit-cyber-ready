'use client';

import { useEffect, useState } from 'react';

// Pinned to Detroit, so the clock is right on any presenter's laptop.
const DETROIT_TIME: Intl.DateTimeFormatOptions = { hour12: false, timeZone: 'America/Detroit' };

// The real wall clock, ticking every second, in big bold digits. Every
// timeline event is stamped with this same clock at the moment it fires —
// nothing about the demo's timing is scripted or faked, which is the point;
// this is what "ahead of the game" actually looks like in real time.
export function LiveClock({ className = '' }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString('en-US', DETROIT_TIME);

  return (
    <div
      suppressHydrationWarning
      className={`text-6xl font-extrabold tabular-nums tracking-[-0.03em] sm:text-8xl ${className}`}
    >
      {time}
    </div>
  );
}

export function nowStamp(): string {
  return new Date().toLocaleTimeString('en-US', DETROIT_TIME);
}
