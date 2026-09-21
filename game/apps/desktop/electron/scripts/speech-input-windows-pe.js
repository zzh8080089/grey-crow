"use strict";

// Inspect the actual PE import tables, including delay imports. This is a
// dependency/architecture check, not proof that Windows executed the binary.
const fs = require("node:fs");
const path = require("node:path");
function imports(file) {
  const b = fs.readFileSync(file);
  const pe = b.readUInt32LE(0x3c);
  if (b.toString("ascii", 0, 2) !== "MZ" || b.toString("ascii", pe, pe + 4) !== "PE\0\0"
    || b.readUInt16LE(pe + 4) !== 0x8664 || b.readUInt16LE(pe + 24) !== 0x20b)
    throw new Error(`Not a Windows x64 PE: ${path.basename(file)}`);
  const sectionStart = pe + 24 + b.readUInt16LE(pe + 20);
  const sections = Array.from({ length: b.readUInt16LE(pe + 6) }, (_, i) => {
    const p = sectionStart + 40 * i;
    return { rva: b.readUInt32LE(p + 12), bytes: Math.max(b.readUInt32LE(p + 8), b.readUInt32LE(p + 16)), at: b.readUInt32LE(p + 20) };
  });
  const offset = rva => {
    const section = sections.find(s => rva >= s.rva && rva < s.rva + s.bytes);
    if (!section) throw new Error("Invalid PE directory address");
    return section.at + rva - section.rva;
  };
  const names = new Set();
  for (const [index, stride, nameOffset] of [[1, 20, 12], [13, 32, 4]]) {
    const rva = b.readUInt32LE(pe + 24 + 112 + 8 * index);
    if (!rva) continue;
    for (let p = offset(rva); ; p += stride) {
      const nameRva = b.readUInt32LE(p + nameOffset);
      if (!nameRva) break;
      if (index === 13 && b.readUInt32LE(p) !== 1) throw new Error("Unsupported PE delay import addressing");
      const start = offset(nameRva), end = b.indexOf(0, start);
      if (end < start || end - start > 256) throw new Error("Invalid PE import name");
      names.add(b.toString("ascii", start, end).toLowerCase());
    }
  }
  return [...names].sort();
}
function verifyWindowsSpeechBinaries(directory) {
  const required = ["speech-input-cli.exe", "sherpa-onnx-c-api.dll", "onnxruntime.dll", "onnxruntime_providers_shared.dll"];
  const system = /^(?:kernel32|advapi32|dbghelp|setupapi|dxgi|ucrtbase|ntdll|msvcrt)\.dll$|^api-ms-win-(?:core|crt)-[a-z0-9-]+\.dll$/;
  return required.map(name => {
    const dependencies = imports(path.join(directory, name));
    for (const dependency of dependencies) {
      if (!system.test(dependency) && !required.includes(dependency)) throw new Error(`Missing/unreviewed Windows dependency: ${name} -> ${dependency}`);
    }
    return { file: name, imports: dependencies };
  });
}
module.exports = { imports, verifyWindowsSpeechBinaries };
