import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type":
          "application/json; charset=utf-8",
      },
    },
  );
}

function getSecretKey() {
  const legacy =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (legacy) return legacy;

  const raw =
    Deno.env.get("SUPABASE_SECRET_KEYS");

  if (!raw) return "";

  try {
    const keys = JSON.parse(raw);
    return String(keys?.default || "");
  } catch {
    return "";
  }
}

const SUPABASE_URL =
  String(
    Deno.env.get("SUPABASE_URL") || "",
  ).trim();

const SECRET_KEY =
  getSecretKey();

const CRON_KEY =
  String(
    Deno.env.get("BASKETBALL_T10_CRON_KEY") || "",
  ).trim();

let supabaseAdmin:
  ReturnType<typeof createClient> |
  null = null;

function requireSupabaseAdmin() {
  if (!SUPABASE_URL || !SECRET_KEY) {
    throw new Error(
      "SUPABASE_ADMIN_ENV_MISSING",
    );
  }

  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
      SUPABASE_URL,
      SECRET_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  return supabaseAdmin;
}

function hasCronKey(
  req: Request,
) {
  const cronKey =
    String(
      req.headers.get(
        "x-habao-cron-key",
      ) || "",
    ).trim();

  return Boolean(
    CRON_KEY &&
    cronKey &&
    cronKey === CRON_KEY
  );
}

function isAuthorizedRequest(
  req: Request,
) {
  if (
    hasCronKey(req)
  ) {
    return true;
  }

  if (!SECRET_KEY) {
    return false;
  }

  const apikey =
    String(
      req.headers.get("apikey") || "",
    ).trim();

  const authorization =
    String(
      req.headers.get(
        "authorization",
      ) || "",
    ).trim();

  if (
    apikey &&
    apikey === SECRET_KEY
  ) {
    return true;
  }

  if (
    !SECRET_KEY.startsWith(
      "sb_secret_",
    ) &&
    authorization ===
      `Bearer ${SECRET_KEY}`
  ) {
    return true;
  }

  return false;
}

function getBackendHeaders() {
  const headers:
    Record<string, string> = {
      "Content-Type":
        "application/json",
      "apikey":
        SECRET_KEY,
    };

  if (
    SECRET_KEY &&
    !SECRET_KEY.startsWith(
      "sb_secret_",
    )
  ) {
    headers.Authorization =
      `Bearer ${SECRET_KEY}`;
  }

  return headers;
}

function dateInTaipei(
  input: Date,
) {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "Asia/Taipei",
      year:
        "numeric",
      month:
        "2-digit",
      day:
        "2-digit",
    },
  ).format(input);
}

function todayTaipei() {
  return dateInTaipei(
    new Date(),
  );
}

function addDays(
  yyyyMmDd: string,
  days: number,
) {
  const m =
    yyyyMmDd.match(
      /^(\d{4})-(\d{2})-(\d{2})$/,
    );

  if (!m) {
    throw new Error(
      "INVALID_DATE",
    );
  }

  const d =
    new Date(
      Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        12,
        0,
        0,
      ),
    );

  d.setUTCDate(
    d.getUTCDate() +
    days,
  );

  return [
    d.getUTCFullYear(),
    String(
      d.getUTCMonth() + 1,
    ).padStart(2, "0"),
    String(
      d.getUTCDate(),
    ).padStart(2, "0"),
  ].join("-");
}

function normalizeBaseDate(
  body: any,
) {
  const explicit =
    String(
      body?.date || "",
    ).trim();

  if (
    /^\d{4}-\d{2}-\d{2}$/
      .test(explicit)
  ) {
    return explicit;
  }

  return todayTaipei();
}

function safeGameId(
  value: unknown,
) {
  const n =
    Number(value);

  return (
    Number.isFinite(n) &&
    n > 0
  )
    ? Math.trunc(n)
    : null;
}

async function callEdge(
  functionName: string,
  body: any,
) {
  const response =
    await fetch(
      `${SUPABASE_URL}/functions/v1/${functionName}`,
      {
        method:
          "POST",
        headers:
          getBackendHeaders(),
        body:
          JSON.stringify(
            body,
          ),
      },
    );

  const text =
    await response.text();

  let data:
    any = null;

  try {
    data =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    data = {
      raw:
        text,
    };
  }

  return {
    ok:
      response.ok,
    status:
      response.status,
    data,
  };
}

async function loadFixtures(
  date: string,
) {
  const result =
    await callEdge(
      "basketball-fixtures",
      {
        date,
        debug: false,
      },
    );

  if (
    !result.ok ||
    result.data?.success !==
      true
  ) {
    throw new Error(
      `BASKETBALL_FIXTURES_FAILED:${date}:${result.status}:${JSON.stringify(result.data)}`,
    );
  }

  const rows =
    Array.isArray(
      result.data?.fixtures,
    )
      ? result.data.fixtures
      : [];

  return {
    date,
    fixtures:
      rows,
    counts:
      result.data?.counts ||
      null,
    quota:
      result.data?.quota ||
      null,
    source: "live",
  };
}

/*
 * Safe NBA API quota optimization (Taipei date-aware):
 * NBA T-10 for a Taipei date cannot occur until 10h before that
 * date's midnight. Before that instant, a <=30-minute-old existing
 * fixture cache may be reused; otherwise ALWAYS fetch live.
 * This avoids trusting an empty/outdated cache inside any T-10 window.
 * For dry_run, ALWAYS fetch live to preserve test behavior.
 * DB failures, invalid cache, or old cache fall back to live.
 */
const NBA_EARLY_DATE_CACHE_MS = 30 * 60 * 1000;
const NBA_T10_BEFORE_MIDNIGHT_MS = 10 * 60 * 60 * 1000;

async function loadFixturesEconomically(
  date: string,
  nowMs: number,
  dryRun: boolean,
) {
  const dayStartMs = Date.parse(`${date}T00:00:00+08:00`);
  const beforeEarliestT10 =
    Number.isFinite(dayStartMs) &&
    nowMs < dayStartMs - NBA_T10_BEFORE_MIDNIGHT_MS;

  // At/after the first possible T-10 instant: no cache read, always live.
  if (!dryRun && beforeEarliestT10) {
    try {
      const { data, error } = await requireSupabaseAdmin()
        .from("basketball_fixture_cache")
        .select("fixture_date,fixtures,counts,quota,fetched_at,source")
        .eq("fixture_date", date)
        .maybeSingle();
      if (!error && data && Array.isArray(data.fixtures) &&
          String(data.source || "").startsWith("basketball-t10-job-")) {
        const ageMs = nowMs - Date.parse(data.fetched_at || "");
        if (Number.isFinite(ageMs) && ageMs >= 0 &&
            ageMs < NBA_EARLY_DATE_CACHE_MS) {
          return {
            date,
            fixtures: data.fixtures,
            counts: data.counts || null,
            quota: data.quota || null,
            source: "db_recent",
          };
        }
      }
    } catch (error) {
      console.warn("NBA_FIXTURE_CACHE_READ_FALLBACK", String(error));
    }
  }
  return await loadFixtures(date);
}

async function saveFixtureCache(
  rows: any[],
) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  const payload =
    rows.map((item: any) => ({
      fixture_date:
        item.date,
      fixtures:
        Array.isArray(item.fixtures)
          ? item.fixtures
          : [],
      total:
        Array.isArray(item.fixtures)
          ? item.fixtures.length
          : 0,
      counts:
        item.counts || null,
      quota:
        item.quota || null,
      fetched_at:
        new Date().toISOString(),
      source:
        "basketball-t10-job-v1.5-market",
    }));

  const {
    error,
  } =
    await requireSupabaseAdmin()
      .from(
        "basketball_fixture_cache",
      )
      .upsert(
        payload,
        {
          onConflict:
            "fixture_date",
        },
      );

  if (error) {
    throw error;
  }
}

async function readyCacheGameIds(
  gameIds: number[],
) {
  if (
    gameIds.length === 0
  ) {
    return new Set<number>();
  }

  const {
    data,
    error,
  } =
    await requireSupabaseAdmin()
      .from(
        "basketball_analysis_cache",
      )
      .select(
        "game_id,status",
      )
      .in(
        "game_id",
        gameIds,
      )
      .eq(
        "status",
        "ready",
      );

  if (error) {
    throw error;
  }

  return new Set<number>(
    (data || [])
      .map(
        (row: any) =>
          Number(
            row?.game_id,
          ),
      )
      .filter(
        (value: number) =>
          Number.isFinite(
            value,
          ) &&
          value > 0,
      ),
  );
}

async function officialSnapshotGameIds(
  gameIds: number[],
) {
  if (gameIds.length === 0) return new Set<number>();
  const { data, error } =
    await requireSupabaseAdmin()
      .from("basketball_prediction_snapshots")
      .select("game_id")
      .in("game_id", gameIds)
      .eq("source", "t10_auto");

  if (error) throw error;
  return new Set<number>(
    (data || [])
      .map((row: any) => Number(row?.game_id))
      .filter((value: number) => Number.isFinite(value) && value > 0),
  );
}

const T10_MS =
  10 * 60 * 60 * 1000;

const MAX_NEW_ANALYSES_PER_RUN =
  5;

Deno.serve(
  async (
    req: Request,
  ) => {
    if (
      req.method ===
      "OPTIONS"
    ) {
      return new Response(
        "ok",
        {
          headers:
            corsHeaders,
        },
      );
    }

    if (
      req.method !==
      "POST"
    ) {
      return json(
        {
          success: false,
          error:
            "POST only",
        },
        405,
      );
    }

    try {
      if (
        !SUPABASE_URL ||
        !SECRET_KEY ||
        !CRON_KEY
      ) {
        throw new Error(
          "SUPABASE_ADMIN_OR_CRON_ENV_MISSING",
        );
      }

      const body =
        await req
          .json()
          .catch(
            () => ({}),
          );

      const dryRun =
        body?.dry_run ===
        true;

      /*
        v1.1 起所有 POST 都必須通過專用 cron key
        或 Supabase backend secret 驗證。
        因此 Verify JWT 可以安全設為 OFF，
        避免排程依賴 legacy JWT。
      */
      if (
        !isAuthorizedRequest(
          req,
        )
      ) {
        return json(
          {
            success: false,
            error:
              "cron_authorization_required",
            message:
              "NBA T-10 任務驗證失敗",
          },
          403,
        );
      }

      const baseDate =
        normalizeBaseDate(
          body,
        );

      const scanDates =
        [
          baseDate,
          addDays(
            baseDate,
            1,
          ),
        ];

      const realNowMs =
        Date.now();

      /*
        simulate_now 只允許 dry_run。
        正式 system_auto 永遠使用真實目前時間，
        避免測試參數影響正式快取 / AI 寫入。
      */
      let nowMs =
        realNowMs;

      if (
        dryRun &&
        body?.simulate_now
      ) {
        const simulated =
          new Date(
            String(
              body.simulate_now,
            ),
          ).getTime();

        if (
          Number.isFinite(
            simulated,
          )
        ) {
          nowMs =
            simulated;
        }
      }

      const fixtureSettled = await Promise.allSettled(
        scanDates.map(date => loadFixturesEconomically(date, realNowMs, dryRun)),
      );
      const fixtureFailures = fixtureSettled.flatMap((item, index) =>
        item.status === "rejected"
          ? [{ date: scanDates[index], reason: String(item.reason).slice(0, 300) }]
          : [],
      );
      const fixtureResults = fixtureSettled.flatMap(item =>
        item.status === "fulfilled" ? [item.value] : [],
      );
      if (fixtureResults.length === 0) {
        throw new Error("BASKETBALL_FIXTURES_ALL_DATES_FAILED:" +
          JSON.stringify(fixtureFailures));
      }
      if (fixtureFailures.length > 0) {
        console.error("HABAO_NBA_T10_FIXTURE_PARTIAL_FAILURE", JSON.stringify(fixtureFailures));
      }

      if (!dryRun) {
        // Never refresh fetched_at for reused cached rows. Otherwise stale
        // data could be held indefinitely instead of falling back to live.
        await saveFixtureCache(fixtureResults.filter(item => item.source === "live"));
      }

      const nbaFixtures =
        fixtureResults
          .flatMap(
            item =>
              item.fixtures,
          )
          .filter(
            (fixture: any) =>
              String(
                fixture
                  ?.competition_key ||
                "",
              ) === "nba",
          );

      const deduped =
        Array.from(
          new Map(
            nbaFixtures
              .map(
                (
                  fixture:
                    any,
                ) => {
                  const gameId =
                    safeGameId(
                      fixture
                        ?.fixture_id,
                    );

                  return [
                    gameId,
                    fixture,
                  ] as [number | null, any];
                },
              )
              .filter(
                (
                  pair:
                    any[],
                ) =>
                  pair[0] !=
                  null,
              ),
          ).values(),
        );

      const classified =
        deduped.map(
          (
            fixture:
              any,
          ) => {
            const gameId =
              safeGameId(
                fixture
                  ?.fixture_id,
              )!;

            const kickoffMs =
              new Date(
                fixture
                  ?.kickoff_at ||
                "",
              ).getTime();

            const validKickoff =
              Number.isFinite(
                kickoffMs,
              );

            const msToKickoff =
              validKickoff
                ? kickoffMs -
                  nowMs
                : NaN;

            let state:
              string =
                "invalid_kickoff";

            if (
              validKickoff
            ) {
              if (
                msToKickoff <=
                0
              ) {
                state =
                  "started_or_past";
              } else if (
                msToKickoff <=
                T10_MS
              ) {
                state =
                  "eligible_t10";
              } else {
                state =
                  "before_t10";
              }
            }

            return {
              game_id:
                gameId,
              kickoff_at:
                fixture
                  ?.kickoff_at ||
                null,
              home:
                fixture
                  ?.home
                  ?.name ||
                null,
              away:
                fixture
                  ?.away
                  ?.name ||
                null,
              state,
              hours_to_kickoff:
                validKickoff
                  ? Math.round(
                      (
                        msToKickoff /
                        3600000
                      ) *
                        100,
                    ) /
                    100
                  : null,
            };
          },
        );

      const eligible =
        classified
          .filter(
            item =>
              item.state ===
              "eligible_t10",
          )
          .sort(
            (
              a,
              b,
            ) =>
              String(
                a.kickoff_at ||
                "",
              )
                .localeCompare(
                  String(
                    b.kickoff_at ||
                    "",
                  ),
                ),
          );

      const eligibleGameIds = eligible.map(item => item.game_id);
      const readyIds = await readyCacheGameIds(eligibleGameIds);
      const snapshotIds = await officialSnapshotGameIds(eligibleGameIds);

      // 唯一完整狀態：ready cache + t10_auto 正式快照皆存在。
      // 只有兩者都沒有的新賽事才由 Cron 進行首次分析。
      // 快取單邊缺失時只嘗試安全復原，禁止重跑已保存的正式版本。
      const inconsistent = eligible
        .filter(item =>
          readyIds.has(item.game_id) !== snapshotIds.has(item.game_id),
        )
        .map(item => ({
          ...item,
          issue: readyIds.has(item.game_id)
            ? "ready_cache_without_snapshot"
            : "snapshot_without_ready_cache",
        }));
      const missing = eligible.filter(item =>
        !readyIds.has(item.game_id) && !snapshotIds.has(item.game_id),
      );
      // ready cache 缺快照：後端會嘗試用原快取資料補寫，不重跑模型。
      const toRepair = inconsistent;
      /*
       * T-10 priority without increasing the API/AI per-run budget:
       * 1. Missing snapshot + game almost starts: last safe catch-up chance.
       * 2. Missing snapshot newly reaching T-10: avoid an avoidable 15m delay.
       * 3. Older missing snapshots: continue automatic catch-up.
       * 4. Partially saved snapshots: repair, never recompute saved picks.
       * Keep the existing MAX_NEW_ANALYSES_PER_RUN=5 unchanged.
       */
      const NEAR_KICKOFF_MS = 30 * 60 * 1000;
      const NEWLY_DUE_T10_MS = 15 * 60 * 1000;
      const kickoffLeftMs = (item: any) =>
        Date.parse(String(item.kickoff_at || "")) - nowMs;
      const nearKickoff = missing.filter(item =>
        kickoffLeftMs(item) <= NEAR_KICKOFF_MS,
      );
      const newlyDue = missing.filter(item => {
        const left = kickoffLeftMs(item);
        return left > NEAR_KICKOFF_MS &&
          (T10_MS - left) <= NEWLY_DUE_T10_MS;
      });
      const olderMissing = missing.filter(item => {
        const left = kickoffLeftMs(item);
        return left > NEAR_KICKOFF_MS &&
          (T10_MS - left) > NEWLY_DUE_T10_MS;
      });
      const selected = [
        ...nearKickoff, ...newlyDue, ...olderMissing, ...toRepair,
      ].slice(0, MAX_NEW_ANALYSES_PER_RUN);
      const selectedNewIds = new Set(
        selected.filter(item => !readyIds.has(item.game_id) &&
          !snapshotIds.has(item.game_id)).map(item => item.game_id),
      );
      const deferredNew = Math.max(0, missing.length - selectedNewIds.size);
      const deferredRepair = Math.max(0,
        toRepair.length - (selected.length - selectedNewIds.size));
      const alreadyComplete = eligible.length - missing.length - inconsistent.length;

      console.log("HABAO_NBA_T10_SCAN", JSON.stringify({
        base_date: baseDate,
        eligible: eligible.map(item => item.game_id),
        already_complete: alreadyComplete,
        would_analyze: selected.map(item => item.game_id),
        priority: {
          near_kickoff: nearKickoff.map(item => item.game_id),
          newly_due_t10: newlyDue.map(item => item.game_id),
          older_missing: olderMissing.map(item => item.game_id),
          deferred_new: deferredNew,
          deferred_repair: deferredRepair,
          cap: MAX_NEW_ANALYSES_PER_RUN,
        },
        inconsistent,
        dry_run: dryRun,
        fixture_failures: fixtureFailures,
      }));

      if (dryRun) {
        return json(
          {
            success: fixtureFailures.length === 0,
            mode:
              "dry_run",
            version:
              "habao-nba-t10-job-v1.5-market",
            taipei_base_date:
              baseDate,
            scanned_dates:
              scanDates,
            now:
              new Date(
                nowMs,
              ).toISOString(),
            simulated_now:
              nowMs !==
              realNowMs,
            t10_hours:
              10,
            max_new_analyses_per_run:
              MAX_NEW_ANALYSES_PER_RUN,
            counts: {
              fixtures_total:
                classified.length,
              eligible_t10:
                eligible.length,
              already_cached:
                alreadyComplete,
              missing_cache:
                missing.length,
              inconsistent_state:
                inconsistent.length,
              would_run_now:
                selected.length,
            },
            fixtures:
              classified,
            would_analyze:
              selected,
            inconsistent,
            fixture_failures: fixtureFailures,
            fixture_sources: fixtureResults.map(item => ({ date: item.date, source: item.source })),
            fixture_api:
              fixtureResults.map(
                item => ({
                  date:
                    item.date,
                  counts:
                    item.counts,
                  quota:
                    item.quota,
                }),
              ),
          },
          fixtureFailures.length === 0 ? 200 : 207,
        );
      }

      let marketContextRefresh:
        any = null;

      if (
        selected.length >
        0
      ) {
        try {
          marketContextRefresh =
            await callEdge(
              "basketball-market-context",
              {
                action:
                  "refresh",
              },
            );
        } catch (
          error
        ) {
          marketContextRefresh = {
            ok:
              false,
            status:
              0,
            data: {
              success:
                false,
              error:
                "market_context_refresh_exception",
              message:
                error instanceof
                  Error
                  ? error.message
                  : String(
                      error,
                    ),
            },
          };
        }
      }

      const completed:
        any[] = [];

      const failed:
        any[] = [];

      for (
        const item of
        selected
      ) {
        try {
          const analysisResult =
            await callEdge(
              "basketball-analysis",
              {
                game_id:
                  item.game_id,
                mode:
                  "system_auto",
                debug:
                  false,
              },
            );

          if (
            analysisResult.ok &&
            analysisResult.data?.success === true
          ) {
            // 分析成功不代表官方快照一定寫入成功。
            const persistedIds = await officialSnapshotGameIds([item.game_id]);
            if (!persistedIds.has(item.game_id)) {
              failed.push({
                game_id: item.game_id,
                error: "t10_snapshot_not_persisted",
                message: "分析快取可能存在，但正式快照未確認；停止自動補跑",
              });
              continue;
            }
            completed.push(
              {
                game_id:
                  item.game_id,
                home:
                  item.home,
                away:
                  item.away,
                kickoff_at:
                  item.kickoff_at,
                from_cache:
                  analysisResult
                    .data
                    ?.from_cache ===
                  true,
                cache:
                  analysisResult
                    .data
                    ?.cache ||
                  null,
                snapshot_created:
                  analysisResult
                    .data
                    ?.snapshot_created ??
                  null,
              },
            );
          } else {
            failed.push(
              {
                game_id:
                  item.game_id,
                status:
                  analysisResult
                    .status,
                error:
                  analysisResult
                    .data
                    ?.error ||
                  "analysis_failed",
                message:
                  analysisResult
                    .data
                    ?.message ||
                  null,
              },
            );
          }
        } catch (
          error
        ) {
          failed.push(
            {
              game_id:
                item.game_id,
              error:
                "analysis_exception",
              message:
                error instanceof
                  Error
                  ? error.message
                  : String(
                      error,
                    ),
            },
          );
        }
      }

      // 以實際 DB 最新狀態重新判定修復結果，而非依掃描前的異常表誤報。
      const afterReady=await readyCacheGameIds(eligibleGameIds);
      const afterSnapshot=await officialSnapshotGameIds(eligibleGameIds);
      const outstanding=eligible.filter(item =>
        afterReady.has(item.game_id)!==afterSnapshot.has(item.game_id));
      const unresolved=outstanding.map(item=>({...item,
        issue:afterReady.has(item.game_id)?"ready_cache_without_snapshot":"snapshot_without_ready_cache"}));

      console.log("HABAO_NBA_T10_RESULT", JSON.stringify({
        completed: completed.map(item => item.game_id),
        failed,
        inconsistent:unresolved,
        fixture_failures: fixtureFailures,
        deferred: deferredNew,
        deferred_repair: deferredRepair,
      }));

      return json(
        {
          success:
            failed.length === 0 && unresolved.length === 0 && fixtureFailures.length === 0,
          mode:
            "system_auto",
          version:
            "habao-nba-t10-job-v1.5-market",
          taipei_base_date:
            baseDate,
          scanned_dates:
            scanDates,
          now:
            new Date(
              nowMs,
            ).toISOString(),
          t10_hours:
            10,
          max_new_analyses_per_run:
            MAX_NEW_ANALYSES_PER_RUN,
          counts: {
            fixtures_total:
              classified.length,
            eligible_t10:
              eligible.length,
            already_cached:
              alreadyComplete,
            missing_cache:
              missing.length,
            inconsistent_state:
              unresolved.length,
            selected:
              selected.length,
            completed:
              completed.length,
            failed:
              failed.length,
            deferred: deferredNew,
            deferred_repair: deferredRepair,
          },
          completed,
          failed,
          inconsistent:unresolved,
          fixture_failures: fixtureFailures,
          fixture_sources: fixtureResults.map(item => ({ date: item.date, source: item.source })),
          fixture_api:
            fixtureResults.map(
              item => ({
                date:
                  item.date,
                counts:
                  item.counts,
                quota:
                  item.quota,
              }),
            ),
          market_context_refresh:
            marketContextRefresh
              ? {
                  ok:
                    marketContextRefresh
                      .ok ===
                    true,
                  status:
                    marketContextRefresh
                      .status,
                  data:
                    marketContextRefresh
                      .data ||
                    null,
                }
              : null,
        },
        failed.length === 0 && unresolved.length === 0 && fixtureFailures.length === 0
          ? 200
          : 207,
      );
    } catch (
      error
    ) {
      console.error(
        "BASKETBALL T10 JOB ERROR:",
        error,
      );

      return json(
        {
          success:
            false,
          error:
            "system_error",
          message:
            "NBA T-10 自動分析任務失敗",
          detail:
            error instanceof
              Error
              ? error.message
              : String(
                  error,
                ),
        },
        500,
      );
    }
  },
);
