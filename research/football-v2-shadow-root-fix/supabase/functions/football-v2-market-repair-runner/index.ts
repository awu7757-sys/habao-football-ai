// HABAO V2 shadow-only market recovery. Immutable input rows are never updated.
const VERSION = 'football-v2-market-repair-shadow-0.1';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MAX_ATTEMPTS = 3;
const SPORTS: Record<number, string> = {
  39: 'soccer_epl', 140: 'soccer_spain_la_liga', 78: 'soccer_germany_bundesliga',
  135: 'soccer_italy_serie_a', 61: 'soccer_france_ligue_one', 2: 'soccer_uefa_champs_league',
  3: 'soccer_uefa_europa_league', 88: 'soccer_netherlands_eredivisie', 40: 'soccer_efl_champ',
  253: 'soccer_usa_mls', 262: 'soccer_mexico_ligamx', 848: 'soccer_uefa_europa_conference_league',
  71: 'soccer_brazil_campeonato'
};
const cfg = {
  url: (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, ''),
  role: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  footballKey: Deno.env.get('API_FOOTBALL_KEY') || '',
  oddsKey: Deno.env.get('THE_ODDS_API_KEY') || Deno.env.get('ODDS_API_KEY') || '',
  cronKey: Deno.env.get('FOOTBALL_V2_MARKET_CRON_KEY') || ''
};
const out = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});
const safe = (value: unknown) => String(value ?? '').slice(0, 240).replace(/[\r\n]/g, ' ');
const headers = (prefer?: string) => ({
  apikey: cfg.role, authorization: `Bearer ${cfg.role}`, 'content-type': 'application/json',
  ...(prefer ? { prefer } : {})
});
type V1 = { fixture_id: number; kickoff_at: string; created_at: string };
type Input = { fixture_id: number; kickoff_at: string; market: Record<string, unknown> | null };
type Audit = { fixture_id: number; attempts: number; next_retry_at: string | null; terminal: boolean; status: string };
type Game = { fixture?: { id?: number; date?: string }; league?: { id?: number; season?: number }; teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } } };

async function getRows<T>(table: string, query: string): Promise<T[]> {
  const response = await fetch(`${cfg.url}/rest/v1/${table}?${query}`, {
    headers: headers(), signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`db_read_${table}_${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error(`db_bad_response_${table}`);
  return body as T[];
}
async function upsert(table: string, value: Record<string, unknown>, conflict: string, prefer = 'resolution=merge-duplicates,return=minimal') {
  const response = await fetch(`${cfg.url}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST', headers: headers(prefer), body: JSON.stringify(value), signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`db_write_${table}_${response.status}_${safe(await response.text())}`);
}
async function football(path: string) {
  const response = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { 'x-apisports-key': cfg.footballKey }, signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`football_http_${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.response) || (body?.errors && Object.keys(body.errors).length)) throw new Error('football_invalid_or_error_payload');
  return body.response as Game[];
}
function norm(name: unknown) {
  return String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(football club|futbol club|fc|afc|cf|sc|ac)\b/g, '').replace(/[^a-z0-9]/g, '');
}
function sameTeam(a: unknown, b: unknown) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 7 && (x.includes(y) || y.includes(x)));
}
async function writeAudit(fixture: V1, prior: Audit | undefined, status: string, reason: string,
  detail: Record<string, unknown>, retryMinutes: number | null, terminal: boolean) {
  const attempts = Number(prior?.attempts || 0) + (status === 'processing' ? 1 : 0);
  const next = retryMinutes === null ? null : new Date(Date.now() + retryMinutes * 60_000).toISOString();
  await upsert('football_v2_market_repair_audit', {
    fixture_id: fixture.fixture_id, kickoff_at: fixture.kickoff_at, status, reason_code: reason,
    attempts, next_retry_at: next, terminal, detail, updated_at: new Date().toISOString()
  }, 'fixture_id');
  return { fixture_id: fixture.fixture_id, attempts, next_retry_at: next, terminal, status } as Audit;
}
function needsMarket(input: Input | undefined) {
  const m = input?.market || {};
  const line = Number(m.total_line), over = Number(m.over_odds), under = Number(m.under_odds);
  return !(Number.isFinite(line) && Number.isFinite(over) && over > 1 && Number.isFinite(under) && under > 1);
}
async function quote(leagueId: number, kickoff: string, home: string, away: string) {
  const sport = SPORTS[leagueId];
  if (!sport) return { quote: null, reason: 'unsupported_league', bookmakers: 0 };
  if (!cfg.oddsKey) return { quote: null, reason: 'odds_key_missing', bookmakers: 0 };
  const url = new URL(`https://api.the-odds-api.com/v4/sports/${sport}/odds/`);
  url.searchParams.set('apiKey', cfg.oddsKey);
  url.searchParams.set('regions', 'eu'); url.searchParams.set('markets', 'totals');
  url.searchParams.set('oddsFormat', 'decimal'); url.searchParams.set('dateFormat', 'iso');
  let games: any[];
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { quote: null, reason: `odds_http_${response.status}`, bookmakers: 0 };
    const payload = await response.json();
    if (!Array.isArray(payload)) return { quote: null, reason: 'odds_invalid_payload', bookmakers: 0 };
    games = payload;
  } catch (error) { return { quote: null, reason: `odds_fetch_error_${safe(error)}`, bookmakers: 0 }; }
  const kickoffMs = Date.parse(kickoff);
  const game = games.filter(g => Number.isFinite(Date.parse(g.commence_time)) &&
    Math.abs(Date.parse(g.commence_time) - kickoffMs) <= 90 * 60_000 &&
    sameTeam(home, g.home_team) && sameTeam(away, g.away_team))
    .sort((a, b) => Math.abs(Date.parse(a.commence_time) - kickoffMs) - Math.abs(Date.parse(b.commence_time) - kickoffMs))[0];
  if (!game) return { quote: null, reason: 'odds_fixture_not_matched', bookmakers: 0 };
  const byLine = new Map<number, Array<{ over: number; under: number }>>();
  for (const book of game.bookmakers || []) for (const market of book.markets || []) {
    if (market.key !== 'totals') continue;
    const pair = new Map<number, { over?: number; under?: number }>();
    for (const pick of market.outcomes || []) {
      const line = Number(pick.point), price = Number(pick.price), side = String(pick.name || '').toLowerCase();
      if (!Number.isFinite(line) || line < 0 || line > 10 || !Number.isFinite(price) || price <= 1 || price > 50) continue;
      if (side !== 'over' && side !== 'under') continue;
      pair.set(line, { ...(pair.get(line) || {}), [side]: price });
    }
    for (const [line, prices] of pair) if (prices.over && prices.under) {
      byLine.set(line, [...(byLine.get(line) || []), { over: prices.over, under: prices.under }]);
    }
  }
  const ranked = [...byLine.entries()].map(([line, rows]) => ({ line, rows,
    spread: rows.reduce((n, r) => n + Math.abs(r.over - r.under), 0) / rows.length
  })).sort((a, b) => a.spread - b.spread || b.rows.length - a.rows.length);
  if (!ranked.length) return { quote: null, reason: 'odds_totals_missing', bookmakers: 0 };
  const best = ranked[0];
  return { quote: {
    total_line: best.line,
    over_odds: Number((best.rows.reduce((n, r) => n + r.over, 0) / best.rows.length).toFixed(4)),
    under_odds: Number((best.rows.reduce((n, r) => n + r.under, 0) / best.rows.length).toFixed(4)),
    bookmaker_count: best.rows.length
  }, reason: 'odds_market_collected', bookmakers: best.rows.length };
}
async function run(action: 'dry_run' | 'run') {
  const now = Date.now(), minKickoff = new Date(now + 30 * 60_000).toISOString(), maxKickoff = new Date(now + 48 * HOUR).toISOString();
  const v1 = await getRows<V1>('ai_prediction_snapshots', `select=fixture_id,kickoff_at,created_at&kickoff_at=gt.${encodeURIComponent(minKickoff)}&kickoff_at=lte.${encodeURIComponent(maxKickoff)}&order=kickoff_at.asc&limit=120`);
  if (!v1.length) return { success: true, version: VERSION, action, status: 'no_v1_candidates', scanned: 0, api_football_calls: 0, odds_calls: 0 };
  const ids = [...new Set(v1.map(x => Number(x.fixture_id)).filter(Number.isSafeInteger))];
  const list = `fixture_id=in.(${ids.join(',')})`;
  const [inputs, audits, quotes] = await Promise.all([
    getRows<Input>('football_v2_shadow_inputs', `select=fixture_id,kickoff_at,market&${list}`),
    getRows<Audit>('football_v2_market_repair_audit', `select=fixture_id,attempts,next_retry_at,terminal,status&${list}`),
    getRows<{ fixture_id: number }>('football_v2_shadow_market_quotes', `select=fixture_id&${list}`)
  ]);
  const inputById = new Map(inputs.map(x => [Number(x.fixture_id), x]));
  const auditById = new Map(audits.map(x => [Number(x.fixture_id), x]));
  const quoteIds = new Set(quotes.map(x => Number(x.fixture_id)));
  const due = v1.filter(f => {
    const id = Number(f.fixture_id), prev = auditById.get(id);
    if (!inputById.has(id) || !needsMarket(inputById.get(id)) || quoteIds.has(id)) return false;
    if (prev?.terminal || Number(prev?.attempts || 0) >= MAX_ATTEMPTS) return false;
    return !prev?.next_retry_at || Date.parse(prev.next_retry_at) <= now;
  });
  if (action === 'dry_run') return { success: true, version: VERSION, action, scanned: v1.length,
    inputs_missing_or_incomplete_market: due.map(x => x.fixture_id), api_football_calls: 0, odds_calls: 0 };
  if (!due.length) return { success: true, version: VERSION, action, status: 'all_done_or_backoff', scanned: v1.length, api_football_calls: 0, odds_calls: 0 };

  const fixture = due[0], id = Number(fixture.fixture_id), prior = auditById.get(id);
  const attempt = Number(prior?.attempts || 0) + 1;
  let audit = await writeAudit(fixture, prior, 'processing', 'processing', { started_at: new Date().toISOString() }, 15, false);
  let apiCalls = 0, oddsCalls = 0;
  try {
    if (!cfg.footballKey) throw new Error('football_api_key_missing');
    apiCalls++;
    const rows = await football(`/fixtures?id=${id}`);
    const game = rows.find(g => Number(g.fixture?.id) === id);
    if (!game) throw new Error('fixture_not_found');
    const officialKickoff = Date.parse(fixture.kickoff_at), actualKickoff = Date.parse(String(game.fixture?.date || ''));
    if (!Number.isFinite(actualKickoff) || Math.abs(actualKickoff - officialKickoff) > 90 * 60_000) throw new Error('fixture_time_mismatch');
    if (Date.now() >= officialKickoff - 30 * 60_000) throw new Error('capture_window_closed');
    const league = Number(game.league?.id), home = String(game.teams?.home?.name || ''), away = String(game.teams?.away?.name || '');
    if (!Number.isInteger(league) || !home || !away) throw new Error('fixture_market_identity_missing');
    if (!SPORTS[league]) {
      const terminal = true;
      audit = await writeAudit(fixture, audit, 'unsupported_league', 'unsupported_league', { league_id: league, api_football_calls: apiCalls }, null, terminal);
      return { success: true, version: VERSION, action, status: 'unsupported_league', fixture_id: id, api_football_calls: apiCalls, odds_calls: 0 };
    }
    oddsCalls++;
    const found = await quote(league, fixture.kickoff_at, home, away);
    if (!found.quote) {
      const terminal = attempt >= MAX_ATTEMPTS || Date.now() >= officialKickoff - HOUR;
      const status = terminal ? 'exhausted' : 'no_market';
      await writeAudit(fixture, audit, status, found.reason, { league_id: league, home, away,
        api_football_calls: apiCalls, odds_calls: oddsCalls }, terminal ? null : 30, terminal);
      return { success: true, version: VERSION, action, status, fixture_id: id, reason: found.reason,
        attempt, terminal, api_football_calls: apiCalls, odds_calls: oddsCalls };
    }
    const captured = Date.now();
    const slot = new Date(Math.floor(captured / (15 * 60_000)) * (15 * 60_000)).toISOString();
    const payload = { fixture_id: id, kickoff_at: new Date(actualKickoff).toISOString(), captured_at: new Date(captured).toISOString(),
      capture_slot: slot, provider: 'the_odds_api', market_key: 'totals', total_line: found.quote.total_line,
      over_odds: found.quote.over_odds, under_odds: found.quote.under_odds, bookmaker_count: found.quote.bookmaker_count,
      source_meta: { source: 'football-v2-market-repair-runner', version: VERSION, league_id: league,
        home_team: home, away_team: away, capture_mode: 'late_pre_match_market_recovery',
        api_football_calls: apiCalls, odds_calls: oddsCalls }, research_only: true };
    await upsert('football_v2_shadow_market_quotes', payload, 'fixture_id,capture_slot', 'resolution=ignore-duplicates,return=minimal');
    await writeAudit(fixture, audit, 'captured', 'odds_market_collected', {
      captured_at: payload.captured_at, total_line: payload.total_line, over_odds: payload.over_odds,
      under_odds: payload.under_odds, bookmaker_count: payload.bookmaker_count,
      api_football_calls: apiCalls, odds_calls: oddsCalls
    }, null, true);
    return { success: true, version: VERSION, action, status: 'captured', fixture_id: id,
      total_line: payload.total_line, bookmaker_count: payload.bookmaker_count, api_football_calls: apiCalls, odds_calls: oddsCalls };
  } catch (error) {
    const reason = safe(error), terminal = attempt >= MAX_ATTEMPTS || Date.parse(fixture.kickoff_at) - Date.now() < HOUR;
    const status = terminal ? 'exhausted' : 'failed';
    try { await writeAudit(fixture, audit, status, reason.slice(0, 80), { error: reason,
      api_football_calls: apiCalls, odds_calls: oddsCalls }, terminal ? null : 30, terminal); } catch { /* preserve the function response */ }
    return { success: false, version: VERSION, action, status, fixture_id: id, reason, attempt, terminal,
      api_football_calls: apiCalls, odds_calls: oddsCalls };
  }
}

Deno.serve(async request => {
  if (request.method !== 'POST') return out(405, { success: false, error: 'method_not_allowed' });
  if (!cfg.cronKey || request.headers.get('x-habao-cron-key') !== cfg.cronKey) return out(401, { success: false, error: 'unauthorized' });
  if (!cfg.url || !cfg.role) return out(503, { success: false, error: 'storage_not_configured' });
  let body: { action?: string } = {};
  try { body = await request.json(); } catch { return out(400, { success: false, error: 'invalid_json' }); }
  const action = String(body?.action || 'dry_run');
  if (action !== 'dry_run' && action !== 'run') return out(422, { success: false, error: 'unknown_action' });
  try {
    const result = await run(action);
    return out(result.success ? 200 : 503, result);
  } catch (error) { return out(503, { success: false, version: VERSION, error: safe(error) }); }
});
