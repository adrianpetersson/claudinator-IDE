import React from 'react';
import type { RateLimits, ContextUsage } from '../../shared/types';

export function UsageWidget({
  rateLimits,
  contextUsage,
}: {
  rateLimits: RateLimits;
  contextUsage?: ContextUsage;
}) {
  const ctx = contextUsage && contextUsage.percentage > 0 ? contextUsage : null;
  if (!rateLimits.fiveHour && !rateLimits.sevenDay && !ctx) return null;

  const parts: string[] = [];
  if (ctx) parts.push(`ctx ${Math.round(ctx.percentage)}%`);
  if (rateLimits.fiveHour) parts.push(`5h ${Math.round(rateLimits.fiveHour.usedPercentage)}%`);
  if (rateLimits.sevenDay) parts.push(`7d ${Math.round(rateLimits.sevenDay.usedPercentage)}%`);

  return (
    <div
      className="px-3 py-1.5 border-b border-border/40 flex-shrink-0 text-[11px] font-mono text-muted-foreground/70 truncate"
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {parts.join(' · ')}
    </div>
  );
}
