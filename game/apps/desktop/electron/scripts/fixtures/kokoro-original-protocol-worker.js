#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const readline = require("node:readline");

const args = parseArgs(process.argv.slice(2));
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let stopLogged = false;
logEvent("start");

process.on("SIGTERM", () => stopAndExit(0));
process.on("SIGINT", () => stopAndExit(0));
process.on("exit", () => logStop());

input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "worker/initialize") {
    if (fs.existsSync(`${args.bundleRoot}/hang-ready`)) {
      return;
    }
    send(request.id, {
      protocolVersion: 1,
      modelId: "fixture-kokoro-original",
      sampleRate: 24000,
      voices: ["zf_001", "zf_006", "zm_009", "zm_010"],
    });
    return;
  }
  if (request.method === "worker/shutdown") {
    send(request.id, { stopped: true });
    stopAndExit(0);
    return;
  }
  if (request.method !== "tts/synthesize") {
    sendError(request.id, "KOKORO_PROTOCOL_METHOD_NOT_FOUND");
    return;
  }

  const text = String(request.params?.text || "");
  if (text === "__hang__") {
    return;
  }
  if (text === "__hang_ignore_sigterm__") {
    process.removeAllListeners("SIGTERM");
    process.on("SIGTERM", () => {});
    return;
  }
  if (text === "__crash__") {
    process.exit(19);
    return;
  }
  if (text === "__invalid_json__") {
    process.stdout.write("not-json\n");
    return;
  }
  if (text === "__close_stdin__") {
    fs.writeFileSync(request.params.outputFile, createMinimalWav());
    send(request.id, { bytes: 46, sampleRate: 24000, durationMs: 1 });
    fs.closeSync(0);
    setInterval(() => {}, 1_000);
    return;
  }
  if (text === "__fragmented__") {
    fs.writeFileSync(request.params.outputFile, createMinimalWav());
    const response = `${JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { bytes: 46, sampleRate: 24000, durationMs: 1 },
    })}\n`;
    process.stdout.write(response.slice(0, 7));
    setTimeout(() => process.stdout.write(response.slice(7)), 5);
    return;
  }
  if (text === "__stderr__") {
    process.stderr.write("fixture-noise".repeat(4_000));
  }
  const outputFile = request.params?.outputFile;
  if (!outputFile || !outputFile.startsWith(args.outputRoot)) {
    sendError(request.id, "INVALID_KOKORO_OUTPUT");
    return;
  }
  fs.mkdirSync(require("node:path").dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, createMinimalWav());
  send(request.id, { bytes: fs.statSync(outputFile).size, sampleRate: 24000, durationMs: 1 });
});

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function logEvent(type) {
  if (!args.bundleRoot) {
    return;
  }
  fs.appendFileSync(
    `${args.bundleRoot}/worker-events.jsonl`,
    `${JSON.stringify({ type, pid: process.pid, at: Date.now() })}\n`
  );
}

function logStop() {
  if (!stopLogged) {
    stopLogged = true;
    logEvent("stop");
  }
}

function stopAndExit(code) {
  logStop();
  process.exit(code);
}

function sendError(id, code) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code: -32000, message: "fixture failure", data: { code } },
  })}\n`);
}

function createMinimalWav() {
  const buffer = Buffer.alloc(46);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(38, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24);
  buffer.writeUInt32LE(48000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(2, 40);
  buffer.writeInt16LE(0, 44);
  return buffer;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--output-root") {
      parsed.outputRoot = values[index + 1];
      index += 1;
    } else if (values[index] === "--bundle-root") {
      parsed.bundleRoot = values[index + 1];
      index += 1;
    }
  }
  return parsed;
}
