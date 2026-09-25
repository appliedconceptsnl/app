'use strict';

const fs = require('fs');
const path = require('path');
const { TABS, VIEWPORTS, PAGE_DIMS_IN, HOB_REALISTIC_RANGE_IN, ARTIFACTS_DIR } = require('./constants');
const { watchPage, isFiniteNumber } = require('./utils');

const PAGE_FIT_EPSILON_IN = 0.05; // ~1.3mm slack for sub-pixel text-metric overshoot

// --- B1: every tab loads without console/page/network errors -------------
async function checkAllTabsNoErrors(page, report) {
  const watcher = watchPage(page);
  const problems = [];
  for (const tab of TABS) {
    watcher.reset();
    await page.evaluate((t) => switchTab(t), tab);
    await page.waitForTimeout(250);
    const { consoleErrors, pageErrors, failedRequests } = watcher.snapshot();
    if (consoleErrors.length || pageErrors.length || failedRequests.length) {
      problems.push({ tab, consoleErrors, pageErrors, failedRequests });
    }
  }
  if (problems.length === 0) {
    report.ok('app.tabs-no-errors', `Alle ${TABS.length} tabbladen (${TABS.join(', ')}) laden zonder console- of netwerkfouten.`);
  } else {
    const details = problems.map(p => `[${p.tab}] ${[...p.consoleErrors, ...p.pageErrors, ...p.failedRequests.map(f => `${f.url} (${f.error})`)].join('; ')}`).join(' || ');
    report.fail('app.tabs-no-errors', 'hoog', details);
  }
}

// --- B2: HOB data integrity (SIGHTS / MOUNTS / OPTIC_PLATFORM_AMMO) -------
async function checkDataIntegrity(page, report) {
  const data = await page.evaluate(() => ({
    SIGHTS, MOUNTS,
    OPTIC_PLATFORMS: Object.keys(OPTIC_PLATFORMS),
    OPTIC_PLATFORM_AMMO,
  }));

  const [minIn, maxIn] = HOB_REALISTIC_RANGE_IN;
  const issues = [];
  const numericNoSource = [];

  for (const [arrName, arr] of [['SIGHTS', data.SIGHTS], ['MOUNTS', data.MOUNTS]]) {
    const seenIds = new Set();
    const seenLabels = new Set();
    for (const entry of arr) {
      if (!entry.id) issues.push(`${arrName}: item zonder id (label="${entry.label}")`);
      else if (seenIds.has(entry.id)) issues.push(`${arrName}: dubbele id "${entry.id}"`);
      else seenIds.add(entry.id);

      if (!entry.label || !entry.label.trim()) issues.push(`${arrName}[${entry.id}]: lege label`);
      else if (seenLabels.has(entry.label)) issues.push(`${arrName}: dubbele label "${entry.label}"`);
      else seenLabels.add(entry.label);

      if (entry.hobIn !== null) {
        if (!isFiniteNumber(entry.hobIn)) {
          issues.push(`${arrName}[${entry.id}]: hobIn is geen geldig getal (${JSON.stringify(entry.hobIn)})`);
        } else if (entry.hobIn < minIn || entry.hobIn > maxIn) {
          issues.push(`${arrName}[${entry.id}]: hobIn ${entry.hobIn.toFixed(2)}" valt buiten het realistische bereik (${minIn}"–${maxIn}")`);
        }
        if (isFiniteNumber(entry.hobIn) && (!entry.src || !entry.src.trim())) {
          numericNoSource.push(`${arrName}[${entry.id}]`);
        }
      }
      // hobIn === null with an empty src is expected for the generic
      // "handmatig invoeren"/"geen aparte montage" catch-all entries — the
      // user is meant to measure and fill it in themselves, so there's
      // nothing to cite. Only a NUMERIC hobIn without a source is worth
      // flagging (see numericNoSource above).
    }
  }

  if (issues.length === 0) {
    report.ok('app.hob-data-integrity', `${data.SIGHTS.length} richtmiddelen + ${data.MOUNTS.length} montages: geen dubbele/lege items, alle HOB-waarden binnen ${minIn}"–${maxIn}".`, 'js/app.js');
  } else {
    report.fail('app.hob-data-integrity', 'hoog', issues.join(' | '), 'js/app.js');
  }
  if (numericNoSource.length > 0) {
    report.warn('app.hob-data-source-labels', 'laag', `Numerieke HOB zonder bronvermelding (src): ${numericNoSource.join(', ')}.`, 'js/app.js');
  }

  const missingAmmo = data.OPTIC_PLATFORMS.filter(k => !data.OPTIC_PLATFORM_AMMO[k]);
  if (missingAmmo.length === 0) {
    report.ok('app.platform-ammo-coverage', `Elke OPTIC_PLATFORMS-key (${data.OPTIC_PLATFORMS.join(', ')}) heeft bijbehorende OPTIC_PLATFORM_AMMO-data.`, 'js/app.js');
  } else {
    report.warn('app.platform-ammo-coverage', 'midden', `Wapenplatform(en) zonder munitiedata (kogelbaan-blok werkt daar niet): ${missingAmmo.join(', ')}.`, 'js/app.js');
  }

  for (const [key, ammo] of Object.entries(data.OPTIC_PLATFORM_AMMO)) {
    const bad = [];
    if (!isFiniteNumber(ammo.muzzleVelocityFps) || ammo.muzzleVelocityFps <= 0) bad.push('muzzleVelocityFps');
    if (!isFiniteNumber(ammo.bc) || ammo.bc <= 0 || ammo.bc > 2) bad.push('bc');
    if (!isFiniteNumber(ammo.bulletWeightGr) || ammo.bulletWeightGr <= 0) bad.push('bulletWeightGr');
    if (!['G1', 'G7'].includes(ammo.dragModel)) bad.push('dragModel');
    if (!ammo.caliber || !ammo.caliber.trim()) bad.push('caliber');
    if (bad.length) report.fail('app.platform-ammo-integrity', 'hoog', `OPTIC_PLATFORM_AMMO["${key}"]: ongeldige velden: ${bad.join(', ')}.`, 'js/app.js');
  }
  if (Object.values(data.OPTIC_PLATFORM_AMMO).every(ammo =>
    isFiniteNumber(ammo.muzzleVelocityFps) && ammo.muzzleVelocityFps > 0 &&
    isFiniteNumber(ammo.bc) && ammo.bc > 0 && ammo.bc <= 2 &&
    isFiniteNumber(ammo.bulletWeightGr) && ammo.bulletWeightGr > 0 &&
    ['G1', 'G7'].includes(ammo.dragModel) && ammo.caliber && ammo.caliber.trim()
  )) {
    report.ok('app.platform-ammo-integrity', `Alle ${Object.keys(data.OPTIC_PLATFORM_AMMO).length} munitieprofielen hebben geldige velden.`, 'js/app.js');
  }
}

// --- B3: every richtmiddel x montage combo computes cleanly ---------------
async function checkCalculations(page, report) {
  await page.evaluate(() => switchTab('optic'));
  await page.waitForTimeout(200);

  const { sightCount, mountCount } = await page.evaluate(() => ({
    sightCount: SIGHTS.length, mountCount: MOUNTS.length,
  }));

  const badCombos = [];
  for (let si = 0; si < sightCount; si++) {
    for (let mi = 0; mi < mountCount; mi++) {
      const result = await page.evaluate(({ si, mi }) => {
        const sightSel = document.getElementById('sightO');
        const mountSel = document.getElementById('mountO');
        sightSel.value = si;
        sightSel.dispatchEvent(new Event('change'));
        mountSel.value = mi;
        mountSel.dispatchEvent(new Event('change'));
        const s = getStateOptic();
        return { off: s.off, hobDisplay: s.hobDisplay };
      }, { si, mi });

      const offBad = result.off === undefined || result.off === null || !Number.isFinite(result.off);
      const hobBad = !result.hobDisplay || /NaN|undefined|Infinity/.test(result.hobDisplay);
      if (offBad || hobBad) {
        badCombos.push(`sight[${si}]+mount[${mi}]: off=${JSON.stringify(result.off)} hobDisplay="${result.hobDisplay}"`);
      }
    }
  }

  const totalCombos = sightCount * mountCount;
  if (badCombos.length === 0) {
    report.ok('app.optic-combo-calculations', `Alle ${totalCombos} richtmiddel×montage-combinaties leveren een geldige offset en HOB-weergave.`, 'js/app.js');
  } else {
    report.fail('app.optic-combo-calculations', 'hoog', `${badCombos.length}/${totalCombos} combinaties gaven een ongeldige waarde: ${badCombos.slice(0, 10).join(' | ')}${badCombos.length > 10 ? ' | …' : ''}`, 'js/app.js');
  }

  // Kogelbaan (trajectory) — every platform, at a HOB/zero combo known to
  // produce a real 2nd crossing (9 cm HOB @ 25 m). A null result on its own
  // is correct physics for some HOB/zero combos (see js/ballistics.js) and
  // is NOT an error; only NaN/Infinity in a non-null result is.
  const trajResults = await page.evaluate(() => {
    return Object.entries(OPTIC_PLATFORM_AMMO).map(([key, ammo]) => {
      const t = window.AppliedConceptsBallistics.computeTrajectoryProfile({
        dragModel: ammo.dragModel, bc: ammo.bc, muzzleVelocityFps: ammo.muzzleVelocityFps,
        sightHeightCm: 9, zeroDistanceM: 25, bulletWeightGr: ammo.bulletWeightGr,
      });
      return { key, t };
    });
  });
  const trajBad = trajResults.filter(r => {
    if (!r.t) return false; // null is a valid outcome, see comment above
    return Object.values(r.t).some(v => typeof v === 'number' && !Number.isFinite(v));
  });
  if (trajBad.length === 0) {
    report.ok('app.trajectory-calculations', `Kogelbaan-berekening geeft geldige waarden voor alle ${trajResults.length} wapenplatformen (9 cm HOB @ 25 m).`, 'js/ballistics.js');
  } else {
    report.fail('app.trajectory-calculations', 'hoog', `NaN/Infinity in kogelbaan-resultaat voor: ${trajBad.map(r => r.key).join(', ')}.`, 'js/ballistics.js');
  }
}

// --- B4: default units on load --------------------------------------------
async function checkDefaults(page, report) {
  await page.evaluate(() => switchTab('optic'));
  const { hobUnit, adjUnit } = await page.evaluate(() => ({
    hobUnit: document.getElementById('hobUnitO').value,
    adjUnit: document.getElementById('adjUnitO').value,
  }));
  if (hobUnit === 'cm' && adjUnit === 'MIL') {
    report.ok('app.defaults', 'Standaardeenheden bij openen: metrisch (cm) en klikken op MIL.');
  } else {
    report.fail('app.defaults', 'midden', `Verwacht hobUnit=cm/adjUnit=MIL bij openen, kreeg hobUnit=${hobUnit}/adjUnit=${adjUnit}.`, 'index.html');
  }
}

// --- B5: print output — sheet dimensions match the selected paper, nothing
// runs outside the page bounds (checked via the root SVG's own getBBox():
// its content bbox can never be smaller than the page-filling background
// rect drawn first, so this only ever catches genuine overflow). ----------
async function checkPrintOutput(page, report) {
  await page.evaluate(() => switchTab('optic'));
  await page.waitForTimeout(200);

  for (const paperKey of ['a4', 'letter']) {
    const expected = PAGE_DIMS_IN[paperKey];
    const result = await page.evaluate((key) => {
      const sel = document.getElementById('paperSizeO');
      sel.value = key;
      sel.dispatchEvent(new Event('change'));
      const svg = document.querySelector('#pageO svg');
      const vb = svg.viewBox.baseVal;
      const bbox = svg.getBBox();
      return { vbW: vb.width, vbH: vb.height, bbox: { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height } };
    }, paperKey);

    const dimsMatch = Math.abs(result.vbW - expected.w) < 0.01 && Math.abs(result.vbH - expected.h) < 0.01;
    const fits = result.bbox.x >= -PAGE_FIT_EPSILON_IN && result.bbox.y >= -PAGE_FIT_EPSILON_IN &&
      (result.bbox.x + result.bbox.w) <= expected.w + PAGE_FIT_EPSILON_IN &&
      (result.bbox.y + result.bbox.h) <= expected.h + PAGE_FIT_EPSILON_IN;

    if (dimsMatch && fits) {
      report.ok(`app.print-fit.optic-${paperKey}`, `Zero Optic Calculator (${paperKey}): SVG is ${result.vbW}x${result.vbH}in, alle content past binnen het vel.`);
    } else {
      report.fail(`app.print-fit.optic-${paperKey}`, 'hoog',
        `dimsMatch=${dimsMatch} (svg ${result.vbW}x${result.vbH}in vs verwacht ${expected.w}x${expected.h}in), fits=${fits} (content bbox x=${result.bbox.x.toFixed(3)} y=${result.bbox.y.toFixed(3)} w=${result.bbox.w.toFixed(3)} h=${result.bbox.h.toFixed(3)}).`,
        'js/app.js');
    }
  }

  // Turret Tape — fixed landscape A4, no paper-size picker.
  await page.evaluate(() => switchTab('turret'));
  await page.waitForTimeout(300);
  const ttHasContent = await page.evaluate(() => !!document.querySelector('#pageTT svg'));
  if (ttHasContent) {
    const ttResult = await page.evaluate(() => {
      const svg = document.querySelector('#pageTT svg');
      const vb = svg.viewBox.baseVal;
      const bbox = svg.getBBox();
      return { vbW: vb.width, vbH: vb.height, bbox: { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height } };
    });
    const expected = { w: 11.6929, h: 8.2677 }; // TT_PAGE, js/turret.js
    const fits = ttResult.bbox.x >= -PAGE_FIT_EPSILON_IN && ttResult.bbox.y >= -PAGE_FIT_EPSILON_IN &&
      (ttResult.bbox.x + ttResult.bbox.w) <= expected.w + PAGE_FIT_EPSILON_IN &&
      (ttResult.bbox.y + ttResult.bbox.h) <= expected.h + PAGE_FIT_EPSILON_IN;
    if (fits) {
      report.ok('app.print-fit.turret-tape', `Turret Tape: SVG ${ttResult.vbW}x${ttResult.vbH}in, content past binnen het vel.`);
    } else {
      report.fail('app.print-fit.turret-tape', 'hoog', `Content bbox valt buiten het vel: x=${ttResult.bbox.x.toFixed(3)} y=${ttResult.bbox.y.toFixed(3)} w=${ttResult.bbox.w.toFixed(3)} h=${ttResult.bbox.h.toFixed(3)} (vel ${expected.w}x${expected.h}in).`, 'js/turret.js');
    }
  } else {
    report.warn('app.print-fit.turret-tape', 'laag', 'Geen turret-tape SVG gevonden om te controleren (mogelijk geen wapenprofiel/dope beschikbaar in een schone testomgeving).', 'js/turret.js');
  }

  // Train — always A4 (no paper picker); spot-check the currently selected
  // sheet after switching to the tab (Zero Target is the default in Sniper).
  await page.evaluate(() => switchTab('train'));
  await page.waitForTimeout(300);
  const trainHasContent = await page.evaluate(() => !!document.querySelector('#pageT svg'));
  if (trainHasContent) {
    const trResult = await page.evaluate(() => {
      const svg = document.querySelector('#pageT svg');
      const vb = svg.viewBox.baseVal;
      const bbox = svg.getBBox();
      return { vbW: vb.width, vbH: vb.height, bbox: { x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height } };
    });
    const expected = PAGE_DIMS_IN.a4;
    const fits = trResult.bbox.x >= -PAGE_FIT_EPSILON_IN && trResult.bbox.y >= -PAGE_FIT_EPSILON_IN &&
      (trResult.bbox.x + trResult.bbox.w) <= expected.w + PAGE_FIT_EPSILON_IN &&
      (trResult.bbox.y + trResult.bbox.h) <= expected.h + PAGE_FIT_EPSILON_IN;
    if (fits) {
      report.ok('app.print-fit.train', `Train: SVG ${trResult.vbW}x${trResult.vbH}in, content past binnen het vel.`);
    } else {
      report.fail('app.print-fit.train', 'hoog', `Content bbox valt buiten het vel: x=${trResult.bbox.x.toFixed(3)} y=${trResult.bbox.y.toFixed(3)} w=${trResult.bbox.w.toFixed(3)} h=${trResult.bbox.h.toFixed(3)}.`, 'js/train.js');
    }
  } else {
    report.warn('app.print-fit.train', 'laag', 'Geen Train-SVG gevonden om te controleren.', 'js/train.js');
  }
}

// --- B6: responsive — no horizontal overflow at 3 breakpoints ------------
async function checkResponsive(page, browser, report) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const overflows = [];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.evaluate(() => switchTab('optic'));
    await page.waitForTimeout(200);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const screenshotPath = path.join(ARTIFACTS_DIR, `responsive-${vp.name}-${vp.width}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    if (scrollWidth > clientWidth + 1) {
      overflows.push(`${vp.name} (${vp.width}px): scrollWidth=${scrollWidth} > clientWidth=${clientWidth}`);
    }
  }
  if (overflows.length === 0) {
    report.ok('app.responsive-no-overflow', `Geen horizontale overflow op ${VIEWPORTS.map(v => v.width).join('/')}px. Screenshots in healthcheck/artifacts/.`);
  } else {
    report.fail('app.responsive-no-overflow', 'midden', overflows.join(' | '));
  }
}

// --- B7: changelog panel + version consistency ----------------------------
async function checkChangelog(page, report) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const mastheadVersion = await page.locator('#versionLink').textContent();
  await page.locator('#versionLink').click();
  await page.waitForTimeout(200);
  const isOpen = await page.evaluate(() => document.getElementById('changelog').classList.contains('open'));
  const firstEntryVersion = await page.locator('#changelogBody .changelog-entry').first().locator('.changelog-version').textContent().catch(() => null);

  if (!isOpen) {
    report.fail('app.changelog-opens', 'midden', 'Changelog-paneel kreeg niet de "open"-class na klikken op de masthead-versielink.', 'index.html');
  } else {
    report.ok('app.changelog-opens', 'Changelog-paneel opent via de masthead-link.');
  }

  if (firstEntryVersion && mastheadVersion && firstEntryVersion.trim() === mastheadVersion.trim()) {
    report.ok('app.changelog-version-matches', `Masthead-versie (${mastheadVersion.trim()}) komt overeen met de nieuwste changelog-regel.`);
  } else {
    report.fail('app.changelog-version-matches', 'midden', `Masthead toont "${mastheadVersion}", nieuwste changelog-regel is "${firstEntryVersion}" — vergeten te synchroniseren bij de laatste versiebump?`, 'js/app.js');
  }
}

// --- B8: links ---------------------------------------------------------
async function checkLinks(page, report) {
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
  const bad = [];
  const skipped = [];
  for (const href of links) {
    if (href.startsWith('mailto:')) {
      if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) bad.push(`ongeldig mailto-adres: ${href}`);
      continue;
    }
    if (href.startsWith('tel:')) {
      if (!/^tel:\+?[\d\s-]+$/.test(href)) bad.push(`ongeldig tel-nummer: ${href}`);
      continue;
    }
    // No other <a href> currently exists in the app (WhatsApp deep links are
    // built at click-time in JS, not static <a> tags) — this branch exists
    // so a future internal/external <a href> doesn't silently go unchecked.
    skipped.push(href);
  }
  if (bad.length === 0) {
    report.ok('app.links-valid', `${links.length} link(s) gecontroleerd (mailto/tel-patroon), geen problemen.${skipped.length ? ` Niet HTTP-gecontroleerd (buiten scope van deze check): ${skipped.join(', ')}.` : ''}`);
  } else {
    report.fail('app.links-valid', 'laag', bad.join(' | '));
  }
}

// --- extra: confirm the archived Laser Calculator left no live remnant ---
async function checkNoLaserRemnants(page, report) {
  const found = await page.evaluate(() => {
    const tabButtons = [...document.querySelectorAll('.tabbtn')];
    return tabButtons.some(b => /laser/i.test(b.textContent) || /laser/i.test(b.dataset.tab || ''));
  });
  if (!found) {
    report.ok('app.no-laser-tab-remnant', 'Geen "Laser"-tabblad of -verwijzing in de live tabbar (Zero Laser Calculator blijft correct gearchiveerd in archive/).');
  } else {
    report.warn('app.no-laser-tab-remnant', 'midden', 'Er staat een tabblad met "laser" in naam of data-tab in de tabbar, terwijl de Zero Laser Calculator gearchiveerd hoort te zijn — check of dit bedoeld is.', 'index.html');
  }
}

async function runAppChecks(browser, baseUrl, report) {
  const page = await browser.newPage();
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const isUnlocked = await page.evaluate(() => document.body.classList.contains('unlocked'));
  if (!isUnlocked) {
    report.fail('app.test-mode-active', 'hoog', 'Testmodus-bypass activeerde niet op localhost — body mist de "unlocked"-class. Alle overige B-checks hieronder zijn overgeslagen.', 'js/app.js');
    await page.close();
    return;
  }
  report.ok('app.test-mode-active', 'Testmodus-bypass werkt: app is direct ontgrendeld op localhost.');

  await checkAllTabsNoErrors(page, report);
  await checkDataIntegrity(page, report);
  await checkCalculations(page, report);
  await checkDefaults(page, report);
  await checkPrintOutput(page, report);
  await checkResponsive(page, browser, report);
  await checkChangelog(page, report);
  await checkLinks(page, report);
  await checkNoLaserRemnants(page, report);

  await page.close();
}

module.exports = { runAppChecks };
