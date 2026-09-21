"use strict";

(function (root) {
  const LIMIT_SECONDS = 120;
  const MAX_TEXT = 4000;
  const HOLD_DELAY_MS = 220;
  const ACTIVE = new Set(["preparing", "recording", "transcribing"]);
  const failure = code => Object.assign(new Error(code), { code });
  const bound = (a, b) => a?.adventureId === b?.adventureId && a?.sessionId === b?.sessionId;
  const appendText = (before, after) => before + (before && !/\s$/.test(before) ? "\n" : "") + after;

  function createHoldGesture(options) {
    const target = options.target;
    const host = options.host || root;
    const doc = options.document || host.document;
    const delay = options.delayMs ?? HOLD_DELAY_MS;
    const schedule = options.setTimeout || host.setTimeout?.bind(host) || root.setTimeout.bind(root);
    const unschedule = options.clearTimeout || host.clearTimeout?.bind(host) || root.clearTimeout.bind(root);
    let phase = "idle", pointerId = null, held = false, timer = null, startPoint = null, generation = 0, disposed = false;
    const emit = () => options.onChange?.({ phase, held, pointerId });
    const clearDelay = () => { if (timer !== null) unschedule(timer); timer = null; };
    const releasePointer = () => {
      if (pointerId !== null) {
        try { target.releasePointerCapture?.(pointerId); } catch { /* Capture may already be gone. */ }
      }
      pointerId = null; startPoint = null;
    };
    const cancel = () => {
      const shouldCancel = phase === "permission-pending" || phase === "recording";
      generation++; clearDelay(); held = false; releasePointer();
      if (shouldCancel) options.cancel?.();
      phase = "idle"; emit();
    };
    const begin = async token => {
      timer = null;
      if (disposed || token !== generation || phase !== "pressed" || !held) return;
      phase = "permission-pending"; emit();
      try {
        await options.start?.({ token, isHeld: () => !disposed && token === generation && phase === "permission-pending" && held });
        if (disposed || token !== generation || phase !== "permission-pending" || !held) return;
        if (options.isRecording && !options.isRecording()) { held = false; releasePointer(); phase = "idle"; emit(); return; }
        phase = "recording"; emit();
      } catch {
        if (!disposed && token === generation) { held = false; releasePointer(); phase = "idle"; emit(); }
      }
    };
    const press = event => {
      if (disposed || phase !== "idle" || event?.button != null && event.button !== 0 || event?.isPrimary === false || options.canPress?.(event) === false) return;
      const token = ++generation;
      pointerId = event?.pointerId ?? null; startPoint = Number.isFinite(event?.clientX) && Number.isFinite(event?.clientY)
        ? { x: event.clientX, y: event.clientY } : null; held = true; phase = "pressed";
      try { if (pointerId !== null) target.setPointerCapture?.(pointerId); } catch { /* Capture is only a safety net. */ }
      options.onPress?.(event); emit(); timer = schedule(() => { void begin(token); }, delay);
    };
    const pointerMove = event => {
      if (phase !== "pressed" || pointerId === null || event?.pointerId !== pointerId || !startPoint || !options.cancelDistancePx) return;
      if (Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y) > options.cancelDistancePx) cancel();
    };
    const end = event => {
      if (pointerId !== null && event?.pointerId != null && event.pointerId !== pointerId) return;
      const wasRecording = phase === "recording";
      clearDelay(); held = false; generation++; releasePointer();
      if (wasRecording) { phase = "stopping"; emit(); Promise.resolve(options.stop?.()).finally(() => {
        if (!disposed && phase === "stopping") { phase = "idle"; emit(); }
      }); return; }
      // A release while permission is pending must cancel; it must never leave a
      // recorder running after the pointer has already gone up.
      if (phase === "permission-pending") { options.cancel?.(); }
      phase = "idle"; emit();
    };
    const pointerCancel = event => {
      if (!held || pointerId === null || event?.pointerId != null && event.pointerId !== pointerId) return;
      cancel();
    };
    const blur = () => cancel();
    const visibility = () => { if (doc?.hidden) cancel(); };
    target.addEventListener("pointerdown", press);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointermove", pointerMove);
    target.addEventListener("pointercancel", pointerCancel);
    target.addEventListener("lostpointercapture", pointerCancel);
    host.addEventListener?.("blur", blur);
    host.addEventListener?.("pagehide", blur);
    doc?.addEventListener?.("visibilitychange", visibility);
    return { snapshot: () => ({ phase, held, pointerId }), press, release: end, cancel,
      dispose() {
        if (disposed) return; cancel(); disposed = true;
        target.removeEventListener("pointerdown", press); target.removeEventListener("pointerup", end); target.removeEventListener("pointermove", pointerMove);
        target.removeEventListener("pointercancel", pointerCancel); target.removeEventListener("lostpointercapture", pointerCancel);
        host.removeEventListener?.("blur", blur); host.removeEventListener?.("pagehide", blur);
        doc?.removeEventListener?.("visibilitychange", visibility);
      },
    };
  }

  function ensureMicrophoneIcon(button, doc) {
    if (!button || !doc?.createElementNS) return;
    if (button.dataset.speechIcon === "microphone") return;
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "speech-input-microphone-icon"); svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    const capsule = doc.createElementNS("http://www.w3.org/2000/svg", "rect");
    capsule.setAttribute("x", "8"); capsule.setAttribute("y", "3"); capsule.setAttribute("width", "8"); capsule.setAttribute("height", "12"); capsule.setAttribute("rx", "4");
    const sound = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    sound.setAttribute("d", "M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8");
    svg.append(capsule, sound); button.replaceChildren(svg); button.dataset.speechIcon = "microphone";
    button.removeAttribute("data-i18n");
  }

  function encodeWav(chunks, length) {
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const label = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    label(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); label(8, "WAVE"); label(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); label(36, "data"); view.setUint32(40, length * 2, true);
    let position = 44;
    for (const chunk of chunks) for (const sample of chunk) { view.setInt16(position, sample, true); position += 2; }
    return buffer;
  }

  async function createRecorder({ deviceId, signal, onLimit, onError }) {
    if (!root.navigator?.mediaDevices?.getUserMedia || !root.AudioWorkletNode) throw failure("SPEECH_CAPTURE_UNAVAILABLE");
    let stream, context, source, processor, silent, closed = false, finishing = false, resolveStop;
    const chunks = [];
    let length = 0;
    const stopped = new Promise(resolve => { resolveStop = resolve; });
    const close = () => {
      if (closed) return;
      closed = true;
      signal.removeEventListener("abort", close);
      for (const track of stream?.getTracks() || []) track.stop();
      source?.disconnect(); processor?.disconnect(); silent?.disconnect();
      if (context && context.state !== "closed") void context.close().catch(() => {});
      resolveStop();
    };
    signal.addEventListener("abort", close, { once: true });
    try {
      stream = await root.navigator.mediaDevices.getUserMedia({ audio: {
        ...(deviceId && deviceId !== "default" ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      }, video: false });
      if (closed || signal.aborted) {
        for (const track of stream.getTracks()) track.stop();
        throw failure("SPEECH_CANCELLED");
      }
      for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => {
        if (!closed && !finishing) { close(); onError(failure("SPEECH_DEVICE_LOST")); }
      });
      context = new root.AudioContext({ sampleRate: 16000 });
      await context.audioWorklet.addModule("speech-input-worklet.js");
      if (closed || signal.aborted) throw failure("SPEECH_CANCELLED");
      processor = new root.AudioWorkletNode(context, "grey-crow-pcm-capture");
      processor.port.onmessage = ({ data }) => {
        if (closed) return;
        if (data?.type === "samples") {
          const count = Math.min(data.samples.length, 16000 * LIMIT_SECONDS - length);
          if (count > 0) { chunks.push(data.samples.slice(0, count)); length += count; }
        } else if (data?.type === "stopped") {
          finishing = true;
          for (const track of stream.getTracks()) track.stop();
          resolveStop(); if (data.limit) onLimit();
        }
      };
      processor.onprocessorerror = () => { if (!closed) { close(); onError(failure("SPEECH_CAPTURE_FAILED")); } };
      source = context.createMediaStreamSource(stream);
      silent = context.createGain(); silent.gain.value = 0;
      source.connect(processor); processor.connect(silent); silent.connect(context.destination);
      await context.resume();
      if (closed || signal.aborted) throw failure("SPEECH_CANCELLED");
      return {
        cancel: close,
        async stop() {
          if (closed) throw failure("SPEECH_CANCELLED");
          finishing = true;
          for (const track of stream.getTracks()) track.stop();
          processor.port.postMessage("stop");
          let timeout;
          await Promise.race([stopped, new Promise(resolve => { timeout = root.setTimeout(resolve, 1000); })]);
          root.clearTimeout(timeout);
          close();
          if (!length) throw failure("SPEECH_EMPTY_AUDIO");
          return encodeWav(chunks, length);
        },
      };
    } catch (error) { close(); throw error; }
  }

  function createController(hooks) {
    const api = hooks.api;
    const now = hooks.now || (() => performance.now());
    const schedule = hooks.setInterval || root.setInterval.bind(root);
    const unschedule = hooks.clearInterval || root.clearInterval.bind(root);
    let phase = "idle", errorCode = "", message = "", pending = null, resource = null;
    let task = null, generation = 0, timer = null, disposed = false;
    const snapshot = () => ({ phase, errorCode, message, pending, resource, busy: ACTIVE.has(phase),
      seconds: task?.startedAt == null ? 0 : Math.min(LIMIT_SECONDS, Math.floor((now() - task.startedAt) / 1000)), test: task?.test || false });
    const emit = () => hooks.onChange?.(snapshot());
    const clearTimer = () => { if (timer !== null) unschedule(timer); timer = null; };
    const release = current => { current?.releaseAudio?.(); if (current) current.releaseAudio = null; };
    const current = active => !disposed && task === active && active.generation === generation && bound(active.context, hooks.getContext());
    const cancelRemote = requestId => Promise.resolve(api.cancelSpeechInput?.({ requestId })).catch(() => {});
    function cancel({ clearPending = true } = {}) {
      generation++;
      const previous = task; task = null;
      previous?.abort.abort(); previous?.recorder?.cancel(); release(previous); clearTimer();
      if (previous) void cancelRemote(previous.requestId);
      if (clearPending) pending = null;
      phase = pending ? "pending" : "idle"; errorCode = ""; message = ""; emit();
    }
    function fail(error, active) {
      if (active && !current(active)) return;
      const code = error?.code || error?.name || "SPEECH_FAILED";
      const diagnostic = { NotAllowedError: "SPEECH_PERMISSION_DENIED", NotFoundError: "SPEECH_DEVICE_MISSING",
        NotReadableError: "SPEECH_DEVICE_BUSY", SPEECH_CAPTURE_FAILED: "SPEECH_CAPTURE_FAILED" }[code];
      if (diagnostic) Promise.resolve(api.recordProblem?.(diagnostic)).catch(() => {});
      cancel({ clearPending: false }); phase = "error"; errorCode = code; emit();
    }
    async function refreshStatus() {
      try {
        const reply = await api.getSpeechInputStatus?.();
        if (disposed) return resource;
        resource = reply?.ok ? reply.status : { available: false, errorCode: reply?.error?.code || "SPEECH_RUNTIME_UNAVAILABLE" };
      } catch { resource = { available: false, errorCode: "SPEECH_RUNTIME_UNAVAILABLE" }; }
      if (!disposed) emit(); return resource;
    }
    async function start({ test = false } = {}) {
      if (disposed || ACTIVE.has(phase) || pending) return;
      const settings = hooks.getSettings();
      if (!settings.enabled) { hooks.openSettings?.(); return; }
      const context = hooks.getContext();
      if (!test && !context.ready) return;
      const active = { generation: ++generation, context, draft: hooks.getDraft(), test, preparedAt: now(),
        requestId: (hooks.uuid || (() => root.crypto.randomUUID()))(), abort: new AbortController(), startedAt: null };
      task = active; phase = "preparing"; errorCode = ""; message = ""; emit();
      timer = schedule(tick, 200);
      try {
        const status = await refreshStatus();
        if (!current(active)) return;
        if (!status?.runtimeAvailable) throw failure("SPEECH_RUNTIME_UNAVAILABLE");
        if (!status?.modelInstalled) throw failure("SPEECH_MODEL_MISSING");
        if (status.enabled === false) throw failure("SPEECH_SAVE_SETTINGS");
        active.releaseAudio = hooks.acquireAudioFocus?.();
        active.recorder = await (hooks.createRecorder || createRecorder)({ deviceId: settings.deviceId,
          signal: active.abort.signal, onLimit: () => { if (current(active)) void stop(); },
          onError: error => fail(error, active) });
        if (!current(active)) { active.recorder.cancel(); return; }
        active.startedAt = now(); phase = "recording"; clearTimer(); emit();
        timer = schedule(tick, 200);
      } catch (error) { fail(error, active); }
    }
    function tick() {
      if (!["preparing", "recording"].includes(phase) || !task) return;
      if (!current(task)) { cancel(); return; }
      if (phase === "preparing") {
        if (now() - task.preparedAt >= 30000) fail(failure("SPEECH_PERMISSION_TIMEOUT"), task);
        return;
      }
      if (now() - task.startedAt >= LIMIT_SECONDS * 1000) void stop(); else emit();
    }
    async function stop() {
      const active = task;
      if (phase !== "recording" || !current(active)) return;
      clearTimer(); phase = "transcribing"; emit();
      try {
        const audio = await active.recorder.stop(); release(active);
        if (!current(active)) return;
        const reply = await api.transcribeSpeechInput({ requestId: active.requestId, audio,
          adventureId: active.test ? null : active.context.adventureId,
          sessionId: active.test ? null : active.context.sessionId, test: active.test });
        if (!current(active)) return;
        if (!reply?.ok) throw failure(reply?.error?.code || "SPEECH_FAILED");
        const text = typeof reply.result?.text === "string" ? reply.result.text.trim() : "";
        if (!text) throw failure("SPEECH_NO_TEXT");
        const draft = hooks.getDraft();
        const combined = appendText(draft.text, text);
        pending = { text, test: active.test, context: active.context, reason: active.test ? "test"
          : draft.version !== active.draft.version || draft.text !== active.draft.text ? "changed"
            : combined.length > MAX_TEXT ? "length" : "" };
        task = null;
        if (!pending.reason) { hooks.setDraft(combined); pending = null; phase = "idle"; message = "inserted"; }
        else phase = "pending";
        emit();
      } catch (error) { fail(error, active); }
    }
    function insertPending(text = pending?.text) {
      if (!pending || pending.test || !bound(pending.context, hooks.getContext()) || !hooks.getContext().ready) return false;
      const combined = appendText(hooks.getDraft().text, String(text || "").trim());
      if (combined.length > MAX_TEXT) { pending = { ...pending, text: String(text || ""), reason: "length" }; emit(); return false; }
      hooks.setDraft(combined); pending = null; phase = "idle"; message = "inserted"; emit(); return true;
    }
    function contextChanged() {
      if (task && !bound(task.context, hooks.getContext()) || pending && !bound(pending.context, hooks.getContext())) cancel();
    }
    return { snapshot, start, stop, cancel, tick, refreshStatus, insertPending, contextChanged,
      discardPending: () => cancel(),
      toggle: options => phase === "recording" ? stop() : ACTIVE.has(phase) ? cancel() : start(options),
      dispose() { cancel(); disposed = true; },
    };
  }

  function mount(hooks) {
    const doc = hooks.document || root.document;
    const el = id => doc.getElementById(id);
    const t = hooks.t;
    const button = el("speechInputButton"), status = el("speechInputStatus"), cancelButton = el("speechInputCancel");
    const resultButton = el("speechInputResultButton"), resultDialog = el("speechInputResultDialog");
    const resultText = el("speechInputResultText"), resultHint = el("speechInputResultHint");
    const testButton = el("speechInputTestButton"), testText = el("speechInputTestText");
    const enabled = el("speechInputEnabledSelect"), language = el("speechInputLanguageSelect"), devices = el("speechInputDeviceSelect");
    const install = el("speechInputInstallButton"), remove = el("speechInputRemoveButton"), downloadCancel = el("speechInputDownloadCancel");
    let downloadBusy = false, resourceError = "", poll = null, lastPending = null;
    const shortcut = /Mac/i.test(root.navigator?.platform || "") ? "⌘⇧Space" : "Ctrl+Shift+Space";
    ensureMicrophoneIcon(button, doc);
    const textInput = el("turnInput");
    const errorKey = code => {
      if (["NotAllowedError", "PermissionDeniedError", "SPEECH_PERMISSION_DENIED"].includes(code)) return "permission";
      if (["NotFoundError", "OverconstrainedError", "DevicesNotFoundError", "SPEECH_DEVICE_LOST"].includes(code)) return "device";
      if (["NotReadableError", "TrackStartError"].includes(code)) return "deviceBusy";
      if (code === "SPEECH_PERMISSION_TIMEOUT") return "permissionTimeout";
      if (/MODEL.*(MISSING|NOT_INSTALLED|INVALID)|MODEL_UNAVAILABLE/.test(code)) return "model";
      if (/RUNTIME|CAPTURE_UNAVAILABLE/.test(code)) return "runtime";
      if (/EMPTY|NO_TEXT|NO_SPEECH|SILENCE/.test(code)) return "empty";
      if (/TOO_LONG/.test(code)) return "tooLong";
      if (/DISABLED|SAVE_SETTINGS/.test(code)) return "save";
      if (/DISK|SPACE|ENOSPC/.test(code)) return "disk";
      if (/DOWNLOAD_TIMEOUT/.test(code)) return "downloadTimeout";
      if (/DOWNLOAD|NETWORK|FETCH/.test(code)) return "download";
      if (/BUSY/.test(code)) return "busy";
      if (/TIMEOUT/.test(code)) return "timeout";
      if (/CANCEL/.test(code)) return "cancelled";
      return "failed";
    };
    const errorText = code => t(`speech.error.${errorKey(String(code || ""))}`);
    const controller = createController({ ...hooks, onChange: value => { render(value); hooks.onChange?.(value); } });
    async function startFromLongPress({ isHeld } = {}) {
      if (!isHeld?.()) return;
      if (!controller.snapshot().busy && hooks.hasSettingsChanges?.()) {
        const saved = await hooks.saveSettings?.();
        if (!saved) { hooks.openSettings?.(); return; }
      }
      if (!isHeld?.()) return;
      return controller.start();
    }
    const holdGesture = textInput ? createHoldGesture({ target: textInput, host: root, document: doc, delayMs: 350, cancelDistancePx: 6,
      canPress: event => event?.detail <= 1 && !textInput.disabled && hooks.getSettings().enabled === true && hooks.getContext().ready
        && !controller.snapshot().busy && !controller.snapshot().pending && textInput.selectionStart === textInput.selectionEnd,
      start: startFromLongPress, isRecording: () => controller.snapshot().phase === "recording",
      stop: () => controller.stop(), cancel: () => controller.cancel() }) : null;
    function render(value = controller.snapshot()) {
      const recording = value.phase === "recording";
      const action = recording ? t("speech.stop") : value.busy ? t("speech.cancel") : t("speech.start");
      const holdHint = hooks.getSettings().enabled === true ? ` · ${t("speech.holdHint")}` : "";
      button.title = `${action} · ${t("speech.shortcut", { shortcut })} · ${t("speech.limit")}${holdHint}`;
      button.setAttribute("aria-label", button.title);
      if (textInput) textInput.title = hooks.getSettings().enabled === true ? t("speech.holdHint") : "";
      button.setAttribute("aria-pressed", String(recording));
      button.disabled = !value.busy && (!hooks.getContext().ready || Boolean(value.pending));
      button.dataset.phase = value.phase;
      let copy = value.phase === "recording" ? t("speech.recording", { seconds: value.seconds })
        : value.phase === "preparing" ? t("speech.preparing")
          : value.phase === "transcribing" ? t("speech.transcribing")
            : value.phase === "error" ? errorText(value.errorCode)
              : value.pending ? t(value.pending.test ? "speech.testDone" : "speech.pending")
                : value.message === "inserted" ? t("speech.inserted") : "";
      status.textContent = value.test || value.pending?.test ? "" : copy;
      status.title = status.textContent;
      status.hidden = !status.textContent;
      el("speechInputBar").hidden = !status.textContent;
      el("speechInputKeyboardHint").hidden = Boolean(status.textContent);
      cancelButton.hidden = !value.busy;
      resultButton.hidden = !value.pending || value.pending.test;
      const resource = value.resource;
      const downloading = downloadBusy || resource?.downloading;
      const progress = resource?.progress;
      const progressCopy = progress?.total > 0 ? ` ${Math.min(100, Math.floor(progress.received / progress.total * 100))}%` : "";
      el("speechInputResourceStatus").textContent = resourceError ? errorText(resourceError)
        : downloading ? t("speech.downloading") + progressCopy
          : resource?.errorCode ? errorText(resource.errorCode)
            : resource?.modelSource === "bundled" ? t("speech.bundled")
              : resource?.modelInstalled ? t("speech.installed") : t("speech.notInstalled");
      el("speechInputTestStatus").textContent = value.test || value.pending?.test || value.phase === "error" ? copy : "";
      testButton.textContent = t(recording && value.test ? "speech.stop" : value.busy ? "speech.cancel" : "speech.test");
      testButton.disabled = downloading || (!value.busy && !value.pending?.test && Boolean(value.pending));
      install.hidden = Boolean(resource?.modelInstalled) || downloading;
      install.disabled = value.busy || resource?.runtimeAvailable === false;
      remove.hidden = resource?.modelSource !== "download" || downloading;
      remove.disabled = value.busy;
      downloadCancel.hidden = !downloading;
      if (value.pending !== lastPending) {
        if (value.pending?.test) {
          testText.value = value.pending.text;
          root.requestAnimationFrame(() => {
            if (el("settingsDialog").open) testText.scrollIntoView({ block: "nearest" });
          });
        }
        if (value.pending && !value.pending.test) resultText.value = value.pending.text;
        lastPending = value.pending;
      }
      testText.hidden = !testText.value;
      resultHint.textContent = t(value.pending?.reason === "length" ? "speech.tooLong" : "speech.draftChanged");
      if (!value.pending && resultDialog.open) resultDialog.close();
    }
    const toggle = async options => {
      if (!controller.snapshot().busy && hooks.hasSettingsChanges?.()) {
        const saved = await hooks.saveSettings?.();
        if (!saved) {
          el("speechInputTestStatus").textContent = t("speech.error.save");
          hooks.openSettings?.(); return;
        }
      }
      return controller.toggle(options);
    };
    button.addEventListener("click", () => toggle());
    cancelButton.addEventListener("click", () => controller.cancel());
    testButton.addEventListener("click", () => {
      if (controller.snapshot().pending?.test) controller.discardPending();
      void toggle({ test: true });
    });
    resultButton.addEventListener("click", () => { resultDialog.showModal(); resultText.focus(); });
    el("speechInputInsertButton").addEventListener("click", () => controller.insertPending(resultText.value));
    el("speechInputDiscardButton").addEventListener("click", () => controller.discardPending());
    el("speechInputResultClose").addEventListener("click", () => resultDialog.close());
    for (const control of [enabled, language, devices]) control.addEventListener("change", () => {
      if (controller.snapshot().busy) controller.cancel();
      hooks.onSettingsInput({ enabled: enabled.value === "true", language: language.value, deviceId: devices.value || "default" }, control);
    });
    async function refreshDevices() {
      if (!root.navigator?.mediaDevices?.enumerateDevices) return;
      try {
        const selected = devices.value || hooks.getSettings().deviceId || "default";
        const list = await root.navigator.mediaDevices.enumerateDevices();
        devices.replaceChildren(new Option(t("speech.deviceDefault"), "default"));
        let index = 0;
        for (const device of list.filter(item => item.kind === "audioinput" && item.deviceId && item.deviceId !== "default")) {
          devices.appendChild(new Option(device.label || t("speech.deviceNumber", { number: ++index }), device.deviceId));
        }
        if (![...devices.options].some(option => option.value === selected)) devices.appendChild(new Option(t("speech.deviceMissing"), selected));
        devices.value = selected;
      } catch { /* Permissions are requested only by explicit recording. */ }
    }
    el("speechInputDevicesRefresh").addEventListener("click", refreshDevices);
    let watchingDevices = false;
    function stopWatchingDevices() {
      if (!watchingDevices) return;
      root.navigator?.mediaDevices?.removeEventListener("devicechange", refreshDevices);
      watchingDevices = false;
    }
    async function manageModel(action) {
      resourceError = ""; downloadBusy = action === "install"; render();
      if (downloadBusy) poll = root.setInterval(() => { void controller.refreshStatus(); }, 600);
      try {
        const reply = await (action === "install" ? hooks.api.installSpeechInputModel() : hooks.api.removeSpeechInputModel());
        if (!reply?.ok) resourceError = reply?.error?.code || "SPEECH_DOWNLOAD_FAILED";
      } catch { resourceError = "SPEECH_DOWNLOAD_FAILED"; }
      finally { downloadBusy = false; if (poll) root.clearInterval(poll); poll = null; await controller.refreshStatus(); render(); }
    }
    install.addEventListener("click", () => { void manageModel("install"); });
    remove.addEventListener("click", () => { void manageModel("remove"); });
    downloadCancel.addEventListener("click", async () => {
      try { await hooks.api.cancelSpeechInput({}); } catch { resourceError = "SPEECH_DOWNLOAD_FAILED"; }
      await controller.refreshStatus();
    });
    const keydown = event => {
      if (event.key === "Escape" && controller.snapshot().busy) {
        event.preventDefault(); event.stopImmediatePropagation(); controller.cancel(); return;
      }
      if (event.repeat || event.isComposing || event.code !== "Space" || !event.shiftKey || event.altKey
        || !(/Mac/i.test(root.navigator?.platform || "") ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
        || !hooks.canShortcut()) return;
      event.preventDefault(); event.stopImmediatePropagation(); void toggle();
    };
    doc.addEventListener("keydown", keydown, true);
    doc.addEventListener("visibilitychange", () => {
      if (doc.hidden && controller.snapshot().phase === "recording") void controller.stop();
      else if (doc.hidden && controller.snapshot().phase === "preparing") controller.cancel();
      else controller.tick();
    });
    const dispose = () => { holdGesture?.dispose(); controller.dispose(); };
    root.addEventListener("beforeunload", dispose, { once: true });
    el("settingsDialog").addEventListener("close", () => {
      stopWatchingDevices();
      if (controller.snapshot().test || controller.snapshot().pending?.test) controller.cancel();
    });
    return { ...controller, dispose, render, refreshDevices,
      settingsOpened() {
        if (!watchingDevices && root.navigator?.mediaDevices?.addEventListener) {
          root.navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
          watchingDevices = true;
        }
        void controller.refreshStatus(); void refreshDevices();
      },
      applySettings(settings) {
        enabled.value = String(settings.enabled === true); language.value = settings.language || "zh";
        if (![...devices.options].some(option => option.value === settings.deviceId)) devices.appendChild(new Option(t("speech.deviceMissing"), settings.deviceId));
        devices.value = settings.deviceId || "default";
        if (!settings.enabled && controller.snapshot().busy) controller.cancel();
        render();
      },
    };
  }

  const exported = { createController, createRecorder, createHoldGesture, mount, encodeWav, appendText, LIMIT_SECONDS, MAX_TEXT, HOLD_DELAY_MS };
  root.GreyCrowSpeechInput = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(globalThis);
