(() => {
  const menuView = document.querySelector("#menuView");
  const ambient = document.querySelector("#menuAmbient");
  const visual = document.querySelector("#menuAmbientVisual");
  const eye = document.querySelector("#menuAmbientEye");
  const flash = document.querySelector("#menuAmbientFlash");
  const farCanvas = document.querySelector("#menuAmbientFarRain");
  const nearCanvas = document.querySelector("#menuAmbientNearRain");

  if (!menuView || !ambient || !visual || !eye || !flash || !farCanvas || !nearCanvas) {
    return;
  }

  const farContext = farCanvas.getContext("2d");
  const nearContext = nearCanvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const backgroundSize = { width: 1672, height: 941 };
  const crowEyeSource = { x: 1120, y: 212 };

  let active = false;
  let farDrops = [];
  let nearDrops = [];
  let ripples = [];
  let frameId = 0;
  let lightningTimer = 0;
  let flashTimers = [];
  let lastTime = performance.now();
  let rippleClock = 0;

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function isMenuVisible() {
    return !menuView.classList.contains("hidden") && !document.hidden && !reducedMotion.matches;
  }

  function createDrop(layer, width, height) {
    const near = layer === "near";
    return {
      x: random(-width * 0.15, width * 1.04),
      y: random(-height, height),
      length: near ? random(36, 88) : random(11, 34),
      speed: near ? random(860, 1380) : random(360, 760),
      wind: near ? random(190, 280) : random(80, 158),
      alpha: near ? random(0.17, 0.44) : random(0.1, 0.34),
      lineWidth: near ? random(1.05, 2.05) : random(0.45, 1.12),
    };
  }

  function positionCrowEye() {
    const width = visual.clientWidth;
    const height = visual.clientHeight;
    const scale = Math.max(width / backgroundSize.width, height / backgroundSize.height);
    const renderedWidth = backgroundSize.width * scale;
    const renderedHeight = backgroundSize.height * scale;
    const x = (width - renderedWidth) / 2 + crowEyeSource.x * scale;
    const y = (height - renderedHeight) / 2 + crowEyeSource.y * scale;
    eye.style.left = `${x}px`;
    eye.style.top = `${y}px`;
  }

  function resizeCanvases() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = window.innerWidth;
    const height = window.innerHeight;

    [farCanvas, nearCanvas].forEach((canvas) => {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    });

    const area = width * height;
    farDrops = Array.from(
      { length: Math.min(280, Math.max(100, Math.floor(area / 6000))) },
      () => createDrop("far", width, height),
    );
    nearDrops = Array.from(
      { length: Math.min(72, Math.max(24, Math.floor(area / 23000))) },
      () => createDrop("near", width, height),
    );
    ripples = [];
    positionCrowEye();
  }

  function resetDrop(drop, layer, width) {
    Object.assign(drop, createDrop(layer, width, 1));
    drop.y = -drop.length - random(0, 140);
  }

  function drawDrops(context, drops, layer, delta, width, height) {
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";

    drops.forEach((drop) => {
      drop.x += drop.wind * delta;
      drop.y += drop.speed * delta;
      if (drop.y > height + drop.length || drop.x > width + drop.length) {
        resetDrop(drop, layer, width);
      }

      const tailX = drop.x - drop.wind * 0.05;
      const tailY = drop.y - drop.length;
      const gradient = context.createLinearGradient(drop.x, drop.y, tailX, tailY);
      gradient.addColorStop(0, `rgba(190, 224, 241, ${drop.alpha})`);
      gradient.addColorStop(1, "rgba(170, 210, 232, 0)");
      context.strokeStyle = gradient;
      context.lineWidth = drop.lineWidth;
      context.beginPath();
      context.moveTo(drop.x, drop.y);
      context.lineTo(tailX, tailY);
      context.stroke();
    });
  }

  function drawRipples(context, delta, width, height) {
    rippleClock += delta;
    if (rippleClock > random(0.34, 0.68) && ripples.length < 10) {
      rippleClock = 0;
      ripples.push({
        x: random(width * 0.34, width * 0.96),
        y: random(height * 0.7, height * 0.97),
        age: 0,
        life: random(0.9, 1.7),
        base: random(8, 20),
      });
    }

    ripples = ripples.filter((ripple) => {
      ripple.age += delta;
      const progress = ripple.age / ripple.life;
      if (progress >= 1) {
        return false;
      }
      context.strokeStyle = `rgba(144, 199, 226, ${(1 - progress) * 0.2})`;
      context.lineWidth = 1;
      context.beginPath();
      context.ellipse(
        ripple.x,
        ripple.y,
        ripple.base + progress * 44,
        (ripple.base + progress * 44) * 0.22,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
      return true;
    });
  }

  function render(now) {
    if (!active) {
      frameId = 0;
      return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    const delta = Math.min((now - lastTime) / 1000, 0.04);
    lastTime = now;
    drawDrops(farContext, farDrops, "far", delta, width, height);
    drawDrops(nearContext, nearDrops, "near", delta, width, height);
    drawRipples(nearContext, delta, width, height);
    frameId = window.requestAnimationFrame(render);
  }

  function clearCanvases() {
    farContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
    nearContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function clearFlashTimers() {
    flashTimers.forEach((timer) => window.clearTimeout(timer));
    flashTimers = [];
  }

  function setFlash(enabled, opacity = 0) {
    document.body.classList.toggle("menu-ambient-flashing", enabled && active);
    flash.style.opacity = active ? String(opacity) : "0";
  }

  function triggerLightning() {
    if (!active) {
      return;
    }
    clearFlashTimers();
    [
      [0, true, 0.34],
      [68, false, 0.04],
      [136, true, 0.7],
      [224, false, 0.08],
      [318, true, 0.22],
      [470, false, 0],
    ].forEach(([delay, enabled, opacity]) => {
      flashTimers.push(window.setTimeout(() => setFlash(enabled, opacity), delay));
    });
  }

  function scheduleLightning() {
    window.clearTimeout(lightningTimer);
    if (!active) {
      return;
    }
    lightningTimer = window.setTimeout(() => {
      triggerLightning();
      scheduleLightning();
    }, random(6200, 12400));
  }

  function start() {
    if (active) {
      return;
    }
    active = true;
    ambient.hidden = false;
    resizeCanvases();
    lastTime = performance.now();
    frameId = window.requestAnimationFrame(render);
    scheduleLightning();
  }

  function stop() {
    if (!active) {
      ambient.hidden = true;
      return;
    }
    active = false;
    ambient.hidden = true;
    window.cancelAnimationFrame(frameId);
    frameId = 0;
    window.clearTimeout(lightningTimer);
    clearFlashTimers();
    setFlash(false, 0);
    clearCanvases();
  }

  function sync() {
    if (isMenuVisible()) {
      start();
    } else {
      stop();
    }
  }

  const menuObserver = new MutationObserver(sync);
  menuObserver.observe(menuView, { attributes: true, attributeFilter: ["class"] });
  window.addEventListener("resize", () => {
    if (active) {
      resizeCanvases();
    }
  });
  document.addEventListener("visibilitychange", sync);
  reducedMotion.addEventListener("change", sync);
  window.addEventListener("pagehide", () => {
    stop();
    menuObserver.disconnect();
  }, { once: true });

  sync();
})();
