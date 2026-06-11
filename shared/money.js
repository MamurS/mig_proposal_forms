// ============================================================
// Shared currency-prefix decoration for sum inputs.
// Loaded via <script src="/shared/money.js">.
//
// Shows the currency code INSIDE the field, in front of the amount
// (e.g. "UZS  1,000,000") without the user ever typing it — the input keeps
// holding just the number. The code updates live when the form's currency
// selection changes (call MIG_MONEY.refresh()).
// ============================================================
window.MIG_MONEY = {
  // "1200000000" / 1200000000 → "1,200,000,000" (non-numeric strings pass through)
  fmt(n) {
    const s = String(n == null ? '' : n).trim();
    if (s === '') return '';
    const x = Number(s.replace(/[,\s]/g, ''));
    return isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: 2 }) : s;
  },
  // Live thousands separators while typing. Only reformats purely numeric
  // content — free-text entries ("1,000,000 per claim") are left untouched.
  // Safe to call twice: binds once per input.
  bindThousands(input) {
    if (!input || input.dataset.thousands) return;
    input.dataset.thousands = '1';
    input.addEventListener('input', () => {
      const v = String(input.value);
      if (!/^[\d,.\s]*$/.test(v)) return;
      const raw = v.replace(/[,\s]/g, '');
      if (raw === '') return;
      let [i, d] = raw.split('.');
      i = (i || '0').replace(/^0+(\d)/, '$1');
      let out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      if (d !== undefined) out += '.' + d;
      input.value = out;
    });
  },
  ensureCss() {
    if (document.getElementById('mig-money-css')) return;
    const s = document.createElement('style');
    s.id = 'mig-money-css';
    s.textContent =
      // width/flex constraints matter inside table/flex cells — without them the
      // wrapper sizes to the input's intrinsic width and overflows the column.
      '.mig-money{position:relative;display:block;min-width:0;width:100%;flex:1 1 auto;}' +
      '.mig-money .mig-cur{position:absolute;left:9px;top:50%;transform:translateY(-50%);' +
      'font-size:11px;font-weight:600;letter-spacing:.03em;color:#8a8f99;pointer-events:none;user-select:none;}';
    document.head.appendChild(s);
  },
  // Wrap an input with a currency tag. getCur: string or () => string.
  decorate(input, getCur) {
    if (!input || input.dataset.curWrapped) return;
    this.ensureCss();
    input.dataset.curWrapped = '1';
    const wrap = document.createElement('span');
    wrap.className = 'mig-money';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const tag = document.createElement('span');
    tag.className = 'mig-cur';
    wrap.insertBefore(tag, input);
    const upd = () => {
      let c = typeof getCur === 'function' ? getCur() : getCur;
      c = String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
      tag.textContent = c;
      // leave room for the code; keep the user's number right-aligned look intact
      input.style.paddingLeft = c ? (16 + c.length * 8) + 'px' : '';
    };
    input.__migCurUpd = upd;
    upd();
  },
  // Re-read the currency for every decorated input under root (default: document).
  refresh(root) {
    (root || document).querySelectorAll('input[data-cur-wrapped]').forEach(i => {
      if (i.__migCurUpd) i.__migCurUpd();
    });
  },
};
