/* ---------------------------------------------------------------------
   Applied Concepts — Train
   Printbare (A4) oefenschijven. Geïnspireerd op de klassieke
   "Indoor Range Targets" opzet, herbouwd in Applied Concepts-huisstijl
   (logo, IBM Plex Mono/Oswald, NL-taal, metrische afstanden).
   Gebruikt dezelfde SVG/inch-pagina-aanpak en fitPreview()/PAGE_DIMS/
   LOGO_* constanten als de Zero Optic Calculator (js/app.js).
--------------------------------------------------------------------- */

const TR_MARGIN = 0.45;
const TR_INK = '#171510';
const TR_DIM = '#6e6e6a';
const TR_GRAY = '#c7c7c2';
// Red reads more clearly against a scope reticle (usually black/dark) than
// the same black ink as the rest of the sheet's line-work — used only for
// the hourglass aim-point chevrons, never for rings/text/labels.
const TR_RED = '#d21f1f';

// 1 MOA subtends 2.908 cm at 100 m (pure geometry: 100m * tan(1/60 degree)).
// Sniper-fundamentals sheets are sized in MOA (angle-based, matches how
// precision shooters actually think) and printed at their physical size at
// the 100 m working distance these drills are run at.
const MOA_CM_100M = 2.908;
function moaInAt100m(moa){ return (moa * MOA_CM_100M) / 2.54; }
function trMoaCircle(cx, cy, moaDiameter, opts){
  opts = opts || {};
  const rIn = moaInAt100m(moaDiameter) / 2;
  const fill = opts.fill || 'none';
  const stroke = opts.stroke || TR_INK;
  const sw = opts.strokeWidth != null ? opts.strokeWidth : 0.022;
  const dash = opts.dashed ? ` stroke-dasharray="0.05,0.045"` : '';
  let s = `<circle cx="${cx.toFixed(4)}" cy="${cy.toFixed(4)}" r="${rIn.toFixed(4)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
  if(opts.dotMoa){
    // A hairline-thin scope reticle simply erases a plain dot the instant
    // it's centered on it — you can't verify the hold. An "hourglass" of two
    // triangles tip-to-tip, gap at the true center, fixes that: the
    // crosshair sits in the visible gap, with triangle mass on all four
    // sides to check symmetry against, instead of one point that vanishes.
    s += trAimChevron(cx, cy, {size: opts.dotMoa, color: opts.dotColor});
  }
  if(opts.label){
    s += `<text x="${cx.toFixed(4)}" y="${(cy+rIn+0.16).toFixed(4)}" text-anchor="middle" font-size="0.1" font-family="IBM Plex Mono, monospace" fill="${TR_DIM}">${opts.label}</text>`;
  }
  return s;
}

// A fine reference grid around a Zero Target aim point — 1 square = exactly
// 0.1 mil (0.1 mrad = 1 cm at 100 m, so this is just CM_IN, the same
// centimeter-inch constant the Zero Optic Calculator's own click grid
// uses). Lets a shooter read their turret correction straight off the
// sheet by counting squares from group center to the aim point, instead
// of estimating it, and printed at the same 100 m distance these
// fundamentals drills are actually run at.
function trMilGrid(cx, cy, n, opts){
  opts = opts || {};
  const step = CM_IN, half = n*step;
  const stroke = opts.stroke || '#d8d8d2', sw = opts.strokeWidth != null ? opts.strokeWidth : 0.006;
  let s = `<g stroke="${stroke}" stroke-width="${sw}">`;
  for(let i=-n; i<=n; i++){
    const x = cx + i*step;
    s += `<line x1="${x.toFixed(4)}" y1="${(cy-half).toFixed(4)}" x2="${x.toFixed(4)}" y2="${(cy+half).toFixed(4)}"/>`;
  }
  for(let i=-n; i<=n; i++){
    const y = cy + i*step;
    s += `<line x1="${(cx-half).toFixed(4)}" y1="${y.toFixed(4)}" x2="${(cx+half).toFixed(4)}" y2="${y.toFixed(4)}"/>`;
  }
  s += `</g>`;
  return s;
}

function trAimChevron(cx, cy, opts){
  opts = opts || {};
  const size = opts.size || 0.12;
  const triH = moaInAt100m(size);
  const triW = moaInAt100m(size * 1.3);
  const gap = moaInAt100m(opts.gap != null ? opts.gap : size * 0.25);
  const color = opts.color || TR_RED;
  const topApexY = cy - gap/2, topBaseY = topApexY - triH;
  const botApexY = cy + gap/2, botBaseY = botApexY + triH;
  return `<polygon points="${cx.toFixed(4)},${topApexY.toFixed(4)} ${(cx-triW/2).toFixed(4)},${topBaseY.toFixed(4)} ${(cx+triW/2).toFixed(4)},${topBaseY.toFixed(4)}" fill="${color}"/>` +
    `<polygon points="${cx.toFixed(4)},${botApexY.toFixed(4)} ${(cx-triW/2).toFixed(4)},${botBaseY.toFixed(4)} ${(cx+triW/2).toFixed(4)},${botBaseY.toFixed(4)}" fill="${color}"/>`;
}

function trPageOpen(paper){
  const W = paper.w, H = paper.h;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}in" height="${H}in" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect x="0" y="0" width="${W}" height="${H}" fill="var(--paper)"/>`;
}

function trHeader(W, title, badge){
  // Same idea as the Zero Optic Calculator's header: a big logo, sized off
  // the header's own available height (here the whole 0.06–0.64 band above
  // the divider, since Train's header doesn't have the extra meta-text
  // room Optic does), and a divider/badge shortened to stop clear of it
  // instead of running underneath.
  const logoTop = 0.06, logoBottom = 0.64;
  const logoBandH = logoBottom - logoTop;
  const logoH = logoBandH * 0.92, logoW = logoH*LOGO_ASPECT;
  const logoY = logoTop + (logoBandH-logoH)/2;
  const logoX = W - TR_MARGIN - logoW;
  const textRight = logoX - 0.2;
  let s = `<svg x="${logoX.toFixed(4)}" y="${logoY.toFixed(4)}" width="${logoW.toFixed(4)}" height="${logoH.toFixed(4)}" viewBox="${LOGO_VIEWBOX}">${LOGO_BLACK_INNER}</svg>`;
  s += `<text x="${TR_MARGIN}" y="0.36" font-size="0.27" font-family="Oswald, sans-serif" font-weight="600" fill="${TR_INK}">${title}</text>`;
  s += `<text x="${TR_MARGIN}" y="0.55" font-size="0.105" letter-spacing="0.02" fill="${TR_DIM}" font-family="IBM Plex Mono, monospace">APPLIED CONCEPTS — PERFORMANCE · DEVELOPMENT</text>`;
  if(badge){
    s += `<text x="${textRight.toFixed(4)}" y="0.55" text-anchor="end" font-size="0.115" font-family="Oswald, sans-serif" font-weight="600" fill="${TR_INK}" letter-spacing="0.02">${badge}</text>`;
  }
  s += `<line x1="${TR_MARGIN}" y1="0.66" x2="${textRight.toFixed(4)}" y2="0.66" stroke="${TR_INK}" stroke-width="0.014"/>`;
  return s;
}

function trFooter(W, H, name){
  const bandH = 0.48;
  const ruleY = H - bandH;
  const qrSize = 0.4, qrX = W-TR_MARGIN-qrSize, qrY = ruleY + (bandH-qrSize)/2;
  let s = `<line x1="${TR_MARGIN}" y1="${ruleY.toFixed(4)}" x2="${(W-TR_MARGIN).toFixed(4)}" y2="${ruleY.toFixed(4)}" stroke="${TR_INK}" stroke-width="0.012"/>`;
  s += `<text x="${TR_MARGIN}" y="${(H-0.22).toFixed(4)}" font-size="0.10" fill="#8f8f8a" font-family="IBM Plex Mono, monospace">Applied Concepts — Performance · Development</text>`;
  s += `<text x="${(qrX-0.12).toFixed(4)}" y="${(H-0.22).toFixed(4)}" text-anchor="end" font-size="0.10" fill="#8f8f8a" font-family="IBM Plex Mono, monospace">Oefenblad — ${name}</text>`;
  s += buildAppQrSvg(qrX, qrY, qrSize);
  return s;
}

// Wrapped, styled text block via foreignObject — much simpler than manual
// tspan line-splitting for content whose length varies per sheet.
//
// This SVG's viewBox uses 1 unit = 1 inch, so a font-size that matches our
// inch-scale values directly (e.g. "0.115px") would need to be sub-1px —
// and Chrome silently clamps/mangles CSS font sizes below ~1px *before* the
// SVG's own scale-up is applied, rendering the text invisible. Dodge that by
// laying the div out at a much larger local scale (LS px per inch) and then
// shrinking it back down with a CSS transform, which is a geometric (not
// font) operation and isn't subject to that floor.
const TR_LOCAL_SCALE = 200;
function trText(x, y, w, h, html, opts){
  opts = opts || {};
  const fontSize = opts.fontSize || 0.12;
  const color = opts.color || TR_INK;
  const align = opts.align || 'left';
  const lineHeight = opts.lineHeight || 1.35;
  const weight = opts.weight || 400;
  const family = opts.family || "'IBM Plex Mono',monospace";
  const LS = TR_LOCAL_SCALE;
  const lw = (w*LS).toFixed(2), lh = (h*LS).toFixed(2), lfs = (fontSize*LS).toFixed(2);
  return `<foreignObject x="${x.toFixed(4)}" y="${y.toFixed(4)}" width="${w.toFixed(4)}" height="${h.toFixed(4)}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${lw}px;height:${lh}px;transform:scale(${(1/LS).toFixed(6)});transform-origin:top left;font-family:${family};font-size:${lfs}px;font-weight:${weight};color:${color};text-align:${align};line-height:${lineHeight};">${html}</div>
  </foreignObject>`;
}

function trBlankCircle(cx, cy, r, label){
  let s = `<circle cx="${cx.toFixed(4)}" cy="${cy.toFixed(4)}" r="${r.toFixed(4)}" fill="none" stroke="${TR_INK}" stroke-width="0.024"/>`;
  if(label){
    s += `<text x="${cx.toFixed(4)}" y="${(cy+r*0.24).toFixed(4)}" text-anchor="middle" font-size="${(r*0.72).toFixed(3)}" font-family="Oswald, sans-serif" font-weight="700" fill="${TR_GRAY}">${label}</text>`;
  }
  return s;
}

function trGridCell(cx, cy, r, cell){
  let s = '';
  if(cell.type === 'flag'){
    s += `<circle cx="${cx.toFixed(4)}" cy="${cy.toFixed(4)}" r="${r.toFixed(4)}" fill="${TR_INK}"/>`;
    s += trText(cx-r*0.8, cy-0.22, r*1.6, 0.46, cell.label, {fontSize:0.125, color:'#fff', align:'center', weight:600, family:"'Oswald',sans-serif", lineHeight:1.2});
    s += `<text x="${cx.toFixed(4)}" y="${(cy+r+0.26).toFixed(4)}" text-anchor="middle" font-size="0.14" font-family="Oswald, sans-serif" font-weight="600" fill="${TR_INK}">×${cell.count}</text>`;
    return s;
  }
  s += `<circle cx="${cx.toFixed(4)}" cy="${cy.toFixed(4)}" r="${r.toFixed(4)}" fill="none" stroke="${TR_INK}" stroke-width="0.022"/>`;
  if(cell.count){
    s += `<text x="${cx.toFixed(4)}" y="${(cy-r*0.72).toFixed(4)}" text-anchor="middle" font-size="0.135" font-family="Oswald, sans-serif" font-weight="600" fill="${TR_INK}">×${cell.count}</text>`;
  }
  const labelFs = cell.big ? r*0.6 : r*0.32;
  const labelY = cell.instr ? cy - r*0.28 : cy + labelFs*0.34;
  s += `<text x="${cx.toFixed(4)}" y="${labelY.toFixed(4)}" text-anchor="middle" font-size="${labelFs.toFixed(3)}" font-family="Oswald, sans-serif" font-weight="700" fill="${cell.big ? TR_GRAY : TR_INK}">${cell.label}</text>`;
  if(cell.instr){
    s += trText(cx-r*0.75, cy+labelFs*0.18, r*1.5, r*0.85, cell.instr, {fontSize:0.078, align:'center', lineHeight:1.3});
  }
  return s;
}

/* ---- Sheet 1: Opwarm-schijf ---- */
function buildWarmupSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'OPWARM-SCHIJF');
  const cx0 = W/2, colGap = 2.42, rowsY = [1.85, 4.35, 6.85, 9.15], rBase = 0.92, rBig = 1.18;
  const cols = [cx0-colGap, cx0, cx0+colGap];
  const grid = [
    [{type:'flag', label:'STERKE HAND', count:'5'},
     {type:'circ', label:'PRESS OUT', count:'8', instr:'Vanuit compressed ready — druk uit, vuur 1 schot'},
     {type:'flag', label:'ONDERST. HAND', count:'10'}],
    [{type:'circ', label:'RELOAD', count:'5 (10)', instr:'Draw of compressed ready — 1 schot, reload, 1 schot'},
     {type:'circ', label:'DRAW', count:'7', instr:'Draw — vuur 1 schot'},
     {type:'circ', label:'1', count:'5 (20)', big:true, instr:'Draw — 1 schot per cirkel, volgorde 1→4'}],
    [{type:'circ', label:'2', big:true},
     {type:'circ', label:'DRAW', count:'3 (15)', big:true, huge:true, instr:'Draw — vuur 5 schoten'},
     {type:'circ', label:'3', big:true}],
    [{type:'flag', label:'STERKE HAND', count:'5'},
     {type:'circ', label:'4', big:true},
     {type:'flag', label:'BEIDE HANDEN', count:'10'}],
  ];
  grid.forEach((row, ri)=>{
    row.forEach((cell, ci)=>{
      const r = cell.huge ? rBig : rBase;
      svg += trGridCell(cols[ci], rowsY[ri], r, cell);
    });
  });
  svg += trFooter(W, H, 'Opwarm-schijf');
  svg += `</svg>`;
  return svg;
}

/* ---- Sheet 2: Flinch-schijf ---- */
function buildFlinchSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'FLINCH-SCHIJF');
  const rowLabels = ['COMPRESSED', 'DRAW', 'TRANSITIE', 'OP TIJD'];
  const groupTop0 = 1.05, groupH = 2.45;
  const dotLeft = 1.15, dotRight = W-1.15, dotCount = 6;
  const dotGap = (dotRight-dotLeft)/(dotCount-1);
  rowLabels.forEach((lbl, i)=>{
    const gTop = groupTop0 + i*groupH;
    const textY = gTop + 1.35;
    svg += `<text x="${(W/2).toFixed(4)}" y="${textY.toFixed(4)}" text-anchor="middle" font-size="1.05" font-family="Oswald, sans-serif" font-weight="700" fill="#ececeb">${lbl}</text>`;
    const dotY = gTop + 1.95;
    for(let d=0; d<dotCount; d++){
      const dx = dotLeft + d*dotGap;
      svg += `<circle cx="${dx.toFixed(4)}" cy="${dotY.toFixed(4)}" r="0.155" fill="${TR_INK}"/>`;
    }
  });
  svg += trFooter(W, H, 'Flinch-schijf');
  svg += `</svg>`;
  return svg;
}

/* ---- Sheet 3: Triple Ten-schijf ---- */
function buildTripleTenSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'TRIPLE TEN-SCHIJF');
  const metaX = TR_MARGIN, metaW = 3.15;
  let metaY = 1.5;
  const metaRows = [
    ['AFSTAND', '6 m'],
    ['UITRUSTING', '3 magazijnen van 10 patronen — één in wapen, twee aan riem'],
    ['VUURWIJZE', 'Bij start van de tijdklok: draw en vuur 10 patronen in elke cirkel, in willekeurige volgorde.'],
  ];
  metaRows.forEach(([k, v])=>{
    svg += `<text x="${metaX}" y="${metaY.toFixed(4)}" font-size="0.12" font-family="Oswald, sans-serif" font-weight="600" fill="${TR_INK}" letter-spacing="0.01">${k}</text>`;
    const lines = Math.max(1, Math.ceil(v.length/32));
    const blockH = 0.30*lines + 0.08;
    svg += trText(metaX, metaY+0.18, metaW, blockH, v, {fontSize:0.11, color:TR_DIM, lineHeight:1.4});
    metaY += blockH + 0.50;
  });
  svg += trBlankCircle(6.0, 3.15, 1.35, '10');
  svg += trBlankCircle(1.95, 6.55, 0.95, '10');
  svg += trBlankCircle(6.15, 8.35, 1.35, '10');
  svg += trFooter(W, H, 'Triple Ten-schijf');
  svg += `</svg>`;
  return svg;
}

/* ---- Sheet 4: Throttle Control-schijf ---- */
function buildThrottleSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'THROTTLE CONTROL-SCHIJF');
  const cx = W/2, cy = 6.3, rBig = 2.05;
  const wmH = 2.3, wmW = wmH*LOGO_ASPECT;
  svg += `<g opacity="0.07"><svg x="${(cx-wmW/2).toFixed(4)}" y="${(cy-wmH/2).toFixed(4)}" width="${wmW.toFixed(4)}" height="${wmH.toFixed(4)}" viewBox="${LOGO_VIEWBOX}">${LOGO_BLACK_INNER}</svg></g>`;
  svg += `<circle cx="${cx.toFixed(4)}" cy="${cy.toFixed(4)}" r="${rBig.toFixed(4)}" fill="none" stroke="${TR_INK}" stroke-width="0.026"/>`;
  const corners = [
    {dx:-2.55, dy:-2.7, label:'1'},
    {dx:2.55, dy:-2.7, label:'2'},
    {dx:-2.55, dy:2.7, label:'2'},
    {dx:2.55, dy:2.7, label:'1'},
  ];
  corners.forEach(c=>{ svg += trBlankCircle(cx+c.dx, cy+c.dy, 0.62, c.label); });
  svg += trText(TR_MARGIN, 1.1, 3.6, 1.0, 'Op start van de tijdklok: draw en engageer een willekeurige cirkel. Elk cijfer geeft aan hoeveel treffers in die cirkel nodig zijn.', {fontSize:0.115, lineHeight:1.4});
  svg += trText(TR_MARGIN, 10.5, 5.0, 0.5, 'AFSTAND: 4,5 m &nbsp;·&nbsp; UITRUSTING: 10 patronen &nbsp;·&nbsp; ELKE MISSER: +1 sec', {fontSize:0.105, color:TR_DIM});
  svg += trFooter(W, H, 'Throttle Control-schijf');
  svg += `</svg>`;
  return svg;
}

/* ---- Sheet 5: Carbine/Pistol Quad-schijf ---- */
function buildQuadSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'CARBINE/PISTOL QUAD-SCHIJF');
  const cx = W/2;
  svg += trBlankCircle(cx, 3.15, 1.5, '');
  svg += trBlankCircle(cx, 8.05, 2.0, '');
  const legX = 5.9, legY0 = 1.9;
  ['5 m', '10 m', '15 m'].forEach((t, i)=>{
    const ly = legY0 + i*0.34;
    svg += `<line x1="${legX}" y1="${(ly-0.06).toFixed(4)}" x2="${(legX+0.5).toFixed(4)}" y2="${(ly-0.06).toFixed(4)}" stroke="${TR_INK}" stroke-width="0.012"/>`;
    svg += `<text x="${(legX+0.62).toFixed(4)}" y="${ly.toFixed(4)}" font-size="0.15" font-family="Oswald, sans-serif" font-weight="600" fill="${TR_INK}">${t}</text>`;
  });
  svg += trText(TR_MARGIN, 4.85, W-0.9, 1.1, 'Low/high ready — 4 patronen in één cirkel. Slide lock reload. 4 patronen in de andere cirkel. Elke misser: +1 sec.', {fontSize:0.125, lineHeight:1.45});
  svg += trFooter(W, H, 'Carbine/Pistol Quad-schijf');
  svg += `</svg>`;
  return svg;
}

/* ---- Sheet 6-8: "1 to 5" (3 losse bladen — links/midden/rechts) ---- */
const ONE_TO_FIVE_STEPS = [
  {n:1, pos:'links', shots:1},
  {n:2, pos:'midden', shots:2},
  {n:3, pos:'rechts', shots:3},
  {n:4, pos:'midden', shots:4},
  {n:5, pos:'links', shots:5},
];
const ONE_TO_FIVE_POS_LABEL = {links:'LINKS', midden:'MIDDEN', rechts:'RECHTS'};

function buildOneToFiveSheet(paper, pos){
  const W = paper.w, H = paper.h;
  const posLabel = ONE_TO_FIVE_POS_LABEL[pos];
  const pageNum = {links:1, midden:2, rechts:3}[pos];
  let svg = trPageOpen(paper);
  svg += trHeader(W, '1 TO 5', `BLAD ${pageNum} VAN 3 — ${posLabel}`);
  const cx = W/2, cy = 6.55, r = 2.55;
  svg += `<circle cx="${cx.toFixed(4)}" cy="${cy.toFixed(4)}" r="${r.toFixed(4)}" fill="none" stroke="${TR_INK}" stroke-width="0.03"/>`;
  svg += `<text x="${cx.toFixed(4)}" y="${(cy+0.5).toFixed(4)}" text-anchor="middle" font-size="1.5" font-family="Oswald, sans-serif" font-weight="700" fill="#e4e4e1">${posLabel}</text>`;
  const stepsHtml = ONE_TO_FIVE_STEPS.map(s=>{
    const active = s.pos === pos;
    const style = active ? 'font-weight:700;color:'+TR_INK+';' : 'color:#8f8f8a;';
    return `<div style="padding:2px 0;${style}">${s.n}. ${s.shots} schot${s.shots>1?'en':''} — ${ONE_TO_FIVE_POS_LABEL[s.pos].toLowerCase()}${active ? ' ← dit blad' : ''}</div>`;
  }).join('');
  svg += trText(TR_MARGIN, 0.85, W-0.9, 1.95, `<div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:1.13em;letter-spacing:.02em;margin-bottom:4px;">1 TO 5 — VUURSCHEMA (15 SCHOTEN TOTAAL)</div>${stepsHtml}`, {fontSize:0.115, lineHeight:1.3});
  svg += trText(TR_MARGIN, 10.15, W-0.9, 0.6, `Afstand: __________ &nbsp;&nbsp;·&nbsp;&nbsp; Hang dit blad op de ${posLabel.toLowerCase()}positie binnen de reeks van 3.`, {fontSize:0.115, color:TR_DIM});
  svg += trFooter(W, H, `1 to 5 — ${posLabel}`);
  svg += `</svg>`;
  return svg;
}

/* ---- Sheet 9: 2-2-4-schijf ---- */
function buildTwoTwoFourSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, '2-2-4-SCHIJF');
  const cy = 6.3, r = 1.65, gap = 0.5;
  const cxL = W/2 - r - gap/2, cxR = W/2 + r + gap/2;
  svg += trBlankCircle(cxL, cy, r, 'L');
  svg += trBlankCircle(cxR, cy, r, 'R');
  const stepsHtml = [
    '1. 2 schoten — linker doel (primair wapen)',
    '2. 2 schoten — rechter doel (primair wapen)',
    '3. Transitie naar pistool (Glock)',
    '4. 2 schoten — linker doel (pistool)',
    '5. 2 schoten — rechter doel (pistool)',
  ].map(l=>`<div style="padding:2px 0;">${l}</div>`).join('');
  svg += trText(TR_MARGIN, 0.85, W-0.9, 2.0, `<div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:1.13em;letter-spacing:.02em;margin-bottom:4px;">2-2-4 — VUURSCHEMA (8 SCHOTEN TOTAAL, 4 PER DOEL)</div>${stepsHtml}`, {fontSize:0.115, lineHeight:1.3});
  svg += trText(TR_MARGIN, 10.15, W-0.9, 0.6, 'Wapen (primair): __________ &nbsp;&nbsp;·&nbsp;&nbsp; Afstand: __________', {fontSize:0.115, color:TR_DIM});
  svg += trFooter(W, H, '2-2-4-schijf');
  svg += `</svg>`;
  return svg;
}

/* ---- Sheet 10-14: Triangle (overzicht + doelen A-D) ----
   Bewegingsoefening met 4 schutterposities, 2 dekkingspunten en 4 doelen.
   Doelbladen hergebruiken het IPSC-silhouet (AC_IPSC_PATH/AC_IPSC_HEAD_A/
   AC_IPSC_TORSO_A) uit js/dryfire.js — zelfde silhouet, nu als printbaar
   A4-doelblad in plaats van een scherm-overlay. */
function trIpscSilhouette(cx, topY, height){
  const w = height * (AC_IPSC_VIEWBOX_W/AC_IPSC_VIEWBOX_H);
  const x = cx - w/2;
  let s = `<svg x="${x.toFixed(4)}" y="${topY.toFixed(4)}" width="${w.toFixed(4)}" height="${height.toFixed(4)}" viewBox="0 0 ${AC_IPSC_VIEWBOX_W} ${AC_IPSC_VIEWBOX_H}">`;
  s += `<path d="${AC_IPSC_PATH}" fill="none" stroke="${TR_INK}" stroke-width="4"/>`;
  s += `<rect x="${AC_IPSC_TORSO_A.x}" y="${AC_IPSC_TORSO_A.y}" width="${AC_IPSC_TORSO_A.w}" height="${AC_IPSC_TORSO_A.h}" fill="none" stroke="${TR_INK}" stroke-width="2" stroke-dasharray="7,6"/>`;
  s += `<rect x="${AC_IPSC_HEAD_A.x}" y="${AC_IPSC_HEAD_A.y}" width="${AC_IPSC_HEAD_A.w}" height="${AC_IPSC_HEAD_A.h}" fill="none" stroke="${TR_INK}" stroke-width="2" stroke-dasharray="7,6"/>`;
  s += `</svg>`;
  return s;
}

function buildTriangleTargetSheet(paper, letter){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, `DOEL ${letter}`, 'TRIANGLE');
  svg += trIpscSilhouette(W/2, 1.85, 7.4);
  svg += trText(TR_MARGIN, 9.75, W-0.9, 0.55, 'Generiek IPSC-silhouet (lichaam + hoofd A-zone) — zie het overzichtblad "Triangle" voor positie, volgorde en aantal schoten per doel.', {fontSize:0.115, color:TR_DIM, align:'center', lineHeight:1.4});
  svg += trFooter(W, H, `Triangle — Doel ${letter}`);
  svg += `</svg>`;
  return svg;
}

function trPosMarker(p, n){
  return `<circle cx="${p.x.toFixed(4)}" cy="${p.y.toFixed(4)}" r="0.22" fill="var(--paper)" stroke="${TR_INK}" stroke-width="0.024"/>` +
    `<text x="${p.x.toFixed(4)}" y="${(p.y+0.065).toFixed(4)}" text-anchor="middle" font-size="0.19" font-family="Oswald, sans-serif" font-weight="700" fill="${TR_INK}">${n}</text>`;
}
function trMiniTarget(p, label){
  return `<rect x="${(p.x-0.22).toFixed(4)}" y="${(p.y-0.32).toFixed(4)}" width="0.44" height="0.64" rx="0.05" fill="${TR_INK}"/>` +
    `<text x="${p.x.toFixed(4)}" y="${(p.y+0.11).toFixed(4)}" text-anchor="middle" font-size="0.17" font-family="Oswald, sans-serif" font-weight="700" fill="#fff">${label}</text>`;
}
function trPathArrow(p1, p2){
  return `<line x1="${p1.x.toFixed(4)}" y1="${p1.y.toFixed(4)}" x2="${p2.x.toFixed(4)}" y2="${p2.y.toFixed(4)}" stroke="${TR_INK}" stroke-width="0.022" stroke-dasharray="0.09,0.07" marker-end="url(#trArrowHead)"/>`;
}
function trBarricade(cx, cy, w, h){
  return `<rect x="${(cx-w/2).toFixed(4)}" y="${(cy-h/2).toFixed(4)}" width="${w.toFixed(4)}" height="${h.toFixed(4)}" fill="#e2e2dc" stroke="${TR_INK}" stroke-width="0.018"/>`;
}
function trDistLabel(p1, p2, label){
  const mx = (p1.x+p2.x)/2, my = (p1.y+p2.y)/2;
  return `<rect x="${(mx-0.34).toFixed(4)}" y="${(my-0.13).toFixed(4)}" width="0.68" height="0.26" fill="var(--paper)"/>` +
    `<text x="${mx.toFixed(4)}" y="${(my+0.06).toFixed(4)}" text-anchor="middle" font-size="0.14" font-family="IBM Plex Mono, monospace" font-weight="600" fill="${TR_INK}">${label}</text>`;
}

function buildTriangleOverviewSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'TRIANGLE — OVERZICHT');
  svg += `<defs><marker id="trArrowHead" markerWidth="8" markerHeight="8" refX="5.5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="${TR_INK}"/></marker></defs>`;

  const mapTop = 0.95, mapBottom = 6.35, mapLeft = TR_MARGIN, mapRight = W-TR_MARGIN;
  svg += `<rect x="${mapLeft}" y="${mapTop}" width="${(mapRight-mapLeft).toFixed(4)}" height="${(mapBottom-mapTop).toFixed(4)}" fill="none" stroke="${TR_DIM}" stroke-width="0.012" stroke-dasharray="0.05,0.05"/>`;

  const posA = { x: mapLeft+2.15, y: mapTop+0.55 };
  const posB = { x: mapLeft+3.35, y: mapTop+0.55 };
  const posC = { x: mapRight-0.85, y: mapTop+2.5 };
  const posD = { x: mapRight-0.85, y: mapTop+3.95 };
  const pos1 = { x: mapLeft+0.9, y: mapBottom-0.55 };
  const pos2 = { x: mapRight-1.55, y: mapBottom-0.65 };
  const pos3 = { x: mapRight-1.55, y: mapTop+3.2 };
  const pos4 = { x: mapLeft+1.55, y: mapTop+1.65 };

  svg += trPathArrow(pos1, pos2);
  svg += trPathArrow(pos2, pos3);
  svg += trPathArrow(pos3, pos4);

  svg += trBarricade(pos2.x+0.55, pos2.y-0.15, 0.34, 0.95);
  svg += trBarricade(pos4.x-0.1, pos4.y+0.6, 0.95, 0.3);

  svg += trMiniTarget(posA, 'A');
  svg += trMiniTarget(posB, 'B');
  svg += trMiniTarget(posC, 'C');
  svg += trMiniTarget(posD, 'D');

  svg += trDistLabel(pos1, pos2, '7 m');
  svg += trDistLabel(pos2, pos3, '15 m');
  svg += trDistLabel(pos3, pos4, '20 m');

  svg += trPosMarker(pos1, '1');
  svg += trPosMarker(pos2, '2');
  svg += trPosMarker(pos3, '3');
  svg += trPosMarker(pos4, '4');

  svg += trText(mapLeft, mapBottom+0.12, mapRight-mapLeft, 0.3, '○ schutterspositie &nbsp;·&nbsp; pijl (- - -) = beweging/rennen &nbsp;·&nbsp; grijs blok = dekking/barricade &nbsp;·&nbsp; zwart blokje = doel', {fontSize:0.105, color:TR_DIM, align:'center'});

  const stepsHtml = [
    ['1', 'Positie 1 (start).', 'Op het startsein (speedtimer): 2 lichaamsschoten + 1 hoofdschot op doel A, en 2 lichaamsschoten + 1 hoofdschot op doel B.'],
    ['2', 'Verplaats naar Positie 2 (achter dekking).', 'Vanuit dekking: 4 gerichte lichaamsschoten op doel C.'],
    ['3', 'Kom de hoek van de barricade om (Positie 2).', 'Dynamisch (tijdens het lopen): 2 lichaamsschoten + 1 hoofdschot op doel D.'],
    ['4', 'Verplaats via de aangegeven route, de hoek om, richting Positie 3.', 'Dynamisch (terwijl je naar voren beweegt): 3 patronen, verdeeld over doel C en D.'],
    ['5', 'Verplaats via de route naar de volgende barricade (Positie 4).', 'Tijdens het rennen: speed reload — geen schoten tijdens deze verplaatsing.'],
    ['6', 'Kom de hoek om bij Positie 4.', 'Dynamisch: 2 patronen, verdeeld over doel A en B.'],
  ].map(([n, title, body])=>`<div style="padding:4px 0;"><span style="font-weight:700;">${n}. ${title}</span><br>${body}</div>`).join('');
  svg += trText(TR_MARGIN, 6.95, W-0.9, 3.55, `<div style="font-family:'Oswald',sans-serif;font-weight:600;font-size:1.1em;letter-spacing:.02em;margin-bottom:4px;">VUURSCHEMA (18 PATRONEN TOTAAL &nbsp;·&nbsp; 4 POSITIES &nbsp;·&nbsp; 1 RELOAD TIJDENS BEWEGING)</div>${stepsHtml}`, {fontSize:0.115, lineHeight:1.32});

  svg += trText(TR_MARGIN, 10.75, W-0.9, 0.4, 'Dynamische/bewegende oefening — alleen uitvoeren onder toezicht en volgens de geldende baanregels.', {fontSize:0.105, color:TR_DIM});
  svg += trFooter(W, H, 'Triangle — Overzicht');
  svg += `</svg>`;
  return svg;
}

/* ---- Sniper fundamentals (100m) ----
   Op onderzoek gebaseerd op erkende precision-rifle trainingsmethodiek:
   Natural Point of Aim-verificatie (Sniper's Hide "eyes closed, breathe,
   open" methode), bipod-belastingstechniek (consistente voorwaartse druk
   voorkomt "bipod hop" en POI-verschuiving), en de klassieke Sniper's Hide
   "21 Dot Drill" (hier in de door Modern Day Sniper aangepaste, positionele
   variant met mag change/support-side/transitie-onderdelen). Maten staan in
   MOA (schaalbaar, sluit aan bij hoe precision-schutters zelf rekenen) en
   worden geprint op hun fysieke grootte op 100 m. */

function buildZeroTargetSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'ZERO TARGET', '100M · FUNDAMENTALS');
  svg += trText(TR_MARGIN, 0.85, W-0.9, 0.85, 'Vuur een groep van 3–5 schoten per aanvinkpunt. Geslaagd: groep ≤1 MOA <b>en</b> het groepscentrum valt binnen 0,5 MOA van het middelpunt (stippellijn). Gebruik een nieuw punt per bevestigingspoging — zo kun je meerdere keren bevestigen zonder overlappende gaten. Elk vakje van het raster is exact 0,1 mil, zodat je de turret-correctie direct van de schijf afleest.', {fontSize:0.115, lineHeight:1.4});
  const cols = [W/2-2.55, W/2, W/2+2.55], rows = [3.3, 6.6, 9.5];
  let n = 1;
  rows.forEach(cy=>{
    cols.forEach(cx=>{
      svg += trMilGrid(cx, cy, 2);
      svg += trMoaCircle(cx, cy, 0.5, {dashed:true, stroke:TR_DIM, dotMoa:0.15});
      svg += `<text x="${cx.toFixed(4)}" y="${(cy-0.5).toFixed(4)}" text-anchor="middle" font-size="0.13" font-family="Oswald, sans-serif" font-weight="700" fill="${TR_GRAY}">${n}</text>`;
      n++;
    });
  });
  svg += trFooter(W, H, 'Zero Target');
  svg += `</svg>`;
  return svg;
}

function buildBipodPressureSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'BIPOD PRESSURE LOAD TEST', '100M · TECHNIEK & POSITIES');
  svg += trText(TR_MARGIN, 0.85, W-0.9, 0.85, 'Consistente belasting van de bipod voorkomt "bipod hop" en houdt de POI stabiel — te veel voorwaartse druk drukt de POI doorgaans omlaag, loslaten/achterwaarts juist omhoog. Vuur een groep van 3 schoten per cirkel en vergelijk de POI-verschuiving t.o.v. NORMAAL.', {fontSize:0.115, lineHeight:1.4});

  const cx = W/2, topY = 3.15, botY = 6.95, R_LABEL = 1.5;
  svg += trMoaCircle(cx, topY, 2, {dotMoa:0.3});
  svg += `<text x="${cx.toFixed(4)}" y="${(topY+R_LABEL).toFixed(4)}" text-anchor="middle" font-size="0.16" font-family="Oswald, sans-serif" font-weight="700" fill="${TR_INK}">NORMAAL</text>`;

  const cols = [W/2-2.3, W/2, W/2+2.3];
  const names = ['VOORWAARTS', 'NEUTRAAL', 'ACHTERWAARTS'];
  cols.forEach((cx2, i)=>{
    svg += trMoaCircle(cx2, botY, 2, {dotMoa:0.3});
    svg += `<text x="${cx2.toFixed(4)}" y="${(botY+R_LABEL).toFixed(4)}" text-anchor="middle" font-size="0.135" font-family="Oswald, sans-serif" font-weight="700" fill="${TR_INK}">${names[i]}</text>`;
  });

  const legend = [
    '1. NORMAAL — jouw gebruikelijke, neutrale belasting (nulmeting).',
    '2. VOORWAARTS — druk met de schouder naar voren in de bipod.',
    '3. NEUTRAAL — laat het wapen los, alleen het eigen gewicht.',
    '4. ACHTERWAARTS — trek het wapen licht naar achteren.',
  ].map(l=>`<div style="padding:2px 0;">${l}</div>`).join('');
  svg += trText(TR_MARGIN, 9.75, W-0.9, 1.3, legend, {fontSize:0.115, lineHeight:1.3, color:TR_DIM});

  svg += trFooter(W, H, 'Bipod Pressure Load Test');
  svg += `</svg>`;
  return svg;
}

function buildNpaNoBagSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'NPA & NO-BAG TARGET', '100M · FUNDAMENTALS');
  svg += trText(TR_MARGIN, 0.85, W-0.9, 1.05, 'Natural Point of Aim (NPA): bouw je positie, richt, sluit je ogen, adem 1–2 keer rustig uit en ontspan. Open je ogen — staat het richtmiddel nog op het doel? Zo niet: verplaats je hele lichaam/positie (niet de spieren) tot dit wél zo is. Vuur daarna, zónder achterzak/support, één schot per cirkel — begin bij de grootste.', {fontSize:0.115, lineHeight:1.38});

  const sizes = [2, 1.2, 0.7, 0.4];
  const cols = [W/2-1.6, W/2+1.6];
  const rowsY = [3.4, 5.7, 7.4, 8.7];
  cols.forEach((cx, colI)=>{
    sizes.forEach((moa, i)=>{
      svg += trMoaCircle(cx, rowsY[i], moa, {dotMoa:0.15, stroke: i===0?TR_DIM:TR_INK});
    });
    svg += `<text x="${cx.toFixed(4)}" y="9.4" text-anchor="middle" font-size="0.12" font-family="Oswald, sans-serif" font-weight="600" fill="${TR_DIM}">REEKS ${colI+1}</text>`;
  });
  svg += trText(TR_MARGIN, 9.75, W-0.9, 1.1, '2 → 0,4 MOA, groot naar klein. Eén schot per cirkel; bij het missen van een cirkel: check je NPA opnieuw voordat je verder gaat.', {fontSize:0.115, color:TR_DIM, lineHeight:1.4});

  svg += trFooter(W, H, 'NPA & No-Bag Target');
  svg += `</svg>`;
  return svg;
}

function buildTripodEvalSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'TRIPOD EVAL', '100M · TECHNIEK & POSITIES');
  svg += trText(TR_MARGIN, 0.85, W-0.9, 0.5, 'Sluit aan op de Tripod Training in Dry Fire (Staand/Knielend/Zittend). Drie doelmaten per positie (groot = slow fire · midden = build/break · klein = deploy) — vuur, noteer per poging het resultaat (T/F) in de tabel.', {fontSize:0.115, lineHeight:1.35});

  const positions = ['STAAND', 'KNIELEND', 'ZITTEND'];
  const cols = [W/2-2.55, W/2, W/2+2.55];
  const tierY = [3.0, 5.2, 7.0];
  const tierMoa = [1.5, 1, 0.6];
  cols.forEach((cx, i)=>{
    svg += `<text x="${cx.toFixed(4)}" y="1.95" text-anchor="middle" font-size="0.14" font-family="Oswald, sans-serif" font-weight="700" fill="${TR_INK}">${positions[i]}</text>`;
    tierMoa.forEach((moa, t)=>{ svg += trMoaCircle(cx, tierY[t], moa, {dotMoa:0.15}); });
  });

  // Score table
  const tableTop = 7.7, rowH = 0.4, tableLeft = TR_MARGIN, tableW = W-0.9;
  const colW = tableW/4;
  const rows = ['Slow fire', 'Build/break 1', 'Build/break 2', 'Build/break 3', 'Deploy 1', 'Deploy 2'];
  svg += `<rect x="${tableLeft}" y="${tableTop}" width="${tableW}" height="${rowH*(rows.length+1)}" fill="none" stroke="${TR_INK}" stroke-width="0.012"/>`;
  for(let c=0; c<=3; c++){
    const x = tableLeft + c*colW;
    svg += `<line x1="${x.toFixed(4)}" y1="${tableTop}" x2="${x.toFixed(4)}" y2="${(tableTop+rowH*(rows.length+1)).toFixed(4)}" stroke="${TR_INK}" stroke-width="0.010"/>`;
  }
  for(let r=0; r<=rows.length+1; r++){
    const y = tableTop + r*rowH;
    svg += `<line x1="${tableLeft}" y1="${y.toFixed(4)}" x2="${(tableLeft+tableW).toFixed(4)}" y2="${y.toFixed(4)}" stroke="${TR_INK}" stroke-width="0.010"/>`;
  }
  const headers = ['', ...positions];
  headers.forEach((h, c)=>{
    svg += `<text x="${(tableLeft+c*colW+colW/2).toFixed(4)}" y="${(tableTop+rowH*0.65).toFixed(4)}" text-anchor="middle" font-size="0.115" font-family="Oswald, sans-serif" font-weight="700" fill="${TR_INK}">${h}</text>`;
  });
  rows.forEach((r, ri)=>{
    const y = tableTop + (ri+1)*rowH;
    svg += `<text x="${(tableLeft+0.1).toFixed(4)}" y="${(y+rowH*0.65).toFixed(4)}" font-size="0.11" font-family="IBM Plex Mono, monospace" fill="${TR_INK}">${r}</text>`;
  });

  svg += trFooter(W, H, 'Tripod Eval');
  svg += `</svg>`;
  return svg;
}

function buildPositionalCirclesSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'POSITIONAL CIRCLES', '100M · TECHNIEK & POSITIES');
  svg += trText(TR_MARGIN, 0.85, W-0.9, 0.55, 'Onopgesteund/semi-opgesteund per positie — probeer je groep (3–5 schoten) binnen de kleinst mogelijke ring te houden.', {fontSize:0.115, lineHeight:1.35});

  const names = ['STAAND', 'HOOG KNIELEND', 'LAAG KNIELEND', 'ZITTEND'];
  const cx = [W/2-2.05, W/2+2.05], cy = [3.5, 8.0];
  const moaRings = [2, 1.2, 0.6];
  let i = 0;
  cy.forEach(y=>{
    cx.forEach(x=>{
      moaRings.forEach(moa=>{ svg += trMoaCircle(x, y, moa, {stroke: TR_INK}); });
      svg += trAimChevron(x, y, {size: 0.15});
      svg += `<text x="${x.toFixed(4)}" y="${(y-1.4).toFixed(4)}" text-anchor="middle" font-size="0.135" font-family="Oswald, sans-serif" font-weight="700" fill="${TR_INK}">${names[i]}</text>`;
      i++;
    });
  });

  svg += trFooter(W, H, 'Positional Circles');
  svg += `</svg>`;
  return svg;
}

function buildConsistencyCheckSheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, 'CONSISTENCY CHECK TARGET', '100M · FUNDAMENTALS');
  svg += trText(TR_MARGIN, 0.85, W-0.9, 0.55, 'Consistentie = nauwkeurigheid. Eén schot per cirkel, verspreid over meerdere sessies — houd de datum bij om drift in je cold-bore/eerste-schot op te sporen.', {fontSize:0.115, lineHeight:1.35});

  const cols = 3, gridRows = 5, moa = 1;
  const left = TR_MARGIN+1.0, right = W-TR_MARGIN-1.0;
  const top = 2.15, bottom = 9.6;
  const colGap = (right-left)/(cols-1), rowGap = (bottom-top)/(gridRows-1);
  let n = 1;
  for(let r=0; r<gridRows; r++){
    for(let c=0; c<cols; c++){
      const x = left+c*colGap, y = top+r*rowGap;
      svg += trMoaCircle(x, y, moa, {fill:TR_GRAY, strokeWidth:0.03});
      svg += `<text x="${(x+0.35).toFixed(4)}" y="${(y-0.35).toFixed(4)}" text-anchor="middle" font-size="0.09" font-family="IBM Plex Mono, monospace" fill="${TR_DIM}">${n}</text>`;
      n++;
    }
  }
  svg += trText(TR_MARGIN, 10.4, W-0.9, 0.35, 'Datum: __________  ·  Datum: __________  ·  Datum: __________', {fontSize:0.115, color:TR_DIM});

  svg += trFooter(W, H, 'Consistency Check Target');
  svg += `</svg>`;
  return svg;
}

function buildDotDrill21Sheet(paper){
  const W = paper.w, H = paper.h;
  let svg = trPageOpen(paper);
  svg += trHeader(W, '21 DOT DRILL', '100M · TECHNIEK & POSITIES');
  svg += trText(TR_MARGIN, 0.85, W-0.9, 0.45, 'Gebaseerd op de klassieke Sniper’s Hide 21 Dot Drill. Nulpunt-controle vooraf: 2 schoten, 30 sec.', {fontSize:0.115, lineHeight:1.35, color:TR_DIM});

  const rowsInfo = [
    { caption:'40 SEC — 3 SCHOTEN / MAGAZIJNWISSEL / 2 SCHOTEN', dots:['', '', '', '', ''] },
    { caption:'40 SEC — 5 SCHOTEN ONDERSTEUNENDE ZIJDE (OOG, SCHOUDER, TREKKERVINGER WISSELEN)', dots:['', '', '', '', ''] },
    { caption:'STAAND NAAR LIGGEND (WAPEN KLAARGEZET, MAGAZIJN IN, GRENDEL ACHTER)', dots:['15s','13s','10s','8s','6s'] },
    { caption:'LOW/HIGH READY NAAR LIGGEND (WAPEN IN HANDEN, MAGAZIJN IN, GRENDEL ACHTER)', dots:['25s','20s','15s','12s','10s'] },
  ];
  const dotMoa = 1.0;
  const left = TR_MARGIN+0.75, right = W-TR_MARGIN-0.75;
  const colGap = (right-left)/4;
  const rowTop0 = 1.85, rowH = 2.4;
  rowsInfo.forEach((row, ri)=>{
    const capY = rowTop0 + ri*rowH;
    svg += trText(TR_MARGIN, capY, W-0.9, 0.5, row.caption, {fontSize:0.095, weight:600, family:"'Oswald',sans-serif", color:TR_INK, lineHeight:1.3});
    const dotY = capY + 1.05;
    row.dots.forEach((lbl, ci)=>{
      const x = left + ci*colGap;
      svg += trMoaCircle(x, dotY, dotMoa, {fill:TR_INK, stroke:TR_INK});
      if(lbl) svg += `<text x="${x.toFixed(4)}" y="${(dotY-0.62).toFixed(4)}" text-anchor="middle" font-size="0.13" font-family="Oswald, sans-serif" font-weight="700" fill="${TR_INK}">${lbl}</text>`;
    });
  });

  svg += trFooter(W, H, '21 Dot Drill');
  svg += `</svg>`;
  return svg;
}

/* ---- Registry + UI ----
   Elke oefening hoort bij een doelgroep (group: 'carbine' of 'sniper') —
   dat bepaalt welke set er getoond wordt achter de Carbine/Sniper-keuze
   bovenaan het tabblad. Alles wat vóór die knop bestond was carbine-gericht,
   dus valt daar nu onder; sniper-oefeningen volgen later. */
const TRAIN_EXERCISES = [
  { id:'warmup', group:'carbine', cat:'basis', name:'Opwarm-schijf', desc:'12 korte reeksen — draw, reload, press out, sterke/ondersteunende hand.', build:(p)=>[buildWarmupSheet(p)] },
  { id:'flinch', group:'carbine', cat:'basis', name:'Flinch-schijf', desc:'24 stippen in 4 reeksen — compressed, draw, transitie, op tijd.', build:(p)=>[buildFlinchSheet(p)] },
  { id:'tripleten', group:'carbine', cat:'basis', name:'Triple Ten-schijf', desc:'3 cirkels, 10 patronen elk — draw en vuur snel op tijd.', build:(p)=>[buildTripleTenSheet(p)] },
  { id:'throttle', group:'carbine', cat:'basis', name:'Throttle Control-schijf', desc:'Willekeurige cirkel — het cijfer bepaalt het aantal treffers.', build:(p)=>[buildThrottleSheet(p)] },
  { id:'quad', group:'carbine', cat:'basis', name:'Carbine/Pistol Quad-schijf', desc:'2 cirkels — low/high ready + slide lock reload.', build:(p)=>[buildQuadSheet(p)] },
  { id:'onetofive', group:'carbine', cat:'drills', name:'1 to 5', desc:'1-2-3-4-5 schoten over links/midden/rechts — 3 losse bladen.', pageNames:['Links', 'Midden', 'Rechts'], build:(p)=>[buildOneToFiveSheet(p,'links'), buildOneToFiveSheet(p,'midden'), buildOneToFiveSheet(p,'rechts')] },
  { id:'twotwofour', group:'carbine', cat:'drills', name:'2-2-4', desc:'2 links, 2 rechts, transitie naar Glock, 2 links, 2 rechts.', build:(p)=>[buildTwoTwoFourSheet(p)] },
  { id:'triangle', group:'carbine', cat:'drills', name:'Triangle', desc:'4 posities, 4 doelen (A–D), bewegend/dynamisch vuren + speed reload — met overzichtblad en doelbladen.', pageNames:['Overzicht', 'Doel A', 'Doel B', 'Doel C', 'Doel D'], build:(p)=>[buildTriangleOverviewSheet(p), buildTriangleTargetSheet(p,'A'), buildTriangleTargetSheet(p,'B'), buildTriangleTargetSheet(p,'C'), buildTriangleTargetSheet(p,'D')] },

  { id:'zerotarget', group:'sniper', cat:'basis', name:'Zero Target', desc:'9 aanvinkpunten, 0,5 MOA-tolerantie — bevestig je nulpunt zonder oude gaten te hergebruiken.', build:(p)=>[buildZeroTargetSheet(p)] },
  { id:'npanobag', group:'sniper', cat:'basis', name:'NPA & No-Bag Target', desc:'4 cirkels (2 → 0,4 MOA), zonder achterzak — bouw je Natural Point of Aim en bevestig hem.', build:(p)=>[buildNpaNoBagSheet(p)] },
  { id:'consistency', group:'sniper', cat:'basis', name:'Consistency Check Target', desc:'15x 1 MOA — één schot per cirkel, verspreid over meerdere sessies.', build:(p)=>[buildConsistencyCheckSheet(p)] },
  { id:'bipodpressure', group:'sniper', cat:'drills', name:'Bipod Pressure Load Test', desc:'Normaal vs. voorwaarts/neutraal/achterwaarts — vergelijk de POI-verschuiving.', build:(p)=>[buildBipodPressureSheet(p)] },
  { id:'positionalcircles', group:'sniper', cat:'drills', name:'Positional Circles', desc:'Staand, hoog/laag knielend, zittend — onopgesteund, 3 ringmaten per positie.', build:(p)=>[buildPositionalCirclesSheet(p)] },
  { id:'tripodeval', group:'sniper', cat:'drills', name:'Tripod Eval', desc:'Staand/knielend/zittend x slow fire/build-break/deploy — met scoretabel.', build:(p)=>[buildTripodEvalSheet(p)] },
  { id:'dotdrill21', group:'sniper', cat:'drills', name:'21 Dot Drill', desc:'Klassieke Sniper’s Hide-drill — magazijnwissel, ondersteunende zijde, transities onder tijdsdruk.', build:(p)=>[buildDotDrill21Sheet(p)] },
];

let acTrainInited = false;
let acTrainGroup = 'carbine';
let acTrainState = { exerciseId:null, pageIdx:0, pagesSvg:[] };
let acTrainSelected = new Set();

function acTrainExercisesInGroup(){
  return TRAIN_EXERCISES.filter(ex => ex.group === acTrainGroup);
}

function acTrainUpdatePrintLabel(){
  const btn = document.getElementById('printBtnT');
  if(!btn) return;
  const n = acTrainSelected.size;
  btn.textContent = n > 0 ? `Print geselecteerde oefeningen (${n})` : 'Print huidig oefenblad';
}

function acTrainSetSelected(id, on){
  if(on) acTrainSelected.add(id); else acTrainSelected.delete(id);
  const item = document.querySelector(`.train-item[data-id="${id}"]`);
  if(item) item.classList.toggle('selected', on);
  acTrainUpdatePrintLabel();
}

const TRAIN_GROUP_LEGENDS = {
  carbine: { basis:'Basisoefeningen', drills:'Applied Concepts drills' },
  sniper: { basis:'Precisie-fundamentals', drills:'Techniek & posities' },
};

function acTrainRenderList(){
  const cats = { basis: document.getElementById('trainListBasics'), drills: document.getElementById('trainListDrills') };
  Object.values(cats).forEach(c=>{ if(c) c.innerHTML = ''; });
  const inGroup = acTrainExercisesInGroup();
  const legends = TRAIN_GROUP_LEGENDS[acTrainGroup] || TRAIN_GROUP_LEGENDS.carbine;
  const basicsLegend = document.getElementById('trainBasicsLegend');
  const drillsLegend = document.getElementById('trainDrillsLegend');
  if(basicsLegend) basicsLegend.textContent = legends.basis;
  if(drillsLegend) drillsLegend.textContent = legends.drills;
  const basicsFieldset = document.getElementById('trainBasicsFieldset');
  const drillsFieldset = document.getElementById('trainDrillsFieldset');
  if(basicsFieldset) basicsFieldset.hidden = !inGroup.some(ex=>ex.cat==='basis');
  if(drillsFieldset) drillsFieldset.hidden = !inGroup.some(ex=>ex.cat==='drills');
  inGroup.forEach(ex=>{
    const container = cats[ex.cat];
    if(!container) return;
    const item = document.createElement('div');
    item.className = 'train-item';
    item.dataset.id = ex.id;

    const checkLabel = document.createElement('label');
    checkLabel.className = 'train-item-check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.setAttribute('aria-label', `Selecteer ${ex.name} om te printen`);
    check.addEventListener('change', ()=>acTrainSetSelected(ex.id, check.checked));
    checkLabel.appendChild(check);

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'train-item-body';
    body.dataset.id = ex.id;
    body.innerHTML = `<span class="train-item-name">${ex.name}</span><span class="train-item-desc">${ex.desc}</span>`;
    body.addEventListener('click', ()=>acTrainPreview(ex.id));

    item.appendChild(checkLabel);
    item.appendChild(body);
    container.appendChild(item);
  });
}

function acTrainRenderPageTabs(ex){
  const wrap = document.getElementById('trainPageTabs');
  if(!wrap) return;
  if(!ex.pageNames || ex.pageNames.length < 2){
    wrap.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = ex.pageNames.map((name, i)=>`<button type="button" class="train-pagetab${i===0?' active':''}" data-idx="${i}">${i+1}. ${name}</button>`).join('');
  wrap.querySelectorAll('.train-pagetab').forEach(b=>{
    b.addEventListener('click', ()=>{
      acTrainState.pageIdx = parseInt(b.dataset.idx, 10);
      wrap.querySelectorAll('.train-pagetab').forEach(x=>x.classList.toggle('active', x===b));
      acTrainRenderPage();
    });
  });
}

function acTrainRenderPage(){
  const pageEl = document.getElementById('pageT');
  if(!pageEl) return;
  pageEl.style.width = PAGE_DIMS.a4.w + 'in';
  pageEl.style.height = PAGE_DIMS.a4.h + 'in';
  pageEl.innerHTML = acTrainState.pagesSvg[acTrainState.pageIdx] || '';
  if(typeof fitPreview === 'function') fitPreview('pageT', 'pageShellT', 'scaleLabelT');
}

function acTrainPreview(id){
  const ex = TRAIN_EXERCISES.find(e=>e.id===id);
  if(!ex) return;
  acTrainState.exerciseId = id;
  acTrainState.pagesSvg = ex.build(PAGE_DIMS.a4);
  acTrainState.pageIdx = 0;
  document.querySelectorAll('.train-item-body').forEach(b=>b.classList.toggle('previewing', b.dataset.id === id));
  acTrainRenderPageTabs(ex);
  acTrainRenderPage();
}

// Build the print-only batch: every page of every selected oefening (list
// order), each a full A4 .page so it prints at 100% — the live preview's
// .page carries an on-screen fit-to-viewport scale that must never reach
// the printer, so this batch is a separate, unscaled set of pages.
function acTrainBuildPrintBatch(){
  const batch = document.getElementById('trainPrintBatch');
  if(!batch) return;
  const ids = acTrainSelected.size > 0 ? TRAIN_EXERCISES.filter(e=>acTrainSelected.has(e.id)).map(e=>e.id)
    : (acTrainState.exerciseId ? [acTrainState.exerciseId] : []);
  batch.innerHTML = '';
  ids.forEach(id=>{
    const ex = TRAIN_EXERCISES.find(e=>e.id===id);
    if(!ex) return;
    ex.build(PAGE_DIMS.a4).forEach(svg=>{
      const pageEl = document.createElement('div');
      pageEl.className = 'page';
      pageEl.style.width = PAGE_DIMS.a4.w + 'in';
      pageEl.style.height = PAGE_DIMS.a4.h + 'in';
      pageEl.innerHTML = svg;
      batch.appendChild(pageEl);
    });
  });
}

// Toggles the empty-state message on/off for whichever doelgroep has no
// exercises yet (currently sniper) — hides the exercise lists/print controls
// and the preview page, rather than showing a confusing blank list.
function acTrainUpdateEmptyState(){
  const inGroup = acTrainExercisesInGroup();
  const isEmpty = inGroup.length === 0;
  const emptyMsg = document.getElementById('trainEmptyState');
  const listsWrap = document.getElementById('trainListsWrap');
  const previewEmpty = document.getElementById('trainPreviewEmpty');
  const pageShell = document.getElementById('pageShellT');
  if(emptyMsg) emptyMsg.hidden = !isEmpty;
  if(listsWrap) listsWrap.hidden = isEmpty;
  if(previewEmpty) previewEmpty.hidden = !isEmpty;
  if(pageShell) pageShell.hidden = isEmpty;
  return isEmpty;
}

function acTrainSwitchGroup(group){
  if(group === acTrainGroup) return;
  acTrainGroup = group;
  document.querySelectorAll('.train-group-btn').forEach(b=>b.classList.toggle('active', b.dataset.group === group));
  acTrainSelected.clear();
  acTrainUpdatePrintLabel();
  acTrainRenderList();
  const isEmpty = acTrainUpdateEmptyState();
  const first = acTrainExercisesInGroup()[0];
  if(!isEmpty && first) acTrainPreview(first.id);
}

function initTrain(){
  if(acTrainInited) return;
  acTrainInited = true;
  acTrainRenderList();
  acTrainUpdatePrintLabel();
  document.querySelectorAll('.train-group-btn').forEach(b=>{
    b.addEventListener('click', ()=>acTrainSwitchGroup(b.dataset.group));
  });
  const printBtn = document.getElementById('printBtnT');
  if(printBtn) printBtn.addEventListener('click', ()=>{
    acTrainBuildPrintBatch();
    if(window.AppliedConceptsPrint) window.AppliedConceptsPrint('train-oefenblad');
  });
  const selectAllBtn = document.getElementById('trainSelectAll');
  if(selectAllBtn) selectAllBtn.addEventListener('click', ()=>{
    acTrainExercisesInGroup().forEach(ex=>{
      const cb = document.querySelector(`.train-item[data-id="${ex.id}"] .train-item-check input`);
      if(cb && !cb.checked){ cb.checked = true; acTrainSetSelected(ex.id, true); }
    });
  });
  const selectNoneBtn = document.getElementById('trainSelectNone');
  if(selectNoneBtn) selectNoneBtn.addEventListener('click', ()=>{
    acTrainExercisesInGroup().forEach(ex=>{
      const cb = document.querySelector(`.train-item[data-id="${ex.id}"] .train-item-check input`);
      if(cb && cb.checked){ cb.checked = false; acTrainSetSelected(ex.id, false); }
    });
  });
  acTrainUpdateEmptyState();
  const first = acTrainExercisesInGroup()[0];
  if(first) acTrainPreview(first.id);
  window.addEventListener('resize', ()=>{
    const panel = document.getElementById('panel-train');
    if(panel && panel.classList.contains('active') && typeof fitPreview === 'function') fitPreview('pageT', 'pageShellT', 'scaleLabelT');
  });
}

window.AppliedConceptsTrain = { init: initTrain };
