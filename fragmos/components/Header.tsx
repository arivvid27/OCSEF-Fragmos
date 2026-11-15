"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Telemetry, type EgressEvent } from "./Telemetry";

type Props = { trailing?: ReactNode } & (
  | { egress: EgressEvent[]; scrubMs: number }
  | { egress?: never; scrubMs?: never }
);

const PAGES = [
  { href: "/", label: "Workspace" },
  { href: "/monitor", label: "Monitor" },
  { href: "/connect", label: "Connect" },
] as const;

export function Header({ egress, scrubMs, trailing }: Props) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 h-14 shrink-0 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="flex h-full items-center justify-between gap-4 px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-6">
          <h1 className="font-serif text-[26px] font-medium tracking-tight text-ink">Fragmós</h1>
          <nav aria-label="Pages" className="flex items-baseline gap-1 rounded-lg bg-panel/70 p-0.5 text-[12.5px]">
            {PAGES.map((page) => {
              const current = pathname === page.href;
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  aria-current={current ? "page" : undefined}
                  className={`rounded-md px-3 py-1 transition-colors duration-300 ease-ios ${
                    current ? "bg-surface text-ink shadow-sm" : "text-taupe hover:text-ink"
                  }`}
                >
                  {page.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {egress && <Telemetry events={egress} scrubMs={scrubMs} />}
          {trailing}
        </div>
      </div>
    </header>
  );
}
