"use strict";

(function installGreyCrowUiLocalization(globalObject) {
  const SUPPORTED_LOCALES = Object.freeze(["zh-CN", "en-US", "ja-JP"]);
  const catalogs = new Map();
  let activeLocale = "zh-CN";

  function assertSupportedLocale(locale) {
    if (!SUPPORTED_LOCALES.includes(locale)) {
      throw new TypeError(`Unsupported Grey Crow UI locale: ${String(locale)}`);
    }
    return locale;
  }

  function register(locale, messages) {
    const canonicalLocale = assertSupportedLocale(locale);
    if (!messages || typeof messages !== "object" || Array.isArray(messages)) {
      throw new TypeError(`Locale catalog must be an object: ${canonicalLocale}`);
    }
    if (catalogs.has(canonicalLocale)) {
      throw new Error(`Locale catalog already registered: ${canonicalLocale}`);
    }
    catalogs.set(canonicalLocale, Object.freeze({ ...messages }));
  }

  function has(key, locale = activeLocale) {
    return Object.prototype.hasOwnProperty.call(catalogs.get(locale) || {}, key);
  }

  function format(template, params = {}) {
    return String(template).replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name) => {
      if (!Object.prototype.hasOwnProperty.call(params, name)) {
        return `⟪${name}⟫`;
      }
      const value = params[name];
      return value === null || value === undefined ? "" : String(value);
    });
  }

  function t(key, params = {}, options = {}) {
    const locale = options.locale || activeLocale;
    assertSupportedLocale(locale);
    const catalog = catalogs.get(locale);
    if (!catalog || !Object.prototype.hasOwnProperty.call(catalog, key)) {
      return `⟦${key}⟧`;
    }
    return format(catalog[key], params);
  }

  function translateElement(element) {
    const textKey = element.dataset.i18n;
    if (textKey) {
      element.textContent = t(textKey);
    }
    const attributeBindings = [
      ["i18nAriaLabel", "aria-label"],
      ["i18nTitle", "title"],
      ["i18nPlaceholder", "placeholder"],
      ["i18nAlt", "alt"],
    ];
    for (const [datasetKey, attributeName] of attributeBindings) {
      const key = element.dataset[datasetKey];
      if (key) {
        element.setAttribute(attributeName, t(key));
      }
    }
  }

  function apply(root = globalObject.document) {
    if (!root?.querySelectorAll) return;
    const selector = [
      "[data-i18n]",
      "[data-i18n-aria-label]",
      "[data-i18n-title]",
      "[data-i18n-placeholder]",
      "[data-i18n-alt]",
    ].join(",");
    if (root.matches?.(selector)) translateElement(root);
    root.querySelectorAll(selector).forEach(translateElement);
  }

  function setLocale(locale, options = {}) {
    const canonicalLocale = assertSupportedLocale(locale);
    if (!catalogs.has(canonicalLocale)) {
      throw new Error(`Locale catalog is not registered: ${canonicalLocale}`);
    }
    const changed = activeLocale !== canonicalLocale;
    activeLocale = canonicalLocale;
    const documentObject = globalObject.document;
    if (documentObject?.documentElement) {
      documentObject.documentElement.lang = canonicalLocale;
      documentObject.documentElement.dataset.locale = canonicalLocale;
      apply(documentObject);
      if (has("app.title")) documentObject.title = t("app.title");
      if (changed && options.announce !== false && typeof globalObject.CustomEvent === "function") {
        documentObject.dispatchEvent(new globalObject.CustomEvent("grey-crow:ui-locale-changed", {
          detail: Object.freeze({ locale: canonicalLocale }),
        }));
      }
    }
    return canonicalLocale;
  }

  function getCatalog(locale) {
    return catalogs.get(assertSupportedLocale(locale)) || null;
  }

  globalObject.GreyCrowI18n = Object.freeze({
    schemaVersion: "grey-crow-ui-localization-v1",
    supportedLocales: SUPPORTED_LOCALES,
    register,
    setLocale,
    getLocale: () => activeLocale,
    getCatalog,
    has,
    t,
    apply,
  });
})(globalThis);
