// ============================================================
// create-account — admin-only provisioning of customer / staff accounts
// ============================================================
// Called from the admin page via supabase.functions.invoke('create-account').
// Requires a valid JWT (verify_jwt = true) AND the caller must be a MIG admin
// (checked here via is_mig_admin). Uses the service-role key — auto-injected by
// Supabase — to create the auth user and the matching profile row.
//
// Input  : { account_type: 'customer'|'staff', email, password?, full_name?, company?, role? }
// Output : { user_id, email, password, account_type }   (password echoed so the
//           admin can hand it to the new user)
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
  // Avoid ambiguous chars (0/O, 1/l/I). Include a symbol set for strength.
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

    // --- Identify and authorize the caller (must be a MIG admin) ---
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uErr } = await userClient.auth.getUser();
    if (uErr || !user) return json({ error: "Not authenticated" }, 401);

    const { data: isAdmin, error: aErr } = await userClient.rpc("is_mig_admin", { uid: user.id });
    if (aErr) return json({ error: "Admin check failed: " + aErr.message }, 500);
    if (!isAdmin) return json({ error: "Forbidden — admin access required." }, 403);

    // --- Validate input ---
    const body = await req.json().catch(() => ({}));
    const account_type = body.account_type;
    const email = String(body.email ?? "").trim().toLowerCase();
    const full_name = body.full_name ? String(body.full_name).trim() : null;
    const company = body.company ? String(body.company).trim() : null;
    if (!email || !email.includes("@")) return json({ error: "A valid email is required." }, 400);
    if (account_type !== "customer" && account_type !== "staff") {
      return json({ error: "account_type must be 'customer' or 'staff'." }, 400);
    }
    const password = (typeof body.password === "string" && body.password.length >= 8)
      ? body.password
      : genPassword();

    // --- Service-role client for privileged writes ---
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, company, account_type },
    });
    if (cErr || !created?.user) {
      return json({ error: "Could not create user: " + (cErr?.message || "unknown error") }, 400);
    }
    const newId = created.user.id;

    if (account_type === "staff") {
      const role = body.role === "admin" ? "admin" : "underwriter";
      const { error: sErr } = await admin.from("mig_staff")
        .insert({ user_id: newId, email, full_name, role });
      if (sErr) {
        return json({ error: "User created but staff record failed: " + sErr.message, user_id: newId }, 500);
      }
    } else {
      const { error: pErr } = await admin.from("customers")
        .insert({ user_id: newId, email, full_name, company, created_by: user.id });
      if (pErr) {
        return json({ error: "User created but customer record failed: " + pErr.message, user_id: newId }, 500);
      }
    }

    return json({ user_id: newId, email, password, account_type }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
