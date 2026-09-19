import type { ReactNode } from 'react';

// The same title block on every route: eyebrow, title, one-line
// description, and an optional right-aligned slot for badges or actions.
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-brand-gold">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 ${className}`}>{children}</main>;
}
