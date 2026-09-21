"use strict";

const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

// This value is created once when the session runtime is loaded.  Unlike a PID,
// it cannot be reassigned by the operating system to an unrelated process.
const generation = randomUUID();
const processIdentity = readProcessIdentity(process.pid);

function createRecoveryVerifier({ currentGeneration = generation, currentPid = process.pid,
  readIdentity = readProcessIdentity, isAlive = processAlive } = {}) {
  const identities = new Map();
  return (row) => {
    if (row?.owner_generation === currentGeneration) return false;
    const pid = row?.owner_pid;
    if (!Number.isSafeInteger(pid) || pid < 1 || !isAlive(pid)) return true;
    if (!identities.has(pid)) identities.set(pid, readIdentity(pid));
    const observed = identities.get(pid);
    // Do not steal a task when the platform cannot prove who owns a live PID.
    if (observed === null) return false;
    if (typeof row.owner_process_identity === "string" && row.owner_process_identity) {
      // macOS lstart is only second-precise. If the record names this exact
      // process but carries another runtime generation, it cannot be this
      // runtime even when two processes started within one second.
      return row.owner_process_identity !== observed || pid === currentPid;
    }
    // Legacy rows lack a stored identity. Recover only when the platform can
    // prove that the live process began after this attempt entered running.
    return processStartedAfter(observed, row.updated_at) || pid === currentPid;
  };
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== "ESRCH"; }
}

function readProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === "linux") {
      const boot = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = stat.slice(close + 2).trim().split(/\s+/);
      const start = fields[19];
      return boot && /^\d+$/.test(start || "") ? `linux:${boot}:${start}` : null;
    }
    if (process.platform === "darwin") {
      const value = execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000,
          env: { ...process.env, LC_ALL: "C", TZ: "UTC" } }).trim();
      // macOS exposes lstart at second precision. It removes ordinary PID
      // reuse, but a same-second reuse remains deliberately unproven.
      return value ? `darwin:${value.replace(/\s+/g, " ")}` : null;
    }
    if (process.platform === "win32") {
      const script = "& { param([int]$targetPid) [Console]::Write((Get-Process -Id $targetPid -ErrorAction Stop).StartTime.ToUniversalTime().Ticks) }";
      const value = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, String(pid)],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000, windowsHide: true }).trim();
      return /^\d+$/.test(value) ? `win32:${value}` : null;
    }
  } catch {}
  return null;
}

function processStartedAfter(identity, createdAt) {
  const recorded = Date.parse(createdAt || "");
  if (!Number.isFinite(recorded) || typeof identity !== "string") return false;
  if (identity.startsWith("darwin:")) {
    const started = Date.parse(identity.slice("darwin:".length) + " UTC");
    return Number.isFinite(started) && started > recorded;
  }
  if (identity.startsWith("win32:")) {
    try {
      const ticks = BigInt(identity.slice("win32:".length));
      const unixMs = Number((ticks - 621355968000000000n) / 10000n);
      return Number.isSafeInteger(unixMs) && unixMs > recorded;
    } catch { return false; }
  }
  return false;
}

module.exports = { generation, processIdentity, createRecoveryVerifier };
