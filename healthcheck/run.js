#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { chromium } = require('playwright');
const { Report } = require('./lib/report');
const { runLiveChecks } = require('./lib/liveChecks');
const { runAppChecks } = require('./lib/appChecks');
const { startDevServer } = require('./lib/devServer');
const { REPORT_PATH } = require('./lib/constants');

async function main() {
  const report = new Report();
  const browser = await chromium.launch();
  let devServer = null;

  try {
    console.log('--- Sectie A: live-checks (' + require('./lib/constants').LIVE_URL + ') ---');
    await runLiveChecks(browser, report);

    console.log('--- Sectie B: volledige app-checks (localhost, testmodus) ---');
    devServer = await startDevServer();
    await runAppChecks(browser, devServer.url, report);
  } catch (err) {
    // A crash in the script itself is a finding too, not a silent exit —
    // otherwise a bug here would look identical to "everything passed".
    report.fail('healthcheck.script-error', 'hoog', `Onverwachte fout tijdens het draaien van de health check: ${err.stack || err.message}`);
  } finally {
    if (devServer) devServer.stop();
    await browser.close();
  }

  const json = report.toJSON();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(json, null, 2));

  const { ok, warn, fail } = json.summary;
  console.log(`\nResultaat: ${ok} ok, ${warn} warn, ${fail} fail`);
  console.log(`Rapport geschreven naar ${REPORT_PATH}`);

  process.exit(report.hasFailures() ? 1 : 0);
}

main();
