// ============================================================
// Shared Claude "recommended terms" helper for the generation forms
// (Rater, Quotation, Policy issuance). Loaded via <script src="/shared/recommend.js">.
//
// Calls the staff-only `recommend-quotation` edge function for a submission and
// returns per-line recommended { limit, deductible, premium, territory,
// sublimits, note }. Each form fills ONLY the fields the underwriter has not yet
// entered and marks them with a small amber "AI" badge — the same kind of badge
// used for "auto" (from submission) and "quote" (from rater) data — so a
// recommendation is always visibly distinct from real pulled/typed data and is
// understood as a suggestion to verify.
// ============================================================
window.MIG_REC = {
  // Fetch recommendations for a submission.
  // Returns { byCode: {code: line}, lines: [...], note } or throws on failure.
  async fetch(sb, submissionId) {
    const { data, error } = await sb.functions.invoke('recommend-quotation', {
      body: { submission_id: submissionId },
    });
    if (error) {
      let m = error.message || 'AI recommendation failed';
      try { const c = await error.context.json(); if (c && c.error) m = c.error; } catch (_) {}
      throw new Error(m);
    }
    const byCode = {};
    const lines = (data && data.lines) || [];
    lines.forEach((l) => { if (l && l.code) byCode[l.code] = l; });
    return { byCode, lines, note: (data && data.note) || '' };
  },

  // Inject the amber "AI" badge / highlight CSS once per page.
  ensureCss() {
    if (document.getElementById('mig-ai-css')) return;
    const s = document.createElement('style');
    s.id = 'mig-ai-css';
    s.textContent =
      '.ai-badge{display:inline-block;font-size:10px;background:#fff3d6;color:#9a6700;' +
      'border:1px solid #ecd9b0;border-radius:8px;padding:1px 7px;margin-left:6px;' +
      'vertical-align:middle;font-weight:600;letter-spacing:.02em;}' +
      '.prefill-badge.ai{background:#fff3d6;color:#9a6700;}' +
      'input.ai-rec,select.ai-rec,textarea.ai-rec{background:#fff8ec;border-color:#ecd9b0;box-shadow:inset 0 0 0 1px #f0e0bd;}';
    document.head.appendChild(s);
  },

  // Show/refresh an "AI" badge next to a label. `badgeEl` may be an element or id.
  badge(badgeEl, title) {
    const el = typeof badgeEl === 'string' ? document.getElementById(badgeEl) : badgeEl;
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('ai');
    el.textContent = 'AI';
    if (title) el.title = title;
  },

  // Mark an input/select as AI-recommended (amber highlight). `clearOn` events
  // remove the highlight once the underwriter edits the value.
  mark(input, title) {
    if (!input) return;
    input.classList.add('ai-rec');
    if (title) input.title = title;
    const clear = () => input.classList.remove('ai-rec');
    input.addEventListener('input', clear, { once: true });
    input.addEventListener('change', clear, { once: true });
  },
};
