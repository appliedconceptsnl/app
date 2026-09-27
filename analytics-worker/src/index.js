/* ---------------------------------------------------------------------
   Applied Concepts — analytics Worker.
   Two endpoints:
     POST /track   { event: 'pageview' }              -> counts a visit
     POST /track   { event: 'tab', tab: 'optic' }      -> counts a tab view
     GET  /report?date=YYYY-MM-DD  (Bearer REPORT_SECRET) -> daily digest JSON

   Privacy: never stores a raw IP. A pageview's IP is hashed together with
   the day's date and a server-side secret salt (SHA-256), so the same
   person visiting twice in one day collapses into one "unique visitor" via
   a UNIQUE(date, hash) constraint, but the hash itself is one-way and
   changes every day — nothing here can identify a person or track them
   across days. No cookies, no user-agent logging, no per-visit history.
--------------------------------------------------------------------- */

const ALLOWED_ORIGIN = 'https://appliedconceptsnl.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function hashVisitor(ip, date, salt) {
  const data = new TextEncoder().encode(`${salt}:${date}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleTrack(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response('bad request', { status: 400, headers: corsHeaders() });
  }
  const date = todayUTC();

  if (body.event === 'pageview') {
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const hash = await hashVisitor(ip, date, env.HASH_SALT || 'no-salt-configured');
    await env.DB.batch([
      env.DB.prepare('INSERT INTO visitor_hashes (date, hash) VALUES (?, ?) ON CONFLICT(date, hash) DO NOTHING').bind(date, hash),
      env.DB.prepare('INSERT INTO pageviews (date, count) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET count = count + 1').bind(date),
    ]);
  } else if (body.event === 'tab' && typeof body.tab === 'string' && body.tab.length < 40) {
    await env.DB.prepare(
      'INSERT INTO tab_views (date, tab, count) VALUES (?, ?, 1) ON CONFLICT(date, tab) DO UPDATE SET count = count + 1'
    ).bind(date, body.tab).run();
  } else {
    return new Response('unknown event', { status: 400, headers: corsHeaders() });
  }

  return new Response('ok', { status: 202, headers: corsHeaders() });
}

async function handleReport(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (auth !== `Bearer ${env.REPORT_SECRET}`) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders() });
  }
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || todayUTC();

  const [{ results: visitorRows }, { results: pageviewRows }, { results: tabRows }] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM visitor_hashes WHERE date = ?').bind(date).all(),
    env.DB.prepare('SELECT count FROM pageviews WHERE date = ?').bind(date).all(),
    env.DB.prepare('SELECT tab, count FROM tab_views WHERE date = ? ORDER BY count DESC').bind(date).all(),
  ]);

  const tabCounts = {};
  tabRows.forEach(r => { tabCounts[r.tab] = r.count; });

  const report = {
    date,
    uniqueVisitors: visitorRows[0] ? visitorRows[0].n : 0,
    pageviews: pageviewRows[0] ? pageviewRows[0].count : 0,
    tabCounts,
  };
  return new Response(JSON.stringify(report), {
    status: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/track') return await handleTrack(request, env);
      if (request.method === 'GET' && url.pathname === '/report') return await handleReport(request, env);
      return new Response('not found', { status: 404, headers: corsHeaders() });
    } catch (err) {
      return new Response('server error: ' + err.message, { status: 500, headers: corsHeaders() });
    }
  },
};
