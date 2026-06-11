// ============================================================
// Shared auth-gate helpers. Loaded via <script src="/shared/auth.js">.
//
// Role checks (is_mig_staff / is_mig_admin / is_customer) are SECURITY DEFINER
// RPCs — one network round-trip each. Every page runs one on load, which made
// each navigation wait on Supabase before the app appeared. The result is
// cached per-user in sessionStorage (per tab) for TTL minutes, so moving
// between pages is instant after the first check.
//
// This is a UI gate only — RLS still enforces access on every query, so a
// cached "true" for a just-removed staffer exposes nothing; the pages simply
// render their shell until RLS returns empty data (max TTL minutes, one tab).
// Only positive results are cached; "false"/errors are always re-checked.
// ============================================================
window.MIG_AUTH = {
  TTL: 15 * 60 * 1000,
  async cachedRpc(sb, fn, uid) {
    const key = 'mig_' + fn + '_' + uid;
    try {
      const c = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (c && c.ok === true && (Date.now() - c.t) < this.TTL) return true;
    } catch (_) {}
    const { data, error } = fn === 'is_mig_admin'
      ? await sb.rpc('is_mig_admin', { uid })
      : await sb.rpc(fn);
    if (error) return false;
    try {
      if (data) sessionStorage.setItem(key, JSON.stringify({ ok: true, t: Date.now() }));
      else sessionStorage.removeItem(key);
    } catch (_) {}
    return !!data;
  },
  isStaff(sb, uid) { return this.cachedRpc(sb, 'is_mig_staff', uid); },
  isAdmin(sb, uid) { return this.cachedRpc(sb, 'is_mig_admin', uid); },
  isCustomer(sb, uid) { return this.cachedRpc(sb, 'is_customer', uid); },
  clear() {
    try {
      Object.keys(sessionStorage).filter(k => k.indexOf('mig_is_') === 0)
        .forEach(k => sessionStorage.removeItem(k));
    } catch (_) {}
  },
};
