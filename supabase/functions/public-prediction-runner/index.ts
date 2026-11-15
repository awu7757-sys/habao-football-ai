Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        success: false,
        error: "method_not_allowed",
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    const SUPABASE_URL =
      Deno.env.get("SUPABASE_URL");

    const SERVICE_ROLE_KEY =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error(
        "Supabase environment variables missing"
      );
    }

    // ========================================
    // Security: dedicated runner secret.
    // This avoids Supabase Dashboard/Test rewriting
    // Authorization or apikey headers.
    // ========================================
    const RUNNER_SECRET =
      Deno.env.get("PUBLIC_RUNNER_SECRET") || "";

    if (!RUNNER_SECRET) {
      throw new Error(
        "PUBLIC_RUNNER_SECRET is not configured"
      );
    }

    const incomingRunnerSecret =
      String(
        req.headers.get("x-runner-secret") || ""
      ).trim();

    if (
      !incomingRunnerSecret ||
      incomingRunnerSecret !== RUNNER_SECRET
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "forbidden",
          message:
            "Invalid public prediction runner secret",
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const body =
      await req.json().catch(() => ({}));

    // ========================================
    // HABAO V3｜補驗證逾期公開戰績
    // body.mode = "validate_overdue"
    // ========================================
    if (String(body?.mode || "") === "validate_overdue") {
      const API_KEY =
        Deno.env.get("API_FOOTBALL_KEY") ||
        Deno.env.get("API_SPORTS_KEY") ||
        Deno.env.get("API_FOOTBALL_API_KEY") || "";

      if (!API_KEY) {
        return new Response(JSON.stringify({
          success: false,
          error: "api_football_key_missing",
          message: "缺少 API-Football Key，無法補驗證逾期戰績",
        }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
      }

      const restHeaders = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      };

      const pendingRes = await fetch(
        `${SUPABASE_URL}/rest/v1/ai_prediction_snapshots?status=eq.pending&kickoff_at=lt.${encodeURIComponent(new Date(Date.now()-4*60*60*1000).toISOString())}&select=fixture_id,kickoff_at,prediction,status&order=kickoff_at.asc&limit=100`,
        { headers: restHeaders },
      );
      if (!pendingRes.ok) throw new Error(`讀取逾期 pending 失敗：${await pendingRes.text()}`);
      const pendingRows:any[] = await pendingRes.json();

      const terminal = new Set(["FT","AET","PEN"]);
      // Use ONLY the recommendation stored in the immutable first T-10 snapshot.
      // No model calls and no post-match market substitutions.
      const recommendationsOf = (prediction:any):any =>
        prediction?.analysis?.recommendations ??
        prediction?.recommendations ??
        prediction?.prediction?.recommendations ??
        null;
      const getMarket = (recs:any, key:string):any => recs?.[key] ?? null;
      const effectivePick = (market:any):unknown => {
        if (market == null) return null;
        if (typeof market !== "object") return market;
        // The immutable official betting decision is pick. display_pick is
        // advisory display direction and MUST NOT override an explicit NO PICK.
        // A missing pick is not proof of an official wager either.
        const officialPick = market.pick;
        if (officialPick === null || officialPick === undefined ||
            String(officialPick).trim() === "") return null;
        return officialPick;
      };
      const hasNoPick = (value:unknown):boolean => {
        const text=String(value ?? "").trim().toLowerCase();
        return !text || text.includes("暫不推薦") || text.includes("暂不推荐") ||
          text.includes("no pick") || text.includes("no recommendation") ||
          text.includes("不推薦") || text.includes("不推荐");
      };
      const normSide = (value:unknown):"home"|"away"|"draw"|null => {
        if (hasNoPick(value)) return null;
        const t=String(value).toLowerCase().replace(/\s+/g,"");
        if (["home","1","主勝","主胜","主隊","主队","homewin"].includes(t)) return "home";
        if (["away","2","客勝","客胜","客隊","客队","awaywin"].includes(t)) return "away";
        if (["draw","x","和局","平局","和"].includes(t)) return "draw";
        return null;
      };
      const normBtts = (value:unknown):boolean|null => {
        if (hasNoPick(value)) return null;
        const t=String(value).toLowerCase().replace(/\s+/g,"");
        if (["yes","y","是","有","both","btts-yes","雙方進球","双方进球"].includes(t)) return true;
        if (["no","n","否","無","无","btts-no"].includes(t)) return false;
        return null;
      };
      // Accept historical text picks, but never turn an explicit NO PICK into a bet.
      const normTotal = (value:unknown):"over"|"under"|null => {
        if (hasNoPick(value)) return null;
        const t=String(value).trim().toLowerCase().replace(/\s+/g,"");
        if (/^(?:大|over)/i.test(t)) return "over";
        if (/^(?:小|under)/i.test(t)) return "under";
        return null;
      };
      const parseQuarterLine = (value:unknown):number|null => {
        if (value===null || value===undefined) return null;
        const text=String(value).trim().replace(/[−–－]/g,"-").replace(/＋/g,"+");
        const valid=/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
        let line:number;
        if (valid.test(text)) line=Number(text);
        else {
          const parts=text.split("/").map(x=>x.trim());
          if (parts.length!==2 || !valid.test(parts[0]) || !valid.test(parts[1])) return null;
          const first=Number(parts[0]);
          const second=Number(/^[+-]/.test(parts[1])?parts[1]:(first<0?"-":"")+parts[1]);
          if (first*second<0 || Math.abs(Math.abs(first-second)-0.5)>1e-6) return null;
          line=(first+second)/2;
        }
        return Number.isFinite(line) && Math.abs(line*4-Math.round(line*4))<1e-6 ? line : null;
      };
      const marketLine = (market:any):number|null => {
        if (!market || typeof market!=="object") return null;
        // First T-10 official line remains authoritative. Never use display_line
        // to override it or derive an offer from the post-match market.
        const stored=market.line;
        if (stored!==null && stored!==undefined && String(stored).trim()!=="") {
          return parseQuarterLine(stored); // invalid explicit line: fail closed
        }
        // Legacy snapshots sometimes put the entire line inside the pick.
        // Only accept a single unambiguous trailing numeric line.
        const pick=effectivePick(market);
        if (hasNoPick(pick)) return null;
        const raw=String(pick??"").trim().toLowerCase().replace(/\s+/g,"");
        const match=raw.match(/^(?:大(?:球|分|於|于)?|小(?:球|分|於|于)?|over|under)(?:[><])?((?:\d+(?:\.\d+)?|\.\d+)(?:\/(?:\d+(?:\.\d+)?|\.\d+))?)(?:球|分)?$/i);
        return match ? parseQuarterLine(match[1]) : null;
      };
      const asianSettle = (difference:number, line:number):"win"|"loss"|"push"|"half_win"|"half_loss" => {
        const q=Math.round(line*4);
        const quarters=Math.abs(q%2)===1 ? [line-.25,line+.25] : [line];
        const outcomes=quarters.map(part => difference+part>1e-8 ? 1 : difference+part< -1e-8 ? -1 : 0);
        const sum=outcomes.reduce((a,b)=>a+b,0);
        if (quarters.length===1) return sum>0?"win":sum<0?"loss":"push";
        if (sum===2) return "win";
        if (sum===1) return "half_win";
        if (sum===-1) return "half_loss";
        if (sum===-2) return "loss";
        return "push";
      };
      const settlePrediction = (prediction:any,home:number,away:number) => {
        const settlement:any = {};
        const rec=recommendationsOf(prediction);
        if (!rec || typeof rec!=="object") return settlement;
        const moneyPick=normSide(effectivePick(getMarket(rec,"moneyline")));
        if (moneyPick) {
          const actual=home>away?"home":home<away?"away":"draw";
          settlement.moneyline={result:moneyPick===actual?"win":"loss",pick:moneyPick,decided:true};
        }
        const totalMarket=getMarket(rec,"over_under");
        const totalPick=normTotal(effectivePick(totalMarket));
        const totalLine=marketLine(totalMarket);
        if (totalPick!==null && totalLine!==null && totalLine>=0.5 && totalLine<=30) {
          const diff=totalPick==="over"?home+away-totalLine:totalLine-home-away;
          settlement.over_under={result:asianSettle(diff,0),pick:totalPick,line:totalLine,decided:true};
          // For quarter totals, settle on each half-line directly.
          if (Math.abs(Math.round(totalLine*4)%2)===1) {
            const direction=totalPick==="over"?1:-1;
            const parts=[totalLine-.25,totalLine+.25];
            const vals=parts.map(l => (home+away-l)*direction > 1e-8?1:(home+away-l)*direction < -1e-8?-1:0);
            const score=vals[0]+vals[1];
            settlement.over_under.result=score===2?"win":score===1?"half_win":score===-1?"half_loss":score===-2?"loss":"push";
          }
        }
        const bttsPick=normBtts(effectivePick(getMarket(rec,"btts")));
        if (bttsPick!==null) {
          const actual=home>0&&away>0;
          settlement.btts={result:actual===bttsPick?"win":"loss",pick:bttsPick?"yes":"no",decided:true};
        }
        const handicapMarket=getMarket(rec,"handicap");
        const handicapPick=normSide(effectivePick(handicapMarket));
        const handicapLine=marketLine(handicapMarket);
        if ((handicapPick==="home"||handicapPick==="away") && handicapLine!==null && Math.abs(handicapLine)<=15) {
          const margin=handicapPick==="home" ? home-away : away-home;
          settlement.handicap={result:asianSettle(margin,handicapLine),pick:handicapPick,line:handicapLine,decided:true};
        }
        return settlement;
      };

      const report:any={ success:true, checked:pendingRows.length, verified:0, verified_no_bet:0, skipped_not_final:0, skipped_no_settlement:0, skipped_already_processed:0, failed:0, items:[] };
      for (const row of pendingRows) {
        try {
          const fixtureId=Number(row?.fixture_id);
          const fr=await fetch(`https://v3.football.api-sports.io/fixtures?id=${fixtureId}`,{headers:{"x-apisports-key":API_KEY}});
          if (!fr.ok) throw new Error(`API-Football ${fr.status}`);
          const fp=await fr.json();
          const fixture=Array.isArray(fp?.response)?fp.response[0]:null;
          const status=String(fixture?.fixture?.status?.short||"").toUpperCase();
          if (!terminal.has(status)) { report.skipped_not_final++; report.items.push({fixture_id:fixtureId,status,result:"not_final"}); continue; }
          const homeRaw=fixture?.goals?.home, awayRaw=fixture?.goals?.away;
          const home=homeRaw===null||homeRaw===undefined?NaN:Number(homeRaw);
          const away=awayRaw===null||awayRaw===undefined?NaN:Number(awayRaw);
          if (!Number.isFinite(home)||!Number.isFinite(away)) throw new Error("最終比分不存在");
          const settlement=settlePrediction(row?.prediction,home,away);
          // A finished match without an eligible official betting recommendation
          // still needs a verified final score. An empty settlement means NO BET.
          const noOfficialBets=Object.keys(settlement).length===0;
          const ur=await fetch(`${SUPABASE_URL}/rest/v1/ai_prediction_snapshots?fixture_id=eq.${fixtureId}&status=eq.pending`,{
            method:"PATCH",headers:{...restHeaders,Prefer:"return=representation"},body:JSON.stringify({status:"verified",home_score:home,away_score:away,settlement,verified_at:new Date().toISOString()})
          });
          if (!ur.ok) throw new Error(await ur.text());
          const updatedRows=await ur.json().catch(()=>[]);
          if (!Array.isArray(updatedRows) || updatedRows.length===0) {
            report.skipped_already_processed++;
            report.items.push({fixture_id:fixtureId,status,result:"already_processed"});
            continue;
          }
          report.verified++;
          if (noOfficialBets) report.verified_no_bet++;
          report.items.push({fixture_id:fixtureId,status,score:`${home}-${away}`,result:noOfficialBets?"verified_no_official_bet":"verified",settlement});
        } catch(error) { report.failed++; report.items.push({fixture_id:row?.fixture_id,result:"failed",error:error instanceof Error?error.message:String(error)}); }
      }
      return new Response(JSON.stringify(report),{status:200,headers:{...corsHeaders,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
    }

    // ============================================================
    // HABAO T-10 QUEUE / RESCUE V2
    // - Normal (hourly): discovers today + tomorrow and enqueues.
    // - Retry (5-min): consumes PERSISTED due jobs only.
    // - DB atomic claim (lease) prevents two invocations analyzing a
    //   fixture simultaneously.
    // - Every existing official prediction has priority; NEVER update
    //   the prediction or settlement. Match-analysis is unchanged.
    // - No backfilled predictions at/after kickoff.
    // ============================================================
    const runStartedAt = Date.now();
    // Keep a margin beneath Supabase Free's 150s request limit.
    // Late waves must have roughly one original (100s) run's budget.
    let deadlineMs = runStartedAt + 100_000;
    // Keep the same low peak concurrency. A single run can drain several
    // sequential waves so 5-7 matches sharing a T-10 are not forced to wait
    // for another 5-minute Cron tick. Total AI calls per fixture do not rise.
    const MAX_CONCURRENT = 2;
    const MAX_JOBS_PER_RUN = 8;
    const ANALYSIS_TIMEOUT_MS = 68_000;
    const windowHours = 10;
    // Rescue Cron reuses the working hourly Cron HTTP headers and adds
    // ?mode=retry to its endpoint. No existing secrets are changed.
    const mode = String(new URL(req.url).searchParams.get("mode") || body?.mode || "normal").trim();
    if (mode !== "normal" && mode !== "retry") {
      return new Response(JSON.stringify({ success: false, error: "invalid_mode" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "retry") deadlineMs = runStartedAt + 130_000;
    const nowMs = Date.now();
    const tomorrowFixturesUrl = `${SUPABASE_URL}/functions/v1/tomorrow-fixtures`;
    const matchAnalysisUrl = `${SUPABASE_URL}/functions/v1/match-analysis`;
    const commonHeaders = {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    };
    const replyJson = (status: number, data: any) => new Response(JSON.stringify(data), {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });

    const report: any = {
      success: true,
      mode,
      window_hours: windowHours,
      checked: 0,
      registered: 0,
      claimed: 0,
      created: 0,
      already_exists: 0,
      processing: 0,
      deferred: 0,
      expired: 0,
      failed: 0,
      source_errors: [],
      items: [],
    };

    async function rpc(name: string, args: any, timeoutMs = 12_000): Promise<any> {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`rpc_${name}_${res.status}: ${(await res.text()).slice(0,400)}`);
      const raw = await res.text();
      return raw ? JSON.parse(raw) : null;
    }

    // ONLY normal mode discovers fixtures. Retry uses the durable queue
    // and can proceed even if the fixture provider is temporarily down.
    if (mode === "normal") {
      async function loadFixtures(offset: number): Promise<any[]> {
        const response = await fetch(tomorrowFixturesUrl, {
          method: "POST",
          headers: commonHeaders,
          body: JSON.stringify({ offset }),
          signal: AbortSignal.timeout(18_000),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.success !== true) {
          throw new Error(`tomorrow-fixtures offset=${offset}: HTTP ${response.status}`);
        }
        return Array.isArray(payload?.fixtures) ? payload.fixtures : [];
      }

      const loads = await Promise.allSettled([loadFixtures(0), loadFixtures(1)]);
      const groups: any[][] = [];
      loads.forEach((r, offset) => {
        if (r.status === "fulfilled") groups.push(r.value);
        else report.source_errors.push({ offset, error: String(r.reason?.message || r.reason) });
      });

      const fixtureMap = new Map<number, any>();
      for (const item of groups.flat()) {
        const id = Number(item?.fixtureId);
        if (Number.isSafeInteger(id) && id > 0) fixtureMap.set(id, item);
      }
      report.checked = fixtureMap.size;
      const terminal = new Set(["FT", "AET", "PEN", "CANC", "PST", "ABD", "AWD", "WO"]);
      const jobs: Array<{fixture_id: number; kickoff_at: string; fixture_data: any}> = [];
      // 2026-11-15：公開戰績只收會員可分析的 12 個聯賽（與 football-v2 runner 的 SPORTS 相同）。
      // 英超、西甲、德甲、義甲、法甲、歐冠、歐霸、荷甲、日職、韓職、中超、巴甲。
      // 已知聯賽 ID 且不在清單內才跳過；取不到 ID 的仍保留並計數，避免資料格式變動時整批漏掉。
      const PUBLIC_LEAGUES = new Set([39, 140, 78, 135, 61, 2, 3, 88, 98, 292, 169, 71]);
      let skippedLeague = 0, unknownLeague = 0;
      for (const item of fixtureMap.values()) {
        const leagueId = Number(item?.league?.id || item?.league?.leagueId || item?.leagueId || 0);
        if (leagueId > 0 && !PUBLIC_LEAGUES.has(leagueId)) { skippedLeague++; continue; }
        if (!(leagueId > 0)) unknownLeague++;
        const id = Number(item?.fixtureId);
        const kick = Date.parse(String(item?.time || ""));
        const status = String(item?.status || "").toUpperCase();
        if (Number.isFinite(kick) && kick > nowMs && !terminal.has(status)) {
          jobs.push({ fixture_id: id, kickoff_at: new Date(kick).toISOString(), fixture_data: item });
        }
      }

      (report as any).skipped_non_public_league = skippedLeague;
      (report as any).unknown_league_id = unknownLeague;

      if (jobs.length > 0) {
        try {
          const result = await rpc("habao_t10_register", { p_fixtures: jobs });
          report.registered = Number(result || 0);
        } catch (e) {
          report.success = false;
          report.failed++;
          report.items.push({ result: "queue_register_failed", error: String((e as Error).message).slice(0,350) });
        }
      }
      if (groups.length === 0) {
        report.success = false;
        report.items.push({ result: "fixtures_unavailable_queue_retained" });
      }
    }

    // The claim is atomic, performs snapshot reconciliation, and
    // reclaims workers that died without acknowledging (lease expired).
    // The normal and retry invocations can run at the same minute safely.
    let claimed: Array<{fixture_id: number; kickoff_at: string; lease_id: string; fixture_data: any}> = [];
    try {
      const rows = await rpc("habao_t10_claim", { p_limit: MAX_CONCURRENT });
      claimed = Array.isArray(rows) ? rows : [];
      report.claimed = claimed.length;
    } catch (e) {
      report.success = false;
      report.failed++;
      report.items.push({ result: "queue_claim_failed", error: String((e as Error).message).slice(0,350) });
    }

    async function getExistingSnapshot(
      fixtureId: number
    ) {
      const url =
        `${SUPABASE_URL}/rest/v1/ai_prediction_snapshots` +
        `?fixture_id=eq.${fixtureId}` +
        `&select=fixture_id,status,kickoff_at` +
        `&limit=1`;

      const res = await fetch(url, {
        headers: {
          "apikey": SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        throw new Error(
          `snapshot lookup failed: ${await res.text()}`
        );
      }

      const rows =
        await res.json();

      return (
        Array.isArray(rows) &&
        rows.length > 0
      )
        ? rows[0]
        : null;
    }

    // Cache-hit may return before match-analysis reaches its
    // snapshot block, so runner guarantees the pending snapshot.
    async function ensureSnapshot(
      fixtureId: number,
      analysisResult: any,
      fallbackFixture: any
    ) {
      const fixture =
        analysisResult?.fixture ||
        fallbackFixture ||
        {};

      const kickoffRaw =
        fixture?.date ||
        fallbackFixture?.time ||
        null;

      const kickoffAt =
        kickoffRaw
          ? new Date(kickoffRaw)
          : null;

      if (
        !kickoffAt ||
        Number.isNaN(
          kickoffAt.getTime()
        ) ||
        kickoffAt.getTime() <= Date.now()
      ) {
        return {
          created: false,
          reason: "invalid_or_started",
        };
      }

      const prediction =
        analysisResult?.analysis;

      if (!prediction) {
        return {
          created: false,
          reason: "missing_analysis",
        };
      }

      const leagueName =
        fixture?.league?.name ||
        (typeof fixture?.league === "string" ? fixture.league : null) ||
        fallbackFixture?.league?.name ||
        fallbackFixture?.league?.api_name ||
        null;

      const homeTeam =
        fixture?.home?.name ||
        fallbackFixture?.home?.name ||
        fallbackFixture?.home?.api_name ||
        null;

      const awayTeam =
        fixture?.away?.name ||
        fallbackFixture?.away?.name ||
        fallbackFixture?.away?.api_name ||
        null;

      const insertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/ai_prediction_snapshots?on_conflict=fixture_id`,
        {
          method: "POST",
          headers: {
            "apikey": SERVICE_ROLE_KEY,
            "Authorization":
              `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type":
              "application/json",
            "Prefer":
              "resolution=ignore-duplicates,return=representation",
          },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({
            fixture_id:
              Number(fixtureId),
            kickoff_at:
              kickoffAt.toISOString(),
            league_name:
              leagueName,
            home_team:
              homeTeam,
            away_team:
              awayTeam,
            prediction,
            status: "pending",
          }),
        },
      );

      if (!insertRes.ok) {
        throw new Error(
          `snapshot insert failed: ${await insertRes.text()}`
        );
      }

      const rows =
        await insertRes.json()
          .catch(() => []);

      return {
        created:
          Array.isArray(rows) &&
          rows.length > 0,
        reason:
          Array.isArray(rows) &&
          rows.length > 0
            ? "created"
            : "already_exists",
      };
    }

    async function runClaim(job: typeof claimed[number]): Promise<string> {
      const fixtureId = Number(job.fixture_id);
      const kickoffMs = Date.parse(job.kickoff_at);
      let outcome = "failed";
      let errorMessage = "";
      try {
        if (!Number.isFinite(kickoffMs) || Date.now() >= kickoffMs) {
          outcome = "expired";
        } else if (await getExistingSnapshot(fixtureId)) {
          outcome = "already_exists";
        } else {
          const remainingMs = deadlineMs - Date.now();
          if (remainingMs < 20_000) {
            outcome = "deferred";
          } else {
            const response = await fetch(matchAnalysisUrl, {
              method: "POST",
              headers: commonHeaders,
              body: JSON.stringify({
                fixture_id: fixtureId,
                language: "zh-Hant",
                internal_public: true,
              }),
              signal: AbortSignal.timeout(Math.min(ANALYSIS_TIMEOUT_MS, remainingMs - 14_000)),
            });
            const payload = await response.json().catch(() => null);
            if (response.status === 202 || payload?.processing === true) {
              outcome = "processing";
            } else if (!response.ok || payload?.success !== true) {
              throw new Error(`match_analysis_${response.status}: ${String(payload?.error || payload?.message || "failed").slice(0,180)}`);
            } else {
              if (Date.now() >= kickoffMs) {
                outcome = "expired";
              } else {
                const snapshotResult = await ensureSnapshot(fixtureId, payload, job.fixture_data || { time: job.kickoff_at });
                outcome = String(snapshotResult.reason || (snapshotResult.created ? "created" : "failed"));
              }
            }
          }
        }
      } catch (e) {
        errorMessage = String((e as Error)?.message || e).slice(0,350);
        outcome = "failed";
      } finally {
        try {
          // The DB verifies lease_id and snapshot existence before marking done.
          await rpc("habao_t10_finish", {
            p_fixture_id: fixtureId,
            p_lease_id: job.lease_id,
            p_result: outcome,
            p_error: errorMessage || null,
          }, 10_000);
        } catch (e) {
          report.success = false;
          report.items.push({ fixture_id: fixtureId, result: "ack_failed", error: String((e as Error).message).slice(0,250) });
          // The DB lease expires; a later retry reclaims safely.
        }
      }
      if (outcome === "created") report.created++;
      else if (outcome === "already_exists") report.already_exists++;
      else if (outcome === "processing") report.processing++;
      else if (outcome === "expired" || outcome === "kickoff_reached_without_snapshot") report.expired++;
      else if (outcome === "deferred") report.deferred++;
      else { report.failed++; report.success = false; }
      report.items.push({ fixture_id: fixtureId, result: outcome, ...(errorMessage ? { error: errorMessage } : {}) });
      return outcome;
    }

    // Drain more due fixtures without increasing concurrent API/AI requests.
    // Acquire each new wave just before processing so the DB lease is fresh.
    // If a wave fails/returns processing, leave retries for the existing Cron;
    // do not immediately repeat the same job within this invocation.
    const completedWave = new Set(["created", "already_exists", "expired"]);
    let waveOutcomes = await Promise.all(claimed.map(runClaim));
    let waves = claimed.length > 0 ? 1 : 0;
    while (
      mode === "retry" &&
      waveOutcomes.length > 0 &&
      waveOutcomes.every((status) => completedWave.has(status)) &&
      report.claimed < MAX_JOBS_PER_RUN &&
      // A fresh wave is not safe with only 30 seconds remaining:
      // it may time out an already-running match-analysis call.
      (deadlineMs - Date.now()) >= 100_000
    ) {
      let next: typeof claimed = [];
      try {
        const rows = await rpc("habao_t10_claim", {
          p_limit: Math.min(MAX_CONCURRENT, MAX_JOBS_PER_RUN - report.claimed),
        });
        next = Array.isArray(rows) ? rows : [];
      } catch (e) {
        report.success = false;
        report.failed++;
        report.items.push({ result: "queue_followup_claim_failed", error: String((e as Error)?.message || e).slice(0,350) });
        break;
      }
      if (next.length === 0) break;
      report.claimed += next.length;
      waves++;
      waveOutcomes = await Promise.all(next.map(runClaim));
    }
    report.waves = waves;
    report.max_concurrent = MAX_CONCURRENT;
    report.max_jobs_per_run = MAX_JOBS_PER_RUN;
    report.elapsed_ms = Date.now() - runStartedAt;
    console.log("HABAO_T10_QUEUE_REPORT", JSON.stringify(report));
    return replyJson(200, report);
  } catch (error) {
    console.error(
      "PUBLIC PREDICTION RUNNER FATAL:",
      error
    );

    return new Response(
      JSON.stringify({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type":
            "application/json; charset=utf-8",
          "Cache-Control":
            "no-store",
        },
      },
    );
  }
});