"use client";

import { Check, ChevronDown, ChevronRight, CircleAlert, Download, ExternalLink, LoaderCircle, Minus, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./updates.css";

/**
 * The Updates button beside the theme switch, and its window: what is installed, what is new on GitHub for layerling
 * and for layerling-extensions, and the progress of an update while it runs. The work is done by the updater
 * container (updater/server.mjs) through /api/updates.
 */

type Commit = { sha: string; subject: string; date: string };
type Component = {
  name: string;
  available: boolean;
  reason?: string;
  current?: string;
  currentLabel?: string | null;
  currentDate?: string;
  latest?: string;
  latestLabel?: string | null;
  behind?: number;
  commits?: Commit[];
  source?: string;
  warning?: string | null;
  pinned?: boolean;
  ref?: string;
};
type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";
type Step = { id: string; label: string; status: StepStatus; note?: string | null; startedAt?: string | null; finishedAt?: string | null };
type Run = { status: "running" | "done" | "failed"; startedAt: string; finishedAt: string | null; error: string | null; steps: Step[]; log: string[] };
type Status = {
  enabled: boolean;
  reachable?: boolean;
  checking?: boolean;
  checkError?: string | null;
  check?: { checkedAt: string; host: Component; layerling: Component } | null;
  run?: Run | null;
  error?: string;
};

const ROUTE = "/api/updates";
const PAGE_LOADED_AT = Date.now();

// ---- Formatting -------------------------------------------------------------------------------------------------

function ago(iso: string | null | undefined, now: number) {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 60 ? `${days} days ago` : new Date(iso).toLocaleDateString();
}

function duration(from: string | null | undefined, to: string | null | undefined, now: number) {
  if (!from) return "";
  const seconds = Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function webUrl(source: string | undefined) {
  if (!source) return null;
  const ssh = /^git@([^:]+):(.+)$/.exec(source);
  const url = ssh ? `https://${ssh[1]}/${ssh[2]}` : source;
  return /^https?:\/\//.test(url) ? url.replace(/\.git$/, "") : null;
}

function updatesWaiting(status: Status | null) {
  const check = status?.check;
  if (!check) return 0;
  return [check.host, check.layerling].reduce((sum, part) => sum + (part.available ? part.behind ?? 0 : 0), 0);
}

// ---- Talking to /api/updates --------------------------------------------------------------------------------------

function useUpdates(open: boolean) {
  const [status, setStatus] = useState<Status | null>(null);
  // layerling itself is down while it restarts: the window keeps showing the run and waits for it.
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(ROUTE, { cache: "no-store" });
      const body = (await response.json()) as Status;
      if (body.enabled && body.reachable === false) {
        setUnreachable(true);
        // Still show the button, so a stopped updater is visible rather than a missing button.
        setStatus((current) => current ?? { enabled: true, reachable: false });
        return;
      }
      setUnreachable(false);
      setStatus(body);
    } catch {
      setUnreachable(true);
    }
  }, []);

  const post = useCallback(async (action: "check" | "run") => {
    setBusy(true);
    try {
      const response = await fetch(ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = (await response.json().catch(() => ({}))) as Status;
      if (body.check !== undefined || body.run !== undefined) setStatus(body);
      if (!response.ok && body.error) setStatus((current) => (current ? { ...current, error: body.error } : current));
    } finally {
      setBusy(false);
      void load();
    }
  }, [load]);

  const running = status?.run?.status === "running";
  const fast = open || running || status?.checking || unreachable;

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(), fast ? 1500 : 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [fast, load]);

  return { status, unreachable, busy, check: () => post("check"), run: () => post("run") };
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** Finished since this page was loaded, and it restarted layerling: this page is the old version. */
function finishedSinceLoad(run: Run | null | undefined) {
  if (run?.status !== "done" || !run.finishedAt) return false;
  const restarted = run.steps.some((step) => step.id === "restart" && step.status === "done");
  return restarted && Date.parse(run.finishedAt) > PAGE_LOADED_AT;
}

// ---- The button ---------------------------------------------------------------------------------------------------

export function UpdatesButton() {
  const [open, setOpen] = useState(false);
  const updates = useUpdates(open);
  const { status, unreachable } = updates;
  if (!status?.enabled) return null;

  const running = status.run?.status === "running" || (unreachable && Boolean(status.run));
  const reload = finishedSinceLoad(status.run);
  const waiting = updatesWaiting(status);

  return (
    <div className="theme-switch updates-switch">
      <button
        type="button"
        className={`theme-switch-button updates-button${open ? " active" : ""}${waiting || reload ? " has-updates" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={status.reachable === false && !status.check ? "The updater isn't running" : running ? "An update is running" : reload ? "Updated: reload to use the new version" : waiting ? `${waiting} updates available` : "Check for updates"}
        onClick={() => (reload && !open ? window.location.reload() : setOpen(true))}
      >
        {running ? <LoaderCircle size={14} className="updates-spin" aria-hidden="true" /> : <RefreshCw size={14} className="theme-switch-icon" aria-hidden="true" />}
        <span className="theme-switch-label">{running ? "Updating…" : reload ? "Reload" : "Updates"}</span>
        {!running && !reload && waiting ? <span className="updates-badge">{waiting > 99 ? "99+" : waiting}</span> : null}
      </button>
      {open ? createPortal(<UpdatesDialog updates={updates} onClose={() => setOpen(false)} />, document.body) : null}
    </div>
  );
}

// ---- The window ---------------------------------------------------------------------------------------------------

function UpdatesDialog({ updates, onClose }: { updates: ReturnType<typeof useUpdates>; onClose: () => void }) {
  const { status, unreachable, busy } = updates;
  const run = status?.run ?? null;
  const running = run?.status === "running" || (unreachable && run !== null && run.status !== "failed");
  const done = finishedSinceLoad(run) && !unreachable;
  const now = useNow(true);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="updates-overlay" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="updates-dialog" role="dialog" aria-modal="true" aria-labelledby="updates-title">
        <header className="updates-header">
          <div>
            <h2 id="updates-title">{running ? "Updating" : done ? "Update finished" : "Updates"}</h2>
            <p>{unreachable && running ? "Almost done: layerling is restarting." : running ? "layerling keeps working while the new version builds." : "layerling and its extension host, from GitHub."}</p>
          </div>
          <button ref={closeRef} type="button" className="updates-icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {running && run ? (
          <RunningView run={run} restarting={unreachable} now={now} />
        ) : done && run ? (
          <DoneView run={run} check={status?.check ?? null} now={now} />
        ) : (
          <OverviewView updates={updates} now={now} />
        )}

        {!running && !done ? (
          <footer className="updates-footer">
            <span className="updates-checked">
              {status?.checking ? (
                <><LoaderCircle size={13} className="updates-spin" aria-hidden="true" /> Checking GitHub…</>
              ) : status?.check ? (
                `Checked ${ago(status.check.checkedAt, now)}`
              ) : null}
            </span>
            <button type="button" className="updates-secondary" disabled={busy || Boolean(status?.checking)} onClick={updates.check}>
              Check again
            </button>
            <button
              type="button"
              className="updates-primary"
              disabled={busy || Boolean(status?.checking) || !status?.check}
              onClick={updates.run}
              title={updatesWaiting(status) ? undefined : "Rebuilds the current version"}
            >
              <Download size={15} aria-hidden="true" />
              {updatesWaiting(status) ? "Update now" : "Rebuild"}
            </button>
          </footer>
        ) : null}
        {running ? <p className="updates-footnote">You can close this window: the update carries on, and the button shows when it's done.</p> : null}
      </section>
    </div>
  );
}

function OverviewView({ updates, now }: { updates: ReturnType<typeof useUpdates>; now: number }) {
  const { status, unreachable } = updates;
  const run = status?.run;
  if (unreachable && !status?.check) {
    return (
      <div className="updates-body">
        <p className="updates-notice updates-notice-error">
          <CircleAlert size={16} aria-hidden="true" />
          The updater isn't running, so updates can't be checked from here.
        </p>
        <p className="updates-note">
          See why with <code>docker compose -f docker/compose.yml logs updater</code>, or run <code>scripts/update.sh</code> from a
          terminal, which also starts it.
        </p>
      </div>
    );
  }
  return (
    <div className="updates-body">
      {run?.status === "failed" ? <FailedPanel run={run} /> : null}
      {status?.error ? <p className="updates-notice updates-notice-error"><CircleAlert size={16} aria-hidden="true" /> {status.error}</p> : null}
      {status?.checkError ? <p className="updates-notice updates-notice-error"><CircleAlert size={16} aria-hidden="true" /> Couldn't check GitHub: {status.checkError}</p> : null}
      {status?.check ? (
        <>
          <ComponentCard part={status.check.layerling} title="layerling" subtitle="The 3D editor" now={now} />
          <ComponentCard part={status.check.host} title="layerling-extensions" subtitle="The extension host and the updater" now={now} />
        </>
      ) : (
        <div className="updates-empty">
          <LoaderCircle size={22} className="updates-spin" aria-hidden="true" />
          <span>Looking for updates…</span>
        </div>
      )}
    </div>
  );
}

function ComponentCard({ part, title, subtitle, now }: { part: Component; title: string; subtitle: string; now: number }) {
  const [open, setOpen] = useState(false);
  const behind = part.available ? part.behind ?? 0 : 0;
  const web = webUrl(part.source);
  const compare = web && part.current && part.latest && behind ? `${web}/compare/${part.current}...${part.latest}` : null;
  const pill = !part.available
    ? { text: "Can't update", tone: "muted" }
    : behind
      ? { text: `${behind} new change${behind === 1 ? "" : "s"}`, tone: "new" }
      : { text: part.pinned ? `Pinned to ${part.ref}` : "Up to date", tone: "ok" };

  return (
    <article className={`updates-card${behind ? " has-updates" : ""}`}>
      <div className="updates-card-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span className={`updates-pill updates-pill-${pill.tone}`}>
          {pill.tone === "ok" ? <Check size={13} aria-hidden="true" /> : null}
          {pill.text}
        </span>
      </div>

      {part.current ? (
        <div className="updates-versions">
          <Version label="Installed" name={part.currentLabel} sha={part.current} date={ago(part.currentDate, now)} />
          {behind ? (
            <>
              <span className="updates-arrow" aria-hidden="true">→</span>
              <Version label="Available" name={part.latestLabel} sha={part.latest} highlight />
            </>
          ) : null}
        </div>
      ) : null}

      {part.reason ? <p className="updates-note">{part.reason}</p> : null}
      {part.warning ? <p className="updates-note updates-note-warn"><CircleAlert size={14} aria-hidden="true" /> {part.warning}</p> : null}

      {part.commits?.length ? (
        <div className="updates-changes">
          <button type="button" className="updates-changes-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
            What's new
          </button>
          {open ? (
            <ul>
              {part.commits.map((commit) => (
                <li key={commit.sha}>
                  <span className="updates-commit-subject">{commit.subject}</span>
                  <span className="updates-commit-date">{ago(commit.date, now)}</span>
                </li>
              ))}
              {behind > part.commits.length ? <li className="updates-more">and {behind - part.commits.length} more</li> : null}
            </ul>
          ) : null}
          {open && compare ? (
            <a className="updates-link" href={compare} target="_blank" rel="noreferrer">
              See every change on GitHub <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function Version({ label, name: given, sha, date, highlight = false }: { label: string; name?: string | null; sha?: string; date?: string; highlight?: boolean }) {
  // Without tags git describes a commit by its id: show it once.
  const name = given && given !== sha ? given : null;
  return (
    <div className={`updates-version${highlight ? " highlight" : ""}`}>
      <span className="updates-version-label">{label}</span>
      <strong>{name ?? sha}</strong>
      <span className="updates-version-meta">{name ? sha : ""}{date ? `${name ? " · " : ""}${date}` : ""}</span>
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "running") return <LoaderCircle size={18} className="updates-spin" aria-hidden="true" />;
  if (status === "done") return <Check size={18} aria-hidden="true" />;
  if (status === "failed") return <X size={18} aria-hidden="true" />;
  if (status === "skipped") return <Minus size={18} aria-hidden="true" />;
  return <span className="updates-step-dot" aria-hidden="true" />;
}

function Steps({ run, restarting, now }: { run: Run; restarting: boolean; now: number }) {
  return (
    <ol className="updates-steps">
      {run.steps.map((step) => {
        // While layerling restarts this page can't hear from the updater: everything before the restart is done.
        const before = run.steps.findIndex((entry) => entry.id === "restart") > run.steps.indexOf(step);
        const status: StepStatus = !restarting ? step.status
          : step.id === "restart" ? "running"
            : before && (step.status === "running" || step.status === "pending") ? "done"
              : step.status;
        return (
          <li key={step.id} className={`updates-step updates-step-${status}`}>
            <span className="updates-step-icon"><StepIcon status={status} /></span>
            <span className="updates-step-label">
              {step.label}
              {step.note ? <small>{step.note}</small> : null}
            </span>
            <span className="updates-step-time">{step.status === "running" && status === "running" || step.finishedAt ? duration(step.startedAt, step.finishedAt, now) : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

function LogView({ lines, startOpen = false }: { lines: string[]; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const boxRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines.length, open]);
  return (
    <div className="updates-log">
      <button type="button" className="updates-changes-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        Details
      </button>
      {open ? <pre ref={boxRef}>{lines.slice(-200).join("\n") || "Waiting for output…"}</pre> : null}
    </div>
  );
}

function RunningView({ run, restarting, now }: { run: Run; restarting: boolean; now: number }) {
  const current = run.steps.find((step) => step.status === "running");
  const doneCount = restarting
    ? run.steps.findIndex((step) => step.id === "restart")
    : run.steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  return (
    <div className="updates-body">
      <div className="updates-progress-head">
        <span>{restarting ? "Restarting layerling…" : current ? `${current.label}…` : "Starting…"}</span>
        <span className="updates-elapsed">{duration(run.startedAt, null, now)}</span>
      </div>
      <div className="updates-progress" role="progressbar" aria-valuemin={0} aria-valuemax={run.steps.length} aria-valuenow={doneCount}>
        <div className="updates-progress-fill" style={{ width: `${(doneCount / run.steps.length) * 100}%` }} />
        <div className="updates-progress-shimmer" />
      </div>
      <Steps run={run} restarting={restarting} now={now} />
      {restarting ? (
        <p className="updates-notice"><LoaderCircle size={16} className="updates-spin" aria-hidden="true" /> layerling is restarting. This page notices when it's back.</p>
      ) : null}
      <LogView lines={run.log} />
    </div>
  );
}

function DoneView({ run, check, now }: { run: Run; check: Status["check"] | null; now: number }) {
  const [left, setLeft] = useState(8);
  useEffect(() => {
    const timer = window.setInterval(() => setLeft((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left <= 0) window.location.reload();
  }, [left]);
  const version = check?.layerling.currentLabel;
  return (
    <div className="updates-body">
      <div className="updates-success">
        <span className="updates-success-icon"><Check size={26} aria-hidden="true" /></span>
        <div>
          <strong>layerling {version ?? ""} is ready</strong>
          <p>Updated in {duration(run.startedAt, run.finishedAt, now)}. Reloading in {Math.max(0, left)} s to use it.</p>
        </div>
      </div>
      <Steps run={run} restarting={false} now={now} />
      <div className="updates-actions">
        <button type="button" className="updates-primary" onClick={() => window.location.reload()}>Reload now</button>
      </div>
    </div>
  );
}

function FailedPanel({ run }: { run: Run }) {
  const failedStep = run.steps.find((step) => step.status === "failed");
  return (
    <div className="updates-failed">
      <div className="updates-failed-head">
        <CircleAlert size={20} aria-hidden="true" />
        <div>
          <strong>The last update stopped{failedStep ? ` at "${failedStep.label}"` : ""}</strong>
          <p>{run.error}</p>
          <p className="updates-note">layerling is still running the version it had before. Fix the cause and try again, or run scripts/update.sh in a terminal to see everything.</p>
        </div>
      </div>
      <LogView lines={run.log} startOpen />
    </div>
  );
}
