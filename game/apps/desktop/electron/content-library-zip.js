"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const yauzl = require("yauzl");

const MAX_ZIP_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 2048;

async function extractContentPackZip(zipPath, destinationRoot) {
  const source = requireAbsolute(zipPath, "zipPath");
  const destination = requireAbsolute(destinationRoot, "destinationRoot");
  const sourceStat = await fsp.lstat(source).catch(() => null);
  const destinationStat = await fsp.lstat(destination).catch(() => null);
  if (!sourceStat?.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > MAX_ZIP_BYTES) {
    throw zipError("CONTENT_ZIP_INVALID", "ZIP source is missing, unsafe, or too large.");
  }
  if (!destinationStat?.isDirectory() || destinationStat.isSymbolicLink()) {
    throw zipError("CONTENT_ZIP_DESTINATION_INVALID", "ZIP destination must be a real directory.");
  }

  const zip = await openZip(source);
  const seenPaths = new Set();
  let entryCount = 0;
  let totalBytes = 0;
  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        try { zip.close(); } catch {}
        reject(normalizeZipFailure(error));
      };
      zip.on("error", fail);
      zip.on("end", () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      zip.on("entry", (entry) => {
        processEntry(entry).then(() => zip.readEntry(), fail);
      });

      async function processEntry(entry) {
        entryCount += 1;
        if (entryCount > MAX_ENTRIES) throw zipError("CONTENT_ZIP_TOO_MANY_FILES", "ZIP exceeds the entry count limit.");
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw zipError("CONTENT_ZIP_ENCRYPTED", "Encrypted ZIP entries are not supported.");
        const normalized = normalizeEntryPath(entry.fileName);
        const collisionKey = normalized.toLocaleLowerCase("en-US");
        if (seenPaths.has(collisionKey)) throw zipError("CONTENT_ZIP_DUPLICATE_PATH", "ZIP contains duplicate normalized paths.", { relative_path: normalized });
        seenPaths.add(collisionKey);
        const directory = normalized.endsWith("/");
        assertRegularZipEntry(entry, directory);
        if (directory) {
          await fsp.mkdir(resolveDestination(destination, normalized.slice(0, -1)), { recursive: true });
          return;
        }
        if (entry.uncompressedSize > MAX_ENTRY_BYTES) throw zipError("CONTENT_ZIP_ENTRY_TOO_LARGE", "ZIP entry exceeds the size limit.", { relative_path: normalized });
        totalBytes += entry.uncompressedSize;
        if (totalBytes > MAX_EXTRACTED_BYTES) throw zipError("CONTENT_ZIP_TOO_LARGE", "ZIP extracted size exceeds the limit.");
        const output = resolveDestination(destination, normalized);
        await fsp.mkdir(path.dirname(output), { recursive: true });
        const input = await openEntryStream(zip, entry);
        let actualBytes = 0;
        const counter = new Transform({
          transform(chunk, _encoding, callback) {
            actualBytes += chunk.length;
            if (actualBytes > MAX_ENTRY_BYTES || actualBytes > entry.uncompressedSize) {
              callback(zipError("CONTENT_ZIP_ENTRY_TOO_LARGE", "ZIP entry exceeded its declared size.", { relative_path: normalized }));
              return;
            }
            callback(null, chunk);
          },
        });
        await pipeline(input, counter, fs.createWriteStream(output, { flags: "wx", mode: 0o600 }));
        if (actualBytes !== entry.uncompressedSize) throw zipError("CONTENT_ZIP_SIZE_MISMATCH", "ZIP entry size did not match its declaration.", { relative_path: normalized });
      }

      zip.readEntry();
    });
  } finally {
    try { zip.close(); } catch {}
  }
  return Object.freeze({ ok: true, entries: entryCount, extractedBytes: totalBytes });
}

function openZip(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) reject(zipError("CONTENT_ZIP_INVALID", "ZIP could not be opened."));
      else resolve(zip);
    });
  });
}

function openEntryStream(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(zipError("CONTENT_ZIP_READ_FAILED", "ZIP entry could not be read."));
      else resolve(stream);
    });
  });
}

function normalizeEntryPath(value) {
  if (typeof value !== "string" || !value || value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    throw zipError("CONTENT_ZIP_PATH_INVALID", "ZIP contains an unsafe path.");
  }
  const directory = value.endsWith("/");
  const parts = value.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw zipError("CONTENT_ZIP_PATH_INVALID", "ZIP contains an unsafe path.");
  }
  return `${parts.join("/")}${directory ? "/" : ""}`;
}

function assertRegularZipEntry(entry, directory) {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const type = mode & 0o170000;
  if (type !== 0 && type !== 0o100000 && !(directory && type === 0o040000)) {
    throw zipError("CONTENT_ZIP_SPECIAL_FILE", "ZIP contains a link or special file.", { relative_path: entry.fileName });
  }
}

function resolveDestination(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw zipError("CONTENT_ZIP_PATH_INVALID", "ZIP path escaped the destination root.");
  return target;
}

function requireAbsolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw zipError("CONTENT_ZIP_PATH_INVALID", `${label} must be absolute.`);
  return path.resolve(value);
}

function zipError(code, message, meta = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  error.meta = Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, String(value).slice(0, 240)]));
  return error;
}

function normalizeZipFailure(error) {
  if (typeof error?.code === "string" && error.code.startsWith("CONTENT_ZIP_")) return error;
  if (/invalid relative path/i.test(String(error?.message || ""))) {
    return zipError("CONTENT_ZIP_PATH_INVALID", "ZIP contains an unsafe path.");
  }
  return zipError("CONTENT_ZIP_INVALID", "ZIP could not be processed.");
}

module.exports = {
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_EXTRACTED_BYTES,
  MAX_ZIP_BYTES,
  extractContentPackZip,
};
