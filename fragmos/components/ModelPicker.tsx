"use client";

import { useEffect, useId, useRef, useState } from "react";

interface Props {
  labelId: string;
  value: string;
  options: string[];
  defaultLabel: string;
  loading: boolean;
  onSelect: (model: string) => void;
}

export function ModelPicker({ labelId, value, options, defaultLabel, loading, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = "models-" + useId().replace(/[^a-zA-Z0-9]/g, "");

  const needle = query.trim().toLowerCase();
  const matches = options.filter((m) => m.toLowerCase().includes(needle));
  const entries = needle === "" ? [{ value: "", label: defaultLabel }, ...matches.map((m) => ({ value: m, label: m }))] : matches.map((m) => ({ value: m, label: m }));

  useEffect(() => {
    if (!open) {
      return;
    }
    searchRef.current?.focus();
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const row = listRef.current?.children[active] as HTMLElement | undefined;
    row?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function openList() {
    const at = entries.findIndex((e) => e.value === value);
    setActive(at === -1 ? 0 : at);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(model: string) {
    onSelect(model);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        openList();
      } else {
        setActive(Math.min(active + 1, entries.length - 1));
      }
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setActive(Math.max(active - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (entries[active]) {
        choose(entries[active].value);
      }
    }
  }

  const shown = value || defaultLabel;

  return (
    <div ref={wrapRef} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-controls={listId}
        aria-expanded={open}
        aria-labelledby={labelId}
        onClick={() => (open ? close() : openList())}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2 text-left text-[13.5px] text-ink outline-none transition-[border-color,box-shadow] duration-300 ease-ios hover:border-taupe/40 focus-visible:border-forest/50 focus-visible:shadow-[0_0_0_3px_rgba(45,90,39,0.1)]"
      >
        <span className={`truncate ${value ? "" : "text-taupe"}`}>{shown}</span>
        <span className="flex shrink-0 items-center gap-2">
          {loading && <span className="text-[11.5px] text-taupe">Loading</span>}
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className={`h-3.5 w-3.5 text-taupe transition-transform duration-500 ease-ios ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path d="m5 8 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      <div
        inert={!open}
        style={{ transformOrigin: "top" }}
        className={`absolute left-0 right-0 top-full z-20 pt-1.5 transition-[opacity,transform] duration-[320ms] ease-ios ${
          open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0"
        }`}
      >
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-[0_16px_40px_-16px_rgba(44,36,30,0.3)]">
          <div className="border-b border-line px-3 py-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Search models"
              aria-label="Search models"
              spellCheck={false}
              autoComplete="off"
              className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-taupe/60"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" className="scroll-warm max-h-48 overflow-y-auto p-1">
            {entries.length === 0 && <li className="px-3 py-2.5 text-[12.5px] text-taupe">No models match “{query}”.</li>}
            {entries.map((entry, i) => {
              const selected = entry.value === value;
              return (
                <li key={entry.value || "default"} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => choose(entry.value)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-150 ${
                      i === active ? "bg-panel" : ""
                    } ${entry.value === "" ? "text-taupe" : "text-ink"}`}
                  >
                    <span className="truncate">{entry.label}</span>
                    {selected && (
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 shrink-0 text-forest" aria-hidden>
                        <path d="m4.5 10.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
