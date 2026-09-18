/* ---------------------------------------------------------------------
   Applied Concepts — Zero Laser Calculator (ARCHIVED)
   Removed from the live app on 18-09-2026 (last shipped in v1.31).
   See archive/zero-laser-calculator/README.md for restore instructions
   and for the shared helpers this code depends on (still live in
   js/app.js: buildTargetSVG, offsetAxis, hobInches, applyAutoHOB,
   fitPreview, refreshWorkDistOptions, refreshClickOptions, requestPrint,
   populateSelect, fmtLen, el, PAGE_DIMS, SIGHTS, MOUNTS, CLICKS, CM_IN).
--------------------------------------------------------------------- */

const LASERS = [
  {id:'raidx', label:'Wilcox RAID X', note:'Meestal top-rail in-line vóór de hoofdoptiek — meet je eigen verticale (en evt. horizontale) offset.'},
  {id:'raidxe', label:'Wilcox RAID Xe', note:'Meestal top-rail in-line vóór de hoofdoptiek — meet je eigen verticale (en evt. horizontale) offset.'},
  {id:'peq15', label:'AN/PEQ-15 · DBAL-A3 · ATPIAL(-C)', note:'Vaak op een zijrail gemonteerd omdat er naast de hoofdoptiek geen ruimte is op de top-rail — reken op een horizontale offset.'},
  {id:'laser_manual', label:'Anders / handmatig', note:''},
];

const LASER_DIST = [10,25,50,100,200,300];

function initLaser(){
  el('sightL').innerHTML = SIGHTS.map((sVal,i)=>`<option value="${i}">${sVal.label}${sVal.hobIn?` — ${(sVal.hobIn*2.54).toFixed(1)} cm`:''}</option>`).join('');
  el('mountL').innerHTML = MOUNTS.map((m,i)=>`<option value="${i}">${m.label}${m.hobIn?` — ${(m.hobIn*2.54).toFixed(1)} cm`:''}</option>`).join('');
  el('sightL').value = 2;
  el('mountL').value = 2;
  el('hobUnitL').value = 'cm';
  applyAutoHOB('L');
  ['sightL','mountL'].forEach(id=>el(id).addEventListener('change', ()=>{applyAutoHOB('L'); renderLaser();}));

  el('laserType').innerHTML = LASERS.map((l,i)=>`<option value="${i}">${l.label}</option>`).join('');
  el('laserType').addEventListener('change', ()=>{
    el('laserHint').textContent = LASERS[el('laserType').value].note;
    renderLaser();
  });
  el('laserHint').textContent = LASERS[0].note;

  updateMountPosHint();
  el('mountPos').addEventListener('change', ()=>{ updateMountPosHint(); renderLaser(); });

  updateZeroMethodHint();
  el('zeroMethod').addEventListener('change', ()=>{ updateZeroMethodHint(); renderLaser(); });

  populateSelect(el('zeroDistL'), LASER_DIST, d=>d+' m');
  populateSelect(el('workDistL'), LASER_DIST, d=>d+' m');
  el('zeroDistL').selectedIndex = 2;
  el('workDistL').selectedIndex = 1;
  refreshWorkDistOptions(LASER_DIST,'zeroDistL','workDistL');

  ['offVert','offHoriz','hobValueL','hobUnitL','clickValL','workDistL','paperSizeL','weaponLabelL'].forEach(id=>{
    el(id).addEventListener('input', renderLaser);
    el(id).addEventListener('change', renderLaser);
  });
  el('zeroDistL').addEventListener('change', ()=>{ refreshWorkDistOptions(LASER_DIST,'zeroDistL','workDistL'); renderLaser(); });
  el('adjUnitL').addEventListener('change', ()=>{ refreshClickOptions('adjUnitL','clickValL'); renderLaser(); });
  el('printBtnL').addEventListener('click', ()=>requestPrint('zero-laser-calculator'));
  window.addEventListener('resize', ()=>{ if(el('panel-laser').classList.contains('active')) fitPreview('pageL','pageShellL','scaleLabelL'); });

  refreshClickOptions('adjUnitL','clickValL');
}

const MOUNTPOS_HINTS = {
  inline: 'Gecentreerd t.o.v. de hoofdoptiek — horizontale offset staat vast op 0.',
  hydra: 'GBRS Hydra-varianten zijn bewust op één centerline ontworpen — horizontale offset staat vast op 0, verticale offset blijft montage-afhankelijk.',
  skiff: 'De SKIFF-riser hangt de laser gecentreerd onder de Unity FAST-montage — horizontale offset staat vast op 0.',
  left: 'Horizontale offset wordt als "links" van de hoofdoptiek gerekend.',
  right: 'Horizontale offset wordt als "rechts" van de hoofdoptiek gerekend.',
  manual: 'Vrij invoerbaar — vul horizontaal een negatief getal in voor links, positief voor rechts.',
};
function updateMountPosHint(){
  el('mountPosHint').textContent = MOUNTPOS_HINTS[el('mountPos').value] || '';
  const centered = ['inline','hydra','skiff'].includes(el('mountPos').value);
  el('offHoriz').disabled = centered;
  if(centered) el('offHoriz').value = 0;
}

function updateZeroMethodHint(){
  el('zeroMethodHint').textContent = el('zeroMethod').value === 'parallel'
    ? 'De laser convergeert niet met het aimpoint — de ingevulde offset wordt op elke afstand hetzelfde getoond, ongeacht de nulpunt-afstand.'
    : 'De laser wordt op de nulpunt-afstand exact op het aimpoint van de hoofdoptiek gezet; op kortere afstanden wijkt de laser mechanisch af volgens dezelfde geometrie als een optiek-zero.';
}

function getStateLaser(){
  const unit = el('adjUnitL').value;
  const zeroDist = LASER_DIST[el('zeroDistL').value];
  let workDist = LASER_DIST[el('workDistL').value];
  if(workDist > zeroDist) workDist = zeroDist;
  const zeroMethod = el('zeroMethod').value;

  // Bullet POI marker — bore-relative, same geometry as the Optic Calculator.
  const hobIn = hobInches('L');
  const hobDisplay = el('hobUnitL').value === 'cm' ? `${parseFloat(el('hobValueL').value||0).toFixed(2)} cm` : `${parseFloat(el('hobValueL').value||0).toFixed(2)}"`;
  const bulletOff = offsetAxis(hobIn, zeroDist, workDist);
  const showBulletMarker = workDist < zeroDist && bulletOff > 0.03;

  // Laser marker — optic-relative, convergent (scales with distance) or parallel (constant).
  const vertCm = parseFloat(el('offVert').value) || 0;
  const horizCm = parseFloat(el('offHoriz').value) || 0;
  const vertIn = vertCm*CM_IN;
  const pos = el('mountPos').value;
  const centered = ['inline','hydra','skiff'].includes(pos);
  const horizSign = pos === 'left' ? -1 : (pos === 'right' ? 1 : 1);
  const horizIn = centered ? 0 : horizCm*CM_IN*horizSign;

  let laserOffY, laserOffX;
  if(zeroMethod === 'parallel'){
    laserOffY = vertIn;
    laserOffX = horizIn;
  } else {
    laserOffY = offsetAxis(vertIn, zeroDist, workDist);
    laserOffX = offsetAxis(horizIn, zeroDist, workDist);
  }
  const laserMag = Math.hypot(laserOffX, laserOffY);
  const showLaserMarker = zeroMethod === 'parallel' ? laserMag > 0.03 : (workDist < zeroDist && laserMag > 0.03);

  const laser = LASERS[el('laserType').value];
  const posLabel = {inline:'Top-rail, in-line', hydra:'GBRS Hydra (gecentreerd)', skiff:'Unity SKIFF (gecentreerd)', left:'Zijrail — links', right:'Zijrail — rechts', manual:'Anders / handmatig'}[pos];

  const detailParts = [];
  if(Math.abs(laserOffY) > 0.001) detailParts.push(`${fmtLen(Math.abs(laserOffY),'cm')} ${laserOffY>0?'onder':'boven'}`);
  if(Math.abs(laserOffX) > 0.001) detailParts.push(`${fmtLen(Math.abs(laserOffX),'cm')} ${laserOffX>0?'rechts van':'links van'}`);
  const laserDetailText = (detailParts.length ? detailParts.join(' / ') : '≈ 0') + ' aimpoint' +
    (zeroMethod === 'parallel' ? ' (evenwijdig, alle afstanden)' : ` — bevestigt nulpunt op ${zeroDist} m`);

  return {
    paper: PAGE_DIMS[el('paperSizeL').value],
    paperKey: el('paperSizeL').value,
    titleMain: 'ZERO LASER CALCULATOR',
    weaponLabel: el('weaponLabelL').value.trim(),
    metaRows: [
      [ `Richtmiddel: ${SIGHTS[el('sightL').value].label}`, `Montage: ${MOUNTS[el('mountL').value].label}` ],
      [ `HOB: ${hobDisplay}`, `Laser: ${laser.label}` ],
      [ `Laser-montage: ${posLabel}`, `Zero-methode: ${zeroMethod==='parallel'?'Evenwijdig':'Snijpunt'}` ],
      [ `Nulpunt: ${zeroDist} m · Controle: ${workDist} m`, null ],
      [ `Klik: ${CLICKS[unit][el('clickValL').value]} ${unit} · Raster: ${fmtLen(1*CM_IN,'cm')} per lijn`, null ],
    ],
    instructionLine: 'Werkwijze: richt met vizier op POA — stel de zichtbare laser af op de LASER-markering.',
    markers: [
      { offX:0, offY:bulletOff, label:'POI', show:showBulletMarker,
        detail: `Kogel — bevestigt nulpunt op ${zeroDist} m (HOB ${hobDisplay})` },
      { offX:laserOffX, offY:laserOffY, label:'LASER', show:showLaserMarker,
        detail: laserDetailText },
    ],
    zeroDist, workDist, distUnit:'m',
    gridIn: 1*CM_IN,
    adjUnit: unit,
    clickVal: CLICKS[unit][el('clickValL').value],
    distOptions: LASER_DIST,
    sameDistanceCaption: 'Directe controle op nulpunt-afstand — beide punten horen hier samen te vallen',
    footerRight: 'Applied Concepts — Zero Laser Calculator',
    bulletOff, laserMag,
  };
}

function renderLaser(){
  const s = getStateLaser();
  el('pageL').style.width = s.paper.w + 'in';
  el('pageL').style.height = s.paper.h + 'in';
  const result = buildTargetSVG(s);
  el('pageL').innerHTML = result.svg;

  el('summaryBoxL').innerHTML = `
    <div class="row"><span>Nulpunt</span><span>${s.zeroDist} m</span></div>
    <div class="row"><span>Controle-afstand</span><span>${s.workDist} m</span></div>
    <div class="row"><span>Kogel-offset (POI)</span><span>${s.bulletOff>0.03? fmtLen(s.bulletOff,'cm') : '≈ 0'}</span></div>
    <div class="row"><span>Laser-offset</span><span>${s.laserMag>0.03? fmtLen(s.laserMag,'cm') : '≈ 0'}</span></div>
  `;

  const warn = el('fitWarningL');
  if(!result.fitsOnPage && result.anyShown){
    warn.innerHTML = `<p class="warn">Eén of meer berekende offsets passen niet meer binnen ${s.paper.label} op deze indeling. Kies Letter, een grotere controleafstand, of verhoog de nulpunt-afstand.</p>`;
  } else {
    warn.innerHTML = '';
  }

  const advice = el('paperAdviceL');
  advice.textContent = s.paperKey==='a4'
    ? 'A4 is 6% smaller dan Letter. Bij een grote gecombineerde verticale + horizontale offset (bv. zijrail-montage) met een korte controleafstand kan een referentie-box krap komen — check de waarschuwing hierboven.'
    : 'Letter geeft iets meer ruimte voor grote gecombineerde offsets, bv. bij zijrail-montages.';

  fitPreview('pageL','pageShellL','scaleLabelL');
}
