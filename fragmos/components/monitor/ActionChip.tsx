import type { Action } from "@/lib/monitor/api";
import { ACTION_STYLE } from "@/lib/monitor/theme";

export function ActionChip({ action, count, small }: { action: Action; count?: number; small?: boolean }) {
  const style = ACTION_STYLE[action];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-[4px] font-mono font-medium tracking-wide ring-1 ring-inset transition-colors duration-500 ease-ios ${style.chip} ${
        small ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {action}
      {count !== undefined && <span className="tabular-nums text-ink">{count}</span>}
    </span>
  );
}

export function EntityPill({ type, count }: { type: string; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[4px] bg-panel px-1.5 py-px font-mono text-[10.5px] text-taupe">
      {type}
      {count !== undefined && <span className="tabular-nums text-taupe/70">×{count}</span>}
    </span>
  );
}
