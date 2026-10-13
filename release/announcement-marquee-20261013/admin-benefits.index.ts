import { createClient } from "npm:@supabase/supabase-js@2";



const corsHeaders = {

  "Access-Control-Allow-Origin": "*",

  "Access-Control-Allow-Headers":

    "authorization, x-client-info, apikey, content-type, x-admin-session",

  "Access-Control-Allow-Methods": "POST, OPTIONS",

};





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



  try {

    if (req.method !== "POST") {

      return json({ success: false, message: "Method not allowed" }, 405);

    }



    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;



    const supabase = createClient(

      SUPABASE_URL,

      SERVICE_ROLE_KEY

    );



    const body = await req.json();

    const {

  action,

  admin_password,

  title,

  image_base64,

  image_type,

  image_name,

  link_url,

  sort_order,

  normal_announcement,

  maintenance_announcement,

  normal_enabled,

  normal_marquee_enabled,
  maintenance_enabled

} = body;



    /*

      與 admin-members 共用後台密碼。

      如果目前 Secrets 使用的名稱不同，

      下一步再依你的 admin-members 調整。

    */



    // ========================

// 前台公開讀取公告 / 維護狀態

// 不需要管理員密碼

// ========================

if (action === "get_public_settings") {

  const { data, error } = await supabase

    .from("site_settings")

    .select(

      "normal_announcement,maintenance_announcement,normal_enabled,normal_marquee_enabled,maintenance_enabled,updated_at"

    )

    .eq("id", 1)

    .single();



  if (error) throw error;



  return json({

    success: true,

    settings: {

      normal_announcement:

        data?.normal_announcement ?? "",

      maintenance_announcement:

        data?.maintenance_announcement ?? "",

      normal_enabled:

        data?.normal_enabled === true,

      normal_marquee_enabled:
        data?.normal_marquee_enabled === true,
      maintenance_enabled:

        data?.maintenance_enabled === true

    }

  });

}





    const ADMIN_PASSWORD =

      Deno.env.get("ADMIN_PASSWORD");



    if (!ADMIN_PASSWORD) {

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



    const requiredPermission =

      ["confirm_api_renewal", "get_api_settings"].includes(action)

        ? "api"

        : "announcements";



    const auth =

      await authorizeAdmin(

        req,

        body,

        supabase,

        ADMIN_PASSWORD,

        requiredPermission,

      );



    if ("response" in auth) {

      return auth.response;

    }





    // =========================

    // 取得福利列表

    // =========================

    if (action === "list") {

      const { data, error } = await supabase

        .from("benefits")

        .select(

          "id,title,image_url,link_url,sort_order,is_active,created_at"

        )

        .order("sort_order", { ascending: true })

        .order("created_at", { ascending: false });



      if (error) throw error;



      return json({

        success: true,

        benefits: data ?? [],

      });

    }

    // ========================

// API 配額設定（只回傳 API 欄位）

// ========================

if (action === "get_api_settings") {

  const { data, error } = await supabase

    .from("site_settings")

    .select("id,api_daily_limit,api_renewal_date,updated_at")

    .order("id", { ascending: true })

    .limit(1)

    .single();



  if (error) throw error;



  return json({

    success: true,

    settings: data

  });

}



// ========================

// 取得公告設定

// ========================

if (action === "get_settings") {

  const { data, error } = await supabase

    .from("site_settings")

    .select(

    "id,normal_announcement,maintenance_announcement,normal_enabled,normal_marquee_enabled,maintenance_enabled,api_daily_limit,api_renewal_date,updated_at"

    )

    .order("id", { ascending: true })

    .limit(1)

    .single();



  if (error) throw error;



  return json({

    success: true,

    settings: data

  });

}

// ========================

// 儲存公告設定

// ========================

if (action === "save_settings") {

  const { data, error } = await supabase

    .from("site_settings")

    .update({

      normal_announcement: normal_announcement ?? "",

      maintenance_announcement: maintenance_announcement ?? "",

      normal_enabled: normal_enabled === true,

      normal_marquee_enabled: normal_marquee_enabled === true,
      maintenance_enabled: maintenance_enabled === true,

      updated_at: new Date().toISOString()

    })

    .eq("id", 1)

    .select(

      "id,normal_announcement,maintenance_announcement,normal_enabled,normal_marquee_enabled,maintenance_enabled,updated_at"

    )

    .single();



  if (error) throw error;



  return json({

    success: true,

    settings: data

  });

}



    // ========================

// 確認 API 已續費：確認日 + 1 個月

// ========================

if (action === "confirm_api_renewal") {

  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Taipei" }));

  const target = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

  const nextDate = `${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,"0")}-${String(target.getDate()).padStart(2,"0")}`;

  const { data, error } = await supabase

    .from("site_settings")

    .update({ api_renewal_date: nextDate, updated_at: new Date().toISOString() })

    .eq("id", 1)

    .select("id,api_renewal_date,updated_at")

    .single();

  if (error) throw error;

  return json({ success: true, settings: data, message: `續費日期已更新為 ${nextDate}` });

}



    // ========================

// 啟用 / 停用福利

// ========================

if (action === "toggle") {

  const { id, is_active } = body;



  if (!id || typeof is_active !== "boolean") {

    return json(

      {

        success: false,

        message: "缺少福利 ID 或狀態",

      },

      400

    );

  }



  const { data, error } = await supabase

    .from("benefits")

    .update({

      is_active: is_active,

    })

    .eq("id", id)

    .select("id,title,is_active")

    .single();



  if (error) throw error;



  return json({

    success: true,

    benefit: data,

  });

}

  // ========================

// 刪除福利

// ========================

if (action === "delete") {

  const { id } = body;



  if (!id) {

    return json(

      {

        success: false,

        message: "缺少福利 ID",

      },

      400

    );

  }



  // 先取得福利資料，後面用來刪除圖片

  const { data: benefit, error: getError } = await supabase

    .from("benefits")

    .select("id,image_url")

    .eq("id", id)

    .single();



  if (getError) throw getError;



  // 刪除資料庫紀錄

  const { error: deleteError } = await supabase

    .from("benefits")

    .delete()

    .eq("id", id);



  if (deleteError) throw deleteError;



  return json({

    success: true,

    message: "福利已刪除",

    benefit: benefit,

  });

}



    // =========================

    // 新增福利

    // =========================

    if (action === "create") {

      if (!title || !image_base64) {

        return json(

          {

            success: false,

            message: "活動名稱與活動圖片為必填",

          },

          400

        );

      }



      const base64Data = image_base64.includes(",")

        ? image_base64.split(",")[1]

        : image_base64;



      const binary = Uint8Array.from(

        atob(base64Data),

        (c) => c.charCodeAt(0)

      );



      const extension =

        image_type === "image/png"

          ? "png"

          : image_type === "image/webp"

          ? "webp"

          : "jpg";



      const safeName =

        `${Date.now()}-${crypto.randomUUID()}.${extension}`;



      const { error: uploadError } = await supabase.storage

        .from("benefits-images")

        .upload(safeName, binary, {

          contentType: image_type || "image/jpeg",

          upsert: false,

        });



      if (uploadError) throw uploadError;



      const { data: publicUrlData } = supabase.storage

        .from("benefits-images")

        .getPublicUrl(safeName);



      const imageUrl = publicUrlData.publicUrl;



      const { data, error } = await supabase

        .from("benefits")

        .insert({

          title: title.trim(),

          image_url: imageUrl,

          link_url: link_url?.trim() || null,

          sort_order: Number(sort_order) || 0,

          is_active: true,

        })

        .select()

        .single();



      if (error) {

        await supabase.storage

          .from("benefits-images")

          .remove([safeName]);



        throw error;

      }



      return json({

        success: true,

        message: "福利活動新增成功",

        benefit: data,

      });

    }



    return json(

      {

        success: false,

        message: "未知操作",

      },

      400

    );

  } catch (error) {

    console.error("ADMIN BENEFITS ERROR:", error);



    return json(

      {

        success: false,

        message:

          error instanceof Error

            ? error.message

            : "系統發生錯誤",

      },

      500

    );

  }

});



function json(data: unknown, status = 200) {

  return new Response(JSON.stringify(data), {

    status,

    headers: {

      ...corsHeaders,

      "Content-Type": "application/json; charset=utf-8",

    },

  });

}