import React from 'react';
import type { RateLimits, ContextUsage } from '../../shared/types';

export function UsageWidget({
  model,
  projectName,
  branch,
  rateLimits,
  contextUsage,
}: {
  model?: string;
  projectName?: string;
  branch?: string;
  rateLimits: RateLimits;
  contextUsage?: ContextUsage;
}) {
  const ctx = contextUsage && contextUsage.percentage > 0 ? contextUsage : null;

  if (!model && !projectName && !branch && !rateLimits.fiveHour && !rateLimits.sevenDay && !ctx) {
    return null;
  }

  const usageParts: string[] = [];
  if (ctx) usageParts.push(`ctx ${Math.round(ctx.percentage)}%`);
  if (rateLimits.fiveHour) usageParts.push(`5h ${Math.round(rateLimits.fiveHour.usedPercentage)}%`);
  if (rateLimits.sevenDay) usageParts.push(`7d ${Math.round(rateLimits.sevenDay.usedPercentage)}%`);

  const repoParts: string[] = [];
  if (projectName) repoParts.push(projectName);
  if (branch) repoParts.push(branch);

  return (
    <div
      className="px-3 py-1.5 border-b border-border/40 flex-shrink-0 text-[11px] font-mono text-muted-foreground/80 truncate flex items-center gap-2"
      style={{ background: 'hsl(var(--surface-1))' }}
    >
      {model && (
        <>
          <span className="text-[hsl(var(--primary))]">⚡</span>
          <span className="text-foreground/90">{model}</span>
        </>
      )}
      {repoParts.length > 0 && (
        <>
          {model && <span className="text-muted-foreground/40">|</span>}
          <span className="text-muted-foreground/70">{repoParts.join(' · ')}</span>
        </>
      )}
      {usageParts.length > 0 && (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span>{usageParts.join(' · ')}</span>
        </>
      )}
    </div>
  );
}
