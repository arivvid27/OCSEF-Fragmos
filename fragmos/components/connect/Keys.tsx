"use client";

import { useState, type FormEvent } from "react";
import { createKey, revokeKey, type ApiKey, type CreatedKey } from "@/lib/connect/api";
import { since } from "@/lib/connect/view";
import { Label } from "../Label";
import { CopyButton } from "./CopyButton";

const DANGER =
  "rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-terracotta ring-1 ring-inset ring-risk-line/40 transition-[background-color,transform,opacity] duration-300 ease-ios hover:bg-risk active:scale-[0.98] disabled:opacity-40";
const COLUMNS = "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] gap-4";
const PRIMARY =
  "rounded-lg bg-forest px-4 py-2 text-[13px] font-semibold text-white transition-[background-color,transform,opacity] duration-300 ease-ios hover:bg-forest-deep active:scale-[0.98] disabled:opacity-40";

function NewKey({ created, onDone }: { created: CreatedKey; onDone: () => void }) {
  return (
    <div role="status" className="animate-pop rounded-xl bg-token p-4 ring-1 ring-inset ring-forest/20">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-serif text-[16px] font-medium text-token-ink">Key for {created.name}</span>
        <button
          type="button"
          onClick={onDone}
          className="text-[12px] text-token-ink/70 transition-colors duration-300 hover:text-token-ink"
        >
          Done
        </button>
      </div>
      <p className="mt-1 text-[12.5px] text-token-ink/80">
        Copy it now. You won&apos;t see this key again. Fragmós keeps only its first characters.
      </p>
      <div className="mt-3 flex items-center gap-3 rounded-lg bg-surface px-3 py-2.5">
        <span className="min-w-0 flex-1 break-all font-mono text-[13px] text-ink">{created.key}</span>
        <CopyButton text={created.key} what="the new key" />
      </div>
    </div>
  );
}

function KeyRow({ apiKey, now, onRevoked }: { apiKey: ApiKey; now: number; onRevoked: () => void }) {
  const [step, setStep] = useState<"idle" | "confirm" | "revoking">("idle");
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setStep("revoking");
    setError(null);
    try {
      await revokeKey(apiKey.id);
      onRevoked();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("confirm");
    }
  }

  return (
    <li className="animate-rise border-t border-line py-3 first:border-t-0">
      <div className={`${COLUMNS} items-center`}>
        <span className="truncate text-[13.5px] font-medium text-ink">{apiKey.name}</span>
        <span className="truncate font-mono text-[12px] text-taupe">{apiKey.prefix}…</span>
        <span className="text-[12px] text-taupe">{since(apiKey.created_at, now)}</span>
        <span className={`text-[12px] ${apiKey.last_used_at === null ? "text-taupe/70" : "text-forest"}`}>
          {since(apiKey.last_used_at, now)}
        </span>
        {step === "idle" ? (
          <button
            type="button"
            onClick={() => setStep("confirm")}
            className="justify-self-end text-[12px] text-taupe transition-colors duration-300 hover:text-terracotta"
          >
            Revoke
          </button>
        ) : (
          <span aria-hidden className="w-[3.25rem]" />
        )}
      </div>
      {step !== "idle" && (
        <div className="mt-2.5 flex animate-fade flex-wrap items-center justify-end gap-3 rounded-lg bg-risk/60 px-3 py-2">
          <span className="mr-auto text-[12.5px] text-terracotta">
            {error ?? `Revoke ${apiKey.name}? Clients using it are refused at once.`}
          </span>
          <button
            type="button"
            onClick={() => setStep("idle")}
            disabled={step === "revoking"}
            className="text-[12.5px] text-taupe transition-colors duration-300 hover:text-ink disabled:opacity-40"
          >
            Cancel
          </button>
          <button type="button" onClick={revoke} disabled={step === "revoking"} className={DANGER}>
            {step === "revoking" ? "Revoking…" : "Revoke key"}
          </button>
        </div>
      )}
    </li>
  );
}

export function Keys({
  keys,
  now,
  created,
  onCreated,
  onDismissCreated,
  onRevoked,
}: {
  keys: ApiKey[];
  now: number;
  created: CreatedKey | null;
  onCreated: (key: CreatedKey) => void;
  onDismissCreated: () => void;
  onRevoked: (key: ApiKey) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await createKey(trimmed));
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="animate-rise rounded-2xl border border-line bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Label>API keys</Label>
        <span className="text-[12px] text-taupe">One per client, so Monitor can show who sent each turn.</span>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <label htmlFor="key-name" className="sr-only">
          Key name
        </label>
        <input
          id="key-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name it after the client, like openwebui"
          spellCheck={false}
          autoComplete="off"
          maxLength={64}
          className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-[13.5px] text-ink outline-none transition-[border-color,box-shadow] duration-300 ease-ios placeholder:text-taupe/60 focus:border-forest/50 focus:shadow-[0_0_0_3px_rgba(45,90,39,0.1)]"
        />
        <button type="submit" disabled={!trimmed || busy} className={PRIMARY}>
          {busy ? "Creating…" : "Create key"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 animate-fade text-[12.5px] text-terracotta">
          {error}
        </p>
      )}

      {created && (
        <div className="mt-4">
          <NewKey created={created} onDone={onDismissCreated} />
        </div>
      )}

      {keys.length === 0 ? (
        <p className="mt-5 text-[13px] text-taupe">No keys yet. Create one to connect a client.</p>
      ) : (
        <div className="mt-5">
          <div className={`${COLUMNS} pb-1.5 text-[11px] text-taupe`}>
            <span>Name</span>
            <span>Key</span>
            <span>Created</span>
            <span>Last used</span>
            <span className="w-[3.25rem]" />
          </div>
          <ul>
            {keys.map((k) => (
              <KeyRow key={k.id} apiKey={k} now={now} onRevoked={() => onRevoked(k)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
