"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const RENDERER_ROOT = path.join(ROOT, "renderer");
const RUNTIME_PATH = path.join(RENDERER_ROOT, "localization-runtime.js");
const LOCALE_PATHS = Object.freeze({
  "zh-CN": path.join(RENDERER_ROOT, "locales", "zh-CN.js"),
  "en-US": path.join(RENDERER_ROOT, "locales", "en-US.js"),
  "ja-JP": path.join(RENDERER_ROOT, "locales", "ja-JP.js"),
});
const PRODUCT_LOCALES = Object.freeze(Object.keys(LOCALE_PATHS));
const MIGRATION_CEILINGS = Object.freeze({
  unmanagedHtmlCjkLines: 0,
  visibleAppCjkAssignmentLines: 0,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function loadRuntimeAndCatalogs() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read(RUNTIME_PATH), sandbox, { filename: RUNTIME_PATH });
  for (const locale of PRODUCT_LOCALES) {
    vm.runInContext(read(LOCALE_PATHS[locale]), sandbox, { filename: LOCALE_PATHS[locale] });
  }
  return sandbox.GreyCrowI18n;
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function placeholders(value) {
  return sorted(new Set(Array.from(String(value).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g), (match) => match[1])));
}

function collectBoundKeys(html) {
  return new Set(Array.from(
    html.matchAll(/data-i18n(?:-(?:aria-label|title|placeholder|alt))?="([^"]+)"/g),
    (match) => match[1]
  ));
}

function collectRendererKeys(source) {
  return new Set(Array.from(source.matchAll(/\bt\(\s*["']([^"']+)["']/g), (match) => match[1]));
}

function collectDeclaredCatalogKeys(source) {
  return Array.from(source.matchAll(/^\s*"([^"]+)"\s*:/gm), (match) => match[1]);
}

function pseudoLocalize(value) {
  const protectedParts = [];
  const protectedValue = String(value).replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, (part) => {
    protectedParts.push(part);
    return `\u0000${protectedParts.length - 1}\u0000`;
  });
  const accented = protectedValue.replace(/[A-Za-z]/g, (letter) => {
    const map = { a: "á", e: "ë", i: "ï", o: "ô", u: "ü", A: "Á", E: "Ë", I: "Ï", O: "Ô", U: "Ü" };
    return map[letter] || letter;
  });
  const extraLength = Math.max(8, Math.ceil(accented.length * 0.35));
  const expanded = `［!! ${accented} ${accented.slice(0, extraLength)} !!］`;
  return expanded.replace(/\u0000(\d+)\u0000/g, (_match, index) => protectedParts[Number(index)]);
}

function functionRegion(source, name) {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) return "";
  const next = source.indexOf("\nfunction ", start + name.length + 9);
  return source.slice(start, next < 0 ? source.length : next);
}

function countMigrationDebt(html, appSource) {
  const cjk = /[\u3400-\u9fff\u3040-\u30ff]/u;
  const unmanagedHtmlCjkLines = html.split(/\r?\n/).filter((line) =>
    cjk.test(line) &&
    !line.includes("data-i18n") &&
    !line.includes("data-menu-locale") &&
    !line.includes("data-initial-locale") &&
    !line.includes("data-locale-native-label")
  ).length;
  const visibleAssignment = /(?:textContent|\.title\s*=|\.placeholder\s*=|setAttribute|appendNarration|formatError|window\.confirm)/;
  const visibleAppCjkAssignmentLines = appSource.split(/\r?\n/).filter((line) =>
    cjk.test(line) && visibleAssignment.test(line)
  ).length;
  return { unmanagedHtmlCjkLines, visibleAppCjkAssignmentLines };
}

function main() {
  const i18n = loadRuntimeAndCatalogs();
  assert(i18n?.schemaVersion === "grey-crow-ui-localization-v1", "UI localization runtime schema mismatch.");
  assert(JSON.stringify(i18n.supportedLocales) === JSON.stringify(PRODUCT_LOCALES), "UI localization runtime must expose exactly zh-CN/en-US/ja-JP.");

  const catalogs = Object.fromEntries(PRODUCT_LOCALES.map((locale) => [locale, i18n.getCatalog(locale)]));
  const canonicalKeys = sorted(Object.keys(catalogs["zh-CN"] || {}));
  assert(canonicalKeys.length > 0, "zh-CN UI catalog must not be empty.");
  for (const locale of PRODUCT_LOCALES) {
    const declaredKeys = collectDeclaredCatalogKeys(read(LOCALE_PATHS[locale]));
    assert(
      new Set(declaredKeys).size === declaredKeys.length,
      `${locale} UI catalog must not declare duplicate keys.`
    );
    const catalog = catalogs[locale];
    assert(catalog && typeof catalog === "object", `Missing UI catalog: ${locale}`);
    const keys = sorted(Object.keys(catalog));
    assert(JSON.stringify(keys) === JSON.stringify(canonicalKeys), `${locale} UI catalog keys differ from zh-CN.`);
    for (const key of canonicalKeys) {
      assert(typeof catalog[key] === "string" && catalog[key].trim(), `${locale}:${key} must be a non-empty string.`);
      assert(
        JSON.stringify(placeholders(catalog[key])) === JSON.stringify(placeholders(catalogs["zh-CN"][key])),
        `${locale}:${key} placeholder set differs from zh-CN.`
      );
    }
  }

  const html = read(path.join(RENDERER_ROOT, "index.html"));
  const appSource = read(path.join(RENDERER_ROOT, "app.js"));
  const referencedKeys = new Set([...collectBoundKeys(html), ...collectRendererKeys(appSource)]);
  const unknownKeys = sorted([...referencedKeys].filter((key) => !canonicalKeys.includes(key)));
  assert(!unknownKeys.length, `Renderer references unknown UI localization keys: ${unknownKeys.join(", ")}`);

  const scriptOrder = [
    "localization-runtime.js",
    "locales/zh-CN.js",
    "locales/en-US.js",
    "locales/ja-JP.js",
    "app.js",
  ].map((name) => html.indexOf(`src="${name}"`));
  assert(scriptOrder.every((position) => position >= 0), "Renderer must load the localization runtime, all catalogs, and app.js.");
  assert(scriptOrder.every((position, index) => index === 0 || position > scriptOrder[index - 1]), "Renderer localization scripts are loaded in the wrong order.");

  const debt = countMigrationDebt(html, appSource);
  assert(
    debt.unmanagedHtmlCjkLines <= MIGRATION_CEILINGS.unmanagedHtmlCjkLines,
    `Unmanaged HTML localization debt increased: ${debt.unmanagedHtmlCjkLines} > ${MIGRATION_CEILINGS.unmanagedHtmlCjkLines}`
  );
  assert(
    debt.visibleAppCjkAssignmentLines <= MIGRATION_CEILINGS.visibleAppCjkAssignmentLines,
    `Visible Renderer localization debt increased: ${debt.visibleAppCjkAssignmentLines} > ${MIGRATION_CEILINGS.visibleAppCjkAssignmentLines}`
  );

  const textDrivenLogic = appSource.match(/textContent\s*\.(?:includes|startsWith|endsWith)\(\s*["'][^"']*[\u3400-\u9fff\u3040-\u30ff]/gu) || [];
  assert(!textDrivenLogic.length, "Renderer behavior must not branch on localized CJK textContent.");
  assert(!/runCommandTurn\(\s*["'][^"']*[\u3400-\u9fff\u3040-\u30ff]/u.test(appSource), "Quick commands must use stable command IDs instead of localized player text.");
  for (const [name, reason] of [
    ["inferSettingsTabFromMessage", "Settings tab routing must not inspect localized text."],
    ["updateOperationStatusForBusyLabel", "Busy operation routing must not inspect localized text."],
    ["getChapterReviewContent", "Chapter projection must consume structured fields instead of parsing localized story labels."],
    ["normalizeTtsDisplayText", "TTS cleanup must not strip hard-coded localized control labels."],
  ]) {
    const region = functionRegion(appSource, name);
    assert(region && !/[\u3400-\u9fff\u3040-\u30ff]/u.test(region), reason);
  }
  assert(i18n.t("missing.key", {}, { locale: "en-US" }) === "⟦missing.key⟧", "Missing UI keys must fail visibly instead of silently falling back to Chinese.");

  for (const key of canonicalKeys) {
    const source = catalogs["en-US"][key];
    const pseudo = pseudoLocalize(source);
    assert(JSON.stringify(placeholders(pseudo)) === JSON.stringify(placeholders(source)), `Pseudo-locale changed placeholders for ${key}.`);
    assert(pseudo.length > source.length, `Pseudo-locale must expand ${key}.`);
  }

  process.stdout.write(
    `ui localization checks passed (${canonicalKeys.length} aligned keys; pseudo fixture verified; migration debt html=${debt.unmanagedHtmlCjkLines}, app=${debt.visibleAppCjkAssignmentLines})\n`
  );
}

main();
