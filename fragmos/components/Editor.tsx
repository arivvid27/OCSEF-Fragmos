"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { RiskSpan, VaultEntry } from "@/lib/scrubber";
import { adjustSpans } from "@/lib/spans";
import { TokenBadge } from "./TokenBadge";

interface Props {
  value: string;
  onChange: (value: string) => void;
  deferredText: string;
  spans: RiskSpan[];
  vault: VaultEntry[];
  activeToken: string | null;
  onActiveToken: (token: string | null) => void;
  onMaskTerm: (term: string) => void;
  onSubmit: () => void;
}

interface Hover {
  key: string;
  token: string;
  rect: DOMRect;
}

const TEXT_CLASS = "whitespace-pre-wrap break-words text-[15px] leading-[1.85] tracking-normal";
const POPOVER_WIDTH = 352;
const GAP = 10;

export function Editor({
  value,
  onChange,
  deferredText,
  spans,
  vault,
  activeToken,
  onActiveToken,
  onMaskTerm,
  onSubmit,
}: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const frameRef = useRef(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const [pick, setPick] = useState<{ term: string; x: number; y: number } | null>(null);

  const liveSpans = useMemo(() => {
    if (value === deferredText) {
      return spans;
    }
    return adjustSpans(spans, deferredText, value);
  }, [value, deferredText, spans]);

  const showing = hover !== null || pick !== null;
  useEffect(() => {
    if (!showing) {
      return;
    }
    const dismiss = () => {
      setHover(null);
      setPick(null);
    };
    window.addEventListener("scroll", dismiss, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", dismiss, { capture: true });
  }, [showing]);

  useEffect(() => {
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < liveSpans.length; i++) {
    const s = liveSpans[i];
    if (s.start > cursor) {
      nodes.push(value.slice(cursor, s.start));
    }
    const active = activeToken === s.token;
    nodes.push(
      <mark
        key={s.start + "-" + i}
        data-token={s.token}
        data-start={s.start}
        className={`rounded-[2px] text-inherit shadow-[inset_0_-2px_0_var(--color-risk-line)] transition-colors duration-150 ${
          active ? "bg-[#f1cdc7]" : "bg-risk"
        }`}
      >
        {value.slice(s.start, s.end)}
      </mark>,
    );
    cursor = s.end;
  }
  if (cursor < value.length) {
    nodes.push(value.slice(cursor));
  }

  function handleMove(e: React.MouseEvent) {
    const x = e.clientX;
    const y = e.clientY;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const stack = document.elementsFromPoint(x, y);
      let hit: HTMLElement | null = null;
      for (let i = 0; i < stack.length; i++) {
        const el = stack[i];
        if (el instanceof HTMLElement && el.tagName === "MARK") {
          hit = el;
          break;
        }
      }
      if (!hit || !hit.dataset.token) {
        setHover(null);
        onActiveToken(null);
        return;
      }
      const rects = Array.from(hit.getClientRects());
      let rect = rects[0];
      for (let i = 0; i < rects.length; i++) {
        if (y >= rects[i].top && y <= rects[i].bottom && x >= rects[i].left && x <= rects[i].right) {
          rect = rects[i];
        }
      }
      const token = hit.dataset.token;
      const key = hit.dataset.start + ":" + Math.round(rect.top);
      setHover((cur) => (cur && cur.key === key ? cur : { key: key, token: token, rect: rect }));
      onActiveToken(token);
    });
  }

  function handleLeave() {
    cancelAnimationFrame(frameRef.current);
    setHover(null);
    onActiveToken(null);
  }

  function handleMouseUp(e: React.MouseEvent<HTMLTextAreaElement>) {
    const x = e.clientX;
    const y = e.clientY;
    window.setTimeout(() => {
      const area = areaRef.current;
      if (!area) {
        return;
      }
      const from = area.selectionStart;
      const to = area.selectionEnd;
      const term = area.value.slice(from, to).replace(/\s+/g, " ").trim();
      if (from === to || term.length < 2 || term.length > 80) {
        setPick(null);
        return;
      }
      const insideHighlight = liveSpans.some((s) => from >= s.start && to <= s.end);
      setPick(insideHighlight ? null : { term: term, x: x, y: y });
    }, 0);
  }

  function confirmMask() {
    if (!pick) {
      return;
    }
    onMaskTerm(pick.term);
    setPick(null);
    areaRef.current?.setSelectionRange(0, 0);
  }

  const hovered = hover ? vault.find((v) => v.token === hover.token) : undefined;

  return (
    <div className="relative min-h-[11rem]">
      <div aria-hidden className={`min-h-[11rem] text-ink ${TEXT_CLASS}`}>
        {nodes}
        {"​"}
      </div>
      <textarea
        ref={areaRef}
        aria-label="Input"
        value={value}
        spellCheck={false}
        placeholder="Paste or type anything sensitive. Names, IDs, contacts and secrets are masked on this device before anything is sent."
        onChange={(e) => {
          setPick(null);
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onMouseDown={() => setPick(null)}
        onMouseUp={handleMouseUp}
        className={`absolute inset-0 h-full w-full resize-none overflow-hidden bg-transparent p-0 text-transparent caret-ink outline-none selection:bg-forest/20 selection:text-transparent placeholder:text-taupe/60 ${TEXT_CLASS}`}
      />

      {hover && hovered && typeof document !== "undefined"
        ? createPortal(<Popover entry={hovered} rect={hover.rect} />, document.body)
        : null}

      {pick && typeof document !== "undefined"
        ? createPortal(
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={confirmMask}
              style={{
                left: Math.min(Math.max(12, pick.x - 20), window.innerWidth - 244),
                top: pick.y + 16,
              }}
              className="fixed z-50 max-w-[232px] animate-pop truncate rounded-lg bg-ink px-3.5 py-1.5 text-[12.5px] font-medium text-canvas shadow-lg transition-colors duration-300 ease-ios hover:bg-forest"
            >
              Mask “{pick.term}”
            </button>,
            document.body,
          )
        : null}
    </div>
  );
}

function Popover({ entry, rect }: { entry: VaultEntry; rect: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - POPOVER_WIDTH - 12);
    const fitsBelow = rect.bottom + GAP + height <= window.innerHeight - 12;
    setPos({ left: left, top: fitsBelow ? rect.bottom + GAP : Math.max(12, rect.top - GAP - height) });
  }, [rect, entry]);

  return (
    <div
      ref={ref}
      role="tooltip"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, width: POPOVER_WIDTH, visibility: pos ? "visible" : "hidden" }}
      className="pointer-events-none fixed z-50 animate-pop rounded-xl border border-line bg-surface p-5 shadow-[0_18px_50px_-12px_rgba(44,36,30,0.28)]"
    >
      <div className="mb-3 flex items-center gap-2">
        <TokenBadge token={entry.token} />
        <span className="text-[12px] font-medium text-terracotta">{entry.label}</span>
      </div>
      <PopoverSection title="What it is & applicable regulation">{entry.regulation}</PopoverSection>
      <PopoverSection title="Why it is sensitive">{entry.whySensitive}</PopoverSection>
      <PopoverSection title="Consequences of exposure" last>
        {entry.consequence}
      </PopoverSection>
    </div>
  );
}

function PopoverSection({ title, children, last = false }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={last ? "" : "mb-3"}>
      <h4 className="mb-1 font-serif text-[15px] font-medium text-ink">{title}</h4>
      <p className="text-[12.5px] leading-relaxed text-taupe">{children}</p>
    </div>
  );
}
