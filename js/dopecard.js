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
  // Kestrel/Applied Ballistics-niveau (v2.07):
  envHumidityPct: 50,      // relatieve luchtvochtigheid (%), niet gebruikt in DA-modus (DA bevat die al)
  powderTempC: '',         // '' = gelijk aan de luchttemperatuur
  aeroJump: true,          // aerodynamic jump (verticale sprong door zijwind)
  coriolis: true,
  latitudeDeg: 52.1,       // Nederland
  azimuthDeg: '',          // schietrichting t.o.v. het noorden; '' = onbekend (alleen horizontale Coriolis)
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
let dcAngleEditingDist = null; // afstand waarvan het hoek-scherm open staat
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
// Laatst gebruikte rekeninvoer — nodig voor de exacte schuin-schieten-
// berekening per doel (dcInclinedBaseElev), die los van de tabel draait.
let dcCalc = null;
const dcInclinedCache = new Map();

function dcAtmosphere(){
  const B = window.AppliedConceptsBallistics;
  if(dcSettings.envMode === 'da') return B.computeAtmosphereFromDensityAltitude(dcSettings.envDaFt / BALLISTICS_FT_PER_M_DC);
  const atmInput = { tempC: dcSettings.envTempC, humidityPct: dcSettings.envHumidityPct };
  if(dcSettings.envMode === 'pressure') atmInput.pressureHpa = dcSettings.envPressureHpa;
  else atmInput.altitudeM = dcSettings.envAltitudeM;
  return B.computeAtmosphere(atmInput);
}
function dcNum(v){ const n = parseFloat(v); return (v === '' || v == null || isNaN(n)) ? null : n; }
// Kruittemperatuur: eigen invoer, anders de luchttemperatuur (in DA-modus
// is die er niet — dan alleen met eigen invoer).
function dcPowderTempC(){
  const own = dcNum(dcSettings.powderTempC);
  if(own != null) return own;
  return dcSettings.envMode === 'da' ? null : dcSettings.envTempC;
}
// V0 bij de huidige kruittemperatuur (fps), of null = geen correctie
// (profiel heeft geen temperatuurgevoeligheid/referentietemperatuur).
function dcAdjustedMvFps(profile, input){
  const dp = window.AppliedConceptsProfiles.dopeParams(profile);
  const tp = dcPowderTempC();
  if(dp.mvSensMsPerC == null || dp.mvRefTempC == null || tp == null) return null;
  return input.muzzleVelocityFps + dp.mvSensMsPerC * (tp - dp.mvRefTempC) * BALLISTICS_FT_PER_M_DC;
}
function dcRecomputeTable(){
  const profile = dcGetActiveProfile();
  dcInclinedCache.clear(); dcMoverCache.clear();
  if(!profile){ dcTable = null; dcCalc = null; return false; }
  // Richtmiddelhoogte komt rechtstreeks uit het wapenprofiel zelf
  // (toBallisticsInput's sightHeightCm) — geen aparte Dope Card-instelling.
  const input = window.AppliedConceptsProfiles.toBallisticsInput(profile);
  if(!input){ dcTable = null; dcCalc = null; return false; }
  const atmosphere = dcAtmosphere();
  const spinParams = window.AppliedConceptsProfiles.spinDriftParams(profile); // null als het profiel geen (volledige) twist/afmetingen heeft — spindrift/aerodynamic jump dan simpelweg niet beschikbaar
  const opts = {
    muzzleVelocityFps: dcAdjustedMvFps(profile, input),
    twistDir: window.AppliedConceptsProfiles.dopeParams(profile).twistDir,
    aeroJump: dcSettings.aeroJump !== false,
    coriolis: (dcSettings.coriolis !== false && dcNum(dcSettings.latitudeDeg) != null)
      ? { latitudeDeg: dcNum(dcSettings.latitudeDeg), azimuthDeg: dcNum(dcSettings.azimuthDeg) } : null,
  };
  dcTable = window.AppliedConceptsBallistics.computeDopeCardTable(input, atmosphere, dcDistances(), spinParams, opts);
  dcCalc = { input, atmosphere, opts, spinParams };
  return true;
}
// Elevatie zonder wind bij een schuin schot: exact doorgerekend (zwaartekracht
// ontbonden langs/loodrecht op de zichtlijn), per afstand+hoek gecachet.
function dcInclinedBaseElev(d, angleDeg){
  if(!dcCalc) return null;
  const key = d + '|' + angleDeg;
  if(!dcInclinedCache.has(key)){
    dcInclinedCache.set(key, window.AppliedConceptsBallistics.computeInclinedElevMil(dcCalc.input, dcCalc.atmosphere, d, angleDeg, dcCalc.opts));
  }
  return dcInclinedCache.get(key);
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

// Windcomponenten uit de klok: zijwind (+ = van rechts) en langswind
// (+ = kopwind, van 12 uur; − = meewind).
function dcWindComponents(){
  const rad = dcWind.angleDeg * Math.PI/180;
  return { crossFromRight: dcWind.speedMps * Math.sin(rad), headwind: dcWind.speedMps * Math.cos(rad) };
}

/* ---- Holds (alles in mil) ----
   Elevatie zoals een Kestrel/Applied Ballistics hem geeft: valhoek op deze
   afstand (incl. kruittemperatuur, luchtvochtigheid, verticale Coriolis),
   plus het effect van kop-/meewind en de aerodynamic jump van de
   huidige zijwind. angleDeg (doel met hoek) -> exacte schuin-schieten-elevatie. */
function dcTotalElevMil(d, row, angleDeg){
  if(!row || row.elevMil == null) return null;
  let elev = row.elevMil;
  if(angleDeg != null && angleDeg !== 0){
    const inclined = dcInclinedBaseElev(d, angleDeg);
    if(inclined != null) elev = inclined;
  }
  const { crossFromRight, headwind } = dcWindComponents();
  if(headwind > 0 && row.elevMilPerMpsHeadwind != null) elev += row.elevMilPerMpsHeadwind * headwind;
  if(headwind < 0 && row.elevMilPerMpsTailwind != null) elev += row.elevMilPerMpsTailwind * -headwind;
  // Aerodynamic jump tilt het treffpunt omhoog/omlaag -> hold de andere kant op.
  if(row.ajMilPerMps != null) elev -= row.ajMilPerMps * crossFromRight;
  return elev;
}
// Windage-holds, ondertekend: + = R(echts) aanhouden/draaien, − = L(inks).
function dcWindHoldSigned(row){ return row.driftMilPerMps * dcWindComponents().crossFromRight; }
function dcSpinHoldSigned(row){ return row.spinDriftMil != null ? -row.spinDriftMil : null; }
function dcCoriolisHoldSigned(row){ return row.coriolisMil != null ? -row.coriolisMil : 0; }
function dcFmtSignedHold(v){
  if(v == null) return '—';
  const s = Math.abs(v).toFixed(1);
  return s === '0.0' ? '0.0' : (v > 0 ? 'R' : 'L') + s;
}

/* ---- Waarde-opmaak ---- */
function dcFmtElev(mil){ return mil == null ? '—' : mil.toFixed(1); }
function dcFmtWindHold(row){
  return dcFmtSignedHold(dcWindHoldSigned(row));
}
// Rechterwaarde per rij — wind-, spindrift- of totale hold, afhankelijk van
// de schakelaar in het windvak.
//
// Spindrift hangt niet van de wind af. Rechtsdraaiende loop (vrijwel elk
// modern geweer): de kogel drift naar RECHTS, de correctie is dus naar
// LINKS (linksdraaiend: andersom).
function dcFmtRowRight(row){
  if(!row || row.driftMilPerMps == null) return '—';
  if(dcSettings.windCellMode === 'spindrift') return dcFmtSignedHold(dcSpinHoldSigned(row));
  if(dcSettings.windCellMode === 'combined') return dcFmtCombinedHold(row);
  return dcFmtWindHold(row);
}
// TOTAAL = wat een Kestrel als windage geeft: wind + spindrift + horizontale
// Coriolis, ondertekend opgeteld — of ze elkaar versterken of opheffen volgt
// puur uit de actuele windrichting, geen aparte instelling nodig.
function dcFmtCombinedHold(row){
  if(!row || row.driftMilPerMps == null) return '—';
  return dcFmtSignedHold(dcWindHoldSigned(row) + (dcSpinHoldSigned(row) || 0) + dcCoriolisHoldSigned(row));
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
function dcSaveNotes(){ dcSave(DC_NOTES_KEY, dcNotes); }

/* ---- Hoek-scherm (snelle inclinatie/declinatie-invoer, klok-stijl) ----
   Los van de notities-editor — dezelfde sleep-interactie als de windklok,
   maar als een halve cirkel (−90° onder tot +90° boven, 0° horizontaal
   rechts) in plaats van een volle 360°, want een hellingshoek is één as
   (omhoog/omlaag), geen windrichting. Schrijft direct naar dcNotes
   (zelfde opslag als de editor), dus blijft overal in sync. */
function dcAngleSnap(deg){ return Math.max(-90, Math.min(90, Math.round(deg/5)*5)); }
function dcSetAngleEditing(angle){
  if(dcAngleEditingDist == null) return;
  const existing = dcNoteFor(dcAngleEditingDist) || {};
  const updated = Object.assign({}, existing, { angle });
  if(dcNoteHasContent(updated)) dcNotes[dcAngleEditingDist] = updated;
  else delete dcNotes[dcAngleEditingDist];
  dcSaveNotes();
}
function dcAngleDialSvg(angleDeg){
  const cx=50, cy=50;
  const a = angleDeg == null ? 0 : angleDeg;
  let ticks = '';
  for(let deg=-90; deg<=90; deg+=15){
    const isLong = (deg % 45 === 0);
    const rOuter=45, rInner = rOuter - (isLong?10:6);
    const rad = deg*Math.PI/180;
    const x1=cx+rOuter*Math.cos(rad), y1=cy-rOuter*Math.sin(rad);
    const x2=cx+rInner*Math.cos(rad), y2=cy-rInner*Math.sin(rad);
    ticks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="currentColor" stroke-width="${isLong?2:1}"/>`;
  }
  const rad = a*Math.PI/180;
  const bx = cx + 36*Math.cos(rad), by = cy - 36*Math.sin(rad);
  const arcPath = `M ${cx} ${(cy-47).toFixed(2)} A 47 47 0 0 1 ${cx} ${(cy+47).toFixed(2)}`;
  return `<svg class="dc-dial-svg" viewBox="0 0 100 100" data-role="angledial">
    <path d="${arcPath}" fill="none" stroke="currentColor" stroke-width="1"/>
    <line x1="${cx}" y1="${(cy-47).toFixed(2)}" x2="${cx}" y2="${(cy+47).toFixed(2)}" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2" opacity="0.3"/>
    ${ticks}
    <line class="dc-dial-line" x1="${cx}" y1="${cy}" x2="${bx.toFixed(2)}" y2="${by.toFixed(2)}" stroke="currentColor" stroke-width="2"/>
    <circle class="dc-dial-handle" cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="4" fill="currentColor"/>
  </svg>`;
}
function dcAttachAngleDialDrag(svgEl){
  function handleMove(clientX, clientY){
    const rect = svgEl.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const logical = dcLogicalDelta(clientX - cx, clientY - cy);
    let angle = Math.atan2(-logical.dy, logical.dx) * 180/Math.PI;
    angle = Math.max(-90, Math.min(90, angle));
    dcSetAngleEditing(dcAngleSnap(angle));
    dcAngleDialLiveUpdate();
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
function dcAngleDialLiveUpdate(){
  if(!dcOverlayEl) return;
  const a = dcNoteAngle(dcNoteFor(dcAngleEditingDist));
  const svg = dcOverlayEl.querySelector('[data-role="angledial"]');
  if(svg){
    const cx=50, cy=50;
    const rad = (a||0)*Math.PI/180;
    const bx = cx + 36*Math.cos(rad), by = cy - 36*Math.sin(rad);
    const line = svg.querySelector('.dc-dial-line');
    const handle = svg.querySelector('.dc-dial-handle');
    if(line){ line.setAttribute('x2', bx.toFixed(2)); line.setAttribute('y2', by.toFixed(2)); }
    if(handle){ handle.setAttribute('cx', bx.toFixed(2)); handle.setAttribute('cy', by.toFixed(2)); }
  }
  const valEl = dcOverlayEl.querySelector('[data-role="angleval"]');
  if(valEl) valEl.textContent = a == null ? '0°' : `${a>0?'+':''}${a}°`;
}
function dcAngleScreenHtml(){
  const dist = dcAngleEditingDist;
  const a = dcNoteAngle(dcNoteFor(dist));
  const ti = dcTargets.indexOf(dist) + 1;
  return `<div class="dc-main">
    <div class="dc-wind-screen">
      <div class="dc-wind-left">
        <button class="dc-wind-back" data-act="back">&larr; TARGETS</button>
        <div class="dc-wind-speed-label">HOEK — T${ti} · ${dist} M</div>
        <div class="dc-wind-speed-value" data-role="angleval">${a == null ? '0°' : `${a>0?'+':''}${a}°`}</div>
        <div class="dc-wind-speed-hint">sleep de wijzer · + omhoog / − omlaag</div>
        <div class="dc-wind-pm">
          <button type="button" data-act="angleminus">&minus;</button>
          <button type="button" data-act="angleplus">+</button>
        </div>
        <button type="button" class="dc-angle-clear-btn" data-act="angleclear">WIS HOEK</button>
      </div>
      <div class="dc-wind-right">
        <div class="dc-dial-tgt">0° = HORIZONTAAL</div>
        <div class="dc-dial-wrap">
          <div class="dc-dial-watermark" style="background-image:url('icons/logo.svg')"></div>
          ${dcAngleDialSvg(a)}
        </div>
      </div>
    </div>
  </div>${dcStripHtml()}`;
}
function dcWireAngleScreen(){
  dcWireStrip();
  const back = dcOverlayEl.querySelector('[data-act="back"]');
  if(back) back.addEventListener('click', () => dcGoScreen('target'));
  const minus = dcOverlayEl.querySelector('[data-act="angleminus"]');
  const plus = dcOverlayEl.querySelector('[data-act="angleplus"]');
  const step = (delta) => {
    const cur = dcNoteAngle(dcNoteFor(dcAngleEditingDist)) || 0;
    dcSetAngleEditing(dcAngleSnap(cur + delta));
    dcAngleDialLiveUpdate();
    if(navigator.vibrate) navigator.vibrate(10);
  };
  if(minus) minus.addEventListener('click', () => step(-5));
  if(plus) plus.addEventListener('click', () => step(5));
  const clear = dcOverlayEl.querySelector('[data-act="angleclear"]');
  if(clear) clear.addEventListener('click', () => {
    dcSetAngleEditing('');
    dcAngleDialLiveUpdate();
  });
  const dial = dcOverlayEl.querySelector('[data-role="angledial"]');
  if(dial) dcAttachAngleDialDrag(dial);
}

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
  dcStopRecog();
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
function dcGoScreen(s){ if(s !== 'mover') dcStopRecog(); dcScreen = s; dcNotesEditing = null; dcRenderFullscreen(); }

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
        <button type="button" class="dc-mover-btn" data-role="moverbtn">MOVER</button>
        <div class="dc-wind-mode-toggle" data-role="windmodetoggle">
          <button type="button" class="dc-wind-mode-btn${(!dcSettings.windCellMode||dcSettings.windCellMode==='wind')?' active':''}" data-mode="wind">WIND</button>
          <button type="button" class="dc-wind-mode-btn${dcSettings.windCellMode==='spindrift'?' active':''}" data-mode="spindrift">SPIN</button>
          <button type="button" class="dc-wind-mode-btn${dcSettings.windCellMode==='combined'?' active':''}" data-mode="combined">TOTAAL</button>
        </div>
      </div>` : '';
    const blocksHtml = colBlocks.map(block => {
      const rowsHtml = block.distances.map((d,i) => {
        const row = dcTable ? dcTable.get(d) : null;
        const elevStr = dcFmtElev(dcTotalElevMil(d, row, null));
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
  const moverBtn = dcOverlayEl.querySelector('[data-role="moverbtn"]');
  if(moverBtn){
    moverBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    moverBtn.addEventListener('pointerup', (e) => e.stopPropagation());
    moverBtn.addEventListener('click', (e) => { e.stopPropagation(); dcOpenMover(); });
  }
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

/* ======================= MOVER (bewegend doel, spraak) =======================
   Tik op MOVER -> microfoon aan -> je zegt "600 naar rechts joggen" -> de
   telefoon zegt direct de lead terug (via de oortjes). Lead = doelsnelheid ×
   vluchttijd, opgeteld met de volledige windhold (wind + spindrift +
   Coriolis) van de Dope Card — met teken: een doel dat naar rechts loopt
   en wind van links (kogel gaat naar rechts) geven een kleinere lead.
   Spraakherkenning: Web Speech API (iOS: audio gaat naar Apple, internet
   nodig); niet continu — een tik per mover, zodat de microfoon niet blijft
   hangen en valse treffers door schoten/wind uitblijven. */
const DC_MOVER_SPEEDS = [
  { key:'slow', label:'RUSTIG WANDELEN', mps:1.2 },
  { key:'fast', label:'SNEL WANDELEN',   mps:1.9 },
  { key:'jog',  label:'JOGGEN',          mps:3.0 },
  { key:'run',  label:'RENNEN',          mps:5.0 },
];
const DC_MOVER_MIN_M = 50, DC_MOVER_MAX_M = 2500;
const DC_MOVER_DEFAULT = { dist:600, dir:'R', speed:'fast' };
let dcMover = Object.assign({}, DC_MOVER_DEFAULT, dcSettings.mover || {});
let dcMoverStatus = 'idle'; // idle | listening | heard | error
let dcMoverMsg = '';
let dcMoverHeard = '';
let dcRecog = null;
let dcMoverAutoStopTimer = null;
const dcMoverCache = new Map();

function dcMoverSave(){ dcSettings.mover = dcMover; dcSave(DC_SETTINGS_KEY, dcSettings); }

/* ---- Nederlandse getallen ("zeshonderd vijftig", "600") ---- */
const DC_NL_UNITS = { nul:0, een:1, twee:2, drie:3, vier:4, vijf:5, zes:6, zeven:7, acht:8, negen:9, tien:10, elf:11, twaalf:12, dertien:13, veertien:14, vijftien:15, zestien:16, zeventien:17, achttien:18, negentien:19 };
const DC_NL_TENS = { twintig:20, dertig:30, veertig:40, vijftig:50, zestig:60, zeventig:70, tachtig:80, negentig:90 };
const DC_NL_PIECES = Object.keys(DC_NL_UNITS).concat(Object.keys(DC_NL_TENS), ['honderd','duizend','en']).sort((a,b) => b.length - a.length);
// Splitst één woord ("zeshonderdvijftig") in getalstukken; null = geen getal.
function dcNlSplit(word){
  const out = [];
  let rest = word;
  while(rest){
    const piece = DC_NL_PIECES.find(pc => rest.startsWith(pc));
    if(!piece) return null;
    out.push(piece); rest = rest.slice(piece.length);
  }
  return out.length && out.some(pc => pc !== 'en') ? out : null;
}
function dcNlValue(pieces){
  let total = 0, cur = 0;
  pieces.forEach(pc => {
    if(pc === 'en') return;
    if(pc === 'honderd') cur = (cur || 1) * 100;
    else if(pc === 'duizend'){ total += (cur || 1) * 1000; cur = 0; }
    else cur += (DC_NL_UNITS[pc] != null ? DC_NL_UNITS[pc] : DC_NL_TENS[pc]);
  });
  return total + cur;
}
function dcNormalizeSpeech(t){
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Alle getallen in de zin: cijfers ("600") of woorden, in volgorde.
function dcExtractNumbers(text){
  const nums = [];
  let run = [];
  const flush = () => { if(run.length){ nums.push(dcNlValue(run)); run = []; } };
  text.split(' ').forEach(w => {
    if(/^\d+$/.test(w)){ flush(); nums.push(parseInt(w, 10)); return; }
    const pcs = dcNlSplit(w);
    if(pcs) run = run.concat(pcs); else flush();
  });
  flush();
  return nums;
}
// Zin -> { dist, dir, speed } (alleen wat verstaan is; rest undefined).
function dcParseMoverSpeech(raw){
  const t = dcNormalizeSpeech(raw);
  const res = {};
  const nums = dcExtractNumbers(t).filter(n => n >= DC_MOVER_MIN_M && n <= DC_MOVER_MAX_M);
  if(nums.length) res.dist = nums[0];
  // Laatst genoemde kant = bestemming ("van links naar rechts", "links rechts", "naar links").
  const re = /\b(links|rechts)\b/g; let m, last = null;
  while((m = re.exec(t))) last = m[1];
  if(last) res.dir = last === 'rechts' ? 'R' : 'L';
  if(/\bren/.test(t) || /\bsprint/.test(t)) res.speed = 'run';
  else if(/\bjog/.test(t) || /\bdraf/.test(t)) res.speed = 'jog';
  else if(/\bsnel|flink|vlot/.test(t)) res.speed = 'fast';
  else if(/\brustig|langzaam|wandel|loopt|lopend|slenter/.test(t)) res.speed = 'slow';
  return res;
}

/* ---- Rekenen ---- */
function dcMoverSpeedMps(){ return (DC_MOVER_SPEEDS.find(x => x.key === dcMover.speed) || DC_MOVER_SPEEDS[1]).mps; }
function dcMoverRow(d){
  if(!dcCalc) return null;
  if(!dcMoverCache.has(d)){
    const tbl = window.AppliedConceptsBallistics.computeDopeCardTable(dcCalc.input, dcCalc.atmosphere, [d], dcCalc.spinParams, dcCalc.opts);
    dcMoverCache.set(d, tbl.get(Math.round(d)));
  }
  return dcMoverCache.get(d);
}
// Alles in mil; + = rechts. total = wat je boven/naast het doel moet houden.
function dcMoverCompute(){
  const d = dcMover.dist;
  if(!(d >= DC_MOVER_MIN_M && d <= DC_MOVER_MAX_M)) return null;
  const row = dcMoverRow(d);
  if(!row) return null;
  const sign = dcMover.dir === 'R' ? 1 : -1;
  const lead = sign * dcMoverSpeedMps() * row.tofSec / d * 1000;
  const wind = dcWindHoldSigned(row);
  const spin = dcSpinHoldSigned(row) || 0;
  const cor = dcCoriolisHoldSigned(row);
  return { d, lead, wind, spin, cor, total: lead + wind + spin + cor, elev: dcTotalElevMil(d, row, null), tof: row.tofSec };
}
function dcFmt1(v){ return Math.abs(v).toFixed(1); }

/* ---- Terugpraten ---- */
function dcSpeak(text){
  if(dcSettings.moverSound === false || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'nl-NL'; u.rate = 1.15;
    const v = window.speechSynthesis.getVoices().find(x => /^nl/i.test(x.lang));
    if(v) u.voice = v;
    window.speechSynthesis.speak(u);
  } catch(e){}
}
function dcMoverSpeechText(r){
  const leadTxt = dcFmt1(r.total) === '0.0' ? 'lead nul' : `lead ${dcFmt1(r.total).replace('.', ',')} ${r.total > 0 ? 'rechts' : 'links'}`;
  let txt = `${r.d}. ${leadTxt}.`;
  if(dcSettings.moverElev !== false) txt += ` ${r.elev >= 0 ? 'Omhoog' : 'Omlaag'} ${dcFmt1(r.elev).replace('.', ',')}.`;
  return txt;
}
function dcMoverSpeakResult(){
  const r = dcMoverCompute();
  dcSpeak(r ? dcMoverSpeechText(r) : 'Afstand niet verstaan');
}

/* ---- Spraak in ---- */
function dcStopRecog(){
  clearTimeout(dcMoverAutoStopTimer);
  if(dcRecog){ try { dcRecog.onresult = dcRecog.onerror = dcRecog.onend = null; dcRecog.abort(); } catch(e){} dcRecog = null; }
  if(dcMoverStatus === 'listening') dcMoverStatus = 'idle';
}
function dcStartRecog(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ dcMoverStatus = 'error'; dcMoverMsg = 'Spraakherkenning niet beschikbaar op dit toestel — vul handmatig in.'; dcMoverRefresh(); return; }
  dcStopRecog();
  // Stil "ontgrendelen" van de stem: iOS laat tekst-naar-spraak alleen toe na een tik.
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch(e){}
  const rec = new SR();
  rec.lang = 'nl-NL'; rec.continuous = false; rec.interimResults = true; rec.maxAlternatives = 3;
  dcRecog = rec;
  dcMoverStatus = 'listening'; dcMoverMsg = ''; dcMoverHeard = '';
  if(navigator.vibrate) navigator.vibrate(15);
  let handled = false;
  const apply = (transcript, final) => {
    dcMoverHeard = transcript;
    const parsed = dcParseMoverSpeech(transcript);
    if(parsed.dist != null) dcMover.dist = parsed.dist;
    if(parsed.dir) dcMover.dir = parsed.dir;
    if(parsed.speed) dcMover.speed = parsed.speed;
    if(!final){
      // Alles genoemd (afstand, richting én snelheid)? Even kort wachten of er niets meer bijkomt en dan afronden — sneller dan op de stilte-detectie wachten.
      clearTimeout(dcMoverAutoStopTimer);
      if(parsed.dist != null && parsed.dir && parsed.speed) dcMoverAutoStopTimer = setTimeout(() => { try { rec.stop(); } catch(e){} }, 450);
      dcMoverRefresh();
      return;
    }
    if(handled) return;
    handled = true;
    dcMoverSave();
    if(parsed.dist == null){ dcMoverStatus = 'error'; dcMoverMsg = 'Afstand niet verstaan'; dcSpeak('Afstand niet verstaan'); }
    else if(!parsed.dir){ dcMoverStatus = 'error'; dcMoverMsg = 'Richting niet verstaan'; dcSpeak('Richting niet verstaan'); }
    else { dcMoverStatus = 'heard'; dcMoverSpeakResult(); }
    dcMoverRefresh();
  };
  rec.onresult = (e) => {
    let best = '', final = false;
    for(let i = e.resultIndex; i < e.results.length; i++){
      const r = e.results[i];
      // Van de alternatieven de eerste kiezen die een afstand bevat.
      let pick = r[0].transcript;
      for(let k = 0; k < r.length; k++){ if(dcParseMoverSpeech(r[k].transcript).dist != null){ pick = r[k].transcript; break; } }
      best = pick; if(r.isFinal) final = true;
    }
    apply(best, final);
  };
  rec.onerror = (e) => {
    if(handled) return;
    handled = true;
    dcMoverStatus = 'error';
    dcMoverMsg = (e.error === 'not-allowed' || e.error === 'service-not-allowed') ? 'Microfoon geweigerd — sta de microfoon toe in de instellingen van je toestel, of vul handmatig in.'
      : e.error === 'no-speech' ? 'Niets gehoord — tik OPNIEUW SPREKEN.'
      : e.error === 'network' ? 'Geen internet — spraakherkenning werkt niet. Vul handmatig in.'
      : 'Spraak mislukt (' + e.error + ') — tik OPNIEUW SPREKEN of vul handmatig in.';
    dcMoverRefresh();
  };
  rec.onend = () => {
    if(dcRecog === rec) dcRecog = null;
    if(!handled && dcMoverStatus === 'listening'){
      // Einde zonder eindresultaat: wat er tot nu toe stond alsnog gebruiken.
      if(dcMoverHeard) apply(dcMoverHeard, true);
      else { dcMoverStatus = 'error'; dcMoverMsg = 'Niets gehoord — tik OPNIEUW SPREKEN.'; dcMoverRefresh(); }
    }
  };
  try { rec.start(); } catch(e){ dcMoverStatus = 'error'; dcMoverMsg = 'Microfoon kon niet starten — tik OPNIEUW SPREKEN.'; }
  dcMoverRefresh();
}

/* ---- Scherm ---- */
function dcMoverResultHtml(){
  const r = dcMoverCompute();
  if(!r) return `<div class="dc-mover-result dc-dim">Vul een afstand in (${DC_MOVER_MIN_M}–${DC_MOVER_MAX_M} m).</div>`;
  const side = v => dcFmt1(v) === '0.0' ? '0.0' : (v > 0 ? 'R' : 'L') + dcFmt1(v);
  const { eff } = dcEffWind();
  return `<div class="dc-mover-result">
      <div class="dc-mover-lead"><span class="dc-mover-k">LEAD</span> ${side(r.total)}</div>
      <div class="dc-mover-lead"><span class="dc-mover-k">ELEV</span> ${r.elev >= 0 ? '↑' : '↓'}${dcFmt1(r.elev)}</div>
    </div>
    <div class="dc-mover-detail">doel ${side(r.lead)} · wind ${side(r.wind)}${r.spin ? ' · spin ' + side(r.spin) : ''}${r.cor ? ' · cor ' + side(r.cor) : ''} · vlucht ${r.tof.toFixed(2)} s · wind ${dcFmtSpeedMps(dcWind.speedMps)} ${dcSpeedUnitLabel()} @ ${dcClockLabel()}${eff === 0 ? ' <strong>(wind staat op 0)</strong>' : ''}</div>`;
}
function dcMoverScreenHtml(){
  const listening = dcMoverStatus === 'listening';
  const speedBtns = DC_MOVER_SPEEDS.map(sp => `<button type="button" class="dc-mover-opt${dcMover.speed === sp.key ? ' active' : ''}" data-speed="${sp.key}">${sp.label}</button>`).join('');
  const status = listening ? 'LUISTERT…' : dcMoverStatus === 'error' ? dcEscapeHtml(dcMoverMsg) : dcMoverHeard ? '“' + dcEscapeHtml(dcMoverHeard) + '”' : 'Tik op de microfoon en spreek';
  return `<div class="dc-main"><div class="dc-mover-screen">
    <div class="dc-mover-head">
      <button class="dc-wind-back" data-act="back">&larr; DOPE</button>
      <div class="dc-mover-tools">
        <button type="button" class="dc-mover-tool${dcSettings.moverElev !== false ? ' active' : ''}" data-act="moverelev" title="Elevatie meespreken">ELEV</button>
        <button type="button" class="dc-mover-tool" data-act="movermute" title="Spraak aan/uit">${dcSettings.moverSound === false ? '🔇' : '🔊'}</button>
      </div>
    </div>
    <div class="dc-mover-hint">Zeg: <strong>afstand · richting · snelheid</strong> — bijv. “600 naar rechts joggen” (rustig wandelen / snel wandelen / joggen / rennen)</div>
    <div class="dc-mover-body">
      <button type="button" class="dc-mover-mic${listening ? ' listening' : ''}" data-act="mic" aria-label="Spreek">${listening ? '●' : '🎤'}<span>${listening ? 'LUISTERT' : 'SPREEK'}</span></button>
      <div class="dc-mover-fields">
        <div class="dc-mover-status${dcMoverStatus === 'error' ? ' err' : ''}" data-role="status">${status}</div>
        <div class="dc-mover-row">
          <button type="button" class="dc-mover-step" data-act="dminus">&minus;</button>
          <input type="number" inputmode="numeric" class="dc-mover-dist" data-role="dist" value="${dcMover.dist}" min="${DC_MOVER_MIN_M}" max="${DC_MOVER_MAX_M}" step="25"><span class="dc-mover-unit">m</span>
          <button type="button" class="dc-mover-step" data-act="dplus">+</button>
          <button type="button" class="dc-mover-dir${dcMover.dir === 'L' ? ' active' : ''}" data-dir="L">&larr; NAAR LINKS</button>
          <button type="button" class="dc-mover-dir${dcMover.dir === 'R' ? ' active' : ''}" data-dir="R">NAAR RECHTS &rarr;</button>
        </div>
        <div class="dc-mover-row">${speedBtns}</div>
      </div>
    </div>
    <div data-role="result">${dcMoverResultHtml()}</div>
    <div class="dc-mover-actions">
      <button type="button" class="dc-mover-act" data-act="repeat">HERHAAL</button>
      <button type="button" class="dc-mover-act" data-act="back">DOORSCHIETEN &rarr; DOPE</button>
    </div>
  </div></div>${dcStripHtml()}`;
}
// Alleen tekst/knopstanden verversen terwijl er gepraat wordt (geen volledige
// her-render: dat zou de microfoon-knop en het getypte veld verstoren).
function dcMoverRefresh(){
  if(!dcOverlayEl || dcScreen !== 'mover') return;
  const q = sel => dcOverlayEl.querySelector(sel);
  const listening = dcMoverStatus === 'listening';
  const mic = q('[data-act="mic"]');
  if(mic){ mic.classList.toggle('listening', listening); mic.innerHTML = `${listening ? '●' : '🎤'}<span>${listening ? 'LUISTERT' : 'SPREEK'}</span>`; }
  const st = q('[data-role="status"]');
  if(st){
    st.classList.toggle('err', dcMoverStatus === 'error');
    st.innerHTML = listening ? (dcMoverHeard ? '“' + dcEscapeHtml(dcMoverHeard) + '”' : 'LUISTERT…') : dcMoverStatus === 'error' ? dcEscapeHtml(dcMoverMsg) : dcMoverHeard ? '“' + dcEscapeHtml(dcMoverHeard) + '”' : 'Tik op de microfoon en spreek';
  }
  const di = q('[data-role="dist"]'); if(di && document.activeElement !== di) di.value = dcMover.dist;
  dcOverlayEl.querySelectorAll('[data-dir]').forEach(b => b.classList.toggle('active', b.dataset.dir === dcMover.dir));
  dcOverlayEl.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', b.dataset.speed === dcMover.speed));
  const res = q('[data-role="result"]'); if(res) res.innerHTML = dcMoverResultHtml();
}
function dcWireMoverScreen(){
  dcWireStrip();
  const on = (sel, fn) => dcOverlayEl.querySelectorAll(sel).forEach(b => b.addEventListener('click', fn));
  on('[data-act="back"]', () => { dcStopRecog(); try { window.speechSynthesis.cancel(); } catch(e){} dcGoScreen('dope'); });
  on('[data-act="mic"]', () => { if(dcMoverStatus === 'listening') dcStopRecog(); else dcStartRecog(); dcMoverRefresh(); });
  on('[data-act="repeat"]', () => dcMoverSpeakResult());
  on('[data-act="movermute"]', (e) => { dcSettings.moverSound = dcSettings.moverSound === false; dcSave(DC_SETTINGS_KEY, dcSettings); if(dcSettings.moverSound === false){ try { window.speechSynthesis.cancel(); } catch(x){} } e.currentTarget.textContent = dcSettings.moverSound === false ? '🔇' : '🔊'; });
  on('[data-act="moverelev"]', (e) => { dcSettings.moverElev = dcSettings.moverElev === false; dcSave(DC_SETTINGS_KEY, dcSettings); e.currentTarget.classList.toggle('active', dcSettings.moverElev !== false); });
  const setDist = v => { dcMover.dist = Math.max(DC_MOVER_MIN_M, Math.min(DC_MOVER_MAX_M, Math.round(v))); dcMoverSave(); dcMoverRefresh(); };
  on('[data-act="dminus"]', () => setDist(dcMover.dist - 25));
  on('[data-act="dplus"]', () => setDist(dcMover.dist + 25));
  on('[data-dir]', (e) => { dcMover.dir = e.currentTarget.dataset.dir; dcMoverSave(); dcMoverRefresh(); });
  on('[data-speed]', (e) => { dcMover.speed = e.currentTarget.dataset.speed; dcMoverSave(); dcMoverRefresh(); });
  const di = dcOverlayEl.querySelector('[data-role="dist"]');
  if(di){
    di.addEventListener('input', () => { const v = parseFloat(di.value); if(v >= DC_MOVER_MIN_M && v <= DC_MOVER_MAX_M){ dcMover.dist = Math.round(v); dcMoverSave(); dcMoverRefresh(); } });
    di.addEventListener('change', () => setDist(parseFloat(di.value) || dcMover.dist));
  }
}
// Vanaf de Dope Card: scherm openen en de microfoon in dezelfde tik starten
// (iOS staat dat alleen direct vanuit een tik toe).
function dcOpenMover(){
  dcMoverStatus = 'idle'; dcMoverMsg = ''; dcMoverHeard = '';
  dcGoScreen('mover');
  dcStartRecog();
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
    // Hoek: exact doorgerekend (niet meer de cosinusregel), zie dcInclinedBaseElev.
    const elevStr = dcFmtElev(dcTotalElevMil(d, row, angle));
    const windStr = dcFmtRowRight(row);
    const active = dcActiveTargetIdx === i;
    const has = dcNoteHasContent(n);
    const angleLabel = angle != null ? `${angle > 0 ? '+' : ''}${angle}°` : ''; // getal + vaste tekens — geen escaping nodig
    // Hoek staat al op zijn eigen knop (zie dc-angle-btn hieronder), dus niet
    // nogmaals herhalen in de notitiekop ernaast.
    const headLine = has ? [n.sector && dcEscapeHtml(n.sector), n.desc && dcEscapeHtml(n.desc)].filter(Boolean).join(' · ') : '';
    const noteBox = has ? `<div class="dc-note-box">
        ${headLine ? `<div class="dc-note-head">${headLine}</div>` : ''}
        ${n.note ? `<div class="dc-note-text">${dcEscapeHtml(n.note)}</div>` : ''}
      </div>` : '<div class="dc-note-box dc-note-empty"></div>';
    return `<div class="dc-target-row${active?' dc-active':''}" data-idx="${i}">
      <span class="dc-target-num">T${i+1}</span>
      <span class="dc-target-rng">${d}</span>
      <button type="button" class="dc-notes-btn${has?' dc-has-note':''}" data-notes="${d}">NOTES</button>
      <button type="button" class="dc-notes-btn dc-angle-btn${angle!=null?' dc-has-note':''}" data-angle="${d}">${angle!=null?angleLabel:'HOEK'}</button>
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
  dcOverlayEl.querySelectorAll('.dc-notes-btn[data-notes]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dcNotesEditing = parseInt(btn.dataset.notes, 10);
      dcRenderFullscreen();
      const first = dcOverlayEl.querySelector('#dcNoteSector');
      if(first) first.focus();
    });
  });
  dcOverlayEl.querySelectorAll('.dc-angle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dcAngleEditingDist = parseInt(btn.dataset.angle, 10);
      dcGoScreen('angle');
    });
  });
  const editor = dcOverlayEl.querySelector('[data-role="noteseditor"]');
  if(editor){
    const close = () => { dcNotesEditing = null; dcRenderFullscreen(); };
    editor.querySelector('[data-act="notecancel"]').addEventListener('click', close);
    editor.querySelector('[data-act="notesave"]').addEventListener('click', () => {
      // Hoek wordt niet hier bewerkt (zie de aparte HOEK-knop/scherm) — dus
      // gewoon de bestaande waarde van dit doel overnemen i.p.v. wissen.
      const existingAngle = dcNoteFor(dcNotesEditing)?.angle ?? '';
      const n = {
        sector: editor.querySelector('#dcNoteSector').value.trim(),
        desc: editor.querySelector('#dcNoteDesc').value.trim(),
        note: editor.querySelector('#dcNoteNote').value.trim(),
        angle: existingAngle,
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
  const inner = dcScreen === 'dope' ? dcDopeScreenHtml() : dcScreen === 'wind' ? dcWindScreenHtml() : dcScreen === 'angle' ? dcAngleScreenHtml() : dcScreen === 'mover' ? dcMoverScreenHtml() : dcTargetScreenHtml();
  dcOverlayEl.innerHTML = `<div class="dc-rotor">${inner}</div>`;
  if(dcScreen === 'dope') dcWireDopeScreen();
  else if(dcScreen === 'wind') dcWireWindScreen();
  else if(dcScreen === 'angle') dcWireAngleScreen();
  else if(dcScreen === 'mover') dcWireMoverScreen();
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
const DC_PRINT_HEADER_H = 0.32;
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

// A printed card freezes the wind and atmosphere it was computed with —
// unlike the live screen, nothing on paper says which, so print it.
function dcPrintConditionsText(mode){
  // Wind staat er altijd bij: ook de elevatie hangt ervan af (kop-/meewind,
  // aerodynamic jump).
  const parts = ['MIL', `wind ${dcFmtSpeedMps(dcWind.speedMps)} ${dcSpeedUnitLabel()} @ ${dcClockLabel()}`];
  if(dcSettings.envMode === 'da') parts.push(`DA ${Math.round(dcSettings.envDaFt)} ft`);
  else {
    parts.push(dcSettings.envMode === 'pressure' ? `${dcSettings.envTempC} °C · ${dcSettings.envPressureHpa} hPa` : `${dcSettings.envTempC} °C · ${dcSettings.envAltitudeM} m`);
    parts.push(`RV ${Math.round(dcSettings.envHumidityPct || 0)}%`);
  }
  if(dcTable && dcTable.muzzleVelocityFps && dcCalc && Math.abs(dcTable.muzzleVelocityFps - dcCalc.input.muzzleVelocityFps) > 0.5){
    parts.push(`V0 ${Math.round(dcTable.muzzleVelocityFps / BALLISTICS_FT_PER_M_DC)} m/s`);
  }
  if(dcCalc && dcCalc.opts.aeroJump && dcTable && dcTable.sg != null) parts.push('AJ');
  if(dcCalc && dcCalc.opts.coriolis) parts.push(`Coriolis ${dcCalc.opts.coriolis.latitudeDeg}°${dcCalc.opts.coriolis.azimuthDeg != null ? ' / ' + dcCalc.opts.coriolis.azimuthDeg + '°' : ''}`);
  return parts.join(' · ');
}

// Column headings, aligned exactly like dcPrintRowSvg's values.
function dcPrintHeadSvg(x, y, w, mode){
  const distW = w*0.22, elevW = w*0.3;
  const t = (tx, anchor, str) => `<text x="${tx.toFixed(3)}" y="${y.toFixed(3)}" text-anchor="${anchor}" font-size="0.058" font-family="'IBM Plex Mono',monospace" font-weight="600" letter-spacing="0.008" fill="${DC_PRINT_DIM}">${str}</text>`;
  let s = t(x, 'start', 'M') + t(x+distW+elevW, 'end', 'ELEV');
  if(mode === 'both'){
    const halfW = (w - distW - elevW) / 2;
    s += t(x+distW+elevW+halfW-0.03, 'end', 'WIND') + t(x+w, 'end', 'SPIN');
  } else {
    s += t(x+w, 'end', mode === 'spindrift' ? 'SPIN' : mode === 'combined' ? 'WIND+SPIN' : 'WIND');
  }
  return s;
}

function dcPrintCardSvg(cardDistances, mode, label, pageNum, totalPages, rowsPerCol, colW, colGap){
  const W = DC_PRINT_W_IN, H = DC_PRINT_H_IN, M = DC_PRINT_MARGIN;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}in" height="${H}in" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
  svg += `<text x="${M}" y="${(M+0.09).toFixed(3)}" font-size="0.1" font-family="'Oswald',sans-serif" font-weight="700" fill="${DC_PRINT_INK}">${dcEscapeHtml(label || 'DOPE CARD')}</text>`;
  svg += `<text x="${(W-M).toFixed(3)}" y="${(M+0.09).toFixed(3)}" text-anchor="end" font-size="0.08" font-family="'IBM Plex Mono',monospace" fill="${DC_PRINT_DIM}">${pageNum}/${totalPages}</text>`;
  svg += `<text x="${M}" y="${(M+0.18).toFixed(3)}" font-size="0.062" font-family="'IBM Plex Mono',monospace" fill="${DC_PRINT_DIM}">${dcEscapeHtml(dcPrintConditionsText(mode))}</text>`;
  const ruleY = M + 0.215;
  svg += `<line x1="${M}" y1="${ruleY.toFixed(3)}" x2="${(W-M).toFixed(3)}" y2="${ruleY.toFixed(3)}" stroke="${DC_PRINT_INK}" stroke-width="0.01"/>`;

  const colXs = [M, M + colW + colGap];
  colXs.forEach(colX => { svg += dcPrintHeadSvg(colX, M + 0.29, colW, mode); });
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
  const elevStr = dcFmtElev(dcTotalElevMil(dist, row, null));
  let s = `<text x="${x.toFixed(3)}" y="${y.toFixed(3)}" font-size="${DC_PRINT_FONT}" font-family="'IBM Plex Mono',monospace" fill="${DC_PRINT_DIM}">${dist}</text>`;
  s += `<text x="${(x+distW+elevW).toFixed(3)}" y="${y.toFixed(3)}" text-anchor="end" font-size="${DC_PRINT_FONT}" font-family="'IBM Plex Mono',monospace" font-weight="700" fill="${DC_PRINT_INK}">${elevStr}</text>`;
  if(mode === 'both'){
    const windStr = row && row.driftMilPerMps != null ? dcFmtWindHold(row) : '—';
    const spinStr = row ? dcFmtSignedHold(dcSpinHoldSigned(row)) : '—';
    const halfW = (w - distW - elevW) / 2;
    s += `<text x="${(x+distW+elevW+halfW-0.03).toFixed(3)}" y="${y.toFixed(3)}" text-anchor="end" font-size="${DC_PRINT_FONT}" font-family="'IBM Plex Mono',monospace" fill="${DC_PRINT_INK}">${windStr}</text>`;
    s += `<text x="${(x+w).toFixed(3)}" y="${y.toFixed(3)}" text-anchor="end" font-size="${DC_PRINT_FONT}" font-family="'IBM Plex Mono',monospace" fill="${DC_PRINT_INK}">${spinStr}</text>`;
  } else {
    let valStr;
    if(mode === 'spindrift') valStr = row ? dcFmtSignedHold(dcSpinHoldSigned(row)) : '—';
    else if(mode === 'combined') valStr = dcFmtCombinedHold(row);
    else valStr = row && row.driftMilPerMps != null ? dcFmtWindHold(row) : '—';
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
      <p class="hint" ${dcSettings.envMode!=='pressure'?'hidden':''}>Vul de <strong>stationsdruk</strong> in (de absolute druk waar je staat, zoals een Kestrel die toont) — níet de luchtdruk uit een weer-app: die is omgerekend naar zeeniveau (QNH) en rekent op hoogte met te dichte lucht, dus een te grote hold.</p>
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
      <legend>Correcties (zoals Kestrel / Applied Ballistics)</legend>
      <div id="dcHumWrap" ${dcSettings.envMode==='da'?'hidden':''}>
        <label for="dcHumidity">Luchtvochtigheid (%)</label>
        <input type="number" id="dcHumidity" step="5" min="0" max="100" value="${dcSettings.envHumidityPct}">
      </div>
      <p class="hint" ${dcSettings.envMode!=='da'?'hidden':''}>In density altitude zit de luchtvochtigheid al verwerkt.</p>

      <label for="dcPowderTemp">Kruittemperatuur (°C)</label>
      <input type="number" id="dcPowderTemp" step="1" placeholder="${dcSettings.envMode==='da'?'invullen voor V0-correctie':'leeg = luchttemperatuur'}" value="${dcSettings.powderTempC}">
      <p class="hint" id="dcMvHint"></p>

      <div class="dryfire-mode-toggle" style="flex-wrap:wrap;">
        <label><input type="checkbox" id="dcAeroJump" ${dcSettings.aeroJump!==false?'checked':''}> Aerodynamic jump</label>
        <label><input type="checkbox" id="dcCoriolis" ${dcSettings.coriolis!==false?'checked':''}> Coriolis</label>
      </div>
      <p class="hint" id="dcAjHint"></p>

      <div id="dcCoriolisWrap" ${dcSettings.coriolis===false?'hidden':''}>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><label for="dcLatitude">Breedtegraad (°)</label><input type="number" id="dcLatitude" step="0.1" min="-90" max="90" value="${dcSettings.latitudeDeg}"></div>
          <div><label for="dcAzimuth">Schietrichting (°)</label><input type="number" id="dcAzimuth" step="1" min="0" max="359" placeholder="onbekend" value="${dcSettings.azimuthDeg}"></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
          <button type="button" class="printbtn st-btn-secondary" id="dcLatBtn" style="width:auto;padding:9px 16px;">Breedtegraad via locatie</button>
          <button type="button" class="printbtn st-btn-secondary" id="dcCompassBtn" style="width:auto;padding:9px 16px;">Richting via kompas</button>
        </div>
        <p class="hint" id="dcCoriolisHint">Schietrichting = kompasrichting van jou naar het doel (0 = noord, 90 = oost). Op het noordelijk halfrond wijkt de kogel iets naar rechts af; naar het oosten schiet je iets hoger, naar het westen iets lager. Leeg = richting onbekend: dan alleen het horizontale deel. Kompas: houd de telefoon plat, met de bovenkant naar het doel.</p>
      </div>
      <p class="hint">Deze correcties zitten in de elevatie (aerodynamic jump, kop-/meewind, verticale Coriolis) en in de windage-stand <strong>TOTAAL</strong> (wind + spindrift + horizontale Coriolis) — dat is wat een Kestrel als windage toont. Een doel met een hoek wordt exact doorgerekend.</p>
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
      <p class="hint">Bij "Gecombineerd" worden spindrift en (indien aan) Coriolis automatisch bij de wind opgeteld of ervan afgehaald, afhankelijk van de windrichting op het moment van printen — geen aparte keuze nodig. De elevatie op het kaartje geldt voor de wind die erop staat (kop-/meewind en aerodynamic jump zitten erin). Past het volledige afstandsbereik niet op één kaartje, dan worden er automatisch meerdere geprint.</p>
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
    const num = (id, fallback) => { const v = parseFloat(root.querySelector(id).value); return isNaN(v) ? fallback : v; };
    dcSettings.envHumidityPct = Math.max(0, Math.min(100, num('#dcHumidity', 50)));
    const pt = root.querySelector('#dcPowderTemp').value.trim();
    dcSettings.powderTempC = pt === '' || isNaN(parseFloat(pt)) ? '' : parseFloat(pt);
    dcSettings.aeroJump = root.querySelector('#dcAeroJump').checked;
    dcSettings.coriolis = root.querySelector('#dcCoriolis').checked;
    dcSettings.latitudeDeg = Math.max(-90, Math.min(90, num('#dcLatitude', 52.1)));
    const az = root.querySelector('#dcAzimuth').value.trim();
    dcSettings.azimuthDeg = az === '' || isNaN(parseFloat(az)) ? '' : ((parseFloat(az) % 360) + 360) % 360;
  }
  // Wat de geavanceerde correcties met het actieve profiel doen — direct
  // zichtbaar, zodat duidelijk is of er iets ontbreekt (bv. twist/lengte).
  function renderAdvancedHints(){
    const profile = dcGetActiveProfile();
    const P = window.AppliedConceptsProfiles;
    const input = profile ? P.toBallisticsInput(profile) : null;
    const mvHint = root.querySelector('#dcMvHint');
    const ajHint = root.querySelector('#dcAjHint');
    root.querySelector('#dcCoriolisWrap').hidden = !dcSettings.coriolis;
    if(!profile || !input){ mvHint.textContent = ''; ajHint.textContent = ''; return; }
    const dp = P.dopeParams(profile);
    const refMs = input.muzzleVelocityFps / BALLISTICS_FT_PER_M_DC;
    const adj = dcAdjustedMvFps(profile, input);
    if(dp.mvSensMsPerC == null || dp.mvRefTempC == null){
      mvHint.textContent = 'Dit profiel heeft geen V0-temperatuurgegevens (V0 gemeten bij °C + V0-verandering per °C) — de V0 blijft ' + refMs.toFixed(0) + ' m/s. Vul ze in bij Wapenprofielen om de V0 met de kruittemperatuur mee te laten gaan.';
    } else if(adj == null){
      mvHint.textContent = 'Vul de kruittemperatuur in om de V0 te corrigeren (in density altitude-modus is de luchttemperatuur onbekend).';
    } else {
      const tp = dcPowderTempC();
      mvHint.textContent = `V0 bij ${tp} °C kruit: ${(adj / BALLISTICS_FT_PER_M_DC).toFixed(0)} m/s (gemeten: ${refMs.toFixed(0)} m/s bij ${dp.mvRefTempC} °C, ${dp.mvSensMsPerC} m/s per °C).`;
    }
    const spin = P.spinDriftParams(profile);
    if(!spin){
      ajHint.textContent = 'Spindrift en aerodynamic jump hebben kogelgewicht, -diameter, -lengte en twist rate van het profiel nodig — die ontbreken nu, dus deze twee worden niet meegerekend.';
    } else {
      const atm = dcAtmosphere();
      const B = window.AppliedConceptsBallistics;
      const sg = B.millerStability(Object.assign({}, spin, adj ? { muzzleVelocityFps: adj } : {})) / (atm.densityFactor || 1);
      const ajMil = B.aeroJumpMilPerMps(sg, spin.bulletLengthIn, spin.bulletDiameterIn, dp.twistDir);
      ajHint.textContent = `Stabiliteit (SG) ${sg.toFixed(2)}${sg < 1.4 ? ' — let op: onder 1,4 is de kogel marginaal stabiel' : ''}. Aerodynamic jump: ${Math.abs(ajMil*5).toFixed(2)} mil per 5 m/s zijwind (${dp.twistDir === 'L' ? 'linksdraaiend' : 'rechtsdraaiend'}: wind van rechts → treffer ${ajMil >= 0 ? 'hoger' : 'lager'}).`;
    }
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
    const B = window.AppliedConceptsBallistics;
    const densityFactor = dcAtmosphere().densityFactor; // incl. luchtvochtigheid, net als een Kestrel
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
    renderAdvancedHints();
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

  root.querySelector('#dcLatBtn').addEventListener('click', () => {
    const hint = root.querySelector('#dcCoriolisHint');
    if(!navigator.geolocation){ hint.textContent = 'Locatievoorziening niet beschikbaar op dit toestel — vul de breedtegraad handmatig in (Nederland ≈ 51–53°).'; return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 10) / 10;
        root.querySelector('#dcLatitude').value = lat;
        dcSettings.latitudeDeg = lat;
        hint.textContent = `Breedtegraad ingevuld via locatie: ${lat}°.`;
      },
      () => { hint.textContent = 'Locatie niet beschikbaar (toegang geweigerd of mislukt) — vul de breedtegraad handmatig in (Nederland ≈ 51–53°).'; },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  });

  // Eén kompasmeting: iOS geeft webkitCompassHeading (graden t.o.v. het
  // magnetische noorden, ~2° naast het ware noorden in NL — verwaarloosbaar
  // voor Coriolis); elders deviceorientationabsolute (alpha, tegen de klok in).
  root.querySelector('#dcCompassBtn').addEventListener('click', async () => {
    const hint = root.querySelector('#dcCoriolisHint');
    try {
      if(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'){
        const res = await DeviceOrientationEvent.requestPermission();
        if(res !== 'granted'){ hint.textContent = 'Geen toegang tot het kompas — vul de schietrichting handmatig in.'; return; }
      }
    } catch(e){ hint.textContent = 'Geen toegang tot het kompas — vul de schietrichting handmatig in.'; return; }
    hint.textContent = 'Kompas lezen… houd de telefoon plat, bovenkant naar het doel.';
    const evName = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
    let done = false;
    const onOrient = (e) => {
      let heading = null;
      if(typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
      else if(e.absolute && typeof e.alpha === 'number') heading = (360 - e.alpha) % 360;
      if(heading == null || done) return;
      done = true;
      window.removeEventListener(evName, onOrient);
      const az = Math.round(heading);
      root.querySelector('#dcAzimuth').value = az;
      dcSettings.azimuthDeg = az;
      hint.textContent = `Schietrichting ingevuld via kompas: ${az}°.`;
    };
    window.addEventListener(evName, onOrient);
    setTimeout(() => {
      if(done) return;
      window.removeEventListener(evName, onOrient);
      hint.textContent = 'Geen kompas beschikbaar op dit toestel — vul de schietrichting handmatig in.';
    }, 4000);
  });

  renderPreview();
  renderDaReadout();
  renderAdvancedHints();
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
