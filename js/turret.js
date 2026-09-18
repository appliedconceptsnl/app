/* ---------------------------------------------------------------------
   Applied Concepts — Turret Tape
   Genereert een op-schaal afdrukbare (of downloadbare) turret-tape: een
   strook die om de elevatie-turret wordt geplakt, met de originele
   fabrieks-schaalverdeling (per klik, halve en hele eenheid — zoals op de
   turret zelf) plus duidelijk uitgelichte afstand-markeringen op de exact
   berekende hoek/positie uit een wapenprofiel of handmatige dope.

   Methodiek (turret-omtrek) is gebaseerd op hoe professionele turret-tape
   generators dit aanpakken (bv. TurretLab): de gebruiker meet de diameter
   van de eigen turret met een schuifmaat — omtrek = pi x diameter, plus een
   kleine "wrap-compensatie" voor de dikte van het papier/plakband zelf.
   Er bestaat geen betrouwbare, universele fabriekswaarde voor turret-
   diameter (verschilt per merk, model en turret-uitvoering) — daarom altijd
   zelf meten, net als bij elk ander professioneel hulpmiddel hiervoor.

   Klikwaarde/omwenteling-presets: Schmidt & Bender ST-turrets gebruiken
   0.1 mrad klikken met 12 mrad per omwenteling (fabrieksopgave); veel
   andere premium FFP-kijkers (Tangent Theta, Zero Compromise Optics,
   Vortex, Nightforce e.a.) gebruiken de industriestandaard van 10 mrad per
   omwenteling met 0.1 mrad klikken.
--------------------------------------------------------------------- */

const TT_MOA_PER_MIL = 3.43774677078;
const TT_MM_PER_IN = 25.4;

// One physical tape wraps the turret exactly once, so a 2nd+ revolution's
// dope lands on the SAME printed positions as the 1st — there's only ever
// one strip to cut out and stick on. Distances are colored by which
// revolution they belong to (rev 1 = red, rev 2 = green, ...) so the shooter
// reads the color that matches their turret's own revolution indicator.
const TT_LAP_FLAG_COLORS = ['#c9573f', '#4a8f5c', '#2f6fa8', '#8a5fb0'];

const TT_CLICK_PRESETS_MIL = [0.1, 0.05, 0.2];
const TT_CLICK_PRESETS_MOA = [0.25, 0.125, 0.5, 1];

const TT_TURRET_PRESETS = [
  { id:'sb_st', label:'Schmidt & Bender ST — 0.1 mrad/klik, 12 mrad/omwenteling', unit:'mil', clickVal:0.1, unitsPerRev:12 },
  { id:'std10', label:'Standaard 10 mrad/omwenteling (Tangent Theta, ZCO, Vortex, Nightforce e.a.) — 0.1 mrad/klik', unit:'mil', clickVal:0.1, unitsPerRev:10 },
  { id:'moa15', label:'Standaard 15 MOA/omwenteling — 1/4 MOA/klik', unit:'moa', clickVal:0.25, unitsPerRev:15 },
  { id:'custom', label:'Handmatig instellen', unit:null, clickVal:null, unitsPerRev:null },
];

let ttState = {
  source: 'profile',
  profileId: null,
  manualRows: [],
  unit: 'mil',
  clickVal: 0.1,
  unitsPerRev: 10,
  sizeMode: 'diameter', // 'diameter' (schuifmaat) or 'circumference' (meetlint) — whichever the user actually measured with.
  diameterMm: '',
  circumferenceInputMm: '',
  wrapCompMm: 0.5,
  tapeWidthMm: 8,
  rangeInterval: 100,
  rangeMax: 1000,
  extraDistances: new Set(), // custom in-between distances (e.g. 150, 250 m) added on top of the interval/max range
  includedDistances: new Set(),
};

function ttMmToIn(mm){ return mm / TT_MM_PER_IN; }

function ttGetProfiles(){
  return (window.AppliedConceptsProfiles && window.AppliedConceptsProfiles.load) ? window.AppliedConceptsProfiles.load() : [];
}

// User-configurable distance list (interval + max, e.g. 50 m steps out to
// 400 m, or the default 100 m steps out to 1000 m) — not tied to the app-wide
// AC_DOPE_DISTANCES_M, since a turret tape may need to go further than the
// standard dope card, or need finer near-range granularity.
function ttDistanceRange(){
  const interval = parseFloat(ttState.rangeInterval) || 100;
  const max = parseFloat(ttState.rangeMax) || 1000;
  const out = [];
  for(let d = interval; d <= max + 1e-6; d += interval) out.push(Math.round(d));
  return out;
}

function ttManualRowsDefault(){
  return ttDistanceRange().map(d => ({ distanceM:d, value:'' }));
}

// Returns [{distanceM, valueUnits}] in ttState.unit, for every distance that
// currently has a usable numeric dope value (profile hold, or a filled-in
// manual row) — independent of whether the user has it checked for the tape.
function ttComputeDopeRows(){
  if(ttState.source === 'profile'){
    const profiles = ttGetProfiles();
    const profile = profiles.find(p => p.id === ttState.profileId);
    if(!profile) return [];
    // Interval/max range, plus any custom in-between distances the user
    // added separately (e.g. 150 m, 250 m) — deduped and sorted.
    const distances = [...new Set([...ttDistanceRange(), ...ttState.extraDistances])].sort((a,b)=>a-b);
    const rows = [];
    distances.forEach(d=>{
      const mil = window.AppliedConceptsProfiles.holdAtDistance(profile, d);
      if(mil == null || isNaN(mil)) return;
      rows.push({ distanceM: d, valueUnits: ttState.unit === 'moa' ? mil * TT_MOA_PER_MIL : mil });
    });
    return rows;
  }
  return ttState.manualRows
    .filter(r => r.distanceM > 0 && r.value !== '' && !isNaN(parseFloat(r.value)))
    .map(r => ({ distanceM: Math.round(r.distanceM), valueUnits: parseFloat(r.value) }))
    .sort((a,b)=>a.distanceM-b.distanceM);
}

function ttCircumferenceMm(){
  const wrap = parseFloat(ttState.wrapCompMm) || 0;
  if(ttState.sizeMode === 'circumference'){
    const c = parseFloat(ttState.circumferenceInputMm);
    if(!(c > 0)) return null;
    return c + wrap;
  }
  const d = parseFloat(ttState.diameterMm);
  if(!(d > 0)) return null;
  return d * Math.PI + wrap;
}

function ttUpdateCircumferenceOut(){
  const out = document.getElementById('ttCircumferenceOut');
  if(!out) return;
  const circ = ttCircumferenceMm();
  out.textContent = circ ? `Berekende omtrek: ${circ.toFixed(2)} mm` : '—';
}

function ttUpdateExtraDistHint(){
  const hint = document.getElementById('ttExtraDistHint');
  if(!hint) return;
  hint.textContent = ttState.source === 'manual'
    ? 'Voeg een extra afstand toe (bv. 150 m) — hij verschijnt als lege rij hierboven bij "Handmatige dope", vul daar de waarde in.'
    : 'Voeg een extra afstand toe tussen de vaste stappen (bv. 150 m naast 100/200 m) — de hold wordt direct berekend vanuit het wapenprofiel.';
}

/* ---- SVG rendering ---- */
// Landscape A4 so even a large turret circumference comfortably fits at 1:1.
const TT_PAGE = { w: 11.6929, h: 8.2677 };
const TT_INK = '#171510';
const TT_DIM = '#6e6e6a';
function ttPageOpen(){
  const W = TT_PAGE.w, H = TT_PAGE.h;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}in" height="${H}in" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${W}" height="${H}" fill="var(--paper)"/>`;
}
function ttHeader(title, sub){
  const W = TT_PAGE.w;
  const logoH = 0.38, logoW = logoH*LOGO_ASPECT;
  let s = `<svg x="${(W-TR_MARGIN-logoW).toFixed(4)}" y="0.10" width="${logoW.toFixed(4)}" height="${logoH.toFixed(4)}" viewBox="${LOGO_VIEWBOX}">${LOGO_BLACK_INNER}</svg>`;
  s += `<text x="${TR_MARGIN}" y="0.33" font-size="0.24" font-family="Oswald, sans-serif" font-weight="600" fill="${TT_INK}">${title}</text>`;
  s += `<text x="${TR_MARGIN}" y="0.5" font-size="0.1" letter-spacing="0.02" fill="${TT_DIM}" font-family="IBM Plex Mono, monospace">${sub}</text>`;
  s += `<line x1="${TR_MARGIN}" y1="0.6" x2="${(W-TR_MARGIN).toFixed(4)}" y2="0.6" stroke="${TT_INK}" stroke-width="0.012"/>`;
  return s;
}
function ttFooter(name){
  const W = TT_PAGE.w, H = TT_PAGE.h;
  const ruleY = H-0.35;
  let s = `<line x1="${TR_MARGIN}" y1="${ruleY.toFixed(4)}" x2="${(W-TR_MARGIN).toFixed(4)}" y2="${ruleY.toFixed(4)}" stroke="${TT_INK}" stroke-width="0.01"/>`;
  s += `<text x="${TR_MARGIN}" y="${(H-0.16).toFixed(4)}" font-size="0.09" fill="#8f8f8a" font-family="IBM Plex Mono, monospace">Applied Concepts — Performance · Development</text>`;
  s += `<text x="${(W-TR_MARGIN).toFixed(4)}" y="${(H-0.16).toFixed(4)}" text-anchor="end" font-size="0.09" fill="#8f8f8a" font-family="IBM Plex Mono, monospace">Turret tape — ${name}</text>`;
  return s;
}

// One physical tape wraps the turret exactly once, so a 2nd (or 3rd+)
// revolution's dope lands on the very same printed tick positions as the
// 1st — there's only ever one strip to cut out and stick on the turret.
// Ticks mimic a factory-engraved scale: minor (every click), medium (every
// 0.5 unit) and major (every whole unit, numbered) — exactly the hierarchy
// already printed on the turret itself, all sharing one common baseline
// (cutBottom) like a real ruler, only the tick LENGTH growing with the
// hierarchy. Distances are grouped into stacked flag rows by which
// revolution they belong to (row colors cycle through TT_LAP_FLAG_COLORS),
// closest revolution nearest the scale since it's read most often.
function ttTapeLayout(tapeWidthMm, rowCount){
  const rowH = 3.2, rowGap = 0.5;
  const flagZoneH = rowCount*rowH + Math.max(0, rowCount-1)*rowGap;
  const cutTop = flagZoneH + 1.6;
  const cutBottom = cutTop + tapeWidthMm;
  return { rowH, rowGap, cutTop, cutBottom, H: cutBottom + 8 };
}

// Total tape height for a given tape width + number of revolution rows —
// mirrors ttBuildTapeSVG's own layout, so the caller can budget vertical
// space without building the SVG first.
function ttTapeHeight(tapeWidthMm, rowCount){
  return ttTapeLayout(tapeWidthMm, rowCount).H;
}

function ttBuildTapeSVG(x0, y0, circumferenceMm, unitsPerRev, clickVal, unit, entriesByLap, tapeWidthMm){
  const W = circumferenceMm;
  const lapIndices = [...entriesByLap.keys()].sort((a,b)=>a-b); // ascending: lap 0 nearest the scale
  const { rowH, rowGap, cutTop, cutBottom, H } = ttTapeLayout(tapeWidthMm, lapIndices.length);
  const mmPerUnit = W / unitsPerRev;
  let s = `<svg x="${x0.toFixed(4)}" y="${y0.toFixed(4)}" width="${ttMmToIn(W).toFixed(4)}" height="${ttMmToIn(H).toFixed(4)}" viewBox="0 0 ${W} ${H}" style="overflow:visible;">`;

  s += `<line x1="0" y1="${cutTop}" x2="${W}" y2="${cutTop}" stroke="${TT_DIM}" stroke-width="0.12" stroke-dasharray="1.2,0.8"/>`;
  s += `<line x1="0" y1="${cutBottom}" x2="${W}" y2="${cutBottom}" stroke="${TT_DIM}" stroke-width="0.12" stroke-dasharray="1.2,0.8"/>`;

  // Shared graduated scale — same physical positions regardless of revolution.
  // The tape wraps into a closed loop, so the point one full unitsPerRev past
  // "0" (i === totalClicks) IS "0" again, physically the same spot where the
  // strip's own start already has a tick — draw it once, not twice, and
  // never label it "10" (or whatever unitsPerRev is): that number doesn't
  // exist on the dial, it just rolls over to 0 for the next revolution.
  const totalClicks = Math.round(unitsPerRev / clickVal);
  for(let i=0; i<totalClicks; i++){
    const val = i*clickVal;
    const x = i*clickVal*mmPerUnit;
    const isWhole = Math.abs(val - Math.round(val)) < 1e-6;
    const isHalf = Math.abs((val*2) - Math.round(val*2)) < 1e-6;
    let len, sw;
    if(isWhole){ len = 8.4; sw = 0.24; }
    else if(isHalf){ len = 5.6; sw = 0.13; }
    else { len = 2.6; sw = 0.09; }
    s += `<line x1="${x.toFixed(3)}" y1="${cutBottom.toFixed(3)}" x2="${x.toFixed(3)}" y2="${(cutBottom-len).toFixed(3)}" stroke="${TT_INK}" stroke-width="${sw}"/>`;
    if(isWhole){
      s += `<text x="${x.toFixed(3)}" y="${(cutBottom+3.1).toFixed(3)}" text-anchor="middle" font-size="2.3" font-family="IBM Plex Mono, monospace" font-weight="600" fill="${TT_INK}">${Math.round(val)}</text>`;
    }
  }
  s += `<text x="${(W/2).toFixed(3)}" y="${(cutBottom+6.3).toFixed(3)}" text-anchor="middle" font-size="1.7" font-family="Oswald, sans-serif" fill="${TT_DIM}" letter-spacing="0.04">${unit === 'moa' ? 'MOA' : 'MRAD'}</text>`;

  // Distance callouts, one stacked row per revolution — click-rounded
  // position, colored by revolution, unmistakable. Each leader line runs the
  // full height from its own flag down to the shared baseline.
  lapIndices.forEach((lapIndex, idxFromBottom)=>{
    const rowTop = cutTop - 1.6 - (idxFromBottom+1)*rowH - idxFromBottom*rowGap;
    const color = TT_LAP_FLAG_COLORS[lapIndex % TT_LAP_FLAG_COLORS.length];
    entriesByLap.get(lapIndex).forEach(e=>{
      const x = e.posInLapUnits * mmPerUnit;
      s += `<line x1="${x.toFixed(3)}" y1="${(rowTop+rowH).toFixed(3)}" x2="${x.toFixed(3)}" y2="${cutBottom.toFixed(3)}" stroke="${color}" stroke-width="0.24"/>`;
      s += `<circle cx="${x.toFixed(3)}" cy="${cutBottom.toFixed(3)}" r="0.6" fill="${color}"/>`;
      const label = `${e.distanceM}m`;
      const flagW = Math.max(6.5, label.length*1.85);
      let fx = x - flagW/2;
      if(fx < 0) fx = 0;
      if(fx + flagW > W) fx = W - flagW;
      s += `<rect x="${fx.toFixed(3)}" y="${rowTop.toFixed(3)}" width="${flagW.toFixed(3)}" height="${rowH.toFixed(3)}" rx="0.5" fill="${color}"/>`;
      s += `<text x="${(fx+flagW/2).toFixed(3)}" y="${(rowTop+rowH-0.85).toFixed(3)}" text-anchor="middle" font-size="2.1" font-family="Oswald, sans-serif" font-weight="700" fill="#fff">${label}</text>`;
    });
  });

  s += `</svg>`;
  return { svg: s, height: H };
}

function ttBuildTapeSheets(){
  const rows = ttComputeDopeRows().filter(r => ttState.includedDistances.has(r.distanceM));
  const circumferenceMm = ttCircumferenceMm();
  if(!circumferenceMm || rows.length === 0) return { pages:[], error: !circumferenceMm ? 'diameter' : 'rows' };

  const unitsPerRev = parseFloat(ttState.unitsPerRev), clickVal = parseFloat(ttState.clickVal);
  const tapeWidthMm = parseFloat(ttState.tapeWidthMm) || 8;

  const entriesByLap = new Map();
  rows.forEach(r=>{
    const rounded = Math.round(r.valueUnits / clickVal) * clickVal;
    const lapIndex = Math.max(0, Math.floor(rounded / unitsPerRev + 1e-9));
    const posInLapUnits = rounded - lapIndex*unitsPerRev;
    if(!entriesByLap.has(lapIndex)) entriesByLap.set(lapIndex, []);
    entriesByLap.get(lapIndex).push({ distanceM:r.distanceM, posInLapUnits });
  });
  const lapIndices = [...entriesByLap.keys()].sort((a,b)=>a-b);

  let svg = ttPageOpen();
  svg += ttHeader('TURRET TAPE', `APPLIED CONCEPTS — PERFORMANCE · DEVELOPMENT · OMTREK ${circumferenceMm.toFixed(2)} MM`);
  const xIn = ttMmToIn((TT_PAGE.w*TT_MM_PER_IN - circumferenceMm)/2);
  let y = 1.05;

  // Only needed once there's more than one revolution in play — keeps a
  // single-revolution tape (the common case) as clean as possible.
  if(lapIndices.length > 1){
    const legend = lapIndices.map(li => `<tspan fill="${TT_LAP_FLAG_COLORS[li % TT_LAP_FLAG_COLORS.length]}">■</tspan> ${li+1}e omwenteling`).join('    ');
    svg += `<text x="${TR_MARGIN}" y="${(y-0.04).toFixed(4)}" font-size="0.13" font-family="IBM Plex Mono, monospace" font-weight="600" fill="${TT_INK}">${legend}</text>`;
    y += 0.26;
  }

  const tape = ttBuildTapeSVG(xIn, y, circumferenceMm, unitsPerRev, clickVal, ttState.unit, entriesByLap, tapeWidthMm);
  svg += tape.svg;
  y += ttMmToIn(tape.height) + 0.35;

  // Printer-calibration ruler — independent of the turret, verifies "print op 100%" held.
  const rulerY = Math.max(y, TT_PAGE.h - 0.85);
  const rulerXIn = TR_MARGIN;
  svg += `<text x="${rulerXIn}" y="${(rulerY-0.08).toFixed(4)}" font-size="0.095" fill="${TT_DIM}" font-family="IBM Plex Mono, monospace">Controleer je printerschaal: dit liniaaltje moet exact 100 mm meten.</text>`;
  svg += `<svg x="${rulerXIn}" y="${rulerY.toFixed(4)}" width="${ttMmToIn(100).toFixed(4)}" height="${ttMmToIn(6).toFixed(4)}" viewBox="0 0 100 6">
    <line x1="0" y1="1" x2="100" y2="1" stroke="${TT_INK}" stroke-width="0.15"/>
    ${Array.from({length:11},(_, i)=>{ const cx=i*10; const h = i%5===0?3:2; return `<line x1="${cx}" y1="1" x2="${cx}" y2="${1+h}" stroke="${TT_INK}" stroke-width="0.12"/>`; }).join('')}
    <text x="0" y="6" font-size="2.1" font-family="IBM Plex Mono, monospace" fill="${TT_DIM}">0</text>
    <text x="100" y="6" text-anchor="end" font-size="2.1" font-family="IBM Plex Mono, monospace" fill="${TT_DIM}">100mm</text>
  </svg>`;
  svg += ttFooter('1 strook — plak op de turret');
  svg += `</svg>`;

  return { pages: [svg], error: null };
}

/* ---- UI ---- */
let ttInited = false;

function ttRenderProfileSelect(){
  const sel = document.getElementById('ttProfileSelect');
  if(!sel) return;
  const profiles = ttGetProfiles();
  if(profiles.length === 0){
    sel.innerHTML = `<option value="">— geen wapenprofielen aangemaakt —</option>`;
    ttState.profileId = null;
    return;
  }
  sel.innerHTML = profiles.map(p=>`<option value="${p.id}">${(p.label||p.caliber||'Naamloos profiel')}</option>`).join('');
  if(!profiles.find(p=>p.id===ttState.profileId)) ttState.profileId = profiles[0].id;
  sel.value = ttState.profileId;
}

function ttRenderManualRows(){
  const wrap = document.getElementById('ttManualRows');
  if(!wrap) return;
  wrap.innerHTML = ttState.manualRows.map((r, i)=>`
    <div class="tt-manual-row">
      <input type="number" class="tt-manual-dist" data-i="${i}" value="${r.distanceM}" min="1" step="1">
      <span>m</span>
      <input type="number" class="tt-manual-val" data-i="${i}" value="${r.value}" step="0.01" placeholder="${ttState.unit==='moa'?'MOA':'mil'}">
      <button type="button" class="tt-manual-remove" data-i="${i}" aria-label="Verwijder rij">×</button>
    </div>`).join('');
  wrap.querySelectorAll('.tt-manual-dist').forEach(inp=>inp.addEventListener('input', e=>{
    ttState.manualRows[+e.target.dataset.i].distanceM = parseFloat(e.target.value) || 0;
    ttUpdateAll();
  }));
  wrap.querySelectorAll('.tt-manual-val').forEach(inp=>inp.addEventListener('input', e=>{
    ttState.manualRows[+e.target.dataset.i].value = e.target.value;
    ttUpdateAll();
  }));
  wrap.querySelectorAll('.tt-manual-remove').forEach(btn=>btn.addEventListener('click', e=>{
    ttState.manualRows.splice(+e.target.dataset.i, 1);
    ttRenderManualRows();
    ttUpdateAll();
  }));
}

function ttSyncIncludedFromRows(){
  const valid = new Set(ttComputeDopeRows().map(r=>r.distanceM));
  ttState.includedDistances.forEach(d=>{ if(!valid.has(d)) ttState.includedDistances.delete(d); });
  valid.forEach(d=>{ if(!ttState.includedDistances.has(d) && !ttDistanceExplicitlyExcluded.has(d)) ttState.includedDistances.add(d); });
  ttRenderDistanceChecks();
}
// Distances the user has deliberately unchecked — kept separate from
// "not currently valid" so unchecking one doesn't get silently re-checked
// the next time the dope table recomputes (e.g. after editing a profile field).
let ttDistanceExplicitlyExcluded = new Set();

function ttRenderDistanceChecks(){
  const wrap = document.getElementById('ttDistanceChecks');
  if(!wrap) return;
  const rows = ttComputeDopeRows();
  if(rows.length === 0){
    wrap.innerHTML = `<p class="hint">Nog geen dope beschikbaar.</p>`;
    return;
  }
  wrap.innerHTML = rows.map(r=>`
    <label class="tt-dist-check">
      <input type="checkbox" data-d="${r.distanceM}" ${ttState.includedDistances.has(r.distanceM)?'checked':''}>
      <span>${r.distanceM} m <span class="tt-dist-val">(${r.valueUnits.toFixed(2)} ${ttState.unit==='moa'?'MOA':'mil'})</span></span>
    </label>`).join('');
  wrap.querySelectorAll('input[type=checkbox]').forEach(cb=>cb.addEventListener('change', e=>{
    const d = parseInt(e.target.dataset.d, 10);
    if(e.target.checked){ ttState.includedDistances.add(d); ttDistanceExplicitlyExcluded.delete(d); }
    else { ttState.includedDistances.delete(d); ttDistanceExplicitlyExcluded.add(d); }
    ttUpdateAll();
  }));
}

function ttRenderPage(){
  const pageEl = document.getElementById('pageTT');
  if(!pageEl) return;
  const { pages, error } = ttBuildTapeSheets();
  ttState._pages = pages;
  ttState._pageIdx = Math.min(ttState._pageIdx||0, Math.max(0, pages.length-1));
  pageEl.style.width = TT_PAGE.w + 'in';
  pageEl.style.height = TT_PAGE.h + 'in';
  const warn = document.getElementById('ttWarning');
  if(error === 'diameter'){
    pageEl.innerHTML = '';
    const msg = ttState.sizeMode === 'circumference'
      ? 'Vul de omtrek van je turret in (meet met een meetlint) om de tape te berekenen.'
      : 'Vul de diameter van je turret in (meet met een schuifmaat) om de tape te berekenen.';
    if(warn){ warn.hidden = false; warn.textContent = msg; }
  } else if(error === 'rows' || pages.length === 0){
    pageEl.innerHTML = '';
    if(warn){ warn.hidden = false; warn.textContent = 'Kies minstens één afstand met een geldige dope-waarde.'; }
  } else {
    if(warn) warn.hidden = true;
    pageEl.innerHTML = pages[ttState._pageIdx];
  }
  ttRenderPageTabs(pages.length);
  if(typeof fitPreview === 'function') fitPreview('pageTT', 'pageShellTT', 'scaleLabelTT');
}

function ttRenderPageTabs(count){
  const wrap = document.getElementById('ttPageTabs');
  if(!wrap) return;
  if(count < 2){ wrap.hidden = true; wrap.innerHTML = ''; return; }
  wrap.hidden = false;
  wrap.innerHTML = Array.from({length:count}, (_,i)=>`<button type="button" class="train-pagetab${i===ttState._pageIdx?' active':''}" data-idx="${i}">Blad ${i+1}</button>`).join('');
  wrap.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{ ttState._pageIdx = +b.dataset.idx; ttRenderPage(); }));
}

function ttUpdateAll(){
  ttSyncIncludedFromRows(); // also re-renders the distance checkboxes
  ttRenderPage();
}

// Manual dope is typed in whatever unit is selected at the time — switching
// units must convert those numbers (not just relabel them), otherwise "1.3"
// entered as mil silently becomes "1.3 MOA" (a different physical value) the
// moment the turret unit toggle changes.
function ttSetUnit(newUnit){
  if(newUnit === ttState.unit) return;
  if(ttState.source === 'manual'){
    ttState.manualRows.forEach(r=>{
      const v = parseFloat(r.value);
      if(isNaN(v)) return;
      r.value = String(Math.round((newUnit === 'moa' ? v * TT_MOA_PER_MIL : v / TT_MOA_PER_MIL) * 1000) / 1000);
    });
  }
  ttState.unit = newUnit;
  if(ttState.source === 'manual') ttRenderManualRows();
}

function ttApplyTurretPreset(id){
  const preset = TT_TURRET_PRESETS.find(p=>p.id===id);
  if(!preset || preset.id === 'custom') return;
  ttSetUnit(preset.unit);
  ttState.clickVal = preset.clickVal;
  ttState.unitsPerRev = preset.unitsPerRev;
  document.getElementById('ttUnit').value = preset.unit;
  ttPopulateClickOptions();
  document.getElementById('ttClickVal').value = preset.clickVal;
  document.getElementById('ttUnitsPerRev').value = preset.unitsPerRev;
}

// Rebuilds the click-value dropdown for the current unit. If the previously
// selected click value doesn't exist in the new unit's list (e.g. the user
// just flipped MIL<->MOA via the plain "Eenheden" select, not a full brand
// preset), fall back to that list's first option — and update ttState to
// match, so it can never end up NaN/stale after the swap.
function ttPopulateClickOptions(){
  const sel = document.getElementById('ttClickVal');
  if(!sel) return;
  const opts = ttState.unit === 'moa' ? TT_CLICK_PRESETS_MOA : TT_CLICK_PRESETS_MIL;
  sel.innerHTML = opts.map(v=>`<option value="${v}">${v} ${ttState.unit==='moa'?'MOA':'mil'} / klik</option>`).join('');
  const match = opts.find(v => v === ttState.clickVal);
  ttState.clickVal = match != null ? match : opts[0];
  sel.value = String(ttState.clickVal);
}

function ttDownloadSVG(){
  const svg = ttState._pages && ttState._pages[ttState._pageIdx];
  if(!svg) return;
  const full = svg.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" `);
  const blob = new Blob([full], { type:'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `turret-tape-blad-${(ttState._pageIdx||0)+1}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}

function initTurret(){
  if(ttInited){ ttRenderProfileSelect(); ttUpdateAll(); return; }
  ttInited = true;
  ttState.manualRows = ttManualRowsDefault();
  ttPopulateClickOptions();

  const sourceSel = document.getElementById('ttSource');
  const profileFields = document.getElementById('ttProfileFields');
  const manualFields = document.getElementById('ttManualFields');
  sourceSel.addEventListener('change', ()=>{
    ttState.source = sourceSel.value;
    profileFields.hidden = ttState.source !== 'profile';
    manualFields.hidden = ttState.source !== 'manual';
    ttUpdateExtraDistHint();
    ttUpdateAll();
  });
  ttUpdateExtraDistHint();

  ttRenderProfileSelect();
  document.getElementById('ttProfileSelect').addEventListener('change', e=>{
    ttState.profileId = e.target.value;
    ttUpdateAll();
  });

  ttRenderManualRows();
  document.getElementById('ttAddManualRow').addEventListener('click', ()=>{
    const last = ttState.manualRows[ttState.manualRows.length-1];
    ttState.manualRows.push({ distanceM: (last?last.distanceM:0)+100, value:'' });
    ttRenderManualRows();
    ttUpdateAll();
  });

  // Add a one-off distance between the fixed interval steps (e.g. 150 m next
  // to 100/200 m) — profile mode computes its hold immediately via the
  // ballistics engine; manual mode just adds a blank row up in "Handmatige
  // dope" for the user to fill in (same underlying list, same button here).
  const addExtraDistance = ()=>{
    const inp = document.getElementById('ttExtraDistInput');
    const val = parseFloat(inp.value);
    if(!(val > 0)) return;
    const d = Math.round(val);
    if(ttState.source === 'manual'){
      if(!ttState.manualRows.some(r=>r.distanceM === d)){
        ttState.manualRows.push({ distanceM:d, value:'' });
        ttState.manualRows.sort((a,b)=>a.distanceM-b.distanceM);
        ttRenderManualRows();
      }
    } else {
      ttState.extraDistances.add(d);
    }
    inp.value = '';
    ttUpdateAll();
  };
  document.getElementById('ttExtraDistAdd').addEventListener('click', addExtraDistance);
  document.getElementById('ttExtraDistInput').addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); addExtraDistance(); } });

  document.getElementById('ttBrand').addEventListener('change', e=>ttApplyTurretPreset(e.target.value) || ttUpdateAll());
  document.getElementById('ttUnit').addEventListener('change', e=>{
    ttSetUnit(e.target.value);
    ttPopulateClickOptions(); // also corrects ttState.clickVal if it doesn't exist for the new unit
    ttUpdateAll();
  });
  document.getElementById('ttClickVal').addEventListener('change', e=>{ ttState.clickVal = parseFloat(e.target.value); ttUpdateAll(); });
  document.getElementById('ttUnitsPerRev').addEventListener('input', e=>{ ttState.unitsPerRev = parseFloat(e.target.value) || 10; ttUpdateAll(); });
  document.getElementById('ttSizeMode').addEventListener('change', e=>{
    ttState.sizeMode = e.target.value;
    document.getElementById('ttSizeDiameterField').hidden = ttState.sizeMode !== 'diameter';
    document.getElementById('ttSizeCircumferenceField').hidden = ttState.sizeMode !== 'circumference';
    ttUpdateCircumferenceOut();
    ttUpdateAll();
  });
  document.getElementById('ttDiameter').addEventListener('input', e=>{
    ttState.diameterMm = e.target.value;
    ttUpdateCircumferenceOut();
    ttUpdateAll();
  });
  document.getElementById('ttCircumferenceInput').addEventListener('input', e=>{
    ttState.circumferenceInputMm = e.target.value;
    ttUpdateCircumferenceOut();
    ttUpdateAll();
  });
  document.getElementById('ttWrapComp').addEventListener('input', e=>{
    ttState.wrapCompMm = e.target.value;
    ttUpdateCircumferenceOut();
    ttUpdateAll();
  });
  document.getElementById('ttTapeWidth').addEventListener('input', e=>{ ttState.tapeWidthMm = parseFloat(e.target.value) || 8; ttUpdateAll(); });
  document.getElementById('ttRangeInterval').addEventListener('change', e=>{ ttState.rangeInterval = parseFloat(e.target.value); ttUpdateAll(); });
  document.getElementById('ttRangeMax').addEventListener('input', e=>{ ttState.rangeMax = parseFloat(e.target.value) || 1000; ttUpdateAll(); });

  document.getElementById('printBtnTT').addEventListener('click', ()=>{ if(window.AppliedConceptsPrint) window.AppliedConceptsPrint('turret-tape'); });
  document.getElementById('downloadBtnTT').addEventListener('click', ttDownloadSVG);

  ttUpdateAll();

  window.addEventListener('resize', ()=>{
    const panel = document.getElementById('panel-turret');
    if(panel && panel.classList.contains('active') && typeof fitPreview === 'function') fitPreview('pageTT', 'pageShellTT', 'scaleLabelTT');
  });
}

window.AppliedConceptsTurret = { init: initTurret };
