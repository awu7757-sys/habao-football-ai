const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};

function json(
  data: unknown,
  status = 200,
) {
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

function dateInTaipei(
  input: Date,
) {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
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
  const match =
    yyyyMmDd.match(
      /^(\d{4})-(\d{2})-(\d{2})$/,
    );

  if (!match) {
    throw new Error(
      "INVALID_DATE",
    );
  }

  const d =
    new Date(
      Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        12,
        0,
        0,
      ),
    );

  d.setUTCDate(
    d.getUTCDate() + days,
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

function normalizeTargetDate(
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

  const offset =
    Math.max(
      0,
      Math.min(
        1,
        Number(
          body?.offset ?? 0,
        ) || 0,
      ),
    );

  return addDays(
    todayTaipei(),
    offset,
  );
}

function nbaSeasonForDate(
  yyyyMmDd: string,
) {
  const year =
    Number(
      yyyyMmDd.slice(0, 4),
    );

  const month =
    Number(
      yyyyMmDd.slice(5, 7),
    );

  return month >= 7
    ? year
    : year - 1;
}

/*
  HABAO 正式 NBA 收錄範圍：
  - standard league
  - 排除 preseason
  - 排除 summer / regional leagues
  - 排除 All-Star
  - 保留 regular season / NBA Cup / Play-In / Playoffs / Finals

  每季正式開幕日建議逐年確認後補進此表。
*/
const NBA_OFFICIAL_START:
  Record<number, string> = {
    2026: "2026-10-20",
  };

function nbaOfficialWindow(
  season: number,
) {
  const start =
    NBA_OFFICIAL_START[season] ||
    `${season}-10-20`;

  const end =
    `${season + 1}-06-30`;

  return {
    start,
    end,
  };
}

function isWithin(
  date: string,
  start: string,
  end: string,
) {
  return (
    date >= start &&
    date <= end
  );
}

function apiErrorCount(
  errors: any,
) {
  if (!errors) return 0;

  if (Array.isArray(errors)) {
    return errors.length;
  }

  if (
    typeof errors === "object"
  ) {
    return Object.keys(
      errors,
    ).length;
  }

  return String(errors)
    .trim()
    ? 1
    : 0;
}

async function apiGet(
  baseUrl: string,
  path: string,
  apiKey: string,
) {
  const response =
    await fetch(
      `${baseUrl}${path}`,
      {
        method: "GET",
        headers: {
          "x-apisports-key":
            apiKey,
        },
      },
    );

  const text =
    await response.text();

  let body: any = null;

  try {
    body =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    body = text;
  }

  return {
    ok:
      response.ok,
    status:
      response.status,
    body,
    remaining:
      response.headers.get(
        "x-ratelimit-requests-remaining",
      ),
    limit:
      response.headers.get(
        "x-ratelimit-requests-limit",
      ),
  };
}

function nbaGameTaipeiDate(
  game: any,
) {
  const raw =
    String(
      game?.date?.start || "",
    ).trim();

  if (!raw) return "";

  const d =
    new Date(raw);

  if (
    Number.isNaN(
      d.getTime(),
    )
  ) {
    return "";
  }

  return dateInTaipei(d);
}

function isNbaAllStar(
  game: any,
) {
  return Boolean(
    game
      ?.teams
      ?.home
      ?.allStar === true ||
    game
      ?.teams
      ?.visitors
      ?.allStar === true,
  );
}

function isNbaFranchiseGame(
  game: any,
) {
  const home =
    game
      ?.teams
      ?.home
      ?.nbaFranchise;

  const away =
    game
      ?.teams
      ?.visitors
      ?.nbaFranchise;

  /*
    舊資料若沒有此欄位，不因 null 就誤刪；
    只有明確 false 才排除。
  */
  return (
    home !== false &&
    away !== false
  );
}

function validNbaPoints(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeNbaGame(
  game: any,
) {
  return {
    id:
      `nba:${game?.id}`,
    sport:
      "basketball",
    competition_key:
      "nba",
    competition_name:
      "NBA",
    source:
      "api-nba",

    fixture_id:
      game?.id ?? null,

    kickoff_at:
      game?.date?.start ??
      null,

    kickoff_date_taipei:
      nbaGameTaipeiDate(
        game,
      ),

    // 全場比數來自 API-NBA /games 的 scores 物件；
    // 缺值維持 null，絕對不要用 0 當作尚未更新的比數。
    home_score: validNbaPoints(game?.scores?.home?.points),
    away_score: validNbaPoints(game?.scores?.visitors?.points),

    season:
      game?.season ?? null,

    stage:
      game?.stage ?? null,

    status: {
      short:
        game
          ?.status
          ?.short ??
        null,
      long:
        game
          ?.status
          ?.long ??
        null,
    },

    home: {
      id:
        game
          ?.teams
          ?.home
          ?.id ??
        null,
      name:
        game
          ?.teams
          ?.home
          ?.name ??
        null,
      code:
        game
          ?.teams
          ?.home
          ?.code ??
        null,
      logo:
        game
          ?.teams
          ?.home
          ?.logo ??
        null,
    },

    away: {
      id:
        game
          ?.teams
          ?.visitors
          ?.id ??
        null,
      name:
        game
          ?.teams
          ?.visitors
          ?.name ??
        null,
      code:
        game
          ?.teams
          ?.visitors
          ?.code ??
        null,
      logo:
        game
          ?.teams
          ?.visitors
          ?.logo ??
        null,
    },

    venue:
      game?.arena?.name ??
      null,

    city:
      game?.arena?.city ??
      null,

    raw_league:
      game?.league ?? null,
  };
}

function normalizeWorldCupGame(
  game: any,
) {
  const dateText =
    String(
      game?.date || "",
    ).trim();

  const timeText =
    String(
      game?.time || "",
    ).trim();

  const kickoff =
    dateText &&
    timeText
      ? `${dateText}T${timeText}:00+08:00`
      : (
          dateText ||
          null
        );

  return {
    id:
      `fiba-world-cup:${game?.id}`,
    sport:
      "basketball",
    competition_key:
      "fiba_world_cup",
    competition_name:
      "FIBA 籃球世界盃",
    source:
      "api-basketball",

    fixture_id:
      game?.id ?? null,

    kickoff_at:
      kickoff,

    kickoff_date_taipei:
      dateText || null,

    season:
      game?.league?.season ??
      null,

    status: {
      short:
        game
          ?.status
          ?.short ??
        null,
      long:
        game
          ?.status
          ?.long ??
        null,
    },

    home: {
      id:
        game
          ?.teams
          ?.home
          ?.id ??
        null,
      name:
        game
          ?.teams
          ?.home
          ?.name ??
        null,
      logo:
        game
          ?.teams
          ?.home
          ?.logo ??
        null,
    },

    away: {
      id:
        game
          ?.teams
          ?.away
          ?.id ??
        null,
      name:
        game
          ?.teams
          ?.away
          ?.name ??
        null,
      logo:
        game
          ?.teams
          ?.away
          ?.logo ??
        null,
    },

    venue:
      null,

    city:
      null,

    raw_league:
      game?.league?.name ??
      "World Cup",
  };
}

Deno.serve(
  async (req) => {
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
      const body =
        await req
          .json()
          .catch(
            () => ({}),
          );

      const targetDate =
        normalizeTargetDate(
          body,
        );

      const debug =
        body?.debug === true;

      const apiKey =
        String(
          Deno.env.get(
            "API_FOOTBALL_KEY",
          ) || "",
        ).trim();

      const nbaApiKey = String(Deno.env.get("API_NBA_KEY") || apiKey).trim();

      if (!apiKey && !nbaApiKey) {
        return json(
          {
            success: false,
            error:
              "找不到賽事來源 API 金鑰",
          },
          500,
        );
      }

      const nbaSeason =
        nbaSeasonForDate(
          targetDate,
        );

      const nbaWindow =
        nbaOfficialWindow(
          nbaSeason,
        );

      const nbaDateCandidates =
        [
          addDays(
            targetDate,
            -1,
          ),
          targetDate,
        ];

      /*
        目前 2026-10-14 還在 NBA preseason，
        若 targetDate 尚未進正式賽季，
        直接略過 NBA API games 呼叫，節省額度。
      */
      const shouldFetchNba =
        isWithin(
          targetDate,
          nbaWindow.start,
          nbaWindow.end,
        );

      const nbaCalls =
        shouldFetchNba
          ? await Promise.all(
              nbaDateCandidates.map(
                date =>
                  apiGet(
                    "https://v2.nba.api-sports.io",
                    `/games?league=standard&season=${encodeURIComponent(String(nbaSeason))}&date=${encodeURIComponent(date)}`,
                    nbaApiKey,
                  ),
              ),
            )
          : [];

      const worldCupSeason =
        2027;

      const WORLD_CUP_START =
        "2027-08-27";

      const WORLD_CUP_END =
        "2027-09-12";

      const shouldFetchWorldCup =
        isWithin(
          targetDate,
          WORLD_CUP_START,
          WORLD_CUP_END,
        );

      const worldCupCall =
        shouldFetchWorldCup
          ? await apiGet(
              "https://v1.basketball.api-sports.io",
              `/games?date=${encodeURIComponent(targetDate)}` +
                `&league=281` +
                `&season=${encodeURIComponent(String(worldCupSeason))}` +
                `&timezone=${encodeURIComponent("Asia/Taipei")}`,
              apiKey,
            )
          : null;

      const nbaRawGames =
        nbaCalls.flatMap(
          call =>
            Array.isArray(
              call?.body?.response,
            )
              ? call.body.response
              : [],
        );

      const nbaDeduped =
        Array.from(
          new Map(
            nbaRawGames
              .filter(
                (game: any) =>
                  game?.id != null,
              )
              .map(
                (game: any) => [
                  String(
                    game.id,
                  ),
                  game,
                ],
              ),
          ).values(),
        );

      const nbaAccepted =
        nbaDeduped.filter(
          (game: any) => {
            if (
              String(
                game?.league || "",
              ).toLowerCase() !==
              "standard"
            ) {
              return false;
            }

            if (
              nbaGameTaipeiDate(
                game,
              ) !==
              targetDate
            ) {
              return false;
            }

            if (
              !isNbaFranchiseGame(
                game,
              )
            ) {
              return false;
            }

            if (
              isNbaAllStar(
                game,
              )
            ) {
              return false;
            }

            return true;
          },
        );

      const worldCupErrors =
        shouldFetchWorldCup
          ? apiErrorCount(
              worldCupCall
                ?.body
                ?.errors,
            )
          : 0;

      const worldCupRows =
        shouldFetchWorldCup &&
        Array.isArray(
          worldCupCall
            ?.body
            ?.response,
        )
          ? worldCupCall
              .body
              .response
          : [];

      /*
        League 281 已經在前一步實測確認為
        男子 World Cup。
        仍再檢查 league id / name，避免來源意外變更。
      */
      const worldCupAccepted =
        worldCupRows.filter(
          (game: any) => {
            const leagueId =
              Number(
                game
                  ?.league
                  ?.id,
              );

            const leagueName =
              String(
                game
                  ?.league
                  ?.name ||
                "",
              ).toLowerCase();

            return (
              leagueId === 281 ||
              (
                leagueName ===
                  "world cup" &&
                !leagueName.includes(
                  "women",
                )
              )
            );
          },
        );

      const fixtures =
        [
          ...nbaAccepted.map(
            normalizeNbaGame,
          ),
          ...worldCupAccepted.map(
            normalizeWorldCupGame,
          ),
        ].sort(
          (a: any, b: any) =>
            String(
              a?.kickoff_at ||
              "",
            ).localeCompare(
              String(
                b?.kickoff_at ||
                "",
              ),
            ),
        );

      const nbaErrors =
        nbaCalls.flatMap(
          call => {
            const errors =
              call
                ?.body
                ?.errors;

            if (
              !errors ||
              apiErrorCount(
                errors,
              ) === 0
            ) {
              return [];
            }

            return [
              {
                status:
                  call.status,
                errors,
              },
            ];
          },
        );

      const nbaTransportOk =
        !shouldFetchNba ||
        nbaCalls.every(
          call =>
            call.ok &&
            apiErrorCount(
              call
                ?.body
                ?.errors,
            ) === 0,
        );

      const worldCupOk =
        !shouldFetchWorldCup ||
        (
          worldCupCall?.ok === true &&
          worldCupErrors === 0
        );

      const response: any = {
        success:
          nbaTransportOk &&
          worldCupOk,

        sport:
          "basketball",

        date:
          targetDate,

        timezone:
          "Asia/Taipei",

        official_only:
          true,

        competitions: [
          {
            key:
              "nba",
            name:
              "NBA",
            included:
              true,
            rules: [
              "standard league only",
              "preseason excluded",
              "summer/regional leagues excluded",
              "All-Star excluded",
              "regular season / NBA Cup / Play-In / Playoffs / Finals included",
            ],
            season:
              nbaSeason,
            official_window:
              nbaWindow,
            fetch_skipped:
              !shouldFetchNba,
          },
          {
            key:
              "fiba_world_cup",
            name:
              "FIBA 男子籃球世界盃",
            included:
              true,
            league_id:
              281,
            season:
              worldCupSeason,
            official_window: {
              start:
                WORLD_CUP_START,
              end:
                WORLD_CUP_END,
            },
            fetch_skipped:
              !shouldFetchWorldCup,
            skip_reason:
              !shouldFetchWorldCup
                ? "outside_official_tournament_window"
                : null,
            qualifiers:
              false,
            women:
              false,
          },
        ],

        counts: {
          nba:
            nbaAccepted.length,
          world_cup:
            worldCupAccepted.length,
          total:
            fixtures.length,
        },

        fixtures,

        quota: {
          nba_remaining:
            nbaCalls
              .map(
                x =>
                  x.remaining,
              )
              .find(Boolean) ||
            null,
          basketball_remaining:
            worldCupCall
              ?.remaining ||
            null,
        },

        errors: {
          nba:
            nbaErrors,
          world_cup:
            shouldFetchWorldCup &&
            worldCupErrors > 0
              ? worldCupCall
                  ?.body
                  ?.errors ||
                []
              : [],
        },
      };

      if (debug) {
        response.debug = {
          nba_date_candidates:
            nbaDateCandidates,
          nba_raw_candidates:
            nbaDeduped.length,
          nba_filtered_out:
            nbaDeduped.length -
            nbaAccepted.length,
          nba_raw_sample:
            nbaDeduped
              .slice(0, 5)
              .map(
                (game: any) => ({
                  id:
                    game?.id ??
                    null,
                  league:
                    game
                      ?.league ??
                    null,
                  season:
                    game
                      ?.season ??
                    null,
                  stage:
                    game
                      ?.stage ??
                    null,
                  start:
                    game
                      ?.date
                      ?.start ??
                    null,
                  taipei_date:
                    nbaGameTaipeiDate(
                      game,
                    ),
                  home:
                    game
                      ?.teams
                      ?.home
                      ?.name ??
                    null,
                  away:
                    game
                      ?.teams
                      ?.visitors
                      ?.name ??
                    null,
                  home_all_star:
                    game
                      ?.teams
                      ?.home
                      ?.allStar ??
                    null,
                  away_all_star:
                    game
                      ?.teams
                      ?.visitors
                      ?.allStar ??
                    null,
                  home_nba_franchise:
                    game
                      ?.teams
                      ?.home
                      ?.nbaFranchise ??
                    null,
                  away_nba_franchise:
                    game
                      ?.teams
                      ?.visitors
                      ?.nbaFranchise ??
                    null,
                }),
              ),

          world_cup_fetch_skipped:
            !shouldFetchWorldCup,
          world_cup_raw:
            worldCupRows.length,
        };
      }

      return json(
        response,
        response.success
          ? 200
          : 502,
      );
    } catch (error) {
      console.error(
        "basketball-fixtures error:",
        error,
      );

      return json(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        500,
      );
    }
  },
);

