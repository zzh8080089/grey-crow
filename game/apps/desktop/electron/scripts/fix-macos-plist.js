#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const PERMISSION_KEYS = Object.freeze([
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
]);

function main() {
  const args = process.argv.slice(2);
  const appPath = args.find((arg) => !arg.startsWith("--"))
    || path.join(__dirname, "..", "dist", "mac-arm64", "Grey Crow.app");
  const shouldAdhocSign = args.includes("--adhoc-sign");
  const plistPath = path.join(appPath, "Contents", "Info.plist");
  if (!fs.existsSync(plistPath)) {
    throw new Error(`Info.plist not found: ${plistPath}`);
  }

  const info = readPlist(plistPath);
  info.NSMicrophoneUsageDescription = "将你的语音在本机转换为游戏输入文字。仅在你开始录音时使用麦克风。";
  info.NSAppTransportSecurity = {
    NSAllowsArbitraryLoads: false,
    NSAllowsLocalNetworking: true,
  };
  for (const key of PERMISSION_KEYS) {
    delete info[key];
  }
  writePlist(plistPath, info);

  process.stdout.write(`macOS Info.plist tightened: ${plistPath}\n`);
  if (shouldAdhocSign) {
    adhocSignAndVerify(appPath);
  }
}

function readPlist(plistPath) {
  const json = childProcess.execFileSync("plutil", ["-convert", "json", "-o", "-", plistPath], {
    encoding: "utf8",
  });
  return JSON.parse(json);
}

function writePlist(plistPath, value) {
  const tmpPath = `${plistPath}.json`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`);
  childProcess.execFileSync("plutil", ["-convert", "xml1", "-o", plistPath, tmpPath]);
  fs.rmSync(tmpPath, { force: true });
}

function adhocSignAndVerify(appPath) {
  if (process.platform !== "darwin") {
    throw new Error("Ad-hoc macOS signing requires macOS.");
  }
  childProcess.execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" }
  );
  childProcess.execFileSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    { stdio: "inherit" }
  );
  process.stdout.write(`macOS local test signature verified: ${appPath}\n`);
}

main();
