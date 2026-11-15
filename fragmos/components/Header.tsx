import type { ReactNode } from "react";
import { Telemetry, type EgressEvent } from "./Telemetry";

interface Props {
  egress: EgressEvent[];
  scrubMs: number;
  trailing?: ReactNode;
}

export function Header({ egress, scrubMs, trailing }: Props) {
  return (
    <header className="sticky top-0 z-30 h-14 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="flex h-full items-center justify-between gap-4 px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <h1 className="font-serif text-[26px] font-medium tracking-tight text-ink">Fragmós</h1>
        </div>
        <div className="flex items-center gap-3">
          <Telemetry events={egress} scrubMs={scrubMs} />
          {trailing}
        </div>
      </div>
    </header>
  );
}
