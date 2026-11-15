import type { ReactNode } from "react";

export function Label({ children }: { children: ReactNode }) {
  return <span className="font-serif text-[18px] font-medium tracking-tight text-ink">{children}</span>;
}
