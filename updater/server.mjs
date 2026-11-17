// The updater behind layerling's Updates button. No dependencies.
//
//   GET  /status   what is installed, what is available, and the progress of an update
//   POST /check    look on GitHub again
//   POST /run      run scripts/update.sh --ui
//
// Only layerling's server talks to it, inside the compose network, with the token from docker/.env.

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const ROOT = process.env.LAYERLING_HOST_ROOT;
const CORE = path.join(ROOT, "core");
const TOKEN = process.env.LAYERLING_UPDATER_TOKEN ?? "";
const PORT = Number(process.env.PORT ?? 8787);
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const LOG_LINES = 400;
const COMMITS = 30;

// git must never wait for a password nobody can type. A token in docker/.env (GITHUB_TOKEN) lets it read a private
// repo; set through the environment, it also reaches the git commands of scripts/update.sh.
process.env.GIT_TERMINAL_PROMPT = "0";
if (process.env.GITHUB_TOKEN) {
  const basic = Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString("base64");
  process.env.GIT_CONFIG_COUNT = "1";
  process.env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
  process.env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
}

/** What went wrong, in words someone can act on. */
function explain(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/could not read Username|Authentication failed|Repository not found|terminal prompts disabled|403/i.test(message)) {
    return "GitHub wants a login for this repo: it's private, or doesn't exist there yet. Make it public, or add GITHUB_TOKEN=<a read-only token> to docker/.env and restart the updater.";
  }
  if (/Could not resolve host|unable to access|timed out|Network is unreachable/i.test(message)) {
    return "Couldn't reach GitHub. Check this computer's internet connection.";
  }
  return message;
}

const STEPS = [
  { id: "host", label: "Update layerling-extensions" },
  { id: "fetch", label: "Download layerling" },
  { id: "apply", label: "Add the extension host" },
  { id: "build", label: "Build the new version" },
  { id: "restart", label: "Restart layerling" },
];

const state = {
  checking: false,
  check: null,
  checkError: null,
  run: null,
};

// ---- git --------------------------------------------------------------------------------------------------------

function git(cwd, ...args) {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

async function commitsBetween(cwd, from, to) {
  const out = await git(cwd, "log", "--no-merges", `-n${COMMITS}`, "--format=%h%x1f%s%x1f%cI", `${from}..${to}`);
  return out ? out.split("\n").map((line) => {
    const [sha, subject, date] = line.split("\x1f");
    return { sha, subject, date };
  }) : [];
}

async function versionAt(cwd, ref) {
  try {
    return JSON.parse(await git(cwd, "show", `${ref}:package.json`)).version ?? null;
  } catch {
    return null;
  }
}

async function checkHost() {
  try {
    await git(ROOT, "rev-parse", "--is-inside-work-tree");
  } catch {
    return { name: "layerling-extensions", available: false, reason: "Not a git clone: download the latest from GitHub, or clone it, to get updates." };
  }
  const current = await git(ROOT, "rev-parse", "--short", "HEAD");
  const currentLabel = await git(ROOT, "describe", "--tags", "--always");
  const currentDate = await git(ROOT, "log", "-1", "--format=%cI");
  let upstream;
  try {
    upstream = await git(ROOT, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
  } catch {
    return { name: "layerling-extensions", available: false, current, currentLabel, currentDate, reason: "This branch has no upstream to update from." };
  }
  await git(ROOT, "fetch", "--quiet", "--tags", upstream.split("/")[0]);
  const behind = Number(await git(ROOT, "rev-list", "--count", `HEAD..${upstream}`));
  const dirty = (await git(ROOT, "status", "--porcelain", "--untracked-files=no")) !== "";
  return {
    name: "layerling-extensions",
    available: true,
    current,
    currentLabel,
    currentDate,
    latest: await git(ROOT, "rev-parse", "--short", upstream),
    latestLabel: await git(ROOT, "describe", "--tags", "--always", upstream),
    behind,
    commits: behind ? await commitsBetween(ROOT, "HEAD", upstream) : [],
    source: (await git(ROOT, "remote", "get-url", upstream.split("/")[0]).catch(() => "")).replace(/\.git$/, ""),
    warning: dirty ? "You have changes to files of this repo; the update stops rather than overwrite them." : null,
  };
}

async function checkLayerling() {
  if (!existsSync(path.join(CORE, ".git"))) {
    return { name: "layerling", available: false, reason: "Not installed yet: run scripts/update.sh from a terminal." };
  }
  const ref = process.env.LAYERLING_REF || "main";
  await git(CORE, "fetch", "--quiet", "--tags", "--force", "origin");
  let target = `origin/${ref}`;
  try {
    await git(CORE, "rev-parse", "-q", "--verify", target);
  } catch {
    target = ref;
  }
  const behind = Number(await git(CORE, "rev-list", "--count", `HEAD..${target}`));
  let currentVersion = null;
  try {
    currentVersion = JSON.parse(await readFile(path.join(CORE, "package.json"), "utf8")).version;
  } catch {
    // Shown as the commit alone.
  }
  return {
    name: "layerling",
    available: true,
    ref,
    pinned: ref !== "main",
    current: await git(CORE, "rev-parse", "--short", "HEAD"),
    currentLabel: currentVersion ? `v${currentVersion}` : null,
    currentDate: await git(CORE, "log", "-1", "--format=%cI", "HEAD"),
    latest: await git(CORE, "rev-parse", "--short", target),
    latestLabel: (await versionAt(CORE, target)) ? `v${await versionAt(CORE, target)}` : null,
    behind,
    commits: behind ? await commitsBetween(CORE, "HEAD", target) : [],
    source: "https://github.com/henmedia/layerling",
  };
}

async function check() {
  if (state.checking || state.run?.status === "running") return;
  state.checking = true;
  state.checkError = null;
  try {
    // Each on its own: a repo that can't be reached must not hide what the other has.
    const [host, layerling] = await Promise.allSettled([checkHost(), checkLayerling()]);
    const settled = (result, name) => (result.status === "fulfilled" ? result.value : { name, available: false, reason: explain(result.reason) });
    state.check = { checkedAt: new Date().toISOString(), host: settled(host, "layerling-extensions"), layerling: settled(layerling, "layerling") };
  } catch (error) {
    state.checkError = explain(error);
  } finally {
    state.checking = false;
  }
}

// ---- Running an update ----------------------------------------------------------------------------------------

function now() {
  return new Date().toISOString();
}

function startRun() {
  const run = {
    status: "running",
    startedAt: now(),
    finishedAt: null,
    error: null,
    steps: STEPS.map((step) => ({ ...step, status: "pending", note: null, startedAt: null, finishedAt: null })),
    log: [],
    selfUpdate: false,
  };
  state.run = run;

  const stepById = (id) => run.steps.find((step) => step.id === id);
  const finishRunning = (status) => {
    for (const step of run.steps) {
      if (step.status === "running") {
        step.status = status;
        step.finishedAt = now();
      }
    }
  };
  const startStep = (id) => {
    finishRunning("done");
    const step = stepById(id);
    if (step) {
      step.status = "running";
      step.startedAt = now();
    }
  };

  const onLine = (raw) => {
    // Docker's progress rewrites lines with \r; colour codes mean nothing in the window.
    const line = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trimEnd();
    if (!line) return;
    if (line.startsWith("::step ")) return startStep(line.slice(7).trim());
    if (line.startsWith("::skip ")) {
      const [, id, ...note] = line.split(" ");
      const step = stepById(id);
      if (step) Object.assign(step, { status: "skipped", note: note.join(" "), finishedAt: now() });
      return;
    }
    if (line === "::self-update") {
      run.selfUpdate = true;
      return;
    }
    if (line === "::done") return;
    run.log.push(line);
    if (run.log.length > LOG_LINES) run.log.splice(0, run.log.length - LOG_LINES);
  };

  const child = spawn("bash", [path.join(ROOT, "scripts", "update.sh"), "--ui"], {
    cwd: ROOT,
    env: { ...process.env, BUILDKIT_PROGRESS: "plain", COMPOSE_ANSI: "never", NO_COLOR: "1" },
  });
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      const parts = buffer.split(/\r?\n|\r/);
      buffer = parts.pop() ?? "";
      parts.forEach(onLine);
    });
    stream.on("end", () => buffer && onLine(buffer));
  }
  // "exit", not "close": a process the script started may keep its output open long after it has finished.
  child.on("exit", (code) => {
    run.finishedAt = now();
    if (code === 0) {
      finishRunning("done");
      // Steps the script never reached (--no-build) count as skipped.
      for (const step of run.steps) if (step.status === "pending") step.status = "skipped";
      run.status = "done";
      state.check = null;
      void check();
      if (run.selfUpdate) rebuildSelf();
    } else {
      finishRunning("failed");
      run.status = "failed";
      run.error = [...run.log].reverse().find((line) => /error|fatal|failed/i.test(line)) ?? `The update stopped (exit code ${code}).`;
    }
  });
  child.on("error", (error) => {
    run.status = "failed";
    run.error = error.message;
    run.finishedAt = now();
  });
}

/**
 * The update changed the updater itself. It can't replace its own container from inside it (stopping it would stop
 * the command), so a short-lived container does it.
 */
function rebuildSelf() {
  setTimeout(() => {
    const compose = path.join(ROOT, "docker", "compose.yml");
    spawn("docker", [
      "run", "--rm", "-d",
      "-v", "/var/run/docker.sock:/var/run/docker.sock",
      "-v", `${ROOT}:${ROOT}`,
      "-w", ROOT,
      "layerling-extensions-updater:latest",
      "docker", "compose", "-f", compose, "up", "-d", "--build", "--no-deps", "updater",
    ], { detached: true, stdio: "ignore" }).unref();
  }, 5000);
}

// ---- HTTP -------------------------------------------------------------------------------------------------------

function publicState() {
  const stale = !state.check || Date.now() - Date.parse(state.check.checkedAt) > CHECK_EVERY_MS;
  if (stale && !state.checking && state.run?.status !== "running" && !state.checkError) void check();
  return {
    checking: state.checking,
    checkError: state.checkError,
    check: state.check,
    run: state.run,
    steps: STEPS,
  };
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  if (TOKEN && request.headers.authorization !== `Bearer ${TOKEN}`) return send(response, 401, { error: "Wrong token" });
  const url = new URL(request.url ?? "/", "http://updater");
  if (request.method === "GET" && url.pathname === "/status") return send(response, 200, publicState());
  if (request.method === "POST" && url.pathname === "/check") {
    if (state.run?.status === "running") return send(response, 409, { error: "An update is running" });
    state.checkError = null;
    void check();
    return send(response, 202, publicState());
  }
  if (request.method === "POST" && url.pathname === "/run") {
    if (state.run?.status === "running") return send(response, 409, { error: "An update is already running" });
    if (state.checking) return send(response, 409, { error: "Still checking for updates, try again in a moment" });
    startRun();
    return send(response, 202, publicState());
  }
  return send(response, 404, { error: "Not found" });
});

if (!ROOT) {
  console.error("LAYERLING_HOST_ROOT is not set: run scripts/update.sh once from a terminal.");
  process.exit(1);
}
server.listen(PORT, () => {
  console.log(`layerling updater on :${PORT} for ${ROOT}`);
  void check();
});
