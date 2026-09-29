/* ---------------------------------------------------------------------
   Applied Concepts — Dope Card
   Digitale pols-dope kaart: fullscreen overlay met een dope-grid, een
   windklok en een target card (max 6 doelen). Herbruikt het bestaande
   wapenprofiel (js/profiles.js) voor BC/V0/dragModel/zero — geen aparte
   profielenlijst — en de SIGHTS/MOUNTS-HOB-data uit js/app.js voor de
   richtmiddelhoogte-picker. Ballistiek via js/ballistics.js
   (computeDopeCardTable + computeAtmosphere).
   Valt gewoon achter de pass-phrase gate; niets hier omzeilt die.
--------------------------------------------------------------------- */

const DC_SETTINGS_KEY = 'ac_dopecard_settings_v1';
const DC_WIND_KEY = 'ac_dopecard_wind_v1';
const DC_TARGETS_KEY = 'ac_dopecard_targets_v1';
const DC_NOTES_KEY = 'ac_dopecard_notes_v1';
const DC_MAX_TARGETS = 6;

// Moet in de pas blijven met .dc-wind-cell's flex-gewicht in css/styles.css —
// het windvak toont 4 regels tekst en heeft dus meer ruimte nodig dan één
// normale afstandsregel (gewicht 1); anders lopen label/sub-tekst over in
// het blok eronder (precies het "streep door EFF WIND"-probleem).
const DC_WIND_CELL_WEIGHT = 4.5;

const DC_DEFAULT_SETTINGS = {
  activeProfileId: null,
  envMode: 'altitude', envTempC: 15, envAltitudeM: 0, envPressureHpa: 1013.25, envDaFt: 0,
  rangeStart: 200, rangeEnd: 980, rangeInterval: 20,
  wristMode: 'device', theme: 'day',
  windStep: 0.5,
  windUnit: 'ms', // 'ms' | 'mph' — puur weergave; intern blijft alles m/s (fysica/clamp ongewijzigd)
  windCellMode: 'wind', // 'wind' | 'spindrift' | 'combined' — welke waarde de kolommen tonen
  printMode: 'wind', // 'wind' | 'spindrift' | 'both' | 'combined' — welke kolom(men) op de geprinte kaart
};
const DC_MPH_PER_MS = 2.236936;
const BALLISTICS_FT_PER_M_DC = 3.280839895;
function dcSpeedUnitLabel(){ return dcSettings.windUnit === 'mph' ? 'mph' : 'm/s'; }
function dcFmtSpeedMps(mps){
  return ((dcSettings.windUnit === 'mph' ? mps * DC_MPH_PER_MS : mps)).toFixed(1);
}
// 5.0 m/s @ 3:00 doubles as the spec's own worked example (R5.0) — a sane,
// checkable default rather than an arbitrary one.
const DC_DEFAULT_WIND = { speedMps: 5.0, angleDeg: 90 };

function dcLoad(key, fallback){
  try { const raw = JSON.parse(localStorage.getItem(key)); return raw == null ? fallback : raw; }
  catch(e){ return fallback; }
}
function dcSave(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e){ /* opslag niet beschikbaar — sessie werkt door */ }
}

let dcSettings = Object.assign({}, DC_DEFAULT_SETTINGS, dcLoad(DC_SETTINGS_KEY, {}));
let dcWind = Object.assign({}, DC_DEFAULT_WIND, dcLoad(DC_WIND_KEY, {}));
// Wind blijft intern altijd m/s; een eenheid-wissel (m/s <-> mph) zonder
// herberekening liet een net getal in de ene eenheid (bv. 1.9 m/s) er lelijk
// uitzien in de andere (4.2 mph). Rond de opgeslagen waarde bij het laden
// eenmalig af naar een net veelvoud van de windstap, in de actief gekozen
// eenheid, zodat de kaart altijd nette getallen toont.
(function dcSnapWindToStep(){
  const mphMode = dcSettings.windUnit === 'mph';
  const display = mphMode ? dcWind.speedMps * DC_MPH_PER_MS : dcWind.speedMps;
  const snappedDisplay = Math.round(display / dcSettings.windStep) * dcSettings.windStep;
  const snappedMps = mphMode ? snappedDisplay / DC_MPH_PER_MS : snappedDisplay;
  if(Math.abs(snappedMps - dcWind.speedMps) > 1e-4){
    dcWind.speedMps = Math.max(0, Math.min(20, snappedMps));
    dcSave(DC_WIND_KEY, dcWind);
  }
})();
let dcTargets = dcLoad(DC_TARGETS_KEY, []);
let dcNotes = dcLoad(DC_NOTES_KEY, {}); // { [afstand]: {sector, desc, note} }
let dcNotesEditing = null; // afstand waarvan de editor open staat
let dcActiveTargetIdx = null;
let dcTable = null; // Map<distanceM, {elevMil, driftMilPerMps}>

let dcScreen = 'dope';
let dcOverlayEl = null;
let dcWakeLock = null;
let dcRotationDeg = 0;
let dcOrientationMq = null;
let dcFallbackVideo = null;
// Alleen in-memory: gezet door ✕, gewist zodra de setup-screen weer bewust
// wordt opgeslagen — een paginaherlaad zelf reset dit dus wél (dat blijft
// gewoon "tik op tab -> direct fullscreen" als er al een profiel is).
let dcAutoEnterSuppressed = false;

/* ---- Profiel + HOB + atmosfeer -> ballistiek-tabel ---- */
function dcGetActiveProfile(){
  const profiles = window.AppliedConceptsProfiles.load();
  return profiles.find(p => p.id === dcSettings.activeProfileId) || null;
}
function dcRecomputeTable(){
  const profile = dcGetActiveProfile();
  if(!profile){ dcTable = null; return false; }
  // Richtmiddelhoogte komt rechtstreeks uit het wapenprofiel zelf
  // (toBallisticsInput's sightHeightCm) — geen aparte Dope Card-instelling.
  const input = window.AppliedConceptsProfiles.toBallisticsInput(profile);
  if(!input){ dcTable = null; return false; }
  let atmosphere;
  if(dcSettings.envMode === 'da'){
    atmosphere = window.AppliedConceptsBallistics.computeAtmosphereFromDensityAltitude(dcSettings.envDaFt / BALLISTICS_FT_PER_M_DC);
  } else {
    const atmInput = { tempC: dcSettings.envTempC };
    if(dcSettings.envMode === 'pressure') atmInput.pressureHpa = dcSettings.envPressureHpa;
    else atmInput.altitudeM = dcSettings.envAltitudeM;
    atmosphere = window.AppliedConceptsBallistics.computeAtmosphere(atmInput);
  }
  const spinParams = window.AppliedConceptsProfiles.spinDriftParams(profile); // null als het profiel geen (volledige) twist/afmetingen heeft — spindrift dan simpelweg niet beschikbaar
  dcTable = window.AppliedConceptsBallistics.computeDopeCardTable(input, atmosphere, dcDistances(), spinParams);
  return true;
}

/* ---- Afstanden / blokken / kolommen ---- */
function dcDistances(){
  const arr = [];
  const { rangeStart:s, rangeEnd:e, rangeInterval:i } = dcSettings;
  for(let d = s; d <= e; d += i) arr.push(Math.round(d));
  return arr;
}
function dcBlocksFrom(distances){
  const byHundred = new Map();
  distances.forEach(d => {
    const h = Math.floor(d/100)*100;
    if(!byHundred.has(h)) byHundred.set(h, []);
    byHundred.get(h).push(d);
  });
  return [...byHundred.entries()].sort((a,b)=>a[0]-b[0]).map(([h,ds]) => ({ hundred:h, distances:ds }));
}
// Kolom 0 draagt ook het windvak, dus krijgt bij een oneven verdeling als
// eerste minder blokken — bij precies 8 blokken (het spec-voorbeeld) geeft
// dit exact 2/3/3, dus met het windvak 3/3/3: een nette 3x3.
function dcColumnsFrom(blocks){
  const n = blocks.length;
  const base = Math.floor(n/3);
  const counts = [base, base, base];
  let rem = n - base*3;
  for(let c=1; c<3 && rem>0; c++, rem--) counts[c]++;
  for(let c=0; c<3 && rem>0; c++, rem--) counts[c]++;
  const cols = [[],[],[]];
  let idx = 0;
  for(let c=0; c<3; c++){ for(let i=0; i<counts[c]; i++){ cols[c].push(blocks[idx++]); } }
  return cols;
}
// Schat of het raster op één (liggend) scherm past, vóór het opslaan —
// gebaseerd op de fysieke korte zijde van het scherm (screen.width/height
// i.p.v. window.inner*, want de fullscreen-modus vult straks de hele
// liggende viewport, ongeacht hoe het setup-scherm er nu (staand) bij staat).
function dcFitCheck(){
  const distances = dcDistances();
  const blocks = dcBlocksFrom(distances);
  const cols = dcColumnsFrom(blocks);
  const colWeights = cols.map((colBlocks, ci) => {
    let w = colBlocks.reduce((sum,b) => sum + b.distances.length, 0);
    if(ci === 0) w += DC_WIND_CELL_WEIGHT;
    return w;
  });
  const maxWeight = Math.max(1, ...colWeights);
  const landscapeHeightPx = Math.min(window.screen.width, window.screen.height);
  const rowHeightPx = landscapeHeightPx / maxWeight;
  return { blocks, cols, maxWeight, rowHeightPx, fits: rowHeightPx >= 24, totalBlocks: blocks.length, totalRows: distances.length };
}

/* ---- Wind ---- */
function dcEffWind(){
  const rad = dcWind.angleDeg * Math.PI/180;
  const sin = Math.sin(rad);
  const eff = dcWind.speedMps * Math.abs(sin);
  let dir = null;
  if(Math.abs(sin) > 1e-6) dir = (dcWind.angleDeg > 0 && dcWind.angleDeg < 180) ? 'R' : 'L';
  return { eff, dir };
}
function dcEffWindStr(){
  const { eff, dir } = dcEffWind();
  const s = dcFmtSpeedMps(eff);
  return (dir == null || s === '0.0') ? '0.0' : dir + s;
}
function dcClockLabel(){
  const hoursTotal = dcWind.angleDeg / 30;
  let hh = Math.floor(hoursTotal);
  const mm = Math.round((hoursTotal - hh) * 60);
  if(hh === 0) hh = 12;
  return `${hh}:${String(mm).padStart(2,'0')}`;
}
function dcSnapAngle(deg){ return (Math.round(deg/15)*15 + 360) % 360; }
// stepDisplay is in de momenteel gekozen eenheid (m/s of mph) — zo blijven
// de windstap-keuzes altijd nette getallen (0.5/1.0/2.0) in die eenheid,
// i.p.v. omgerekende m/s-waarden die er in mph lelijk uitzien (1.1/2.2/4.5).
function dcAdjustWindSpeed(stepDisplay){
  const mphMode = dcSettings.windUnit === 'mph';
  const currentDisplay = mphMode ? dcWind.speedMps * DC_MPH_PER_MS : dcWind.speedMps;
  const newDisplay = Math.round((currentDisplay + stepDisplay) * 10) / 10;
  const newMps = mphMode ? newDisplay / DC_MPH_PER_MS : newDisplay;
  dcWind.speedMps = Math.max(0, Math.min(20, newMps));
  dcSave(DC_WIND_KEY, dcWind);
  if(navigator.vibrate) navigator.vibrate(10);
  dcRenderFullscreen();
  dcFlashWindValue();
}
function dcFlashWindValue(){
  if(!dcOverlayEl) return;
  const el2 = dcOverlayEl.querySelector('.dc-wind-value, .dc-wind-speed-value');
  if(!el2) return;
  el2.classList.add('dc-flash');
  setTimeout(() => { if(el2) el2.classList.remove('dc-flash'); }, 150);
}

/* ---- Waarde-opmaak ---- */
function dcFmtElev(mil){ return mil.toFixed(1); }
function dcFmtWindHold(driftMilPerMps){
  const { eff, dir } = dcEffWind();
  const val = driftMilPerMps * eff;
  const s = val.toFixed(1);
  return (dir == null || s === '0.0') ? '0.0' : dir + s;
}
// Rechterwaarde per rij — wind-, spindrift- of gecombineerde hold,
// afhankelijk van de schakelaar in het windvak.
//
// Spindrift heeft geen "effectieve" component (hangt niet van de wind af).
// Bij een rechtsdraaiende loop (vrijwel elk modern geweer) drift de kogel
// naar RECHTS — de correctie om dat te compenseren is dus altijd naar
// LINKS (25-09-2026: dit stond eerder verkeerd om als R, gefixt).
function dcFmtRowRight(row){
  if(dcSettings.windCellMode === 'spindrift'){
    return (row && row.spinDriftMil != null) ? 'L' + row.spinDriftMil.toFixed(1) : '—';
  }
  if(dcSettings.windCellMode === 'combined'){
    return dcFmtCombinedHold(row);
  }
  return (row && row.driftMilPerMps != null) ? dcFmtWindHold(row.driftMilPerMps) : '—';
}
// Wind en spindrift natuurkundig correct samengevoegd tot één ondertekende
// waarde — het teken (dus of ze optellen of van elkaar afgaan) volgt puur
// uit de actuele windrichting: R + L (tegengesteld) trekken af, L + L
// (dezelfde kant als de spindrift) tellen op. Geen aparte instelling nodig.
function dcFmtCombinedHold(row){
  if(!row || row.driftMilPerMps == null) return '—';
  const { eff, dir } = dcEffWind();
  const windSigned = dir === 'R' ? row.driftMilPerMps * eff : dir === 'L' ? -(row.driftMilPerMps * eff) : 0;
  const spinSigned = row.spinDriftMil != null ? -row.spinDriftMil : 0; // rechtsdraaiend -> altijd L-correctie
  const total = windSigned + spinSigned;
  const s = Math.abs(total).toFixed(1);
  return s === '0.0' ? '0.0' : (total > 0 ? 'R' : 'L') + s;
}

/* ---- Rotatie: fysieke aanraakcoördinaten -> logische (voor-rotatie) delta.
   Alleen 0/±90° nodig (device/links/rechts), dus eenvoudige branching i.p.v.
   volledige trigonometrie — en dus ook zonder afhankelijkheid van exacte
   viewport-afmetingen op het moment van de aanraking. ---- */
function dcLogicalDelta(dx, dy){
  if(dcRotationDeg === -90) return { dx:-dy, dy:dx };
  if(dcRotationDeg === 90) return { dx:dy, dy:-dx };
  return { dx, dy };
}

/* ---- Generieke tik/swipe-detectie (Pointer Events: werkt met zowel
   touch als muis, dus ook testbaar in een gewone browser). ---- */
function dcAttachSwipeOrTap(el, { onTap, onSwipe }){
  let sx=0, sy=0, active=false;
  el.addEventListener('pointerdown', e => {
    sx = e.clientX; sy = e.clientY; active = true;
    try { el.setPointerCapture(e.pointerId); } catch(err){}
  });
  el.addEventListener('pointerup', e => {
    if(!active) return;
    active = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if(Math.hypot(dx,dy) < 20){ if(onTap) onTap(); }
    else if(onSwipe){ onSwipe(dcLogicalDelta(dx,dy)); }
  });
}
function dcAttachDialDrag(svgEl){
  function handleMove(clientX, clientY){
    const rect = svgEl.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const logical = dcLogicalDelta(clientX - cx, clientY - cy);
    let angle = Math.atan2(logical.dx, -logical.dy) * 180/Math.PI;
    if(angle < 0) angle += 360;
    dcWind.angleDeg = dcSnapAngle(angle);
    dcSave(DC_WIND_KEY, dcWind);
    dcDialLiveUpdate();
  }
  svgEl.addEventListener('pointerdown', e => {
    try { svgEl.setPointerCapture(e.pointerId); } catch(err){}
    handleMove(e.clientX, e.clientY);
    const onMove = ev => handleMove(ev.clientX, ev.clientY);
    svgEl.addEventListener('pointermove', onMove);
    svgEl.addEventListener('pointerup', function onUp(){
      svgEl.removeEventListener('pointermove', onMove);
      svgEl.removeEventListener('pointerup', onUp);
    });
  });
}
function dcDialLiveUpdate(){
  if(!dcOverlayEl) return;
  const svg = dcOverlayEl.querySelector('[data-role="dial"]');
  if(svg){
    const cx=50, cy=50, r=40;
    const rad = dcWind.angleDeg * Math.PI/180;
    const bx = cx + r*Math.sin(rad), by = cy - r*Math.cos(rad);
    const line = svg.querySelector('.dc-dial-line');
    const handle = svg.querySelector('.dc-dial-handle');
    if(line){ line.setAttribute('x2', bx.toFixed(2)); line.setAttribute('y2', by.toFixed(2)); }
    if(handle){ handle.setAttribute('cx', bx.toFixed(2)); handle.setAttribute('cy', by.toFixed(2)); }
  }
  const effEl = dcOverlayEl.querySelector('[data-role="effval"]');
  if(effEl) effEl.textContent = dcEffWindStr();
}

/* ---- Doelen ---- */
// Notities per doel (sector/omschrijving/notitie), gekoppeld aan de afstand.
// Verdwijnen samen met het doel (deselecteren of CLR) — geen losse restjes.
function dcNoteFor(d){ return dcNotes[d] || null; }
function dcNoteHasContent(n){ return !!(n && (n.sector || n.desc || n.note || dcNoteAngle(n) != null)); }
function dcNoteAngle(n){
  if(!n || n.angle === '' || n.angle == null) return null;
  const a = parseFloat(n.angle);
  return isNaN(a) ? null : a;
}
// Improved Rifleman's Rule: reken de hold uit op de daadwerkelijke
// (slant-)afstand — zoals de rest van de Dope Card al doet — en
// vermenigvuldig die met cos(hoek). Dat is nauwkeuriger dan de klassieke
// Rifleman's Rule (die de hold op de horizontale afstand D·cosθ opzoekt),
// vooral bij grotere hoeken/afstanden. Windhold/spindrift blijven
// ongemoeid: die hangen niet wezenlijk af van de schothoek.
function dcInclinedElevMil(elevMil, angleDeg){
  if(elevMil == null || angleDeg == null) return elevMil;
  return elevMil * Math.cos(angleDeg * Math.PI / 180);
}
function dcSaveNotes(){ dcSave(DC_NOTES_KEY, dcNotes); }

function dcToggleTarget(d){
  const idx = dcTargets.indexOf(d);
  if(idx >= 0){ dcTargets.splice(idx,1); delete dcNotes[d]; dcSaveNotes(); }
  else {
    if(dcTargets.length >= DC_MAX_TARGETS){ dcShowToast(`Max ${DC_MAX_TARGETS} doelen`); return; }
    dcTargets.push(d);
  }
  dcSave(DC_TARGETS_KEY, dcTargets);
  dcRenderFullscreen();
}
function dcShowToast(msg){
  if(!dcOverlayEl) return;
  const toast = dcOverlayEl.querySelector('#dcToast');
  if(!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(() => { if(toast) toast.hidden = true; }, 1000);
}

/* ---- Fullscreen lifecycle ---- */
function dcOnResize(){ dcApplyRotation(); }
function dcOnVisibility(){ if(!document.hidden && dcOverlayEl) dcAcquireWakeLock(); }
function dcPreventGesture(e){ e.preventDefault(); }
function dcPreventMultiTouch(e){ if(e.touches && e.touches.length > 1) e.preventDefault(); }

function dcApplyRotation(){
  if(!dcOverlayEl) return;
  const isPortrait = window.matchMedia('(orientation: portrait)').matches;
  dcOverlayEl.classList.remove('dc-rot-left','dc-rot-right');
  dcRotationDeg = 0;
  if(dcSettings.wristMode !== 'device' && isPortrait){
    if(dcSettings.wristMode === 'left'){ dcOverlayEl.classList.add('dc-rot-left'); dcRotationDeg = -90; }
    else { dcOverlayEl.classList.add('dc-rot-right'); dcRotationDeg = 90; }
  }
}

async function dcAcquireWakeLock(){
  try {
    if(navigator.wakeLock){ dcWakeLock = await navigator.wakeLock.request('screen'); return; }
  } catch(e){ dcWakeLock = null; }
  dcStartSilentVideoFallback();
}
function dcReleaseWakeLock(){
  if(dcWakeLock){ try { dcWakeLock.release(); } catch(e){} dcWakeLock = null; }
  dcStopSilentVideoFallback();
}
// Best-effort fallback voor toestellen zonder Wake Lock API: neemt zelf een
// paar frames van een leeg canvas op tot een geldige video en speelt die
// geluidloos in een loop af (video afspelen houdt op oudere platforms het
// scherm ook wakker) — geen los video-bestand nodig, puur in-browser gegenereerd.
function dcStartSilentVideoFallback(){
  if(dcFallbackVideo || !window.MediaRecorder) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 2; canvas.height = 2;
    const stream = canvas.captureStream(1);
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = e => { if(e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type:'video/webm' });
      const video = document.createElement('video');
      video.src = URL.createObjectURL(blob);
      video.loop = true; video.muted = true; video.playsInline = true;
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(video);
      video.play().catch(()=>{});
      dcFallbackVideo = video;
    };
    recorder.start();
    setTimeout(() => recorder.stop(), 300);
  } catch(e){ /* best-effort — Wake Lock is het primaire pad op het doelplatform */ }
}
function dcStopSilentVideoFallback(){
  if(dcFallbackVideo){ dcFallbackVideo.pause(); dcFallbackVideo.remove(); dcFallbackVideo = null; }
}

function dcEnterFullscreen(){
  dcScreen = 'dope';
  dcOverlayEl = document.createElement('div');
  dcOverlayEl.className = 'dc-overlay';
  document.body.appendChild(dcOverlayEl);
  dcOverlayEl.addEventListener('touchmove', dcPreventMultiTouch, { passive:false });
  document.addEventListener('gesturestart', dcPreventGesture);
  dcApplyRotation();
  dcRenderFullscreen();
  dcAcquireWakeLock();
  window.addEventListener('resize', dcOnResize);
  document.addEventListener('visibilitychange', dcOnVisibility);
  dcOrientationMq = window.matchMedia('(orientation: portrait)');
  dcOrientationMq.addEventListener('change', dcApplyRotation);
}
function dcTeardownFullscreen(){
  if(!dcOverlayEl) return;
  dcReleaseWakeLock();
  window.removeEventListener('resize', dcOnResize);
  document.removeEventListener('visibilitychange', dcOnVisibility);
  document.removeEventListener('gesturestart', dcPreventGesture);
  if(dcOrientationMq) dcOrientationMq.removeEventListener('change', dcApplyRotation);
  dcOverlayEl.remove();
  dcOverlayEl = null;
}
// returnTo 'setup' = ⚙ (blijft op de Dope Card-tab, normale layout, tik op
// de tab opent daarna gewoon weer direct fullscreen); 'app' = ✕ (sluit de
// Dope Card echt af — een volgende tik op de tab komt dan weer bij de
// instellingen uit, in plaats van meteen door te schieten naar fullscreen,
// tot je hem via "Opslaan & open Dope Card" bewust opnieuw start).
function dcExitFullscreen(returnTo){
  dcTeardownFullscreen();
  if(returnTo === 'app'){
    dcAutoEnterSuppressed = true;
    if(typeof switchTab === 'function') switchTab('optic');
  } else {
    dcRenderSetupScreenIfActive();
  }
}
function dcGoScreen(s){ dcScreen = s; dcNotesEditing = null; dcRenderFullscreen(); }

/* ---- Strip (rechterstrook: TGT / thema / instellingen / sluiten) ---- */
function dcStripHtml(){
  const n = dcTargets.length;
  return `<div class="dc-strip">
    <button class="dc-strip-btn dc-strip-tgt${n===0?' dc-dim':''}" data-act="tgt">TGT<span>${n||''}</span></button>
    <button class="dc-strip-btn" data-act="theme">${dcSettings.theme==='day'?'☾':dcSettings.theme==='night'?'NV':'☀'}</button>
    <button class="dc-strip-btn" data-act="settings">⚙</button>
    <button class="dc-strip-btn" data-act="close">✕</button>
  </div>`;
}
function dcWireStrip(){
  dcOverlayEl.querySelectorAll('.dc-strip-btn').forEach(b => {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if(act === 'tgt') dcGoScreen('target');
      else if(act === 'theme'){
        // Dag -> nacht -> nachtzicht (NVG) -> dag. NVG staat los van "nacht":
        // een NVG-bril/monoculair is extreem gevoelig voor licht, dus dit is
        // geen simpele donkere versie van het nachtthema maar diep rood op
        // zwart met minimale helderheid — voorkomt "whitout" van de bril en
        // beschermt je eigen donker-adaptatie.
        dcSettings.theme = dcSettings.theme==='day' ? 'night' : dcSettings.theme==='night' ? 'nv' : 'day';
        dcSave(DC_SETTINGS_KEY, dcSettings); dcRenderFullscreen();
      }
      else if(act === 'settings') dcExitFullscreen('setup');
      else if(act === 'close') dcExitFullscreen('app');
    });
  });
}

/* ---- Scherm A: Dope grid ---- */
function dcDopeScreenHtml(){
  const distances = dcDistances();
  const blocks = dcBlocksFrom(distances);
  const cols = dcColumnsFrom(blocks);
  const { dir } = dcEffWind();

  const colsHtml = cols.map((colBlocks, ci) => {
    const windCellHtml = ci === 0 ? `
      <div class="dc-wind-cell" data-role="windcell" style="flex:${DC_WIND_CELL_WEIGHT} 1 0;">
        <div class="dc-wind-info">
          <span class="dc-wind-badge">${dir || '—'}</span>
          <span class="dc-wind-value">${dcFmtSpeedMps(dcEffWind().eff)}</span>
          <span class="dc-wind-label">EFF WIND ${dcSpeedUnitLabel()}</span>
          <span class="dc-wind-sub">${dcFmtSpeedMps(dcWind.speedMps)} @ ${dcClockLabel()}</span>
        </div>
        <div class="dc-wind-mode-toggle" data-role="windmodetoggle">
          <button type="button" class="dc-wind-mode-btn${(!dcSettings.windCellMode||dcSettings.windCellMode==='wind')?' active':''}" data-mode="wind">WIND</button>
          <button type="button" class="dc-wind-mode-btn${dcSettings.windCellMode==='spindrift'?' active':''}" data-mode="spindrift">SPIN</button>
          <button type="button" class="dc-wind-mode-btn${dcSettings.windCellMode==='combined'?' active':''}" data-mode="combined">TOTAAL</button>
        </div>
      </div>` : '';
    const blocksHtml = colBlocks.map(block => {
      const rowsHtml = block.distances.map((d,i) => {
        const row = dcTable ? dcTable.get(d) : null;
        const elevStr = row && row.elevMil != null ? dcFmtElev(row.elevMil) : '—';
        const windStr = dcFmtRowRight(row);
        const selIdx = dcTargets.indexOf(d);
        const selected = selIdx >= 0;
        const isBadgeRow = i === 0 || selected;
        const badgeContent = selected ? (selIdx+1) : block.hundred;
        return `<div class="dc-row${selected?' dc-selected':''}" data-dist="${d}">
          <span class="dc-row-dist${isBadgeRow?' dc-badge':''}">${isBadgeRow ? badgeContent : d}</span>
          <span class="dc-row-elev">${elevStr}</span>
          <span class="dc-row-wind">${windStr}</span>
        </div>`;
      }).join('');
      return `<div class="dc-block" style="flex:${block.distances.length} 1 0;">${rowsHtml}</div>`;
    }).join('');
    return `<div class="dc-grid-col">${windCellHtml}${blocksHtml}</div>`;
  }).join('');

  return `<div class="dc-main"><div class="dc-grid">${colsHtml}</div><div class="dc-toast" id="dcToast" hidden></div></div>${dcStripHtml()}`;
}
function dcWireDopeScreen(){
  dcWireStrip();
  const windCell = dcOverlayEl.querySelector('[data-role="windcell"]');
  if(windCell) dcAttachSwipeOrTap(windCell, {
    onTap: () => dcGoScreen('wind'),
    onSwipe: (logical) => dcAdjustWindSpeed(logical.dy < 0 ? dcSettings.windStep : -dcSettings.windStep),
  });
  const modeToggle = dcOverlayEl.querySelector('[data-role="windmodetoggle"]');
  if(modeToggle){
    // Los van de swipe/tap-gesture op de rest van het windvak — anders zou
    // een tik op deze knoppen ook meteen naar het windscherm navigeren.
    modeToggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    modeToggle.addEventListener('pointerup', (e) => e.stopPropagation());
    modeToggle.querySelectorAll('.dc-wind-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dcSettings.windCellMode = btn.dataset.mode;
        dcSave(DC_SETTINGS_KEY, dcSettings);
        dcRenderFullscreen();
      });
    });
  }
  dcOverlayEl.querySelectorAll('.dc-row').forEach(row => {
    row.addEventListener('click', () => dcToggleTarget(parseInt(row.dataset.dist,10)));
  });
}

/* ---- Scherm B: Windscherm ---- */
function dcDialSvg(){
  const cx=50, cy=50;
  let ticks = '';
  for(let h=0; h<12; h++){
    const angle = h*30;
    const isLong = (h===3 || h===9);
    const rOuter=45, rInner = rOuter - (isLong?10:6);
    const rad = angle*Math.PI/180;
    const x1=cx+rOuter*Math.sin(rad), y1=cy-rOuter*Math.cos(rad);
    const x2=cx+rInner*Math.sin(rad), y2=cy-rInner*Math.cos(rad);
    ticks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="currentColor" stroke-width="${isLong?2:1}"/>`;
  }
  const rad = dcWind.angleDeg*Math.PI/180;
  const bx = cx + 40*Math.sin(rad), by = cy - 40*Math.cos(rad);
  return `<svg class="dc-dial-svg" viewBox="0 0 100 100" data-role="dial">
    <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-width="1"/>
    ${ticks}
    <line class="dc-dial-line" x1="50" y1="50" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="currentColor" stroke-width="2"/>
    <circle class="dc-dial-handle" cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="4" fill="currentColor"/>
  </svg>`;
}
function dcWindScreenHtml(){
  return `<div class="dc-main">
    <div class="dc-wind-screen">
      <div class="dc-wind-left">
        <button class="dc-wind-back" data-act="back">&larr; DOPE</button>
        <div class="dc-wind-speed-label">WIND SPEED ${dcSpeedUnitLabel()}</div>
        <div class="dc-wind-speed-value" data-role="speedval">${dcFmtSpeedMps(dcWind.speedMps)}</div>
        <div class="dc-wind-speed-hint">(swipe &uarr;&darr; &plusmn;${dcSettings.windStep.toFixed(1)})</div>
        <div class="dc-wind-pm">
          <button type="button" data-act="minus">&minus;</button>
          <button type="button" data-act="plus">+</button>
        </div>
        <div class="dc-eff-box">
          <div class="dc-eff-box-label">EFF WIND ${dcSpeedUnitLabel()}</div>
          <div class="dc-eff-box-value" data-role="effval">${dcEffWindStr()}</div>
        </div>
      </div>
      <div class="dc-wind-right">
        <div class="dc-dial-tgt">TGT</div>
        <div class="dc-dial-wrap">
          <div class="dc-dial-watermark" style="background-image:url('icons/logo.svg')"></div>
          ${dcDialSvg()}
        </div>
      </div>
    </div>
  </div>${dcStripHtml()}`;
}
function dcWireWindScreen(){
  dcWireStrip();
  const back = dcOverlayEl.querySelector('[data-act="back"]');
  if(back) back.addEventListener('click', () => dcGoScreen('dope'));
  const minus = dcOverlayEl.querySelector('[data-act="minus"]');
  const plus = dcOverlayEl.querySelector('[data-act="plus"]');
  if(minus) minus.addEventListener('click', () => dcAdjustWindSpeed(-dcSettings.windStep));
  if(plus) plus.addEventListener('click', () => dcAdjustWindSpeed(dcSettings.windStep));
  const speedVal = dcOverlayEl.querySelector('[data-role="speedval"]');
  if(speedVal) dcAttachSwipeOrTap(speedVal, { onSwipe: (logical) => dcAdjustWindSpeed(logical.dy < 0 ? dcSettings.windStep : -dcSettings.windStep) });
  const dial = dcOverlayEl.querySelector('[data-role="dial"]');
  if(dial) dcAttachDialDrag(dial);
}

/* ---- Scherm C: Target card ---- */
function dcTargetScreenHtml(){
  const rowsHtml = dcTargets.length ? dcTargets.map((d,i) => {
    const row = dcTable ? dcTable.get(d) : null;
    const n = dcNoteFor(d);
    const angle = dcNoteAngle(n);
    const adjElev = row && row.elevMil != null ? dcInclinedElevMil(row.elevMil, angle) : null;
    const elevStr = adjElev != null ? dcFmtElev(adjElev) : '—';
    const windStr = dcFmtRowRight(row);
    const active = dcActiveTargetIdx === i;
    const has = dcNoteHasContent(n);
    const angleLabel = angle != null ? `${angle > 0 ? '+' : ''}${angle}°` : ''; // getal + vaste tekens — geen escaping nodig
    const headLine = has ? [n.sector && dcEscapeHtml(n.sector), n.desc && dcEscapeHtml(n.desc), angleLabel].filter(Boolean).join(' · ') : '';
    const noteBox = has ? `<div class="dc-note-box">
        ${headLine ? `<div class="dc-note-head">${headLine}</div>` : ''}
        ${n.note ? `<div class="dc-note-text">${dcEscapeHtml(n.note)}</div>` : ''}
      </div>` : '<div class="dc-note-box dc-note-empty"></div>';
    return `<div class="dc-target-row${active?' dc-active':''}" data-idx="${i}">
      <span class="dc-target-num">T${i+1}</span>
      <span class="dc-target-rng">${d}</span>
      <button type="button" class="dc-notes-btn${has?' dc-has-note':''}" data-notes="${d}">NOTES</button>
      ${noteBox}
      <span class="dc-target-vals">${elevStr} ${windStr}</span>
    </div>`;
  }).join('') : `<div class="dc-target-empty">Nog geen doelen geselecteerd — tik op een afstandsregel in de Dope Card.</div>`;
  const editing = dcNotesEditing != null && dcTargets.includes(dcNotesEditing) ? dcNotesEditing : null;
  const editor = editing == null ? '' : (() => {
    const n = dcNoteFor(editing) || {};
    const ti = dcTargets.indexOf(editing) + 1;
    return `<div class="dc-notes-editor" data-role="noteseditor">
      <div class="dc-notes-editor-title">T${ti} · ${editing} m</div>
      <label>Sector<input type="text" id="dcNoteSector" maxlength="30" value="${dcEscapeHtml(n.sector||'')}" autocomplete="off"></label>
      <label>Omschrijving<input type="text" id="dcNoteDesc" maxlength="60" value="${dcEscapeHtml(n.desc||'')}" autocomplete="off"></label>
      <label>Notitie<input type="text" id="dcNoteNote" maxlength="120" value="${dcEscapeHtml(n.note||'')}" autocomplete="off"></label>
      <label>Inclinatie/declinatie (°, + omhoog / − omlaag)<input type="number" id="dcNoteAngle" step="1" min="-90" max="90" value="${dcEscapeHtml(n.angle ?? '')}" autocomplete="off" placeholder="leeg = geen correctie"></label>
      <p class="dc-notes-editor-hint">Past de hold van dit doel aan via de Improved Rifleman's Rule. Leeg = gewone hold voor deze afstand.</p>
      <div class="dc-notes-editor-actions">
        <button type="button" data-act="notesave">OPSLAAN</button>
        <button type="button" data-act="notecancel">ANNULEER</button>
        ${dcNoteHasContent(n) ? '<button type="button" data-act="notedelete">WISSEN</button>' : ''}
      </div>
    </div>`;
  })();
  return `<div class="dc-main">
    <div class="dc-target-screen">
      ${editor}
      <div class="dc-target-watermark" style="background-image:url('icons/logo.svg')"></div>
      <div class="dc-target-head">
        <button class="dc-wind-back" data-act="back">&larr; DOPE</button>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="dc-target-eff" data-role="efflabel">EFF ${dcEffWindStr()} ${dcSpeedUnitLabel()}</span>
          ${dcTargets.length ? '<button type="button" class="dc-target-clr" data-act="clr">CLR</button>' : ''}
        </div>
      </div>
      <div class="dc-target-rows">${rowsHtml}</div>
    </div>
  </div>${dcStripHtml()}`;
}
function dcWireTargetScreen(){
  dcWireStrip();
  const back = dcOverlayEl.querySelector('[data-act="back"]');
  if(back) back.addEventListener('click', () => dcGoScreen('dope'));
  const clr = dcOverlayEl.querySelector('[data-act="clr"]');
  if(clr) clr.addEventListener('click', () => {
    dcTargets = []; dcSave(DC_TARGETS_KEY, dcTargets);
    dcNotes = {}; dcNotesEditing = null; dcSaveNotes();
    dcGoScreen('dope');
  });
  dcOverlayEl.querySelectorAll('.dc-notes-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dcNotesEditing = parseInt(btn.dataset.notes, 10);
      dcRenderFullscreen();
      const first = dcOverlayEl.querySelector('#dcNoteSector');
      if(first) first.focus();
    });
  });
  const editor = dcOverlayEl.querySelector('[data-role="noteseditor"]');
  if(editor){
    const close = () => { dcNotesEditing = null; dcRenderFullscreen(); };
    editor.querySelector('[data-act="notecancel"]').addEventListener('click', close);
    editor.querySelector('[data-act="notesave"]').addEventListener('click', () => {
      const angleRaw = editor.querySelector('#dcNoteAngle').value.trim();
      const n = {
        sector: editor.querySelector('#dcNoteSector').value.trim(),
        desc: editor.querySelector('#dcNoteDesc').value.trim(),
        note: editor.querySelector('#dcNoteNote').value.trim(),
        angle: angleRaw === '' ? '' : Math.max(-90, Math.min(90, parseFloat(angleRaw))),
      };
      if(dcNoteHasContent(n)) dcNotes[dcNotesEditing] = n; else delete dcNotes[dcNotesEditing];
      dcSaveNotes();
      close();
    });
    const del = editor.querySelector('[data-act="notedelete"]');
    if(del) del.addEventListener('click', () => { delete dcNotes[dcNotesEditing]; dcSaveNotes(); close(); });
  }
  dcOverlayEl.querySelectorAll('.dc-target-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.idx,10);
      dcActiveTargetIdx = dcActiveTargetIdx === idx ? null : idx;
      dcRenderFullscreen();
    });
  });
  const effLabel = dcOverlayEl.querySelector('[data-role="efflabel"]');
  if(effLabel) dcAttachSwipeOrTap(effLabel, {
    onTap: () => dcGoScreen('wind'),
    onSwipe: (logical) => dcAdjustWindSpeed(logical.dy < 0 ? dcSettings.windStep : -dcSettings.windStep),
  });
}

/* ---- Render-dispatch ---- */
function dcRenderFullscreen(){
  if(!dcOverlayEl) return;
  dcOverlayEl.classList.remove('dc-theme-day','dc-theme-night','dc-theme-nv');
  dcOverlayEl.classList.add(dcSettings.theme === 'night' ? 'dc-theme-night' : dcSettings.theme === 'nv' ? 'dc-theme-nv' : 'dc-theme-day');
  const inner = dcScreen === 'dope' ? dcDopeScreenHtml() : dcScreen === 'wind' ? dcWindScreenHtml() : dcTargetScreenHtml();
  dcOverlayEl.innerHTML = `<div class="dc-rotor">${inner}</div>`;
  if(dcScreen === 'dope') dcWireDopeScreen();
  else if(dcScreen === 'wind') dcWireWindScreen();
  else dcWireTargetScreen();
}

/* ======================= PRINTEN (armmapje-kaartje) ======================= */
// 7,6 x 12,7 cm, liggend — zelfde leesrichting als de digitale (liggende)
// weergave. Eén index-card-formaat is te klein voor het hele dope-bereik in
// één 3-koloms raster zoals op het scherm; dit print daarom een platte
// lijst in 2 kolommen per kaartje, en verdeelt het volledige afstandsbereik
// over zoveel kaartjes als nodig (paginanummer rechtsboven op elk kaartje).
const DC_PRINT_W_IN = 12.7 / 2.54;
const DC_PRINT_H_IN = 7.6 / 2.54;
const DC_PRINT_MARGIN = 0.12;
const DC_PRINT_HEADER_H = 0.26;
const DC_PRINT_ROW_H = 0.135;
const DC_PRINT_FONT = 0.095;
const DC_PRINT_INK = '#171510';
const DC_PRINT_DIM = '#6e6e6a';

function dcEscapeHtml(str){
  return window.AppliedConceptsProfiles ? window.AppliedConceptsProfiles.escapeHtml(str) : String(str==null?'':str);
}

function dcBuildPrintPages(){
  const profile = dcGetActiveProfile();
  const label = profile ? profile.label : '';
  const distances = dcDistances();
  const mode = dcSettings.printMode || 'wind';

  const usableH = DC_PRINT_H_IN - 2*DC_PRINT_MARGIN - DC_PRINT_HEADER_H;
  const rowsPerCol = Math.max(1, Math.floor(usableH / DC_PRINT_ROW_H));
  const colGap = 0.12;
  const colW = (DC_PRINT_W_IN - 2*DC_PRINT_MARGIN - colGap) / 2;
  const rowsPerCard = rowsPerCol * 2;

  const totalCards = Math.max(1, Math.ceil(distances.length / rowsPerCard));
  const pages = [];
  for(let c = 0; c < totalCards; c++){
    const cardDistances = distances.slice(c*rowsPerCard, (c+1)*rowsPerCard);
    pages.push(dcPrintCardSvg(cardDistances, mode, label, c+1, totalCards, rowsPerCol, colW, colGap));
  }
  return pages;
}

function dcPrintCardSvg(cardDistances, mode, label, pageNum, totalPages, rowsPerCol, colW, colGap){
  const W = DC_PRINT_W_IN, H = DC_PRINT_H_IN, M = DC_PRINT_MARGIN;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}in" height="${H}in" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
  svg += `<text x="${M}" y="${(M+0.09).toFixed(3)}" font-size="0.1" font-family="'Oswald',sans-serif" font-weight="700" fill="${DC_PRINT_INK}">${dcEscapeHtml(label || 'DOPE CARD')}</text>`;
  svg += `<text x="${(W-M).toFixed(3)}" y="${(M+0.09).toFixed(3)}" text-anchor="end" font-size="0.08" font-family="'IBM Plex Mono',monospace" fill="${DC_PRINT_DIM}">${pageNum}/${totalPages}</text>`;
  const ruleY = M + DC_PRINT_HEADER_H - 0.06;
  svg += `<line x1="${M}" y1="${ruleY.toFixed(3)}" x2="${(W-M).toFixed(3)}" y2="${ruleY.toFixed(3)}" stroke="${DC_PRINT_INK}" stroke-width="0.01"/>`;

  const colXs = [M, M + colW + colGap];
  const topY = M + DC_PRINT_HEADER_H;
  colXs.forEach((colX, ci) => {
    const colDistances = cardDistances.slice(ci*rowsPerCol, (ci+1)*rowsPerCol);
    colDistances.forEach((d, ri) => {
      const y = topY + ri*DC_PRINT_ROW_H + DC_PRINT_ROW_H*0.75;
      const row = dcTable ? dcTable.get(d) : null;
      svg += dcPrintRowSvg(colX, y, colW, d, row, mode);
    });
  });
  svg += '</svg>';
  return svg;
}

function dcPrintRowSvg(x, y, w, dist, row, mode){
  const distW = w*0.22, elevW = w*0.3;
  const elevStr = row && row.elevMil != null ? dcFmtElev(row.elevMil) : '—';
  let s = `<text x="${x.toFixed(3)}" y="${y.toFixed(3)}" font-size="${DC_PRINT_FONT}" font-family="'IBM Plex Mono',monospace" fill="${DC_PRINT_DIM}">${dist}</text>`;
  s += `<text x="${(x+distW+elevW).toFixed(3)}" y="${y.toFixed(3)}" text-anchor="end" font-size="${DC_PRINT_FONT}" font-family="'IBM Plex Mono',monospace" font-weight="700" fill="${DC_PRINT_INK}">${elevStr}</text>`;
  if(mode === 'both'){
    const windStr = row && row.driftMilPerMps != null ? dcFmtWindHold(row.driftMilPerMps) : '—';
    const spinStr = row && row.spinDriftMil != null ? 'L' + row.spinDriftMil.toFixed(1) : '—';
    const halfW = (w - distW - elevW) / 2;
    s += `<text x="${(x+distW+elevW+halfW-0.03).toFixed(3)}" y="${y.toFixed(3)}" text-anchor="end" font-size="${DC_PRINT_FONT}" font-family="'IBM Plex Mono',monospace" fill="${DC_PRINT_INK}">${windStr}</text>`;
    s += `<text x="${(x+w).toFixed(3)}" y="${y.toFixed(3)}" text-anchor="end" font-size="${DC_PRINT_FONT}" font-family="'IBM Plex Mono',monospace" fill="${DC_PRINT_INK}">${spinStr}</text>`;
  } else {
    let valStr;
    if(mode === 'spindrift') valStr = row && row.spinDriftMil != null ? 'L' + row.spinDriftMil.toFixed(1) : '—';
    else if(mode === 'combined') valStr = dcFmtCombinedHold(row);
    else valStr = row && row.driftMilPerMps != null ? dcFmtWindHold(row.driftMilPerMps) : '—';
    s += `<text x="${(x+w).toFixed(3)}" y="${y.toFixed(3)}" text-anchor="end" font-size="${DC_PRINT_FONT}" font-family="'IBM Plex Mono',monospace" fill="${DC_PRINT_INK}">${valStr}</text>`;
  }
  return s;
}

function dcPrintDopeCard(){
  if(!dcTable) dcRecomputeTable();
  const batch = document.getElementById('dcPrintBatch');
  if(!batch) return;
  const pages = dcBuildPrintPages();
  batch.innerHTML = pages.map(svg => `
    <div class="page" style="width:${DC_PRINT_W_IN}in;height:${DC_PRINT_H_IN}in;">${svg}</div>
  `).join('');
  if(window.AppliedConceptsPrint) window.AppliedConceptsPrint('dopecard');
}

/* ======================= SETUP-SCHERM (normale app-layout) ======================= */
function dcRenderSetupScreenIfActive(){
  const root = document.getElementById('dopecardRoot');
  if(root) dcRenderSetup(root);
}
function dcRenderSetup(root){
  if(!root) return;
  const profiles = window.AppliedConceptsProfiles.load();

  if(profiles.length === 0){
    root.innerHTML = `
      <div class="simplepanel-head"><div><h2>Dope Card</h2>
        <p class="sub">Digitale dope-kaart voor op de pols — windklok, live windholds en een target card voor tot 6 doelen.</p>
      </div></div>
      <div class="dc-noprofile">
        <p class="hint">Je hebt nog geen wapenprofiel. Maak er eerst één aan bij "Wapenprofielen" (kaliber, drag model, BC, V0, zero-afstand) — de Dope Card gebruikt datzelfde profiel.</p>
        <button type="button" class="printbtn" id="dcNewProfileBtn" style="width:auto;padding:11px 22px;">Wapenprofiel aanmaken</button>
      </div>
    `;
    root.querySelector('#dcNewProfileBtn').addEventListener('click', () => {
      window.AppliedConceptsProfiles.openNewEditor();
      switchTab('profiles');
    });
    return;
  }

  if(!dcSettings.activeProfileId || !profiles.find(p=>p.id===dcSettings.activeProfileId)){
    dcSettings.activeProfileId = profiles[0].id;
  }

  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>Dope Card</h2>
      <p class="sub">Digitale dope-kaart voor op de pols — windklok, live windholds en een target card voor tot 6 doelen.</p>
    </div></div>

    <fieldset class="dryfire-mode-fieldset">
      <legend>Wapen/munitie-profiel</legend>
      <label for="dcProfile">Actief profiel</label>
      <select id="dcProfile">
        ${profiles.map(p=>`<option value="${p.id}" ${p.id===dcSettings.activeProfileId?'selected':''}>${window.AppliedConceptsProfiles.escapeHtml(p.label||'(zonder naam)')}${p.caliber?' — '+window.AppliedConceptsProfiles.escapeHtml(p.caliber):''}</option>`).join('')}
      </select>
      <p class="hint" id="dcProfileError"></p>
    </fieldset>

    <fieldset class="dryfire-mode-fieldset">
      <legend>Omgeving</legend>
      <div class="dryfire-mode-toggle">
        <label><input type="radio" name="dcEnvMode" value="altitude" ${dcSettings.envMode==='altitude'?'checked':''}> Hoogte (m)</label>
        <label><input type="radio" name="dcEnvMode" value="pressure" ${dcSettings.envMode==='pressure'?'checked':''}> Luchtdruk (hPa)</label>
        <label><input type="radio" name="dcEnvMode" value="da" ${dcSettings.envMode==='da'?'checked':''}> Density altitude</label>
      </div>

      <div id="dcTempWrap" ${dcSettings.envMode==='da'?'hidden':''}>
        <label for="dcTemp">Temperatuur (°C)</label>
        <input type="number" id="dcTemp" step="1" value="${dcSettings.envTempC}">
      </div>
      <input type="number" id="dcAltitude" step="10" value="${dcSettings.envAltitudeM}" ${dcSettings.envMode!=='altitude'?'hidden':''}>
      <input type="number" id="dcPressure" step="1" value="${dcSettings.envPressureHpa}" ${dcSettings.envMode!=='pressure'?'hidden':''}>
      <button type="button" class="printbtn st-btn-secondary" id="dcUseLocationBtn" style="width:auto;padding:9px 16px;margin-top:8px;" ${dcSettings.envMode!=='altitude'?'hidden':''}>Hoogte via locatie</button>
      <p class="hint" id="dcLocationHint" ${dcSettings.envMode!=='altitude'?'hidden':''}>Vult de hoogte in via de locatievoorziening van je toestel (GPS) — temperatuur en luchtdruk kan de telefoon niet meten en blijven dus handmatig.</p>

      <div id="dcDaWrap" ${dcSettings.envMode!=='da'?'hidden':''}>
        <label for="dcDaFt">Density altitude (ft)</label>
        <input type="number" id="dcDaFt" step="100" value="${dcSettings.envDaFt}">
        <p class="hint">Rechtstreeks overnemen van je Kestrel of vergelijkbare meter — dekt temperatuur, hoogte én luchtdruk in één getal. Je telefoon kan dit niet zelf meten (geen barometer/temperatuursensor beschikbaar voor een webapp) — vandaar handmatig.</p>
      </div>

      <div class="dc-preview-box" id="dcDaReadout" ${dcSettings.envMode==='da'?'hidden':''}></div>
    </fieldset>

    <fieldset class="dryfire-mode-fieldset">
      <legend>Kaart</legend>
      <div class="row2">
        <div><label for="dcRangeStart">Start (m)</label><input type="number" id="dcRangeStart" step="10" value="${dcSettings.rangeStart}"></div>
        <div><label for="dcRangeEnd">Eind (m)</label><input type="number" id="dcRangeEnd" step="10" value="${dcSettings.rangeEnd}"></div>
      </div>
      <label for="dcRangeInterval">Interval (m)</label>
      <input type="number" id="dcRangeInterval" step="5" value="${dcSettings.rangeInterval}">

      <div class="st-field">Windsnelheid-eenheid</div>
      <div class="dryfire-mode-toggle">
        <label><input type="radio" name="dcWindUnit" value="ms" ${dcSettings.windUnit!=='mph'?'checked':''}> m/s</label>
        <label><input type="radio" name="dcWindUnit" value="mph" ${dcSettings.windUnit==='mph'?'checked':''}> mph</label>
      </div>

      <div class="st-field">Windstap (swipe op het windvak, ${dcSpeedUnitLabel()} per stap)</div>
      <div class="dryfire-mode-toggle">
        <label><input type="radio" name="dcWindStep" value="0.5" ${dcSettings.windStep===0.5?'checked':''}> 0.5</label>
        <label><input type="radio" name="dcWindStep" value="1" ${dcSettings.windStep===1?'checked':''}> 1.0</label>
        <label><input type="radio" name="dcWindStep" value="2" ${dcSettings.windStep===2?'checked':''}> 2.0</label>
      </div>

      <div class="st-field">Pols-modus</div>
      <div class="dryfire-mode-toggle">
        <label><input type="radio" name="dcWrist" value="device" ${dcSettings.wristMode==='device'?'checked':''}> Volg toestel</label>
        <label><input type="radio" name="dcWrist" value="left" ${dcSettings.wristMode==='left'?'checked':''}> Draai 90° links</label>
        <label><input type="radio" name="dcWrist" value="right" ${dcSettings.wristMode==='right'?'checked':''}> Draai 90° rechts</label>
      </div>
      <p class="hint">Bij "Draai 90°" draait de Dope Card zelf mee, maar de statusbalk van iOS (tijd/wifi/batterij) draait met het scherm mee zodra je telefoon kantelt — een webapp kan de schermrotatie niet zelf vergrendelen. Zet daarom de <strong>Portretvergrendeling</strong> aan: veeg omlaag vanuit de rechterbovenhoek (Bedieningscentrum) en tik op het slotje met de pijl.</p>

      <div class="st-field">Thema</div>
      <div class="dryfire-mode-toggle">
        <label><input type="radio" name="dcTheme" value="day" ${dcSettings.theme==='day'?'checked':''}> Dag</label>
        <label><input type="radio" name="dcTheme" value="night" ${dcSettings.theme==='night'?'checked':''}> Nacht</label>
        <label><input type="radio" name="dcTheme" value="nv" ${dcSettings.theme==='nv'?'checked':''}> Nachtzicht</label>
      </div>
      <p class="hint">Nachtzicht: diep rood op zwart, veel minder fel dan het nachtthema op minimale schermhelderheid — voorkomt "whiteout" van een NVG-bril/monoculair en beschermt je eigen donker-adaptatie.</p>
    </fieldset>

    <fieldset class="dryfire-mode-fieldset">
      <legend>Printen (voor je armmapje, 7,6 × 12,7 cm)</legend>
      <div class="st-field">Kolom(men) op de geprinte kaart</div>
      <div class="dryfire-mode-toggle dc-print-mode-toggle">
        <label><input type="radio" name="dcPrintMode" value="wind" ${dcSettings.printMode==='wind'?'checked':''}> Alleen wind</label>
        <label><input type="radio" name="dcPrintMode" value="spindrift" ${dcSettings.printMode==='spindrift'?'checked':''}> Alleen spindrift</label>
        <label><input type="radio" name="dcPrintMode" value="both" ${dcSettings.printMode==='both'?'checked':''}> Wind + spindrift apart</label>
        <label><input type="radio" name="dcPrintMode" value="combined" ${dcSettings.printMode==='combined'?'checked':''}> Gecombineerd</label>
      </div>
      <p class="hint">Bij "Gecombineerd" wordt de spindrift automatisch bij de wind opgeteld of ervan afgehaald, afhankelijk van de windrichting op het moment van printen — geen aparte keuze nodig. Past het volledige afstandsbereik niet op één kaartje, dan worden er automatisch meerdere geprint.</p>
      <button type="button" class="printbtn st-btn-secondary" id="dcPrintBtn" style="width:100%;padding:14px;">Print Dope Card</button>
    </fieldset>

    <div class="dc-preview-box" id="dcPreviewBox"></div>

    <button type="button" class="printbtn" id="dcSaveBtn" style="width:100%;padding:18px;">Opslaan &amp; open Dope Card</button>
  `;

  function syncFromForm(){
    dcSettings.activeProfileId = root.querySelector('#dcProfile').value;
    dcSettings.envTempC = parseFloat(root.querySelector('#dcTemp').value) || 0;
    dcSettings.envMode = root.querySelector('input[name="dcEnvMode"]:checked').value;
    dcSettings.envAltitudeM = parseFloat(root.querySelector('#dcAltitude').value) || 0;
    dcSettings.envPressureHpa = parseFloat(root.querySelector('#dcPressure').value) || 1013.25;
    dcSettings.envDaFt = parseFloat(root.querySelector('#dcDaFt').value) || 0;
    dcSettings.rangeStart = parseFloat(root.querySelector('#dcRangeStart').value) || 0;
    dcSettings.rangeEnd = parseFloat(root.querySelector('#dcRangeEnd').value) || 0;
    dcSettings.rangeInterval = Math.max(1, parseFloat(root.querySelector('#dcRangeInterval').value) || 1);
    dcSettings.windStep = parseFloat(root.querySelector('input[name="dcWindStep"]:checked').value);
    dcSettings.windUnit = root.querySelector('input[name="dcWindUnit"]:checked').value;
    dcSettings.printMode = root.querySelector('input[name="dcPrintMode"]:checked').value;
    dcSettings.wristMode = root.querySelector('input[name="dcWrist"]:checked').value;
    dcSettings.theme = root.querySelector('input[name="dcTheme"]:checked').value;
  }
  function renderPreview(){
    const f = dcFitCheck();
    const box = root.querySelector('#dcPreviewBox');
    box.className = 'dc-preview-box' + (f.fits ? '' : ' dc-preview-warn');
    box.innerHTML = f.fits
      ? `<strong>${f.totalRows} afstanden</strong> in ${f.totalBlocks} blokken — past naar schatting op één scherm (~${f.rowHeightPx.toFixed(0)}px per regel).`
      : `Te veel afstanden voor één scherm, vergroot interval of verklein bereik (geschat ~${f.rowHeightPx.toFixed(0)}px per regel, minimaal ~24px nodig).`;
    root.querySelector('#dcSaveBtn').disabled = !f.fits;
  }
  // Informatief controlegetal (alleen buiten DA-modus): welke DA hoort bij
  // de huidige temperatuur + hoogte/luchtdruk, om te vergelijken met een
  // Kestrel-meter of vergelijkbaar.
  function renderDaReadout(){
    const readout = root.querySelector('#dcDaReadout');
    if(!readout || dcSettings.envMode === 'da') return;
    const atmInput = { tempC: dcSettings.envTempC };
    if(dcSettings.envMode === 'pressure') atmInput.pressureHpa = dcSettings.envPressureHpa;
    else atmInput.altitudeM = dcSettings.envAltitudeM;
    const B = window.AppliedConceptsBallistics;
    const densityFactor = B.computeAtmosphere(atmInput).densityFactor;
    const daFt = B.densityAltitudeFromFactor(densityFactor) * BALLISTICS_FT_PER_M_DC;
    readout.innerHTML = `<strong>≈ Density altitude: ${daFt.toFixed(0)} ft</strong> — ter controle tegen je eigen meter.`;
  }

  root.addEventListener('change', (e) => {
    if(e.target.name === 'dcEnvMode'){
      syncFromForm();
      dcRenderSetup(root);
      return;
    }
    if(e.target.name === 'dcWindUnit'){
      // De windstap-labels (0.5/1.0/2.0) staan in de gekozen eenheid — een
      // volledige her-render is simpeler dan losse tekst-patches. Ronde
      // waarde in de oude eenheid meenemen naar de nieuwe geeft vaak een
      // lelijk getal (1.9 m/s -> 4.3 mph) — rond meteen bij naar de
      // dichtstbijzijnde windstap in de nieuw gekozen eenheid.
      syncFromForm();
      const mphMode = dcSettings.windUnit === 'mph';
      const display = mphMode ? dcWind.speedMps * DC_MPH_PER_MS : dcWind.speedMps;
      const snappedDisplay = Math.round(display / dcSettings.windStep) * dcSettings.windStep;
      dcWind.speedMps = Math.max(0, Math.min(20, mphMode ? snappedDisplay / DC_MPH_PER_MS : snappedDisplay));
      dcSave(DC_WIND_KEY, dcWind);
      dcRenderSetup(root);
      return;
    }
    syncFromForm();
    renderPreview();
    renderDaReadout();
  });

  root.querySelector('#dcUseLocationBtn').addEventListener('click', () => {
    const hint = root.querySelector('#dcLocationHint');
    if(!navigator.geolocation){ hint.textContent = 'Locatievoorziening niet beschikbaar op dit toestel.'; return; }
    hint.textContent = 'Locatie opvragen…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if(pos.coords.altitude == null){
          hint.textContent = 'Toestel gaf geen hoogte mee bij deze locatiebepaling — vul handmatig in.';
          return;
        }
        const altM = Math.round(pos.coords.altitude);
        root.querySelector('#dcAltitude').value = altM;
        dcSettings.envAltitudeM = altM;
        hint.textContent = `Hoogte ingevuld via locatie: ${altM} m. Temperatuur en luchtdruk blijven handmatig.`;
        renderDaReadout();
      },
      (err) => { hint.textContent = 'Locatie niet beschikbaar (toegang geweigerd of mislukt) — vul handmatig in.'; },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  root.querySelector('#dcSaveBtn').addEventListener('click', () => {
    syncFromForm();
    const profile = dcGetActiveProfile();
    const input = profile ? window.AppliedConceptsProfiles.toBallisticsInput(profile) : null;
    const errEl = root.querySelector('#dcProfileError');
    if(!input){
      errEl.textContent = 'Dit profiel heeft nog geen geldige ballistische gegevens (kaliber, BC, V0, zero-afstand) — vul deze eerst aan bij Wapenprofielen.';
      return;
    }
    errEl.textContent = '';
    if(!dcFitCheck().fits) return;
    dcSave(DC_SETTINGS_KEY, dcSettings);
    dcAutoEnterSuppressed = false;
    dcRecomputeTable();
    dcEnterFullscreen();
  });

  root.querySelector('#dcPrintBtn').addEventListener('click', () => {
    syncFromForm();
    const profile = dcGetActiveProfile();
    const input = profile ? window.AppliedConceptsProfiles.toBallisticsInput(profile) : null;
    const errEl = root.querySelector('#dcProfileError');
    if(!input){
      errEl.textContent = 'Dit profiel heeft nog geen geldige ballistische gegevens (kaliber, BC, V0, zero-afstand) — vul deze eerst aan bij Wapenprofielen.';
      return;
    }
    errEl.textContent = '';
    dcSave(DC_SETTINGS_KEY, dcSettings);
    dcPrintDopeCard();
  });

  renderPreview();
  renderDaReadout();
}

/* ======================= INIT ======================= */
function initDopeCard(){
  const root = document.getElementById('dopecardRoot');
  const profile = dcGetActiveProfile();
  const input = profile ? window.AppliedConceptsProfiles.toBallisticsInput(profile) : null;
  if(input && !dcAutoEnterSuppressed){
    dcRecomputeTable();
    dcEnterFullscreen();
  } else {
    dcRenderSetup(root);
  }
}

window.AppliedConceptsDopeCard = { init: initDopeCard, stopTimer: dcTeardownFullscreen };
