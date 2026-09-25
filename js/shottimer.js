/* ---------------------------------------------------------------------
   Applied Concepts — Shottimer
   Startpiep + microfoon-schotdetectie via een AudioWorklet (sample-
   accurate, geen setTimeout/rAF-timing). Kalibratie/instellingen/
   historie leven in localStorage, puur client-side — dit omzeilt de
   pass-phrase gate nooit (die blijft ongewijzigd, zie js/app.js).
   Timer- en Par-modus delen dezelfde run-engine; Par werkt ook zonder
   microfoon (alleen de par-beeps, geen detectie).
--------------------------------------------------------------------- */

const ST_PROFILE_KEY = 'ac_shottimer_profile_v1';
const ST_SETTINGS_KEY = 'ac_shottimer_settings_v1';
const ST_HISTORY_KEY = 'ac_shottimer_history_v1';

const ST_DEFAULT_SETTINGS = {
  mode: 'timer', // 'timer' | 'par'
  sensitivity: 0.35, // maps 1:1 to the worklet's onset threshold (0..1 on the high-passed signal)
  deadTimeMs: 60,
  startMode: 'random', // 'random' | 'fixed'
  delayMin: 1.0, delayMax: 4.0, fixedDelay: 2.0,
  beepFreq: 2800, beepDurationMs: 200, beepVolume: 0.9,
  expectedShots: null, maxDurationSec: null,
  parTimes: [3, 6], parDetection: true,
  debugEnabled: false,
};

function acStLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function acStSave(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* opslag niet beschikbaar — sessie werkt door zonder persistentie */ }
}

let acStProfile = acStLoad(ST_PROFILE_KEY, null);
let acStSettings = Object.assign({}, ST_DEFAULT_SETTINGS, acStLoad(ST_SETTINGS_KEY, {}));
let acStHistory = acStLoad(ST_HISTORY_KEY, []);

let acStUI = { screen: 'home', onboardingStep: 0 };
let acStOnboard = {}; // scratch state tijdens de wizard, pas op afronden naar acStProfile geschreven

// ---- Audio engine (gedeeld tussen runs) --------------------------------
let acStAudioCtx = null;
let acStMicStream = null;
let acStWorkletNode = null;
let acStWorkletReady = false;
let acStWakeLock = null;
let acStRun = null; // actieve run-state, null als er niets loopt
let acStDebugTap = null; // { node, active } — losse always-on tap voor het debug-niveaumeter

function acStPlatformGuess() {
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

function acStFmt2(sec) { return (Math.round(sec * 100) / 100).toFixed(2); }

async function acStEnsureAudioCtx() {
  if (acStAudioCtx && acStAudioCtx.state !== 'closed') {
    if (acStAudioCtx.state === 'suspended') await acStAudioCtx.resume();
    return acStAudioCtx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  acStAudioCtx = new AC({ latencyHint: 'interactive', sampleRate: 48000 });
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
  } catch (e) { /* niet-standaard Safari-API, negeren als afwezig */ }
  acStWorkletReady = false;
  return acStAudioCtx;
}

async function acStEnsureWorklet() {
  const ctx = await acStEnsureAudioCtx();
  if (!acStWorkletReady) {
    await ctx.audioWorklet.addModule('js/shottimer-worklet.js');
    acStWorkletReady = true;
  }
  if (!acStWorkletNode || acStWorkletNode.context !== ctx) {
    acStWorkletNode = new AudioWorkletNode(ctx, 'shottimer-processor');
    const mute = ctx.createGain();
    mute.gain.value = 0;
    acStWorkletNode.connect(mute).connect(ctx.destination);
    acStWorkletNode.port.onmessage = (e) => acStOnWorkletMessage(e.data);
  }
  return acStWorkletNode;
}

async function acStRequestMic() {
  if (acStMicStream) return acStMicStream;
  acStMicStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, sampleRate: 48000 },
  });
  return acStMicStream;
}

function acStConnectMicToWorklet() {
  const ctx = acStAudioCtx;
  const source = ctx.createMediaStreamSource(acStMicStream);
  source.connect(acStWorkletNode);
  return source;
}

async function acStAcquireWakeLock() {
  try {
    if (navigator.wakeLock) acStWakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { acStWakeLock = null; }
}
function acStReleaseWakeLock() {
  if (acStWakeLock) { try { acStWakeLock.release(); } catch (e) {} acStWakeLock = null; }
}

// ---- Beep -------------------------------------------------------------
function acStScheduleBeep(ctx, atTime, freq, durMs, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const dur = durMs / 1000;
  gain.gain.setValueAtTime(0, atTime);
  gain.gain.linearRampToValueAtTime(volume, atTime + 0.005);
  gain.gain.setValueAtTime(volume, Math.max(atTime + 0.005, atTime + dur - 0.005));
  gain.gain.linearRampToValueAtTime(0, atTime + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(atTime);
  osc.stop(atTime + dur + 0.02);
}

// ---- Run engine ---------------------------------------------------------
function acStWorkletConfig(node) {
  node.port.postMessage({
    type: 'config',
    threshold: acStSettings.sensitivity,
    deadTimeMs: acStSettings.deadTimeMs,
    highpassHz: 700,
    beepFreq: acStSettings.beepFreq,
  });
}

async function acStStartRun() {
  if (acStRun) return;
  const mode = acStSettings.mode;
  const needsMic = !(mode === 'par' && !acStSettings.parDetection);

  const ctx = await acStEnsureAudioCtx();
  let source = null;
  if (needsMic) {
    await acStRequestMic();
    await acStEnsureWorklet();
    acStWorkletConfig(acStWorkletNode);
    source = acStConnectMicToWorklet();
    acStWorkletNode.port.postMessage({ type: 'reset' });
  }

  await acStAcquireWakeLock();

  const delay = acStSettings.startMode === 'fixed'
    ? acStSettings.fixedDelay
    : acStSettings.delayMin + Math.random() * Math.max(0, acStSettings.delayMax - acStSettings.delayMin);
  const plannedTime = ctx.currentTime + delay;
  const plannedFrame = Math.round(plannedTime * ctx.sampleRate);
  const durFrames = Math.round((acStSettings.beepDurationMs / 1000) * ctx.sampleRate);
  const marginFrames = Math.round(0.03 * ctx.sampleRate);

  acStRun = {
    mode, ctx, source,
    startFrame: null, startMethod: null,
    shots: [], parBeepTimers: [],
    plannedFrame, sampleRate: ctx.sampleRate,
    stopped: false, autoStopTimer: null, fallbackTimer: null,
    expectedShots: acStSettings.expectedShots, maxDurationSec: acStSettings.maxDurationSec,
    stopNote: null,
  };

  if (needsMic) {
    acStWorkletNode.port.postMessage({ type: 'maskUntil', frame: plannedFrame + durFrames + marginFrames });
    acStWorkletNode.port.postMessage({ type: 'setMode', mode: 'listening' });
    acStWorkletNode.port.postMessage({ type: 'armBeepDetection' });
  }

  acStScheduleBeep(ctx, plannedTime, acStSettings.beepFreq, acStSettings.beepDurationMs, acStSettings.beepVolume);

  if (mode === 'par') {
    acStSettings.parTimes.forEach((t) => {
      const at = plannedTime + t;
      acStScheduleBeep(ctx, at, acStSettings.beepFreq, Math.min(120, acStSettings.beepDurationMs), acStSettings.beepVolume);
    });
    const lastPar = acStSettings.parTimes.length ? Math.max(...acStSettings.parTimes) : 0;
    if (!acStRun.expectedShots) {
      acStRun.autoStopTimer = setTimeout(() => acStStopRun('par afgerond'), (delay + lastPar + 2) * 1000);
    }
  }

  if (needsMic) {
    acStRun.fallbackTimer = setTimeout(() => {
      if (acStRun && acStRun.startFrame == null) {
        const latencyMs = (acStProfile && acStProfile.loopbackLatencyMs) || 0;
        acStRun.startFrame = plannedFrame + Math.round((latencyMs / 1000) * ctx.sampleRate);
        acStRun.startMethod = 'fallback';
      }
    }, delay * 1000 + 500);
  } else {
    acStRun.startFrame = plannedFrame;
    acStRun.startMethod = 'gepland (geen microfoon in par-modus)';
  }

  if (acStRun.maxDurationSec) {
    acStRun.autoStopTimer = setTimeout(() => acStStopRun('maximale duur bereikt'), (delay + acStRun.maxDurationSec) * 1000);
  }

  acStUI.screen = 'running';
  acStRender();
  acStRunTickLoop();
}

function acStOnWorkletMessage(msg) {
  if (msg.type === 'level') {
    if (acStRun) acStRun.lastPeak = msg.peak;
    if (acStUI.screen === 'debug') acStDebugOnLevel(msg.peak);
    return;
  }
  if (!acStRun) return;
  if (msg.type === 'beep') {
    if (acStRun.startFrame == null) {
      acStRun.startFrame = msg.frame;
      acStRun.startMethod = 'akoestisch (microfoon hoorde de startpiep)';
      const durFrames = Math.round((acStSettings.beepDurationMs / 1000) * acStRun.sampleRate);
      const marginFrames = Math.round(0.03 * acStRun.sampleRate);
      acStWorkletNode.port.postMessage({ type: 'maskUntil', frame: msg.frame + durFrames + marginFrames });
    }
  } else if (msg.type === 'shot') {
    if (acStRun.startFrame == null) return; // ruis vóór de piep telt nooit mee
    const timeSec = (msg.frame - acStRun.startFrame) / acStRun.sampleRate;
    if (timeSec < 0) return;
    acStRun.shots.push({ frame: msg.frame, timeSec, amplitude: msg.amplitude, voided: false });
    if (acStRun.expectedShots && acStRun.shots.filter(s=>!s.voided).length >= acStRun.expectedShots) {
      acStStopRun('verwacht aantal schoten bereikt');
    }
    acStRenderRunningShots();
  }
}

function acStRunTickLoop() {
  if (!acStRun || acStRun.stopped) return;
  acStRenderRunningTime();
  requestAnimationFrame(acStRunTickLoop);
}

function acStStopRun(note) {
  if (!acStRun || acStRun.stopped) return;
  acStRun.stopped = true;
  acStRun.stopNote = note || null;
  if (acStRun.autoStopTimer) clearTimeout(acStRun.autoStopTimer);
  if (acStRun.fallbackTimer) clearTimeout(acStRun.fallbackTimer);
  if (acStWorkletNode) acStWorkletNode.port.postMessage({ type: 'reset' });
  if (acStRun.source) { try { acStRun.source.disconnect(); } catch (e) {} }
  acStReleaseWakeLock();

  const finished = acStRun;
  acStRun = null;
  acStSaveRunToHistory(finished);
  acStUI.screen = 'review';
  acStUI.reviewRun = finished;
  acStRender();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && acStRun && !acStRun.stopped) {
    acStStopRun('pagina naar achtergrond — run automatisch gestopt');
  }
});

function acStStopTimer() { // hook voor switchTab, zelfde patroon als Dry Fire
  if (acStRun && !acStRun.stopped) acStStopRun('tab verlaten');
}

// ---- Historie -----------------------------------------------------------
function acStSaveRunToHistory(run) {
  const activeShots = () => run.shots.filter(s => !s.voided).sort((a,b)=>a.timeSec-b.timeSec);
  const entry = {
    id: 'run_' + Date.now(),
    date: new Date().toISOString(),
    mode: run.mode,
    startMethod: run.startMethod,
    stopNote: run.stopNote,
    shots: run.shots.map(s => ({ timeSec: s.timeSec, amplitude: s.amplitude, voided: s.voided })),
  };
  acStHistory.unshift(entry);
  acStHistory = acStHistory.slice(0, 200);
  acStSave(ST_HISTORY_KEY, acStHistory);
  run.historyId = entry.id;
}

function acStUpdateHistoryEntry(run) {
  if (!run.historyId) return;
  const entry = acStHistory.find(h => h.id === run.historyId);
  if (!entry) return;
  entry.shots = run.shots.map(s => ({ timeSec: s.timeSec, amplitude: s.amplitude, voided: s.voided }));
  acStSave(ST_HISTORY_KEY, acStHistory);
}

// ---- Render: root dispatcher --------------------------------------------
function acStRender() {
  const root = document.getElementById('shottimerRoot');
  if (!root) return;
  if (!acStProfile || !acStProfile.calibratedAt) { acStUI.screen = 'onboarding'; }
  if (acStUI.screen === 'onboarding') return acStRenderOnboarding(root);
  if (acStUI.screen === 'home') return acStRenderHome(root);
  if (acStUI.screen === 'running') return acStRenderRunning(root);
  if (acStUI.screen === 'review') return acStRenderReview(root);
  if (acStUI.screen === 'history') return acStRenderHistory(root);
  if (acStUI.screen === 'debug') return acStRenderDebug(root);
}

/* ======================= ONBOARDING ======================= */
function acStOnboardStepLabel(i) {
  return ['Platform', 'Microfoon', 'Controle', 'Beeptest', 'Kalibratie', 'Schotkalibratie'][i];
}

function acStRenderOnboarding(root) {
  const step = acStUI.onboardingStep;
  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>Shottimer instellen</h2>
      <p class="sub">Eenmalige set-up per toestel — stap ${step+1} van 6: ${acStOnboardStepLabel(step)}.</p>
    </div></div>
    <div class="st-onboard-steps">${[0,1,2,3,4,5].map(i=>`<span class="st-onboard-dot${i===step?' active':''}${i<step?' done':''}"></span>`).join('')}</div>
    <div id="stOnboardBody" class="profile-card"></div>
  `;
  const body = document.getElementById('stOnboardBody');
  if (step === 0) return acStOnboardPlatform(body);
  if (step === 1) return acStOnboardMic(body);
  if (step === 2) return acStOnboardStatus(body);
  if (step === 3) return acStOnboardBeepTest(body);
  if (step === 4) return acStOnboardLatency(body);
  if (step === 5) return acStOnboardShotCal(body);
}

function acStOnboardNav(body, opts) {
  const nav = document.createElement('div');
  nav.className = 'st-onboard-nav';
  if (opts.back) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'printbtn st-btn-secondary'; b.textContent = 'Terug';
    b.addEventListener('click', () => { acStUI.onboardingStep--; acStRender(); });
    nav.appendChild(b);
  }
  const n = document.createElement('button');
  n.type = 'button'; n.className = 'printbtn'; n.textContent = opts.nextLabel || 'Volgende';
  n.disabled = !!opts.nextDisabled;
  n.addEventListener('click', opts.onNext);
  nav.appendChild(n);
  body.appendChild(nav);
}

function acStOnboardPlatform(body) {
  const guess = acStOnboard.platform || acStProfile?.platform || acStPlatformGuess();
  acStOnboard.platform = guess;
  const labels = { ios: 'iOS (iPhone/iPad)', android: 'Android', other: 'Anders' };
  body.innerHTML = `
    <p class="hint">Gedetecteerd platform: <strong>${labels[guess]}</strong>. Klopt dit niet? Kies het juiste platform.</p>
    <div class="dryfire-mode-toggle" id="stPlatformToggle">
      ${['ios','android','other'].map(p=>`<label><input type="radio" name="stPlatform" value="${p}" ${p===guess?'checked':''}> ${labels[p]}</label>`).join('')}
    </div>
  `;
  body.querySelectorAll('input[name="stPlatform"]').forEach(r=>{
    r.addEventListener('change', ()=>{ acStOnboard.platform = r.value; });
  });
  acStOnboardNav(body, { onNext: () => { acStUI.onboardingStep = 1; acStRender(); } });
}

function acStOnboardMic(body) {
  const granted = !!acStOnboard.micGranted;
  const denied = acStOnboard.micDenied;
  const platform = acStOnboard.platform;
  const instructions = {
    ios: 'iOS: Instellingen > Safari > Microfoon (op "Vragen" of "Toestaan"), of via het aA-menu in de adresbalk > Website-instellingen > Microfoon.',
    android: 'Android/Chrome: tik op het slotje/info-icoon in de adresbalk > Machtigingen > Microfoon > Toestaan.',
    other: 'Open de site-instellingen van je browser voor deze pagina en zet Microfoon op Toestaan.',
  };
  body.innerHTML = `
    <p class="hint">De shottimer heeft microfoontoegang nodig om de startpiep en schoten te detecteren.</p>
    ${granted ? `<p class="st-status-ok">✅ Microfoontoegang verleend.</p>` : `
      <button type="button" class="printbtn" id="stMicRequestBtn">Microfoon toestaan</button>
      ${denied ? `<p class="st-status-bad">❌ Toegang geweigerd of mislukt.</p><p class="hint">${instructions[platform] || instructions.other}</p>` : ''}
    `}
  `;
  const btn = document.getElementById('stMicRequestBtn');
  if (btn) btn.addEventListener('click', async () => {
    try {
      await acStRequestMic();
      acStOnboard.micGranted = true;
      acStOnboard.micDenied = false;
    } catch (e) {
      acStOnboard.micGranted = false;
      acStOnboard.micDenied = true;
    }
    acStRenderOnboarding(root_of(body));
  });
  acStOnboardNav(body, { back: true, nextDisabled: !granted, onNext: () => { acStUI.onboardingStep = 2; acStRender(); } });
}
function root_of() { return document.getElementById('shottimerRoot'); }

async function acStOnboardStatus(body) {
  body.innerHTML = `<p class="hint">Controle van de actieve audio-instellingen…</p>`;
  const results = [];
  try {
    await acStRequestMic();
    const track = acStMicStream.getAudioTracks()[0];
    const settings = track.getSettings ? track.getSettings() : {};
    results.push({ ok: true, label: 'Microfoontoegang', detail: 'actief' });
    ['echoCancellation','noiseSuppression','autoGainControl'].forEach(k=>{
      const val = settings[k];
      results.push({ ok: val === false, label: k, detail: val === undefined ? 'onbekend (platform negeert dit mogelijk)' : String(val) });
    });
    const ctx = await acStEnsureAudioCtx();
    results.push({ ok: true, label: 'Sample rate', detail: ctx.sampleRate + ' Hz' });
    if (ctx.baseLatency != null) results.push({ ok: true, label: 'Base latency', detail: (ctx.baseLatency*1000).toFixed(1) + ' ms' });
    if (ctx.outputLatency != null) results.push({ ok: true, label: 'Output latency', detail: (ctx.outputLatency*1000).toFixed(1) + ' ms' });
    results.push({ ok: !!navigator.wakeLock, label: 'Wake Lock beschikbaar', detail: navigator.wakeLock ? 'ja' : 'nee — scherm kan uitgaan tijdens een run' });
  } catch (e) {
    results.push({ ok: false, label: 'Controle mislukt', detail: String(e.message || e) });
  }
  body.innerHTML = `
    <ul class="st-status-list">
      ${results.map(r=>`<li class="${r.ok?'st-status-ok':'st-status-warn'}">${r.ok?'✅':'⚠️'} <strong>${r.label}</strong> — ${r.detail}</li>`).join('')}
    </ul>
    <p class="hint">Staat echoCancellation/noiseSuppression/autoGainControl niet op false? Sommige platforms negeren dit verzoek — dat is een bekende beperking, geen fout in de app.</p>
  `;
  acStOnboardNav(body, { back: true, onNext: () => { acStUI.onboardingStep = 3; acStRender(); } });
}

function acStOnboardBeepTest(body) {
  body.innerHTML = `
    <p class="hint">Speel de startpiep af — zorg dat je toestel niet op stil/mute staat. Op iOS kan de audio-uitvoer naar de oorspeaker schakelen zodra de microfoon actief is; dit test dat meteen mee.</p>
    <button type="button" class="printbtn" id="stBeepPlayBtn">Speel testpiep af</button>
    <div id="stBeepConfirm" hidden style="margin-top:14px;">
      <p class="hint">Was de piep duidelijk hoorbaar?</p>
      <div class="st-onboard-nav">
        <button type="button" class="printbtn st-btn-secondary" id="stBeepNo">Nee, niet gehoord</button>
        <button type="button" class="printbtn" id="stBeepYes">Ja, duidelijk</button>
      </div>
    </div>
  `;
  document.getElementById('stBeepPlayBtn').addEventListener('click', async () => {
    const ctx = await acStEnsureAudioCtx();
    acStScheduleBeep(ctx, ctx.currentTime + 0.05, acStSettings.beepFreq, acStSettings.beepDurationMs, acStSettings.beepVolume);
    document.getElementById('stBeepConfirm').hidden = false;
  });
  document.getElementById('stBeepNo').addEventListener('click', () => { acStOnboard.beepConfirmed = false; });
  document.getElementById('stBeepYes').addEventListener('click', () => { acStOnboard.beepConfirmed = true; });
  acStOnboardNav(body, { back: true, onNext: () => { acStUI.onboardingStep = 4; acStRender(); } });
}

async function acStOnboardLatency(body) {
  body.innerHTML = `
    <p class="hint">Loopback-kalibratie: de app speelt 5 korte piepjes af en meet zelf hoe lang het duurt voordat de microfoon ze hoort. Houd het toestel stil en zorg voor een rustige omgeving.</p>
    <button type="button" class="printbtn" id="stLatencyStartBtn">Start kalibratie</button>
    <div id="stLatencyProgress" class="hint" style="margin-top:10px;"></div>
  `;
  const startBtn = document.getElementById('stLatencyStartBtn');
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    const progress = document.getElementById('stLatencyProgress');
    await acStRequestMic();
    await acStEnsureWorklet();
    acStWorkletConfig(acStWorkletNode);
    const source = acStConnectMicToWorklet();
    const ctx = acStAudioCtx;
    const N = 5;
    const deltas = [];
    for (let i = 0; i < N; i++) {
      progress.textContent = `Beep ${i+1} van ${N}…`;
      const delay = 0.6 + Math.random() * 0.4;
      const at = ctx.currentTime + delay;
      const plannedFrame = Math.round(at * ctx.sampleRate);
      const detected = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), (delay + 1.0) * 1000);
        const onMsg = (e) => {
          if (e.data.type === 'beep') {
            clearTimeout(timeout);
            acStWorkletNode.port.onmessage = (ev) => acStOnWorkletMessage(ev.data);
            resolve(e.data.frame);
          }
        };
        acStWorkletNode.port.onmessage = onMsg;
        acStWorkletNode.port.postMessage({ type: 'armBeepDetection' });
        acStScheduleBeep(ctx, at, acStSettings.beepFreq, acStSettings.beepDurationMs, acStSettings.beepVolume);
      });
      if (detected != null) {
        const deltaMs = ((detected - plannedFrame) / ctx.sampleRate) * 1000;
        if (deltaMs > 0 && deltaMs < 500) deltas.push(deltaMs);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    try { source.disconnect(); } catch (e) {}
    if (deltas.length) {
      const avg = deltas.reduce((a,b)=>a+b,0) / deltas.length;
      acStOnboard.loopbackLatencyMs = Math.round(avg);
      progress.innerHTML = `<span class="st-status-ok">✅ Gemiddelde vertraging: ${Math.round(avg)} ms (${deltas.length}/${N} piepjes gedetecteerd).</span>`;
    } else {
      acStOnboard.loopbackLatencyMs = 80;
      progress.innerHTML = `<span class="st-status-warn">⚠️ Geen piepjes gedetecteerd — standaardwaarde van 80 ms gebruikt. Probeer het in een stillere omgeving opnieuw, of ga verder.</span>`;
    }
    startBtn.disabled = false;
    startBtn.textContent = 'Opnieuw kalibreren';
  });
  acStOnboardNav(body, { back: true, onNext: () => { acStUI.onboardingStep = 5; acStRender(); } });
}

async function acStOnboardShotCal(body) {
  body.innerHTML = `
    <p class="hint">Optioneel, op de baan: los 1 à 2 schoten terwijl je toestel meeluistert. De app stelt de gevoeligheid automatisch in op basis van de gemeten piek. Zonder toegang tot een baan kun je dit overslaan — de standaardgevoeligheid werkt in de meeste gevallen goed.</p>
    <button type="button" class="printbtn" id="stShotCalStartBtn">Start (luister 8 sec.)</button>
    <div id="stShotCalProgress" class="hint" style="margin-top:10px;"></div>
  `;
  const startBtn = document.getElementById('stShotCalStartBtn');
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    const progress = document.getElementById('stShotCalProgress');
    progress.textContent = 'Luistert… los nu je schot/schoten.';
    await acStRequestMic();
    await acStEnsureWorklet();
    const ctx = acStAudioCtx;
    acStWorkletNode.port.postMessage({ type: 'config', threshold: 0.02, deadTimeMs: acStSettings.deadTimeMs, highpassHz: 700, beepFreq: acStSettings.beepFreq });
    acStWorkletNode.port.postMessage({ type: 'reset' });
    acStWorkletNode.port.postMessage({ type: 'setMode', mode: 'listening' });
    acStWorkletNode.port.postMessage({ type: 'maskUntil', frame: 0 });
    const source = acStConnectMicToWorklet();
    const peaks = [];
    acStWorkletNode.port.onmessage = (e) => { if (e.data.type === 'shot') peaks.push(e.data.amplitude); };
    await new Promise(r => setTimeout(r, 8000));
    acStWorkletNode.port.onmessage = (ev) => acStOnWorkletMessage(ev.data);
    acStWorkletNode.port.postMessage({ type: 'setMode', mode: 'idle' });
    try { source.disconnect(); } catch (e) {}
    startBtn.disabled = false;
    if (peaks.length) {
      const peak = Math.max(...peaks);
      acStOnboard.shotThreshold = Math.round(peak * 0.6 * 1000) / 1000;
      progress.innerHTML = `<span class="st-status-ok">✅ ${peaks.length} schot(en) gedetecteerd, piek ${peak.toFixed(3)} — gevoeligheid ingesteld op ${acStOnboard.shotThreshold}.</span>`;
    } else {
      progress.innerHTML = `<span class="st-status-warn">⚠️ Geen schoten gedetecteerd — standaardgevoeligheid blijft staan. Je kunt dit later via Instellingen bijstellen.</span>`;
    }
  });
  acStOnboardNav(body, { back: true, nextLabel: 'Afronden', onNext: acStOnboardFinish });
}

function acStOnboardFinish() {
  acStProfile = {
    platform: acStOnboard.platform || acStPlatformGuess(),
    loopbackLatencyMs: acStOnboard.loopbackLatencyMs != null ? acStOnboard.loopbackLatencyMs : (acStProfile?.loopbackLatencyMs ?? 80),
    beepConfirmed: acStOnboard.beepConfirmed !== undefined ? acStOnboard.beepConfirmed : (acStProfile?.beepConfirmed ?? null),
    calibratedAt: new Date().toISOString(),
  };
  acStSave(ST_PROFILE_KEY, acStProfile);
  if (acStOnboard.shotThreshold != null) {
    acStSettings.sensitivity = acStOnboard.shotThreshold;
    acStSave(ST_SETTINGS_KEY, acStSettings);
  }
  acStOnboard = {};
  acStUI.screen = 'home';
  acStUI.onboardingStep = 0;
  acStRender();
}

/* ======================= HOME ======================= */
function acStRenderHome(root) {
  const s = acStSettings;
  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>Shottimer</h2>
      <p class="sub">Startpiep en schotdetectie via de microfoon van je toestel — geen extra apparatuur nodig.</p>
    </div></div>

    <div class="dryfire-mode-fieldset">
      <div class="dryfire-mode-toggle" id="stModeToggle">
        <label><input type="radio" name="stMode" value="timer" ${s.mode==='timer'?'checked':''}> Timer</label>
        <label><input type="radio" name="stMode" value="par" ${s.mode==='par'?'checked':''}> Par</label>
      </div>

      <label class="st-field">Gevoeligheid (drempel): <span id="stSensVal">${s.sensitivity.toFixed(2)}</span>
        <input type="range" id="stSensRange" min="0.02" max="0.9" step="0.01" value="${s.sensitivity}">
      </label>
      <label class="st-field">Dode tijd na een schot: <span id="stDeadVal">${s.deadTimeMs}</span> ms
        <input type="range" id="stDeadRange" min="30" max="150" step="5" value="${s.deadTimeMs}">
      </label>

      <div class="st-field">
        <div class="dryfire-mode-toggle">
          <label><input type="radio" name="stStartMode" value="random" ${s.startMode==='random'?'checked':''}> Willekeurige vertraging</label>
          <label><input type="radio" name="stStartMode" value="fixed" ${s.startMode==='fixed'?'checked':''}> Vaste vertraging</label>
        </div>
        <div id="stDelayRandomRow" ${s.startMode!=='random'?'hidden':''}>
          Van <input type="number" id="stDelayMin" value="${s.delayMin}" min="0.2" max="10" step="0.1" style="width:4.5em;"> tot
          <input type="number" id="stDelayMax" value="${s.delayMax}" min="0.2" max="10" step="0.1" style="width:4.5em;"> sec.
        </div>
        <div id="stDelayFixedRow" ${s.startMode!=='fixed'?'hidden':''}>
          <input type="number" id="stFixedDelay" value="${s.fixedDelay}" min="0.2" max="10" step="0.1" style="width:4.5em;"> sec.
        </div>
      </div>

      <label class="st-field">Verwacht aantal schoten (optioneel, auto-stop):
        <input type="number" id="stExpectedShots" value="${s.expectedShots ?? ''}" min="1" step="1" style="width:5em;">
      </label>
      <label class="st-field">Maximale duur in sec. (optioneel):
        <input type="number" id="stMaxDuration" value="${s.maxDurationSec ?? ''}" min="1" step="1" style="width:5em;">
      </label>

      <div id="stParFields" ${s.mode!=='par'?'hidden':''}>
        <div class="st-field">Par-tijden (sec., na de startpiep):</div>
        <div id="stParTimesList"></div>
        <button type="button" class="printbtn st-btn-secondary" id="stAddParTime" style="width:auto;padding:8px 16px;">+ Par-tijd toevoegen</button>
        <label class="st-field" style="margin-top:12px;"><input type="checkbox" id="stParDetection" ${s.parDetection?'checked':''}> Schotdetectie ook actief in Par-modus</label>
      </div>

      <label class="st-field" style="margin-top:16px;"><input type="checkbox" id="stDebugToggle" ${s.debugEnabled?'checked':''}> Debug/tuning-tools tonen</label>
    </div>

    <button type="button" class="printbtn dryfire-cta" id="stStartBtn" style="width:100%;padding:20px;font-size:18px;">START</button>

    <div class="st-onboard-nav" style="margin-top:16px;">
      <button type="button" class="printbtn st-btn-secondary" id="stReonboardBtn">Instellingen/kalibratie opnieuw doorlopen</button>
      <button type="button" class="printbtn st-btn-secondary" id="stHistoryBtn">Geschiedenis</button>
      ${s.debugEnabled ? `<button type="button" class="printbtn st-btn-secondary" id="stDebugBtn">Debug</button>` : ''}
    </div>
  `;

  const renderParTimes = () => {
    const wrap = document.getElementById('stParTimesList');
    if (!wrap) return;
    wrap.innerHTML = s.parTimes.map((t, i) => `
      <div class="st-partime-row">
        <input type="number" class="st-partime-input" data-idx="${i}" value="${t}" min="0.1" step="0.1">
        <button type="button" class="st-partime-del" data-idx="${i}" aria-label="Verwijder par-tijd">&times;</button>
      </div>
    `).join('');
    wrap.querySelectorAll('.st-partime-input').forEach(inp => {
      inp.addEventListener('change', () => {
        s.parTimes[parseInt(inp.dataset.idx,10)] = parseFloat(inp.value) || 0;
        acStSave(ST_SETTINGS_KEY, s);
      });
    });
    wrap.querySelectorAll('.st-partime-del').forEach(btn => {
      btn.addEventListener('click', () => {
        s.parTimes.splice(parseInt(btn.dataset.idx,10), 1);
        acStSave(ST_SETTINGS_KEY, s);
        renderParTimes();
      });
    });
  };
  renderParTimes();
  document.getElementById('stAddParTime').addEventListener('click', () => {
    s.parTimes.push((s.parTimes[s.parTimes.length-1] || 0) + 2);
    acStSave(ST_SETTINGS_KEY, s);
    renderParTimes();
  });

  root.querySelectorAll('input[name="stMode"]').forEach(r => r.addEventListener('change', () => {
    s.mode = r.value; acStSave(ST_SETTINGS_KEY, s); acStRenderHome(root);
  }));
  root.querySelectorAll('input[name="stStartMode"]').forEach(r => r.addEventListener('change', () => {
    s.startMode = r.value; acStSave(ST_SETTINGS_KEY, s); acStRenderHome(root);
  }));
  document.getElementById('stSensRange').addEventListener('input', (e) => {
    s.sensitivity = parseFloat(e.target.value);
    document.getElementById('stSensVal').textContent = s.sensitivity.toFixed(2);
    acStSave(ST_SETTINGS_KEY, s);
  });
  document.getElementById('stDeadRange').addEventListener('input', (e) => {
    s.deadTimeMs = parseInt(e.target.value, 10);
    document.getElementById('stDeadVal').textContent = s.deadTimeMs;
    acStSave(ST_SETTINGS_KEY, s);
  });
  ['stDelayMin','stDelayMax','stFixedDelay'].forEach(id=>{
    const el2 = document.getElementById(id);
    if (!el2) return;
    el2.addEventListener('change', () => {
      if (id==='stDelayMin') s.delayMin = parseFloat(el2.value)||0;
      if (id==='stDelayMax') s.delayMax = parseFloat(el2.value)||0;
      if (id==='stFixedDelay') s.fixedDelay = parseFloat(el2.value)||0;
      acStSave(ST_SETTINGS_KEY, s);
    });
  });
  document.getElementById('stExpectedShots').addEventListener('change', (e) => {
    s.expectedShots = e.target.value ? parseInt(e.target.value,10) : null; acStSave(ST_SETTINGS_KEY, s);
  });
  document.getElementById('stMaxDuration').addEventListener('change', (e) => {
    s.maxDurationSec = e.target.value ? parseInt(e.target.value,10) : null; acStSave(ST_SETTINGS_KEY, s);
  });
  const parDetCb = document.getElementById('stParDetection');
  if (parDetCb) parDetCb.addEventListener('change', () => { s.parDetection = parDetCb.checked; acStSave(ST_SETTINGS_KEY, s); });
  document.getElementById('stDebugToggle').addEventListener('change', (e) => {
    s.debugEnabled = e.target.checked; acStSave(ST_SETTINGS_KEY, s); acStRenderHome(root);
  });

  document.getElementById('stStartBtn').addEventListener('click', () => { acStStartRun(); });
  document.getElementById('stReonboardBtn').addEventListener('click', () => { acStUI.screen='onboarding'; acStUI.onboardingStep=0; acStRender(); });
  document.getElementById('stHistoryBtn').addEventListener('click', () => { acStUI.screen='history'; acStRender(); });
  const dbgBtn = document.getElementById('stDebugBtn');
  if (dbgBtn) dbgBtn.addEventListener('click', () => { acStUI.screen='debug'; acStRender(); });
}

/* ======================= RUNNING ======================= */
function acStRenderRunning(root) {
  root.innerHTML = `
    <div class="st-running">
      <div class="st-running-mode">${acStRun && acStRun.mode==='par' ? 'PAR' : 'TIMER'}</div>
      <div class="st-running-time" id="stRunningTime">0.00</div>
      <div class="st-running-shots" id="stRunningShots"></div>
      <button type="button" class="printbtn st-stop-btn" id="stStopBtn">STOP</button>
    </div>
  `;
  document.getElementById('stStopBtn').addEventListener('click', () => acStStopRun('handmatig gestopt'));
  acStRenderRunningShots();
}
function acStRenderRunningTime() {
  const el2 = document.getElementById('stRunningTime');
  if (!el2 || !acStRun) return;
  if (acStRun.startFrame == null) { el2.textContent = '…'; return; }
  const elapsed = (acStRun.ctx.currentTime * acStRun.sampleRate - acStRun.startFrame) / acStRun.sampleRate;
  el2.textContent = acStFmt2(Math.max(0, elapsed));
}
function acStRenderRunningShots() {
  const el2 = document.getElementById('stRunningShots');
  if (!el2 || !acStRun) return;
  el2.textContent = acStRun.shots.length + ' schot' + (acStRun.shots.length===1?'':'en');
}

/* ======================= REVIEW ======================= */
function acStRenderReview(root) {
  const run = acStUI.reviewRun;
  if (!run) { acStUI.screen = 'home'; return acStRenderHome(root); }
  const active = run.shots.filter(s => !s.voided).sort((a,b)=>a.timeSec-b.timeSec);
  const total = active.length ? active[active.length-1].timeSec : 0;
  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>Resultaat</h2>
      <p class="sub">${run.mode==='par'?'Par':'Timer'} · start via: ${run.startMethod || 'onbekend'}${run.stopNote ? ' · ' + run.stopNote : ''}</p>
    </div></div>
    <div class="st-review-summary">
      <div><span>Eerste schot</span><strong>${active.length ? acStFmt2(active[0].timeSec) : '—'}</strong></div>
      <div><span>Totaal</span><strong>${acStFmt2(total)}</strong></div>
      <div><span>Aantal schoten</span><strong>${active.length}</strong></div>
    </div>
    <div id="stReviewList" class="profile-card"></div>
    <div class="st-onboard-nav" style="margin-top:16px;">
      <button type="button" class="printbtn st-btn-secondary" id="stReviewHome">Terug naar Shottimer</button>
      <button type="button" class="printbtn" id="stReviewAgain">Nog een keer</button>
    </div>
  `;
  acStRenderReviewList(run);
  document.getElementById('stReviewHome').addEventListener('click', () => { acStUI.screen='home'; acStUI.reviewRun=null; acStRender(); });
  document.getElementById('stReviewAgain').addEventListener('click', () => { acStUI.screen='home'; acStUI.reviewRun=null; acStRender(); acStStartRun(); });
}
function acStRenderReviewList(run) {
  const wrap = document.getElementById('stReviewList');
  if (!wrap) return;
  const sortedAll = run.shots.map((s, idx) => ({ ...s, idx })).sort((a,b)=>a.timeSec-b.timeSec);
  let prevActive = 0, n = 0;
  wrap.innerHTML = sortedAll.map(s => {
    let splitLabel = '';
    if (!s.voided) { n++; splitLabel = `#${n} — split ${acStFmt2(s.timeSec - prevActive)}s (${acStFmt2(s.timeSec)}s totaal)`; prevActive = s.timeSec; }
    else splitLabel = `${acStFmt2(s.timeSec)}s — vals schot (buiten telling)`;
    return `<div class="st-review-row${s.voided?' voided':''}">
      <span>${splitLabel}</span>
      <button type="button" class="st-btn-void" data-idx="${s.idx}">${s.voided ? 'Terugzetten' : 'Verwijderen'}</button>
    </div>`;
  }).join('') || '<p class="hint">Geen schoten gedetecteerd.</p>';
  wrap.querySelectorAll('.st-btn-void').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      run.shots[idx].voided = !run.shots[idx].voided;
      acStUpdateHistoryEntry(run);
      acStRenderReviewList(run);
      acStRenderReviewSummary(run);
    });
  });
}
function acStRenderReviewSummary(run) {
  const active = run.shots.filter(s => !s.voided).sort((a,b)=>a.timeSec-b.timeSec);
  const total = active.length ? active[active.length-1].timeSec : 0;
  const summary = document.querySelector('.st-review-summary');
  if (!summary) return;
  summary.innerHTML = `
    <div><span>Eerste schot</span><strong>${active.length ? acStFmt2(active[0].timeSec) : '—'}</strong></div>
    <div><span>Totaal</span><strong>${acStFmt2(total)}</strong></div>
    <div><span>Aantal schoten</span><strong>${active.length}</strong></div>
  `;
}

/* ======================= HISTORIE ======================= */
function acStRenderHistory(root) {
  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>Geschiedenis</h2>
      <p class="sub">Lokaal opgeslagen runs, nieuwste eerst.</p>
    </div>
    <button type="button" class="printbtn st-btn-secondary" id="stHistoryClear" style="width:auto;padding:10px 18px;">Wis alles</button>
    </div>
    <div id="stHistoryList"></div>
    <button type="button" class="printbtn st-btn-secondary dryfire-backbtn" id="stHistoryBack">Terug</button>
  `;
  const list = document.getElementById('stHistoryList');
  if (!acStHistory.length) {
    list.innerHTML = '<p class="hint">Nog geen runs opgeslagen.</p>';
  } else {
    list.innerHTML = acStHistory.map(h => {
      const active = h.shots.filter(s=>!s.voided);
      const total = active.length ? Math.max(...active.map(s=>s.timeSec)) : 0;
      const d = new Date(h.date);
      return `<div class="profile-card">
        <div class="profile-card-head"><span class="profile-card-name">${h.mode==='par'?'Par':'Timer'} — ${d.toLocaleDateString('nl-NL')} ${d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}</span></div>
        <div class="profile-card-meta">${active.length} schoten · totaal ${acStFmt2(total)}s</div>
        <div class="profile-card-actions"><button type="button" class="st-history-del" data-id="${h.id}">Verwijderen</button></div>
      </div>`;
    }).join('');
    list.querySelectorAll('.st-history-del').forEach(btn => {
      btn.addEventListener('click', () => {
        acStHistory = acStHistory.filter(h => h.id !== btn.dataset.id);
        acStSave(ST_HISTORY_KEY, acStHistory);
        acStRenderHistory(root);
      });
    });
  }
  document.getElementById('stHistoryClear').addEventListener('click', () => {
    if (!confirm('Alle Shottimer-geschiedenis wissen?')) return;
    acStHistory = [];
    acStSave(ST_HISTORY_KEY, acStHistory);
    acStRenderHistory(root);
  });
  document.getElementById('stHistoryBack').addEventListener('click', () => { acStUI.screen='home'; acStRender(); });
}

/* ======================= DEBUG ======================= */
let acStDebugLog = [];
function acStDebugOnLevel(peak) {
  const bar = document.getElementById('stDebugMeterFill');
  if (bar) bar.style.width = Math.min(100, peak * 111) + '%';
}
async function acStStartDebugTap() {
  await acStRequestMic();
  await acStEnsureWorklet();
  acStWorkletConfig(acStWorkletNode);
  const source = acStConnectMicToWorklet();
  acStWorkletNode.port.postMessage({ type: 'reset' });
  acStWorkletNode.port.postMessage({ type: 'setMode', mode: 'listening' });
  acStWorkletNode.port.postMessage({ type: 'maskUntil', frame: 0 });
  acStWorkletNode.port.onmessage = (e) => {
    if (e.data.type === 'level') acStDebugOnLevel(e.data.peak);
    if (e.data.type === 'shot') {
      acStDebugLog.unshift({ t: Date.now(), label: `schot — amplitude ${e.data.amplitude.toFixed(3)}` });
      acStDebugLog = acStDebugLog.slice(0, 100);
      acStDebugRenderLog();
    }
  };
  acStDebugTap = { source, active: true };
}
function acStStopDebugTap() {
  if (acStDebugTap) { try { acStDebugTap.source.disconnect(); } catch (e) {} acStDebugTap = null; }
  if (acStWorkletNode) { acStWorkletNode.port.postMessage({ type: 'setMode', mode: 'idle' }); acStWorkletNode.port.onmessage = (e) => acStOnWorkletMessage(e.data); }
}
function acStDebugRenderLog() {
  const wrap = document.getElementById('stDebugLog');
  if (!wrap) return;
  wrap.innerHTML = acStDebugLog.map(l => `<div class="st-debug-log-row">${new Date(l.t).toLocaleTimeString('nl-NL')} — ${l.label}</div>`).join('') || '<p class="hint">Nog geen events.</p>';
}

function acStRenderDebug(root) {
  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>Debug / tuning</h2>
      <p class="sub">Live niveaumeter, event-log en offline test met een geüpload audiobestand.</p>
    </div></div>

    <div class="st-field">Live niveau (t.o.v. gevoeligheidsdrempel):</div>
    <div class="st-debug-meter"><div class="st-debug-meter-fill" id="stDebugMeterFill"></div><div class="st-debug-meter-threshold" style="left:${Math.min(100, acStSettings.sensitivity*111)}%"></div></div>
    <button type="button" class="printbtn st-btn-secondary" id="stDebugTapToggle" style="width:auto;padding:10px 18px;margin-top:10px;">Start meeluisteren</button>

    <div class="st-field" style="margin-top:20px;">Event-log:</div>
    <div id="stDebugLog" class="st-debug-log"></div>
    <button type="button" class="printbtn st-btn-secondary" id="stDebugLogClear" style="width:auto;padding:8px 16px;">Wis log</button>

    <div class="st-field" style="margin-top:20px;">Audiobestand testen (offline, geen baan nodig):</div>
    <input type="file" id="stDebugFileInput" accept="audio/*">
    <div id="stDebugFileResult" class="hint" style="margin-top:8px;"></div>

    <button type="button" class="printbtn st-btn-secondary dryfire-backbtn" id="stDebugBack">Terug</button>
  `;
  acStDebugRenderLog();
  let tapping = false;
  document.getElementById('stDebugTapToggle').addEventListener('click', async (e) => {
    tapping = !tapping;
    e.target.textContent = tapping ? 'Stop meeluisteren' : 'Start meeluisteren';
    if (tapping) await acStStartDebugTap(); else acStStopDebugTap();
  });
  document.getElementById('stDebugLogClear').addEventListener('click', () => { acStDebugLog = []; acStDebugRenderLog(); });
  document.getElementById('stDebugFileInput').addEventListener('change', acStDebugAnalyzeFile);
  document.getElementById('stDebugBack').addEventListener('click', () => { acStStopDebugTap(); acStUI.screen='home'; acStRender(); });
}

async function acStDebugAnalyzeFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const out = document.getElementById('stDebugFileResult');
  out.textContent = 'Analyseren…';
  try {
    const arrayBuf = await file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const tmpCtx = new AC();
    const audioBuf = await tmpCtx.decodeAudioData(arrayBuf);
    await tmpCtx.close();

    const offline = new OfflineAudioContext(1, audioBuf.length, audioBuf.sampleRate);
    await offline.audioWorklet.addModule('js/shottimer-worklet.js');
    const node = new AudioWorkletNode(offline, 'shottimer-processor');
    const events = [];
    node.port.onmessage = (ev) => { if (ev.data.type==='shot' || ev.data.type==='beep') events.push(ev.data); };
    node.port.postMessage({ type: 'config', threshold: acStSettings.sensitivity, deadTimeMs: acStSettings.deadTimeMs, highpassHz: 700, beepFreq: acStSettings.beepFreq });
    node.port.postMessage({ type: 'setMode', mode: 'listening' });
    node.port.postMessage({ type: 'maskUntil', frame: 0 });
    const src = offline.createBufferSource();
    src.buffer = audioBuf;
    src.connect(node).connect(offline.destination);
    src.start(0);
    await offline.startRendering();
    const shots = events.filter(ev=>ev.type==='shot');
    out.innerHTML = shots.length
      ? `${shots.length} schot(en) gedetecteerd op: ${shots.map(s=>acStFmt2(s.frame/audioBuf.sampleRate)+'s').join(', ')}`
      : 'Geen schoten gedetecteerd bij de huidige gevoeligheid.';
  } catch (err) {
    out.textContent = 'Analyse mislukt: ' + (err.message || err);
  }
}

/* ======================= INIT ======================= */
let acStInited = false;
function initShottimer() {
  if (acStInited) return;
  acStInited = true;
  acStRender();
}

window.AppliedConceptsShottimer = { init: initShottimer, stopTimer: acStStopTimer };
