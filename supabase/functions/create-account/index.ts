// ============================================================
// create-account — admin-only account management (service role)
// ============================================================
// Called from /admin/accounts/ via supabase.functions.invoke('create-account').
// Requires a valid JWT (verify_jwt = true) AND the caller must be a MIG admin.
// Uses the service-role key (auto-injected by Supabase) for privileged actions.
//
// Actions (body.action, default 'create'):
//   create : { account_type:'customer'|'staff', email, password?, full_name?, company?, inn?, role? }
//            -> { user_id, email, password, account_type }
//   list   : {} -> { users: [ {user_id,email,type,role,full_name,company,inn,created_at,last_sign_in_at,email_confirmed_at} ] }
//   update : { user_id, full_name?, company?, inn?, role?, email?, password? } -> { ok:true }
//   delete : { user_id } -> { ok:true }
//
// No confirmation / verification email is ever sent: accounts are created with
// `email_confirm: true` (admin-confirmed) and email changes set the same flag,
// so Supabase Auth never emails the user. Credentials are handed over manually.
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function genPassword(n = 16): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%*";
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  let s = "";
  for (const x of arr) s += chars[x % chars.length];
  return s;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // --- Authorize: signed-in MIG admin only ---
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "Not authenticated" }, 401);
    const { data: isAdmin, error: aErr } = await userClient.rpc("is_mig_admin", { uid: user.id });
    if (aErr) return json({ error: "Admin check failed: " + aErr.message }, 500);
    if (!isAdmin) return json({ error: "Forbidden — admin access required." }, 403);

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = body.action || "create";

    // ---------------- LIST ----------------
    if (action === "list") {
      const { data: listed, error: lErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (lErr) return json({ error: "List failed: " + lErr.message }, 500);
      const { data: staff } = await admin.from("mig_staff").select("user_id, email, full_name, role");
      const { data: custs } = await admin.from("customers").select("user_id, email, full_name, company, inn");
      const staffMap = new Map((staff || []).map((s: any) => [s.user_id, s]));
      const custMap = new Map((custs || []).map((c: any) => [c.user_id, c]));
      const users = (listed?.users || []).map((u: any) => {
        const s = staffMap.get(u.id);
        const c = custMap.get(u.id);
        return {
          user_id: u.id,
          email: u.email,
          type: s ? "staff" : (c ? "customer" : "none"),
          role: s ? s.role : null,
          full_name: (s?.full_name) || (c?.full_name) || (u.user_metadata?.full_name) || null,
          company: c?.company || null,
          inn: c?.inn || null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at || null,
          email_confirmed_at: u.email_confirmed_at || u.confirmed_at || null,
        };
      });
      return json({ users });
    }

    // ---------------- UPDATE ----------------
    if (action === "update") {
      const uid = body.user_id;
      if (!uid) return json({ error: "user_id required" }, 400);
      const { data: s } = await admin.from("mig_staff").select("user_id").eq("user_id", uid).maybeSingle();
      const { data: c } = await admin.from("customers").select("user_id").eq("user_id", uid).maybeSingle();

      const authPatch: Record<string, unknown> = {};
      if (typeof body.email === "string" && body.email.includes("@")) {
        authPatch.email = body.email.trim().toLowerCase();
        // Mark the new address confirmed so Supabase does NOT send a
        // "confirm email change" message — credential delivery is manual.
        authPatch.email_confirm = true;
      }
      if (typeof body.password === "string" && body.password.length >= 8) authPatch.password = body.password;
      if (Object.keys(authPatch).length) {
        const { error } = await admin.auth.admin.updateUserById(uid, authPatch);
        if (error) return json({ error: "Auth update failed: " + error.message }, 400);
      }

      if (s) {
        const patch: Record<string, unknown> = {};
        if ("full_name" in body) patch.full_name = body.full_name || null;
        if (body.role === "admin" || body.role === "underwriter") patch.role = body.role;
        if (authPatch.email) patch.email = authPatch.email;
        if (Object.keys(patch).length) {
          const { error } = await admin.from("mig_staff").update(patch).eq("user_id", uid);
          if (error) return json({ error: "Staff update failed: " + error.message }, 400);
        }
      } else if (c) {
        const patch: Record<string, unknown> = {};
        if ("full_name" in body) patch.full_name = body.full_name || null;
        if ("company" in body) patch.company = body.company || null;
        if ("inn" in body) patch.inn = body.inn ? String(body.inn).trim() : null;
        if (authPatch.email) patch.email = authPatch.email;
        if (Object.keys(patch).length) {
          const { error } = await admin.from("customers").update(patch).eq("user_id", uid);
          if (error) return json({ error: "Customer update failed: " + error.message }, 400);
        }
      }
      return json({ ok: true });
    }

    // ---------------- DELETE ----------------
    if (action === "delete") {
      const uid = body.user_id;
      if (!uid) return json({ error: "user_id required" }, 400);
      if (uid === user.id) return json({ error: "You can't delete your own account." }, 400);

      const { data: s } = await admin.from("mig_staff").select("role").eq("user_id", uid).maybeSingle();
      if (s && s.role === "admin") {
        const { count } = await admin.from("mig_staff").select("*", { count: "exact", head: true }).eq("role", "admin");
        if ((count || 0) <= 1) return json({ error: "Cannot delete the last remaining admin." }, 400);
      }
      // Insurance retention: never destroy a customer who has linked records.
      const { data: cRow } = await admin.from("customers").select("user_id").eq("user_id", uid).maybeSingle();
      if (cRow) {
        const { count: nSub } = await admin.from("submissions").select("*", { count: "exact", head: true }).eq("customer_id", uid);
        const { count: nQuo } = await admin.from("quotations").select("*", { count: "exact", head: true }).eq("customer_id", uid);
        const linked = (nSub || 0) + (nQuo || 0);
        if (linked > 0) {
          return json({ error: "This customer has " + linked + " linked record(s) (proposals/quotations). Insurance records must be retained — disable the account instead of deleting it." }, 400);
        }
      }
      await admin.from("mig_staff").delete().eq("user_id", uid);
      await admin.from("customers").delete().eq("user_id", uid);
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) return json({ error: "Delete failed: " + error.message }, 400);
      return json({ ok: true });
    }

    // ---------------- CREATE (default) ----------------
    const account_type = body.account_type;
    const email = String(body.email ?? "").trim().toLowerCase();
    const full_name = body.full_name ? String(body.full_name).trim() : null;
    const company = body.company ? String(body.company).trim() : null;
    const inn = body.inn ? String(body.inn).trim() : null;
    if (!email || !email.includes("@")) return json({ error: "A valid email is required." }, 400);
    if (account_type !== "customer" && account_type !== "staff") {
      return json({ error: "account_type must be 'customer' or 'staff'." }, 400);
    }
    const password = (typeof body.password === "string" && body.password.length >= 8) ? body.password : genPassword();

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      // email_confirm:true marks the address confirmed up-front, so Supabase
      // sends NO verification/confirmation email — provisioning is internal.
      email_confirm: true,
      user_metadata: { full_name, company, inn, account_type },
    });
    if (cErr || !created?.user) {
      return json({ error: "Could not create user: " + (cErr?.message || "unknown error") }, 400);
    }
    const newId = created.user.id;

    if (account_type === "staff") {
      const role = body.role === "admin" ? "admin" : "underwriter";
      const { error: sErr } = await admin.from("mig_staff").insert({ user_id: newId, email, full_name, role });
      if (sErr) return json({ error: "User created but staff record failed: " + sErr.message, user_id: newId }, 500);
    } else {
      const { error: pErr } = await admin.from("customers").insert({ user_id: newId, email, full_name, company, inn, created_by: user.id });
      if (pErr) return json({ error: "User created but customer record failed: " + pErr.message, user_id: newId }, 500);
    }

    return json({ user_id: newId, email, password, account_type }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
