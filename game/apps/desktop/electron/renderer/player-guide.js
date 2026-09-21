(function (root) {
  "use strict";
  let mounted = false;
  function mount({ locale, bridge, openModelHelp, openSettings, resetGameTour } = {}) {
    const catalog = root.GreyCrowPlayerGuideContent;
    if (mounted || !catalog?.validateContent?.()) return;
    const byId = id => document.getElementById(id);
    const dialog = byId("playerGuideDialog"), menu = byId("menuView");
    const review = byId("openPlayerGuideButton"), reset = byId("resetPlayerGuideButton");
    if (!dialog || !menu || !review || !reset) return;
    mounted = true;
    const ui = Object.fromEntries(["Eyebrow", "Title", "Close", "Steps", "Lead", "Details", "DeepSeekHelp", "HelpLinks", "Status", "Skip", "Progress", "Previous", "Next", "BackToTutorial", "SettingsLink", "SettingsStatus"].map(name => [name, byId(`playerGuide${name}`)]));
    const text = () => catalog.content[locale?.()] || catalog.content["zh-CN"];
    let index = 0, tutorialIndex = 0, deepSeek = false, returnFocus = null;
    let loaded = false, dismissed = false, sessionSkipped = false, saving = false;
    let statusKey = "", dialogStatusKey = "";
    const prompt = document.createElement("aside");
    prompt.id = "playerGuidePrompt"; prompt.className = "player-guide-prompt"; prompt.hidden = true;
    const message = document.createElement("p"), promptStatus = document.createElement("p");
    promptStatus.setAttribute("role", "status"); promptStatus.className = "player-guide-notice";
    const start = document.createElement("button"), skip = document.createElement("button");
    start.id = "playerGuideStart"; skip.id = "playerGuidePromptSkip";
    for (const button of [start, skip]) { button.type = "button"; button.className = "text-button"; }
    prompt.append(message, start, skip, promptStatus); document.body.append(prompt);
    const settingsHelp = byId("playerGuideSettingsDeepSeekHelp");
    function refreshPrompt() {
      prompt.hidden = !loaded || dismissed || sessionSkipped || menu.classList.contains("hidden") || Boolean(document.querySelector("dialog[open]"));
    }
    function announce(key) {
      statusKey = key;
      ui.SettingsStatus.textContent = key ? text()[key] : "";
      promptStatus.textContent = key ? text()[key] : "";
    }
    function setSaving(value) {
      saving = value; reset.disabled = value; skip.disabled = value; ui.Skip.disabled = value;
      ui.Next.disabled = value;
    }
    async function persist(value) {
      if (saving) return false;
      setSaving(true);
      try {
        const result = await bridge?.setTutorialDismissed?.(value);
        if (!result?.ok) throw new Error("tutorial persistence unavailable");
        dismissed = result.progress.dismissed; sessionSkipped = value;
        announce(value ? "" : "resetDone");
        return true;
      } catch {
        announce("saveFailed"); dialogStatusKey = "saveFailed"; ui.Status.textContent = text().saveFailed;
        return false;
      } finally { setSaving(false); refreshPrompt(); }
    }
    function restoreFocus() {
      const fallback = byId("settingsDialog")?.open ? review : byId("newGameButton");
      const node = returnFocus?.isConnected && returnFocus.checkVisibility?.() ? returnFocus : fallback;
      node?.focus(); returnFocus = null;
    }
    function close() {
      if (dialog.open) dialog.close();
      refreshPrompt(); restoreFocus();
    }
    async function dismiss() {
      await persist(true);
      // A disk error must never trap a player inside onboarding.
      sessionSkipped = true; close(); refreshPrompt();
    }
    async function openExternal(id) {
      dialogStatusKey = ""; ui.Status.textContent = "";
      try { const result = await openModelHelp?.(id); if (!result?.ok) throw new Error("help unavailable"); }
      catch { dialogStatusKey = "linkFailed"; ui.Status.textContent = text().linkFailed; }
    }
    function render({ focusStep = false } = {}) {
      const copy = text(), steps = deepSeek ? copy.deepSeekSteps : copy.steps, step = steps[index];
      dialog.dataset.guide = deepSeek ? "deepseek" : "tutorial";
      dialog.dataset.step = step.id;
      ui.Eyebrow.textContent = deepSeek ? copy.deepSeekTitle : copy.eyebrow;
      ui.Title.textContent = step.title; ui.Lead.textContent = step.lead;
      ui.Close.setAttribute("aria-label", copy.close); ui.Steps.setAttribute("aria-label", copy.stepsLabel);
      ui.Skip.textContent = copy.skip; ui.Previous.textContent = copy.previous; ui.Previous.disabled = index === 0;
      ui.Next.textContent = index < steps.length - 1 ? copy.next : deepSeek ? copy.backToTutorial : copy.finish;
      ui.Progress.textContent = copy.progress.replace("{current}", index + 1).replace("{total}", steps.length);
      ui.Steps.replaceChildren(...steps.map((item, i) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "player-guide-step";
        button.dataset.stepIndex = String(i); button.textContent = `${i + 1}. ${item.title}`;
        if (i === index) button.setAttribute("aria-current", "step");
        button.addEventListener("click", () => { index = i; render({ focusStep: true }); });
        return button;
      }));
      const details = document.createElement("details"), summary = document.createElement("summary"), list = document.createElement("ul");
      summary.textContent = copy.details;
      for (const item of step.details) { const li = document.createElement("li"); li.textContent = item; list.append(li); }
      details.append(summary, list); ui.Details.replaceChildren(details);
      ui.DeepSeekHelp.hidden = deepSeek || step.id !== "connection"; ui.DeepSeekHelp.textContent = copy.deepSeekButton;
      ui.BackToTutorial.hidden = !deepSeek; ui.BackToTutorial.textContent = copy.backToTutorial;
      ui.HelpLinks.replaceChildren(...(step.helpLinks || []).map(link => {
        const button = document.createElement("button"); button.type = "button"; button.className = "text-button";
        button.dataset.helpId = link.id; button.textContent = link.label;
        button.addEventListener("click", () => { void openExternal(link.id); }); return button;
      }));
      const tab = step.id === "voice" && !deepSeek ? "audio" : (step.id === "connection" || step.id === "grey-crow") ? "ai" : null;
      ui.SettingsLink.hidden = !tab; ui.SettingsLink.textContent = tab === "audio" ? copy.openAudio : copy.openConnection;
      ui.SettingsLink.onclick = tab ? () => { close(); openSettings?.(tab); } : null;
      ui.Status.textContent = dialogStatusKey ? copy[dialogStatusKey] : "";
      const activeStep = ui.Steps.children[index];
      activeStep?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (focusStep) activeStep?.focus();
      byId("playerGuideBody").scrollTop = 0;
    }
    function open(opener, isDeepSeek = false) {
      returnFocus = opener || document.activeElement; deepSeek = isDeepSeek; index = 0; tutorialIndex = 0;
      dialogStatusKey = ""; render();
      if (!dialog.open) dialog.showModal();
      refreshPrompt(); ui.Close.focus();
    }
    function backToTutorial() { deepSeek = false; index = tutorialIndex; render({ focusStep: true }); }
    function refreshLabels() {
      const copy = text(); review.textContent = copy.review; reset.textContent = copy.reset;
      settingsHelp.textContent = copy.deepSeekButton; message.textContent = copy.prompt;
      prompt.setAttribute("aria-label", copy.title); start.textContent = copy.start; skip.textContent = copy.skip;
      announce(statusKey); if (dialog.open) render(); refreshPrompt();
    }
    start.addEventListener("click", () => open(start));
    skip.addEventListener("click", () => { void dismiss(); });
    review.addEventListener("click", () => open(review));
    reset.addEventListener("click", async () => {
      if (!(await persist(false))) return;
      sessionSkipped = false;
      try { if (resetGameTour && !(await resetGameTour())) announce("saveFailed"); }
      catch { announce("saveFailed"); }
      refreshPrompt();
    });
    settingsHelp.addEventListener("click", () => open(settingsHelp, true));
    ui.DeepSeekHelp.addEventListener("click", () => { tutorialIndex = index; index = 0; deepSeek = true; render({ focusStep: true }); });
    ui.BackToTutorial.addEventListener("click", backToTutorial);
    ui.Close.addEventListener("click", close);
    ui.Previous.addEventListener("click", () => { if (index > 0) { index--; render(); } });
    ui.Next.addEventListener("click", () => {
      const steps = deepSeek ? text().deepSeekSteps : text().steps;
      if (index < steps.length - 1) { index++; render(); }
      else if (deepSeek) backToTutorial(); else void dismiss();
    });
    ui.Skip.addEventListener("click", () => { void dismiss(); });
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("close", refreshPrompt);
    new MutationObserver(refreshLabels).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    const visibilityObserver = new MutationObserver(refreshPrompt);
    visibilityObserver.observe(document.body, { childList: true });
    visibilityObserver.observe(menu, { attributes: true, attributeFilter: ["class", "hidden"] });
    for (const modal of document.querySelectorAll("dialog")) visibilityObserver.observe(modal, { attributes: true, attributeFilter: ["open"] });
    refreshLabels();
    Promise.resolve().then(() => bridge?.getTutorialProgress?.()).then(result => {
      if (!result?.ok) throw new Error("tutorial progress unavailable");
      dismissed = result.progress.dismissed;
    }).catch(() => announce("readFailed")).finally(() => { loaded = true; refreshPrompt(); });
  }
  root.GreyCrowPlayerGuide = Object.freeze({ mount });
}(globalThis));
