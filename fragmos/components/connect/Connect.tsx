"use client";

import { useEffect, useRef, useState } from "react";
import {
  EngineUnreachable,
  fetchGateway,
  fetchKeys,
  type ApiKey,
  type CreatedKey,
  type Gateway,
} from "@/lib/connect/api";
import type { Link } from "@/lib/monitor/store";
import { EngineDown } from "../EngineDown";
import { Header } from "../Header";
import { Label } from "../Label";
import { LinkStatus } from "../monitor/Stats";
import { CopyButton } from "./CopyButton";
import { Keys } from "./Keys";
import { Snippets } from "./Snippets";

// `error` is set while the engine answers but a poll fails, such as an HTTP error or a body of the wrong shape.
type Engine =
  | { link: Extract<Link, "connecting">; error: string | null }
  | { link: Extract<Link, "reconnecting"> }
  | { link: Extract<Link, "live">; gateway: Gateway; keys: ApiKey[]; now: number; error: string | null };

// Live polling keeps "last used" fresh while an agent works; the shorter delay finds a restarted engine quickly.
const LIVE_POLL_MS = 5000;
const DOWN_RETRY_MS = 1500;

function failed(prev: Engine, e: unknown): Engine {
  if (e instanceof EngineUnreachable) return { link: "reconnecting" };
  const error = e instanceof Error ? e.message : String(e);
  return prev.link === "live" ? { ...prev, error } : { link: "connecting", error };
}

function useEngine() {
  const [engine, setEngine] = useState<Engine>({ link: "connecting", error: null });
  // A poll that started before a create or revoke would put back the old list; bumping this drops it.
  const generation = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const poll = async () => {
      const started = generation.current;
      let delay = LIVE_POLL_MS;
      try {
        const [gateway, keys] = await Promise.all([fetchGateway(), fetchKeys()]);
        if (!disposed && started === generation.current) {
          setEngine({ link: "live", gateway, keys, now: Date.now() / 1000, error: null });
        }
      } catch (e) {
        delay = DOWN_RETRY_MS;
        if (!disposed && started === generation.current) setEngine((prev) => failed(prev, e));
      }
      if (!disposed) timer = setTimeout(poll, delay);
    };

    poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, []);

  const editKeys = (edit: (keys: ApiKey[]) => ApiKey[]) => {
    generation.current++;
    setEngine((e) => (e.link === "live" ? { ...e, keys: edit(e.keys), now: Date.now() / 1000 } : e));
  };

  return [engine, editKeys] as const;
}

function EngineError({ error }: { error: string }) {
  return (
    <div role="alert" className="animate-fade rounded-xl bg-risk/60 px-4 py-3 text-[13px] text-terracotta">
      The engine answered with an error. Retrying in the background.
      <div className="mt-1 font-mono text-[12px]">{error}</div>
    </div>
  );
}

function Endpoint({ label, hint, url }: { label: string; hint: string; url: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-canvas px-4 py-3">
      <div className="w-44 shrink-0">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        <div className="text-[11.5px] text-taupe">{hint}</div>
      </div>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{url}</span>
      <CopyButton text={url} what={`${label} base URL`} />
    </div>
  );
}

function Endpoints({ gateway }: { gateway: Gateway }) {
  return (
    <section className="animate-rise rounded-2xl border border-line bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Label>Endpoints</Label>
        <span className="text-[12px] text-taupe">Use these as the base URL in place of the provider&apos;s.</span>
      </div>
      <div className="flex flex-col gap-2">
        <Endpoint label="OpenAI-compatible" hint="Chat Completions" url={gateway.openai_base_url} />
        <Endpoint label="Anthropic" hint="Messages" url={gateway.anthropic_base_url} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[12px] text-taupe">Models</span>
        {gateway.models.map((m) => (
          <span key={m} className="rounded-md bg-panel px-2 py-0.5 font-mono text-[12px] text-ink">
            {m}
          </span>
        ))}
        <span className="ml-1 text-[12px] text-taupe">Pass one as the model name.</span>
      </div>
    </section>
  );
}

export function Connect() {
  const [engine, editKeys] = useEngine();
  const [created, setCreated] = useState<CreatedKey | null>(null);

  return (
    <div className="flex min-h-screen flex-col">
      <Header trailing={<LinkStatus link={engine.link} />} />
      {engine.link === "reconnecting" ? (
        <EngineDown>Connect makes keys on the Sentinel engine, and it cannot reach it.</EngineDown>
      ) : engine.link === "connecting" ? (
        <main className="mx-auto w-full max-w-4xl flex-1 px-6 pt-10">
          {engine.error && <EngineError error={engine.error} />}
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 pb-16 pt-10">
          <div className="animate-rise">
            <h2 className="font-serif text-[34px] font-medium leading-tight tracking-tight text-ink">
              Connect an agent
            </h2>
            <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-taupe">
              Point any OpenAI or Anthropic client at Fragmós. Every request is scrubbed of personal data before it
              reaches a model, and every turn shows up in Monitor.
            </p>
          </div>
          {engine.error && <EngineError error={engine.error} />}
          <Endpoints gateway={engine.gateway} />
          <Keys
            keys={engine.keys}
            now={engine.now}
            created={created}
            onCreated={(fresh) => {
              setCreated(fresh);
              const { id, name, prefix, created_at, last_used_at } = fresh;
              editKeys((keys) => [...keys.filter((k) => k.id !== id), { id, name, prefix, created_at, last_used_at }]);
            }}
            onDismissCreated={() => setCreated(null)}
            onRevoked={(key) => {
              setCreated((shown) => (shown?.id === key.id ? null : shown));
              editKeys((keys) => keys.filter((k) => k.id !== key.id));
            }}
          />
          <Snippets gateway={engine.gateway} apiKey={created?.key ?? null} />
        </main>
      )}
    </div>
  );
}
