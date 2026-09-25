'use strict';

const fs = require('fs');
const path = require('path');
const { LIVE_URL, REPO_ROOT } = require('./constants');
const { watchPage } = require('./utils');

// Section A — checks against the real, public URL, going through the gate
// exactly as a real visitor would (no test-mode bypass: that only exists
// for localhost, see js/app.js). Never logs in — the point is to check
// what an unauthenticated visitor actually sees.
async function runLiveChecks(browser, report) {
  const page = await browser.newPage();
  const watcher = watchPage(page);

  let response;
  const t0 = Date.now();
  try {
    response = await page.goto(LIVE_URL, { waitUntil: 'load', timeout: 30000 });
  } catch (err) {
    report.fail('live.reachable', 'hoog', `Kon ${LIVE_URL} niet laden: ${err.message}`);
    await page.close();
    return;
  }
  const loadTimeMs = Date.now() - t0;

  if (!response) {
    report.fail('live.reachable', 'hoog', `Geen response object voor ${LIVE_URL} — navigatie leverde niets op.`);
    await page.close();
    return;
  }

  const status = response.status();
  const url = response.url();
  if (status === 200 && url.startsWith('https://')) {
    report.ok('live.reachable', `HTTP 200 via HTTPS, laadtijd ${loadTimeMs} ms.`);
  } else {
    report.fail('live.reachable', 'hoog', `Verwacht HTTP 200 via HTTPS, kreeg status ${status} op ${url}.`);
  }
  if (loadTimeMs > 5000) {
    report.warn('live.load-time', 'laag', `Laadtijd ${loadTimeMs} ms — hoger dan de 5s-richtwaarde. Kan eenmalige CDN cold-start zijn.`);
  }

  // Let network activity settle (fonts, background image) before judging 404s.
  await page.waitForTimeout(1500);
  const { failedRequests, consoleErrors, pageErrors } = watcher.snapshot();

  if (failedRequests.length === 0) {
    report.ok('live.no-404s', 'Logo, achtergrond, CSS, JS en fonts laadden allemaal zonder fout.');
  } else {
    report.fail('live.no-404s', 'hoog', `${failedRequests.length} mislukte request(s): ${failedRequests.map(f => `${f.url} (${f.error})`).join('; ')}`);
  }

  // Gate: on the live origin (never localhost), the gate must be intact —
  // visible, unlocked=false, and the unlock form present.
  const gateVisible = await page.locator('#gate').isVisible().catch(() => false);
  const isUnlocked = await page.evaluate(() => document.body.classList.contains('unlocked'));
  const passInputExists = await page.locator('#gatePass').count();
  if (gateVisible && !isUnlocked && passInputExists > 0) {
    report.ok('live.gate-intact', 'Pass phrase-scherm verschijnt correct; app blijft vergrendeld zonder geldige phrase.');
  } else {
    report.fail('live.gate-intact', 'hoog', `Gate-status onverwacht: visible=${gateVisible}, unlocked=${isUnlocked}, gatePass aanwezig=${passInputExists > 0}. De gate MOET hier intact zijn.`);
  }

  if (consoleErrors.length === 0 && pageErrors.length === 0) {
    report.ok('live.no-console-errors', 'Geen console- of pagina-fouten tijdens het laden van het pass phrase-scherm.');
  } else {
    report.fail('live.no-console-errors', 'midden', `Console/pagina-fouten: ${[...consoleErrors, ...pageErrors].join(' | ')}`);
  }

  // Version consistency: compare the live masthead version against the
  // same string in the locally checked-out index.html (the CI job already
  // has the repo on disk — no build-hash needed, see healthcheck/README.md
  // for why this is a "warn" not a "fail").
  const liveVersion = await page.locator('#versionLink').textContent().catch(() => null);
  let localVersion = null;
  try {
    const localHtml = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
    const m = localHtml.match(/id="versionLink">([^<]+)</);
    localVersion = m ? m[1].trim() : null;
  } catch (err) {
    // fall through — reported below as "could not determine"
  }
  if (!liveVersion || !localVersion) {
    report.warn('live.version-matches-main', 'laag', `Kon versie niet vaststellen (live="${liveVersion}", lokaal="${localVersion}").`);
  } else if (liveVersion.trim() === localVersion) {
    report.ok('live.version-matches-main', `Live versie (${liveVersion.trim()}) komt overeen met main (${localVersion}).`);
  } else {
    report.warn('live.version-matches-main', 'laag', `Live versie "${liveVersion.trim()}" wijkt af van main "${localVersion}" — GitHub Pages-deploy waarschijnlijk nog niet doorgekomen (CDN-vertraging is normaal, geen fail).`);
  }

  await page.close();
}

module.exports = { runLiveChecks };
