#!/usr/bin/env node
"use strict";

// Real desktop renderer and isolated committed synthetic content. This suite
// never calls a real model or voice provider and does not inspect player saves.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const chapterReadability = require("./session-desktop-chapter-readability");
const handlesPhase = (phase) => ["notebook_layout", "notebook_layout_before", "notebook_layout_display", "notebook_layout_feedback"].includes(phase);
const digest = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const fixturePath = (root) => path.join(root, "results", "notebook-layout-fixture.json");
const VIEWPORTS = [[1280, 720], [1600, 900], [1920, 1080], [2560, 1440], [3840, 2160]];
const RAIL = ["#storyNotebookStateButton", "#storyNotebookCharactersButton", "#storyNotebookModulesButton", "#storyNotebookChaptersButton", "#storyNotebookDirectoryButton"];

// The expressions run in the real loaded renderer. Geometry measures output,
// rather than reproducing CSS rules or fixing the design to old coordinates.
function readGeometry(selectors) {
  return `(() => { const selectors=${JSON.stringify(selectors)}; const rect = node => {
    const r=node.getBoundingClientRect(), style=getComputedStyle(node), hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,
      clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,
      visible:node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && r.width>0 && r.height>0,
      opacity:style.opacity,visibility:style.visibility,display:style.display,overflowX:style.overflowX,overflowY:style.overflowY,
      fontSize:parseFloat(style.fontSize),scaleX:node.offsetWidth?r.width/node.offsetWidth:1,
      centerHit:Boolean(hit && (node===hit || node.contains(hit))),text:node.innerText?.slice(0,180) || '',
      hitTarget:hit ? {tag:hit.tagName,id:hit.id,className:typeof hit.className==='string'?hit.className:null} : null,
      disabled:Boolean(node.disabled),inert:Boolean(node.closest('[inert]')) }; };
    return {viewport:{width:innerWidth,height:innerHeight,devicePixelRatio},document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},
      nodes:Object.fromEntries(selectors.map(selector=>[selector,document.querySelector(selector)?rect(document.querySelector(selector)):null]))}; })()`;
}

function assertVisibleWithin(sample, selector, { hit = false, overflow = false } = {}) {
  const node = sample.nodes[selector];
  assert.ok(node?.visible, `${selector} must be visible`);
  assert.ok(node.x >= -1 && node.y >= -1 && node.right <= sample.viewport.width + 1 && node.bottom <= sample.viewport.height + 1,
    `${selector} outside viewport: ${JSON.stringify(node)}`);
  if (hit) assert.ok(node.centerHit && !node.inert, `${selector} must have an unobstructed pointer target`);
  if (overflow) assert.ok(node.scrollWidth <= node.clientWidth + 1, `${selector} has horizontal overflow`);
  return node;
}

function assertSeparate(sample, first, second) {
  const a=sample.nodes[first], b=sample.nodes[second];
  assert.ok(a?.visible && b?.visible, `missing visible geometry: ${first}, ${second}`);
  const overlapX=Math.min(a.right,b.right)-Math.max(a.x,b.x), overlapY=Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y);
  assert.ok(overlapX <= 1 || overlapY <= 1, `${first} overlaps ${second}: ${overlapX} x ${overlapY}`);
}

async function setViewport(win, width, height, ui) {
  win.webContents.disableDeviceEmulation();
  win.setAspectRatio(0); win.setContentSize(width, height, false);
  await ui.evaluate(win, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const native = await ui.evaluate(win, "({width:innerWidth,height:innerHeight})");
  // Some window managers cap the native window to the attached display. A
  // Chromium viewport still exercises actual layout/raster output at 4K, but
  // is explicitly recorded as emulated, never called a physical 4K monitor test.
  let mode = "native-content-size";
  if (native.width !== width || native.height !== height) {
    mode = "electron-chromium-emulated-viewport";
    win.webContents.enableDeviceEmulation({screenPosition:"desktop",screenSize:{width,height},deviceScaleFactor:1,
      viewSize:{width,height},viewPosition:{x:0,y:0},scale:1});
  }
  await ui.waitFor(win, `${width} by ${height} layout viewport`, `innerWidth === ${width} && innerHeight === ${height}`);
  await ui.evaluate(win, "document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))");
  return { requested:{width,height},native,mode };
}

async function checkNarrationReplay(win,ui,longParagraph=false) {
  // Range rectangles measure the actual text lines, not their enclosing full
  // width box; either an inline replay button or a separate gutter is valid.
  const sample=await ui.evaluate(win,`(() => {
    const panel=document.querySelector('#narrationPanel');
    const hostLines=Array.from(panel.querySelectorAll('.narration-line.host'));
    const line=${longParagraph} ? hostLines.sort((a,b)=>b.textContent.length-a.textContent.length)[0] : hostLines.at(-1);
    if(${longParagraph} && line) line.scrollIntoView({block:'end',behavior:'instant'});
    const button=line?.querySelector('.tts-line-button'),text=line?.querySelector('.narration-text');
    if(!button||!text) return null;
    button.focus({preventScroll:true});
    const range=document.createRange();range.selectNodeContents(text);
    const plain=r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
    const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {button:plain(r),text:Array.from(range.getClientRects(),plain),hit:button===hit||button.contains(hit),label:button.getAttribute('aria-label'),
      paragraph:plain(line.getBoundingClientRect()),panel:plain(panel.getBoundingClientRect()),characters:text.textContent.length};
  })()`);
  assert.ok(sample?.label && sample.hit,"paragraph replay must have a named, reachable keyboard target");
  for(const line of sample.text) {
    const overlapX=Math.min(line.right,sample.button.right)-Math.max(line.x,sample.button.x);
    const overlapY=Math.min(line.bottom,sample.button.bottom)-Math.max(line.y,sample.button.y);
    assert.ok(overlapX<=1||overlapY<=1,`replay button covers narrative glyphs: ${overlapX} x ${overlapY}`);
  }
  return sample;
}

async function checkShortLabels(win,locale,ui) {
  const labels=await ui.evaluate(win,`(() => {
    const selectors=['#storyNotebookWorldTitle','#commandMenu .command-button:not(.hidden-command) span','.story-notebook-rail-navigation .notebook-tab-label'];
    const plain=r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
    return selectors.flatMap(selector=>Array.from(document.querySelectorAll(selector))).filter(node=>node.checkVisibility() && node.textContent.trim()).map(node=>{
      const container=node.closest('button') || node.closest('#storyNotebookWorldCard') || node;
      const range=document.createRange();range.selectNodeContents(node);
      const textLines=Array.from(range.getClientRects(),plain),words=[];
      // English short UI labels may wrap at spaces, never in the middle of a
      // word. Body prose is deliberately excluded from this assertion.
      if(${JSON.stringify(locale)}==='en-US' && node.id!=='storyNotebookWorldTitle') {
        for(const child of node.childNodes) if(child.nodeType===Node.TEXT_NODE) {
          for(const match of child.textContent.matchAll(/[A-Za-z]{3,}/g)) {
            const word=document.createRange();word.setStart(child,match.index);word.setEnd(child,match.index+match[0].length);
            words.push({text:match[0],lines:Array.from(word.getClientRects(),plain)});
          }
        }
      }
      return {id:node.id||container.id,text:node.textContent,container:plain(container.getBoundingClientRect()),
        overflowX:getComputedStyle(node).overflowX,overflowY:getComputedStyle(node).overflowY,
        bounds:plain(node.getBoundingClientRect()),clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,
        clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,textLines,words};
    });
  })()`);
  for(const label of labels) {
    assert.ok((label.overflowX==='visible' || label.scrollWidth<=label.clientWidth+1) &&
      (label.overflowY==='visible' || label.scrollHeight<=label.clientHeight+1),
      `short UI label is clipped: ${label.id}: ${JSON.stringify(label)}`);
    for(const line of label.textLines) assert.ok(line.x>=label.container.x-1 && line.right<=label.container.right+1 &&
      line.y>=label.container.y-1 && line.bottom<=label.container.bottom+1,`UI label exceeds its card/button: ${JSON.stringify(label)}`);
    for(const word of label.words) assert.ok(new Set(word.lines.map(line=>Math.round(line.y))).size<=1,
      `English short label splits a word: ${label.id}: ${word.text}`);
  }
  return labels;
}

async function checkHudText(win,ui) {
  const sample=await ui.evaluate(win,`(() => {
    const strip=document.querySelector('.notebook-status-strip');
    const plain=r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
    const selectors=['#storyNotebookWorldCard small','#storyNotebookWorldTitle',
      '#stateGrid > [data-state-key][data-state-role]','.host-status .meter-label','#turnStatus',
      '#contextUsagePercent','#storyNotebookLive small'];
    const fields=selectors.flatMap(selector=>Array.from(document.querySelectorAll(selector))).filter(node=>
      node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && node.textContent.trim()).map(node=>{
      const card=node.closest('.story-notebook-world-card,.state-card,.context-side-card') || document.querySelector('.context-side-card');
      const style=getComputedStyle(node),range=document.createRange();range.selectNodeContents(node);
      return {id:node.id||(node.dataset.stateKey?node.dataset.stateKey+'-'+node.dataset.stateRole:node.tagName+'.'+node.className),
        text:node.textContent,bounds:plain(node.getBoundingClientRect()),card:plain(card.getBoundingClientRect()),
        overflowX:style.overflowX,overflowY:style.overflowY,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,
        clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,glyphs:Array.from(range.getClientRects(),plain)};
    });
    return {logicalHeaderHeight:strip.offsetHeight,renderedHeader:plain(strip.getBoundingClientRect()),
      stageScale:strip.getBoundingClientRect().height/strip.offsetHeight,fields};
  })()`);
  // The game uses a uniformly scaled 1600 x 900 stage. Measure its logical HUD
  // height before that transform, so a real 4K viewport is not mistaken for an
  // oversized header merely because it has more device pixels.
  assert.ok(sample.logicalHeaderHeight>0 && sample.logicalHeaderHeight<=120,
    `HUD logical height exceeds 120 px: ${JSON.stringify(sample)}`);
  assert.ok(sample.fields.length>=13,'HUD must expose world, location, state, turn/day and host labels/values');
  for(const id of ['storyNotebookWorldTitle','location-label','location-value','player-label','player-value',
    'turn-label','turn-value','gameDay-label','gameDay-value','turnStatus','contextUsagePercent']) {
    assert.ok(sample.fields.some(field=>field.id===id),`required HUD field must be visible: ${id}`);
  }
  for(const field of sample.fields) {
    assert.ok((field.overflowX==='visible'||field.scrollWidth<=field.clientWidth+1) &&
      (field.overflowY==='visible'||field.scrollHeight<=field.clientHeight+1),`HUD field clips text: ${JSON.stringify(field)}`);
    for(const glyph of field.glyphs) assert.ok(glyph.x>=field.card.x-1 && glyph.right<=field.card.right+1 &&
      glyph.y>=field.card.y-1 && glyph.bottom<=field.card.bottom+1,`HUD glyph leaves its card: ${JSON.stringify(field)}`);
  }
  for(let i=0;i<sample.fields.length;i++) for(let j=i+1;j<sample.fields.length;j++) {
    const a=sample.fields[i],b=sample.fields[j];
    for(const first of a.glyphs) for(const second of b.glyphs) assert.ok(
      Math.min(first.right,second.right)-Math.max(first.x,second.x)<=1 ||
      Math.min(first.bottom,second.bottom)-Math.max(first.y,second.y)<=1,
      `HUD glyphs overlap: ${JSON.stringify({first:a,second:b})}`);
  }
  return sample;
}

async function checkHostText(win,ui) {
  const sample=await ui.evaluate(win,readGeometry(['#turnStatus','#storyNotebookHostStatus']));
  const text=assertVisibleWithin(sample,'#turnStatus',{overflow:true});
  const host=assertVisibleWithin(sample,'#storyNotebookHostStatus');
  assert.ok(text.overflowY==='visible' || text.scrollHeight<=text.clientHeight+1,`host state text clips vertically: ${JSON.stringify(text)}`);
  assert.ok(text.x>=host.x-1 && text.right<=host.right+1 && text.y>=host.y-1 && text.bottom<=host.bottom+1,
    `host state text leaves its card: ${JSON.stringify(sample)}`);
  const lines=await ui.evaluate(win,"(() => {const range=document.createRange();range.selectNodeContents(document.querySelector('#turnStatus'));return Array.from(range.getClientRects(),r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom}));})()");
  for(const line of lines) assert.ok(line.x>=host.x-1 && line.right<=host.right+1 && line.y>=host.y-1 && line.bottom<=host.bottom+1,
    `host state glyphs leave their card: ${JSON.stringify({line,host})}`);
  sample.textLines=lines;
  sample.hud=await checkHudText(win,ui);
  return sample;
}

async function checkIdleVariants(win,ui) {
  const samples=[];
  for(const key of ['game.turn.waiting','game.turn.waitingAlt1','game.turn.waitingAlt2','game.turn.waitingAlt3','game.turn.waitingAlt4']) {
    await ui.evaluate(win,`(() => {ui.storyNotebookHostStatus.dataset.hostPhase='idle';state.hostIdleLineKey=${JSON.stringify(key)};renderTurnStatus();})()`);
    samples.push({key,sample:await checkHostText(win,ui)});
  }
  return samples;
}

async function checkSystemHostVariants(win,ui,onSample=null) {
  const samples=[];
  await ui.evaluate(win,"window.__notebookHostFixtureOriginal={finale:state.storyFinale,keyVerified:state.keyVerified}");
  try {
    for(const phase of ['closed','finalizing','recovery_required','not_ready']) {
      await ui.evaluate(win,`(() => {const original=window.__notebookHostFixtureOriginal;
        state.keyVerified=${JSON.stringify(phase)}==='not_ready'?false:original.keyVerified;
        state.storyFinale=${JSON.stringify(phase)}==='not_ready'?original.finale:{projection:{phase:${JSON.stringify(phase)}}};renderTurnStatus();})()`);
      const sample=await checkHostText(win,ui);
      samples.push({phase,sample});
      if(onSample) await onSample(phase,sample);
    }
  } finally {
    await ui.evaluate(win,"(() => {const original=window.__notebookHostFixtureOriginal;state.storyFinale=original.finale;state.keyVerified=original.keyVerified;delete window.__notebookHostFixtureOriginal;renderTurnStatus();})()");
  }
  return samples;
}

function recordScreenshotSizes(evidence) {
  return evidence.screenshots.map(file=>{
    const buffer=fs.readFileSync(file);
    assert.equal(buffer.subarray(1,4).toString(),"PNG","capture must produce a PNG");
    return {file,width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
  });
}

async function runCoordinator({ runPhase, createSettingsFixture, rootEnv, before = false, display = false, feedback = false }) {
  const results = [];
  const selectedLocale=process.env.GREY_CROW_NOTEBOOK_LAYOUT_LOCALE;
  assert.ok(!selectedLocale || ['zh-CN','en-US','ja-JP'].includes(selectedLocale),'unsupported notebook test locale');
  for (const locale of before || display || feedback ? ["zh-CN"] : selectedLocale ? [selectedLocale] : ["zh-CN", "en-US", "ja-JP"]) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grey-crow-session-desktop-")));
    for (const name of ["results", "data", "provider-check", "electron-user-data", "home", "tmp", "kokoro-fixture"]) fs.mkdirSync(path.join(root, name));
    const env = {};
    for (const name of ["PATH", "HOME", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY"]) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    Object.assign(env, { TMPDIR: path.join(root, "tmp"), XDG_CONFIG_HOME: path.join(root, "home", "config"),
      XDG_CACHE_HOME: path.join(root, "home", "cache"), [rootEnv]: root,
      GREY_CROW_DATA_ROOT: path.join(root, "data"), GREY_CROW_PROVIDER_CHECK_ROOT: path.join(root, "provider-check"),
      GREY_CROW_KOKORO_ORIGINAL_RUNTIME_ROOT: path.join(root, "kokoro-fixture") });
    const fixture = await chapterReadability.createFixture(root, locale, createSettingsFixture);
    fixture.presentationDemo=process.env.GREY_CROW_NOTEBOOK_LAYOUT_DEMO==='1';
    fixture.railBadgeMode=process.env.GREY_CROW_NOTEBOOK_RAIL_BADGE || '';
    fixture.sources = Object.fromEntries(["renderer/app.js", "renderer/index.html", "renderer/styles.css", "renderer/notebook.css", "renderer/notebook-book.js", "renderer/notebook-book.css", "renderer/notebook-physical-reading.css", "renderer/notebook-stage-layout.css", "window-modes.js",
      "renderer/notebook-cinematic-reading.css", "renderer/notebook-theme-study.css", "renderer/notebook-object-icons.js", "renderer/notebook-object-icons.css",
      "renderer/locales/zh-CN.js", "renderer/locales/en-US.js", "renderer/locales/ja-JP.js"]
      .map((file) => [file, digest(path.join(__dirname, "..", file))]));
    fs.writeFileSync(fixturePath(root), JSON.stringify(fixture, null, 2));
    process.stdout.write(`Notebook layout ${locale} artifacts: ${root}\n`);
    const phase = before ? "notebook_layout_before" : display ? "notebook_layout_display" : feedback ? "notebook_layout_feedback" : "notebook_layout";
    const result = await runPhase(require("electron"), phase, env);
    assert.equal(digest(fixture.databasePath), fixture.databaseHash, "layout inspection must preserve the synthetic SQLite file");
    results.push({ locale, root, result });
    fs.writeFileSync(path.join(root,"results","notebook-layout-result.json"), JSON.stringify(result,null,2));
  }
  process.stdout.write(JSON.stringify({ ok: true, suite: before ? "notebook-layout-before" : display ? "notebook-layout-display" : feedback ? "notebook-layout-feedback" : "notebook-layout",
    results:results.map(({locale,root,result})=>({locale,root,revision:result.revision,layoutChecks:result.layoutChecks?.length || 0,
      screenshots:result.screenshots.length,modelCalls:result.modelCalls,chapterModelCalls:result.chapterModelCalls,ttsRequests:result.ttsRequests,
      evidence:path.join(root,"results","notebook-layout-result.json")})),
    boundary: "Synthetic committed content, real Electron rendering and interaction. No real model, voice listening, native-language reading or release acceptance." }, null, 2) + "\n");
}

async function runPhase(win, evidence, root, ui) {
  const { click, change, evaluate, waitFor, screenshot, connectSyntheticModel, waitSettingsRevision } = ui;
  const fixture = JSON.parse(fs.readFileSync(fixturePath(root), "utf8"));
  await click(win, "#menuLanguageToggle");
  await click(win, { "zh-CN": "#mainMenuLocaleZh", "en-US": "#mainMenuLocaleEn", "ja-JP": "#mainMenuLocaleJa" }[fixture.locale]);
  await waitFor(win, "notebook UI locale", `document.documentElement.lang === ${JSON.stringify(fixture.locale)} && document.querySelector('#localeTransitionCurtain').dataset.phase === 'idle'`);
  await connectSyntheticModel(win);
  await click(win, "#closeSettingsButton");
  await waitFor(win, "notebook layout is the only active layout", "!state.settingsSaving && !state.settingsDirty && state.gameUiLayout==='story-notebook-v1' && document.querySelector('#gameView').dataset.uiLayout==='story-notebook-v1' && !document.querySelector('#uiArtStyleToggleButton')");
  win.setAspectRatio(0); win.setContentSize(1600, 900, false); win.center();
  await click(win, "#continueGameButton");
  await waitFor(win, "notebook story bound", `state.activeSaveId===${JSON.stringify(fixture.adventureId)} && !ui.gameView.classList.contains("hidden")`);
  await require("./check-notebook-opening").runOpeningChecks(win,evidence,root,ui);
  await waitSettingsRevision(win, fixture.adventureId, fixture.revision, fixture.strings.short);
  win.setAspectRatio(0); win.setContentSize(1600, 900, false); win.center();
  await waitFor(win, "notebook baseline viewport", "innerWidth === 1600 && innerHeight === 900");
  if (evidence.phase === "notebook_layout") await checkNotebookRefinements(win,evidence,ui);
  await evaluate(win, "document.querySelector('#narrationPanel').scrollTop = document.querySelector('#narrationPanel').scrollHeight");
  await screenshot(win, root, `${evidence.phase}-${fixture.locale}-1600x900`, evidence);
  if (evidence.phase === "notebook_layout") await captureReadingThemePair(win, evidence, root, fixture, ui);
  if (evidence.phase === "notebook_layout_feedback") {
    await verifyFeedbackDrawer(win,evidence,root,ui);
  }
  else if (evidence.phase === "notebook_layout_display") {
    await require('./check-notebook-speech-hold').run(win,evidence,root,ui);
    await checkSpeechInputPresentation(win,evidence,root,fixture,ui);
    await checkDisplayModes(win,evidence,root,fixture,ui);
  }
  else if (evidence.phase !== "notebook_layout_before") {
    evidence.layoutChecks = [];
    evidence.stateFixtures = "Waiting/error/speech phases below are injected only into renderer presentation; no provider, audio or failed runtime transaction is being asserted.";
    for (const [width,height] of VIEWPORTS) {
      const viewport = await setViewport(win,width,height,ui);
      await evaluate(win, "document.querySelector('#narrationPanel').scrollTop = document.querySelector('#narrationPanel').scrollHeight");
      const selectors = ["#narrationPanel", ".narration-panel", "#turnForm", "#turnInput", "#sendTurnButton", "#commandMenu", "#storyNotebookHostStatus",
        "#ttsPlaybackToggleButton", "#gameSettingsButton", ...RAIL];
      const sample = await evaluate(win,readGeometry(selectors));
      evidence.lastGeometry={scenario:"base",viewport,sample};
      assert.ok(sample.document.width <= width+1 && sample.document.height <= height+1,"game must not make the whole document scroll");
      for (const selector of ["#narrationPanel","#turnForm","#turnInput","#sendTurnButton","#gameSettingsButton",...RAIL]) {
        assertVisibleWithin(sample,selector,{hit:selector!=="#turnForm" && selector!=="#narrationPanel",overflow:selector==="#narrationPanel" || selector==="#turnInput"});
      }
      assertSeparate(sample,".narration-panel","#turnForm");
      assertSeparate(sample,"#turnInput","#sendTurnButton");
      assertSeparate(sample,"#turnInput","#commandMenu");
      for (let i=0;i<RAIL.length;i++) for (let j=i+1;j<RAIL.length;j++) assertSeparate(sample,RAIL[i],RAIL[j]);
      for (const rail of RAIL) assertSeparate(sample,rail,"#narrationPanel");
      const replay=await checkNarrationReplay(win,ui);
      const labels=await checkShortLabels(win,fixture.locale,ui);
      const hud=await checkHudText(win,ui);
      await screenshot(win,root,`notebook-${fixture.locale}-${width}x${height}`,evidence);
      const captured=recordScreenshotSizes(evidence).at(-1);
      assert.equal(captured.width,width,"screenshot must cover the entire requested viewport width");
      assert.equal(captured.height,height,"screenshot must cover the entire requested viewport height");
      evidence.layoutChecks.push({viewport,textSize:"medium",sample,replay,labels,hud,captured});
    }
    await setViewport(win,1280,720,ui);
    await checkReadingAndPanels(win,evidence,root,fixture,ui);
    await checkPresentationStates(win,evidence,root,fixture,ui);
    await checkLargeText(win,evidence,root,fixture,ui);
  }
  if(fixture.presentationDemo) {
    const paragraphs=[
      ['host','雨水沿着窗沿滴落，楼道里只留着一盏暗灯。'],
      ['host','陈姨隔着门说，水壶还在老地方。她的声音很轻，几乎被雨声盖住。'],
      ['host','你在门前停了一会儿，听着楼下断断续续的动静。'],
      ['player','我放轻脚步，询问她是否听见楼下的声音。'],
      ['host','门里静了片刻。“听见了。”陈姨轻声回答，随后又停了下来。']
    ];
    await evaluate(win,`(() => {ui.narrationPanel.replaceChildren();
      for(const [kind,content] of ${JSON.stringify(paragraphs)}) appendNarration(kind,content,{autoSpeak:false,animate:false});
      ui.narrationPanel.scrollTop=0;document.activeElement?.blur();})()`);
    await evaluate(win,"document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))");
    await screenshot(win,root,'notebook-zh-CN-authored-visual-demo',evidence);
    evidence.presentationDemo={kind:'Prewritten Chinese visual demonstration based on user scene guidance, not runtime provider output or canonical story evidence',
      mutation:'Only current renderer DOM narrative replaced with normal appendNarration elements; no runtime commands or database writes',paragraphs};
  }
  if(fixture.railBadgeMode) await checkRailBadge(win,evidence,root,fixture,ui);
  for (const key of ["modelCalls", "chapterModelCalls", "ttsRequests", "audioGenerations"]) assert.equal(evidence[key], 0, key);
  return { ...evidence, screenshotSizes:recordScreenshotSizes(evidence), sources:fixture.sources, adventureId: fixture.adventureId, revision: fixture.revision,
    visualAcceptance:"Numerical bounds, hit targets and scroll/focus assertions only. Screenshots still require human reading, visual hierarchy and art review." };
}

async function captureReadingThemePair(win, evidence, root, fixture, ui) {
  const { click, change, evaluate, waitFor, screenshot } = ui;
  const light = await evaluate(win, "document.querySelector('#gameView').dataset.notebookTheme");
  assert.equal(light, "light", "the notebook fixture must start on light reading paper");
  await screenshot(win, root, `notebook-${fixture.locale}-1600x900-reading-light`, evidence);
  await click(win, "#gameSettingsButton");
  await click(win, "#settingsTabDisplay");
  await change(win, "#storyNotebookThemeSelect", "dark");
  await click(win, "#closeSettingsButton");
  await waitFor(win, "dark reading paper persisted", "!ui.settingsDialog.open && !state.settingsSaving && !state.settingsDirty && document.querySelector('#gameView').dataset.notebookTheme==='dark'");
  const dark = await evaluate(win, "document.querySelector('#gameView').dataset.notebookTheme");
  assert.equal(dark, "dark", "the saved dark reading-paper selection must render on the live game view");
  await evaluate(win, "document.querySelector('#themeStudyImage').decode()");
  // DOM/RAF completion need not refresh the last captured Chromium surface.
  // Ask the test window to repaint after the native modal leaves the top layer.
  win.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 100));
  await evaluate(win, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const closedDialog = await evaluate(win, "({open:ui.settingsDialog.open,display:getComputedStyle(ui.settingsDialog).display,hitDialog:document.elementFromPoint(innerWidth/2,innerHeight/2)?.closest('dialog')?.id || null})");
  assert.equal(closedDialog.open, false);
  assert.equal(closedDialog.display, 'none');
  assert.equal(closedDialog.hitDialog, null);
  await screenshot(win, root, `notebook-${fixture.locale}-1600x900-reading-dark`, evidence);
  evidence.readingThemes = { light, dark, closedDialog, source: "real display preference saved into the isolated synthetic fixture" };
}

async function readRailBadge(win,ui) {
  return ui.evaluate(win,`(() => {
    const nav=document.querySelector('.story-notebook-rail-navigation'),button=document.querySelector('#storyNotebookModulesButton'),badge=document.querySelector('#storyNotebookModuleCount');
    const plain=r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
    const rect=badge.getBoundingClientRect(),scale=button.getBoundingClientRect().width/button.offsetWidth,style=getComputedStyle(nav);
    const positions={left:[rect.left+scale,rect.top+rect.height/2],right:[rect.right-scale,rect.top+rect.height/2],
      top:[rect.left+rect.width/2,rect.top+scale],bottom:[rect.left+rect.width/2,rect.bottom-scale]};
    return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},nav:plain(nav.getBoundingClientRect()),
      navOverflow:{x:style.overflowX,y:style.overflowY},button:plain(button.getBoundingClientRect()),badge:plain(rect),
      count:badge.textContent,hidden:badge.hidden,visible:badge.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),
      hovered:button.matches(':hover'),active:button.classList.contains('is-active'),scale,
      points:Object.fromEntries(Object.entries(positions).map(([name,[x,y]])=>{const hit=document.elementFromPoint(x,y);
        return [name,{x,y,hit:Boolean(hit&&(hit===button||button.contains(hit))),target:hit?{tag:hit.tagName,id:hit.id}:null}];}))};
  })()`);
}

async function captureRailBadge(win,evidence,root,name,sample) {
  const scale=sample.scale;
  const x=Math.max(0,Math.floor(sample.button.x-16*scale)),y=Math.max(0,Math.floor(Math.min(sample.button.y,sample.badge.y)-14*scale));
  const right=Math.min(sample.viewport.width,Math.ceil(Math.max(sample.button.right,sample.badge.right)+20*scale));
  const bottom=Math.min(sample.viewport.height,Math.ceil(sample.button.bottom+16*scale));
  const region={x,y,width:right-x,height:bottom-y};
  const capture=await win.webContents.capturePage(region),file=path.join(root,'results',name+'.png');
  fs.writeFileSync(file,capture.toPNG());evidence.screenshots.push(file);
  return {file,region,captureMethod:'Electron capturePage native region, no image resampling'};
}

async function checkRailBadge(win,evidence,root,fixture,ui) {
  assert.ok(['before','after'].includes(fixture.railBadgeMode),'unsupported rail badge check mode');
  win.webContents.sendInputEvent({type:'mouseMove',x:10,y:10});
  const sample=await readRailBadge(win,ui);
  if(fixture.railBadgeMode==='before') {
    assert.equal(sample.count,'2','baseline must use the real isolated fixture count');
    assert.ok(sample.visible && !sample.points.right.hit,'baseline must reproduce the clipped badge right edge');
    const screenshot=await captureRailBadge(win,evidence,root,'rail-badge-before-detail',sample);
    evidence.railBadge={mode:'before',reproducedRightEdgeClipping:true,sample,screenshot};
    return;
  }
  const checks=[];
  const presentCount=async count=>ui.evaluate(win,`(() => {
    const supported=state.skillPanelSupported,panels=state.skillPanels;
    try {state.skillPanelSupported=true;state.skillPanels=new Array(${count});renderStoryNotebookModuleCount();}
    finally {state.skillPanelSupported=supported;state.skillPanels=panels;}
  })()`);
  const assertBadge=(value,count)=>{
    assert.equal(value.count,String(count));
    if(count===0) assert.ok(value.hidden&&!value.visible,'zero count retains the existing hidden badge behavior');
    else {
      assert.ok(value.visible&&!value.hidden,'positive badge must be visible');
      for(const [edge,point] of Object.entries(value.points)) assert.ok(point.hit,
        `badge ${count} ${edge} edge must reach its badge/button: ${JSON.stringify(value)}`);
    }
  };
  for(const [width,height] of [[1280,720],[1600,900],[3840,2160]]) {
    await setViewport(win,width,height,ui);
    for(const count of [0,2,12]) {
      await presentCount(count);
      win.webContents.sendInputEvent({type:'mouseMove',x:10,y:10});
      await ui.waitFor(win,'module button is not hovered',"!document.querySelector('#storyNotebookModulesButton').matches(':hover')");
      const normal=await readRailBadge(win,ui);assertBadge(normal,count);assert.equal(normal.active,false);
      if(width===1600 && count>0) await captureRailBadge(win,evidence,root,`rail-badge-after-${count}-normal`,normal);
      win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(normal.button.x+normal.button.width/2),y:Math.round(normal.button.y+normal.button.height/2)});
      await ui.waitFor(win,'module hover is active',"document.querySelector('#storyNotebookModulesButton').matches(':hover')");
      const hover=await readRailBadge(win,ui);assertBadge(hover,count);
      const point=count>0?hover.points.right:{x:hover.button.x+hover.button.width/2,y:hover.button.y+hover.button.height/2};
      for(const type of ['mouseMove','mouseDown','mouseUp']) win.webContents.sendInputEvent({type,x:Math.round(point.x),y:Math.round(point.y),
        ...(type==='mouseMove'?{}:{button:'left',clickCount:1})});
      await ui.waitFor(win,'clicking badge opens modules',"state.notebookDrawerPanel==='modules' && document.querySelector('#storyNotebookDrawer').classList.contains('is-open')");
      await presentCount(count);
      const selected=await readRailBadge(win,ui);assertBadge(selected,count);assert.equal(selected.active,true);
      if(width===1600 && count===2) await captureRailBadge(win,evidence,root,'rail-badge-after-2-selected',selected);
      for(const [panel,selector] of [['characters',RAIL[1]],['chapters',RAIL[3]]]) {
        await ui.click(win,selector);
        await ui.waitFor(win,`neighbor ${panel} opens`,`state.notebookDrawerPanel===${JSON.stringify(panel)}`);
      }
      await ui.click(win,'#storyNotebookDrawerCloseButton');
      checks.push({width,height,count,normal,hover,selected,clickPoint:point,openedModules:true,neighborSwitches:['characters','chapters']});
    }
  }
  await ui.evaluate(win,'renderStoryNotebookModuleCount()');
  evidence.railBadge={mode:'after',checks,
    fixtureBoundary:'Counts 0/2/12 are presentation probes through the real count renderer, with source arrays restored before clicks. Existing zero-count hiding is preserved. Runtime records stay the isolated original fixture.',
    interactionBoundary:'Nonzero badge right-edge clicks use native Electron mouse events; captures use native regions without resampling.'};
}

async function checkReadingAndPanels(win,evidence,root,fixture,ui) {
  const {evaluate,waitFor,click,screenshot}=ui;
  win.show(); win.focus(); win.webContents.focus();
  evidence.longParagraphReplay=await checkNarrationReplay(win,ui,true);
  assert.ok(evidence.longParagraphReplay.paragraph.height>evidence.longParagraphReplay.panel.height,
    'long narrative replay fixture must exceed the visible reading area');
  await screenshot(win,root,`notebook-${fixture.locale}-1280-long-paragraph-replay`,evidence);
  await evaluate(win,"(() => {const panel=document.querySelector('#narrationPanel');panel.scrollTop=panel.scrollHeight;panel.focus({preventScroll:true});})()");
  await waitFor(win,"narrative owns native keyboard focus","document.hasFocus() && document.activeElement===document.querySelector('#narrationPanel')");
  const scrollBefore=await evaluate(win,"document.querySelector('#narrationPanel').scrollTop");
  assert.ok(scrollBefore>0,"synthetic long narrative must require vertical scrolling");
  win.webContents.sendInputEvent({type:"keyDown",keyCode:"PageUp"});
  win.webContents.sendInputEvent({type:"keyUp",keyCode:"PageUp"});
  await waitFor(win,"PageUp scrolls the focused narrative",`document.querySelector('#narrationPanel').scrollTop < ${scrollBefore-1}`);
  await evaluate(win,"new Promise(resolve=>setTimeout(resolve,300))");
  const anchor=await evaluate(win,"document.querySelector('#narrationPanel').scrollTop");
  evidence.reading={keyboardPageUp:true,scrollBefore,anchor,panels:[]};
  for (const [panel,button] of [["state",RAIL[0]],["characters",RAIL[1]],["modules",RAIL[2]],["directory",RAIL[4]],["chapters",RAIL[3]]]) {
    if (await evaluate(win, "state.notebookDrawerPanel") !== panel) await click(win,button);
    await waitFor(win,`${panel} index visible`,`state.notebookDrawerPanel===${JSON.stringify(panel)} && document.querySelector('#storyNotebookDrawer').classList.contains('is-open')`);
    await waitFor(win,`${panel} drawer transition finished`,"document.querySelector('#storyNotebookDrawer').checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && Number(getComputedStyle(document.querySelector('#storyNotebookDrawer')).opacity) >= 0.99");
    if (panel==="characters") {
      await waitFor(win,"character directory read","Boolean(document.querySelector('#storyNotebookDrawerBody .story-notebook-panel-record')) && !state.skillPanelViewBusy");
      await click(win,"#storyNotebookDrawerBody .story-notebook-panel-record");
      await waitFor(win,"character detail read","state.notebookDrawerView==='panel-item-detail' && Boolean(state.activeSkillPanelProjection?.detail) && !state.skillPanelViewBusy");
    }
    if (panel==="directory") await waitFor(win,"directory actions read","document.querySelectorAll('#storyNotebookDrawerBody [data-story-notebook-directory-target]').length===5");
    if (panel==="chapters") await waitFor(win,"committed chapters read","document.querySelectorAll('#storyNotebookDrawerBody article.chapter-card').length===12 && !state.chapterReadBusy");
    const sample=await evaluate(win,readGeometry(["#storyNotebookDrawer","#storyNotebookDrawerBody","#storyNotebookDrawerCloseButton",...RAIL]));
    evidence.lastGeometry={scenario:panel,sample};
    for(const selector of ["#storyNotebookDrawer","#storyNotebookDrawerBody","#storyNotebookDrawerCloseButton",...RAIL]) {
      assertVisibleWithin(sample,selector,{hit:selector.endsWith("Button"),overflow:selector==="#storyNotebookDrawerBody"});
    }
    for(const rail of RAIL) assertSeparate(sample,rail,"#storyNotebookDrawer");
    const scroll=await evaluate(win,"document.querySelector('#narrationPanel').scrollTop");
    assert.ok(Math.abs(scroll-anchor)<=1,`${panel} must preserve narrative reading position: ${anchor} -> ${scroll}`);
    await screenshot(win,root,`notebook-${fixture.locale}-1280-${panel}`,evidence);
    evidence.reading.panels.push({panel,scroll,sample});
    if (panel === "directory") {
      await click(win,"#storyNotebookDrawerBody [data-story-notebook-directory-target='storyNotebookChaptersButton']");
      await waitFor(win,"directory opens existing chapter index","state.notebookDrawerPanel==='chapters' && document.querySelector('#storyNotebookDrawer').classList.contains('is-open')");
    }
  }
  await click(win,"#storyNotebookDrawerCloseButton");
  await waitFor(win,"drawer closed","!document.querySelector('#storyNotebookDrawer').classList.contains('is-open')");
  await waitFor(win,"close returns keyboard focus to active index","document.activeElement.id==='storyNotebookChaptersButton'");
  const draft=fixture.strings.thread;
  await ui.change(win,"#turnInput",draft,"input");
  await evaluate(win,"document.querySelector('#turnInput').focus()");
  assert.equal(await evaluate(win,"document.activeElement.id"),"turnInput");
  assert.equal(await evaluate(win,"document.querySelector('#turnInput').value"),draft);
}

async function checkPresentationStates(win,evidence,root,fixture,ui) {
  const {evaluate,screenshot,click,waitFor}=ui;
  evidence.presentationChecks=[];
  evidence.idleTextChecks=await checkIdleVariants(win,ui);
  for(const phase of ["generating","playing","paused","error"]) {
    await evaluate(win,`(() => {state.currentAudio=${["playing","paused"].includes(phase)?"{pause(){},play(){return Promise.resolve();}}":"null"};setTtsPlaybackPhase(${JSON.stringify(phase)});})()`);
    const sample=await evaluate(win,readGeometry(["#ttsPlaybackToggleButton","#storyNotebookHostStatus","#turnForm","#sendTurnButton","#turnInput"]));
    assertVisibleWithin(sample,"#ttsPlaybackToggleButton",{hit:true});
    assertSeparate(sample,"#ttsPlaybackToggleButton","#turnInput");
    assertSeparate(sample,"#ttsPlaybackToggleButton","#sendTurnButton");
    if(phase==="playing") {
      await click(win,"#ttsPlaybackToggleButton");
      await waitFor(win,"synthetic audio sink pauses through real control","state.ttsPlaybackPhase==='paused'");
    }
    await screenshot(win,root,`notebook-${fixture.locale}-1280-speech-${phase}`,evidence);
    evidence.presentationChecks.push({phase,sample});
  }
  await evaluate(win,"(() => {state.currentAudio=null;setTtsPlaybackPhase('idle');setBusy(true,t('game.turn.defaultBusy'));state.busyStartedAt=Date.now()-125000;renderTurnStatus();})()");
  let sample=await evaluate(win,readGeometry(["#storyNotebookHostStatus","#turnStatus","#turnInput","#sendTurnButton"]));
  assertVisibleWithin(sample,"#storyNotebookHostStatus");
  assertVisibleWithin(sample,"#turnStatus",{overflow:true});
  const host=await checkHostText(win,ui);
  assertSeparate(sample,"#storyNotebookHostStatus","#turnInput");
  assert.ok(sample.nodes["#turnInput"].disabled && sample.nodes["#sendTurnButton"].disabled,"waiting locks submission");
  await screenshot(win,root,`notebook-${fixture.locale}-1280-waiting`,evidence);
  evidence.presentationChecks.push({phase:"waiting",sample,host});
  await evaluate(win,"setBusy(false)");
  evidence.systemHostTextChecks=await checkSystemHostVariants(win,ui,async(phase)=>{
    await screenshot(win,root,`notebook-${fixture.locale}-1280-system-${phase}`,evidence);
  });
  await evaluate(win,"(() => {setBusy(false);ui.narrationPanel.scrollTop=0;})()");
  const errorAnchor=await evaluate(win,"ui.narrationPanel.scrollTop");
  await evaluate(win,"appendNarration('warning',t('game.turn.failure.retry',{action:t('game.notebook.continueStory')}),{autoSpeak:false,animate:false,turnFailure:true})");
  sample=await evaluate(win,readGeometry(["#turnStatus","#turnFailureDetailsButton","#turnInput","#sendTurnButton"]));
  assertVisibleWithin(sample,"#turnStatus",{overflow:true});
  assertVisibleWithin(sample,"#turnFailureDetailsButton",{hit:true,overflow:true});
  assertSeparate(sample,"#turnFailureDetailsButton","#turnStatus");
  assert.equal(await evaluate(win,"ui.narrationPanel.scrollTop"),errorAnchor,"failure must preserve history reading anchor");
  await checkHostText(win,ui);
  assert.equal(await evaluate(win,"document.querySelector('#turnInput').value"),fixture.strings.thread,"warning retains draft");
  await screenshot(win,root,`notebook-${fixture.locale}-1280-failure`,evidence);
  await click(win,"#turnFailureDetailsButton");
  const detail=await evaluate(win,readGeometry(["#narrationPanel .narration-line.warning:last-child","#turnInput"]));
  assertVisibleWithin(detail,"#narrationPanel .narration-line.warning:last-child",{overflow:true});
  assertSeparate(detail,"#narrationPanel .narration-line.warning:last-child","#turnInput");
  assert.equal(await evaluate(win,"document.activeElement===state.turnFailureNotice.line"),true,"details receives keyboard focus on request");
  evidence.presentationChecks.push({phase:"action-error-presentation",sample,detail,errorAnchor});
  await evaluate(win,"(() => {state.turnFailureNotice.line.remove();renderTurnStatus();})()");
  assert.equal(await evaluate(win,"ui.turnFailureDetailsButton.hidden"),true,"removed story must not retain stale failure affordance");
}

async function checkLargeText(win,evidence,root,fixture,ui) {
  const {click,change,evaluate,waitFor,screenshot}=ui;
  await click(win,"#gameSettingsButton");
  await click(win,"#settingsTabDisplay");
  const settings=await evaluate(win,readGeometry(["#settingsDialog","#closeSettingsButton","#narrationTextSizeSelect","#sidePanelTextSizeSelect"]));
  for(const selector of ["#settingsDialog","#closeSettingsButton"]) assertVisibleWithin(settings,selector,{hit:selector!=="#settingsDialog"});
  await screenshot(win,root,`notebook-${fixture.locale}-1280-settings`,evidence);
  for(const selector of ["#narrationTextSizeSelect","#sidePanelTextSizeSelect"]) {
    await evaluate(win,`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
    const field=await evaluate(win,readGeometry([selector]));
    assertVisibleWithin(field,selector,{hit:true});
    await change(win,selector,"large");
  }
  await click(win,"#closeSettingsButton");
  await waitFor(win,"large text preferences persisted","!state.settingsSaving && !state.settingsDirty");
  for(const [width,height] of [[1280,720],[1920,1080]]) {
    const viewport=await setViewport(win,width,height,ui);
    const sample=await evaluate(win,readGeometry(["#narrationPanel","#turnInput","#sendTurnButton",".narration-panel","#turnForm",...RAIL]));
    for(const selector of ["#narrationPanel","#turnInput","#sendTurnButton",...RAIL]) assertVisibleWithin(sample,selector,{hit:selector!=="#narrationPanel",overflow:selector==="#narrationPanel"});
    assertSeparate(sample,".narration-panel","#turnForm");
    assertSeparate(sample,"#turnInput","#sendTurnButton");
    const labels=await checkShortLabels(win,fixture.locale,ui);
    const hud=await checkHudText(win,ui);
    const idle=width===1280 ? await checkIdleVariants(win,ui) : null;
    const systemHost=width===1280 ? await checkSystemHostVariants(win,ui) : null;
    let busy=null;
    if(width===1280) {
      await evaluate(win,"(() => {setBusy(true,t('game.turn.defaultBusy'));state.busyStartedAt=Date.now()-125000;renderTurnStatus();})()");
      try {
        busy=await checkHostText(win,ui);
        await screenshot(win,root,`notebook-${fixture.locale}-${width}-large-waiting`,evidence);
      } finally { await evaluate(win,"setBusy(false)"); }
    }
    await screenshot(win,root,`notebook-${fixture.locale}-${width}-large`,evidence);
    evidence.layoutChecks.push({viewport,textSize:"large",sample,labels,hud,idle,systemHost,busy});
    await click(win,"#storyNotebookChaptersButton");
    await waitFor(win,"large text chapters loaded","document.querySelectorAll('#storyNotebookDrawerBody article.chapter-card').length===12 && !state.chapterReadBusy");
    const details='#storyNotebookDrawerBody [data-chapter-id="chapter-12"] details.chapter-details';
    if(!(await evaluate(win,`document.querySelector(${JSON.stringify(details)}).open`))) await click(win,`${details} > summary`);
    const chapter=await evaluate(win,readGeometry(["#storyNotebookDrawerBody",`${details} .chapter-full-summary`]));
    assertVisibleWithin(chapter,"#storyNotebookDrawerBody",{overflow:true});
    const full=chapter.nodes[`${details} .chapter-full-summary`];
    assert.ok(full?.visible && full.scrollWidth<=full.clientWidth+1,"expanded long chapter must wrap in large text");
    await screenshot(win,root,`notebook-${fixture.locale}-${width}-large-chapter`,evidence);
    await click(win,"#storyNotebookDrawerCloseButton");
  }
  evidence.settingsGeometry=settings;
}

async function checkDisplayModes(win,evidence,root,fixture,ui) {
  const {click,change,evaluate,waitFor,screenshot}=ui;
  const decoration=await evaluate(win,`(() => {
    const plain=r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height});
    const feather=document.querySelector('.story-notebook-host-mark img'),label=document.querySelector('.host-status .meter-label');
    const range=document.createRange();range.selectNodeContents(label);
    return {feather:plain(feather.getBoundingClientRect()),glyphs:Array.from(range.getClientRects(),plain)};
  })()`);
  for(const glyph of decoration.glyphs) {
    const feather=decoration.feather;
    assert.ok(Math.min(feather.right,glyph.right)-Math.max(feather.x,glyph.x)<=1 ||
      Math.min(feather.bottom,glyph.bottom)-Math.max(feather.y,glyph.y)<=1,'decorative feather must not cover host label glyphs');
  }
  const nativeEvents=[];
  const entered=()=>nativeEvents.push('enter-full-screen'),left=()=>nativeEvents.push('leave-full-screen');
  win.on('enter-full-screen',entered);win.on('leave-full-screen',left);
  await change(win,'#turnInput',fixture.strings.thread,'input');
  const before=await evaluate(win,"({story:document.querySelector('#narrationPanel').innerHTML,draft:document.querySelector('#turnInput').value})");
  await click(win,'#gameSettingsButton');await click(win,'#settingsTabDisplay');
  await screenshot(win,root,'notebook-zh-CN-display-settings-current',evidence);
  const options=await evaluate(win,"Array.from(document.querySelector('#windowModeSelect').options,option=>({id:option.value,disabled:option.disabled}))");
  const catalog=await evaluate(win,"state.settingsCatalog.ui.windowModes");
  const qhd=options.find(option=>option.id==='qhd');
  assert.ok(qhd,'high resolution window choice must exist');
  assert.equal(qhd.disabled,catalog.find(mode=>mode.id==='qhd')?.enabled===false,'unavailable high resolution choice must stay disabled');
  await change(win,'#windowModeSelect','fullscreen');await click(win,'#closeSettingsButton');
  await waitFor(win,'full screen settings saved',"!state.settingsSaving && !state.settingsDirty");
  const deadline=Date.now()+15000;
  while((!win.isFullScreen() || !nativeEvents.includes('enter-full-screen')) && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(win.isFullScreen(),true,'native BrowserWindow enters fullscreen after saving display preference');
  assert.ok(nativeEvents.includes('enter-full-screen'),'native fullscreen transition emits its completion event');
  await waitFor(win,'native fullscreen transition complete',"document.querySelector('#gameView').getBoundingClientRect().height>0");
  const fullscreen=await evaluate(win,"({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,story:document.querySelector('#narrationPanel').innerHTML,draft:document.querySelector('#turnInput').value})");
  assert.equal(fullscreen.story,before.story);assert.equal(fullscreen.draft,before.draft);
  await screenshot(win,root,'notebook-zh-CN-native-fullscreen',evidence);
  await click(win,'#gameSettingsButton');await click(win,'#settingsTabDisplay');
  const restore=options.find(option=>option.id==='standard' && !option.disabled) || options.find(option=>option.id!=='fullscreen' && !option.disabled);
  assert.ok(restore,'at least one windowed display choice must be available');
  await change(win,'#windowModeSelect',restore.id);await click(win,'#closeSettingsButton');
  await waitFor(win,'windowed settings saved',"!state.settingsSaving && !state.settingsDirty");
  const restoreDeadline=Date.now()+15000;
  while((win.isFullScreen() || !nativeEvents.includes('leave-full-screen')) && Date.now()<restoreDeadline) await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(win.isFullScreen(),false,'native BrowserWindow leaves fullscreen after restoring a window choice');
  assert.ok(nativeEvents.includes('leave-full-screen'),'native windowed transition emits its completion event');
  const expected=catalog.find(mode=>mode.id===restore.id);
  await waitFor(win,'selected window content dimensions restored',`innerWidth===${expected.contentWidth} && innerHeight===${expected.contentHeight}`);
  const after=await evaluate(win,"({story:document.querySelector('#narrationPanel').innerHTML,draft:document.querySelector('#turnInput').value})");
  assert.deepEqual(after,before,'fullscreen round trip preserves narrative and draft');
  await screenshot(win,root,'notebook-zh-CN-window-restored',evidence);
  await evaluate(win,"(() => {window.__notebookDisplayFinale=state.storyFinale;state.storyFinale={projection:{phase:'closed',actions:{exportStory:true,continueAsChild:true}}};renderTurnInputState();})()");
  const closedFooter=await evaluate(win,readGeometry(['#storyArchiveFooter','#storyContinueButton','#storyExportHtmlButton','#storyExportMarkdownButton','#storyArchiveBackButton']));
  for(const selector of ['#storyArchiveFooter','#storyContinueButton','#storyExportHtmlButton','#storyExportMarkdownButton','#storyArchiveBackButton']) {
    assertVisibleWithin(closedFooter,selector,{hit:selector!=='#storyArchiveFooter'});
  }
  await screenshot(win,root,'notebook-zh-CN-closed-footer-presentation',evidence);
  await evaluate(win,"(() => {state.storyFinale=window.__notebookDisplayFinale;delete window.__notebookDisplayFinale;renderTurnInputState();})()");
  // Electron capturePage follows the native window backing surface even when
  // enableDeviceEmulation reports a different DPR. The DevTools screenshot
  // command captures Chromium's actual emulated surface, with no image resize
  // or clip.scale multiplier after rendering.
  const debuggerApi=win.webContents.debugger;
  debuggerApi.attach('1.3');
  await debuggerApi.sendCommand('Emulation.setDeviceMetricsOverride',{
    width:1920,height:1080,deviceScaleFactor:2,mobile:false});
  await waitFor(win,'simulated high density viewport',"innerWidth===1920 && innerHeight===1080 && devicePixelRatio===2");
  await evaluate(win,"document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))");
  const highDpi=await evaluate(win,readGeometry(['#narrationPanel','#turnInput','#sendTurnButton',...RAIL]));
  for(const selector of ['#narrationPanel','#turnInput','#sendTurnButton',...RAIL]) assertVisibleWithin(highDpi,selector,{hit:selector!=='#narrationPanel'});
  const capture=await debuggerApi.sendCommand('Page.captureScreenshot',{
    format:'png',fromSurface:true,captureBeyondViewport:true});
  const file=path.join(root,'results','notebook-zh-CN-1920x1080-dpr2.png');
  fs.writeFileSync(file,Buffer.from(capture.data,'base64'));evidence.screenshots.push(file);
  const png=recordScreenshotSizes(evidence).at(-1);
  assert.equal(png.width,3840,'DPR 2 capture must have 3840 physical pixels');
  assert.equal(png.height,2160,'DPR 2 capture must have 2160 physical pixels');
  evidence.displayChecks={options,catalog,nativeEvents,decoration,fullscreen:{...fullscreen,story:undefined,draft:undefined},restore:restore.id,
    nativeFullscreenRoundTrip:true,storyAndDraftPreserved:true,closedFooterPresentation:closedFooter,
    highDpi:{kind:'Chromium device emulation; not physical high density monitor acceptance',sample:highDpi,
      captureMethod:'CDP Emulation.setDeviceMetricsOverride + Page.captureScreenshot; no bitmap resizing',png}};
  await debuggerApi.sendCommand('Emulation.clearDeviceMetricsOverride');
  debuggerApi.detach();
  win.removeListener('enter-full-screen',entered);win.removeListener('leave-full-screen',left);
}

// Actual open drawers and native keyboard navigation, using isolated synthetic content.
async function verifyFeedbackDrawer(win,evidence,root,ui) {
 const {evaluate,click,change,waitFor,screenshot}=ui; evidence.feedbackDrawer=[];
 for(const theme of ['light','dark']) {
  if(theme==='dark') {
   await click(win,'#storyNotebookDrawerCloseButton');
   await click(win,'#gameSettingsButton');await click(win,'#settingsTabDisplay');await change(win,'#storyNotebookThemeSelect','dark');await click(win,'#closeSettingsButton');
   await waitFor(win,'theme saved',"!ui.settingsDialog.open && !state.settingsSaving && document.body.dataset.paperTheme==='dark'");
  }
  await click(win,'#storyNotebookModulesButton');
  await waitFor(win,'real modules drawer',"state.notebookDrawerPanel==='modules' && ui.storyNotebookDrawer.classList.contains('is-open') && ui.storyNotebookDrawerBody.querySelectorAll('.story-notebook-module-card').length>0");
  await evaluate(win,"document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))");
  await new Promise(resolve=>setTimeout(resolve,300));
  const sample=await evaluate(win,`(()=>{const b=ui.storyNotebookModulesButton;const p=getComputedStyle(b,'::after');return {theme:document.body.dataset.paperTheme,overlay:{background:p.backgroundColor,border:p.borderWidth,image:p.backgroundImage},cards:[...ui.storyNotebookDrawerBody.querySelectorAll('.story-notebook-module-card')].map(c=>{const svg=c.querySelector('svg.lab-object-icon'),r=svg?.getBoundingClientRect(),s=svg&&getComputedStyle(svg);return {text:c.innerText,oldImages:c.querySelectorAll('img').length,svg:!!svg,display:s?.display,width:r?.width,height:r?.height,overflow:c.scrollWidth>c.clientWidth+1}})}})()`);
  assert.ok(sample.cards.length>0); for(const c of sample.cards){assert.equal(c.oldImages,0);assert.equal(c.svg,true);assert.notEqual(c.display,'none');assert.ok(c.width>20&&c.height>20);assert.equal(c.overflow,false);}
  assert.equal(sample.overlay.background,'rgba(0, 0, 0, 0)'); assert.equal(sample.overlay.border,'0px');
  await screenshot(win,root,'feedback-drawer-'+theme,evidence);evidence.feedbackDrawer.push(sample);
 }
 await click(win,'#storyNotebookDrawerCloseButton');
 win.focus(); win.webContents.focus();
 await evaluate(win,"(()=>{window.__feedbackKey=null;document.addEventListener('keydown',e=>{window.__feedbackKey={key:e.key,trusted:e.isTrusted};},{once:true});ui.storyNotebookCharactersButton.focus({preventScroll:true});})()");
 win.webContents.sendInputEvent({type:"keyDown",keyCode:"Tab"});win.webContents.sendInputEvent({type:"keyUp",keyCode:"Tab"});
 await waitFor(win,'native keyboard tab focus',"window.__feedbackKey?.key==='Tab' && document.activeElement===ui.storyNotebookModulesButton");
 await new Promise(resolve=>setTimeout(resolve,250));
 const focus=await evaluate(win,"(()=>{const e=ui.storyNotebookModulesButton,s=getComputedStyle(e,'::after');return {focus:document.activeElement===e,focusVisible:e.matches(':focus-visible'),key:window.__feedbackKey,image:s.backgroundImage,border:s.borderWidth}})()");
 evidence.feedbackFocus=focus;assert.equal(focus.focus,true);assert.equal(focus.focusVisible,true);assert.ok(focus.image.includes('linear-gradient'));assert.equal(focus.border,'0px');
 await screenshot(win,root,'feedback-keyboard-focus',evidence);
}

module.exports = { handlesPhase, runCoordinator, runPhase };

if (require.main === module) {
  const localeArgument=process.argv[2]?.startsWith('--locale=')?process.argv[2].slice('--locale='.length):null;
  if (process.argv.length > 3 || (process.argv[2] && !['--before','--display','--feedback','--demo','--rail-badge-before','--rail-badge'].includes(process.argv[2]) &&
      !['zh-CN','en-US','ja-JP'].includes(localeArgument))) {
    throw new Error("Usage: node scripts/check-notebook-layout.js [--before|--display|--feedback|--demo|--rail-badge-before|--rail-badge|--locale=zh-CN|--locale=en-US|--locale=ja-JP]. No save or credential arguments are accepted.");
  }
  const { spawn } = require("node:child_process");
  const child = spawn(process.execPath, [path.join(__dirname, "check-session-desktop.js"),
    ['--before','--demo','--rail-badge-before','--rail-badge'].includes(process.argv[2]) ? "--suite=notebook-layout-before" : process.argv[2] === "--display" ? "--suite=notebook-layout-display" : process.argv[2] === "--feedback" ? "--suite=notebook-layout-feedback" : "--suite=notebook-layout"],
    { stdio: "inherit",env:{...process.env,GREY_CROW_NOTEBOOK_LAYOUT_LOCALE:localeArgument||'',GREY_CROW_NOTEBOOK_LAYOUT_DEMO:process.argv[2]==='--demo'?'1':'',
      GREY_CROW_NOTEBOOK_RAIL_BADGE:process.argv[2]==='--rail-badge-before'?'before':process.argv[2]==='--rail-badge'?'after':''} });
  child.on("error", (error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}


async function checkSpeechInputPresentation(win,evidence,root,fixture,ui) {
  const {evaluate,screenshot}=ui;
  const checks=[];
  const before=await evaluate(win,"({theme:state.storyNotebookTheme,draft:ui.turnInput.value})");
  try {
    for (const theme of ['light','dark']) {
      await evaluate(win,`state.storyNotebookTheme=${JSON.stringify(theme)};renderGameUiLayout();`);
      await evaluate(win,"document.querySelector('#themeStudyImage').decode()");
      for (const phase of ['recording','result']) {
        await evaluate(win,`speechInputController.render({...speechInputController.snapshot(),phase:${JSON.stringify(phase==='recording'?'recording':'idle')},busy:${phase==='recording'},seconds:21,pending:${phase==='result'?'{test:false}':'null'}})`);
        const selectors=['#turnInput','#speechInputButton','#speechInputBar','#speechInputStatus'];
        selectors.push(phase==='recording'?'#speechInputCancel':'#speechInputResultButton');
        const sample=await evaluate(win,readGeometry(selectors));
        for (const selector of selectors) assertVisibleWithin(sample,selector,{hit:selector.endsWith('Button')||selector==='#speechInputCancel'});
        assertSeparate(sample,'#turnInput','#speechInputBar');
        assertSeparate(sample,'#turnInput','#speechInputButton');
        await screenshot(win,root,`notebook-${fixture.locale}-speech-input-${theme}-${phase}`,evidence);
        checks.push({theme,phase,sample});
      }
    }
  } finally {
    await evaluate(win,`state.storyNotebookTheme=${JSON.stringify(before.theme)};renderGameUiLayout();speechInputController.render();`);
  }
  assert.equal(await evaluate(win,'ui.turnInput.value'),before.draft);
  evidence.speechInputPresentation={checks,boundary:'Real speech UI render with synthetic view states only; no microphone, recognition, network, or spoken quality claim.'};
}

async function checkNotebookRefinements(win,evidence,ui) {
  const {evaluate,click,change,waitFor}=ui;
  const before=await evaluate(win,`(() => {
    const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
    window.__bookSettingsInput=ui.turnInput;
    window.__bookSettingsMutations=[];
    window.__bookSettingsObserver=new MutationObserver(records=>{for(const r of records) {
      if(r.attributeName==='hidden' && (r.target.hidden || r.oldValue!==null)) window.__bookSettingsMutations.push('stage hidden');
      if(r.attributeName==='data-book-presentation' && (r.oldValue===null || !r.target.hasAttribute(r.attributeName))) window.__bookSettingsMutations.push('book presentation removed');
    }});
    window.__bookSettingsObserver.observe(document.querySelector('#bookStage'),{attributes:true,attributeFilter:['hidden'],attributeOldValue:true});
    window.__bookSettingsObserver.observe(document.body,{attributes:true,attributeFilter:['data-book-presentation'],attributeOldValue:true});
    return {session:state.runtimeSessionId,phase:notebookBookController.getState().phase,draft:ui.turnInput.value,
      src:document.querySelector('#themeStudyImage').src,preset:state.narrationLengthPreset,
      paragraph:rect(document.querySelector('.narration-line.host')),scroll:rect(ui.narrationPanel),
      live:rect(ui.storyNotebookLive),drop:rect(document.querySelector('.context-side-card .context-meter')),
      microphone:Boolean(document.querySelector('#speechInputButton svg'))};
  })()`);
  assert.ok(before.microphone,'speech control is an SVG microphone');
  assert.ok(before.paragraph.width > 1100,'paragraph must use the enlarged paper width at the 1600 px stage');
  assert.ok(Math.abs(before.live.x+before.live.width/2-before.drop.x-before.drop.width/2)<1.5,'LIVE must be centered directly under the ink drop');
  assert.ok(before.live.y>=before.drop.bottom && before.live.y-before.drop.bottom<14,'LIVE must sit close below the ink drop');
  await click(win,'#gameSettingsButton'); await click(win,'#settingsTabNarration');
  await change(win,'#narrationLengthPresetSelect',before.preset==='short'?'standard':'short');
  await waitFor(win,'length preference saved with a replacement session',`!state.settingsSaving && !state.settingsDirty && state.runtimeSessionId!==${JSON.stringify(before.session)}`);
  await click(win,'#closeSettingsButton');
  await waitFor(win,'preference panel closed','!ui.settingsDialog.open');
  const after=await evaluate(win,`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
    window.__bookSettingsObserver.disconnect();
    const result={phase:notebookBookController.getState().phase,binding:notebookBookController.getState().binding,
      session:state.runtimeSessionId,stageHidden:document.querySelector('#bookStage').hidden,
      presentation:document.body.dataset.bookPresentation,inert:ui.gameView.inert,draft:ui.turnInput.value,
      sameInput:ui.turnInput===window.__bookSettingsInput,src:document.querySelector('#themeStudyImage').src,
      mutations:window.__bookSettingsMutations};
    delete window.__bookSettingsInput;delete window.__bookSettingsObserver;delete window.__bookSettingsMutations;resolve(result);
  })))`);
  assert.equal(after.phase,'reading'); assert.equal(after.binding.sessionId,after.session);
  assert.equal(after.stageHidden,false); assert.equal(after.presentation,'active'); assert.equal(after.inert,false);
  assert.equal(after.sameInput,true); assert.equal(after.draft,before.draft); assert.equal(after.src,before.src);
  assert.deepEqual(after.mutations,[],'changing reply length must never hide/recreate the opened book');
  evidence.uiRefinements={before,after,boundary:'Real settings persistence and session replacement with synthetic credentials; no story or microphone call.'};
}
