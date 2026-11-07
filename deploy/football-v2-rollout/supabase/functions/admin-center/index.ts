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

  "Access-Control-Allow-Headers":

    "authorization, x-client-info, apikey, content-type, x-admin-session",

  "Access-Control-Allow-Methods": "POST, OPTIONS",

};



function json(data: unknown, status = 200) {

  return new Response(JSON.stringify(data), {

    status,

    headers: {

      ...corsHeaders,

      "Content-Type": "application/json; charset=utf-8",

    },

  });

}



function taipeiDate(offsetDays = 0) {

  const now = new Date(

    new Date().toLocaleString("en-US", {

      timeZone: "Asia/Taipei",

    }),

  );



  now.setDate(now.getDate() + offsetDays);



  return (

    now.getFullYear() +

    "-" +

    String(now.getMonth() + 1).padStart(2, "0") +

    "-" +

    String(now.getDate()).padStart(2, "0")

  );

}



function startOfTaipeiDayIso(offsetDays = 0) {

  const date = taipeiDate(offsetDays);

  return new Date(`${date}T00:00:00+08:00`).toISOString();

}



function getBackendHeaders(secretKey: string) {

  const headers: Record<string, string> = {

    "Content-Type": "application/json",

    apikey: secretKey,

  };



  if (!secretKey.startsWith("sb_secret_")) {

    headers.Authorization = `Bearer ${secretKey}`;

  }



  return headers;

}



async function safeCount(

  supabase: any,

  table: string,

  configure?: (query: any) => any,

) {

  try {

    let query = supabase

      .from(table)

      .select("*", {

        count: "exact",

        head: true,

      });



    if (configure) {

      query = configure(query);

    }



    const { count, error } = await query;



    if (error) {

      return {

        ok: false,

        count: 0,

        error: error.message,

      };

    }



    return {

      ok: true,

      count: count ?? 0,

      error: null,

    };

  } catch (error) {

    return {

      ok: false,

      count: 0,

      error:

        error instanceof Error

          ? error.message

          : String(error),

    };

  }

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


const ALL_ADMIN_PERMISSIONS = [
  "dashboard",
  "members",
  "announcements",
  "push",
  "api",
  "analysis_logs",
  "analysis_jobs",
  "fixtures",
  "performance",
  "partners",
  "health",
] as const;

const ADMIN_SESSION_HOURS = 8;
const ADMIN_PASSWORD_ITERATIONS = 210000;

function normalizeAdminPermissions(
  input: unknown,
) {
  const allowed =
    new Set<string>(
      ALL_ADMIN_PERMISSIONS,
    );

  if (!Array.isArray(input)) {
    return [];
  }

  return Array.from(
    new Set(
      input
        .map((item) =>
          String(item || "")
            .trim(),
        )
        .filter((item) =>
          allowed.has(item),
        ),
    ),
  );
}

function bytesToBase64(
  bytes: Uint8Array,
) {
  let binary = "";

  bytes.forEach((byte) => {
    binary +=
      String.fromCharCode(byte);
  });

  return btoa(binary);
}

function base64ToBytes(
  value: string,
) {
  const binary =
    atob(value);

  const bytes =
    new Uint8Array(
      binary.length,
    );

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes;
}

function randomBase64(
  size = 32,
) {
  const bytes =
    new Uint8Array(size);

  crypto.getRandomValues(bytes);

  return bytesToBase64(bytes);
}

function randomSessionToken() {
  const bytes =
    new Uint8Array(32);

  crypto.getRandomValues(bytes);

  return (
    "ha_" +
    Array.from(bytes)
      .map((byte) =>
        byte
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

async function hashAdminPassword(
  password: string,
  saltBase64: string,
  iterations =
    ADMIN_PASSWORD_ITERATIONS,
) {
  const encoder =
    new TextEncoder();

  const material =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );

  const bits =
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt:
          base64ToBytes(
            saltBase64,
          ),
        iterations,
        hash: "SHA-256",
      },
      material,
      256,
    );

  return bytesToBase64(
    new Uint8Array(bits),
  );
}

function getAdminClientKey(
  req: Request,
) {
  const forwarded =
    String(
      req.headers.get(
        "x-forwarded-for",
      ) || "",
    )
      .split(",")[0]
      .trim();

  const ip =
    String(
      req.headers.get(
        "cf-connecting-ip",
      ) ||
        forwarded ||
        "unknown",
    ).trim();

  const userAgent =
    String(
      req.headers.get(
        "user-agent",
      ) || "",
    ).slice(0, 180);

  return `${ip}|${userAgent}`;
}

async function loginAttemptKey(
  req: Request,
  username: string,
) {
  return sha256Hex(
    `${
      username ||
      "__super__"
    }|${getAdminClientKey(req)}`,
  );
}

async function checkLoginLock(
  supabase: any,
  attemptKey: string,
) {
  try {
    const {
      data,
      error,
    } = await supabase
      .from(
        "admin_login_attempts",
      )
      .select(
        "failed_count,locked_until",
      )
      .eq(
        "attempt_key",
        attemptKey,
      )
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const lockedUntil =
      data.locked_until
        ? new Date(
            data.locked_until,
          ).getTime()
        : 0;

    if (
      lockedUntil >
      Date.now()
    ) {
      return data.locked_until;
    }

    return null;
  } catch {
    return null;
  }
}

async function recordLoginFailure(
  supabase: any,
  attemptKey: string,
) {
  try {
    const now =
      new Date();

    const {
      data: current,
    } = await supabase
      .from(
        "admin_login_attempts",
      )
      .select(
        "failed_count,first_failed_at",
      )
      .eq(
        "attempt_key",
        attemptKey,
      )
      .maybeSingle();

    const firstFailedAt =
      current?.first_failed_at
        ? new Date(
            current
              .first_failed_at,
          ).getTime()
        : 0;

    const withinWindow =
      firstFailedAt &&
      Date.now() -
        firstFailedAt <
        30 * 60 * 1000;

    const failedCount =
      withinWindow
        ? Number(
            current
              ?.failed_count ||
              0,
          ) + 1
        : 1;

    const lockedUntil =
      failedCount >= 5
        ? new Date(
            Date.now() +
              15 *
                60 *
                1000,
          ).toISOString()
        : null;

    await supabase
      .from(
        "admin_login_attempts",
      )
      .upsert(
        {
          attempt_key:
            attemptKey,
          failed_count:
            failedCount,
          first_failed_at:
            withinWindow
              ? current
                  ?.first_failed_at
              : now.toISOString(),
          last_failed_at:
            now.toISOString(),
          locked_until:
            lockedUntil,
        },
        {
          onConflict:
            "attempt_key",
        },
      );
  } catch {
    // Rate limit failure must not break admin login.
  }
}

async function clearLoginFailure(
  supabase: any,
  attemptKey: string,
) {
  try {
    await supabase
      .from(
        "admin_login_attempts",
      )
      .delete()
      .eq(
        "attempt_key",
        attemptKey,
      );
  } catch {
    // Ignore cleanup failure.
  }
}

async function issueAdminSession(
  supabase: any,
  params: {
    admin_user_id:
      | number
      | null;
    is_super_admin:
      boolean;
  },
) {
  const token =
    randomSessionToken();

  const tokenHash =
    await sha256Hex(token);

  const expiresAt =
    new Date(
      Date.now() +
        ADMIN_SESSION_HOURS *
          60 *
          60 *
          1000,
    ).toISOString();

  const {
    error,
  } = await supabase
    .from("admin_sessions")
    .insert({
      token_hash:
        tokenHash,
      admin_user_id:
        params
          .admin_user_id,
      is_super_admin:
        params
          .is_super_admin,
      expires_at:
        expiresAt,
      created_at:
        new Date()
          .toISOString(),
      last_seen_at:
        new Date()
          .toISOString(),
    });

  if (error) {
    throw error;
  }

  return {
    token,
    expires_at:
      expiresAt,
  };
}

function adminCenterPermissionForAction(
  action: string,
) {
  const map:
    Record<string, string> = {
      overview:
        "dashboard",
      analysis_history:
        "analysis_logs",
      jobs:
        "analysis_jobs",
      retry_job:
        "analysis_jobs",
      fixtures:
        "fixtures",
      fixture_live_push_toggle:
        "fixtures",
      refresh_fixtures:
        "fixtures",
      performance:
        "performance",
      performance_toggle_excluded:
        "performance",
      performance_delete:
        "performance",
      validate_overdue_performance:
        "performance",
      run_public_runner:
        "performance",
      football_v2_rollout_get:
        "performance",
      football_v2_rollout_update:
        "performance",
      partners:
        "partners",
      partner_save:
        "partners",
      partner_toggle:
        "partners",
      partner_delete:
        "partners",
      api_stats:
        "api",
      health:
        "health",
      clear_expired_locks:
        "health",
    };

  return map[action] || "";
}

function adminProfileResponse(
  context: AdminAuthContext,
) {
  return {
    is_super_admin:
      context
        .is_super_admin,
    id:
      context
        .admin_user_id,
    username:
      context.username,
    display_name:
      context
        .display_name,
    permissions:
      context
        .is_super_admin
        ? [
            ...ALL_ADMIN_PERMISSIONS,
            "admin_users",
          ]
        : context
            .permissions,
  };
}

Deno.serve(async (req) => {

  if (req.method === "OPTIONS") {

    return new Response("ok", {

      headers: corsHeaders,

    });

  }



  if (req.method !== "POST") {

    return json(

      {

        success: false,

        error: "method_not_allowed",

      },

      405,

    );

  }



  try {

    const SUPABASE_URL =

      Deno.env.get("SUPABASE_URL");



    const SECRET_KEY = getSupabaseSecretKey();




    const ADMIN_PASSWORD =
      Deno.env.get("ADMIN_PASSWORD");

    if (
      !SUPABASE_URL ||
      !SECRET_KEY ||
      !ADMIN_PASSWORD
    ) {
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

    // =====================================================
    // ADMIN AUTH LOGIN
    // =====================================================
    if (
      action ===
      "auth_login"
    ) {
      const username =
        String(
          body?.username || "",
        )
          .trim()
          .toLowerCase();

      const password =
        String(
          body?.password ||
          body?.admin_password ||
          "",
        );

      if (!password) {
        return json(
          {
            success: false,
            error:
              "password_required",
            message:
              "請輸入管理密碼",
          },
          400,
        );
      }

      const attemptKey =
        await loginAttemptKey(
          req,
          username,
        );

      const lockedUntil =
        await checkLoginLock(
          supabase,
          attemptKey,
        );

      if (lockedUntil) {
        return json(
          {
            success: false,
            error:
              "login_locked",
            message:
              "登入失敗次數過多，請稍後再試",
            locked_until:
              lockedUntil,
          },
          429,
        );
      }

      // 沒填帳號 = Super Admin
      if (!username) {
        if (
          !timingSafeEqualText(
            password,
            ADMIN_PASSWORD,
          )
        ) {
          await recordLoginFailure(
            supabase,
            attemptKey,
          );

          return json(
            {
              success: false,
              error:
                "unauthorized",
              message:
                "管理密碼錯誤",
            },
            401,
          );
        }

        await clearLoginFailure(
          supabase,
          attemptKey,
        );

        const session =
          await issueAdminSession(
            supabase,
            {
              admin_user_id:
                null,
              is_super_admin:
                true,
            },
          );

        return json({
          success: true,
          session_token:
            session.token,
          expires_at:
            session.expires_at,
          admin: {
            is_super_admin:
              true,
            id: null,
            username:
              "super-admin",
            display_name:
              "Super Admin",
            permissions: [
              ...ALL_ADMIN_PERMISSIONS,
              "admin_users",
            ],
          },
        });
      }

      const {
        data: adminUser,
        error: adminUserError,
      } = await supabase
        .from("admin_users")
        .select(
          "id,username,display_name,password_hash,password_salt,password_iterations,permissions,is_active",
        )
        .eq(
          "username",
          username,
        )
        .maybeSingle();

      if (
        adminUserError ||
        !adminUser ||
        adminUser.is_active !==
          true
      ) {
        await recordLoginFailure(
          supabase,
          attemptKey,
        );

        return json(
          {
            success: false,
            error:
              "unauthorized",
            message:
              "管理員帳號或密碼錯誤",
          },
          401,
        );
      }

      const passwordHash =
        await hashAdminPassword(
          password,
          String(
            adminUser
              .password_salt ||
            "",
          ),
          Number(
            adminUser
              .password_iterations ||
            ADMIN_PASSWORD_ITERATIONS,
          ),
        );

      if (
        !timingSafeEqualText(
          passwordHash,
          String(
            adminUser
              .password_hash ||
            "",
          ),
        )
      ) {
        await recordLoginFailure(
          supabase,
          attemptKey,
        );

        return json(
          {
            success: false,
            error:
              "unauthorized",
            message:
              "管理員帳號或密碼錯誤",
          },
          401,
        );
      }

      await clearLoginFailure(
        supabase,
        attemptKey,
      );

      const session =
        await issueAdminSession(
          supabase,
          {
            admin_user_id:
              Number(
                adminUser.id,
              ),
            is_super_admin:
              false,
          },
        );

      await supabase
        .from("admin_users")
        .update({
          last_login_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          adminUser.id,
        );

      return json({
        success: true,
        session_token:
          session.token,
        expires_at:
          session.expires_at,
        admin: {
          is_super_admin:
            false,
          id:
            Number(
              adminUser.id,
            ),
          username:
            String(
              adminUser
                .username ||
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
          permissions:
            normalizeAdminPermissions(
              adminUser
                .permissions,
            ),
        },
      });
    }

    // =====================================================
    // AUTHENTICATED ADMIN CONTEXT
    // =====================================================
    const requiredPermission =
      adminCenterPermissionForAction(
        action,
      );

    const auth =
      await authorizeAdmin(
        req,
        body,
        supabase,
        ADMIN_PASSWORD,
        requiredPermission ||
          undefined,
      );

    if ("response" in auth) {
      return auth.response;
    }

    const adminContext =
      auth.context;

    if (
      action ===
      "auth_me"
    ) {
      return json({
        success: true,
        admin:
          adminProfileResponse(
            adminContext,
          ),
      });
    }

    if (
      action ===
      "auth_logout"
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

        await supabase
          .from(
            "admin_sessions",
          )
          .update({
            revoked_at:
              new Date()
                .toISOString(),
          })
          .eq(
            "token_hash",
            tokenHash,
          );
      }

      return json({
        success: true,
      });
    }

    // =====================================================
    // ADMIN USER MANAGEMENT
    // Super Admin only
    // =====================================================
    if (
      action.startsWith(
        "admin_users_",
      ) &&
      !adminContext
        .is_super_admin
    ) {
      return json(
        {
          success: false,
          error:
            "permission_denied",
          message:
            "只有 Super Admin 可以管理後台管理員",
        },
        403,
      );
    }

    if (
      action ===
      "admin_users_list"
    ) {
      const {
        data,
        error,
      } = await supabase
        .from("admin_users")
        .select(
          "id,username,display_name,permissions,is_active,created_by,created_at,updated_at,last_login_at",
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          },
        );

      if (error) {
        throw error;
      }

      return json({
        success: true,
        admins:
          data ?? [],
      });
    }

    if (
      action ===
      "admin_users_create"
    ) {
      const username =
        String(
          body?.username || "",
        )
          .trim()
          .toLowerCase();

      const displayName =
        String(
          body?.display_name ||
          "",
        ).trim();

      const password =
        String(
          body?.password || "",
        );

      if (
        !/^[a-z0-9._-]{3,32}$/.test(
          username,
        )
      ) {
        return json(
          {
            success: false,
            error:
              "invalid_username",
            message:
              "管理員帳號需為 3–32 碼英數字，可使用 . _ -",
          },
          400,
        );
      }

      if (
        password.length < 8
      ) {
        return json(
          {
            success: false,
            error:
              "weak_password",
            message:
              "管理員密碼至少需要 8 碼",
          },
          400,
        );
      }

      const permissions =
        normalizeAdminPermissions(
          body?.permissions,
        );

      const salt =
        randomBase64(18);

      const passwordHash =
        await hashAdminPassword(
          password,
          salt,
        );

      const {
        data,
        error,
      } = await supabase
        .from("admin_users")
        .insert({
          username,
          display_name:
            displayName ||
            username,
          password_hash:
            passwordHash,
          password_salt:
            salt,
          password_iterations:
            ADMIN_PASSWORD_ITERATIONS,
          permissions,
          is_active:
            body?.is_active !==
            false,
          created_by:
            adminContext
              .username ||
            "super-admin",
          created_at:
            new Date()
              .toISOString(),
          updated_at:
            new Date()
              .toISOString(),
        })
        .select(
          "id,username,display_name,permissions,is_active,created_by,created_at,updated_at,last_login_at",
        )
        .single();

      if (error) {
        const duplicate =
          String(
            error?.code ||
            "",
          ) === "23505";

        return json(
          {
            success: false,
            error:
              duplicate
                ? "username_exists"
                : "admin_create_failed",
            message:
              duplicate
                ? "此管理員帳號已存在"
                : error.message,
          },
          duplicate
            ? 409
            : 400,
        );
      }

      return json({
        success: true,
        admin: data,
      });
    }

    if (
      action ===
      "admin_users_update"
    ) {
      const id =
        Number(
          body?.id || 0,
        );

      if (!id) {
        return json(
          {
            success: false,
            error:
              "admin_id_required",
            message:
              "缺少管理員 ID",
          },
          400,
        );
      }

      const updateData:
        Record<string, any> = {
          updated_at:
            new Date()
              .toISOString(),
      };

      if (
        body
          ?.display_name !==
        undefined
      ) {
        updateData
          .display_name =
          String(
            body
              .display_name ||
            "",
          ).trim();
      }

      if (
        body?.permissions !==
        undefined
      ) {
        updateData
          .permissions =
          normalizeAdminPermissions(
            body
              .permissions,
          );
      }

      const {
        data,
        error,
      } = await supabase
        .from("admin_users")
        .update(updateData)
        .eq("id", id)
        .select(
          "id,username,display_name,permissions,is_active,created_by,created_at,updated_at,last_login_at",
        )
        .single();

      if (error) {
        throw error;
      }

      return json({
        success: true,
        admin: data,
      });
    }

    if (
      action ===
      "admin_users_toggle"
    ) {
      const id =
        Number(
          body?.id || 0,
        );

      if (!id) {
        return json(
          {
            success: false,
            error:
              "admin_id_required",
          },
          400,
        );
      }

      const isActive =
        body?.is_active ===
        true;

      const {
        data,
        error,
      } = await supabase
        .from("admin_users")
        .update({
          is_active:
            isActive,
          updated_at:
            new Date()
              .toISOString(),
        })
        .eq("id", id)
        .select(
          "id,username,display_name,permissions,is_active,created_by,created_at,updated_at,last_login_at",
        )
        .single();

      if (error) {
        throw error;
      }

      if (!isActive) {
        await supabase
          .from(
            "admin_sessions",
          )
          .update({
            revoked_at:
              new Date()
                .toISOString(),
          })
          .eq(
            "admin_user_id",
            id,
          )
          .is(
            "revoked_at",
            null,
          );
      }

      return json({
        success: true,
        admin: data,
      });
    }

    if (
      action ===
      "admin_users_reset_password"
    ) {
      const id =
        Number(
          body?.id || 0,
        );

      const password =
        String(
          body?.password || "",
        );

      if (
        !id ||
        password.length < 8
      ) {
        return json(
          {
            success: false,
            error:
              "invalid_password_reset",
            message:
              "請輸入至少 8 碼的新密碼",
          },
          400,
        );
      }

      const salt =
        randomBase64(18);

      const passwordHash =
        await hashAdminPassword(
          password,
          salt,
        );

      const {
        error,
      } = await supabase
        .from("admin_users")
        .update({
          password_hash:
            passwordHash,
          password_salt:
            salt,
          password_iterations:
            ADMIN_PASSWORD_ITERATIONS,
          updated_at:
            new Date()
              .toISOString(),
        })
        .eq("id", id);

      if (error) {
        throw error;
      }

      await supabase
        .from("admin_sessions")
        .update({
          revoked_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "admin_user_id",
          id,
        )
        .is(
          "revoked_at",
          null,
        );

      return json({
        success: true,
        message:
          "管理員密碼已重設，既有登入已登出",
      });
    }


    // =====================================================

    // OVERVIEW

    // =====================================================

    if (action === "overview") {

      const today = taipeiDate(0);

      const tomorrow = taipeiDate(1);

      const sevenDaysAgo = taipeiDate(-6);



      const [

        membersResult,

        analysisToday,

        apiToday,

        api7,

        pendingSnapshots,

        verifiedSnapshots,

        runningJobs,

        failedJobs,

        processingLocks,

        fixtureRowsResult,

      ] = await Promise.all([

        supabase

          .from("members")

          .select(

            "id,account,is_active,member_level,last_login_at,platform_name,platform_account,analysis_credits,daily_free_credits",

          )

          .order("id", {

            ascending: false,

          }),



        safeCount(

          supabase,

          "analysis_usage",

          (q) =>

            q.eq(

              "usage_date",

              today,

            ),

        ),



        safeCount(

          supabase,

          "api_usage",

          (q) =>

            q.eq(

              "usage_date",

              today,

            ),

        ),



        safeCount(

          supabase,

          "api_usage",

          (q) =>

            q

              .gte(

                "usage_date",

                sevenDaysAgo,

              )

              .lte(

                "usage_date",

                today,

              ),

        ),



        safeCount(

          supabase,

          "ai_prediction_snapshots",

          (q) =>

            q.eq(

              "status",

              "pending",

            ),

        ),



        safeCount(

          supabase,

          "ai_prediction_snapshots",

          (q) =>

            q.eq(

              "status",

              "verified",

            ),

        ),



        safeCount(

          supabase,

          "analysis_jobs",

          (q) =>

            q.in(

              "status",

              [

                "queued",

                "processing",

              ],

            ),

        ),



        safeCount(

          supabase,

          "analysis_jobs",

          (q) =>

            q.eq(

              "status",

              "failed",

            ),

        ),



        safeCount(

          supabase,

          "match_analysis_cache",

          (q) =>

            q.eq(

              "status",

              "processing",

            ),

        ),



        supabase

          .from("fixture_cache")

          .select(

            "fixture_date,total,raw_total,fetched_at,pre_match_refreshed,pre_match_refreshed_at",

          )

          .in(

            "fixture_date",

            [

              today,

              tomorrow,

            ],

          ),

      ]);



      if (membersResult.error) {

        throw membersResult.error;

      }



      const members =

        membersResult.data ?? [];



      const activeMembers =

        members.filter(

          (item: any) =>

            item?.is_active === true,

        ).length;



      const vipMembers =

        members.filter(

          (item: any) =>

            String(

              item?.member_level || "",

            ).toLowerCase() === "vip",

        ).length;



      const todayLogins =

        members.filter((item: any) => {

          if (!item?.last_login_at) {

            return false;

          }



          const key =

            new Date(

              item.last_login_at,

            ).toLocaleDateString(

              "en-CA",

              {

                timeZone:

                  "Asia/Taipei",

              },

            );



          return key === today;

        }).length;



      const fixtureRows =

        fixtureRowsResult.data ?? [];



      const todayFixture =

        fixtureRows.find(

          (row: any) =>

            row.fixture_date === today,

        );



      const tomorrowFixture =

        fixtureRows.find(

          (row: any) =>

            row.fixture_date === tomorrow,

        );



      const overdueCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

      const overduePending = await safeCount(supabase, "ai_prediction_snapshots", (q) => q.eq("status", "pending").lt("kickoff_at", overdueCutoff));

      const { data: lockRows } = await supabase.from("match_analysis_cache").select("fixture_id,status,created_at,updated_at,expires_at").eq("status","processing").limit(200);

      const nowMs = Date.now();

      const expiredLocks = (lockRows ?? []).filter((x:any) => {

        const exp = x?.expires_at ? new Date(x.expires_at).getTime() : NaN;

        const updated = x?.updated_at ? new Date(x.updated_at).getTime() : (x?.created_at ? new Date(x.created_at).getTime() : NaN);

        return (Number.isFinite(exp) && exp < nowMs) || (!Number.isFinite(exp) && Number.isFinite(updated) && updated < nowMs - 20*60*1000);

      });



      return json({

        success: true,

        overview: {

          today,

          tomorrow,

          total_members:

            members.length,

          active_members:

            activeMembers,

          vip_members:

            vipMembers,

          today_logins:

            todayLogins,

          today_analysis_count:

            analysisToday.count,

          today_api_count:

            apiToday.count,

          last_7_days_api_count:

            api7.count,

          pending_snapshots:

            pendingSnapshots.count,

          overdue_pending_snapshots:

            overduePending.count,

          normal_pending_snapshots:

            Math.max(0, pendingSnapshots.count - overduePending.count),

          verified_snapshots:

            verifiedSnapshots.count,

          running_jobs:

            runningJobs.count,

          failed_jobs:

            failedJobs.count,

          processing_locks:

            processingLocks.count,

          expired_processing_locks:

            expiredLocks.length,

          normal_processing_locks:

            Math.max(0, processingLocks.count - expiredLocks.length),

          today_fixtures:

            Number(

              todayFixture?.total ||

              0,

            ),

          tomorrow_fixtures:

            Number(

              tomorrowFixture?.total ||

              0,

            ),

          today_fetched_at:

            todayFixture?.fetched_at ||

            null,

          tomorrow_fetched_at:

            tomorrowFixture?.fetched_at ||

            null,

        },

      });

    }



    // =====================================================

    // ANALYSIS HISTORY

    // =====================================================

if (action === "analysis_history") {

  const limit = Math.min(
    Math.max(
      Number(body?.limit || 300),
      1,
    ),
    500,
  );

  const cutoff =
    Date.now() -
    7 * 24 * 60 * 60 * 1000;

  // ==========================================
  // 1. 會員實際分析紀錄
  // ==========================================

  const memberResult =
    await supabase
      .from("member_analysis_history")
      .select("*")
      .gte(
        "updated_at",
        new Date(cutoff).toISOString()
      )
      .order(
        "updated_at",
        {
          ascending: false,
        },
      )
      .limit(limit);

  if (memberResult.error) {
    throw memberResult.error;
  }

  // ==========================================
  // 2. 系統自動正式分析紀錄
  //    來源：ai_prediction_snapshots
  // ==========================================

  const snapshotResult =
    await supabase
      .from("ai_prediction_snapshots")
      .select("*")
      .order(
        "kickoff_at",
        {
          ascending: false,
        },
      )
      .limit(500);

  if (snapshotResult.error) {
    throw snapshotResult.error;
  }

  const systemRecords =
    (snapshotResult.data ?? [])
      .map((row: any) => {

        const createdTime =
          row?.created_at ||
          row?.updated_at ||
          row?.kickoff_at ||
          null;

        const createdMs =
          createdTime
            ? new Date(
                createdTime
              ).getTime()
            : NaN;

        let leagueName =
          row?.league_name;

        if (
          leagueName &&
          typeof leagueName === "object"
        ) {
          leagueName =
            leagueName?.name ||
            leagueName?.api_name ||
            leagueName?.league_name ||
            "其他聯賽";
        }

        if (
          typeof leagueName === "string" &&
          (
            leagueName.trim().startsWith("{") ||
            leagueName.trim().startsWith("[")
          )
        ) {
          try {
            const parsed =
              JSON.parse(
                leagueName
              );

            leagueName =
              parsed?.name ||
              parsed?.api_name ||
              parsed?.league_name ||
              leagueName;
          } catch {}
        }

        return {
          id:
            `SYSTEM_AUTO_${row?.fixture_id}`,

          account:
            "SYSTEM_AUTO｜系統自動分析",

          fixture_id:
            row?.fixture_id,

          league_name:
            leagueName ||
            "其他聯賽",

          home_team:
            row?.home_team ||
            "—",

          away_team:
            row?.away_team ||
            "—",

          fixture_time:
            row?.kickoff_at ||
            null,

          match_status:
            row?.status === "verified"
              ? "FT"
              : "NS",

          result_data: {
            analysis:
              row?.prediction ||
              null,
          },

          updated_at:
            createdTime,

          created_at:
            createdTime,

          record_source:
            "system_auto",

          _created_ms:
            createdMs,
        };
      })
      .filter((row: any) => {

        if (
          !Number.isFinite(
            row?._created_ms
          )
        ) {
          return false;
        }

        return (
          row._created_ms >=
          cutoff
        );
      });

  // ==========================================
  // 3. 合併會員 + 系統自動分析
  // ==========================================

  const records =
    [
      ...(memberResult.data ?? []),
      ...systemRecords,
    ]
      .sort(
        (a: any, b: any) => {

          const aTime =
            new Date(
              a?.updated_at ||
              a?.created_at ||
              0
            ).getTime();

          const bTime =
            new Date(
              b?.updated_at ||
              b?.created_at ||
              0
            ).getTime();

          return (
            bTime -
            aTime
          );
        },
      )
      .slice(
        0,
        limit
      )
      .map(
        ({
          _created_ms,
          ...row
        }: any) => row
      );

  return json({
    success: true,
    records,
  });
}

    // =====================================================

    // JOBS

    // =====================================================

    if (action === "jobs") {

      const limit = Math.min(

        Math.max(

          Number(body?.limit || 300),

          1,

        ),

        500,

      );



      const { data, error } =

        await supabase

          .from("analysis_jobs")

          .select("*")

          .order(

            "created_at",

            {

              ascending: false,

            },

          )

          .limit(limit);



      if (error) {

        throw error;

      }



      const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

      const visibleJobs = (data ?? []).filter((job:any) => {

        if (["queued","processing"].includes(String(job?.status))) return true;

        const t = new Date(job?.completed_at || job?.updated_at || job?.created_at || 0).getTime();

        return Number.isFinite(t) && t >= cutoffMs;

      }).map((job:any) => ({

        ...job,

        suspected_stuck: String(job?.status) === "processing" && new Date(job?.updated_at || job?.created_at || 0).getTime() < Date.now() - 20*60*1000,

      }));

      return json({ success: true, jobs: visibleJobs });

    }



    if (action === "retry_job") {

      const jobId =

        String(body?.job_id || "");



      if (!jobId) {

        return json(

          {

            success: false,

            error: "job_id_required",

            message: "缺少 Job ID",

          },

          400,

        );

      }



      const { data: job, error } =

        await supabase

          .from("analysis_jobs")

          .select(

            "id,account,job_type,fixture_ids,status",

          )

          .eq("id", jobId)

          .maybeSingle();



      if (error || !job) {

        return json(

          {

            success: false,

            error: "job_not_found",

            message: "找不到此 Job",

          },

          404,

        );

      }



      const retryResponse =

        await fetch(

          `${SUPABASE_URL}/functions/v1/analysis-job`,

          {

            method: "POST",

            headers:

              getBackendHeaders(

                SECRET_KEY,

              ),

            body: JSON.stringify({

              account:

                job.account,

              fixture_ids:

                job.fixture_ids,

              job_type:

                job.job_type,

              language:

                "zh-Hant",

            }),

          },

        );



      const retryData =

        await retryResponse

          .json()

          .catch(() => null);



      if (

        !retryResponse.ok ||

        !retryData?.success

      ) {

        return json(

          {

            success: false,

            error:

              retryData?.error ||

              "retry_failed",

            message:

              retryData?.message ||

              "重新執行失敗",

            detail: retryData,

          },

          retryResponse.status || 500,

        );

      }



      return json({

        success: true,

        result: retryData,

      });

    }



    // =====================================================

    // FIXTURE CACHE

    // =====================================================

    if (action === "fixtures") {
      const today = taipeiDate(0);
      const tomorrow = taipeiDate(1);

      const { data, error } =
        await supabase
          .from("fixture_cache")
          .select("*")
          .in(
            "fixture_date",
            [today, tomorrow],
          )
          .order(
            "fixture_date",
            { ascending: true },
          );

      if (error) {
        throw error;
      }

      const caches = data ?? [];

      /*
       * HABAO｜賽事管理比分推播 V2
       * - 分析會員：member_analysis_history 中取過該 fixture 的不同會員數
       * - 可推播：上述會員中，目前帳號正常且至少有一台有效推播訂閱的會員數
       * - live_score_push_targets：後台手動選擇要監控的場次
       */
      const fixtureIds = Array.from(
        new Set<number>(
          caches.flatMap((cache: any) =>
            (Array.isArray(cache?.fixtures)
              ? cache.fixtures
              : []
            )
              .map((fixture: any) =>
                Number(fixture?.fixtureId || 0)
              )
              .filter((id: number) => id > 0)
          ),
        ),
      );

      const fixtureMeta: Record<string, any> = {};

      for (const fixtureId of fixtureIds) {
        fixtureMeta[String(fixtureId)] = {
          analysis_member_count: 0,
          push_member_count: 0,
          live_push_enabled: false,
          live_push_target: null,
        };
      }

      if (fixtureIds.length > 0) {
        const [
          historyResult,
          targetResult,
          subscriptionResult,
          memberResult,
        ] = await Promise.all([
          supabase
            .from("member_analysis_history")
            .select("fixture_id,account")
            .in("fixture_id", fixtureIds),

          supabase
            .from("live_score_push_targets")
            .select("*")
            .in("fixture_id", fixtureIds),

          supabase
            .from("push_subscriptions")
            .select("member_username"),

          supabase
            .from("members")
            .select("account,is_active"),
        ]);

        if (historyResult.error) {
          throw historyResult.error;
        }

        if (targetResult.error) {
          throw targetResult.error;
        }

        if (subscriptionResult.error) {
          throw subscriptionResult.error;
        }

        if (memberResult.error) {
          throw memberResult.error;
        }

        const activeMembers = new Set(
          (memberResult.data ?? [])
            .filter((row: any) => row?.is_active === true)
            .map((row: any) =>
              String(row?.account || "").trim()
            )
            .filter(Boolean),
        );

        const subscribedMembers = new Set(
          (subscriptionResult.data ?? [])
            .map((row: any) =>
              String(row?.member_username || "").trim()
            )
            .filter(Boolean),
        );

        const analysisAccountsByFixture =
          new Map<number, Set<string>>();

        for (const row of historyResult.data ?? []) {
          const fixtureId = Number(row?.fixture_id || 0);
          const account = String(row?.account || "").trim();

          if (!fixtureId || !account) continue;

          if (!analysisAccountsByFixture.has(fixtureId)) {
            analysisAccountsByFixture.set(
              fixtureId,
              new Set<string>(),
            );
          }

          analysisAccountsByFixture
            .get(fixtureId)!
            .add(account);
        }

        for (const fixtureId of fixtureIds) {
          const accounts =
            analysisAccountsByFixture.get(fixtureId) ||
            new Set<string>();

          const pushableAccounts =
            [...accounts].filter(
              (account) =>
                activeMembers.has(account) &&
                subscribedMembers.has(account),
            );

          fixtureMeta[String(fixtureId)] = {
            ...fixtureMeta[String(fixtureId)],
            analysis_member_count: accounts.size,
            push_member_count: pushableAccounts.length,
          };
        }

        for (const target of targetResult.data ?? []) {
          const fixtureId = Number(target?.fixture_id || 0);
          if (!fixtureId) continue;

          fixtureMeta[String(fixtureId)] = {
            ...fixtureMeta[String(fixtureId)],
            live_push_enabled: target?.enabled === true,
            live_push_target: target,
          };
        }
      }

      return json({
        success: true,
        dates: {
          today,
          tomorrow,
        },
        caches,
        fixture_meta: fixtureMeta,
      });
    }


    if (action === "fixture_live_push_toggle") {
      const fixtureId = Number(body?.fixture_id || 0);
      const enabled = body?.enabled === true;

      if (!fixtureId) {
        return json(
          {
            success: false,
            error: "fixture_id_required",
            message: "缺少 Fixture ID",
          },
          400,
        );
      }

      const fixtureDate =
        String(body?.fixture_date || "").trim() ||
        null;

      const kickoffAt =
        String(body?.kickoff_at || "").trim() ||
        null;

      const payload = {
        fixture_id: fixtureId,
        enabled,
        fixture_date: fixtureDate,
        kickoff_at: kickoffAt,
        league_name:
          String(body?.league_name || "").trim() ||
          null,
        home_team:
          String(body?.home_team || "").trim() ||
          null,
        away_team:
          String(body?.away_team || "").trim() ||
          null,
        enabled_by:
          adminContext.username ||
          "super-admin",
        updated_at:
          new Date().toISOString(),
      };

      const { data: target, error: targetError } =
        await supabase
          .from("live_score_push_targets")
          .upsert(
            payload,
            { onConflict: "fixture_id" },
          )
          .select("*")
          .single();

      if (targetError) {
        throw targetError;
      }

      /*
       * 每次開 / 關都清掉舊 baseline。
       * 重新開啟後第一次 Cron 只建立當下狀態，避免把過去比分當成新事件補推。
       */
      const { error: stateDeleteError } =
        await supabase
          .from("live_score_push_state")
          .delete()
          .eq("fixture_id", fixtureId);

      if (stateDeleteError) {
        console.error(
          "LIVE SCORE STATE RESET ERROR:",
          fixtureId,
          stateDeleteError,
        );
      }

      return json({
        success: true,
        target,
      });
    }


    if (action === "refresh_fixtures") {

      const offset =

        Number(body?.offset ?? 0);



      if (![0, 1].includes(offset)) {

        return json(

          {

            success: false,

            error: "invalid_offset",

          },

          400,

        );

      }



      const response =

        await fetch(

          `${SUPABASE_URL}/functions/v1/tomorrow-fixtures`,

          {

            method: "POST",

            headers:

              getBackendHeaders(

                SECRET_KEY,

              ),

            body: JSON.stringify({

              offset,

            }),

          },

        );



      const data =

        await response

          .json()

          .catch(() => null);



      return json(

        {

          success:

            response.ok &&

            data?.success !== false,

          result: data,

        },

        response.ok ? 200 : response.status,

      );

    }



    // =====================================================

    // PUBLIC PERFORMANCE

    // =====================================================

    if (action === "football_v2_rollout_get") {
      const { data, error } = await supabase
        .from("football_v2_rollout_settings")
        .select("pilot_account,all_members_enabled,public_stage,public_stage_effective_at,updated_at")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return json({ success: true, settings: data || { pilot_account: "google_2d3cef6b6e2d", all_members_enabled: false, public_stage: "t10", public_stage_effective_at: null } });
    }

    if (action === "football_v2_rollout_update") {
      const allowedStages = new Set(["t10", "t2", "t15"]);
      let allMembers: boolean | null = null;
      let publicStage: string | null = null;
      if (typeof body?.all_members_enabled === "boolean") allMembers = body.all_members_enabled;
      if (body?.public_stage !== undefined) {
        const stage = String(body.public_stage || "").trim();
        if (!allowedStages.has(stage)) return json({ success: false, error: "invalid_public_stage" }, 400);
        publicStage = stage;
      }
      if (allMembers === null && publicStage === null) return json({ success: false, error: "no_supported_changes" }, 400);
      const { data, error } = await supabase.rpc("update_football_v2_rollout_settings", {
        p_all_members_enabled: allMembers,
        p_public_stage: publicStage,
      });
      if (error) throw error;
      const settings = Array.isArray(data) ? data[0] : data;
      return json({ success: true, settings });
    }

    if (action === "performance") {

      const limit = Math.min(

        Math.max(

          Number(body?.limit || 300),

          1,

        ),

        500,

      );



      const { data, error } =

        await supabase

          .from(

            "ai_prediction_snapshots",

          )

          .select("*")

          .order(

            "kickoff_at",

            {

              ascending: false,

            },

          )

          .limit(limit);



      if (error) {

        throw error;

      }



      const nowMs = Date.now();

      const snapshots = (data ?? []).map((row:any) => {

        let league = row?.league_name;

        if (league && typeof league === "object") league = league?.name || league?.api_name || league?.league_name || "其他聯賽";

        if (typeof league === "string" && (league.trim().startsWith("{") || league.trim().startsWith("["))) {

          try { const parsed = JSON.parse(league); league = parsed?.name || parsed?.api_name || parsed?.league_name || league; } catch {}

        }

        const kickoff = row?.kickoff_at ? new Date(row.kickoff_at).getTime() : NaN;

        const overdue = row?.status === "pending" && Number.isFinite(kickoff) && kickoff < nowMs - 4*60*60*1000;

        return { ...row, league_name: league || "其他聯賽", is_overdue: overdue, excluded_from_public: row?.excluded_from_public === true };

      });

      return json({ success: true, snapshots });

    }



    if (action === "performance_toggle_excluded") {

      const fixtureId = Number(body?.fixture_id || 0);

      if (!fixtureId) return json({success:false,message:"缺少 Fixture ID"},400);

      const excluded = body?.excluded === true;

      const { data, error } = await supabase.from("ai_prediction_snapshots")

        .update({ excluded_from_public: excluded, excluded_at: excluded ? new Date().toISOString() : null })

        .eq("fixture_id", fixtureId).select("fixture_id,excluded_from_public,excluded_at").single();

      if (error) throw error;

      return json({success:true,snapshot:data});

    }



    if (action === "performance_delete") {
      const fixtureId = Number(body?.fixture_id || 0);

      if (!fixtureId) {
        return json(
          {
            success: false,
            error: "fixture_id_required",
            message: "缺少 Fixture ID",
          },
          400,
        );
      }

      const { data, error } = await supabase
        .from("ai_prediction_snapshots")
        .delete()
        .eq("fixture_id", fixtureId)
        .select("fixture_id");

      if (error) {
        throw error;
      }

      if (!Array.isArray(data) || data.length === 0) {
        return json(
          {
            success: false,
            error: "performance_not_found",
            message: "找不到此公開戰績資料",
          },
          404,
        );
      }

      return json({
        success: true,
        deleted_fixture_id: fixtureId,
      });
    }

    if (action === "validate_overdue_performance") {

      const runnerSecret = Deno.env.get("PUBLIC_RUNNER_SECRET");

      if (!runnerSecret) return json({success:false,message:"PUBLIC_RUNNER_SECRET 尚未設定"},500);

      const response = await fetch(`${SUPABASE_URL}/functions/v1/public-prediction-runner`, {

        method:"POST", headers:{"Content-Type":"application/json","x-runner-secret":runnerSecret}, body:JSON.stringify({mode:"validate_overdue"})

      });

      const data = await response.json().catch(()=>null);

      return json({success:response.ok && data?.success!==false,report:data},response.ok?200:response.status);

    }



    if (action === "run_public_runner") {

      const runnerSecret =

        Deno.env.get(

          "PUBLIC_RUNNER_SECRET",

        );



      if (!runnerSecret) {

        return json(

          {

            success: false,

            error:

              "runner_secret_missing",

            message:

              "PUBLIC_RUNNER_SECRET 尚未設定",

          },

          500,

        );

      }



      const response =

        await fetch(

          `${SUPABASE_URL}/functions/v1/public-prediction-runner`,

          {

            method: "POST",

            headers: {

              "Content-Type":

                "application/json",

              "x-runner-secret":

                runnerSecret,

            },

            body: JSON.stringify({}),

          },

        );



      const data =

        await response

          .json()

          .catch(() => null);



      return json(

        {

          success:

            response.ok &&

            data?.success !== false,

          report: data,

        },

        response.ok ? 200 : response.status,

      );

    }



    // =====================================================

    // PARTNER PLATFORMS

    // =====================================================

    if (action === "partners") {

      const { data, error } =

        await supabase

          .from(

            "partner_platforms",

          )

          .select("*")

          .order(

            "sort_order",

            {

              ascending: true,

            },

          )

          .order(

            "id",

            {

              ascending: true,

            },

          );



      if (error) {

        throw error;

      }



      const { data: memberBindings } = await supabase.from("members").select("platform_name,platform_account").not("platform_account","is",null);

      const platforms = (data ?? []).map((platform:any) => {

        const keys = [platform?.slug, platform?.name, platform?.display_name].map((x:any)=>String(x||"").trim().toLowerCase()).filter(Boolean);

        const bound = (memberBindings ?? []).filter((m:any) => keys.includes(String(m?.platform_name||"").trim().toLowerCase()) && String(m?.platform_account||"").trim()).length;

        return {...platform,bound_member_count:bound};

      });

      return json({ success: true, platforms });

    }



    if (action === "partner_save") {

      const id =

        Number(body?.id || 0);



      const slug =

        String(

          body?.slug || "",

        )

          .trim()

          .toLowerCase()

          .replace(

            /[^a-z0-9_-]/g,

            "-",

          )

          .replace(

            /-+/g,

            "-",

          );



      const name =

        String(

          body?.name || "",

        ).trim();



      const displayName =

        String(

          body?.display_name ||

          "",

        ).trim();



      if (

        !slug ||

        !name ||

        !displayName

      ) {

        return json(

          {

            success: false,

            error:

              "partner_fields_required",

            message:

              "請填寫平台代碼、名稱與顯示名稱",

          },

          400,

        );

      }



      const payload = {

        slug,

        name,

        display_name:

          displayName,

        logo_url:

          String(

            body?.logo_url ||

            "",

          ).trim() || null,

        bet_url:

          String(

            body?.bet_url ||

            "",

          ).trim() || null,

        register_url:

          String(

            body?.register_url ||

            "",

          ).trim() || null,

        enabled:

          body?.enabled === true,

        show_when_disabled:
        body?.show_when_disabled === true,

        sort_order:

          Number(

            body?.sort_order ||

            0,

          ),

        updated_at:

          new Date().toISOString(),

      };



      let query;



      if (id > 0) {

        query =

          supabase

            .from(

              "partner_platforms",

            )

            .update(payload)

            .eq("id", id)

            .select("*")

            .single();

      } else {

        query =

          supabase

            .from(

              "partner_platforms",

            )

            .insert(payload)

            .select("*")

            .single();

      }



      const { data, error } =

        await query;



      if (error) {

        console.error(

          "PARTNER SAVE ERROR:",

          error,

        );



        return json(

          {

            success: false,

            error:

              "partner_save_failed",

            message:

              error.message,

          },

          400,

        );

      }



      return json({

        success: true,

        platform: data,

      });

    }



    if (action === "partner_toggle") {

      const id =

        Number(body?.id || 0);



      const enabled =

        body?.enabled === true;



      if (!id) {

        return json(

          {

            success: false,

            error: "partner_id_required",

          },

          400,

        );

      }



      const { data, error } =

        await supabase

          .from(

            "partner_platforms",

          )

          .update({

            enabled,

            updated_at:

              new Date().toISOString(),

          })

          .eq("id", id)

          .select("*")

          .single();



      if (error) {

        throw error;

      }



      return json({

        success: true,

        platform: data,

      });

    }



    if (action === "partner_delete") {

      const id =

        Number(body?.id || 0);



      if (!id) {

        return json(

          {

            success: false,

            error: "partner_id_required",

          },

          400,

        );

      }



      const { data: platformRow } = await supabase.from("partner_platforms").select("id,slug,name,display_name,enabled").eq("id",id).maybeSingle();

      if (!platformRow) return json({success:false,message:"找不到平台"},404);

      const keys = [platformRow.slug,platformRow.name,platformRow.display_name].map((x:any)=>String(x||"").trim().toLowerCase()).filter(Boolean);

      const { data: boundMembers } = await supabase.from("members").select("id,platform_name,platform_account").not("platform_account","is",null);

      const boundCount = (boundMembers ?? []).filter((m:any)=>keys.includes(String(m?.platform_name||"").trim().toLowerCase()) && String(m?.platform_account||"").trim()).length;

      if (boundCount > 0) return json({success:false,error:"partner_has_members",message:`此平台已有 ${boundCount} 位會員綁定，請先停用，不可直接刪除。`,bound_member_count:boundCount},409);

      if (platformRow.enabled === true) return json({success:false,error:"partner_enabled",message:"請先停用平台，再執行刪除。"},409);



      const { error } =

        await supabase

          .from(

            "partner_platforms",

          )

          .delete()

          .eq("id", id);



      if (error) {

        throw error;

      }



      return json({

        success: true,

      });

    }



    // =====================================================

    // API STATS

    // =====================================================

    if (action === "api_stats") {

      const days: any[] = [];



      for (

        let offset = -6;

        offset <= 0;

        offset++

      ) {

        const date =

          taipeiDate(offset);



        const count =

          await safeCount(

            supabase,

            "api_usage",

            (q) =>

              q.eq(

                "usage_date",

                date,

              ),

          );



        days.push({

          date,

          count:

            count.count,

        });

      }



      const today =

        taipeiDate(0);



      const { data: todayRows, error: todayRowsError } = await supabase

        .from("api_usage")

        .select("source")

        .eq("usage_date", today);

      if (todayRowsError) throw todayRowsError;

      const sourceMap = new Map<string, number>();

      for (const row of (todayRows ?? [])) {

        const key = String(row?.source || "unknown").trim() || "unknown";

        sourceMap.set(key, (sourceMap.get(key) || 0) + 1);

      }

      const sources = [...sourceMap.entries()].map(([source,count])=>({source,count})).sort((a,b)=>b.count-a.count);

      const {
  data: usageRows,
  error: usageError,
} = await supabase
  .from("supabase_usage_snapshots")
  .select("*")
  .order("usage_date", {
    ascending: false,
  })
  .limit(1);

if (usageError) {
  throw usageError;
}

const usageSnapshot =
  Array.isArray(usageRows) &&
  usageRows.length > 0
    ? usageRows[0]
    : null;

return json({
  success: true,
  days,
  sources,
  usage_snapshot: usageSnapshot,
});

    }



    // =====================================================

    // HEALTH / DEBUG

    // =====================================================

    if (action === "health") {

      const [

        latestFixture,

        latestJob,

        latestSnapshot,

        runningLocks,

        recentFailedJobs,

      ] = await Promise.all([

        supabase

          .from("fixture_cache")

          .select(

            "fixture_date,total,fetched_at",

          )

          .order(

            "fetched_at",

            {

              ascending: false,

            },

          )

          .limit(1),



        supabase

          .from("analysis_jobs")

          .select(

            "id,account,status,created_at,updated_at,completed_at,error_message,failures",

          )

          .order(

            "created_at",

            {

              ascending: false,

            },

          )

          .limit(1),



        supabase

          .from(

            "ai_prediction_snapshots",

          )

          .select(

            "fixture_id,status,kickoff_at,verified_at",

          )

          .order(

            "kickoff_at",

            {

              ascending: false,

            },

          )

          .limit(1),



        supabase

          .from(

            "match_analysis_cache",

          )

          .select("*")

          .eq(

            "status",

            "processing",

          )

          .limit(100),



        supabase

          .from("analysis_jobs")

          .select(

            "id,account,status,fixture_ids,created_at,updated_at,completed_at,error_message,failures",

          )

          .in(

            "status",

            [

              "failed",

              "partial",

            ],

          )

          .order(

            "created_at",

            {

              ascending: false,

            },

          )

          .limit(50),

      ]);



      let debugLogs: any[] = [];

      let debugLogsAvailable =

        true;



      try {

        const debugResult =

          await supabase

            .from("debug_logs")

            .select("*")

            .limit(80);



        if (debugResult.error) {

          debugLogsAvailable =

            false;

        } else {

          debugLogs =

            debugResult.data ?? [];

        }

      } catch {

        debugLogsAvailable =

          false;

      }



      const overdueCutoff = new Date(Date.now() - 4*60*60*1000).toISOString();

      const [verifiedCount, pendingCount, overdueCount] = await Promise.all([

        safeCount(supabase,"ai_prediction_snapshots",q=>q.eq("status","verified").eq("excluded_from_public",false)),

        safeCount(supabase,"ai_prediction_snapshots",q=>q.eq("status","pending")),

        safeCount(supabase,"ai_prediction_snapshots",q=>q.eq("status","pending").lt("kickoff_at",overdueCutoff)),

      ]);

      const nowMs = Date.now();

      const lockList = (runningLocks.data ?? []).map((row:any)=>{

        const exp=row?.expires_at?new Date(row.expires_at).getTime():NaN;

        const updated=row?.updated_at?new Date(row.updated_at).getTime():(row?.created_at?new Date(row.created_at).getTime():NaN);

        const expired=(Number.isFinite(exp)&&exp<nowMs)||(!Number.isFinite(exp)&&Number.isFinite(updated)&&updated<nowMs-20*60*1000);

        return {...row,is_expired:expired,is_suspected_stale:expired};

      });



      return json({

        success: true,

        health: {

          latest_fixture:

            latestFixture.data?.[0] ||

            null,

          latest_job:

            latestJob.data?.[0] ||

            null,

          latest_snapshot:

            latestSnapshot.data?.[0] ||

            null,

          processing_locks:

            lockList,

          verified_snapshots: verifiedCount.count,

          pending_snapshots: pendingCount.count,

          overdue_pending_snapshots: overdueCount.count,

          failed_jobs:

            recentFailedJobs.data ??

            [],

          debug_logs_available:

            debugLogsAvailable,

          debug_logs:

            debugLogs,

          generated_at:

            new Date().toISOString(),

        },

      });

    }



    if (action === "clear_expired_locks") {

      const { data: rows, error } = await supabase.from("match_analysis_cache").select("*").eq("status","processing").limit(500);

      if (error) throw error;

      const nowMs=Date.now();

      const expired=(rows??[]).filter((row:any)=>{

        const exp=row?.expires_at?new Date(row.expires_at).getTime():NaN;

        const updated=row?.updated_at?new Date(row.updated_at).getTime():(row?.created_at?new Date(row.created_at).getTime():NaN);

        return (Number.isFinite(exp)&&exp<nowMs)||(!Number.isFinite(exp)&&Number.isFinite(updated)&&updated<nowMs-20*60*1000);

      });

      let cleared=0;

      for (const row of expired) {

        let q=supabase.from("match_analysis_cache").delete();

        if (row?.id != null) q=q.eq("id",row.id);

        else if (row?.fixture_id != null) q=q.eq("fixture_id",row.fixture_id).eq("status","processing");

        else continue;

        const result=await q; if (!result.error) cleared++;

      }

      return json({success:true,cleared,found_expired:expired.length});

    }



    return json(

      {

        success: false,

        error: "unknown_action",

        message:

          "未知的管理操作",

      },

      400,

    );

  } catch (error) {

    console.error(

      "admin-center error:",

      error,

    );



    return json(

      {

        success: false,

        error: "admin_center_failed",

        message:

          error instanceof Error

            ? error.message

            : String(error),

      },

      500,

    );

  }

});
