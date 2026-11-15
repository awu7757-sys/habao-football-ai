import { createClient } from "npm:@supabase/supabase-js@2";

const VERSION = "habao-admin-basketball-v1.4-score-sync";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-session",
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

function getSupabaseSecretKey() {
  const direct =
    Deno.env.get("SUPABASE_SECRET_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (direct) return direct;

  const raw =
    Deno.env.get("SUPABASE_SECRET_KEYS");

  if (!raw) return "";

  try {
    const parsed =
      JSON.parse(raw);

    return String(
      parsed?.default ||
      Object.values(
        parsed || {},
      )[0] ||
      "",
    );
  } catch {
    return "";
  }
}

function getAdminSessionToken(
  req: Request,
  body: Record<string, any>,
) {
  const headerToken =
    String(
      req.headers.get(
        "x-admin-session",
      ) || "",
    ).trim();

  if (headerToken) {
    return headerToken;
  }

  return String(
    body?.session_token || "",
  ).trim();
}

async function sha256Hex(
  value: string,
) {
  const bytes =
    new TextEncoder()
      .encode(value);

  const digest =
    await crypto.subtle
      .digest(
        "SHA-256",
        bytes,
      );

  return Array.from(
    new Uint8Array(digest),
  )
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0"),
    )
    .join("");
}

function timingSafeEqualText(
  left: string,
  right: string,
) {
  const encoder =
    new TextEncoder();

  const a =
    encoder.encode(left);

  const b =
    encoder.encode(right);

  if (
    a.length !== b.length
  ) {
    return false;
  }

  let diff = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    diff |=
      a[i] ^ b[i];
  }

  return diff === 0;
}

function taipeiDate(
  offsetDays = 0,
) {
  const now =
    new Date(
      new Date()
        .toLocaleString(
          "en-US",
          {
            timeZone:
              "Asia/Taipei",
          },
        ),
    );

  now.setDate(
    now.getDate() +
    offsetDays,
  );

  return (
    now.getFullYear() +
    "-" +
    String(
      now.getMonth() + 1,
    ).padStart(2, "0") +
    "-" +
    String(
      now.getDate(),
    ).padStart(2, "0")
  );
}

async function authorizeAdmin(
  req: Request,
  body: Record<string, any>,
  supabase: any,
  adminPassword: string,
  requiredPermission:
    string,
) {
  const sessionToken =
    getAdminSessionToken(
      req,
      body,
    );

  if (sessionToken) {
    const tokenHash =
      await sha256Hex(
        sessionToken,
      );

    const now =
      new Date()
        .toISOString();

    const {
      data: session,
      error: sessionError,
    } =
      await supabase
        .from(
          "admin_sessions",
        )
        .select(
          "id,admin_user_id,is_super_admin,expires_at,revoked_at",
        )
        .eq(
          "token_hash",
          tokenHash,
        )
        .is(
          "revoked_at",
          null,
        )
        .gt(
          "expires_at",
          now,
        )
        .maybeSingle();

    if (
      !sessionError &&
      session
    ) {
      if (
        session
          .is_super_admin ===
        true
      ) {
        try {
          await supabase
            .from(
              "admin_sessions",
            )
            .update({
              last_seen_at:
                now,
            })
            .eq(
              "id",
              session.id,
            );
        } catch {}

        return {
          ok: true,
          context: {
            is_super_admin:
              true,
            permissions: [
              "*",
            ],
          },
        };
      }

      const userId =
        Number(
          session
            .admin_user_id ||
          0,
        );

      if (userId) {
        const {
          data: adminUser,
          error: userError,
        } =
          await supabase
            .from(
              "admin_users",
            )
            .select(
              "id,permissions,is_active",
            )
            .eq(
              "id",
              userId,
            )
            .maybeSingle();

        if (
          !userError &&
          adminUser &&
          adminUser
            .is_active ===
            true
        ) {
          const permissions =
            Array.isArray(
              adminUser
                .permissions,
            )
              ? adminUser
                  .permissions
                  .map(
                    (
                      item:
                        unknown,
                    ) =>
                      String(
                        item,
                      ),
                  )
              : [];

          if (
            requiredPermission &&
            !permissions.includes(
              requiredPermission,
            )
          ) {
            return {
              ok: false,
              response: json(
                {
                  success:
                    false,
                  error:
                    "permission_denied",
                  message:
                    "此管理員沒有這項功能權限",
                },
                403,
              ),
            };
          }

          try {
            await supabase
              .from(
                "admin_sessions",
              )
              .update({
                last_seen_at:
                  now,
              })
              .eq(
                "id",
                session.id,
              );
          } catch {}

          return {
            ok: true,
            context: {
              is_super_admin:
                false,
              permissions,
            },
          };
        }
      }
    }
  }

  /*
    舊版相容：
    若仍使用原始 ADMIN_PASSWORD，
    視為 Super Admin。
  */
  const legacyPassword =
    String(
      body?.admin_password ||
      "",
    );

  const legacyFallbackEnabled =
    String(
      Deno.env.get(
        "ADMIN_LEGACY_PASSWORD_FALLBACK",
      ) || "true",
    ).toLowerCase() !==
    "false";

  if (
    legacyFallbackEnabled &&
    legacyPassword &&
    adminPassword &&
    timingSafeEqualText(
      legacyPassword,
      adminPassword,
    )
  ) {
    return {
      ok: true,
      context: {
        is_super_admin:
          true,
        permissions: [
          "*",
        ],
      },
    };
  }

  return {
    ok: false,
    response: json(
      {
        success:
          false,
        error:
          "unauthorized",
        message:
          "管理員登入已失效，請重新登入",
      },
      401,
    ),
  };
}

function permissionForAction(
  action: string,
) {
  const map:
    Record<
      string,
      string
    > = {
      overview:
        "dashboard",
      analysis_history:
        "analysis_logs",
      fixtures:
        "fixtures",
      refresh_fixtures:
        "fixtures",
      sync_fixture_scores:
        "fixtures",
      toggle_live_push:
        "fixtures",
      api_usage:
        "api",
      confirm_odds_renewal:
        "api",
    };

  return (
    map[action] || ""
  );
}

function backendHeaders(
  secretKey: string,
) {
  const headers:
    Record<
      string,
      string
    > = {
      "Content-Type":
        "application/json",
      apikey:
        secretKey,
    };

  if (
    !secretKey.startsWith(
      "sb_secret_",
    )
  ) {
    headers.Authorization =
      `Bearer ${secretKey}`;
  }

  return headers;
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

function addOneMonthDate(
  yyyyMmDd: string,
) {
  const match =
    String(yyyyMmDd || "")
      .match(
        /^(\d{4})-(\d{2})-(\d{2})$/,
      );

  if (!match) {
    return taipeiDate(30);
  }

  const year =
    Number(match[1]);

  const month =
    Number(match[2]);

  const day =
    Number(match[3]);

  const target =
    new Date(
      Date.UTC(
        year,
        month,
        1,
        12,
      ),
    );

  const lastDay =
    new Date(
      Date.UTC(
        target.getUTCFullYear(),
        target.getUTCMonth() + 1,
        0,
        12,
      ),
    )
      .getUTCDate();

  target.setUTCDate(
    Math.min(
      day,
      lastDay,
    ),
  );

  return [
    target.getUTCFullYear(),
    String(
      target.getUTCMonth() + 1,
    ).padStart(2, "0"),
    String(
      target.getUTCDate(),
    ).padStart(2, "0"),
  ].join("-");
}

function numberOrNull(
  value: unknown,
) {
  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

async function getApiUsagePayload(
  supabase: any,
) {
  const today =
    taipeiDate(0);

  const sevenDaysAgo =
    taipeiDate(-6);

  const [
    settingsResult,
    oddsResult,
  ] =
    await Promise.all([
      supabase
        .from(
          "site_settings",
        )
        .select(
          "id,nba_api_plan,nba_api_daily_limit,nba_api_start_date,nba_api_renewal_date,odds_api_plan,odds_api_monthly_limit,odds_api_start_date,odds_api_renewal_date",
        )
        .eq(
          "id",
          1,
        )
        .maybeSingle(),

      supabase
        .from(
          "basketball_external_feed_cache",
        )
        .select(
          "source_key,provider,payload,meta,fetched_at,last_error",
        )
        .eq(
          "source_key",
          "odds_current",
        )
        .maybeSingle(),
    ]);

  if (
    settingsResult.error
  ) {
    throw settingsResult.error;
  }

  if (
    oddsResult.error
  ) {
    throw oddsResult.error;
  }

  const settings =
    settingsResult.data ||
    {};

  const configuredNbaLimit =
    Math.max(
      1,
      Number(
        settings
          ?.nba_api_daily_limit ||
        7500,
      ),
    );

  /*
   * API-NBA quota must come from the provider's /status endpoint.
   * Do NOT infer daily usage from basketball_fixture_cache.quota.
   * A stale/missing response header can be "0" and would falsely show
   * 7,500 / 7,500 used.
   *
   * API-SPORTS documents /status as the account usage source and says
   * the status call itself does not count against daily quota.
   */
  const nbaApiKey =
    String(
      Deno.env.get(
        "API_FOOTBALL_KEY",
      ) || "",
    ).trim();

  let nbaUsed:
    number | null =
      null;

  let nbaRemaining:
    number | null =
      null;

  let nbaLimit =
    configuredNbaLimit;

  let nbaPlan =
    String(
      settings
        ?.nba_api_plan ||
      "PRO",
    );

  let nbaStatusFetchedAt:
    string | null =
      null;

  let nbaStatusError:
    string | null =
      null;

  if (nbaApiKey) {
    try {
      const statusResponse =
        await fetch(
          "https://v2.nba.api-sports.io/status",
          {
            method:
              "GET",
            headers: {
              "x-apisports-key":
                nbaApiKey,
            },
          },
        );

      const statusText =
        await statusResponse
          .text();

      let statusBody:
        any = null;

      try {
        statusBody =
          statusText
            ? JSON.parse(
                statusText,
              )
            : null;
      } catch {
        statusBody =
          null;
      }

      if (
        !statusResponse.ok
      ) {
        throw new Error(
          `API-NBA status HTTP ${statusResponse.status}`,
        );
      }

      const providerResponse =
        Array.isArray(
          statusBody
            ?.response,
        )
          ? statusBody
              .response[0]
          : statusBody
              ?.response;

      const requests =
        providerResponse
          ?.requests ||
        null;

      const current =
        numberOrNull(
          requests
            ?.current,
        );

      const limitDay =
        numberOrNull(
          requests
            ?.limit_day ??
          requests
            ?.limit,
        );

      if (
        current === null ||
        limitDay === null ||
        limitDay <= 0
      ) {
        throw new Error(
          "API-NBA status missing requests.current / requests.limit_day",
        );
      }

      nbaUsed =
        Math.max(
          0,
          current,
        );

      nbaLimit =
        Math.max(
          1,
          limitDay,
        );

      nbaRemaining =
        Math.max(
          0,
          nbaLimit -
          nbaUsed,
        );

      nbaPlan =
        String(
          providerResponse
            ?.subscription
            ?.plan ||
          nbaPlan,
        );

      nbaStatusFetchedAt =
        new Date()
          .toISOString();

      const {
        error:
          usageUpsertError,
      } =
        await supabase
          .from(
            "basketball_api_usage_daily",
          )
          .upsert(
            {
              usage_date:
                today,
              used_count:
                nbaUsed,
              remaining_count:
                nbaRemaining,
              daily_limit:
                nbaLimit,
              source_fetched_at:
                nbaStatusFetchedAt,
              updated_at:
                nbaStatusFetchedAt,
            },
            {
              onConflict:
                "usage_date",
            },
          );

      if (
        usageUpsertError
      ) {
        console.warn(
          "NBA API USAGE UPSERT ERROR",
          usageUpsertError,
        );
      }

    } catch (
      error
    ) {
      nbaStatusError =
        error instanceof
          Error
          ? error.message
          : String(error);

      /*
       * Never turn an unavailable status call into a fake 0 or 7500.
       * Admin UI will show "—" until a valid provider status is available.
       */
      nbaUsed =
        null;

      nbaRemaining =
        null;
    }
  } else {
    nbaStatusError =
      "API_FOOTBALL_KEY missing";
  }

  const {
    data:
      nbaDays,
    error:
      nbaDaysError,
  } =
    await supabase
      .from(
        "basketball_api_usage_daily",
      )
      .select(
        "usage_date,used_count,remaining_count,daily_limit,source_fetched_at,updated_at",
      )
      .gte(
        "usage_date",
        sevenDaysAgo,
      )
      .lte(
        "usage_date",
        today,
      )
      .order(
        "usage_date",
        {
          ascending:
            false,
        },
      );

  if (
    nbaDaysError
  ) {
    throw nbaDaysError;
  }

  /*
   * Ignore a previously written false "7500 / 7500" row if the current
   * provider status request is unavailable. Once /status succeeds, today's
   * row is overwritten with the real value.
   */
  const nbaUsageDays =
    (nbaDays || [])
      .filter(
        (row: any) => {
          if (
            String(
              row
                ?.usage_date ||
              "",
            ) !== today
          ) {
            return true;
          }

          if (
            nbaUsed ===
            null
          ) {
            return false;
          }

          return true;
        },
      );

  const nbaAverage =
    nbaUsageDays.length
      ? Math.ceil(
          nbaUsageDays.reduce(
            (
              sum:
                number,
              row:
                any,
            ) =>
              sum +
              Number(
                row
                  ?.used_count ||
                0,
              ),
            0,
          ) /
          nbaUsageDays.length,
        )
      : null;

  const oddsRow =
    oddsResult.data ||
    {};

  const oddsMeta =
    oddsRow
      ?.meta ||
    {};

  const oddsLimit =
    Math.max(
      1,
      Number(
        settings
          ?.odds_api_monthly_limit ||
        20000,
      ),
    );

  const oddsUsed =
    numberOrNull(
      oddsMeta
        ?.used,
    );

  const oddsRemaining =
    numberOrNull(
      oddsMeta
        ?.remaining,
    );

  const oddsLastCost =
    numberOrNull(
      oddsMeta
        ?.last_cost,
    );

  const oddsEvents =
    Array.isArray(
      oddsRow
        ?.payload
        ?.events,
    )
      ? oddsRow
          .payload
          .events
          .length
      : 0;

  return {
    success:
      true,
    version:
      VERSION,
    nba: {
      plan:
        nbaPlan,
      daily_limit:
        nbaLimit,
      used:
        nbaUsed,
      remaining:
        nbaRemaining,
      average_7d:
        nbaAverage,
      start_date:
        settings
          ?.nba_api_start_date ||
        null,
      renewal_date:
        settings
          ?.nba_api_renewal_date ||
        null,
      last_provider_snapshot:
        nbaStatusFetchedAt,
      status_source:
        "api-nba-status",
      status_error:
        nbaStatusError,
      days:
        nbaUsageDays,
    },
    odds: {
      plan:
        String(
          settings
            ?.odds_api_plan ||
          "20K",
        ),
      monthly_limit:
        oddsLimit,
      used:
        oddsUsed,
      remaining:
        oddsRemaining,
      last_cost:
        oddsLastCost,
      events:
        oddsEvents,
      start_date:
        settings
          ?.odds_api_start_date ||
        null,
      renewal_date:
        settings
          ?.odds_api_renewal_date ||
        null,
      fetched_at:
        oddsRow
          ?.fetched_at ||
        null,
      last_error:
        oddsRow
          ?.last_error ||
        null,
    },
  };
}

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
          success:
            false,
          error:
            "method_not_allowed",
        },
        405,
      );
    }

    try {
      const SUPABASE_URL =
        Deno.env.get(
          "SUPABASE_URL",
        );

      const SECRET_KEY =
        getSupabaseSecretKey();

      const ADMIN_PASSWORD =
        String(
          Deno.env.get(
            "ADMIN_PASSWORD",
          ) || "",
        );

      if (
        !SUPABASE_URL ||
        !SECRET_KEY ||
        !ADMIN_PASSWORD
      ) {
        return json(
          {
            success:
              false,
            error:
              "server_config_error",
            message:
              "系統設定異常",
          },
          500,
        );
      }

      const body =
        await req
          .json()
          .catch(
            () => ({}),
          );

      const action =
        String(
          body?.action ||
          "",
        ).trim();

      const supabase =
        createClient(
          SUPABASE_URL,
          SECRET_KEY,
          {
            auth: {
              persistSession:
                false,
              autoRefreshToken:
                false,
            },
          },
        );

      const permission =
        permissionForAction(
          action,
        );

      const auth =
        await authorizeAdmin(
          req,
          body,
          supabase,
          ADMIN_PASSWORD,
          permission,
        );

      if (
        "response" in auth
      ) {
        return auth.response;
      }

      if (
        action ===
        "overview"
      ) {
        const today =
          taipeiDate(0);

        const tomorrow =
          taipeiDate(1);

        const [
          todayUsage,
          todayMemberViews,
          readyCaches,
          snapshots,
          fixtureCaches,
        ] =
          await Promise.all([
            supabase
              .from(
                "basketball_analysis_usage",
              )
              .select(
                "*",
                {
                  count:
                    "exact",
                  head:
                    true,
                },
              )
              .eq(
                "usage_date",
                today,
              ),

            supabase
              .from(
                "member_basketball_analysis_history",
              )
              .select(
                "*",
                {
                  count:
                    "exact",
                  head:
                    true,
                },
              )
              .gte(
                "created_at",
                `${today}T00:00:00+08:00`,
              )
              .lt(
                "created_at",
                `${tomorrow}T00:00:00+08:00`,
              )
              .not(
                "result_data",
                "is",
                null,
              ),

            supabase
              .from(
                "basketball_analysis_cache",
              )
              .select(
                "*",
                {
                  count:
                    "exact",
                  head:
                    true,
                },
              )
              .eq(
                "status",
                "ready",
              ),

            supabase
              .from(
                "basketball_prediction_snapshots",
              )
              .select(
                "*",
                {
                  count:
                    "exact",
                  head:
                    true,
                },
              ),

            supabase
              .from(
                "basketball_fixture_cache",
              )
              .select(
                "fixture_date,total,fetched_at",
              )
              .in(
                "fixture_date",
                [
                  today,
                  tomorrow,
                ],
              ),
          ]);

        const fixtureRows =
          fixtureCaches
            .data || [];

        const todayFixture =
          fixtureRows.find(
            (
              row: any,
            ) =>
              String(
                row
                  ?.fixture_date ||
                "",
              ) ===
              today,
          );

        const tomorrowFixture =
          fixtureRows.find(
            (
              row: any,
            ) =>
              String(
                row
                  ?.fixture_date ||
                "",
              ) ===
              tomorrow,
          );

        return json({
          success:
            true,
          overview: {
            today,
            tomorrow,
            today_analysis_usage:
              todayUsage
                .count || 0,
            today_member_views:
              todayMemberViews
                .count || 0,
            ready_cache_count:
              readyCaches
                .count || 0,
            snapshot_count:
              snapshots
                .count || 0,
            today_fixtures:
              Number(
                todayFixture
                  ?.total ||
                0,
              ),
            tomorrow_fixtures:
              Number(
                tomorrowFixture
                  ?.total ||
                0,
              ),
            today_fetched_at:
              todayFixture
                ?.fetched_at ||
              null,
            tomorrow_fetched_at:
              tomorrowFixture
                ?.fetched_at ||
              null,
          },
        });
      }

      if (
        action ===
        "api_usage"
      ) {
        const payload =
          await getApiUsagePayload(
            supabase,
          );

        return json(
          payload,
          200,
        );
      }

      if (
        action ===
        "confirm_odds_renewal"
      ) {
        const today =
          taipeiDate(0);

        const renewalDate =
          addOneMonthDate(
            today,
          );

        const {
          data,
          error,
        } =
          await supabase
            .from(
              "site_settings",
            )
            .update({
              odds_api_renewal_date:
                renewalDate,
              updated_at:
                new Date()
                  .toISOString(),
            })
            .eq(
              "id",
              1,
            )
            .select(
              "odds_api_plan,odds_api_monthly_limit,odds_api_start_date,odds_api_renewal_date",
            )
            .single();

        if (error) {
          throw error;
        }

        return json({
          success:
            true,
          version:
            VERSION,
          settings:
            data,
          message:
            "The Odds API 續費日期已更新",
        });
      }

      if (
        action ===
        "analysis_history"
      ) {
        const limit =
          Math.min(
            Math.max(
              Number(
                body?.limit ||
                400,
              ),
              1,
            ),
            500,
          );

        const sevenDaysAgo =
          new Date(
            Date.now() -
            7 *
              24 *
              60 *
              60 *
              1000,
          ).toISOString();

        const {
          data,
          error,
        } =
          await supabase
            .from(
              "member_basketball_analysis_history",
            )
            .select("*")
            .gte(
              "updated_at",
              sevenDaysAgo,
            )
            .not(
              "result_data",
              "is",
              null,
            )
            .order(
              "updated_at",
              {
                ascending:
                  false,
              },
            )
            .limit(limit);

        if (error) {
          throw error;
        }

        // 與足球 admin-center 一致：會員紀錄 + 首次正式 T-10 系統快照。
        // 只能在本函式既有管理員權限通過後執行，不開放匿名查詢。
        const { data: officialRows, error: officialError } =
          await supabase
            .from("basketball_prediction_snapshots")
            .select("*")
            .order("generated_at", { ascending: false })
            .limit(500);
        if (officialError) throw officialError;

        const memberRecords = (data || []).map((row: any) => ({
          ...row,
          sport: "basketball",
          fixture_id: row.game_id,
          admin_key: `basketball:${row.id}`,
        }));
        const systemRecords = (officialRows || [])
          .filter((row: any) => row?.prediction_data != null)
          .map((row: any) => {
            const savedAt = row?.generated_at || row?.created_at || null;
            const savedMs = savedAt ? new Date(savedAt).getTime() : NaN;
            return {
              id: `SYSTEM_AUTO_NBA_${row.game_id}`,
              admin_key: `basketball:SYSTEM_AUTO_${row.game_id}`,
              account: "SYSTEM_AUTO｜系統自動分析",
              sport: "basketball",
              record_source: "system_auto",
              fixture_id: row.game_id,
              game_id: row.game_id,
              fixture_time: row.fixture_time || null,
              home_team: row.home_team || "—",
              away_team: row.away_team || "—",
              league_name: "NBA",
              match_status: "NS",
              updated_at: savedAt,
              created_at: savedAt,
              result_data: row.prediction_data,
              snapshot_generated_at: savedAt,
              snapshot_source: row.source || "t10_auto",
              _sort_ms: savedMs,
            };
          })
          .filter((row: any) =>
            Number.isFinite(row._sort_ms) && row._sort_ms >= Date.now() - 7 * 86400000
          );
        const records = [...memberRecords, ...systemRecords]
          .sort((a: any,b: any) =>
            new Date(b?.updated_at || 0).getTime() - new Date(a?.updated_at || 0).getTime()
          )
          .slice(0,limit)
          .map(({_sort_ms,...row}: any) => row);

        return json({
          success:
            true,
          records,
        });
      }

      if (
        action ===
        "fixtures"
      ) {
        const today =
          taipeiDate(0);

        const tomorrow =
          taipeiDate(1);

        const {
          data:
            fixtureCacheRows,
          error:
            fixtureCacheError,
        } =
          await supabase
            .from(
              "basketball_fixture_cache",
            )
            .select("*")
            .in(
              "fixture_date",
              [
                today,
                tomorrow,
              ],
            )
            .order(
              "fixture_date",
              {
                ascending:
                  true,
              },
            );

        if (
          fixtureCacheError
        ) {
          throw fixtureCacheError;
        }

        const fixtures =
          (
            fixtureCacheRows ||
            []
          )
            .flatMap(
              (
                cache:
                  any,
              ) => {
                const list =
                  Array.isArray(
                    cache
                      ?.fixtures,
                  )
                    ? cache
                        .fixtures
                    : [];

                return list.map(
                  (
                    fixture:
                      any,
                  ) => ({
                    ...fixture,
                    fixture_date:
                      cache
                        .fixture_date,
                    fixture_fetched_at:
                      cache
                        .fetched_at,
                  }),
                );
              },
            )
            .filter(
              (
                fixture:
                  any,
              ) =>
                String(
                  fixture
                    ?.competition_key ||
                  "",
                ) ===
                "nba",
            );

        const livePushFeatureReady = Deno.env.get("HABAO_SPORT_PUSH_ENABLED") === "true";
        const {data:pushTargets,error:pushTargetError} = await supabase
          .from("habao_sport_push_targets").select("game_id,enabled")
          .eq("sport","basketball");
        // Missing push targets must never be mistaken for a working monitor.
        const livePushReady = livePushFeatureReady && !pushTargetError;
        const pushTargetMap = new Map<number,boolean>((pushTargets || [])
          .map((x:any)=>[Number(x.game_id),x.enabled===true]));

        const gameIds =
          fixtures
            .map(
              (
                fixture:
                  any,
              ) =>
                safeGameId(
                  fixture
                    ?.fixture_id,
                ),
            )
            .filter(
              (
                value:
                  number | null,
              ):
                value is number =>
                  value !==
                  null,
            );

        let cacheRows:
          any[] = [];

        let snapshotRows:
          any[] = [];

        let historyRows:
          any[] = [];

        if (
          gameIds.length
        ) {
          const [
            caches,
            snapshots,
            histories,
          ] =
            await Promise.all([
              supabase
                .from(
                  "basketball_analysis_cache",
                )
                .select(
                  "game_id,status,generated_at,model_version,source",
                )
                .in(
                  "game_id",
                  gameIds,
                ),

              supabase
                .from(
                  "basketball_prediction_snapshots",
                )
                .select(
                  "game_id,generated_at,model_version,source",
                )
                .in(
                  "game_id",
                  gameIds,
                ),

              supabase
                .from(
                  "member_basketball_analysis_history",
                )
                .select(
                  "game_id,account,result_data,created_at",
                )
                .in(
                  "game_id",
                  gameIds,
                )
                .not(
                  "result_data",
                  "is",
                  null,
                ),
            ]);

          if (
            caches.error
          ) {
            throw caches
              .error;
          }

          if (
            snapshots
              .error
          ) {
            throw snapshots
              .error;
          }

          if (
            histories.error
          ) {
            throw histories
              .error;
          }

          cacheRows =
            caches.data ||
            [];

          snapshotRows =
            snapshots.data ||
            [];

          historyRows =
            histories.data ||
            [];
        }

        const cacheById =
          new Map(
            cacheRows.map(
              (
                row:
                  any,
              ) => [
                Number(
                  row
                    .game_id,
                ),
                row,
              ],
            ),
          );

        const snapshotById =
          new Map(
            snapshotRows.map(
              (
                row:
                  any,
              ) => [
                Number(
                  row
                    .game_id,
                ),
                row,
              ],
            ),
          );

        const membersById =
          new Map<
            number,
            Set<string>
          >();

        for (
          const row of
          historyRows
        ) {
          const gameId =
            Number(
              row
                ?.game_id ||
              0,
            );

          if (!gameId) {
            continue;
          }

          if (
            !membersById.has(
              gameId,
            )
          ) {
            membersById.set(
              gameId,
              new Set(),
            );
          }

          const account =
            String(
              row?.account ||
              "",
            ).trim();

          if (account) {
            membersById
              .get(gameId)!
              .add(
                account,
              );
          }
        }

        // NBA 可推播會員：同場取得正式分析、仍啟用、且有推播訂閱。
        // 不查詢或揭露裝置地址，僅回傳可推播的會員數量。
        // 若來源錯誤則回傳 null，而非假裝有 0 位可推播會員。
        let pushableAccounts: Set<string> | null = new Set<string>();
        const relatedAccounts = Array.from(new Set(
          historyRows
            .map((row: any) => String(row?.account || "").trim())
            .filter(Boolean),
        ));
        try {
          for (let i = 0; i < relatedAccounts.length; i += 80) {
            const batch = relatedAccounts.slice(i, i + 80);
            const [memberQuery, subscriptionQuery] = await Promise.all([
              supabase.from("members")
                .select("account,is_active")
                .in("account", batch),
              supabase.from("push_subscriptions")
                .select("member_username")
                .in("member_username", batch),
            ]);
            if (memberQuery.error || subscriptionQuery.error) {
              throw memberQuery.error || subscriptionQuery.error;
            }
            const subscribed = new Set(
              (subscriptionQuery.data || []).map((v: any) =>
                String(v?.member_username || "").trim(),
              ),
            );
            for (const member of (memberQuery.data || [])) {
              const account = String(member?.account || "").trim();
              if (member?.is_active === true && subscribed.has(account)) {
                pushableAccounts!.add(account);
              }
            }
          }
        } catch (err) {
          console.warn("NBA PUSH ELIGIBILITY LOOKUP FAILED", err);
          pushableAccounts = null;
        }

        const rows =
          fixtures.map(
            (
              fixture:
                any,
            ) => {
              const gameId =
                safeGameId(
                  fixture
                    ?.fixture_id,
                ) ||
                0;

              const cache =
                cacheById.get(
                  gameId,
                );

              const snapshot =
                snapshotById.get(
                  gameId,
                );

              return {
                ...fixture,
                analysis_cache:
                  cache
                    ? {
                        ready:
                          String(
                            cache
                              ?.status ||
                            "",
                          ) ===
                          "ready",
                        status:
                          cache
                            ?.status ||
                          null,
                        generated_at:
                          cache
                            ?.generated_at ||
                          null,
                        model_version:
                          cache
                            ?.model_version ||
                          null,
                        source:
                          cache
                            ?.source ||
                          null,
                      }
                    : null,
                snapshot:
                  snapshot
                    ? {
                        exists:
                          true,
                        generated_at:
                          snapshot
                            ?.generated_at ||
                          null,
                        model_version:
                          snapshot
                            ?.model_version ||
                          null,
                        source:
                          snapshot
                            ?.source ||
                          null,
                      }
                    : {
                        exists:
                          false,
                      },
                analysis_member_count:
                  membersById
                    .get(
                      gameId,
                    )
                    ?.size ||
                  0,
                push_member_count: pushableAccounts === null
                  ? null
                  : Array.from(membersById.get(gameId) || [])
                    .filter((account) => pushableAccounts!.has(account)).length,
                live_push_enabled: livePushReady && pushTargetMap.get(gameId) === true,
                live_push_ready: livePushReady,
              };
            },
          );

        return json({
          success:
            true,
          dates: {
            today,
            tomorrow,
          },
          caches:
            fixtureCacheRows ||
            [],
          fixtures:
            rows,
          stats: {
            today:
              rows.filter(
                (
                  row:
                    any,
                ) =>
                  String(
                    row
                      ?.fixture_date ||
                    "",
                  ) ===
                  today,
              ).length,
            tomorrow:
              rows.filter(
                (
                  row:
                    any,
                ) =>
                  String(
                    row
                      ?.fixture_date ||
                    "",
                  ) ===
                  tomorrow,
              ).length,
            ready_cache:
              rows.filter(
                (
                  row:
                    any,
                ) =>
                  row
                    ?.analysis_cache
                    ?.ready ===
                  true,
              ).length,
            snapshots:
              rows.filter(
                (
                  row:
                    any,
                ) =>
                  row
                    ?.snapshot
                    ?.exists ===
                  true,
              ).length,
            member_views:
              rows.reduce(
                (
                  sum:
                    number,
                  row:
                    any,
                ) =>
                  sum +
                  Number(
                    row
                      ?.analysis_member_count ||
                    0,
                  ),
                0,
              ),
          },
        });
      }

      // One NBA game push target; NEVER touches football live_score_push_targets.
      if (action === "toggle_live_push") {
        if (Deno.env.get("HABAO_SPORT_PUSH_ENABLED") !== "true")
          return json({success:false,error:"sport_score_push_not_enabled"},503);
        const gameId = safeGameId(body?.game_id);
        if (!gameId || typeof body?.enabled !== "boolean")
          return json({success:false,error:"invalid_game_id_or_enabled"},400);
        const enabled = body.enabled === true;
        const dates = [taipeiDate(0),taipeiDate(1)];
        const {data:caches,error:cacheErr}=await supabase
          .from("basketball_fixture_cache").select("fixture_date,fixtures")
          .in("fixture_date",dates);
        if(cacheErr)throw cacheErr;
        const candidates=(caches||[]).flatMap((cache:any)=>
          (Array.isArray(cache.fixtures)?cache.fixtures:[]).map((game:any)=>
            ({...game,fixture_date:cache.fixture_date})));
        const fixture=candidates.find((x:any)=>Number(x.fixture_id)===gameId && x.competition_key==="nba");
        if(!fixture)return json({success:false,error:"game_not_in_official_cache"},404);
        const kickoff=new Date(fixture.kickoff_at||"");
        if(Number.isNaN(kickoff.getTime()))return json({success:false,error:"invalid_kickoff"},400);
        if(enabled){
          const st=String(fixture.status?.long||"").toLowerCase();
          if(String(fixture.status?.short||"")==="3" || /final|finished/.test(st)
              || Date.now()>kickoff.getTime()+7*3600000)
            return json({success:false,error:"game_already_finished"},409);
        }
        const {error:targetErr}=await supabase.from("habao_sport_push_targets")
          .upsert({sport:"basketball",game_id:gameId,enabled,
            game_date:fixture.fixture_date,kickoff_at:kickoff.toISOString(),
            league_name:"NBA",home_team:fixture.home?.name||null,
            away_team:fixture.away?.name||null,enabled_by:"habao_admin",
            updated_at:new Date().toISOString()},
            {onConflict:"sport,game_id"});
        if(targetErr)throw targetErr;
        // Re-enabling always starts a fresh baseline and cannot replay old scores.
        const {error:resetErr}=await supabase.from("habao_sport_push_state")
          .delete().eq("sport","basketball").eq("game_id",gameId);
        if(resetErr)throw resetErr;
        return json({success:true,sport:"basketball",game_id:gameId,enabled,
          note:"Only monitors future score changes, initial baseline sends no notification"});
      }

      // HABAO Admin: explicit, permission-protected NBA scoreboard refresh.
      // This only touches basketball_fixture_cache JSON (schedule + scores).
      // No AI calculation, member credit, or prediction snapshot is modified.
      if (action === "sync_fixture_scores") {
        const offset = Number(body?.offset);
        if (![0, 1].includes(offset))
          return json({success:false,error:"invalid_offset"},400);
        const day = taipeiDate(offset);
        const existing = await supabase
          .from("basketball_fixture_cache")
          .select("fixture_date,fixtures,total,counts,quota,fetched_at,source")
          .eq("fixture_date",day).maybeSingle();
        if (existing.error) throw existing.error;

        const response = await fetch(
          `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/basketball-fixtures`, {
            method:"POST", headers:backendHeaders(SECRET_KEY),
            body:JSON.stringify({date:day,debug:false}),
            signal:AbortSignal.timeout(45000),
          },
        );
        const fresh=await response.json().catch(()=>null);
        if (!response.ok || fresh?.success!==true || !Array.isArray(fresh.fixtures))
          return json({success:false,error:"nba_score_provider_unavailable",
            http_status:response.status,details:fresh?.error||null},502);

        const oldRows = Array.isArray(existing.data?.fixtures)
          ? existing.data.fixtures : [];
        const incoming = fresh.fixtures.filter((x:any)=>
          String(x?.competition_key||"")==="nba" &&
          Number.isSafeInteger(Number(x?.fixture_id)) && Number(x.fixture_id)>0);
        const oldNba=oldRows.filter((x:any)=>String(x?.competition_key||"")==="nba");
        if (oldNba.length>0 && incoming.length===0)
          return json({success:false,error:"nba_score_provider_empty",
            message:"來源無 NBA 賽事，保留舊快取不覆蓋"},502);

        const freshById=new Map<number,any>(incoming.map((x:any)=>[Number(x.fixture_id),x]));
        const goodScore=(x:any):number|null=>{
          if(x===null||x===undefined||x==="")return null;
          const n=Number(x);return Number.isInteger(n)&&n>=0?n:null;
        };
        const mergeRow=(old:any,newer:any)=>{
          if(!newer)return old;
          const h=goodScore(newer?.home_score),a=goodScore(newer?.away_score);
          const status=String(newer?.status?.long??"").trim();
          const short=newer?.status?.short;
          return {...old,...newer,
            status:status||short!=null?newer.status:old.status,
            home_score:h===null?old?.home_score??null:h,
            away_score:a===null?old?.away_score??null:a};
        };
        const consumed=new Set<number>();
        let merged = oldRows.map((row:any)=>{
          const id=Number(row?.fixture_id),newer=freshById.get(id);
          if(newer)consumed.add(id);
          return mergeRow(row,newer);
        });
        for(const row of incoming){
          const id=Number(row.fixture_id);
          if(!consumed.has(id)){merged.push(row);consumed.add(id);}
        }
        merged=merged.sort((a:any,b:any)=>
          String(a?.kickoff_at||"").localeCompare(String(b?.kickoff_at||"")));

        const finishedWithMissing=merged.filter((x:any)=>{
          if(String(x?.competition_key||"")!=="nba")return false;
          const status=String(x?.status?.long||"").toLowerCase();
          const short=String(x?.status?.short||"");
          return (short==="3" || /finished|final/.test(status)) &&
            (goodScore(x.home_score)===null||goodScore(x.away_score)===null);
        }).length;
        const withScores=merged.filter((x:any)=>
          String(x?.competition_key||"")==="nba" &&
          goodScore(x.home_score)!==null&&goodScore(x.away_score)!==null).length;
        const save = await supabase.from("basketball_fixture_cache").upsert({
          fixture_date:day,fixtures:merged,total:merged.length,
          counts:fresh.counts??existing.data?.counts??null,
          quota:fresh.quota??existing.data?.quota??null,
          fetched_at:new Date().toISOString(),
          source:"admin-score-refresh-v1",
        },{onConflict:"fixture_date"});
        if(save.error)throw save.error;
        return json({success:true,date:day,fixtures_total:merged.length,
          nba_with_scores:withScores,finished_missing_scores:finishedWithMissing,
          note:"僅同步賽事及比分快取；T-10 正式快照未更改"});
      }

      if (
        action ===
        "refresh_fixtures"
      ) {
        const cronKey =
          String(
            Deno.env.get(
              "BASKETBALL_T10_CRON_KEY",
            ) || "",
          ).trim();

        if (!cronKey) {
          return json(
            {
              success:
                false,
              error:
                "cron_key_missing",
              message:
                "BASKETBALL_T10_CRON_KEY 尚未設定",
            },
            500,
          );
        }

        const response =
          await fetch(
            `${SUPABASE_URL}/functions/v1/basketball-t10-job`,
            {
              method:
                "POST",
              headers: {
                ...backendHeaders(
                  SECRET_KEY,
                ),
                "x-habao-cron-key":
                  cronKey,
              },
              body:
                JSON.stringify(
                  {},
                ),
            },
          );

        const result =
          await response
            .json()
            .catch(
              () => null,
            );

        return json(
          {
            success:
              response.ok &&
              result
                ?.success !==
                false,
            result,
          },
          response.ok
            ? 200
            : response.status,
        );
      }

      return json(
        {
          success:
            false,
          error:
            "unknown_action",
          message:
            "未知的 NBA 後台操作",
        },
        400,
      );
    } catch (
      error
    ) {
      console.error(
        "ADMIN BASKETBALL ERROR:",
        error,
      );

      return json(
        {
          success:
            false,
          error:
            "system_error",
          message:
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
