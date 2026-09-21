/* Grey Crow's opening-book presenter.  It only projects the one live game DOM;
 * game state, prose, saves, audio and focus policy remain in app.js. */
(() => {
  'use strict';

  const PAGE = Object.freeze({ x: 24, y: 18, width: 1416, height: 864 });
  const FPS = 24;
  const SETTLED_FRAME = 132;
  const SETTLED_AT = (SETTLED_FRAME - 1) / FPS;
  const COPY = {
    'zh-CN': { skip: '跳过开场', label: '正在翻开日记本' },
    'en-US': { skip: 'Skip opening', label: 'Opening journal' },
    'ja-JP': { skip: '開く演出をスキップ', label: '手記を開いています' },
  };

  function matrixFor(source, target) {
    const rows = [];
    source.forEach(([x, y], index) => {
      const [u, v] = target[index];
      rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    });
    for (let column = 0; column < 8; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < 8; row += 1) {
        if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
      }
      if (Math.abs(rows[pivot][column]) < 1e-9) return null;
      [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
      const divisor = rows[column][column];
      for (let cell = column; cell < 9; cell += 1) rows[column][cell] /= divisor;
      for (let row = 0; row < 8; row += 1) {
        if (row === column) continue;
        const factor = rows[row][column];
        for (let cell = column; cell < 9; cell += 1) rows[row][cell] -= factor * rows[column][cell];
      }
    }
    const h = rows.map((row) => row[8]);
    if (!h.every(Number.isFinite)) return null;
    return [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, 1];
  }

  function createProjection(game) {
    const projection = window.NotebookPageProjectionData;
    const reveal = window.NotebookPageRevealData;
    if (!projection || !reveal) return null;
    const source = [[PAGE.x, PAGE.y], [PAGE.x + PAGE.width, PAGE.y], [PAGE.x + PAGE.width, PAGE.y + PAGE.height], [PAGE.x, PAGE.y + PAGE.height]];
    const wrapper = document.createElement('div');
    wrapper.className = 'gc-book-ink-projection';
    game.parentNode.insertBefore(wrapper, game);
    wrapper.append(game);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('gc-book-reveal-defs');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.innerHTML = '<defs><mask id="gcBookRevealMask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="1600" height="900"><rect width="1600" height="900" fill="white"/><path fill="black" fill-rule="evenodd"/></mask><filter id="gcBookRevealContact" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="1600" height="900" color-interpolation-filters="sRGB"><feImage x="0" y="0" width="1600" height="900" preserveAspectRatio="none" result="contactField"/><feComposite in="SourceGraphic" in2="contactField" operator="arithmetic" k1="1" k2="0" k3="0" k4="0"/></filter></defs>';
    wrapper.before(svg);
    const path = svg.querySelector('mask path');
    const field = svg.querySelector('feImage');
    const clearField = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="white"/></svg>')}`;
    let lastPath = null;
    function clear() {
      document.body.removeAttribute('data-book-projection');
      delete wrapper.dataset.masked;
      wrapper.style.removeProperty('mask-image');
      wrapper.style.removeProperty('-webkit-mask-image');
      wrapper.style.removeProperty('filter');
      game.style.removeProperty('--gc-book-page-projection');
      game.style.removeProperty('--gc-book-page-opacity');
      path.removeAttribute('d'); field.setAttribute('href', clearField); lastPath = null;
    }
    function show(mediaTime) {
      const frame = Math.min(projection.frameCount || 144, Math.max(1, Math.floor(mediaTime * (projection.fps || FPS) + 0.0001) + 1));
      const record = projection.frames?.find((item) => item.frame === frame);
      const mask = reveal.frames?.find((item) => item.frame === frame);
      const firstVisible = reveal.firstVisibleFrame ?? projection.visibleFromFrame ?? projection.firstSampledUnoccludedFrame;
      if (!record || !mask || frame < firstVisible || !Array.isArray(record.corners) || record.corners.length !== 4) { clear(); return false; }
      const corners = record.corners.map((point) => Array.isArray(point) ? point : [point.x, point.y]);
      const matrix = matrixFor(source, corners);
      if (!matrix) { clear(); return false; }
      game.style.setProperty('--gc-book-page-projection', `matrix3d(${matrix.join(',')})`);
      game.style.setProperty('--gc-book-page-opacity', '1');
      document.body.dataset.bookProjection = 'true';
      if (mask.fullClear || !mask.occlusionPath) {
        delete wrapper.dataset.masked;
        wrapper.style.removeProperty('mask-image'); wrapper.style.removeProperty('-webkit-mask-image'); wrapper.style.removeProperty('filter');
        path.removeAttribute('d'); field.setAttribute('href', clearField); lastPath = null;
      } else {
        wrapper.dataset.masked = 'true';
        wrapper.style.setProperty('mask-image', 'url("#gcBookRevealMask")');
        wrapper.style.setProperty('-webkit-mask-image', 'url("#gcBookRevealMask")');
        wrapper.style.filter = 'url("#gcBookRevealContact")';
        if (lastPath !== mask.occlusionPath) {
          lastPath = mask.occlusionPath; path.setAttribute('d', lastPath);
          const shadow = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><filter id="s"><feGaussianBlur stdDeviation="2"/></filter></defs><rect width="1600" height="900" fill="white"/><path d="${lastPath}" fill="black" fill-rule="evenodd" opacity=".16" filter="url(#s)"/></svg>`;
          field.setAttribute('href', `data:image/svg+xml,${encodeURIComponent(shadow)}`);
        }
      }
      return true;
    }
    return { show, clear, dispose() { clear(); svg.remove(); wrapper.before(game); wrapper.remove(); } };
  }

  function normalizeTheme(value) { return value === 'dark' ? 'dark' : 'light'; }
  // A receipt can advance revision while this same page is opening.  Page
  // ownership is adventure + session + mode; app.js validates revision/action
  // again after whenReadable resolves before applying its own side effects.
  function samePageBinding(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    return a.adventureId === b.adventureId && a.sessionId === b.sessionId && a.sessionMode === b.sessionMode;
  }
  function safeCall(fn, ...args) { try { fn?.(...args); } catch (error) { console.error('Notebook book callback failed', error); } }

  function create({ game, host, getTheme, getLocale, isCurrent, onPhaseChange, onReading } = {}) {
    if (!(game instanceof Element) || !(host instanceof Element)) throw new TypeError('GreyCrowNotebookBook requires existing game and host elements');
    if (typeof isCurrent !== 'function') throw new TypeError('GreyCrowNotebookBook requires isCurrent(binding)');
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const projection = createProjection(game);
    const stage = document.createElement('section');
    stage.className = 'gc-notebook-book'; stage.id = 'bookStage';
    stage.hidden = true;
    stage.innerHTML = '<img id="themeStudyImage" class="gc-notebook-book-still" alt="" draggable="false"><video id="themeOpeningVideo" class="gc-notebook-book-video" muted playsinline preload="metadata" aria-hidden="true"></video><div id="bookReadingSurface" aria-hidden="true"></div><button class="gc-notebook-book-skip" type="button"></button><span class="gc-notebook-book-label" aria-live="polite"></span>';
    host.prepend(stage);
    const still = stage.querySelector('.gc-notebook-book-still');
    const video = stage.querySelector('.gc-notebook-book-video');
    const skipButton = stage.querySelector('.gc-notebook-book-skip');
    const label = stage.querySelector('.gc-notebook-book-label');
    video.defaultMuted = true; video.volume = 0; video.disablePictureInPicture = true;
    let binding = null, phase = 'idle', disposed = false, token = 0, frameRequest = null, stallTimer = null, resumeOnVisible = false, assetTheme = null, handoff = false;
    const waiters = new Set(), mediaWaiters = new Set();
    const current = () => !!binding && !disposed && isCurrent(binding);
    const theme = () => normalizeTheme(getTheme?.());
    const locale = () => COPY[getLocale?.()] || COPY['zh-CN'];
    const asset = (name, chosenTheme = assetTheme || theme()) => `assets/${name}-${chosenTheme}.png`;
    const absoluteAsset = (path) => { try { return new URL(path, document.baseURI).href; } catch (_error) { return path; } };
    function setStill(role, chosenTheme = assetTheme || theme()) {
      stage.dataset.stillRole = role; delete stage.dataset.stillError;
      const path = absoluteAsset(asset(`theme-study/${role}`, chosenTheme));
      stage.dataset.stillSrc = path; still.src = path;
    }
    function source(chosenTheme = theme()) { return `assets/page-reveal/opening-${chosenTheme}.mp4`; }
    function clearTimer() { clearTimeout(stallTimer); stallTimer = null; }
    function cancelFrame() { if (frameRequest !== null) video.cancelVideoFrameCallback?.(frameRequest); frameRequest = null; }
    function settleWaiters(result) { for (const resolve of waiters) resolve(result); waiters.clear(); }
    function render() {
      const words = locale();
      document.body.dataset.materialStudy = 'true';
      document.body.dataset.bookPresentation = 'active';
      document.body.dataset.paperTheme = assetTheme || theme();
      document.body.dataset.bookPhase = phase;
      document.body.dataset.bookRenderer = 'cinematic';
      document.body.dataset.bookHandoff = String(handoff);
      stage.hidden = phase === 'idle';
      stage.dataset.phase = phase;
      stage.dataset.videoVisible = phase === 'opening' ? 'true' : 'false';
      stage.dataset.handoff = String(handoff);
      skipButton.hidden = phase !== 'opening'; skipButton.textContent = words.skip;
      label.textContent = phase === 'opening' ? words.label : '';
      game.inert = phase !== 'reading';
      if (game.inert) game.setAttribute('aria-hidden', 'true'); else game.removeAttribute('aria-hidden');
      document.body.classList.toggle('book-reading-ready', phase === 'reading' || handoff || document.body.dataset.bookProjection === 'true');
      safeCall(onPhaseChange, { binding, phase, theme: assetTheme || theme(), page: PAGE, handoff, readable: phase === 'reading' && current() });
    }
    function stopVideo(unload) {
      cancelFrame(); clearTimer(); video.pause();
      if (unload) { video.removeAttribute('src'); video.load(); }
    }
    function invalidatePending() {
      token += 1; resumeOnVisible = false;
      for (const abort of mediaWaiters) abort(); mediaWaiters.clear();
      cancelFrame(); clearTimer();
    }
    function reading({ focus = true, reason = 'finish' } = {}) {
      if (disposed || !binding) return false;
      invalidatePending();
      stopVideo(true); projection?.clear();
      phase = 'reading'; handoff = false; assetTheme = theme();
      setStill('reading', assetTheme);
      render();
      if (current()) { settleWaiters(true); safeCall(onReading, { binding, focus, reason, theme: theme(), page: PAGE }); }
      else settleWaiters(false);
      return current();
    }
    function fail(reason) { if (phase === 'opening' && current()) reading({ focus: false, reason }); }
    function armStall(localToken) {
      clearTimer();
      stallTimer = setTimeout(() => { if (localToken === token && phase === 'opening' && !document.hidden) fail('playback-stalled'); }, 12000);
    }
    function handoffAtSettledFrame(localToken) {
      if (localToken !== token || phase !== 'opening' || handoff) return;
      projection?.clear(); handoff = true; setStill('reading', assetTheme); render();
    }
    function watchFrames(localToken, openingTheme) {
      if (!video.requestVideoFrameCallback || frameRequest !== null || video.paused || phase !== 'opening') return;
      frameRequest = video.requestVideoFrameCallback((_now, metadata) => {
        frameRequest = null;
        if (disposed || localToken !== token || phase !== 'opening') return;
        if (!current() || theme() !== openingTheme) { reading({ focus: false, reason: 'binding-or-theme-changed' }); return; }
        armStall(localToken);
        if (!handoff) projection?.show(metadata.mediaTime);
        document.body.classList.toggle('book-reading-ready', handoff || document.body.dataset.bookProjection === 'true');
        if (metadata.mediaTime + 0.00001 >= SETTLED_AT) handoffAtSettledFrame(localToken);
        watchFrames(localToken, openingTheme);
      });
    }
    function cancel() {
      invalidatePending(); stopVideo(true); projection?.clear();
      if (binding) settleWaiters(false);
      phase = 'idle'; binding = null; assetTheme = null; handoff = false; still.removeAttribute('src'); delete stage.dataset.stillError; delete stage.dataset.stillRole; delete stage.dataset.stillSrc;
      delete stage.dataset.handoff; delete stage.dataset.videoVisible; delete stage.dataset.phase;
      stage.hidden = true; document.body.removeAttribute('data-book-projection');
      document.body.removeAttribute('data-book-phase'); document.body.removeAttribute('data-book-presentation');
      document.body.removeAttribute('data-paper-theme'); document.body.removeAttribute('data-material-study'); document.body.removeAttribute('data-book-renderer'); document.body.removeAttribute('data-book-handoff');
      document.body.classList.remove('book-reading-ready');
      game.inert = false; game.removeAttribute('aria-hidden');
      safeCall(onPhaseChange, { binding: null, phase: 'idle', readable: false });
      return true;
    }
    async function open(nextBinding = binding) {
      if (disposed || !samePageBinding(nextBinding, binding) || !current()) return false;
      if (phase === 'reading') return true;
      if (phase !== 'prepared') return false;
      const openingTheme = theme();
      if (reducedMotion?.matches || !projection || !video.requestVideoFrameCallback) return reading({ focus: false, reason: 'static-fallback' });
      const localToken = ++token;
      phase = 'opening'; handoff = false; assetTheme = openingTheme; setStill('cover', openingTheme); render();
      video.src = source(openingTheme); video.load();
      try {
        await new Promise((resolve, reject) => {
          const cleanup = () => { clearTimeout(timer); mediaWaiters.delete(abort); video.removeEventListener('loadedmetadata', done); video.removeEventListener('error', broken); };
          const done = () => { cleanup(); resolve(); };
          const broken = () => { cleanup(); reject(new Error('video load error')); };
          const expired = () => { cleanup(); reject(new Error('video metadata timeout')); };
          const abort = () => { cleanup(); reject(new Error('video load cancelled')); };
          const timer = setTimeout(expired, 6000);
          mediaWaiters.add(abort);
          video.addEventListener('loadedmetadata', done, { once: true }); video.addEventListener('error', broken, { once: true });
        });
        if (disposed || localToken !== token || phase !== 'opening' || !current() || theme() !== openingTheme) return false;
        video.currentTime = 0;
        // Metadata can arrive after the window was hidden.  Do not ask the
        // media subsystem to play in the background; visibilitychange owns
        // the first play in that case.
        if (document.hidden) { resumeOnVisible = true; return true; }
        armStall(localToken); await video.play();
        if (disposed || localToken !== token || phase !== 'opening' || !current() || theme() !== openingTheme) return false;
        if (document.hidden) { video.pause(); clearTimer(); resumeOnVisible = true; return true; }
        watchFrames(localToken, openingTheme); return true;
      } catch (_error) { if (localToken === token && phase === 'opening') fail('video-unavailable'); return false; }
    }
    function prepare(nextBinding) {
      if (disposed || !nextBinding) return false;
      cancel(); binding = nextBinding; phase = 'prepared'; handoff = false; assetTheme = theme(); setStill('cover', assetTheme); render();
      return current();
    }
    function whenReadable(expectedBinding = binding) {
      if (disposed || !samePageBinding(expectedBinding, binding) || !current()) return Promise.resolve(false);
      if (phase === 'reading') return Promise.resolve(true);
      return new Promise((resolve) => waiters.add(resolve));
    }
    function onVisibility() {
      if (document.hidden && phase === 'opening') { resumeOnVisible = true; stopVideo(false); }
      else if (!document.hidden && resumeOnVisible && phase === 'opening' && current()) {
        resumeOnVisible = false; const localToken = token; armStall(localToken);
        video.play().then(() => {
          if (localToken !== token || phase !== 'opening') return;
          if (document.hidden) { video.pause(); clearTimer(); resumeOnVisible = true; return; }
          watchFrames(localToken, assetTheme);
        }).catch(() => fail('resume-failed'));
      }
    }
    function rebindReading(nextBinding) {
      if (disposed || phase !== 'reading' || !binding || !nextBinding
        || binding.adventureId !== nextBinding.adventureId
        || binding.sessionMode !== nextBinding.sessionMode || !isCurrent(nextBinding)) return false;
      // A settings refresh may replace the session of the same visible story.
      // Keep its decoded paper and DOM in place; old delivery waiters remain stale.
      settleWaiters(false);
      binding = nextBinding;
      sync();
      return true;
    }
    function sync() {
      if (disposed || phase === 'idle') return false;
      const nextTheme = theme();
      if (nextTheme !== assetTheme) {
        if (phase === 'reading') { assetTheme = nextTheme; setStill('reading', assetTheme); render(); return true; }
        reading({ focus: false, reason: 'theme-changed' }); return true;
      }
      render(); return true;
    }
    video.addEventListener('ended', () => { if (phase === 'opening') reading({ focus: true, reason: handoff ? 'video-ended-after-handoff' : 'video-ended' }); });
    video.addEventListener('waiting', () => { if (phase === 'opening') armStall(token); });
    video.addEventListener('error', () => { if (phase === 'opening') fail('video-error'); });
    still.addEventListener('error', () => { if (phase !== 'idle' && stage.dataset.stillRole === 'reading' && (still.currentSrc || still.src) === stage.dataset.stillSrc) stage.dataset.stillError = 'true'; });
    still.addEventListener('load', () => { if ((still.currentSrc || still.src) === stage.dataset.stillSrc) delete stage.dataset.stillError; });
    skipButton.addEventListener('click', () => { if (phase === 'opening') reading({ focus: true, reason: 'skipped' }); });
    document.addEventListener('visibilitychange', onVisibility);
    return Object.freeze({
      prepare, open, finish: reading, skip: () => reading({ focus: true, reason: 'skipped' }), cancel, sync, rebindReading,
      whenReadable, getState: () => ({ phase, binding, theme: assetTheme, requestedTheme: theme(), handoff, page: PAGE, readable: phase === 'reading' && current(), projectionAvailable: !!projection, frameCallbackAvailable: !!video.requestVideoFrameCallback }),
      dispose() { if (disposed) return; cancel(); disposed = true; document.removeEventListener('visibilitychange', onVisibility); projection?.dispose(); stage.remove(); },
    });
  }
  window.GreyCrowNotebookBook = Object.freeze({ create, PAGE, SETTLED_FRAME, SETTLED_AT });
})();
