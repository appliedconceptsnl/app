/* ---------------------------------------------------------------------
   Applied Concepts — Dry Fire trainer
   Flow: kies wapenprofiel -> kies oefening -> sessie instellen -> actieve
   sessie (afstand/hold/windcall-kolom naast een doel). Alle oefeningen
   worden geschoten met de Tremor 3 reticle (tekstueel, geen grafische
   reticle-overlay in v1).
--------------------------------------------------------------------- */

// IPSC/USPSA silhouette (straight-edge polygon matching the official metric
// target shape: head box -> neck -> shoulder flare -> torso -> hip flare ->
// beveled base) plus the two A-zone rectangles (head + chest).
const AC_IPSC_PATH = "M205,60 L205,112 L174,140 L290,178 L258,340 L272,398 L250,460 L250,480 L50,480 L50,460 L28,398 L42,340 L10,178 L126,140 L95,112 L95,60 Z";
const AC_IPSC_HEAD_A = { x: 112, y: 72, w: 76, h: 32 };
const AC_IPSC_TORSO_A = { x: 105, y: 195, w: 90, h: 140 };
const AC_IPSC_VIEWBOX_W = 300, AC_IPSC_VIEWBOX_H = 500;

const AC_AR_DRILLS = [
  { id:'el_prez', name:'El Presidente', targets:3,
    steps:['Draw — 2 schoten per doel (links → midden → rechts)','Reload','2 schoten per doel (links → midden → rechts)'] },
  { id:'bill_drill', name:'Bill Drill', targets:1,
    steps:['Draw — 6 schoten'] },
  { id:'1to5', name:'1 to 5', targets:3,
    steps:['1 schot links','2 schoten midden','3 schoten rechts','4 schoten midden','5 schoten links'] },
  { id:'3body2head', name:'3 Body 2 Head', targets:1,
    steps:['3 schoten lichaam','2 schoten hoofd'] },
  { id:'transition_pistol', name:'Transition to Pistol (1 on 1)', targets:1,
    steps:['1 schot geweer','Transitie naar pistool','1 schot pistool (zelfde doel)'] },
];

const AC_AR_BASIC_DRILLS = [
  { id:'low_ready', name:'Low Ready', targets:1,
    steps:['Vanuit low ready positie — 1 schot'] },
  { id:'low_ready_transition', name:'Low Ready Transition', targets:1,
    steps:['Vanuit low ready positie — 1 schot','Transitie naar pistool — 1 schot'] },
  { id:'combat_reload', name:'Combat Reload', targets:1,
    steps:['Vanuit low ready — 1 schot','Reload (fast mag)','1 schot'] },
  { id:'combat_reload_pistol', name:'Combat Reload Pistol', targets:1,
    steps:['Draw — 1 schot pistool','Reload pistool','1 schot'] },
];

const AC_TRIPOD_POSITIONS = [
  { id:'standing', name:'Standing', steps:['Bouw je tripod staand op','Geef een gericht schot'] },
  { id:'kneeling', name:'Kneeling', steps:['Bouw je tripod knielend op','Geef een gericht schot'] },
  { id:'sitting', name:'Sitting', steps:['Bouw je tripod zittend op','Geef een gericht schot'] },
];

let acDryfireUI = {
  step: 'selectExercise', profileId: null, sniperExercise: 'distances', mode: 'manual', selected: [], count: 5, interval: 10, session: null, timerId: null,
  arDrillSet: 'advanced', arSelected: [], arRepeatCount: null, arSession: null,
  tripodSelected: [], tripodRepeatCount: null, tripodSession: null,
};

// Simulated windcall for training realism: almost every target gets a random
// hold between L2.0 and R2.0 MIL; occasionally (calm-wind rep) none at all.
function acRandomWindcall(){
  if(Math.random() < 0.12) return null;
  const v = Math.round((Math.random()*4 - 2) * 10) / 10; // -2.0..+2.0, one decimal
  return v;
}
function acFmtWindcallLR(v){
  if(v == null) return '—';
  if(Math.abs(v) < 0.05) return '0.0';
  return (v < 0 ? 'L' : 'R') + Math.abs(v).toFixed(1);
}

function acDryfireStopTimer(){
  if(acDryfireUI.timerId){ clearTimeout(acDryfireUI.timerId); acDryfireUI.timerId = null; }
}

function renderDryfireTab(){
  const root = document.getElementById('dryfireRoot');
  if(!root) return;
  const profiles = window.AppliedConceptsProfiles.load();

  if(acDryfireUI.step === 'selectExercise') return acRenderDfSelectExercise(root, profiles);
  if(acDryfireUI.step === 'selectProfile') return acRenderDfSelectProfile(root, profiles);
  if(acDryfireUI.step === 'sessionSetup') return acRenderDfSessionSetup(root, profiles);
  if(acDryfireUI.step === 'active') return acRenderDfActive(root, profiles);
  if(acDryfireUI.step === 'arSelectDrills') return acRenderArSelectDrills(root);
  if(acDryfireUI.step === 'arActive') return acRenderArActive(root);
  if(acDryfireUI.step === 'tripodSelectPositions') return acRenderTripodSelectPositions(root, profiles);
  if(acDryfireUI.step === 'tripodActive') return acRenderTripodActive(root, profiles);
}

function acDfCurrentProfile(profiles){
  return profiles.find(p => p.id === acDryfireUI.profileId) || null;
}

function acRenderDfSelectExercise(root, profiles){
  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>Dry Fire</h2>
      <p class="sub">Droogoefenen zonder munitie: kies een oefening en een wapenprofiel — je krijgt een getimede sessie met hold en windcall live in beeld. Stap 1 — kies een oefening.</p>
    </div></div>

    <h3 class="dryfire-category">Sniper</h3>
    <div class="profile-list">
      <button class="profile-card profile-card-select" id="dfExDistances">
        <div class="profile-card-head"><span class="profile-card-name">Verschillende afstanden trainen</span></div>
        <div class="profile-card-meta">Hold + windcall per afstand naast een doel, met de Tremor 3 reticle. Vereist een wapenprofiel.</div>
      </button>
      <button class="profile-card profile-card-select" id="dfExTripod">
        <div class="profile-card-head"><span class="profile-card-name">Tripod Training</span></div>
        <div class="profile-card-meta">Standing, Kneeling, Sitting — statief opbouwen en een gericht schot op een willekeurige afstand. Vereist een wapenprofiel.</div>
      </button>
    </div>

    <h3 class="dryfire-category">AR</h3>
    <div class="profile-list">
      <button class="profile-card profile-card-select" id="dfExAr">
        <div class="profile-card-head"><span class="profile-card-name">AR Training</span></div>
        <div class="profile-card-meta">El Presidente, Bill Drill, 1 to 5, 3 Body 2 Head, Transition to Pistol — stel je eigen training samen.</div>
      </button>
      <button class="profile-card profile-card-select" id="dfExArBasic">
        <div class="profile-card-head"><span class="profile-card-name">AR Training Basic</span></div>
        <div class="profile-card-meta">Low Ready, Low Ready Transition, Combat Reload, Combat Reload Pistol.</div>
      </button>
    </div>
  `;
  root.querySelector('#dfExDistances').addEventListener('click', ()=>{
    if(profiles.length === 0){
      window.AppliedConceptsProfiles.openNewEditor();
      switchTab('profiles');
      return;
    }
    acDryfireUI.sniperExercise = 'distances';
    acDryfireUI.step = 'selectProfile';
    renderDryfireTab();
  });
  root.querySelector('#dfExTripod').addEventListener('click', ()=>{
    if(profiles.length === 0){
      window.AppliedConceptsProfiles.openNewEditor();
      switchTab('profiles');
      return;
    }
    acDryfireUI.sniperExercise = 'tripod';
    acDryfireUI.step = 'selectProfile';
    renderDryfireTab();
  });
  root.querySelector('#dfExAr').addEventListener('click', ()=>{
    acDryfireUI.arDrillSet = 'advanced';
    acDryfireUI.arSelected = [];
    acDryfireUI.step = 'arSelectDrills';
    renderDryfireTab();
  });
  root.querySelector('#dfExArBasic').addEventListener('click', ()=>{
    acDryfireUI.arDrillSet = 'basic';
    acDryfireUI.arSelected = [];
    acDryfireUI.step = 'arSelectDrills';
    renderDryfireTab();
  });
}

function acRenderDfSelectProfile(root, profiles){
  const isTripod = acDryfireUI.sniperExercise === 'tripod';
  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>Dry Fire — ${isTripod ? 'Tripod Training' : 'Verschillende afstanden'}</h2>
      <p class="sub">Stap 2 — kies het wapenprofiel waarmee je gaat trainen.</p>
    </div></div>
    <div class="profile-list" id="dfProfileGrid"></div>
    <button class="profile-cancelbtn dryfire-backbtn" id="dfBackToExercise0">&larr; Andere oefening</button>
  `;
  const grid = root.querySelector('#dfProfileGrid');
  grid.innerHTML = profiles.map(p => `
    <button class="profile-card profile-card-select" data-id="${p.id}">
      <div class="profile-card-head">
        <span class="profile-card-name">${acEscapeHtml(p.label || 'Naamloos profiel')}</span>
        <span class="profile-card-caliber">${acEscapeHtml(p.caliber||'')}</span>
      </div>
      <div class="profile-card-meta">
        ${p.bulletWeightGr ? p.bulletWeightGr+' gr · ' : ''}${p.dragModel||''} BC ${p.bc||'?'} · zero ${p.zeroDistanceM||'?'} m
      </div>
    </button>
  `).join('');
  grid.querySelectorAll('.profile-card-select').forEach(b=>b.addEventListener('click', ()=>{
    acDryfireUI.profileId = b.dataset.id;
    acDryfireUI.step = isTripod ? 'tripodSelectPositions' : 'sessionSetup';
    renderDryfireTab();
  }));
  root.querySelector('#dfBackToExercise0').addEventListener('click', ()=>{
    acDryfireUI.step = 'selectExercise';
    renderDryfireTab();
  });
}

function acRenderDfSessionSetup(root, profiles){
  const profile = acDfCurrentProfile(profiles);
  const holdTable = window.AppliedConceptsProfiles.holdTableFor(profile);
  const available = window.AppliedConceptsProfiles.DOPE_DISTANCES_M.filter(d => holdTable && holdTable.get(d) != null);
  const bcError = window.AppliedConceptsProfiles.bcSanityError(parseFloat(profile.bc), parseFloat(profile.customDragFactor) || 1);

  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>Dry Fire — Verschillende afstanden</h2>
      <p class="sub">Stap 3 — stel de sessie in voor <strong>${acEscapeHtml(profile.label||'dit profiel')}</strong>.</p>
    </div></div>
    ${available.length === 0 ? `
      <p class="warn">${bcError ? acEscapeHtml(bcError) : 'Dit profiel heeft nog geen berekende hold-waarden (vul kaliber, BC, V0 en zero-afstand in bij het wapenprofiel).'}</p>
      <button class="printbtn" id="dfEditProfileBtn">Wapenprofiel aanvullen</button>
    ` : `
      <fieldset class="dryfire-mode-fieldset">
        <legend>Afstanden</legend>
        <div class="dryfire-mode-toggle">
          <label><input type="radio" name="dfMode" value="manual" ${acDryfireUI.mode==='manual'?'checked':''}> Handmatig instellen</label>
          <label><input type="radio" name="dfMode" value="random" ${acDryfireUI.mode==='random'?'checked':''}> Willekeurig</label>
        </div>
        <div id="dfModeBody"></div>
      </fieldset>
      <fieldset class="dryfire-mode-fieldset">
        <legend>Interval per doel</legend>
        <div class="dryfire-mode-toggle dryfire-interval-toggle">
          ${[5,10,15,20,25].map(s=>`
            <label><input type="radio" name="dfInterval" value="${s}" ${acDryfireUI.interval===s?'checked':''}> ${s}s</label>
          `).join('')}
        </div>
        <p class="hint">Elk doel blijft dit aantal seconden in beeld voordat automatisch het volgende verschijnt.</p>
      </fieldset>
      <button class="printbtn" id="dfStartBtn">Start oefening</button>
    `}
    <button class="profile-cancelbtn dryfire-backbtn" id="dfBackToExercise">&larr; Ander wapenprofiel</button>
  `;

  if(available.length === 0){
    root.querySelector('#dfEditProfileBtn').addEventListener('click', ()=>{
      window.AppliedConceptsProfiles.load(); // no-op, kept for symmetry
      acProfilesUI = { mode:'edit', editingId: profile.id, draft: JSON.parse(JSON.stringify(profile)) };
      switchTab('profiles');
    });
  } else {
    const modeBody = root.querySelector('#dfModeBody');
    function renderModeBody(){
      if(acDryfireUI.mode === 'manual'){
        if(acDryfireUI.selected.length === 0) acDryfireUI.selected = [...available];
        modeBody.innerHTML = `<div class="dryfire-distance-checks">${available.map(d=>`
          <label class="dryfire-check"><input type="checkbox" value="${d}" ${acDryfireUI.selected.includes(d)?'checked':''}> ${d} m</label>
        `).join('')}</div>`;
        modeBody.querySelectorAll('input[type=checkbox]').forEach(cb=>cb.addEventListener('change', ()=>{
          const d = parseInt(cb.value,10);
          if(cb.checked) acDryfireUI.selected.push(d);
          else acDryfireUI.selected = acDryfireUI.selected.filter(x=>x!==d);
        }));
      } else {
        if(!acDryfireUI.count) acDryfireUI.count = 5;
        modeBody.innerHTML = `
          <label for="dfCount">Aantal afstanden</label>
          <input type="number" id="dfCount" min="1" max="20" value="${acDryfireUI.count}">
          <p class="hint">Elke afstand wordt willekeurig gekozen tussen 100&ndash;1000 m &mdash; ook tussenafstanden (bv. 545 m, 622 m), niet alleen ronde honderdtallen. Hold wordt exact voor die afstand berekend; windcall wordt geïnterpoleerd tussen de dichtstbijzijnde ingevulde stations.</p>
        `;
        modeBody.querySelector('#dfCount').addEventListener('input', (e)=>{
          let v = parseInt(e.target.value,10) || 1;
          v = Math.max(1, Math.min(20, v));
          acDryfireUI.count = v;
        });
      }
    }
    renderModeBody();
    root.querySelectorAll('input[name=dfMode]').forEach(r=>r.addEventListener('change', (e)=>{
      acDryfireUI.mode = e.target.value;
      renderModeBody();
    }));
    root.querySelectorAll('input[name=dfInterval]').forEach(r=>r.addEventListener('change', (e)=>{
      acDryfireUI.interval = parseInt(e.target.value,10);
    }));

    root.querySelector('#dfStartBtn').addEventListener('click', (e)=>{
      let items;
      if(acDryfireUI.mode === 'manual'){
        const distances = [...acDryfireUI.selected].sort((a,b)=>a-b);
        if(distances.length === 0){ alert('Kies minstens één afstand.'); return; }
        items = distances.map(d => ({
          distance: d,
          hold: holdTable.get(d),
          windcall: acRandomWindcall(),
        }));
      } else {
        items = [];
        for(let i=0;i<acDryfireUI.count;i++){
          const d = Math.round(100 + Math.random()*900);
          items.push({
            distance: d,
            hold: window.AppliedConceptsProfiles.holdAtDistance(profile, d),
            windcall: acRandomWindcall(),
          });
        }
      }
      acDryfireUI.session = { items, index: 0, completed: false };
      acDryfireUI.step = 'active';
      // Request fullscreen from within this click (user-gesture) so the target
      // is as large/readable as possible — falls back silently if refused.
      const root2 = document.getElementById('dryfireRoot');
      if(root2 && root2.requestFullscreen) root2.requestFullscreen().catch(()=>{});
      renderDryfireTab();
    });
  }

  root.querySelector('#dfBackToExercise').addEventListener('click', ()=>{
    acDryfireUI.step = 'selectProfile';
    renderDryfireTab();
  });
}

function acDfExitActive(root, nextStep){
  acDryfireStopTimer();
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  if(nextStep === 'reset'){
    acDryfireUI = { step:'selectProfile', profileId:null, sniperExercise:acDryfireUI.sniperExercise, mode:'manual', selected:[], count:5, interval:acDryfireUI.interval, session:null, timerId:null, arDrillSet:'advanced', arSelected:[], arRepeatCount:null, arSession:null, tripodSelected:[], tripodRepeatCount:null, tripodSession:null };
  } else {
    acDryfireUI.step = nextStep;
    acDryfireUI.session = null;
  }
  renderDryfireTab();
}

function acRenderDfActive(root, profiles){
  const profile = acDfCurrentProfile(profiles);
  const session = acDryfireUI.session;

  if(session.completed){
    root.innerHTML = `
      <div class="simplepanel-head"><div><h2>Dry Fire — sessie voltooid</h2>
        <p class="sub">${acEscapeHtml(profile.label||'')} · ${session.items.length} doelen op ${acDryfireUI.interval}s interval.</p>
      </div></div>
      <div class="dryfire-session-actions">
        <button class="printbtn" id="dfNewSessionBtn">Nieuwe sessie</button>
        <button class="profile-cancelbtn" id="dfChangeExerciseBtn">Andere oefening</button>
        <button class="profile-cancelbtn" id="dfChangeProfileBtn">Ander wapenprofiel</button>
      </div>
    `;
    root.querySelector('#dfNewSessionBtn').addEventListener('click', ()=>acDfExitActive(root,'sessionSetup'));
    root.querySelector('#dfChangeExerciseBtn').addEventListener('click', ()=>acDfExitActive(root,'selectExercise'));
    root.querySelector('#dfChangeProfileBtn').addEventListener('click', ()=>acDfExitActive(root,'reset'));
    return;
  }

  const item = session.items[session.index];
  const d = item.distance;
  const wc = acFmtWindcallLR(item.windcall);
  // Apparent size shrinks with distance (angular size ∝ 1/distance), anchored
  // so the closest possible station (100 m) renders at full size; floored so
  // far targets stay identifiable rather than vanishing.
  const scale = Math.min(1, Math.max(0.22, 100 / d));

  root.innerHTML = `
    <div class="dryfire-stage" id="dfStage">
      <div class="dryfire-stage-progress"><div class="dryfire-stage-progress-bar" id="dfProgressBar"></div></div>
      <button class="dryfire-stage-stop" id="dfStopBtn">&times; Stop</button>
      <div class="dryfire-stage-body">
        <div class="dryfire-stage-info">
          <div class="dryfire-stage-info-accent"></div>
          <div class="dryfire-stage-info-inner">
            <span class="dryfire-stage-label">Afstand</span>
            <span class="dryfire-stage-distance">${d} m</span>
            <span class="dryfire-stage-row"><span>Hold</span><strong>${acFmtMil(item.hold)}</strong><em>MIL</em></span>
            <span class="dryfire-stage-row"><span>Windcall</span><strong>${wc}</strong><em>${wc!=='—'?'MIL':''}</em></span>
            <span class="dryfire-stage-reticle">Tremor 3 reticle</span>
          </div>
        </div>
        <div class="dryfire-stage-target">
          <div class="dryfire-ipsc-wrap" style="transform:scale(${scale.toFixed(3)})">
            <svg viewBox="0 0 ${AC_IPSC_VIEWBOX_W} ${AC_IPSC_VIEWBOX_H}" class="dryfire-ipsc">
              <path d="${AC_IPSC_PATH}"/>
              <rect x="${AC_IPSC_HEAD_A.x}" y="${AC_IPSC_HEAD_A.y}" width="${AC_IPSC_HEAD_A.w}" height="${AC_IPSC_HEAD_A.h}" class="dryfire-ipsc-azone"/>
              <rect x="${AC_IPSC_TORSO_A.x}" y="${AC_IPSC_TORSO_A.y}" width="${AC_IPSC_TORSO_A.w}" height="${AC_IPSC_TORSO_A.h}" class="dryfire-ipsc-azone"/>
            </svg>
          </div>
        </div>
      </div>
    </div>
  `;

  root.querySelector('#dfStopBtn').addEventListener('click', ()=>acDfExitActive(root,'sessionSetup'));

  const bar = root.querySelector('#dfProgressBar');
  bar.style.transition = 'none';
  bar.style.width = '100%';
  void bar.offsetWidth;
  requestAnimationFrame(()=>{
    bar.style.transition = `width ${acDryfireUI.interval}s linear`;
    bar.style.width = '0%';
  });

  acDryfireStopTimer();
  acDryfireUI.timerId = setTimeout(()=>{
    if(session.index + 1 >= session.items.length){
      session.completed = true;
    } else {
      session.index += 1;
    }
    renderDryfireTab();
  }, acDryfireUI.interval*1000);
}

/* ---------------------------------------------------------------------
   AR Training — build-your-own session from named practical drills.
   Each drill: prep (name + shot plan) -> READY -> STANDBY -> target reveal
   with a running stopwatch the shooter stops themselves.
--------------------------------------------------------------------- */

function acArClearTimers(){
  const s = acDryfireUI.arSession;
  if(!s) return;
  if(s.phaseTimerId){ clearTimeout(s.phaseTimerId); s.phaseTimerId = null; }
  if(s.stopwatchId){ clearInterval(s.stopwatchId); s.stopwatchId = null; }
}

function acArDrillSet(){
  return acDryfireUI.arDrillSet === 'basic' ? AC_AR_BASIC_DRILLS : AC_AR_DRILLS;
}

function acRenderArSelectDrills(root){
  const isBasic = acDryfireUI.arDrillSet === 'basic';
  const drillSet = acArDrillSet();
  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>AR Training${isBasic ? ' Basic' : ''}</h2>
      <p class="sub">Stap 2 — vink de oefeningen aan die je wilt trainen.</p>
    </div></div>
    <label class="dryfire-check ar-selectall"><input type="checkbox" id="arSelectAll"> Selecteer alles</label>
    <div class="profile-list" id="arDrillGrid"></div>
    <fieldset class="dryfire-mode-fieldset">
      <legend>Aantal herhalingen</legend>
      <input type="number" id="arRepeatCount" min="1" max="50" value="${acDryfireUI.arRepeatCount || drillSet.length}">
      <p class="hint">Bij meer dan het aantal aangevinkte oefeningen worden ze willekeurig herhaald (dezelfde oefening kan dus meerdere keren terugkomen).</p>
    </fieldset>
    <button class="printbtn" id="arStartBtn">Start training</button>
    <button class="profile-cancelbtn dryfire-backbtn" id="arBackToExercise">&larr; Andere oefening</button>
  `;
  const grid = root.querySelector('#arDrillGrid');
  grid.innerHTML = drillSet.map(d => `
    <label class="profile-card ar-drill-card">
      <div class="profile-card-head">
        <span class="profile-card-name"><input type="checkbox" value="${d.id}" ${acDryfireUI.arSelected.includes(d.id)?'checked':''}> ${acEscapeHtml(d.name)}</span>
        <span class="profile-card-caliber">${d.targets} doel${d.targets>1?'en':''}</span>
      </div>
      <div class="profile-card-meta">${d.steps.map(acEscapeHtml).join(' · ')}</div>
    </label>
  `).join('');
  const checkboxes = grid.querySelectorAll('input[type=checkbox]');
  const selectAllCb = root.querySelector('#arSelectAll');
  function syncSelectAll(){ selectAllCb.checked = acDryfireUI.arSelected.length === drillSet.length; }
  syncSelectAll();
  checkboxes.forEach(cb=>cb.addEventListener('change', ()=>{
    const id = cb.value;
    if(cb.checked){ if(!acDryfireUI.arSelected.includes(id)) acDryfireUI.arSelected.push(id); }
    else acDryfireUI.arSelected = acDryfireUI.arSelected.filter(x=>x!==id);
    syncSelectAll();
  }));
  selectAllCb.addEventListener('change', ()=>{
    acDryfireUI.arSelected = selectAllCb.checked ? drillSet.map(d=>d.id) : [];
    checkboxes.forEach(cb=>{ cb.checked = selectAllCb.checked; });
  });
  root.querySelector('#arRepeatCount').addEventListener('input', (e)=>{
    let v = parseInt(e.target.value,10) || 1;
    acDryfireUI.arRepeatCount = Math.max(1, Math.min(50, v));
  });
  root.querySelector('#arStartBtn').addEventListener('click', ()=>{
    const chosen = drillSet.filter(d => acDryfireUI.arSelected.includes(d.id));
    if(chosen.length === 0){ alert('Kies minstens één oefening.'); return; }
    const repeatCount = acDryfireUI.arRepeatCount || chosen.length;
    const drills = Array.from({length:repeatCount}).map(()=>chosen[Math.floor(Math.random()*chosen.length)]);
    acDryfireUI.arSession = { drills, index:0, phase:'prep', results:[], stopwatchStartTs:null, stopwatchMs:0, phaseTimerId:null, stopwatchId:null };
    acDryfireUI.step = 'arActive';
    const root2 = document.getElementById('dryfireRoot');
    if(root2 && root2.requestFullscreen) root2.requestFullscreen().catch(()=>{});
    renderDryfireTab();
  });
  root.querySelector('#arBackToExercise').addEventListener('click', ()=>{
    acDryfireUI.step = 'selectExercise';
    renderDryfireTab();
  });
}

function acArExit(nextStep){
  acArClearTimers();
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  if(nextStep === 'reset'){
    acDryfireUI = { step:'selectExercise', profileId:null, sniperExercise:'distances', mode:'manual', selected:[], count:5, interval:10, session:null, timerId:null, arDrillSet:'advanced', arSelected:[], arRepeatCount:null, arSession:null, tripodSelected:[], tripodRepeatCount:null, tripodSession:null };
  } else {
    acDryfireUI.step = nextStep;
    acDryfireUI.arSession = null;
  }
  renderDryfireTab();
}

function acArTargetsMarkup(count){
  const svg = `<svg viewBox="0 0 ${AC_IPSC_VIEWBOX_W} ${AC_IPSC_VIEWBOX_H}" class="dryfire-ipsc">
    <path d="${AC_IPSC_PATH}"/>
    <rect x="${AC_IPSC_HEAD_A.x}" y="${AC_IPSC_HEAD_A.y}" width="${AC_IPSC_HEAD_A.w}" height="${AC_IPSC_HEAD_A.h}" class="dryfire-ipsc-azone"/>
    <rect x="${AC_IPSC_TORSO_A.x}" y="${AC_IPSC_TORSO_A.y}" width="${AC_IPSC_TORSO_A.w}" height="${AC_IPSC_TORSO_A.h}" class="dryfire-ipsc-azone"/>
  </svg>`;
  return `<div class="ar-target-row ar-target-row-${count}">${Array.from({length:count}).map(()=>`<div class="ar-target-wrap">${svg}</div>`).join('')}</div>`;
}

function acFmtStopwatch(ms){
  const totalCs = Math.floor(ms/10);
  const s = Math.floor(totalCs/100);
  const cs = totalCs%100;
  return `${s}.${cs.toString().padStart(2,'0')}`;
}

function acRenderArActive(root){
  const s = acDryfireUI.arSession;
  acArClearTimers();

  if(s.phase === 'done'){
    root.innerHTML = `
      <div class="simplepanel-head"><div><h2>AR Training — sessie voltooid</h2>
        <p class="sub">${s.results.length} oefening${s.results.length>1?'en':''} afgerond.</p>
      </div></div>
      <table class="dope-table">
        <thead><tr><th>Oefening</th><th>Tijd</th></tr></thead>
        <tbody>${s.results.map(r=>`<tr><td>${acEscapeHtml(r.name)}</td><td class="dope-hold">${acFmtStopwatch(r.ms)}s</td></tr>`).join('')}</tbody>
      </table>
      <div class="dryfire-session-actions">
        <button class="printbtn" id="arNewSessionBtn">Nieuwe training</button>
        <button class="profile-cancelbtn" id="arChangeExerciseBtn">Andere oefening</button>
      </div>
    `;
    root.querySelector('#arNewSessionBtn').addEventListener('click', ()=>acArExit('arSelectDrills'));
    root.querySelector('#arChangeExerciseBtn').addEventListener('click', ()=>acArExit('selectExercise'));
    return;
  }

  const drill = s.drills[s.index];
  const progress = `Oefening ${s.index+1} van ${s.drills.length}`;

  if(s.phase === 'prep'){
    root.innerHTML = `
      <div class="dryfire-stage ar-prep-stage">
        <span class="dryfire-progress-badge">${progress}</span>
        <button class="dryfire-stage-stop" id="arStopBtn">&times; Stop</button>
        <div class="ar-prep-inner">
          <h2 class="ar-prep-name">${acEscapeHtml(drill.name)}</h2>
          <ol class="ar-prep-steps">${drill.steps.map(st=>`<li>${acEscapeHtml(st)}</li>`).join('')}</ol>
          <button class="printbtn" id="arGoBtn">Klaar — start</button>
        </div>
      </div>
    `;
    root.querySelector('#arGoBtn').addEventListener('click', ()=>{
      s.phase = 'ready';
      renderDryfireTab();
    });
    root.querySelector('#arStopBtn').addEventListener('click', ()=>acArExit('arSelectDrills'));
    return;
  }

  if(s.phase === 'ready' || s.phase === 'standby'){
    root.innerHTML = `
      <div class="dryfire-stage ar-countdown-stage">
        <span class="dryfire-progress-badge">${progress}</span>
        <button class="dryfire-stage-stop" id="arStopBtn">&times; Stop</button>
        <span class="ar-countdown-text ar-countdown-${s.phase}">${s.phase === 'ready' ? 'READY' : 'STANDBY'}</span>
      </div>
    `;
    root.querySelector('#arStopBtn').addEventListener('click', ()=>acArExit('arSelectDrills'));
    // STANDBY is deliberately 1s longer than READY (2s total) to give a clearer beat before the reveal.
    s.phaseTimerId = setTimeout(()=>{
      s.phase = s.phase === 'ready' ? 'standby' : 'target';
      if(s.phase === 'target') s.stopwatchStartTs = Date.now();
      renderDryfireTab();
    }, s.phase === 'ready' ? 1500 : 2000);
    return;
  }

  // phase === 'target'
  root.innerHTML = `
    <div class="dryfire-stage ar-target-stage">
      <span class="dryfire-progress-badge">${progress}</span>
      <button class="dryfire-stage-stop" id="arStopBtn">&times; Stop</button>
      <div class="ar-stopwatch" id="arStopwatch">0.00</div>
      <div class="ar-target-area">${acArTargetsMarkup(drill.targets)}</div>
      <button class="printbtn ar-done-btn" id="arDoneBtn">Klaar</button>
    </div>
  `;
  const watchEl = root.querySelector('#arStopwatch');
  s.stopwatchId = setInterval(()=>{
    watchEl.textContent = acFmtStopwatch(Date.now() - s.stopwatchStartTs);
  }, 30);

  function finishDrill(){
    acArClearTimers();
    s.results.push({ name: drill.name, ms: Date.now() - s.stopwatchStartTs });
    if(s.index + 1 >= s.drills.length){
      s.phase = 'done';
    } else {
      s.index += 1;
      s.phase = 'prep';
    }
    renderDryfireTab();
  }
  root.querySelector('#arDoneBtn').addEventListener('click', finishDrill);
  root.querySelector('#arStopBtn').addEventListener('click', ()=>acArExit('arSelectDrills'));
}

/* ---------------------------------------------------------------------
   Tripod Training — sniper positional drill. Build the tripod in the
   given position, then a random-distance target (same visual as
   "Verschillende afstanden") reveals hold/windcall for one deliberate shot.
--------------------------------------------------------------------- */

function acTripodClearTimers(){
  const s = acDryfireUI.tripodSession;
  if(!s) return;
  if(s.phaseTimerId){ clearTimeout(s.phaseTimerId); s.phaseTimerId = null; }
}

function acRenderTripodSelectPositions(root, profiles){
  const profile = acDfCurrentProfile(profiles);
  root.innerHTML = `
    <div class="simplepanel-head"><div><h2>Tripod Training</h2>
      <p class="sub">Stap 3 — vink de posities aan die je wilt trainen voor <strong>${acEscapeHtml(profile.label||'dit profiel')}</strong>.</p>
    </div></div>
    <label class="dryfire-check ar-selectall"><input type="checkbox" id="tripodSelectAll"> Selecteer alles</label>
    <div class="profile-list" id="tripodGrid"></div>
    <fieldset class="dryfire-mode-fieldset">
      <legend>Aantal herhalingen</legend>
      <input type="number" id="tripodRepeatCount" min="1" max="50" value="${acDryfireUI.tripodRepeatCount || AC_TRIPOD_POSITIONS.length}">
      <p class="hint">Bij meer dan het aantal aangevinkte posities worden ze willekeurig herhaald.</p>
    </fieldset>
    <button class="printbtn" id="tripodStartBtn">Start training</button>
    <button class="profile-cancelbtn dryfire-backbtn" id="tripodBack">&larr; Ander wapenprofiel</button>
  `;
  const grid = root.querySelector('#tripodGrid');
  grid.innerHTML = AC_TRIPOD_POSITIONS.map(p => `
    <label class="profile-card ar-drill-card">
      <div class="profile-card-head">
        <span class="profile-card-name"><input type="checkbox" value="${p.id}" ${acDryfireUI.tripodSelected.includes(p.id)?'checked':''}> ${acEscapeHtml(p.name)}</span>
      </div>
      <div class="profile-card-meta">${p.steps.map(acEscapeHtml).join(' · ')}</div>
    </label>
  `).join('');
  const checkboxes = grid.querySelectorAll('input[type=checkbox]');
  const selectAllCb = root.querySelector('#tripodSelectAll');
  function syncSelectAll(){ selectAllCb.checked = acDryfireUI.tripodSelected.length === AC_TRIPOD_POSITIONS.length; }
  syncSelectAll();
  checkboxes.forEach(cb=>cb.addEventListener('change', ()=>{
    const id = cb.value;
    if(cb.checked){ if(!acDryfireUI.tripodSelected.includes(id)) acDryfireUI.tripodSelected.push(id); }
    else acDryfireUI.tripodSelected = acDryfireUI.tripodSelected.filter(x=>x!==id);
    syncSelectAll();
  }));
  selectAllCb.addEventListener('change', ()=>{
    acDryfireUI.tripodSelected = selectAllCb.checked ? AC_TRIPOD_POSITIONS.map(p=>p.id) : [];
    checkboxes.forEach(cb=>{ cb.checked = selectAllCb.checked; });
  });
  root.querySelector('#tripodRepeatCount').addEventListener('input', (e)=>{
    let v = parseInt(e.target.value,10) || 1;
    acDryfireUI.tripodRepeatCount = Math.max(1, Math.min(50, v));
  });
  root.querySelector('#tripodStartBtn').addEventListener('click', ()=>{
    const chosen = AC_TRIPOD_POSITIONS.filter(p => acDryfireUI.tripodSelected.includes(p.id));
    if(chosen.length === 0){ alert('Kies minstens één positie.'); return; }
    const repeatCount = acDryfireUI.tripodRepeatCount || chosen.length;
    const positions = Array.from({length:repeatCount}).map(()=>chosen[Math.floor(Math.random()*chosen.length)]);
    acDryfireUI.tripodSession = { positions, index:0, phase:'prep', phaseTimerId:null, distance:null, hold:null, windcall:null };
    acDryfireUI.step = 'tripodActive';
    const root2 = document.getElementById('dryfireRoot');
    if(root2 && root2.requestFullscreen) root2.requestFullscreen().catch(()=>{});
    renderDryfireTab();
  });
  root.querySelector('#tripodBack').addEventListener('click', ()=>{
    acDryfireUI.step = 'selectProfile';
    renderDryfireTab();
  });
}

function acTripodExit(nextStep){
  acTripodClearTimers();
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  acDryfireUI.step = nextStep;
  acDryfireUI.tripodSession = null;
  renderDryfireTab();
}

function acRenderTripodActive(root, profiles){
  const profile = acDfCurrentProfile(profiles);
  const s = acDryfireUI.tripodSession;
  acTripodClearTimers();

  if(s.phase === 'done'){
    root.innerHTML = `
      <div class="simplepanel-head"><div><h2>Tripod Training — sessie voltooid</h2>
        <p class="sub">${acEscapeHtml(profile.label||'')} · ${s.positions.length} positie${s.positions.length>1?'s':''} afgerond.</p>
      </div></div>
      <div class="dryfire-session-actions">
        <button class="printbtn" id="tripodNewSessionBtn">Nieuwe training</button>
        <button class="profile-cancelbtn" id="tripodChangeExerciseBtn">Andere oefening</button>
      </div>
    `;
    root.querySelector('#tripodNewSessionBtn').addEventListener('click', ()=>acTripodExit('tripodSelectPositions'));
    root.querySelector('#tripodChangeExerciseBtn').addEventListener('click', ()=>acTripodExit('selectExercise'));
    return;
  }

  const pos = s.positions[s.index];
  const progress = `Positie ${s.index+1} van ${s.positions.length}`;

  if(s.phase === 'prep'){
    root.innerHTML = `
      <div class="dryfire-stage ar-prep-stage">
        <span class="dryfire-progress-badge">${progress}</span>
        <button class="dryfire-stage-stop" id="tripodStopBtn">&times; Stop</button>
        <div class="ar-prep-inner">
          <h2 class="ar-prep-name">${acEscapeHtml(pos.name)}</h2>
          <ol class="ar-prep-steps">${pos.steps.map(st=>`<li>${acEscapeHtml(st)}</li>`).join('')}</ol>
          <button class="printbtn" id="tripodGoBtn">Klaar — start</button>
        </div>
      </div>
    `;
    root.querySelector('#tripodGoBtn').addEventListener('click', ()=>{ s.phase = 'ready'; renderDryfireTab(); });
    root.querySelector('#tripodStopBtn').addEventListener('click', ()=>acTripodExit('tripodSelectPositions'));
    return;
  }

  if(s.phase === 'ready' || s.phase === 'standby'){
    root.innerHTML = `
      <div class="dryfire-stage ar-countdown-stage">
        <span class="dryfire-progress-badge">${progress}</span>
        <button class="dryfire-stage-stop" id="tripodStopBtn">&times; Stop</button>
        <span class="ar-countdown-text ar-countdown-${s.phase}">${s.phase === 'ready' ? 'READY' : 'STANDBY'}</span>
      </div>
    `;
    root.querySelector('#tripodStopBtn').addEventListener('click', ()=>acTripodExit('tripodSelectPositions'));
    s.phaseTimerId = setTimeout(()=>{
      if(s.phase === 'ready'){
        s.phase = 'standby';
      } else {
        s.phase = 'target';
        s.distance = Math.round(100 + Math.random()*900);
        s.hold = window.AppliedConceptsProfiles.holdAtDistance(profile, s.distance);
        s.windcall = acRandomWindcall();
      }
      renderDryfireTab();
    }, s.phase === 'ready' ? 1500 : 2000);
    return;
  }

  // phase === 'target'
  const wc = acFmtWindcallLR(s.windcall);
  const scale = Math.min(1, Math.max(0.22, 100 / s.distance));
  root.innerHTML = `
    <div class="dryfire-stage">
      <span class="dryfire-progress-badge">${progress}</span>
      <button class="dryfire-stage-stop" id="tripodStopBtn">&times; Stop</button>
      <div class="dryfire-stage-body">
        <div class="dryfire-stage-info">
          <div class="dryfire-stage-info-accent"></div>
          <div class="dryfire-stage-info-inner">
            <span class="dryfire-stage-label">Afstand</span>
            <span class="dryfire-stage-distance">${s.distance} m</span>
            <span class="dryfire-stage-row"><span>Hold</span><strong>${acFmtMil(s.hold)}</strong><em>MIL</em></span>
            <span class="dryfire-stage-row"><span>Windcall</span><strong>${wc}</strong><em>${wc!=='—'?'MIL':''}</em></span>
            <span class="dryfire-stage-reticle">Tremor 3 reticle</span>
          </div>
        </div>
        <div class="dryfire-stage-target">
          <div class="dryfire-ipsc-wrap" style="transform:scale(${scale.toFixed(3)})">
            <svg viewBox="0 0 ${AC_IPSC_VIEWBOX_W} ${AC_IPSC_VIEWBOX_H}" class="dryfire-ipsc">
              <path d="${AC_IPSC_PATH}"/>
              <rect x="${AC_IPSC_HEAD_A.x}" y="${AC_IPSC_HEAD_A.y}" width="${AC_IPSC_HEAD_A.w}" height="${AC_IPSC_HEAD_A.h}" class="dryfire-ipsc-azone"/>
              <rect x="${AC_IPSC_TORSO_A.x}" y="${AC_IPSC_TORSO_A.y}" width="${AC_IPSC_TORSO_A.w}" height="${AC_IPSC_TORSO_A.h}" class="dryfire-ipsc-azone"/>
            </svg>
          </div>
        </div>
      </div>
      <button class="printbtn ar-done-btn" id="tripodDoneBtn">Klaar</button>
    </div>
  `;
  root.querySelector('#tripodStopBtn').addEventListener('click', ()=>acTripodExit('tripodSelectPositions'));
  root.querySelector('#tripodDoneBtn').addEventListener('click', ()=>{
    if(s.index + 1 >= s.positions.length){ s.phase = 'done'; }
    else { s.index += 1; s.phase = 'prep'; }
    renderDryfireTab();
  });
}

window.AppliedConceptsDryfire = {
  render: renderDryfireTab,
  stopTimer: ()=>{ acDryfireStopTimer(); acArClearTimers(); acTripodClearTimers(); },
};
