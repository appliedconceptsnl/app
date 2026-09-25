'use strict';

// Attaches console-error and failed-request collectors to a page. Returns a
// function that reads the current lists (call it any time; the arrays keep
// growing until the page is closed) and a function to reset between tabs/
// steps so failures can be attributed to the right one.
function watchPage(page) {
  let consoleErrors = [];
  let pageErrors = [];
  let failedRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });
  page.on('requestfailed', (req) => {
    // Aborted/cancelled requests from a page navigating away mid-load are
    // routine, not a real failure — everything else (net::ERR_*, actual
    // 4xx/5xx surfaced this way) is worth reporting.
    const failure = req.failure();
    if (failure && /NS_BINDING_ABORTED|net::ERR_ABORTED/.test(failure.errorText)) return;
    failedRequests.push({ url: req.url(), error: failure ? failure.errorText : 'unknown' });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push({ url: res.url(), error: `HTTP ${res.status()}` });
    }
  });

  return {
    snapshot() {
      return {
        consoleErrors: [...consoleErrors],
        pageErrors: [...pageErrors],
        failedRequests: [...failedRequests],
      };
    },
    reset() {
      consoleErrors = [];
      pageErrors = [];
      failedRequests = [];
    },
  };
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Renders in Node < 20's structuredClone-less environments too — small
// values only (report entries), no need for the real thing.
function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

module.exports = { watchPage, isFiniteNumber, clone };
