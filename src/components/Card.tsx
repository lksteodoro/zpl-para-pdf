import type { ReactNode } from 'react';
import clsx from 'clsx';

export function Card({
  children,
  className,
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel)] p-5',
        className
      )}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between">
          {title && <h3 className="text-sm font-medium text-[var(--color-text)]">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
