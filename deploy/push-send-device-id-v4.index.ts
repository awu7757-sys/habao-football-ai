import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } });
}


type AdminAuthContext = {
  is_super_admin: boolean;
  admin_user_id: number | null;
  username: string;
  display_name: string;
  permissions: string[];
  auth_mode: "session" | "legacy_super";
};

function getAdminSessionToken(
  req: Request,
  body: Record<string, any>,
) {
  const headerToken =
    String(
      req.headers.get("x-admin-session") ||
      "",
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
    new TextEncoder().encode(value);

  const digest =
    await crypto.subtle.digest(
      "SHA-256",
      bytes,
    );

  return Array.from(
    new Uint8Array(digest),
  )
    .map((byte) =>
      byte
        .toString(16)
        .padStart(2, "0")
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

  if (a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}

async function authorizeAdmin(
  req: Request,
  body: Record<string, any>,
  supabase: any,
  adminPassword: string,
  requiredPermission?: string,
): Promise<
  | {
      ok: true;
      context: AdminAuthContext;
    }
  | {
      ok: false;
      response: Response;
    }
> {
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
      new Date().toISOString();

    const {
      data: session,
      error: sessionError,
    } = await supabase
      .from("admin_sessions")
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
        session.is_super_admin ===
        true
      ) {
        try {
          await supabase
            .from("admin_sessions")
            .update({
              last_seen_at: now,
            })
            .eq(
              "id",
              session.id,
            );
        } catch {
          // Session touch failure does not invalidate a valid session.
        }

        return {
          ok: true,
          context: {
            is_super_admin: true,
            admin_user_id: null,
            username:
              "super-admin",
            display_name:
              "Super Admin",
            permissions: ["*"],
            auth_mode:
              "session",
          },
        };
      }

      const userId =
        Number(
          session.admin_user_id ||
          0,
        );

      if (userId) {
        const {
          data: adminUser,
          error: userError,
        } = await supabase
          .from("admin_users")
          .select(
            "id,username,display_name,permissions,is_active",
          )
          .eq(
            "id",
            userId,
          )
          .maybeSingle();

        if (
          !userError &&
          adminUser &&
          adminUser.is_active ===
            true
        ) {
          const permissions =
            Array.isArray(
              adminUser.permissions,
            )
              ? adminUser.permissions
                  .map(
                    (item: unknown) =>
                      String(item),
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
                  success: false,
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
              .from("admin_sessions")
              .update({
                last_seen_at: now,
              })
              .eq(
                "id",
                session.id,
              );
          } catch {
            // Session touch failure does not invalidate a valid session.
          }

          return {
            ok: true,
            context: {
              is_super_admin:
                false,
              admin_user_id:
                Number(
                  adminUser.id,
                ),
              username:
                String(
                  adminUser.username ||
                    "",
                ),
              display_name:
                String(
                  adminUser
                    .display_name ||
                    adminUser
                      .username ||
                    "",
                ),
              permissions,
              auth_mode:
                "session",
            },
          };
        }
      }
    }
  }

  /*
    過渡期相容：
    舊版 admin.html 仍會傳 ADMIN_PASSWORD。
    只保留原始 Super Admin 密碼，
    第二組臨時管理密碼已完全取消。
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
        is_super_admin: true,
        admin_user_id: null,
        username:
          "super-admin",
        display_name:
          "Super Admin",
        permissions: ["*"],
        auth_mode:
          "legacy_super",
      },
    };
  }

  return {
    ok: false,
    response: json(
      {
        success: false,
        error: "unauthorized",
        message:
          "管理員登入已失效，請重新登入",
      },
      401,
    ),
  };
}


async function getBasketballGameAudience(
  supabaseUrl: string,
  backendHeaders: Record<string,string>,
  gameId: number,
) {
  const historyRes = await fetch(
    `${supabaseUrl}/rest/v1/member_basketball_analysis_history?game_id=eq.${encodeURIComponent(String(gameId))}&select=account`,
    { headers: backendHeaders },
  );

  if (!historyRes.ok) {
    throw new Error(
      `讀取 NBA 分析會員失敗：${await historyRes.text()}`
    );
  }

  const historyRows: any[] =
    await historyRes.json().catch(() => []);

  const analyzedAccounts =
    new Set(
      (historyRows || [])
        .map(row =>
          String(
            row?.account || ""
          ).trim()
        )
        .filter(Boolean)
    );

  if (!analyzedAccounts.size) {
    return {
      analyzed_accounts: [],
      active_accounts: [],
      subscriptions: [],
    };
  }

  const membersRes = await fetch(
    `${supabaseUrl}/rest/v1/members?select=account,is_active`,
    { headers: backendHeaders },
  );

  if (!membersRes.ok) {
    throw new Error(
      `讀取會員狀態失敗：${await membersRes.text()}`
    );
  }

  const members: any[] =
    await membersRes.json().catch(() => []);

  const activeAccounts =
    new Set(
      (members || [])
        .filter(member =>
          member?.is_active === true &&
          analyzedAccounts.has(
            String(
              member?.account || ""
            ).trim()
          )
        )
        .map(member =>
          String(
            member?.account || ""
          ).trim()
        )
        .filter(Boolean)
    );

  const subscriptionsRes = await fetch(
    `${supabaseUrl}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth,member_username`,
    { headers: backendHeaders },
  );

  if (!subscriptionsRes.ok) {
    throw new Error(
      `讀取推播訂閱失敗：${await subscriptionsRes.text()}`
    );
  }

  const allSubscriptions: any[] =
    await subscriptionsRes.json().catch(() => []);

  const subscriptions =
    (allSubscriptions || [])
      .filter(subscription =>
        activeAccounts.has(
          String(
            subscription?.member_username || ""
          ).trim()
        )
      );

  return {
    analyzed_accounts:
      Array.from(analyzedAccounts),
    active_accounts:
      Array.from(activeAccounts),
    subscriptions,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const payload = await req.json().catch(() => ({}));
    const action = String(payload?.action || "send");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey) throw new Error("必要的環境變數不存在");

    const backendHeaders: Record<string,string> = { apikey: serviceRoleKey, "Content-Type":"application/json" };
    if (!serviceRoleKey.startsWith("sb_secret_")) backendHeaders.Authorization = `Bearer ${serviceRoleKey}`;

    if (action === "public_config") return json({ success: true, vapid_public_key: vapidPublicKey });

    if (action === "subscribe") {
      const member = String(payload?.member_username || "").trim();
      const deviceId = String(payload?.device_id || "").trim();
      const sub = payload?.subscription || {};
      const endpoint = String(sub?.endpoint || "").trim();
      const p256dh = String(sub?.keys?.p256dh || "").trim();
      const auth = String(sub?.keys?.auth || "").trim();

      if (!member || !endpoint || !p256dh || !auth) {
        return json({
          success: false,
          message: "推播訂閱資料不完整",
        }, 400);
      }

      const memberRes = await fetch(
        `${supabaseUrl}/rest/v1/members?account=eq.${encodeURIComponent(member)}&select=account,is_active&limit=1`,
        { headers: backendHeaders },
      );

      const memberRows = memberRes.ok
        ? await memberRes.json()
        : [];

      if (!Array.isArray(memberRows) || !memberRows[0]?.is_active) {
        return json({
          success: false,
          message: "會員不存在或已停權",
        }, 403);
      }

      const now = new Date().toISOString();
      const endpointFilter = encodeURIComponent(endpoint);
      let existingRows: any[] = [];

      // 同一瀏覽器 / PWA 以固定 device_id 為主鍵。
      // 若 device_id 尚未綁定，則用 endpoint 接管舊資料，避免重複新增。
      if (deviceId) {
        const deviceRes = await fetch(
          `${supabaseUrl}/rest/v1/push_subscriptions?device_id=eq.${encodeURIComponent(deviceId)}&select=id,device_id,endpoint,member_username&limit=5`,
          { headers: backendHeaders },
        );
        if (!deviceRes.ok) {
          throw new Error(`讀取裝置訂閱失敗：${await deviceRes.text()}`);
        }
        existingRows = await deviceRes.json();
      }

      if (!Array.isArray(existingRows) || existingRows.length === 0) {
        const endpointRes = await fetch(
          `${supabaseUrl}/rest/v1/push_subscriptions?endpoint=eq.${endpointFilter}&select=id,device_id,endpoint,member_username&limit=5`,
          { headers: backendHeaders },
        );
        if (!endpointRes.ok) {
          throw new Error(`讀取舊推播訂閱失敗：${await endpointRes.text()}`);
        }
        existingRows = await endpointRes.json();
      }

      if (Array.isArray(existingRows) && existingRows.length > 0) {
        const keep = existingRows[0];
        const patchRes = await fetch(
          `${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(String(keep.id))}`,
          {
            method: "PATCH",
            headers: {
              ...backendHeaders,
              Prefer: "return=representation",
            },
            body: JSON.stringify({
              device_id: deviceId || keep?.device_id || null,
              endpoint,
              p256dh,
              auth,
              member_username: member,
              updated_at: now,
            }),
          },
        );

        if (!patchRes.ok) {
          throw new Error(`更新推播裝置失敗：${await patchRes.text()}`);
        }

        const patchedRows: any[] = await patchRes.json().catch(() => []);

        // 若歷史資料留下同 device_id / endpoint 重複列，只保留第一筆。
        for (const duplicate of existingRows.slice(1)) {
          if (duplicate?.id == null) continue;
          await fetch(
            `${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(String(duplicate.id))}`,
            { method: "DELETE", headers: backendHeaders },
          ).catch(() => null);
        }

        return json({
          success: true,
          rebound: true,
          device_id: deviceId || keep?.device_id || null,
          member_username: member,
          subscription: patchedRows?.[0] || keep || null,
        });
      }

      const insertRes = await fetch(
        `${supabaseUrl}/rest/v1/push_subscriptions`,
        {
          method: "POST",
          headers: {
            ...backendHeaders,
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            device_id: deviceId || null,
            endpoint,
            p256dh,
            auth,
            member_username: member,
            updated_at: now,
          }),
        },
      );

      if (!insertRes.ok) {
        throw new Error(`儲存推播訂閱失敗：${await insertRes.text()}`);
      }

      const insertedRows: any[] = await insertRes.json().catch(() => []);

      return json({
        success: true,
        rebound: false,
        device_id: deviceId || null,
        member_username: member,
        subscription: insertedRows?.[0] || null,
      });
    }


    const adminPassword =
      Deno.env.get(
        "ADMIN_PASSWORD",
      );

    if (!adminPassword) {
      return json(
        {
          success: false,
          error:
            "server_config_error",
          message:
            "系統設定異常",
        },
        500,
      );
    }

    const adminSupabase =
      createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            persistSession:
              false,
            autoRefreshToken:
              false,
          },
        },
      );

    const auth =
      await authorizeAdmin(
        req,
        payload,
        adminSupabase,
        adminPassword,
        "push",
      );

    if ("response" in auth) {
      return auth.response;
    }


    if (action === "count") {
      const member = String(payload?.member_username || "").trim();
      let url = `${supabaseUrl}/rest/v1/push_subscriptions?select=id,member_username,updated_at`;
      if (member) url += `&member_username=eq.${encodeURIComponent(member)}`;
      const r = await fetch(url,{headers:backendHeaders});
      if (!r.ok) throw new Error(await r.text());
      const rows = await r.json();
      return json({ success:true,count:Array.isArray(rows)?rows.length:0,devices:rows||[] });
    }

    if (action === "basketball_game_count") {
      const gameId = Number(payload?.game_id || 0);

      if (!gameId) {
        return json({
          success: false,
          error: "game_id_required",
          message: "請選擇 NBA 賽事",
        }, 400);
      }

      const target =
        await getBasketballGameAudience(
          supabaseUrl,
          backendHeaders,
          gameId,
        );

      const pushableAccounts =
        new Set(
          target.subscriptions
            .map((item:any) =>
              String(
                item?.member_username || ""
              ).trim()
            )
            .filter(Boolean)
        );

      return json({
        success: true,
        audience: "basketball_game",
        game_id: gameId,
        analysis_member_count:
          target.analyzed_accounts.length,
        active_member_count:
          target.active_accounts.length,
        push_member_count:
          pushableAccounts.size,
        device_count:
          target.subscriptions.length,
      });
    }


    if (action === "logs") {
      const r = await fetch(`${supabaseUrl}/rest/v1/push_send_logs?select=*&order=created_at.desc&limit=30`,{headers:backendHeaders});
      if (!r.ok) return json({success:true,logs:[]});
      return json({success:true,logs:await r.json()});
    }

    if (!vapidPrivateKey) throw new Error("VAPID_PRIVATE_KEY 尚未設定");
    const title = String(payload?.title || "").trim();
    const body = String(payload?.body || "").trim();
    const clickUrl = String(payload?.url || "https://awu7757-sys.github.io/habao-football-ai/home-v2.html");
    const memberUsername = String(payload?.member_username || "").trim();
    const audience = memberUsername
      ? "member"
      : ["all","vip","normal","member","basketball_game"].includes(String(payload?.audience||"all"))
        ? String(payload?.audience||"all")
        : "all";
    const basketballGameId = Number(payload?.game_id || 0);

    if (audience === "basketball_game" && !basketballGameId) {
      return json({
        success:false,
        error:"game_id_required",
        message:"請選擇 NBA 賽事",
      },400);
    }
    if (!title || !body) return json({success:false,error:"請輸入通知標題與內容"},400);

    webpush.setVapidDetails("mailto:admin@habao-football-ai.com", vapidPublicKey, vapidPrivateKey);
    let subscriptionUrl = `${supabaseUrl}/rest/v1/push_subscriptions?select=id,endpoint,p256dh,auth,member_username`;
    if (audience === "member" && memberUsername) subscriptionUrl += `&member_username=eq.${encodeURIComponent(memberUsername)}`;
    const response = await fetch(subscriptionUrl,{headers:backendHeaders});
    if (!response.ok) throw new Error(`讀取推播名單失敗：${await response.text()}`);
    let subscriptions:any[] = await response.json();

    if (audience === "vip" || audience === "normal") {
      const mr = await fetch(`${supabaseUrl}/rest/v1/members?select=account,member_level,is_active`,{headers:backendHeaders});
      if (!mr.ok) throw new Error(`讀取會員等級失敗：${await mr.text()}`);
      const members:any[] = await mr.json();
      const allowed = new Set(members.filter(m=>m?.is_active===true && String(m?.member_level||"normal").toLowerCase()===audience).map(m=>String(m?.account||"").trim()).filter(Boolean));
      subscriptions = subscriptions.filter(s=>allowed.has(String(s?.member_username||"").trim()));
    }

    if (audience === "basketball_game") {
      const target =
        await getBasketballGameAudience(
          supabaseUrl,
          backendHeaders,
          basketballGameId,
        );

      subscriptions =
        target.subscriptions;

      if (!target.analyzed_accounts.length) {
        return json({
          success:false,
          error:"no_analysis_members",
          message:"此場目前沒有會員分析紀錄",
          total:0,
          game_id:basketballGameId,
        },404);
      }
    }
    if (!subscriptions.length) return json({success:false,error:"目前沒有符合條件的推播訂閱",total:0},404);

    const message = JSON.stringify({ title, body, icon:"https://awu7757-sys.github.io/habao-football-ai/habao-icon-192.png", badge:"https://awu7757-sys.github.io/habao-football-ai/habao-icon-192.png", url:clickUrl, tag:"habao-notification" });
    let sent=0, failed=0; const expiredIds:number[]=[];
    for (const s of subscriptions) {
      try { await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},message); sent++; }
      catch(error:any){ failed++; if(error?.statusCode===404||error?.statusCode===410) expiredIds.push(s.id); console.error("PUSH ERROR",s.id,error); }
    }
    for (const id of expiredIds) await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${id}`,{method:"DELETE",headers:backendHeaders});

    const logPayload={ audience, member_username:memberUsername||null, title, body, target_url:clickUrl, found_count:subscriptions.length, accepted_count:sent, failed_count:failed, expired_count:expiredIds.length, created_at:new Date().toISOString() };
    await fetch(`${supabaseUrl}/rest/v1/push_send_logs`,{method:"POST",headers:{...backendHeaders,Prefer:"return=minimal"},body:JSON.stringify(logPayload)}).catch(()=>null);
    return json({success:true,audience,member_username:memberUsername||null,game_id:audience==="basketball_game"?basketballGameId:null,total:subscriptions.length,found:subscriptions.length,sent,accepted:sent,failed,removed_expired:expiredIds.length});
  } catch(error) {
    console.error("push-send error:",error);
    return json({success:false,error:error instanceof Error?error.message:"推播發送失敗"},500);
  }
});