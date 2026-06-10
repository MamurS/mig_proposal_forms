// ============================================================
// Shared INN (taxpayer ID) helpers — loaded via <script src="/shared/inn.js">.
// Uzbek legal-entity INN/STIR is 9 digits. Foreign entities differ, so this is
// a SOFT hint (educational), never a hard block, to allow non-UZ insureds.
// ============================================================
window.MIG_INN = {
  isUzEntity(v) { return /^\d{9}$/.test(String(v == null ? '' : v).trim()); },
  // Attach a live, non-blocking hint directly under an INN <input>.
  attachHint(input) {
    if (!input || input.dataset.innHint) return;
    input.dataset.innHint = '1';
    input.setAttribute('inputmode', 'numeric');
    const note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:#b8860b;margin-top:3px;display:none;';
    note.textContent = 'Tip: a Uzbek entity INN/STIR is 9 digits.';
    input.insertAdjacentElement('afterend', note);
    const check = () => {
      const v = input.value.trim();
      note.style.display = (v && !window.MIG_INN.isUzEntity(v)) ? 'block' : 'none';
    };
    input.addEventListener('input', check);
    check();
  },
};
