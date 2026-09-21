#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const LAUNCH_MS = 5000;

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});

async function main() {
  const packagedWindows = process.argv.includes("--packaged-win");
  if (packagedWindows && process.platform !== "win32") {
    throw new Error("packaged Windows startup smoke must run on Windows.");
  }
  const executable = packagedWindows
    ? path.join(root, "dist", "win-unpacked", "Grey Crow.exe")
    : require("electron");
  const label = packagedWindows ? "packaged Windows" : "desktop dev";
  if (!fs.existsSync(executable)) {
    throw new Error(`${label} startup executable is missing: ${executable}`);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-dev-startup-"));
  const electronUserData = path.join(tmp, "electron-user-data");
  fs.mkdirSync(electronUserData, { recursive: true });
  const launchArgs = packagedWindows
    ? ["--disable-gpu", `--user-data-dir=${electronUserData}`]
    : ["--disable-gpu", `--user-data-dir=${electronUserData}`, root];
  const proc = childProcess.spawn(executable, launchArgs, {
    cwd: root,
    env: {
      ...process.env,
      GREY_CROW_DATA_ROOT: path.join(tmp, "data"),
      GREY_CROW_PROVIDER_CHECK_ROOT: path.join(tmp, "provider-check"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  let exited = false;
  let exitCode = null;
  proc.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  proc.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  await delay(LAUNCH_MS);
  const inspectedPids = proc.pid ? collectProcessTreePids(proc.pid) : [];
  const listeningTcp = inspectedPids.length ? detectListeningTcp(inspectedPids) : "";
  const exitedBeforeStop = exited;
  const startupStdout = stdout;
  const startupStderr = stderr;
  await terminateProcessTree(proc, inspectedPids);
  fs.rmSync(tmp, { recursive: true, force: true });

  assert(!exitedBeforeStop, `${label} startup exited early with code ${exitCode}.`);
  assert(!startupStdout.trim(), `${label} startup wrote unexpected stdout: ${startupStdout.trim()}`);
  assert(!startupStderr.trim(), `${label} startup wrote unexpected stderr: ${startupStderr.trim()}`);
  assert(!listeningTcp, `${label} startup opened a listening TCP socket:\n${listeningTcp}`);
  process.stdout.write(`${label} startup smoke checks passed\n`);
}

async function terminateProcessTree(proc, pids) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === "win32") {
    try {
      childProcess.execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      proc.kill("SIGTERM");
    }
  } else {
    signalPids(pids, "SIGTERM");
    proc.kill("SIGTERM");
  }
  if (!await waitForExit(proc, 2000)) {
    if (process.platform !== "win32") signalPids(pids, "SIGKILL");
    proc.kill("SIGKILL");
    await waitForExit(proc, 1000);
  }
  proc.stdout.destroy();
  proc.stderr.destroy();
}

function signalPids(pids, signal) {
  for (const pid of [...pids].reverse()) {
    try { process.kill(Number(pid), signal); } catch {}
  }
}

function waitForExit(proc, timeoutMs) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    proc.once("exit", onExit);
  });
}

function detectListeningTcp(pids) {
  if (process.platform === "win32") {
    return detectWindowsListeningTcp(pids);
  }
  return detectUnixListeningTcp(pids);
}

function detectUnixListeningTcp(pids) {
  try {
    return childProcess.execFileSync("lsof", ["-Pan", "-p", pids.join(","), "-iTCP", "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (_error) {
    return "";
  }
}

function detectWindowsListeningTcp(pids) {
  const pidSet = new Set(pids.map(String));
  try {
    const output = childProcess.execFileSync("netstat", ["-ano", "-p", "tcp"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/)
      .filter((line) => {
        const parts = line.trim().split(/\s+/);
        return /\bLISTENING\b/i.test(line) && pidSet.has(parts[parts.length - 1]);
      })
      .join("\n")
      .trim();
  } catch (_error) {
    return "";
  }
}

function collectProcessTreePids(rootPid) {
  const ppidPairs = process.platform === "win32" ? readWindowsProcessPairs() : readUnixProcessPairs();
  if (!ppidPairs.length) {
    return [String(rootPid)];
  }
  const childrenByParent = new Map();
  for (const pair of ppidPairs) {
    if (!childrenByParent.has(pair.ppid)) {
      childrenByParent.set(pair.ppid, []);
    }
    childrenByParent.get(pair.ppid).push(pair.pid);
  }

  const out = new Set();
  const queue = [String(rootPid)];
  while (queue.length) {
    const pid = queue.shift();
    if (out.has(pid)) {
      continue;
    }
    out.add(pid);
    for (const childPid of childrenByParent.get(pid) || []) {
      queue.push(childPid);
    }
  }
  return [...out];
}

function readUnixProcessPairs() {
  try {
    return childProcess
      .execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]))
      .map(([pid, ppid]) => ({ pid, ppid }));
  } catch (_error) {
    return [];
  }
}

function readWindowsProcessPairs() {
  try {
    return childProcess
      .execFileSync("wmic", ["process", "get", "ProcessId,ParentProcessId", "/format:csv"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .split(/\r?\n/)
      .map((line) => line.trim().split(","))
      .filter((parts) => parts.length >= 3 && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2]))
      .map((parts) => ({ ppid: parts[1], pid: parts[2] }));
  } catch (_error) {
    return [];
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
