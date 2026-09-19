'use client';

import { useEffect, useState } from 'react';

// The real wall clock, ticking every second, in big bold digits. Every
// timeline event is stamped with this same clock at the moment it fires —
// nothing about the demo's timing is scripted or faked, which is the point:
// this is what "ahead of the game" actually looks like in real time.
export function LiveClock({ className = '' }: { className?: string }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString('en-US', { hour12: false });

  return (
    <div className={`font-mono text-5xl font-bold tabular-nums tracking-tight sm:text-7xl ${className}`}>
      {time}
    </div>
  );
}

export function nowStamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}
