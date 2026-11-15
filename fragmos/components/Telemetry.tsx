"use client";

import { useEffect, useRef, useState } from "react";

export interface EgressEvent {
  t: number;
  bytes: number;
  dir: "out" | "in";
}

interface Props {
  events: EgressEvent[];
  scrubMs: number;
}

const WINDOW_MS = 60_000;
const W = 320;
const H = 104;
const MID = H / 2;
const RANGE = MID - 8;
const POINTS = 180;
const RISE_MS = 120;
const FALL_MS = 1600;
const PEAK_NORMALIZER = 0.76;
const FADE_OUT_MS = 700;
const OUT_COLOR = "#2c241e";
const IN_COLOR = "#a9803a";

function formatBytes(n: number) {
  if (n < 1024) {
    return n + " B";
  }
  return (n / 1024).toFixed(1) + " KB";
}

export function Telemetry({ events, scrubMs }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const idleTimer = useRef<number | null>(null);
  const eventsRef = useRef<EgressEvent[]>(events);
  const outLineRef = useRef<SVGPathElement>(null);
  const outAreaRef = useRef<SVGPathElement>(null);
  const inLineRef = useRef<SVGPathElement>(null);
  const inAreaRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) {
        window.clearTimeout(closeTimer.current);
      }
      if (idleTimer.current) {
        window.clearTimeout(idleTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    let frame = 0;
    let yMax = 256;

    function sample(list: EgressEvent[], dir: "out" | "in", now: number) {
      const values: number[] = [];
      for (let i = 0; i < POINTS; i++) {
        const t = now - WINDOW_MS + (i / (POINTS - 1)) * WINDOW_MS;
        let v = 0;
        for (let e = 0; e < list.length; e++) {
          if (list[e].dir !== dir) {
            continue;
          }
          const age = t - list[e].t;
          if (age >= 0 && age < FALL_MS * 6) {
            const pulse = (1 - Math.exp(-age / RISE_MS)) * Math.exp(-age / FALL_MS);
            v += (list[e].bytes * pulse) / PEAK_NORMALIZER;
          }
        }
        values.push(v);
      }
      return values;
    }

    function build(values: number[], sign: number) {
      let d = "";
      for (let i = 0; i < POINTS; i++) {
        const x = (i / (POINTS - 1)) * W;
        const y = MID + sign * Math.min(values[i] / yMax, 1) * RANGE;
        d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
      }
      return d;
    }

    function draw() {
      const now = Date.now();
      const list = eventsRef.current;
      const out = sample(list, "out", now);
      const inc = sample(list, "in", now);

      let peak = 0;
      for (let i = 0; i < POINTS; i++) {
        peak = Math.max(peak, out[i], inc[i]);
      }
      const target = Math.max(256, peak * 1.15);
      yMax = yMax + (target - yMax) * (target > yMax ? 0.4 : 0.06);

      const outPath = build(out, -1);
      const inPath = build(inc, 1);
      const close = "L" + W + " " + MID + " L0 " + MID + " Z";

      outLineRef.current?.setAttribute("d", outPath);
      outAreaRef.current?.setAttribute("d", outPath + close);
      inLineRef.current?.setAttribute("d", inPath);
      inAreaRef.current?.setAttribute("d", inPath + close);
      frame = requestAnimationFrame(draw);
    }

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  function clearTimers() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (idleTimer.current) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  }

  function show() {
    clearTimers();
    setActive(true);
    setOpen(true);
  }

  function hide() {
    clearTimers();
    setOpen(false);
    idleTimer.current = window.setTimeout(() => setActive(false), FADE_OUT_MS);
  }

  function hideSoon() {
    clearTimers();
    closeTimer.current = window.setTimeout(hide, 160);
  }

  let sentBytes = 0;
  let receivedBytes = 0;
  let requests = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].dir === "out") {
      sentBytes += events[i].bytes;
      requests++;
    } else {
      receivedBytes += events[i].bytes;
    }
  }

  const flat = "M0 " + MID + " L" + W + " " + MID;

  return (
    <div
      className="relative"
      onPointerEnter={show}
      onPointerLeave={hideSoon}
      onFocus={show}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          hideSoon();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          hide();
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label="Traffic telemetry"
        onClick={() => (open ? hide() : show())}
        className="flex items-center gap-2 py-2 text-[12px] text-taupe outline-none transition-colors duration-500 ease-ios hover:text-ink focus-visible:text-ink"
      >
        <span className="text-taupe/40">·</span>
        <span className="text-forest">0 B egress</span>
        <span className="text-taupe/40">·</span>
        <span className="tabular-nums" suppressHydrationWarning>
          {scrubMs.toFixed(1)} ms
        </span>
      </button>

      <div
        aria-hidden={!open}
        className={`absolute right-0 top-full z-40 pt-3 transition-opacity duration-300 ease-out ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-5 shadow-[0_20px_48px_-20px_rgba(44,36,30,0.28)]">
          <div className="mb-3 flex items-baseline justify-between text-[12px] text-taupe">
            <span>Traffic, last 60 s</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: OUT_COLOR }} />
                Sent
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: IN_COLOR }} />
                Received
              </span>
            </span>
          </div>

          <svg viewBox={"0 0 " + W + " " + H} className="block w-full" role="img" aria-label="Sent and received traffic over the last 60 seconds">
            <defs>
              <linearGradient id="out-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={OUT_COLOR} stopOpacity="0.14" />
                <stop offset="100%" stopColor={OUT_COLOR} stopOpacity="0" />
              </linearGradient>
              <linearGradient id="in-fill" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={IN_COLOR} stopOpacity="0.22" />
                <stop offset="100%" stopColor={IN_COLOR} stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" x2={W} y1="4" y2="4" stroke="#e5e2d9" strokeWidth="1" />
            <line x1="0" x2={W} y1={H - 4} y2={H - 4} stroke="#e5e2d9" strokeWidth="1" />
            <path ref={outAreaRef} d={flat + " Z"} fill="url(#out-fill)" />
            <path ref={inAreaRef} d={flat + " Z"} fill="url(#in-fill)" />
            <path
              ref={outLineRef}
              d={flat}
              fill="none"
              stroke={OUT_COLOR}
              strokeOpacity="0.8"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              ref={inLineRef}
              d={flat}
              fill="none"
              stroke={IN_COLOR}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <line x1="0" x2={W} y1={MID} y2={MID} stroke="#2d5a27" strokeWidth="1.5" strokeOpacity="0.85" />
          </svg>

          <div className="mt-1.5 flex justify-between text-[10.5px] text-taupe/80">
            <span>60 s ago</span>
            <span>now</span>
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-x-3 border-t border-line pt-4 text-[11.5px] text-taupe">
            <div>
              <dt>Raw egress</dt>
              <dd className="mt-1 text-[15px] font-medium text-forest">0 B</dd>
            </div>
            <div>
              <dt>Sent</dt>
              <dd className="mt-1 text-[15px] font-medium tabular-nums text-ink">
                {formatBytes(sentBytes)}
                <span className="ml-1 text-[11.5px] font-normal text-taupe">{requests} req</span>
              </dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd className="mt-1 text-[15px] font-medium tabular-nums text-ink">{formatBytes(receivedBytes)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
