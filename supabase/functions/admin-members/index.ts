import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "npm:@supabase/supabase-js@2";



function getSupabaseSecretKey() {

  const direct =

    Deno.env.get("SUPABASE_SECRET_KEY") ||

    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");



  if (direct) return direct;



  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (!raw) return "";



  try {

    const parsed = JSON.parse(raw);

    return String(parsed?.default || Object.values(parsed || {})[0] || "");

  } catch {

    return "";

  }

}



const corsHeaders = {

  "Access-Control-Allow-Origin": "*",

  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-session",

  "Access-Control-Allow-Methods": "POST, OPTIONS",

};



function json(data: unknown, status = 200) {

  return new Response(JSON.stringify(data), {

    status,

    headers: {

      ...corsHeaders,

      "Content-Type": "application/json",

    },

  });

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

Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {

    return new Response("ok", { headers: corsHeaders });

  }



  if (req.method !== "POST") {

    return json(

      {

        success: false,

        error: "method_not_allowed",

        message: "Method not allowed",

      },

      405

    );

  }



  try {

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

    const SUPABASE_SECRET_KEY = getSupabaseSecretKey();




    const ADMIN_PASSWORD =
      Deno.env.get("ADMIN_PASSWORD");

    if (
      !SUPABASE_URL ||
      !SUPABASE_SECRET_KEY ||
      !ADMIN_PASSWORD
    ) {
      console.error(
        "Missing server configuration",
      );

      return json(
        {
          success: false,
          error:
            "server_config_error",
          message:
            "系統設定異常，請稍後再試。",
        },
        500,
      );
    }

    const body =
      await req
        .json()
        .catch(() => ({}));

    const action =
      String(
        body?.action || "",
      ).trim();

    const supabase =
      createClient(
        SUPABASE_URL,
        SUPABASE_SECRET_KEY,
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
        body,
        supabase,
        ADMIN_PASSWORD,
        "members",
      );

    if ("response" in auth) {
      return auth.response;
    }


    // =========================

    // 讀取會員名單

    // =========================

    if (action === "list") {

      const { data, error } = await supabase

        .from("members")

    .select("id, created_at, account, is_active, analysis_credits, last_login_at, member_level, platform_name, platform_account, daily_free_credits, daily_free_credits_date, vip_ever_activated")

        .order("id", { ascending: false });



      if (error) {

        console.error("LIST MEMBERS ERROR:", error);



        return json(

          {

            success: false,

            error: "list_failed",

            message: "無法取得會員名單。",

          },

          500

        );

      }

    const taiwanToday = new Date().toLocaleDateString("en-CA", {

  timeZone: "Asia/Taipei",

});



const {

  count: todayAnalysisCount,

  error: todayAnalysisError,

} = await supabase

  .from("analysis_usage")

  .select("*", { count: "exact", head: true })

  .eq("usage_date", taiwanToday);



if (todayAnalysisError) {

  console.error("TODAY ANALYSIS COUNT ERROR:", todayAnalysisError);

}



  const {

  count: todayApiCount,

  error: todayApiError,

} = await supabase

  .from("api_usage")

  .select("*", { count: "exact", head: true })

  .eq("usage_date", taiwanToday);



if (todayApiError) {

  console.error("TODAY API COUNT ERROR:", todayApiError);

}



const sevenDaysAgo = new Date();

sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);



const sevenDaysAgoStr =

  sevenDaysAgo.toLocaleDateString("en-CA", {

    timeZone: "Asia/Taipei"

  });



const {

  count: last7DaysApiCount,

  error: last7DaysApiError,

} = await supabase

  .from("api_usage")

  .select("*", { count: "exact", head: true })

  .gte("usage_date", sevenDaysAgoStr)

  .lte("usage_date", taiwanToday);



if (last7DaysApiError) {

  console.error("LAST 7 DAYS API COUNT ERROR:", last7DaysApiError);

}



const { data: pushRows } = await supabase

  .from("push_subscriptions")

  .select("member_username");



const pushCountMap = new Map<string, number>();

for (const row of (pushRows ?? [])) {

  const key = String(row?.member_username || "").trim();

  if (key) pushCountMap.set(key, (pushCountMap.get(key) || 0) + 1);

}



const membersWithPush = (data || []).map((member: any) => ({

  ...member,

  push_device_count: pushCountMap.get(String(member?.account || "").trim()) || 0,

}));



return json({

  success: true,

  members: membersWithPush,

  today_analysis_count: todayAnalysisCount || 0,

  today_api_count: todayApiCount || 0,

  last_7_days_api_count: last7DaysApiCount || 0,

});

    }



    // =========================

    // 新增會員

    // =========================



if (action === "create") {

  const account = String(body?.account || "").trim();



  if (!account) {

    return json(

      {

        success: false,

        error: "account_required",

        message: "請輸入會員帳號。",

      },

      400

    );

  }



  const { data: existing, error: existingError } = await supabase

    .from("members")

    .select("id")

    .eq("account", account)

    .limit(1);



  if (existingError) {

    console.error("CHECK MEMBER ERROR:", existingError);



    return json(

      {

        success: false,

        error: "create_failed",

        message: "新增會員失敗。",

      },

      500

    );

  }



  if (existing && existing.length > 0) {

    return json(

      {

        success: false,

        error: "account_exists",

        message: "此會員帳號已存在。",

      },

      409

    );

  }



  const { data, error } = await supabase

    .from("members")

    .insert({

      account,

      is_active: true,

      member_level: "normal",

      analysis_credits: 0,

      daily_free_credits: 0,

      vip_ever_activated: false,

    })

    .select(

      "id, created_at, account, is_active, member_level, analysis_credits, daily_free_credits, daily_free_credits_date, vip_ever_activated, platform_account"

    )

    .single();



  if (error) {

    console.error("CREATE MEMBER ERROR:", error);



    return json(

      {

        success: false,

        error: "create_failed",

        message: "新增會員失敗。",

      },

      500

    );

  }



  return json({

    success: true,

    message: "會員新增成功。",

    member: data,

  });

}



    // ========================

// 修改會員積分

// ========================



if (action === "update_credits") {

  const id = Number(body?.id);

  const analysisCredits = Number(body?.analysis_credits);



  if (

    !id ||

    !Number.isInteger(analysisCredits) ||

    analysisCredits < 0

  ) {

    return json(

      {

        success: false,

        error: "invalid_request",

        message: "會員資料或積分數量不正確。",

      },

      400

    );

  }



  const { data, error } = await supabase

    .from("members")

    .update({

      analysis_credits: analysisCredits,

    })

    .eq("id", id)

    .select(

      "id, account, is_active, member_level, analysis_credits, daily_free_credits, daily_free_credits_date"

    )

    .single();



  if (error) {

    console.error("UPDATE CREDITS ERROR:", error);



    return json(

      {

        success: false,

        error: "update_failed",

        message: "修改會員積分失敗。",

      },

      500

    );

  }



  return json({

    success: true,

    message: "會員積分已更新。",

    member: data,

  });

}



// =========================

// 修改會員等級

// =========================

if (action === "update_member_level") {

  const id = Number(body?.id);



  const memberLevel =

    String(body?.member_level || "")

      .trim()

      .toLowerCase();



  if (

    !id ||

    !["normal", "vip"].includes(memberLevel)

  ) {

    return json(

      {

        success: false,

        error: "invalid_request",

        message: "會員等級資料不正確。",

      },

      400

    );

  }



  const { data: existingMember, error: findError } =

    await supabase

      .from("members")

      .select(

        "id, account, member_level, vip_ever_activated, platform_account"

      )

      .eq("id", id)

      .single();



  if (findError || !existingMember) {

    console.error(

      "FIND MEMBER FOR LEVEL UPDATE ERROR:",

      findError

    );



    return json(

      {

        success: false,

        error: "member_not_found",

        message: "找不到會員資料。",

      },

      404

    );

  }



const updateData = {

  member_level: memberLevel,

};



if (memberLevel === "vip") {

  updateData.vip_ever_activated = true;

}



if (memberLevel === "normal") {

  updateData.daily_free_credits = 0;

  updateData.daily_free_credits_date = null;

}



const { data, error } = await supabase



    .from("members")

    .update(updateData)

    .eq("id", id)

    .select(

      "id, account, is_active, member_level, vip_ever_activated, platform_account, analysis_credits, daily_free_credits, daily_free_credits_date"

    )

    .single();



  if (error) {

    console.error(

      "UPDATE MEMBER LEVEL ERROR:",

      error

    );



    return json(

      {

        success: false,

        error: "update_failed",

        message: "修改會員等級失敗。",

      },

      500

    );

  }



  return json({

    success: true,

    message:

      memberLevel === "vip"

        ? "會員已升級為 VIP。"

        : "會員已降為一般會員。",

    member: data,

  });

}



    // =========================
    // 修改會員綁定平台 / 平台帳號
    // =========================

    if (action === "update_platform_binding") {
      const id = Number(body?.id || 0);
      const platformId = Number(body?.platform_id || 0);
      const platformAccount =
        String(body?.platform_account || "").trim();

      if (
        !id ||
        !platformId ||
        !platformAccount
      ) {
        return json(
          {
            success: false,
            error: "invalid_binding_request",
            message: "請選擇合作平台並輸入平台帳號。",
          },
          400
        );
      }

      const {
        data: memberRow,
        error: memberError,
      } = await supabase
        .from("members")
        .select("id,account,member_level,vip_ever_activated,platform_name,platform_account")
        .eq("id", id)
        .maybeSingle();

      if (memberError) {
        console.error(
          "FIND MEMBER FOR BINDING UPDATE ERROR:",
          memberError
        );

        return json(
          {
            success: false,
            error: "member_lookup_failed",
            message: "讀取會員資料失敗。",
          },
          500
        );
      }

      if (!memberRow) {
        return json(
          {
            success: false,
            error: "member_not_found",
            message: "找不到會員資料。",
          },
          404
        );
      }

      const {
        data: platformRow,
        error: platformError,
      } = await supabase
        .from("partner_platforms")
        .select("id,slug,name,display_name,enabled")
        .eq("id", platformId)
        .maybeSingle();

      if (platformError) {
        console.error(
          "FIND PARTNER PLATFORM ERROR:",
          platformError
        );

        return json(
          {
            success: false,
            error: "platform_lookup_failed",
            message: "讀取合作平台失敗。",
          },
          500
        );
      }

      if (!platformRow) {
        return json(
          {
            success: false,
            error: "platform_not_found",
            message: "找不到合作平台。",
          },
          404
        );
      }

      if (platformRow.enabled !== true) {
        return json(
          {
            success: false,
            error: "platform_disabled",
            message: "此合作平台目前已停用，請先啟用平台或選擇其他平台。",
          },
          409
        );
      }

      const platformKeys =
        new Set(
          [
            platformRow.slug,
            platformRow.name,
            platformRow.display_name,
          ]
            .map(value =>
              String(value || "")
                .trim()
                .toLowerCase()
            )
            .filter(Boolean)
        );

      const accountKey =
        platformAccount.toLowerCase();

      const {
        data: otherBindings,
        error: bindingCheckError,
      } = await supabase
        .from("members")
        .select("id,account,platform_name,platform_account")
        .neq("id", id)
        .not("platform_account", "is", null);

      if (bindingCheckError) {
        console.error(
          "CHECK DUPLICATE PLATFORM BINDING ERROR:",
          bindingCheckError
        );

        return json(
          {
            success: false,
            error: "binding_check_failed",
            message: "檢查平台帳號綁定狀態失敗。",
          },
          500
        );
      }

      const duplicate =
        (otherBindings || []).find(
          (row: any) => {
            const rowAccount =
              String(
                row?.platform_account || ""
              )
                .trim()
                .toLowerCase();

            const rowPlatform =
              String(
                row?.platform_name || ""
              )
                .trim()
                .toLowerCase();

            return (
              rowAccount === accountKey &&
              platformKeys.has(
                rowPlatform
              )
            );
          }
        );

      if (duplicate) {
        return json(
          {
            success: false,
            error: "platform_account_already_bound",
            message:
              `此平台帳號已綁定其他 HABAO 會員：${duplicate.account || "未知會員"}。`,
          },
          409
        );
      }

      const {
        data,
        error,
      } = await supabase
        .from("members")
        .update({
          platform_name:
            String(
              platformRow.name || ""
            ).trim(),
          platform_account:
            platformAccount,
        })
        .eq("id", id)
        .select(
          "id,account,is_active,member_level,vip_ever_activated,platform_name,platform_account,analysis_credits,daily_free_credits,daily_free_credits_date"
        )
        .single();

      if (error) {
        console.error(
          "UPDATE PLATFORM BINDING ERROR:",
          error
        );

        return json(
          {
            success: false,
            error: "binding_update_failed",
            message: "修改會員綁定資料失敗。",
          },
          500
        );
      }

      return json({
        success: true,
        message: "會員綁定資料已更新。",
        member: data,
      });
    }


    // =========================

    // 啟用 / 停權

    // =========================

    if (action === "set_active") {

      const id = Number(body?.id);

      const isActive = body?.is_active === true;



      if (!id) {

        return json(

          {

            success: false,

            error: "invalid_request",

            message: "會員資料不完整。",

          },

          400

        );

      }



      const { data, error } = await supabase

        .from("members")

        .update({

          is_active: isActive,

        })

        .eq("id", id)

        .select("id, created_at, account, is_active")

        .single();



      if (error) {

        console.error("SET ACTIVE ERROR:", error);



        return json(

          {

            success: false,

            error: "update_failed",

            message: "會員狀態修改失敗。",

          },

          500

        );

      }



      return json({

        success: true,

        message: isActive ? "會員已恢復使用。" : "會員已停權。",

        member: data,

      });

    }



    return json(

      {

        success: false,

        error: "unknown_action",

        message: "無效的管理操作。",

      },

      400

    );

  } catch (error) {

    console.error("ADMIN MEMBERS ERROR:", error);



    return json(

      {

        success: false,

        error: "server_error",

        message: "系統暫時無法處理，請稍後再試。",

      },

      500

    );

  }

});