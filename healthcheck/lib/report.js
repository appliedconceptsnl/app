'use strict';

// Findings accumulator. A "finding" is one check's result — the report is
// just the full list, plus a summary GitHub Actions can key off of without
// re-deriving anything (worstSeverity/hasFail flags the exit code, too).
class Report {
  constructor() {
    this.findings = [];
    this.startedAt = new Date().toISOString();
  }

  // status: 'ok' | 'warn' | 'fail'. severity: 'hoog' | 'midden' | 'laag'.
  // 'ok' findings don't need a severity (nothing to prioritize), but one is
  // accepted anyway so callers can log a single object shape either way.
  add({ id, status, severity, details, file }) {
    if (!id || !status) throw new Error(`report.add: id and status are required (got ${JSON.stringify({ id, status })})`);
    if (!['ok', 'warn', 'fail'].includes(status)) throw new Error(`report.add: invalid status "${status}" for ${id}`);
    this.findings.push({ id, status, severity: severity || null, details: details || '', file: file || null });
  }

  ok(id, details, file) { this.add({ id, status: 'ok', details, file }); }
  warn(id, severity, details, file) { this.add({ id, status: 'warn', severity, details, file }); }
  fail(id, severity, details, file) { this.add({ id, status: 'fail', severity, details, file }); }

  hasFailures() { return this.findings.some(f => f.status === 'fail'); }
  hasWarnings() { return this.findings.some(f => f.status === 'warn'); }

  summary() {
    const counts = { ok: 0, warn: 0, fail: 0 };
    for (const f of this.findings) counts[f.status]++;
    return counts;
  }

  toJSON() {
    return {
      generatedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      summary: this.summary(),
      findings: this.findings,
    };
  }
}

module.exports = { Report };
