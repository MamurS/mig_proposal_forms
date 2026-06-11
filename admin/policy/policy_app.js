// MIG Policy Issuance — unified Cyber/Crime app logic. Deployed as admin/policy/policy_app.js
// The insurance type is chosen in the form; the matching schedule, sublimits,
// bilingual wording, target table and .docx are selected by type.
/* global supabase, docx, CYBER_WORDING, CRIME_WORDING, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY */

let sb = null, session = null, loadedSubmissionId = null, loadedQuoteId = null, loadedCustomerId = null;
let issued = false, policyRecordId = null;
let TYPE = 'cyber';
// Original monetary values as loaded (rater quote / AI are USD-rated) so the
// limit/retention/premium can be re-derived whenever the policy currency or the
// exchange rate changes — conversion always starts from the source numbers,
// never from already-converted ones.
let srcMoney = null;

// Read a submission field across BOTH naming schemes (online proposal form + AI-intake scraper).
function subField(f, ...keys) { for (const k of keys) { const v = f[k]; if (v !== undefined && v !== null && v !== '') return v; } return ''; }
// Build the territory list from geography flags, tolerant of key variants (world/worldwide, us/usa) and prefixes.
function geoFromFields(f, prefixes) {
  const on = (...vs) => prefixes.some(p => vs.some(v => { const x = f[p + '_geo_' + v]; return x === true || x === 'true' || x === 'Yes'; }));
  const geo = [];
  if (on('uz')) geo.push('UZ');
  if (on('cis')) geo.push('CIS');
  if (on('eu')) geo.push('EU');
  if (on('us', 'usa')) geo.push('US');
  if (on('worldwide', 'world', 'ww')) geo.push('WW');
  return geo;
}

const $ = id => document.getElementById(id);
const fmtN = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const stripC = s => String(s || '').replace(/,/g, '');
function showErr(m) { const b = $('err-banner'); b.textContent = m; b.style.display = 'block'; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Per-type configuration: wording source, tables, document titles, filenames.
const TYPECFG = {
  cyber: {
    W: () => CYBER_WORDING,
    table: 'cyber_policies', quotes: 'cyber_quotes',
    titleRu: 'ПОЛИС ПО КОМПЛЕКСНОМУ СТРАХОВАНИЮ КИБЕРРИСКОВ',
    titleEn: 'CYBER INSURANCE POLICY',
    wordingRu: 'ПРАВИЛА (УСЛОВИЯ) КОМПЛЕКСНОГО СТРАХОВАНИЯ КИБЕРРИСКОВ',
    wordingEn: 'CYBER INSURANCE TERMS AND CONDITIONS',
    footer: 'MIG Cyber Protect Wording v1.0 (2026) / Правила МИГ по страхованию киберрисков, ред. 1.0 (2026)',
    fileword: 'Cyber', polnum: 'MIG-CY-2026-____',
  },
  crime: {
    W: () => CRIME_WORDING,
    table: 'crime_policies', quotes: 'crime_quotes',
    titleRu: 'ПОЛИС ПО КОМПЛЕКСНОМУ СТРАХОВАНИЮ ОТ ПРЕСТУПЛЕНИЙ',
    titleEn: 'COMMERCIAL CRIME INSURANCE POLICY',
    wordingRu: 'ПРАВИЛА (УСЛОВИЯ) КОМПЛЕКСНОГО СТРАХОВАНИЯ ОТ ПРЕСТУПЛЕНИЙ',
    wordingEn: 'COMMERCIAL CRIME INSURANCE TERMS AND CONDITIONS',
    footer: 'MIG Crime Protect Wording v1.0 (2026) / Правила МИГ по страхованию от преступлений, ред. 1.0 (2026)',
    fileword: 'Crime', polnum: 'MIG-CR-2026-____',
  },
};
function cfg() { return TYPECFG[TYPE]; }

// All proposal lines (matches the proposal form / quotation generator).
const POLICY_LABELS = {
  auto: 'Commercial Automobile', property: 'Property', cgl: 'General Liability (CGL)',
  car: "Contractors' All Risks (CAR)", dno: 'Directors & Officers (D&O)', pi: 'Professional Indemnity (PI)',
  crime: 'Crime', cyber: 'Cyber',
};
// Lines with full bilingual wording. Others are listed but not issuable here.
const POLICY_BUILT = ['cyber', 'crime'];

function bindThousands(input) {
  input.addEventListener('input', () => {
    const raw = stripC(input.value).replace(/[^\d.]/g, '');
    if (raw === '') return;
    let [i, d] = raw.split('.');
    i = (i || '0').replace(/^0+(\d)/, '$1');
    let out = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (d !== undefined) out += '.' + d;
    input.value = out;
  });
}

// ---------------- state ----------------
function F() {
  const cur = $('f-currency').value;
  const money = id => { const v = stripC($(id).value); return v ? cur + ' ' + fmtN(v) : '____________'; };
  const txt = id => $(id).value.trim() || '____________';
  const raw = {
    type: TYPE,
    policy_number: $('f-polnum').value.trim(), policy_date: $('f-poldate').value.trim(),
    currency: cur, broker: $('f-broker').value.trim(),
    insured: $('f-insured').value.trim(), inn: $('f-inn').value.trim(),
    address: $('f-address').value.trim(),
    beneficiary: $('f-beneficiary').value.trim(), business: $('f-business').value.trim(),
    limit: stripC($('f-limit').value), retention: stripC($('f-retention').value),
    premium: stripC($('f-premium').value), premium_due: $('f-premdue').value.trim(),
    period_from: $('f-from').value.trim(), period_to: $('f-to').value.trim(),
    retro: $('f-retro').value.trim(), territory: $('f-territory').value.trim(),
    fx_rate: stripC($('f-fx-rate').value), fx_date: $('f-fx-date').value.trim(),
  };
  if (TYPE === 'cyber') {
    Object.assign(raw, {
      sl_ext: stripC($('f-sl-ext').value), sl_osp: stripC($('f-sl-osp').value),
      sl_fines: stripC($('f-sl-fines').value), sl_tel: stripC($('f-sl-tel').value),
      sl_cj: stripC($('f-sl-cj').value),
      waiting: stripC($('f-waiting').value),
      em_phone: $('f-em-phone').value.trim(), em_email: $('f-em-email').value.trim(),
      cov_bi: $('f-cov-bi').checked, cov_ext: $('f-cov-ext').checked, cov_media: $('f-cov-media').checked,
    });
  } else {
    Object.assign(raw, {
      sl_se: stripC($('f-sl-se').value), sl_legal: stripC($('f-sl-legal').value),
      sl_inv: stripC($('f-sl-inv').value), sl_data: stripC($('f-sl-data').value),
      sl_fire: stripC($('f-sl-fire').value),
    });
  }
  const d = {
    polnum: txt('f-polnum'), poldate: txt('f-poldate'), broker: $('f-broker').value.trim(),
    insured: txt('f-insured'), inn: txt('f-inn'), address: txt('f-address'),
    beneficiary: $('f-beneficiary').value.trim() || 'N/A', business: txt('f-business'),
    limit: money('f-limit'), retention: money('f-retention'), premium: money('f-premium'),
    premdue: txt('f-premdue'), from: txt('f-from'), to: txt('f-to'),
    retro: txt('f-retro'), territory: txt('f-territory'),
    fxRate: (() => { const v = stripC($('f-fx-rate').value); return v ? fmtN(v) : ''; })(),
    fxDate: $('f-fx-date').value.trim(),
    // cyber
    sl_ext: money('f-sl-ext'), sl_osp: money('f-sl-osp'), sl_fines: money('f-sl-fines'),
    sl_tel: money('f-sl-tel'), sl_cj: money('f-sl-cj'),
    waiting: $('f-waiting').value.trim() || '____',
    em_phone: $('f-em-phone').value.trim() || '____________',
    em_email: $('f-em-email').value.trim() || '____________',
    cov_bi: $('f-cov-bi').checked, cov_ext: $('f-cov-ext').checked, cov_media: $('f-cov-media').checked,
    // crime
    sl_se: money('f-sl-se'), sl_legal: money('f-sl-legal'), sl_inv: money('f-sl-inv'),
    sl_data: money('f-sl-data'), sl_fire: money('f-sl-fire'),
  };
  return { raw, d };
}

const inc = on => on ? { ru: "включено", en: "included" } : { ru: "не включено", en: "not included" };

// Shared row: policyholder + INN. INN appears on every policy (req: documents
// carry the customer's company name + INN).
function innRows(d) {
  const ph = d.insured;
  return [
    ["СТРАХОВАТЕЛЬ:", "THE POLICYHOLDER:", ph + (d.address !== '____________' ? ", " + d.address : ""), ph + (d.address !== '____________' ? ", " + d.address : "")],
    ["ИНН СТРАХОВАТЕЛЯ:", "POLICYHOLDER INN:", d.inn, d.inn],
  ];
}

function scheduleRowsCyber(d) {
  return [
    ["НОМЕР СТРАХОВОГО ПОЛИСА:", "POLICY NUMBER:", d.polnum + " от " + d.poldate, d.polnum + " dd. " + d.poldate],
    ["ВИД СТРАХОВАНИЯ:", "TYPE OF INSURANCE:", "Комплексное страхование киберрисков", "Cyber Insurance"],
    ["СТРАХОВЩИК:", "THE INSURER:",
      "АО СО «MOSAIC INSURANCE GROUP», Узбекистан, 100060, Ташкент, ул. Эльбека, 14, Бизнес-Центр Авиапарк. Лицензия № 091338 от 14 Июня 2023 г.",
      "MOSAIC INSURANCE GROUP JSC, Aviapark Business Center, 14, Elbek Str., Tashkent, 100060, Uzbekistan. License No. 091338 dd. June 14, 2023"],
    ["СТРАХОВОЙ БРОКЕР:", "INSURANCE BROKER:", d.broker, d.broker],
    ...innRows(d),
    ["БЕНЕФИЦИАР:", "THE BENEFICIARY:", d.beneficiary, d.beneficiary],
    ["ОПИСАНИЕ ДЕЯТЕЛЬНОСТИ:", "BUSINESS DESCRIPTION:", d.business, d.business],
    ["ОБЪЕКТ СТРАХОВАНИЯ:", "OBJECT OF INSURANCE:",
      "Имущественные интересы Страхователя, связанные с расходами и убытками от инцидентов информационной безопасности, перерывом в деятельности, кибервымогательством, а также с ответственностью за нарушение безопасности и конфиденциальности данных и за медиа-контент, в соответствии с условиями настоящего Полиса.",
      "Property interests of the Policyholder related to costs and losses arising from information security incidents, business interruption and cyber extortion, and to liability for breaches of data security, privacy and media content, in accordance with the terms of this Policy."],
    ["СТРАХОВОЙ СЛУЧАЙ:", "INSURED EVENT:",
      "События, определённые пунктом 3.20 прилагаемых Правил, впервые наступившие, обнаруженные или заявленные в течение Периода страхования (или Периода обнаружения) в соответствии с Разделами I и II прилагаемых Правил.",
      "The events defined in clause 3.20 of the attached terms, first occurring, discovered or made during the Policy Period (or the Discovery Period) in accordance with Sections I and II of the attached terms and conditions."],
    ["ВКЛЮЧЁННЫЕ ПОКРЫТИЯ:", "INSURED COVERS:",
      "1.1 Реагирование на инциденты — включено; 1.2 Перерыв в деятельности — " + inc(d.cov_bi).ru + "; 1.3 Кибервымогательство — " + inc(d.cov_ext).ru + "; 1.4 Ответственность за безопасность и конфиденциальность данных — включено; 1.5 Ответственность за медиа-контент — " + inc(d.cov_media).ru + "; Расширения 2.1–2.4 — включены в пределах сублимитов.",
      "1.1 Incident Response and Event Management — included; 1.2 Business Interruption — " + inc(d.cov_bi).en + "; 1.3 Cyber Extortion — " + inc(d.cov_ext).en + "; 1.4 Security and Privacy Liability — included; 1.5 Media Liability — " + inc(d.cov_media).en + "; Extensions 2.1–2.4 — included subject to sublimits."],
    ["ЛИМИТ ОТВЕТСТВЕННОСТИ:", "LIMIT OF LIABILITY:",
      d.limit + " в агрегате по всем покрытиям за Период страхования", d.limit + " in the aggregate, all covers combined, for the Policy Period"],
    ["СУБЛИМИТЫ:", "SUBLIMITS:",
      "Кибервымогательство: " + d.sl_ext + "; Перерыв вследствие сбоя у внешнего поставщика: " + d.sl_osp + "; Штрафы по защите данных и PCI-DSS: " + d.sl_fines + "; Телефонная система: " + d.sl_tel + "; Криптоджекинг: " + d.sl_cj + "; Расходы на подготовку доказательства убытка: до 10% от Убытка от прерывания.",
      "Cyber Extortion: " + d.sl_ext + "; Dependent Business Interruption (OSP): " + d.sl_osp + "; Data Protection Fines & PCI-DSS: " + d.sl_fines + "; Telephone Hacking: " + d.sl_tel + "; Cryptojacking: " + d.sl_cj + "; Loss Preparation Costs: up to 10% of the Network Loss."],
    ["ФРАНШИЗА:", "RETENTION:",
      d.retention + " по каждому Единому страховому случаю. Страхователь не страхует сумму франшизы.",
      d.retention + " each and every Single Insured Event. The Policyholder shall effect no insurance in respect of the retention."],
    ["ПЕРИОД ОЖИДАНИЯ:", "WAITING PERIOD:", d.waiting + " часов (Покрытие 1.2)", d.waiting + " hours (Cover 1.2)"],
    ["РЕТРОАКТИВНАЯ ДАТА:", "RETROACTIVE DATE:", d.retro, d.retro],
    ["ДАТА ВСТУПЛЕНИЯ В СИЛУ:", "COMMENCEMENT DATE:", "С 00.00 часов " + d.from, "00.00 hours on " + d.from],
    ["ПЕРИОД ДЕЙСТВИЯ ПОЛИСА:", "POLICY PERIOD:", "Со дня вступления в силу до 24.00 часов " + d.to, "From the commencement date until 24.00 hours on " + d.to],
    ["ЭКСТРЕННАЯ СВЯЗЬ:", "EMERGENCY CONTACT:",
      "При инциденте: " + d.em_phone + " (телефон), " + d.em_email + " (e-mail), с последующим письменным уведомлением (пункт 5.2 Правил).",
      "In the event of an incident: " + d.em_phone + " (phone), " + d.em_email + " (e-mail), followed by written notice (clause 5.2 of the terms)."],
    ["ДОСРОЧНОЕ РАСТОРЖЕНИЕ:", "CANCELLATION OF THE POLICY:",
      "Полис может быть расторгнут Страхователем в одностороннем порядке c письменным уведомлением Страховщика за 10 дней; Страховщик удерживает часть премии пропорционально сроку действия страхования и понесённые расходы. Страховщик вправе расторгнуть Полис с письменным уведомлением Страхователя за 10 дней с удержанием премии пропорционально сроку действия страхования.",
      "This Policy may be cancelled at the request of the Policyholder by 10 days' written notice to the Insurer; the Insurer retains premium pro-rata plus incurred expenses (short-rate). The Insurer may cancel by 10 days' prior written notice, retaining premium pro-rata to the period on risk."],
    ["ТЕРРИТОРИЯ ДЕЙСТВИЯ:", "GEOGRAPHICAL LIMITS:", d.territory, d.territory],
    ["СТРАХОВАЯ ПРЕМИЯ:", "PREMIUM:", d.premium, d.premium],
    ["ОПЛАТА СТРАХОВОЙ ПРЕМИИ:", "PREMIUM PAYMENT:", "На банковский счет Страховщика не позднее " + d.premdue, "Payable to the Insurer's bank account on or before " + d.premdue],
    ["ВЫПЛАТА СТРАХОВОГО ВОЗМЕЩЕНИЯ:", "INSURANCE INDEMNITY PAYMENT:",
      "Согласно условиям прилагаемых Правил Комплексного Страхования Киберрисков.", "In accordance with the attached Cyber Insurance terms and conditions."],
    ["ПРИМЕНИМОЕ ПРАВО:", "JURISDICTION:",
      "Настоящий Полис составлен и регулируется в соответствии с действующим законодательством Республики Узбекистан.", "This Policy shall be executed and governed by the Laws of the Republic of Uzbekistan."],
    ["ВАЛЮТА:", "CURRENCY:",
      "Все взаиморасчеты между Сторонами по настоящему Полису осуществляются в валюте, указанной в настоящем Графике.", "All transactions under this Policy are to be made by the Parties in the currency specified in this Schedule."],
    ["ЯЗЫК:", "LANGUAGE:",
      "Полис составлен в двух экземплярах на английском и русском языках, имеющих одинаковую юридическую силу.", "This Policy is executed in two copies in English and Russian, which are equally legal."],
  ];
}

function scheduleRowsCrime(d) {
  return [
    ["НОМЕР СТРАХОВОГО ПОЛИСА:", "POLICY NUMBER:", d.polnum + " от " + d.poldate, d.polnum + " dd. " + d.poldate],
    ["ВИД СТРАХОВАНИЯ:", "TYPE OF INSURANCE:", "Комплексное страхование от преступлений", "Commercial Crime Insurance"],
    ["СТРАХОВЩИК:", "THE INSURER:",
      "АО СО «MOSAIC INSURANCE GROUP», Узбекистан, 100060, Ташкент, ул. Эльбека, 14, Бизнес-Центр Авиапарк. Лицензия № 091338 от 14 Июня 2023 г.",
      "MOSAIC INSURANCE GROUP JSC, Aviapark Business Center, 14, Elbek Str., Tashkent, 100060, Uzbekistan. License No. 091338 dd. June 14, 2023"],
    ["СТРАХОВОЙ БРОКЕР:", "INSURANCE BROKER:", d.broker, d.broker],
    ...innRows(d),
    ["БЕНЕФИЦИАР:", "THE BENEFICIARY:", d.beneficiary, d.beneficiary],
    ["ОПИСАНИЕ ДЕЯТЕЛЬНОСТИ:", "BUSINESS DESCRIPTION:", d.business, d.business],
    ["ОБЪЕКТ СТРАХОВАНИЯ:", "OBJECT OF INSURANCE:",
      "Имущественные интересы Страхователя, связанные с прямыми финансовыми убытками от противоправных деяний Сотрудников или мошеннических действий Иных лиц в соответствии с условиями настоящего Полиса.",
      "Property interests of the Policyholder related to direct financial loss caused by wrongful acts of Employees or fraudulent acts of Other persons in accordance with the terms of this Policy."],
    ["СТРАХОВОЙ СЛУЧАЙ:", "INSURED EVENT:",
      "Обнаружение в течение Периода страхования (или Периода обнаружения) прямого финансового убытка, покрываемого в соответствии с Разделом I прилагаемых Правил.",
      "The discovery, during the Policy Period (or the Discovery Period), of direct financial loss covered under Section I of the attached terms and conditions."],
    ["ЛИМИТ ОТВЕТСТВЕННОСТИ:", "LIMIT OF LIABILITY:",
      d.limit + " по каждому убытку и в агрегате по всем покрытиям", d.limit + " any single loss and in the aggregate, all covers combined"],
    ["СУБЛИМИТЫ:", "SUBLIMITS:",
      "Социальная инженерия: " + d.sl_se + "; Юридические расходы: " + d.sl_legal + "; Расследование: " + d.sl_inv + "; Восстановление данных: " + d.sl_data + "; Пожар (ден. средства): " + d.sl_fire,
      "Social Engineering Fraud: " + d.sl_se + "; Legal fees: " + d.sl_legal + "; Investigation: " + d.sl_inv + "; Data reconstitution: " + d.sl_data + "; Fire (money & securities): " + d.sl_fire],
    ["ФРАНШИЗА:", "RETENTION:",
      d.retention + " по каждому убытку. Страхователь не страхует сумму франшизы.",
      d.retention + " each and every loss. The Policyholder shall effect no insurance in respect of the retention."],
    ["РЕТРОАКТИВНАЯ ДАТА:", "RETROACTIVE DATE:", d.retro, d.retro],
    ["ДАТА ВСТУПЛЕНИЯ В СИЛУ:", "COMMENCEMENT DATE:", "С 00.00 часов " + d.from, "00.00 hours on " + d.from],
    ["ПЕРИОД ДЕЙСТВИЯ ПОЛИСА:", "POLICY PERIOD:", "Со дня вступления в силу до 24.00 часов " + d.to, "From the commencement date until 24.00 hours on " + d.to],
    ["ДОСРОЧНОЕ РАСТОРЖЕНИЕ:", "CANCELLATION OF THE POLICY:",
      "Полис может быть расторгнут Страхователем в одностороннем порядке c письменным уведомлением Страховщика за 10 дней; Страховщик удерживает часть премии пропорционально сроку действия страхования и понесённые расходы. Страховщик вправе расторгнуть Полис с письменным уведомлением Страхователя за 10 дней с удержанием премии пропорционально сроку действия страхования.",
      "This Policy may be cancelled at the request of the Policyholder by 10 days' written notice to the Insurer; the Insurer retains premium pro-rata plus incurred expenses (short-rate). The Insurer may cancel by 10 days' prior written notice, retaining premium pro-rata to the period on risk."],
    ["ТЕРРИТОРИЯ ДЕЙСТВИЯ:", "GEOGRAPHICAL LIMITS:", d.territory, d.territory],
    ["СТРАХОВАЯ ПРЕМИЯ:", "PREMIUM:", d.premium, d.premium],
    ["ОПЛАТА СТРАХОВОЙ ПРЕМИИ:", "PREMIUM PAYMENT:", "На банковский счет Страховщика не позднее " + d.premdue, "Payable to the Insurer's bank account on or before " + d.premdue],
    ["ВЫПЛАТА СТРАХОВОГО ВОЗМЕЩЕНИЯ:", "INSURANCE INDEMNITY PAYMENT:",
      "Согласно условиям прилагаемых Правил Комплексного Страхования от Преступлений.", "In accordance with the attached Commercial Crime Insurance terms and conditions."],
    ["ПРИМЕНИМОЕ ПРАВО:", "JURISDICTION:",
      "Настоящий Полис составлен и регулируется в соответствии с действующим законодательством Республики Узбекистан.", "This Policy shall be executed and governed by the Laws of the Republic of Uzbekistan."],
    ["ВАЛЮТА:", "CURRENCY:",
      "Все взаиморасчеты между Сторонами по настоящему Полису осуществляются в валюте, указанной в настоящем Графике.", "All transactions under this Policy are to be made by the Parties in the currency specified in this Schedule."],
    ["ЯЗЫК:", "LANGUAGE:",
      "Полис составлен в двух экземплярах на английском и русском языках, имеющих одинаковую юридическую силу.", "This Policy is executed in two copies in English and Russian, which are equally legal."],
  ];
}

function scheduleRows() {
  const { d } = F();
  const rows = TYPE === 'cyber' ? scheduleRowsCyber(d) : scheduleRowsCrime(d);
  // When the sums were converted from the source currency, record the rate used.
  if (d.fxRate) {
    const src = (srcMoney && srcMoney.currency) || 'USD';
    const tgt = $('f-currency').value;
    const ru = '1 ' + src + ' = ' + d.fxRate + ' ' + tgt + (d.fxDate ? ' на ' + d.fxDate : '');
    const en = '1 ' + src + ' = ' + d.fxRate + ' ' + tgt + (d.fxDate ? ' as at ' + d.fxDate : '');
    const i = rows.findIndex(r => r[1] === 'PREMIUM:');
    const row = ['КУРС ВАЛЮТЫ (' + src + '→' + tgt + '):', 'EXCHANGE RATE (' + src + '→' + tgt + '):', ru, en];
    if (i >= 0) rows.splice(i + 1, 0, row); else rows.push(row);
  }
  // Drop optional rows the underwriter left blank, so the document doesn't carry
  // empty "____________" or N/A lines (no broker, no retroactive date, no
  // beneficiary). The beneficiary field defaults to N/A → row omitted unless a
  // real beneficiary is entered.
  const isBlank = v => { const s = String(v || '').trim(); return s === '' || /^[_\s]+$/.test(s) || /^n\/?a$/i.test(s) || s === '—' || s === '-'; };
  const DROP_IF_BLANK = new Set(['INSURANCE BROKER:', 'RETROACTIVE DATE:', 'THE BENEFICIARY:']);
  return rows.filter(r => !(DROP_IF_BLANK.has(r[1]) && isBlank(r[2]) && isBlank(r[3])));
}

// ---------------- preview ----------------
function renderPreview() {
  const c = cfg();
  if (!c) { $('doc-root').innerHTML = ''; return; }  // no built type selected
  const W = c.W();
  const rows = scheduleRows();
  let h = '<div class="sheet">';
  h += '<div class="doc-head">' +
       '<img class="logo" src="data:image/png;base64,' + window.MIG_LOGO_B64 + '" alt="MIG" />' +
       '<div class="addrblock"><b>«Mosaic Insurance Group» JSC</b><br/>' +
       'Aviapark Business Center, 14, Elbek Str.,<br/>Tashkent, 100060, Uzbekistan<br/>' +
       '<b>АО СО «Mosaic Insurance Group»</b><br/>' +
       'Узбекистан, 100060, Ташкент,<br/>ул. Эльбека, 14, Бизнес-Центр Авиапарк</div></div>';
  h += '<h1 class="t">' + esc(c.titleRu) + '</h1><div class="tsub">страховой полис является Договором Страхования</div>';
  h += '<h1 class="t">' + esc(c.titleEn) + '</h1><div class="tsub">This Insurance Policy acts as an Insurance Agreement (contract)</div>';
  // Preamble with policyholder name substituted
  const ph = esc(F().d.insured);
  h += '<div class="bi2"><div><h3>' + esc(W.preamble.ruH) + '</h3><p>' + esc(W.preamble.ru).replace('____________________', '<b>' + ph + '</b>') + '</p><p>' + esc(W.preamble.ru2) + '</p></div>' +
       '<div><h3>' + esc(W.preamble.enH) + '</h3><p>' + esc(W.preamble.en).replace('____________________', '<b>' + ph + '</b>') + '</p><p>' + esc(W.preamble.en2) + '</p></div></div>';
  // Schedule
  h += '<h2 class="s">ГРАФИК / SCHEDULE</h2><table class="sched">';
  for (const [ruL, enL, ruV, enV] of rows) {
    h += '<tr><td><div class="lbl">' + esc(ruL) + '</div><div class="val">' + esc(ruV) + '</div></td>' +
         '<td><div class="lbl">' + esc(enL) + '</div><div class="val">' + esc(enV) + '</div></td></tr>';
  }
  h += '</table>';
  // Endorsements
  h += '<h2 class="s">ДОПОЛНЕНИЯ / ENDORSEMENTS</h2>';
  for (const e of W.endorsements) {
    h += '<table class="endt"><tr><td><div class="eh">' + esc(e.ruH) + '</div>' + esc(e.ru) + '</td>' +
         '<td><div class="eh">' + esc(e.enH) + '</div>' + esc(e.en) + '</td></tr></table>';
  }
  // Signature
  h += '<h2 class="s">ПОДПИСИ СТОРОН / SIGNATURES</h2>';
  h += '<p style="font-size:11px; margin-bottom:6px">Страхователь ознакомлен и согласен с условиями и положениями страхования, предоставленного настоящим Страховым Полисом / The Insured is familiarized and agrees with the terms and conditions of the insurance provided under this Policy.</p>';
  h += '<p style="font-size:11px; margin-bottom:8px">Дата подписания / Policy signing date: ' + esc(F().d.poldate) + '</p>';
  h += '<table class="sig"><tr><td><b>Компания / Company:</b> “MOSAIC INSURANCE GROUP” JSC / АО СО «MOSAIC INSURANCE GROUP»<br/><span style="font-size:10px">Acc: 2021 4000 1053 3830 3001 (UZS), 2021 4840 3053 3830 3001 (USD), 2021 4978 9053 3830 3001 (EUR). JSC “KDB Bank Uzbekistan”, Bank Code 00842, SWIFT KODBUZ22, TIN/ИНН 308143734</span><br/><br/><br/>_________________________ За Компанию / For the Company</td>' +
       '<td><b>Страхователь / Insured:</b> ' + ph + '<br/><span style="font-size:10px">ИНН / INN: ' + esc(F().d.inn) + '</span><br/><span style="font-size:10px">Адрес / Address: ' + esc(F().d.address) + '</span><br/><br/><br/>_________________________ За Страхователя / For the Insured</td></tr></table>';
  // Wording
  h += '<h2 class="s" style="margin-top:26px">' + esc(c.wordingRu) + '<br/>' + esc(c.wordingEn) + '</h2>';
  h += '<table class="wrd">';
  for (const item of W.wording) {
    const cls = item.t === 'h1' ? 'h1c' : item.t === 'h2' ? 'h2c' : '';
    h += '<tr><td class="' + cls + '">' + esc(item.ru) + '</td><td class="' + cls + '">' + esc(item.en) + '</td></tr>';
  }
  h += '</table>';
  h += '<div class="foot">' + esc(c.footer) + '</div>';
  h += '</div>';
  $('doc-root').innerHTML = h;
}

// ---------------- DOCX generation ----------------
async function generateDocx() {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
          AlignmentType, BorderStyle, WidthType, ShadingType, PageBreak } = docx;
  const c = cfg(), W = c.W();
  const rows = scheduleRows();
  const ph = F().d.insured;

  const CONTENT = 9638, HALF = CONTENT / 2, NAVY = "1F3864", TINT = "EAF0F8";
  const border = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const noB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: noB, bottom: noB, left: noB, right: noB };
  const margins = { top: 60, bottom: 60, left: 100, right: 100 };

  const para = (text, o = {}) => new Paragraph({
    alignment: o.align || AlignmentType.JUSTIFIED, spacing: { after: o.after ?? 80 },
    children: [new TextRun({ text, bold: !!o.bold, size: o.size || 19, font: "Times New Roman", color: o.color })],
  });
  const heading = (text, o = {}) => new Paragraph({
    alignment: o.align || AlignmentType.LEFT, spacing: { before: o.before ?? 160, after: 80 },
    children: [new TextRun({ text, bold: true, size: o.size || 21, font: "Times New Roman", color: o.color || NAVY })],
  });
  const biRow = (item) => {
    const isH1 = item.t === "h1", isH2 = item.t === "h2";
    const mk = (text) => new TableCell({
      borders: noBorders, width: { size: HALF, type: WidthType.DXA }, margins,
      shading: isH1 ? { fill: TINT, type: ShadingType.CLEAR } : undefined,
      children: [ isH1 ? heading(text, { align: AlignmentType.CENTER, size: 22, before: 60 })
                : isH2 ? heading(text, { size: 19, before: 100 }) : para(text) ],
    });
    return new TableRow({ children: [mk(item.ru), mk(item.en)] });  // RU left, EN right — consistent with the schedule
  };
  const schedRow = ([ruL, enL, ruV, enV]) => {
    const mk = (label, value) => new TableCell({
      borders, width: { size: HALF, type: WidthType.DXA }, margins,
      children: [
        new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: label, bold: true, size: 18, font: "Times New Roman", color: NAVY })] }),
        new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: value, size: 18, font: "Times New Roman" })] }),
      ],
    });
    return new TableRow({ children: [mk(ruL, ruV), mk(enL, enV)] });
  };

  const ch = [];
  // Letterhead: logo left, addresses right
  const { ImageRun } = docx;
  const logoBytes = Uint8Array.from(atob(window.MIG_LOGO_B64), c2 => c2.charCodeAt(0));
  const hdrLine = (text, bold) => new Paragraph({
    alignment: AlignmentType.RIGHT, spacing: { after: 10 },
    children: [new TextRun({ text, bold: !!bold, size: bold ? 17 : 16, font: "Arial", color: bold ? "222222" : "555555" })],
  });
  ch.push(new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: [Math.round(CONTENT * 0.45), Math.round(CONTENT * 0.55)],
    rows: [new TableRow({ children: [
      new TableCell({
        borders: noBorders, width: { size: Math.round(CONTENT * 0.45), type: WidthType.DXA },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new ImageRun({ data: logoBytes, transformation: { width: 132, height: 52 }, type: "png" })],
        })],
      }),
      new TableCell({
        borders: noBorders, width: { size: Math.round(CONTENT * 0.55), type: WidthType.DXA },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        children: [
          hdrLine("«Mosaic Insurance Group» JSC", true),
          hdrLine("Aviapark Business Center, 14, Elbek Str.,"),
          hdrLine("Tashkent, 100060, Uzbekistan"),
          hdrLine("АО СО «Mosaic Insurance Group»", true),
          hdrLine("Узбекистан, 100060, Ташкент,"),
          hdrLine("ул. Эльбека, 14, Бизнес-Центр Авиапарк"),
        ],
      }),
    ]})],
  }));
  ch.push(new Paragraph({
    spacing: { after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } },
    children: [new TextRun({ text: "", size: 2 })],
  }));
  ch.push(heading(c.titleRu, { align: AlignmentType.CENTER, size: 28, before: 120 }));
  ch.push(para("страховой полис является Договором Страхования", { align: AlignmentType.CENTER, size: 17, after: 120 }));
  ch.push(heading(c.titleEn, { align: AlignmentType.CENTER, size: 28, before: 40 }));
  ch.push(para("This Insurance Policy acts as an Insurance Agreement (contract)", { align: AlignmentType.CENTER, size: 17, after: 200 }));

  ch.push(new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: [HALF, HALF], rows: [
    new TableRow({ children: [
      new TableCell({ borders: noBorders, width: { size: HALF, type: WidthType.DXA }, margins,
        children: [heading(W.preamble.ruH, { align: AlignmentType.CENTER }), para(W.preamble.ru.replace('____________________', ph)), para(W.preamble.ru2)] }),
      new TableCell({ borders: noBorders, width: { size: HALF, type: WidthType.DXA }, margins,
        children: [heading(W.preamble.enH, { align: AlignmentType.CENTER }), para(W.preamble.en.replace('____________________', ph)), para(W.preamble.en2)] }),
    ]}),
  ]}));

  ch.push(heading("ГРАФИК / SCHEDULE", { align: AlignmentType.CENTER, size: 24, before: 240 }));
  ch.push(new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: [HALF, HALF], rows: rows.map(schedRow) }));

  ch.push(heading("ДОПОЛНЕНИЯ / ENDORSEMENTS", { align: AlignmentType.CENTER, size: 24, before: 240 }));
  for (const e of W.endorsements) {
    ch.push(new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: [HALF, HALF], rows: [
      new TableRow({ children: [
        new TableCell({ borders, width: { size: HALF, type: WidthType.DXA }, margins, children: [heading(e.ruH, { size: 18, before: 40 }), para(e.ru, { size: 18 })] }),
        new TableCell({ borders, width: { size: HALF, type: WidthType.DXA }, margins, children: [heading(e.enH, { size: 18, before: 40 }), para(e.en, { size: 18 })] }),
      ]}),
    ]}));
    ch.push(para("", { after: 60 }));
  }

  ch.push(heading("ПОДПИСИ СТОРОН / SIGNATURES", { align: AlignmentType.CENTER, size: 24, before: 200 }));
  ch.push(para("Страхователь ознакомлен и согласен с условиями и положениями страхования, предоставленного настоящим Страховым Полисом / The Insured is familiarized and agrees with the terms and conditions of the insurance provided under this Policy.", { size: 18 }));
  ch.push(para("Дата подписания / Policy signing date: " + F().d.poldate, { size: 18, after: 160 }));
  ch.push(new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: [HALF, HALF], rows: [
    new TableRow({ children: [
      new TableCell({ borders, width: { size: HALF, type: WidthType.DXA }, margins, children: [
        para("Компания / Company: “MOSAIC INSURANCE GROUP” JSC / АО СО «MOSAIC INSURANCE GROUP»", { bold: true, size: 18 }),
        para("Банковские реквизиты / Banking details: Acc: 2021 4000 1053 3830 3001 (UZS), 2021 4840 3053 3830 3001 (USD), 2021 4978 9053 3830 3001 (EUR). JSC “KDB Bank Uzbekistan”, Bank Code 00842, SWIFT KODBUZ22, TIN/ИНН 308143734", { size: 17 }),
        para("", { after: 200 }),
        para("_________________________  За Компанию / For the Company", { size: 18 }),
      ]}),
      new TableCell({ borders, width: { size: HALF, type: WidthType.DXA }, margins, children: [
        para("Страхователь / Insured: " + ph, { bold: true, size: 18 }),
        para("ИНН / INN: " + F().d.inn, { size: 17 }),
        para("Адрес / Address: " + F().d.address, { size: 17 }),
        para("", { after: 200 }),
        para("_________________________  За Страхователя / For the Insured", { size: 18 }),
      ]}),
    ]}),
  ]}));

  ch.push(new Paragraph({ children: [new PageBreak()] }));
  ch.push(heading(c.wordingRu, { align: AlignmentType.CENTER, size: 24, before: 80 }));
  ch.push(heading(c.wordingEn, { align: AlignmentType.CENTER, size: 24, before: 20 }));
  ch.push(para("Various provisions in this policy restrict coverage. Read the entire policy carefully. Capitalised terms have special meaning — refer to Section III. / Различные положения настоящего полиса ограничивают покрытие. Внимательно прочитайте весь полис. Термины с заглавной буквы имеют особое значение — см. Раздел III.", { size: 17, after: 160 }));
  ch.push(new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: [HALF, HALF], rows: W.wording.map(biRow) }));
  ch.push(para("", { after: 120 }));
  ch.push(para(c.footer + ".", { size: 15, align: AlignmentType.CENTER, color: "888888" }));

  const doc = new Document({
    styles: { default: { document: { run: { font: "Times New Roman", size: 19 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
      children: ch,
    }],
  });
  const blob = await Packer.toBlob(doc);
  // The docx UMD build omits the fontTable relationship that Word expects.
  // Patch the package so the file validates cleanly.
  try {
    const zip = await JSZip.loadAsync(blob);
    const relsPath = 'word/_rels/document.xml.rels';
    let rels = await zip.file(relsPath).async('string');
    if (zip.file('word/fontTable.xml') && !rels.includes('Target="fontTable.xml"')) {
      rels = rels.replace('</Relationships>',
        '<Relationship Id="rIdFontTablePatch" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>');
      zip.file(relsPath, rels);
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }
  } catch (e) { /* fall through with unpatched blob */ }
  return blob;
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function policyFileBase() {
  const r = F().raw;
  const num = (r.policy_number || 'DRAFT').replace(/[^\w\-]+/g, '_');
  return 'MIG_' + cfg().fileword + '_Policy_' + num;
}

// Suggest the next sequential policy number for this line/year (editable;
// the partial-unique index on policy_number still guards against duplicates).
async function suggestPolicyNumber() {
  const yr = String(new Date().getFullYear());
  const prefix = 'MIG-' + (TYPE === 'cyber' ? 'CY' : 'CR') + '-' + yr + '-';
  let max = 0;
  try {
    const { data } = await sb.from(cfg().table).select('policy_number');
    (data || []).forEach(p => {
      const n = String(p.policy_number || '');
      if (n.startsWith(prefix)) { const m = n.slice(prefix.length).match(/^(\d+)/); if (m) max = Math.max(max, parseInt(m[1], 10)); }
    });
  } catch (_) { /* best-effort */ }
  return prefix + String(max + 1).padStart(4, '0');
}

// ---------------- prefill ----------------
async function loadSources() {
  // Reset to the placeholder (avoids duplicate options when the type is switched).
  $('sub-select').innerHTML = '<option value="">— none / manual —</option>';
  $('quote-select').innerHTML = '<option value="">— none / manual —</option>';
  const { data: subs } = await sb.from('submissions')
    .select('id, created_at, proposer_name, products')
    .contains('products', [TYPE])
    .order('created_at', { ascending: false }).limit(25);
  (subs || []).forEach(s => {
    $('sub-select').add(new Option(new Date(s.created_at).toLocaleDateString() + ' — ' + (s.proposer_name || '(unnamed)'), s.id));
  });
  const { data: quotes } = await sb.from(cfg().quotes)
    .select('id, created_at, insured_name, final_premium, inputs')
    .order('created_at', { ascending: false }).limit(25);
  (quotes || []).forEach(q => {
    $('quote-select').add(new Option(new Date(q.created_at).toLocaleDateString() + ' — ' + (q.insured_name || '(unnamed)') + ' — ' + fmtN(q.final_premium), q.id));
  });
  // Default to the latest available submission + rater quote so the terms pull
  // and the AI recommendations run immediately; if none, stays "— none / manual —".
  if (subs && subs.length) $('sub-select').value = subs[0].id;
  if (quotes && quotes.length) $('quote-select').value = quotes[0].id;
  if ($('sub-select').value || $('quote-select').value) loadAndFill();
}

function setVal(id, v, badgeId) {
  if (v === undefined || v === null || v === '') return;
  $(id).value = String(v);
  $(id).dispatchEvent(new Event('input'));
  if (badgeId) $(badgeId).classList.remove('hidden');
}

async function loadAndFill() {
  $('load-note').textContent = 'Loading…';
  loadedSubmissionId = $('sub-select').value || null;
  loadedQuoteId = $('quote-select').value || null;

  if (loadedSubmissionId) {
    const { data, error } = await sb.from('submissions').select('id, proposer_name, proposer_inn, customer_id, payload').eq('id', loadedSubmissionId).single();
    if (!error && data) {
      const f = (data.payload && data.payload.fields) || {};
      loadedCustomerId = data.customer_id || null;
      setVal('f-insured', data.proposer_name || subField(f, 'proposer_name'), 'pf-name');
      setVal('f-inn', data.proposer_inn || subField(f, 'proposer_inn'), 'pf-inn');
      setVal('f-address', subField(f, 'address', 'registered_address'), 'pf-addr');
      setVal('f-business', subField(f, 'nature_of_business', 'business_description', 'business'), 'pf-biz');
      const L = (TYPE === 'cyber') ? ['cyber', 'cy'] : ['crime', 'cr'];
      setVal('f-from', subField(f, L[0] + '_period_from', L[1] + '_period_from', 'period_from'), 'pf-from');
      setVal('f-to', subField(f, L[0] + '_period_to', L[1] + '_period_to', 'period_to'), 'pf-to');
      const benName = subField(f, L[0] + '_ben_name', L[1] + '_ben_name');
      const benAddr = subField(f, L[0] + '_ben_address', L[1] + '_ben_address');
      if (benName) setVal('f-beneficiary', [benName, benAddr].filter(Boolean).join(', '), 'pf-ben');
      applyTerritory(geoFromFields(f, L));
    }
  }
  if (loadedQuoteId) {
    const { data, error } = await sb.from(cfg().quotes).select('id, insured_name, final_premium, inputs, customer_id').eq('id', loadedQuoteId).single();
    if (!error && data) {
      if (!loadedCustomerId && data.customer_id) loadedCustomerId = data.customer_id;
      if (!$('f-insured').value) setVal('f-insured', data.insured_name, 'pf-name');
      setVal('f-limit', data.inputs.limit, 'pf-limit');
      setVal('f-retention', TYPE === 'cyber' ? data.inputs.retention : data.inputs.deductible, 'pf-ret');
      setVal('f-premium', Math.round(data.final_premium), 'pf-prem');
      // Rater sums are USD-rated; remember them so applyFx() can convert into
      // the policy currency (UZS default) at the underwriter's exchange rate.
      recordSrcMoney('limit', data.inputs.limit, 'USD');
      recordSrcMoney('retention', TYPE === 'cyber' ? data.inputs.retention : data.inputs.deductible, 'USD');
      recordSrcMoney('premium', Math.round(data.final_premium), 'USD');
      if (TYPE === 'cyber') {
        const ext = data.inputs.extensions || {};
        $('f-cov-bi').checked = !!ext.business_interruption;
        $('f-cov-ext').checked = !!ext.cyber_extortion;
        $('f-cov-media').checked = !!ext.media_content;
        $('pf-covers').classList.remove('hidden');
      }
    }
  }
  $('load-note').textContent = 'Loaded. Verify every field, then complete the manual ones.';
  markDraft();
  renderPreview();
  applyFx();             // convert USD-rated sums into the policy currency (or warn)
  aiRecommendPolicy();   // fill still-empty terms with Claude recommendations (amber)
}

// Auto-fill the still-empty schedule terms with Claude's recommended values
// (limit / retention / premium / territory) and the granular sub-limits, each
// marked amber so the underwriter sees it is a suggestion to verify. No button —
// runs after the real submission/quote prefill, and never overwrites a value
// that is already present.
async function aiRecommendPolicy() {
  if (!loadedSubmissionId || !window.MIG_REC) return;
  const note = $('load-note');
  const base = note.textContent;
  note.textContent = base + '  ·  asking Claude for recommended terms…';
  try {
    MIG_REC.ensureCss();
    const { byCode } = await MIG_REC.fetch(sb, loadedSubmissionId);
    const r = byCode[TYPE];
    if (!r) { note.textContent = base; return; }
    const empty = id => !String($(id).value || '').trim();
    const put = (id, badgeId, v) => {
      if (!v || !empty(id)) return false;
      setVal(id, v); MIG_REC.badge(badgeId, r.note || 'AI recommended — verify');
      MIG_REC.mark($(id), 'AI recommended — verify'); return true;
    };
    let filled = 0;
    // Claude's sums are USD-rated — record them so applyFx() converts properly.
    if (put('f-limit', 'pf-limit', r.limit)) { filled++; recordSrcMoney('limit', r.limit, 'USD'); }
    if (put('f-retention', 'pf-ret', r.deductible)) { filled++; recordSrcMoney('retention', r.deductible, 'USD'); }
    if (put('f-premium', 'pf-prem', r.premium)) { filled++; recordSrcMoney('premium', r.premium, 'USD'); }
    filled += put('f-territory', 'pf-terr', r.territory) ? 1 : 0;
    filled += aiFillSublimits();
    // AI sums are USD — convert into the policy currency (or warn) BEFORE
    // applying the per-field details, so they aren't overwritten by the
    // %-of-limit re-suggestion that the converted limit triggers.
    if (filled) applyFx();
    // Claude's per-field sub-limit recommendations refine the %-of-limit
    // defaults — scaled into the policy currency, and never overwriting a value
    // the underwriter typed themselves. Skipped while the exchange rate is
    // missing (the %-of-the-converted-limit suggestions remain).
    const tgtCur = $('f-currency').value;
    const srcCur = (srcMoney && srcMoney.currency) || 'USD';
    const fxMult = srcCur === tgtCur ? 1 : (Number(stripC($('f-fx-rate').value)) || 0);
    if (fxMult > 0) {
      const SL_MAP = TYPE === 'cyber'
        ? { extortion: 'f-sl-ext', osp_bi: 'f-sl-osp', fines_pci: 'f-sl-fines', telephone: 'f-sl-tel', cryptojacking: 'f-sl-cj' }
        : { social_engineering: 'f-sl-se', legal_fees: 'f-sl-legal', investigation: 'f-sl-inv', data_reconstitution: 'f-sl-data', fire_money: 'f-sl-fire' };
      const det = r.sublimits_detail || {};
      Object.entries(SL_MAP).forEach(([k, id]) => {
        const v = Math.round((Number(det[k]) || 0) * fxMult);
        if (!v) return;
        const el = $(id);
        const untouched = !String(el.value || '').trim() || el.dataset.aiSug === '1';
        if (!untouched) return;
        if (String(v) !== String(el.value)) { el.value = String(v); filled++; }
        markSuggested(id, 'AI recommended sub-limit — verify');
      });
    }
    note.textContent = filled
      ? 'AI suggested ' + filled + ' empty field(s), shown in amber. Verify every value before issuing.'
      : base;
    markDraft(); renderPreview();
  } catch (_e) {
    note.textContent = base + '  ·  AI suggestion unavailable';
  }
}

// Mark a field as carrying a recommended (not underwriter-entered) value:
// amber input + an amber "AI" pill next to the label, same visual language as
// the green auto/quote badges. A real keystroke makes the value the
// underwriter's own — mark, pill and tracking flag all clear.
function markSuggested(id, tip) {
  const el = $(id);
  el.classList.add('ai-rec');
  el.title = tip;
  const b = $('pf-' + id.slice(2));   // f-sl-ext -> pf-sl-ext
  if (b) { b.classList.remove('hidden'); b.title = tip; }
  if (el.dataset.aiSug === '1') return;   // clear-listener already attached
  el.dataset.aiSug = '1';
  el.addEventListener('input', () => {
    el.dataset.aiSug = ''; el.classList.remove('ai-rec'); el.title = '';
    if (b) b.classList.add('hidden');
  }, { once: true });
}

// Fill the granular sub-limits from the limit using standard market
// percentages, marking each amber. No button — runs whenever the limit is set
// or changed (including manual entry); Claude's per-field recommendations
// (aiRecommendPolicy) then refine these where available. Only touches fields
// that are empty or still carrying an earlier auto-suggestion; anything the
// underwriter typed is never overwritten.
function aiFillSublimits() {
  const limit = Number(stripC($('f-limit').value)) || 0;
  if (!limit || !TYPE) return 0;
  if (window.MIG_REC) MIG_REC.ensureCss();
  const pct = TYPE === 'cyber'
    ? [['f-sl-ext', .50], ['f-sl-osp', .25], ['f-sl-fines', .50], ['f-sl-tel', .05], ['f-sl-cj', .05]]
    : [['f-sl-se', .10], ['f-sl-legal', .05], ['f-sl-inv', .05], ['f-sl-data', .05], ['f-sl-fire', .05]];
  let n = 0;
  pct.forEach(([id, p]) => {
    const el = $(id);
    const untouched = !String(el.value || '').trim() || el.dataset.aiSug === '1';
    if (!untouched) return;
    el.value = String(Math.round(limit * p));
    markSuggested(id, 'Suggested sub-limit (' + Math.round(p * 100) + '% of limit) — verify');
    n++;
  });
  if (n) { markDraft(); renderPreview(); }
  return n;
}

// ---------------- currency conversion ----------------
// Loaded limit/retention/premium are USD-rated (rater quote, Claude). The
// policy is usually issued in UZS, so the sums must be CONVERTED, not copied.
// The underwriter provides the rate (1 <source> = X <policy currency>); fields
// recompute from srcMoney whenever the rate or the currency changes. Without a
// rate while currencies differ, a warning shows and generation is blocked.
function fxBlocked() {
  if (!srcMoney) return null;
  const src = srcMoney.currency || 'USD', tgt = $('f-currency').value;
  if (src === tgt) return null;
  const rate = Number(stripC($('f-fx-rate').value)) || 0;
  if (rate > 0) return null;
  return 'The loaded sums are in ' + src + ' but the policy currency is ' + tgt +
    '. Enter the exchange rate (1 ' + src + ' = … ' + tgt + ') to convert them, or switch the policy currency to ' + src + '.';
}
function applyFx() {
  const tgt = $('f-currency').value;
  const src = srcMoney ? (srcMoney.currency || 'USD') : 'USD';
  // dynamic label + warning banner
  $('lbl-fx').innerHTML = 'Exchange rate ' + esc(src) + '→' + esc(tgt) +
    ' <span style="text-transform:none; color:var(--muted);">(1 ' + esc(src) + ' = … ' + esc(tgt) + ')</span>';
  const warn = $('fx-warn'), msg = fxBlocked();
  warn.textContent = msg || '';
  warn.style.display = msg ? 'block' : 'none';
  if (window.MIG_MONEY) MIG_MONEY.refresh();
  if (!srcMoney) { renderPreview(); return; }
  const rate = src === tgt ? 1 : (Number(stripC($('f-fx-rate').value)) || 0);
  if (!rate) { renderPreview(); return; }   // waiting for the rate; warning shown
  [['limit', 'f-limit'], ['retention', 'f-retention'], ['premium', 'f-premium']].forEach(([k, id]) => {
    if (srcMoney[k] == null) return;
    setVal(id, Math.round(srcMoney[k] * rate));   // dispatches input → sublimits re-suggest from the new limit
  });
  if (rate !== 1) $('load-note').textContent = 'Sums converted ' + src + '→' + tgt + ' at ' + fmtN(rate) + '. Verify every value.';
  markDraft(); renderPreview();
}
// Record a loaded source value (currency defaults to USD — rater/AI are USD-rated).
function recordSrcMoney(k, v, currency) {
  const n = Number(stripC(String(v ?? ''))) || 0;
  if (!n) return;
  srcMoney = srcMoney || { currency: currency || 'USD' };
  if (currency) srcMoney.currency = currency;
  srcMoney[k] = n;
}

// Resolve the owning customer for a policy: loaded submission/quote, else by INN, else company name.
async function resolvePolicyCustomerId(inn, name) {
  if (loadedCustomerId) return loadedCustomerId;
  if (inn) { const { data } = await sb.from('customers').select('user_id').eq('inn', String(inn).trim()).limit(1); if (data && data[0]) return data[0].user_id; }
  if (name) { const { data } = await sb.from('customers').select('user_id').ilike('company', String(name).trim()).limit(1); if (data && data[0]) return data[0].user_id; }
  return null;
}

function applyTerritory(geo) {
  if (geo.length === 1 && geo[0] === 'UZ') {
    setVal('f-territory', 'The Republic of Uzbekistan / Республика Узбекистан', 'pf-terr');
  } else if (geo.includes('WW')) {
    setVal('f-territory', 'Worldwide excluding sanctioned territories / Весь мир, за исключением санкционных территорий', 'pf-terr');
  } else if (geo.length) {
    setVal('f-territory', geo.join(', '), 'pf-terr');
  }
}

// ---------------- confirm / issue ----------------
function markDraft() {
  if (issued) {
    issued = false;
    $('btn-final').classList.add('hidden');
    $('status-pill').textContent = 'draft (modified)';
    $('status-pill').classList.remove('issued');
    $('gen-note').textContent = 'Fields changed after issuance — confirm again to re-issue and unlock the issued copy.';
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

async function confirmIssue() {
  const fxMsg = fxBlocked();
  if (fxMsg) { alert(fxMsg); $('fx-warn').style.display = 'block'; return; }
  const r = F().raw;
  const missing = [];
  if (!r.policy_number) missing.push('policy number');
  if (!r.insured) missing.push('policyholder');
  if (!r.limit) missing.push('limit');
  if (!r.premium) missing.push('premium');
  if (!r.period_from || !r.period_to) missing.push('policy period');
  if (missing.length) { $('gen-note').textContent = 'Required before issuing: ' + missing.join(', ') + '.'; return; }

  $('btn-confirm').disabled = true;
  $('gen-note').textContent = 'Generating document & saving policy record…';
  // Persist the issued Word document so the customer can download it from their portal.
  let _docB64 = null, _docFn = null, _blob = null;
  try {
    _blob = await generateDocx();
    _docB64 = await blobToBase64(_blob);
    _docFn = policyFileBase() + '.docx';
  } catch (e) { console.error('Policy document generation failed:', e); }
  const customer_id = await resolvePolicyCustomerId(r.inn, r.insured);
  const payload = {
    created_by: session.user.id,
    submission_id: loadedSubmissionId,
    quote_id: loadedQuoteId,
    customer_id,
    policy_number: r.policy_number,
    insured_name: r.insured,
    inn: r.inn || null,
    fields: r,
    status: 'issued',
    issued_at: new Date().toISOString(),
    doc_base64: _docB64,
    doc_filename: _docFn,
  };
  let resp;
  if (policyRecordId) {
    resp = await sb.from(cfg().table).update(payload).eq('id', policyRecordId).select('id').single();
  } else {
    resp = await sb.from(cfg().table).insert(payload).select('id').single();
  }
  if (resp.error) { $('btn-confirm').disabled = false; $('gen-note').textContent = 'Error: ' + resp.error.message; return; }
  policyRecordId = resp.data ? resp.data.id : policyRecordId;
  // Move the document to Storage; on success drop the heavy base64 from the row.
  if (window.MIG_DOC && _blob && policyRecordId) {
    const path = 'policies/' + (customer_id || 'unlinked') + '/' + policyRecordId + '.docx';
    const stored = await MIG_DOC.upload(sb, path, _blob);
    if (stored) await sb.from(cfg().table).update({ doc_path: stored, doc_base64: null }).eq('id', policyRecordId);
  }
  $('btn-confirm').disabled = false;
  issued = true;
  $('status-pill').textContent = 'issued';
  $('status-pill').classList.add('issued');
  $('btn-final').classList.remove('hidden');
  $('gen-note').textContent = 'Policy record saved. The issued Word document is now available for download.';
}

// ---------------- type switch ----------------
function selectType(type) {
  TYPE = type || '';
  $('policy-type').value = TYPE;
  // reset the issuance state on any switch — a different type targets a different table
  loadedSubmissionId = null; loadedQuoteId = null; loadedCustomerId = null;
  issued = false; policyRecordId = null;
  srcMoney = null; $('fx-warn').style.display = 'none';
  $('status-pill').textContent = 'draft'; $('status-pill').classList.remove('issued');
  $('btn-final').classList.add('hidden');
  $('load-note').textContent = '';
  document.querySelectorAll('.prefill-badge').forEach(b => b.classList.add('hidden'));

  // No type chosen yet — show only the picker.
  if (!TYPE) {
    $('policy-form').classList.add('hidden');
    $('policy-msg').classList.add('hidden');
    renderPreview();
    return;
  }
  // Listed but no bilingual wording configured.
  if (!POLICY_BUILT.includes(TYPE)) {
    $('policy-form').classList.add('hidden');
    $('policy-msg').classList.remove('hidden');
    $('policy-msg').innerHTML = '<h2>' + esc(POLICY_LABELS[TYPE] || TYPE) + '</h2>' +
      '<p class="note">Policy issuance for this line isn’t configured yet — only <strong>Cyber</strong> and <strong>Crime</strong> have bilingual wording. ' +
      'For other lines, produce terms with the <a href="/admin/quote/">Quotation generator</a>, or ask an admin to add the wording.</p>';
    renderPreview();
    return;
  }
  // built (cyber / crime)
  $('policy-msg').classList.add('hidden');
  $('policy-form').classList.remove('hidden');
  const isCyber = TYPE === 'cyber';
  $('cy-covers').classList.toggle('hidden', !isCyber);
  $('cy-extra').classList.toggle('hidden', !isCyber);
  $('cy-sublimits').classList.toggle('hidden', !isCyber);
  $('cr-sublimits').classList.toggle('hidden', isCyber);
  $('f-polnum').placeholder = cfg().polnum;
  $('sub-label').textContent = (isCyber ? 'Cyber' : 'Crime') + ' submission (auto-fill)';
  $('rater-link').href = '/admin/rater/?type=' + TYPE;
  $('sub-select').innerHTML = '<option value="">— none / manual —</option>';
  $('quote-select').innerHTML = '<option value="">— none / manual —</option>';
  loadSources();
  if (!$('f-polnum').value) suggestPolicyNumber().then(n => { if (!$('f-polnum').value) { $('f-polnum').value = n; renderPreview(); } });
  renderPreview();
}

// ---------------- init ----------------
(async function init() {
  if (SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_PUBLISHABLE_KEY.includes('REPLACE_ME')) {
    $('auth-gate').innerHTML = '<div class="card"><h2>Not configured</h2><p class="note" style="margin-top:10px">Paste the Supabase credentials in /config.js before deploying.</p></div>';
    return;
  }
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) { $('gate-checking').style.display = 'none'; $('gate-login').style.display = ''; return; }
  // A session alone is not enough — require MIG staff membership (cached per tab).
  const isStaff = await MIG_AUTH.isStaff(sb, session.user.id);
  if (!isStaff) {
    const email = (session.user.email || 'This account').replace(/[<>&]/g, '');
    // Do NOT signOut() here — it revokes the shared session for every page/tab.
    $('auth-gate').innerHTML = '<div class="card"><h2>Account not authorized</h2>' +
      '<p class="note" style="margin:10px 0 16px">' + email + ' is signed in but is not on the MIG staff list, so it cannot access admin tools. Contact an administrator to be added, or sign in with an authorized account.</p>' +
      '<a class="btn primary" href="/admin/" style="text-decoration:none">Back to login</a></div>';
    return;
  }
  $('auth-gate').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('btn-signout').classList.remove('hidden');
  $('btn-signout').onclick = async () => { MIG_AUTH.clear(); await sb.auth.signOut(); location.reload(); };

  // defaults
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0'), mm = String(today.getMonth() + 1).padStart(2, '0');
  $('f-poldate').value = dd + '.' + mm + '.' + today.getFullYear();

  ['f-limit','f-retention','f-premium','f-fx-rate','f-sl-ext','f-sl-osp','f-sl-fines','f-sl-tel','f-sl-cj',
   'f-sl-se','f-sl-legal','f-sl-inv','f-sl-data','f-sl-fire'].forEach(id => bindThousands($(id)));
  if (window.MIG_INN) MIG_INN.attachHint($('f-inn'));

  // live preview on any change
  document.querySelectorAll('#app input, #app select, #app textarea').forEach(el => {
    el.addEventListener('input', () => { markDraft(); renderPreview(); });
    el.addEventListener('change', () => { markDraft(); renderPreview(); });
  });

  $('policy-type').onchange = () => selectType($('policy-type').value);
  // Choosing a submission and/or a saved quote auto-fills the policy (no Load button).
  const onPick = () => { if ($('sub-select').value || $('quote-select').value) loadAndFill(); };
  $('sub-select').addEventListener('change', onPick);
  $('quote-select').addEventListener('change', onPick);
  // No button: whenever the limit is set or changed, empty sub-limits are
  // suggested automatically (standard % of limit) and shown amber until edited.
  $('f-limit').addEventListener('input', aiFillSublimits);
  // Currency conversion: re-derive the loaded sums whenever the rate or the
  // policy currency changes (see applyFx).
  $('f-fx-rate').addEventListener('input', applyFx);
  $('f-currency').addEventListener('change', applyFx);
  // Currency code shown in front of every sum (display only — the user types
  // just the number; the code follows the policy-currency selector).
  if (window.MIG_MONEY) {
    const policyCur = () => $('f-currency').value;
    ['f-limit', 'f-retention', 'f-premium',
     'f-sl-ext', 'f-sl-osp', 'f-sl-fines', 'f-sl-tel', 'f-sl-cj',
     'f-sl-se', 'f-sl-legal', 'f-sl-inv', 'f-sl-data', 'f-sl-fire'].forEach(id => MIG_MONEY.decorate($(id), policyCur));
  }
  applyFx();   // initialise the FX label for the default currency
  $('btn-docx').onclick = async () => {
    const fxMsg = fxBlocked();
    if (fxMsg) { alert(fxMsg); $('fx-warn').style.display = 'block'; return; }
    $('btn-docx').disabled = true; $('gen-note').textContent = 'Generating Word document…';
    try {
      const blob = await generateDocx();
      download(blob, policyFileBase() + '.docx');
      $('gen-note').textContent = 'Word document downloaded — review it, then confirm to issue.';
    } catch (e) { $('gen-note').textContent = 'DOCX error: ' + e.message; }
    $('btn-docx').disabled = false;
  };
  $('btn-confirm').onclick = confirmIssue;
  $('btn-final').onclick = async () => {
    $('btn-final').disabled = true; $('gen-note').textContent = 'Generating issued Word document…';
    try {
      const blob = await generateDocx();
      download(blob, policyFileBase() + '.docx');
      $('gen-note').textContent = 'Issued Word document downloaded.';
    } catch (e) { $('gen-note').textContent = 'DOCX error: ' + e.message; }
    $('btn-final').disabled = false;
  };

  // honour ?type=… deep links (the old per-type pages redirect with ?type=cyber|crime)
  const qsType = new URLSearchParams(location.search).get('type');
  selectType((qsType && POLICY_LABELS[qsType]) ? qsType : '');
})();
