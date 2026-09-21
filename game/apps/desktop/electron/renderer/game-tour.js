"use strict";

/* A small, self-contained tour. The app owns when it is loaded and started. */
(function installGameTour(root) {
  const COPY = {
    "zh-CN": {
      aria: "游戏界面引导", skip: "跳过", previous: "上一步", next: "下一步", finish: "完成", progress: "第 {current} / {total} 步",
      steps: [
        ["故事在这里展开", "这里显示你的行动与灰鸦的回应。可以向上阅读已发生的故事。"],
        ["当前处境", "这里显示当前剧本、地点、身体状况、回合和故事内时间；内容会随当前冒险而变化。"],
        ["主持状态", "这里显示主持人此刻是否正在准备、处理中或需要留意。"],
        ["墨滴与 LIVE", "墨滴表示本轮给灰鸦的参考信息占用了多少空间，不是生命值或余额；LIVE 表示当前连接状态。"],
        ["当前状态", "查看当前地点、身体状况、回合和游戏日；查看不会推进故事。"],
        ["人物", "查看人物身份、关系和身体状况。这里展示故事已经记录的信息。"],
        ["资料", "这里阅读物品、地点等已经记录的内容；查看是只读的。"],
        ["章节", "这里回顾主要事件；每轮剧情会自动保存。"],
        ["目录", "目录汇集日记本入口，也可前往保存或返回主菜单。"],
        ["快捷行动", "观察、地点和背包都是快捷提问或行动，都会发送一次请求并推进本轮互动。"],
        ["说出下一步", "用自然语言写下行动或回应。Enter 发送，Shift + Enter 换行；本引导不会发送任何内容。"],
        ["语音输入与朗读", "麦克风将说话变成文字，校正后自行发送；右侧语音按钮暂停或继续朗读。这两项都可在设置中开启。"],
        ["设置", "设置中可调整语言、主题、语音等，也可以从那里再次打开这份引导。"]
      ]
    },
    "en-US": {
      aria: "Game interface tour", skip: "Skip", previous: "Previous", next: "Next", finish: "Finish", progress: "Step {current} of {total}",
      steps: [
        ["The story unfolds here", "This is where your actions and Grey Crow's replies appear. Scroll up to revisit what happened."],
        ["Current situation", "This shows the current story, location, condition, turn, and in-story time. It changes with the adventure."],
        ["Host status", "This shows whether the host is preparing, working, or needs attention."],
        ["Drop and LIVE", "The drop shows how much space this turn’s reference information uses, not health or credit. LIVE shows the current connection status."],
        ["Current state", "Check your location, condition, turn, and in-story day. Viewing does not advance the story."],
        ["Characters", "Check character identities, relationships, and conditions already recorded in the story."],
        ["Records", "Read already recorded items, places, and other details here. Viewing is read-only."],
        ["Chapters", "Review major events here. Each story turn is saved automatically."],
        ["Directory", "The directory gathers notebook entries and also leads to saving or the main menu."],
        ["Quick actions", "Observe, location, and backpack are quick prompts or actions. Each sends one request and advances this interaction."],
        ["Choose what happens next", "Write an action or reply in natural language. Enter sends and Shift + Enter adds a line; this tour never sends text."],
        ["Speech input and reading", "The microphone turns speech into text for you to check and send. The voice control on the right pauses or resumes readout. Enable these separately in Settings."],
        ["Settings", "Settings lets you adjust language, theme, and speech, and open this tour again."]
      ]
    },
    "ja-JP": {
      aria: "ゲーム画面ガイド", skip: "スキップ", previous: "戻る", next: "次へ", finish: "完了", progress: "{current} / {total}",
      steps: [
        ["物語はここで進みます", "あなたの行動と灰鴉の応答がここに表示されます。上へスクロールして出来事を読み返せます。"],
        ["現在の状況", "現在の物語、場所、身体の状態、ターン、物語内の時間を表示します。冒険に合わせて変わります。"],
        ["ホストの状態", "ホストが準備中、処理中、または確認が必要かを示します。"],
        ["雫と LIVE", "雫は今回の参考情報が使う容量を示し、体力や残高ではありません。LIVE は現在の接続状態です。"],
        ["現在の状態", "現在地、身体の状態、ターン、物語内の日付を確認できます。閲覧で物語は進みません。"],
        ["人物", "物語に記録された人物の身元、関係、身体の状態を確認できます。"],
        ["資料", "記録済みの物、場所などをここで読めます。閲覧は読み取り専用です。"],
        ["章", "主な出来事を振り返れます。物語の各ターンは自動保存されます。"],
        ["目次", "目次にはノートの入口が集まり、セーブやメインメニューにも進めます。"],
        ["クイック行動", "観察、場所、持ち物はすべて簡単な質問や行動のボタンです。押すと灰鴉に送信し、やり取りを進めます。"],
        ["次の行動を書く", "自然な言葉で行動や返答を書きます。Enter で送信、Shift + Enter で改行します。このガイドは送信しません。"],
        ["音声入力と読み上げ", "マイクで話すと文字になり、確認してから送信できます。右の音声ボタンは読み上げの一時停止・再開用です。それぞれ設定で有効にできます。"],
        ["設定", "設定で言語、テーマ、音声を調整でき、このガイドも再度開けます。"]
      ]
    }
  };

  const STEP_DEFINITIONS = [
    { id: "narration", selectors: ["#narrationPanel"], focusMaxHeight: 300 },
    { id: "world", selectors: ["#storyNotebookWorldCard", "#stateGrid"] },
    { id: "host", selectors: ["#storyNotebookHostStatus"] },
    { id: "connection", selectors: ["#contextMeter", "#storyNotebookLive"] },
    { id: "state", selectors: ["#storyNotebookStateButton"] },
    { id: "characters", selectors: ["#storyNotebookCharactersButton"], optional: true },
    { id: "records", selectors: ["#storyNotebookModulesButton"] },
    { id: "chapters", selectors: ["#storyNotebookChaptersButton"] },
    { id: "directory", selectors: ["#storyNotebookDirectoryButton"] },
    { id: "shortcuts", selectors: ["#commandMenu"] },
    { id: "input", selectors: ["#turnInput", "#sendTurnButton"] },
    { id: "speech", selectors: ["#speechInputButton", "#ttsPlaybackToggleButton"] },
    { id: "settings", selectors: ["#gameSettingsButton"] }
  ];

  const rectFor = elements => {
    const rects = elements.map(element => element.getBoundingClientRect());
    const left = Math.min(...rects.map(rect => rect.left));
    const top = Math.min(...rects.map(rect => rect.top));
    const right = Math.max(...rects.map(rect => rect.right));
    const bottom = Math.max(...rects.map(rect => rect.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };

  const visible = element => {
    if (!element || !element.isConnected || element.hidden) return false;
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    }
    const style = root.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 1 && rect.height > 1;
  };

  function create({ getLocale, onDismiss } = {}) {
    let dialog = null, open = false, index = 0, steps = [], priorFocus = null, observer = null, frame = null, geometry = "";
    const locale = () => {
      const value = String(getLocale?.() || document.documentElement.lang || "");
      if (COPY[value]) return value;
      if (value.startsWith("zh")) return "zh-CN";
      if (value.startsWith("ja")) return "ja-JP";
      return "en-US";
    };
    const words = () => COPY[locale()];

    const current = () => steps[index];
    const close = () => {
      if (!open) return;
      open = false;
      if (frame !== null) root.cancelAnimationFrame(frame);
      frame = null; geometry = "";
      root.removeEventListener("resize", refresh);
      root.removeEventListener("scroll", refresh, true);
      observer?.disconnect(); observer = null;
      if (dialog?.open) dialog.close();
      dialog?.remove(); dialog = null;
      const input = document.getElementById("turnInput");
      const focusTarget = visible(priorFocus) ? priorFocus : visible(input) && !input.disabled ? input : null;
      if (!document.hidden) focusTarget?.focus?.({ preventScroll: true });
      priorFocus = null;
    };
    const dismiss = completed => { close(); onDismiss?.({ completed }); };

    const buildSteps = () => STEP_DEFINITIONS.map((definition, contentIndex) => {
      const elements = definition.selectors.map(selector => document.querySelector(selector));
      const available = elements.filter(visible);
      return available.length ? { ...definition, elements: available, contentIndex } : null;
    }).filter(Boolean);

    const placeCard = rect => {
      const card = dialog.querySelector(".game-tour-card");
      const pad = 14, width = Math.min(340, Math.max(260, root.innerWidth - pad * 2));
      const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(value, maximum));
      card.style.width = `${width}px`; card.style.left = `${pad}px`; card.style.top = `${pad}px`;
      const height = card.getBoundingClientRect().height;
      const maxLeft = Math.max(pad, root.innerWidth - width - pad);
      const maxTop = Math.max(pad, root.innerHeight - height - pad);
      const overlap = candidate => Math.max(0, Math.min(candidate.left + width, rect.right) - Math.max(candidate.left, rect.left))
        * Math.max(0, Math.min(candidate.top + height, rect.bottom) - Math.max(candidate.top, rect.top));
      const candidates = [
        { left: clamp(rect.left, pad, maxLeft), top: clamp(rect.bottom + pad, pad, maxTop) },
        { left: clamp(rect.right + pad, pad, maxLeft), top: clamp(rect.top, pad, maxTop) },
        { left: clamp(rect.left - width - pad, pad, maxLeft), top: clamp(rect.top, pad, maxTop) },
        { left: clamp(rect.left, pad, maxLeft), top: clamp(rect.top - height - pad, pad, maxTop) }
      ];
      candidates.sort((a, b) => overlap(a) - overlap(b));
      card.style.left = `${candidates[0].left}px`; card.style.top = `${candidates[0].top}px`;
    };

    const position = () => {
      if (!open || !dialog || !current()) return;
      const step = current();
      const rect = rectFor(step.elements), pad = 7;
      if (step.focusMaxHeight && rect.height > step.focusMaxHeight) {
        rect.height = step.focusMaxHeight;
        rect.bottom = rect.top + rect.height;
      }
      const highlight = dialog.querySelector(".game-tour-highlight");
      const left = Math.max(0, Math.min(root.innerWidth, rect.left - pad));
      const top = Math.max(0, Math.min(root.innerHeight, rect.top - pad));
      const right = Math.max(left, Math.min(root.innerWidth, rect.right + pad));
      const bottom = Math.max(top, Math.min(root.innerHeight, rect.bottom + pad));
      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${right - left}px`;
      highlight.style.height = `${bottom - top}px`;
      placeCard(rect);
    };

    // Layout can move without a DOM mutation (window resizing or notebook
    // transitions). Track geometry only while the modal is open; do not keep
    // rewriting live text or rebuilding the target list on every frame.
    const followGeometry = () => {
      if (!open) return;
      const rect = current() && rectFor(current().elements);
      const next = rect ? [rect.left, rect.top, rect.right, rect.bottom, root.innerWidth, root.innerHeight].join(":") : "";
      if (next !== geometry) { geometry = next; position(); }
      frame = root.requestAnimationFrame(followGeometry);
    };

    const render = () => {
      if (!open || !dialog || !current()) return;
      const step = current(), copy = words(), [title, body] = copy.steps[step.contentIndex];
      dialog.querySelector(".game-tour-title").textContent = title;
      dialog.querySelector(".game-tour-copy").textContent = body;
      dialog.querySelector(".game-tour-progress").textContent = copy.progress.replace("{current}", index + 1).replace("{total}", steps.length);
      dialog.dataset.step = step.id;
      const previous = dialog.querySelector("[data-tour-action=previous]");
      const next = dialog.querySelector("[data-tour-action=next]");
      dialog.querySelector("[data-tour-action=skip]").textContent = copy.skip;
      previous.textContent = copy.previous; previous.disabled = index === 0;
      next.textContent = index === steps.length - 1 ? copy.finish : copy.next;
      dialog.setAttribute("aria-label", copy.aria);
      position();
    };

    const refresh = () => {
      if (!open) return;
      const priorIndex = current()?.contentIndex;
      steps = buildSteps();
      let nextIndex = steps.findIndex(step => step.contentIndex === priorIndex);
      if (nextIndex < 0) nextIndex = steps.findIndex(step => step.contentIndex > priorIndex);
      if (!steps.length || nextIndex < 0) { close(); return; }
      index = nextIndex;
      render();
    };

    const change = direction => {
      index += direction;
      if (index < 0) index = 0;
      if (index >= steps.length) { dismiss(true); return; }
      render();
      dialog.querySelector("[data-tour-action=next]").focus({ preventScroll: true });
    };

    const start = () => {
      if (open) return true;
      steps = buildSteps(); index = 0;
      if (!steps.length) return false;
      priorFocus = document.activeElement;
      dialog = document.createElement("dialog");
      dialog.id = "gameTourDialog";
      dialog.className = "game-tour-dialog";
      dialog.setAttribute("aria-labelledby", "gameTourTitle");
      dialog.setAttribute("aria-describedby", "gameTourProgress gameTourCopy");
      dialog.innerHTML = '<div id="gameTourSpotlight" class="game-tour-highlight" aria-hidden="true"></div><section id="gameTourCard" class="game-tour-card" role="document"><p id="gameTourProgress" class="game-tour-progress"></p><h2 id="gameTourTitle" class="game-tour-title"></h2><p id="gameTourCopy" class="game-tour-copy"></p><footer class="game-tour-actions"><button id="gameTourSkip" type="button" class="game-tour-skip" data-tour-action="skip"></button><span class="game-tour-spacer"></span><button id="gameTourPrevious" type="button" data-tour-action="previous"></button><button id="gameTourNext" type="button" class="game-tour-next" data-tour-action="next"></button></footer></section>';
      document.body.append(dialog);
      dialog.querySelector("#gameTourCopy").setAttribute("aria-live", "polite");
      dialog.querySelector("[data-tour-action=skip]").addEventListener("click", () => dismiss(false));
      dialog.querySelector("[data-tour-action=previous]").addEventListener("click", () => change(-1));
      dialog.querySelector("[data-tour-action=next]").addEventListener("click", () => change(1));
      dialog.addEventListener("click", event => event.preventDefault());
      dialog.addEventListener("wheel", event => event.preventDefault(), { passive: false });
      dialog.addEventListener("cancel", event => { event.preventDefault(); dismiss(false); });
      dialog.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); dismiss(false); return; }
        if (event.key !== "Tab") return;
        const focusable = Array.from(dialog.querySelectorAll("button:not([disabled])"));
        const atStart = document.activeElement === focusable[0], atEnd = document.activeElement === focusable.at(-1);
        if ((event.shiftKey && atStart) || (!event.shiftKey && atEnd)) {
          event.preventDefault(); (event.shiftKey ? focusable.at(-1) : focusable[0]).focus({ preventScroll: true });
        }
      });
      open = true;
      dialog.showModal();
      root.addEventListener("resize", refresh);
      root.addEventListener("scroll", refresh, true);
      observer = new MutationObserver(records => {
        if (records.some(record => !dialog?.contains(record.target))) refresh();
      });
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "class", "aria-hidden"] });
      render();
      frame = root.requestAnimationFrame(followGeometry);
      dialog.querySelector("[data-tour-action=next]").focus({ preventScroll: true });
      return true;
    };
    return { start, close, isOpen: () => open, refresh };
  }
  root.GreyCrowGameTour = { create };
})(globalThis);
