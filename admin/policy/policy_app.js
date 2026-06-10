// MIG Policy Issuance — unified Cyber/Crime app logic. Deployed as admin/policy/policy_app.js
// The insurance type is chosen in the form; the matching schedule, sublimits,
// bilingual wording, target table and .docx are selected by type.
/* global supabase, docx, CYBER_WORDING, CRIME_WORDING, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY */

let sb = null, session = null, loadedSubmissionId = null, loadedQuoteId = null;
let issued = false, policyRecordId = null;
let TYPE = 'cyber';

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
    polnum: txt('f-polnum'), poldate: txt('f-poldate'), broker: $('f-broker').value.trim() || 'N/A',
    insured: txt('f-insured'), inn: txt('f-inn'), address: txt('f-address'),
    beneficiary: txt('f-beneficiary'), business: txt('f-business'),
    limit: money('f-limit'), retention: money('f-retention'), premium: money('f-premium'),
    premdue: txt('f-premdue'), from: txt('f-from'), to: txt('f-to'),
    retro: txt('f-retro'), territory: txt('f-territory'),
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
  return TYPE === 'cyber' ? scheduleRowsCyber(d) : scheduleRowsCrime(d);
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
  h += '<table class="sig"><tr><td><b>Company / Компания:</b> “MOSAIC INSURANCE GROUP” JSC / АО СО «MOSAIC INSURANCE GROUP»<br/><span style="font-size:10px">Acc: 2021 4000 1053 3830 3001 (UZS), 2021 4840 3053 3830 3001 (USD), 2021 4978 9053 3830 3001 (EUR). JSC “KDB Bank Uzbekistan”, Bank Code 00842, SWIFT KODBUZ22, TIN/ИНН 308143734</span><br/><br/><br/>_________________________ For the Company / За Компанию</td>' +
       '<td><b>Insured / Страхователь:</b> ' + ph + '<br/><span style="font-size:10px">ИНН / INN: ' + esc(F().d.inn) + '</span><br/><span style="font-size:10px">Адрес / Address: ' + esc(F().d.address) + '</span><br/><br/><br/>_________________________ For the Insured / За Страхователя</td></tr></table>';
  // Wording
  h += '<h2 class="s" style="margin-top:26px">' + esc(c.wordingRu) + '<br/>' + esc(c.wordingEn) + '</h2>';
  h += '<table class="wrd">';
  for (const item of W.wording) {
    const cls = item.t === 'h1' ? 'h1c' : item.t === 'h2' ? 'h2c' : '';
    h += '<tr><td class="' + cls + '">' + esc(item.en) + '</td><td class="' + cls + '">' + esc(item.ru) + '</td></tr>';
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
    return new TableRow({ children: [mk(item.en), mk(item.ru)] });
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
        para("Company / Компания: “MOSAIC INSURANCE GROUP” JSC / АО СО «MOSAIC INSURANCE GROUP»", { bold: true, size: 18 }),
        para("Banking details / Банковские реквизиты: Acc: 2021 4000 1053 3830 3001 (UZS), 2021 4840 3053 3830 3001 (USD), 2021 4978 9053 3830 3001 (EUR). JSC “KDB Bank Uzbekistan”, Bank Code 00842, SWIFT KODBUZ22, TIN/ИНН 308143734", { size: 17 }),
        para("", { after: 200 }),
        para("_________________________  For the Company / За Компанию", { size: 18 }),
      ]}),
      new TableCell({ borders, width: { size: HALF, type: WidthType.DXA }, margins, children: [
        para("Insured / Страхователь: " + ph, { bold: true, size: 18 }),
        para("ИНН / INN: " + F().d.inn, { size: 17 }),
        para("Адрес / Address: " + F().d.address, { size: 17 }),
        para("", { after: 200 }),
        para("_________________________  For the Insured / За Страхователя", { size: 18 }),
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

// ---------------- prefill ----------------
async function loadSources() {
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
    const { data, error } = await sb.from('submissions').select('id, proposer_name, proposer_inn, payload').eq('id', loadedSubmissionId).single();
    if (!error && data) {
      const f = (data.payload && data.payload.fields) || {};
      setVal('f-insured', data.proposer_name || f.proposer_name, 'pf-name');
      setVal('f-inn', data.proposer_inn || f.proposer_inn, 'pf-inn');
      setVal('f-address', f.address, 'pf-addr');
      setVal('f-business', f.nature_of_business, 'pf-biz');
      if (TYPE === 'cyber') {
        setVal('f-from', f.cyber_period_from || f.cy_period_from, 'pf-from');
        setVal('f-to', f.cyber_period_to || f.cy_period_to, 'pf-to');
        const benName = f.cyber_ben_name || f.cy_ben_name, benAddr = f.cyber_ben_address || f.cy_ben_address;
        if (benName) setVal('f-beneficiary', [benName, benAddr].filter(Boolean).join(', '), 'pf-ben');
        const g = k => f['cyber_geo_' + k] === true || f['cyber_geo_' + k] === 'true' || f['cy_geo_' + k] === true || f['cy_geo_' + k] === 'true';
        applyTerritory([g('uz') && 'UZ', g('cis') && 'CIS', g('eu') && 'EU', g('us') && 'US', g('worldwide') && 'WW'].filter(Boolean));
      } else {
        setVal('f-from', f.crime_period_from, 'pf-from');
        setVal('f-to', f.crime_period_to, 'pf-to');
        if (f.crime_ben_name) setVal('f-beneficiary', [f.crime_ben_name, f.crime_ben_address].filter(Boolean).join(', '), 'pf-ben');
        const t = k => f['crime_geo_' + k] === true || f['crime_geo_' + k] === 'true';
        applyTerritory([t('uz') && 'UZ', t('cis') && 'CIS', t('eu') && 'EU', t('us') && 'US', t('worldwide') && 'WW'].filter(Boolean));
      }
    }
  }
  if (loadedQuoteId) {
    const { data, error } = await sb.from(cfg().quotes).select('id, insured_name, final_premium, inputs').eq('id', loadedQuoteId).single();
    if (!error && data) {
      if (!$('f-insured').value) setVal('f-insured', data.insured_name, 'pf-name');
      setVal('f-limit', data.inputs.limit, 'pf-limit');
      setVal('f-retention', TYPE === 'cyber' ? data.inputs.retention : data.inputs.deductible, 'pf-ret');
      setVal('f-premium', Math.round(data.final_premium), 'pf-prem');
      $('f-currency').value = 'USD'; // rater is USD-based
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

function suggestSublimits() {
  const limit = Number(stripC($('f-limit').value)) || 0;
  if (!limit) { $('gen-note').textContent = 'Enter the limit of liability first.'; return; }
  if (TYPE === 'cyber') {
    setVal('f-sl-ext', Math.round(limit * 0.50));
    setVal('f-sl-osp', Math.round(limit * 0.25));
    setVal('f-sl-fines', Math.round(limit * 0.50));
    setVal('f-sl-tel', Math.round(limit * 0.05));
    setVal('f-sl-cj', Math.round(limit * 0.05));
  } else {
    setVal('f-sl-se', Math.round(limit * 0.10));
    setVal('f-sl-legal', Math.round(limit * 0.05));
    setVal('f-sl-inv', Math.round(limit * 0.05));
    setVal('f-sl-data', Math.round(limit * 0.05));
    setVal('f-sl-fire', Math.round(limit * 0.05));
  }
  markDraft(); renderPreview();
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
  let _docB64 = null, _docFn = null;
  try {
    const _blob = await generateDocx();
    _docB64 = await blobToBase64(_blob);
    _docFn = policyFileBase() + '.docx';
  } catch (e) { console.error('Policy document generation failed:', e); }
  const payload = {
    created_by: session.user.id,
    submission_id: loadedSubmissionId,
    quote_id: loadedQuoteId,
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
  $('btn-confirm').disabled = false;
  if (resp.error) { $('gen-note').textContent = 'Error: ' + resp.error.message; return; }
  policyRecordId = resp.data ? resp.data.id : policyRecordId;
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
  loadedSubmissionId = null; loadedQuoteId = null;
  issued = false; policyRecordId = null;
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
  if (!session) return;
  // A session alone is not enough — require MIG staff membership.
  const { data: isStaff, error: staffErr } = await sb.rpc('is_mig_staff');
  if (staffErr || !isStaff) {
    const email = (session.user.email || 'This account').replace(/[<>&]/g, '');
    await sb.auth.signOut();
    $('auth-gate').innerHTML = '<div class="card"><h2>Account not authorized</h2>' +
      '<p class="note" style="margin:10px 0 16px">' + email + ' is signed in but is not on the MIG staff list, so it cannot access admin tools. Contact an administrator to be added, or sign in with an authorized account.</p>' +
      '<a class="btn primary" href="/admin/" style="text-decoration:none">Back to login</a></div>';
    return;
  }
  $('auth-gate').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('btn-signout').classList.remove('hidden');
  $('btn-signout').onclick = async () => { await sb.auth.signOut(); location.reload(); };

  // defaults
  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0'), mm = String(today.getMonth() + 1).padStart(2, '0');
  $('f-poldate').value = dd + '.' + mm + '.' + today.getFullYear();

  ['f-limit','f-retention','f-premium','f-sl-ext','f-sl-osp','f-sl-fines','f-sl-tel','f-sl-cj',
   'f-sl-se','f-sl-legal','f-sl-inv','f-sl-data','f-sl-fire'].forEach(id => bindThousands($(id)));

  // live preview on any change
  document.querySelectorAll('#app input, #app select, #app textarea').forEach(el => {
    el.addEventListener('input', () => { markDraft(); renderPreview(); });
    el.addEventListener('change', () => { markDraft(); renderPreview(); });
  });

  $('policy-type').onchange = () => selectType($('policy-type').value);
  $('btn-load').onclick = loadAndFill;
  $('btn-suggest-sl').onclick = suggestSublimits;
  $('btn-docx').onclick = async () => {
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
