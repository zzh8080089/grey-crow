(function (root) {
  "use strict";
  // Owns eligibility and acknowledgement only. The tour never issues a story
  // action, opens a data panel or changes the reading/input state.
  function mount({ getLocale, getContext, bridge, closeSettings }) {
    if (!root.GreyCrowGameTour?.create) return null;
    const button = document.getElementById("openGameTourButton");
    const status = document.getElementById("gameTourSettingsStatus");
    const labels = {
      "zh-CN": { review: "重看游戏界面引导", unavailable: "进入冒险后可观看界面引导", busy: "本轮结束后可观看界面引导", read: "未能读取界面引导记录，仍可手动重看。", save: "未能保存界面引导记录，下次启动可能再次显示。" },
      "en-US": { review: "Review game interface tour", unavailable: "Enter an adventure to view this tour", busy: "The tour is available after this turn", read: "Tour progress could not be read. You can still open the tour here.", save: "Tour progress could not be saved. It may appear again next time." },
      "ja-JP": { review: "ゲーム画面ガイドを見る", unavailable: "冒険に入ると画面ガイドを確認できます", busy: "このターンの終了後に確認できます", read: "ガイドの記録を読み取れませんでした。手動で開くことはできます。", save: "ガイドの記録を保存できませんでした。次回また表示される場合があります。" },
    };
    const copy = () => labels[getLocale()] || labels["zh-CN"];
    let loaded = false, dismissed = false, sessionSuppressed = false, manual = false;
    let activeBinding = null, timer = null, message = "", progressEpoch = 0, writeQueue = Promise.resolve();
    function announce(key) { message = key; status.textContent = key ? copy()[key] : ""; }
    function save(value) {
      const epoch = ++progressEpoch;
      const task = writeQueue.then(() => bridge.setTutorialDismissed(value, "game-ui"));
      writeQueue = task.catch(() => {});
      return task.then(result => {
        if (!result?.ok) throw new Error("tutorial write failed");
        if (epoch === progressEpoch) { dismissed = value; loaded = true; sessionSuppressed = value; announce(""); }
        return true;
      }).catch(() => { if (epoch === progressEpoch) announce("save"); return false; });
    }
    const view = root.GreyCrowGameTour.create({ getLocale, onDismiss: () => {
      // Skip/finish always releases the game even when disk persistence fails.
      sessionSuppressed = true; manual = false; activeBinding = null;
      void save(true);
    } });
    function schedule() {
      if (timer !== null) return;
      timer = setTimeout(() => { timer = null; sync(); }, 100);
    }
    function sync() {
      const context = getContext();
      button.textContent = copy().review;
      button.disabled = !context.inGame || !context.ready;
      button.title = !context.inGame ? copy().unavailable : !context.ready ? copy().busy : copy().review;
      status.textContent = message ? copy()[message] : "";
      const anotherDialog = Boolean(document.querySelector('dialog[open]:not(#gameTourDialog)'));
      if (view.isOpen()) {
        if (!context.inGame || !context.ready || context.binding !== activeBinding || anotherDialog || document.hidden) {
          view.close(); activeBinding = null;
        } else view.refresh();
        return;
      }
      if (!context.inGame) { manual = false; return; }
      if (!manual && (!loaded || dismissed || sessionSuppressed)) return;
      if (!context.ready || anotherDialog || document.hidden || context.drawerOpen) return;
      // Let the opening film and first response finish before introducing the UI.
      if (!context.settled) { schedule(); return; }
      activeBinding = context.binding;
      if (view.start()) manual = false;
      else activeBinding = null;
    }
    button.addEventListener("click", async () => {
      const context = getContext();
      if (!context.inGame || !context.ready) return;
      manual = true;
      if (!(await closeSettings())) { manual = false; return; }
      schedule();
    });
    const observer = new MutationObserver(schedule);
    for (const node of document.querySelectorAll("dialog, #gameView, #storyNotebookDrawer")) {
      observer.observe(node, { attributes: true, attributeFilter: ["open", "class", "aria-hidden", "hidden"] });
    }
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "data-story-notebook-theme", "data-book-phase"] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    document.addEventListener("visibilitychange", schedule);
    const epoch = progressEpoch;
    Promise.resolve().then(() => bridge.getTutorialProgress("game-ui")).then(result => {
      if (!result?.ok) throw new Error("tutorial read failed");
      if (epoch === progressEpoch) { dismissed = result.progress.dismissed; loaded = true; }
    }).catch(() => { if (epoch === progressEpoch) { sessionSuppressed = true; announce("read"); } }).finally(schedule);
    sync();
    return Object.freeze({ sync: schedule, async reset() {
      if (!(await save(false))) return false;
      sessionSuppressed = false; schedule(); return true;
    } });
  }
  root.GreyCrowGameTourLifecycle = Object.freeze({ mount });
}(globalThis));
