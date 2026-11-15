import type { ReactNode } from "react";

/** `children` says what this page needs the engine for. */
export function EngineDown({ children }: { children: ReactNode }) {
  return (
    <main className="grid flex-1 place-items-center px-6">
      <div className="max-w-md animate-rise text-center">
        <div className="font-serif text-[28px] font-medium tracking-tight text-ink">The engine is not running</div>
        <p className="mt-3 text-[14px] leading-relaxed text-taupe">
          {children} Start the whole product from the repository root, and this page connects on its own.
        </p>
        <pre className="mt-5 inline-block rounded-lg bg-panel px-4 py-2 font-mono text-[13px] text-ink">make demo</pre>
        <p className="mt-4 text-[12px] text-taupe">Retrying in the background.</p>
      </div>
    </main>
  );
}
