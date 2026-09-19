'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { History, Map, Play, Radar } from 'lucide-react';
import { cn } from 'cn';
import { buttonVariants } from '@/components/ui/button';

// One header for every route, so moving between pages never changes the
// frame around the content, only the content itself.
const NAV = [
  { href: '/', label: 'Readiness', icon: Map },
  { href: '/signals', label: 'Threat feed', icon: Radar },
  { href: '/history', label: 'History', icon: History },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
        <Link href="/" className="group flex min-w-0 items-center gap-2 rounded-md sm:gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-verdigris/20 ring-1 ring-brand-verdigris/50 transition-colors group-hover:bg-brand-verdigris/30">
            <span className="h-2.5 w-2.5 rounded-full bg-brand-gold shadow-[0_0_10px] shadow-brand-gold/60" />
          </span>
          <span className="truncate text-sm font-bold tracking-tight sm:text-[15px]">Detroit Cyber Ready</span>
        </Link>

        <nav aria-label="Primary" className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'gap-1.5 text-muted-foreground transition-colors',
                  active && 'bg-accent text-foreground'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
          <Link
            href="/demo"
            aria-current={isActive(pathname, '/demo') ? 'page' : undefined}
            aria-label="Live demo"
            className={cn(buttonVariants({ size: 'sm' }), 'ml-1 gap-1.5 font-semibold')}
          >
            <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
            <span className="hidden sm:inline">Live demo</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
