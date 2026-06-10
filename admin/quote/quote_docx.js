/* global docx, JSZip */
// ============================================================
// MIG quotation .docx generator — reproduces MIG_Quotation_OFFBOX.docx
// Builds entirely in-browser via the docx UMD library (same approach as the
// policy-issuance modules). Reads the underwriter terms from collectLines().
// ============================================================
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function generateQuotation() {
  const btn = document.getElementById('btn-generate');
  const note = document.getElementById('gen-note');
  const lines = collectLines();
  if (!lines.length) { note.textContent = 'Select at least one line to include.'; return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating…'; note.textContent = '';

  try {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, BorderStyle, WidthType, ShadingType, Footer, PageNumber, ImageRun,
    } = docx;

    const CONTENT = 9638, HALF = CONTENT / 2, NAVY = '1F3864', TINT = 'EAF0F8';
    const border = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const noB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: noB, bottom: noB, left: noB, right: noB };
    const margins = { top: 60, bottom: 60, left: 110, right: 110 };
    const FONT = 'Times New Roman';

    const para = (text, o = {}) => new Paragraph({
      alignment: o.align || AlignmentType.JUSTIFIED, spacing: { after: o.after ?? 100, before: o.before ?? 0 },
      children: [new TextRun({ text, bold: !!o.bold, italics: !!o.italics, size: o.size || 20, font: FONT, color: o.color })],
    });
    const heading = (text, o = {}) => new Paragraph({
      alignment: o.align || AlignmentType.LEFT, spacing: { before: o.before ?? 200, after: o.after ?? 90 },
      children: [new TextRun({ text, bold: true, size: o.size || 24, font: FONT, color: o.color || NAVY })],
    });
    // two-column label / value table (meta + per-line terms)
    const kvTable = (rowsArr) => new Table({
      width: { size: CONTENT, type: WidthType.DXA }, columnWidths: [Math.round(CONTENT * 0.42), Math.round(CONTENT * 0.58)],
      rows: rowsArr.filter(Boolean).map(([k, v]) => new TableRow({ children: [
        new TableCell({ borders, width: { size: Math.round(CONTENT * 0.42), type: WidthType.DXA }, margins, shading: { fill: TINT, type: ShadingType.CLEAR },
          children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, size: 19, font: FONT, color: NAVY })] })] }),
        new TableCell({ borders, width: { size: Math.round(CONTENT * 0.58), type: WidthType.DXA }, margins,
          children: [new Paragraph({ children: [new TextRun({ text: v, size: 19, font: FONT })] })] }),
      ] })),
    });

    const ch = [];

    // ---- Letterhead: logo (if available) + navy band ----
    if (window.MIG_LOGO_B64) {
      try {
        const bytes = Uint8Array.from(atob(window.MIG_LOGO_B64), c => c.charCodeAt(0));
        ch.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 60 },
          children: [new ImageRun({ data: bytes, transformation: { width: 150, height: 59 }, type: 'png' })] }));
      } catch (e) { /* logo optional */ }
    }
    ch.push(new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: [CONTENT], rows: [
      new TableRow({ children: [new TableCell({
        borders: noBorders, width: { size: CONTENT, type: WidthType.DXA }, margins: { top: 120, bottom: 120, left: 160, right: 160 },
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        children: [
          new Paragraph({ children: [new TextRun({ text: 'MOSAIC INSURANCE GROUP JSC', bold: true, size: 26, font: FONT, color: 'FFFFFF' })] }),
          new Paragraph({ spacing: { before: 20 }, children: [new TextRun({ text: 'Financial Risks — Commercial Insurance', size: 18, font: FONT, color: 'CDD9EE' })] }),
        ],
      })] }),
    ] }));

    // ---- Title + subtitle ----
    const subtitle = lines.map(l => l.code === 'cyber'
      ? 'Cyber (first-' + (l.thirdParty ? ' & third-party liability' : ' party') + ')'
      : l.title).join(' & ');
    ch.push(heading('INSURANCE QUOTATION', { align: AlignmentType.CENTER, size: 34, before: 220, after: 40 }));
    ch.push(para(subtitle, { align: AlignmentType.CENTER, size: 20, italics: true, after: 200 }));

    // ---- Meta table ----
    const g = id => (document.getElementById(id).value || '').trim();
    ch.push(kvTable([
      ['Quotation reference', g('q-ref')],
      ['Date of issue', g('q-date')],
      ['Validity of quotation', g('q-validity')],
      ['Proposed insured', g('q-insured')],
      g('q-inn') ? ['Insured INN', g('q-inn')] : null,
      ['Period of insurance', g('q-period')],
      ['Coverage territory', g('q-territory')],
      ['Currency', g('q-currency')],
    ]));

    // ---- Addressed to ----
    const f = fields;
    ch.push(heading('Addressed to', { before: 240 }));
    ch.push(para(g('q-insured'), { bold: true, after: 40 }));
    if (g('q-inn')) ch.push(para('INN: ' + g('q-inn'), { after: 40 }));
    const attn = [f.contact_person, f.contact_title].filter(Boolean).join(', ');
    if (attn) ch.push(para('Attn: ' + attn, { after: 40 }));
    if (f.address) ch.push(para(String(f.address)));

    // ---- The proposed insured ----
    ch.push(heading('The proposed insured', { before: 200 }));
    const yrs = f.years_operating ? (String(f.years_operating) + (f.reg_date ? ' (registered ' + f.reg_date + ')' : '')) : (f.reg_date || '');
    ch.push(kvTable([
      f.nature_of_business ? ['Business activity', String(f.nature_of_business)] : null,
      yrs ? ['Years in operation', yrs] : null,
      f.annual_turnover ? ['Annual turnover', fmtMoney(f.annual_turnover, 'USD')] : null,
      f.total_employees ? ['Total employees', String(f.total_employees)] : null,
    ]));

    // ---- Scope ----
    ch.push(heading('Scope of this quotation', { before: 200 }));
    ch.push(para('This quotation comprises the following cover' + (lines.length > 1 ? 's' : '') + ': ' +
      lines.map(l => l.title).join('; ') + '. Cover not quoted below is excluded and, where required, must be placed separately. ' +
      'These terms are offered on Mosaic Insurance Group’s standard policy wordings.'));

    // ---- Per-line sections ----
    lines.forEach((l, i) => {
      ch.push(heading('Section ' + (i + 1) + ' — ' + l.title, { before: 220 }));
      ch.push(para('Insuring scope. ' + l.scope));
      if (l.code === 'cyber') {
        if (l.thirdParty) {
          ch.push(para('Third-party liability: the insured’s legal liability to third parties for failure to protect data and confidential information, unauthorized access or use, transmission of malicious code, and denial-of-service arising from a failure of network security (“privacy & network-security liability”), together with related defence costs.'));
        }
        ch.push(para('Key exclusion. Technology / professional-services errors & omissions (liability arising from the rendering of, or failure to render, IT services to third parties) is excluded from this section and must be arranged under a separate Technology E&O / Professional Indemnity policy.', { italics: true }));
      }
      ch.push(kvTable([
        ['Limit of indemnity', fmtMoney(l.limit, l.currency) || (l.limit || '—')],
        l.aggregate ? ['Annual aggregate', fmtMoney(l.aggregate, l.currency) || l.aggregate] : null,
        ['Deductible', fmtMoney(l.deductible, l.currency) || (l.deductible || '—')],
        l.sublimits ? ['Sublimits', l.sublimits] : null,
        (l.code === 'cyber') ? ['Privacy & network-security liability (third party)', l.thirdParty ? 'Included — full limit' : 'Excluded'] : null,
        ['Coverage territory', l.territory || '—'],
        l.period ? ['Period of insurance', l.period] : null,
        ['Annual premium', fmtMoney(l.premium, l.currency) || (l.premium || '— (to be confirmed)')],
      ]));
    });

    // ---- Premium summary ----
    ch.push(heading('Premium summary', { before: 240 }));
    const headCell = t => new TableCell({ borders, margins, shading: { fill: NAVY, type: ShadingType.CLEAR },
      children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 19, font: FONT, color: 'FFFFFF' })] })] });
    const cell = (t, o = {}) => new TableCell({ borders, margins,
      children: [new Paragraph({ alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: t, bold: !!o.bold, size: 19, font: FONT })] })] });
    const cw = [Math.round(CONTENT * 0.5), Math.round(CONTENT * 0.25), Math.round(CONTENT * 0.25)];
    let total = 0; const curCode = (g('q-currency').match(/[A-Z]{3}/) || ['USD'])[0];
    const sumRows = [new TableRow({ children: [headCell('Cover'), headCell('Limit'), headCell('Annual premium')] })];
    lines.forEach(l => {
      total += num(l.premium);
      sumRows.push(new TableRow({ children: [
        cell(l.title), cell(fmtMoney(l.limit, l.currency) || '—', { right: true }), cell(fmtMoney(l.premium, l.currency) || '—', { right: true }),
      ] }));
    });
    sumRows.push(new TableRow({ children: [
      cell('Total — combined annual premium', { bold: true }), cell('', { right: true }),
      cell(total ? (curCode + ' ' + total.toLocaleString('en-US')) : '—', { bold: true, right: true }),
    ] }));
    ch.push(new Table({ width: { size: CONTENT, type: WidthType.DXA }, columnWidths: cw, rows: sumRows }));
    ch.push(para('Premiums are exclusive of any insurance-premium tax or statutory charges where applicable. Minimum and deposit premiums are fully earned at inception.', { before: 100, size: 18, italics: true }));

    // ---- Conditions & subjectivities ----
    ch.push(heading('Conditions and subjectivities', { before: 220 }));
    [
      'This quotation is based on the signed proposal form and the information supplied therein. Cover is offered on the basis that all such information is true, complete and not misleading.',
      'Cover is subject to no material change in the risk between the date of this quotation and inception, and to the insured notifying the insurer of any such change.',
      'Where any limit exceeds the insurer’s net retention, terms are subject to confirmation of facultative reinsurance.',
      'This quotation, and any cover bound under it, is governed by and subject to the full terms, conditions, definitions and exclusions of the applicable Mosaic Insurance Group policy wording, which prevails over this summary.',
    ].forEach((t, i) => ch.push(para((i + 1) + '. ' + t, { after: 60 })));

    // ---- Important notice ----
    ch.push(heading('Important notice', { before: 200 }));
    ch.push(para('This document is a quotation only and does not constitute a contract of insurance, a cover note, or confirmation that cover is in force. No cover is provided until a policy is issued by Mosaic Insurance Group and the insured has confirmed acceptance of the terms set out above. The insurer reserves the right to amend or withdraw this quotation prior to inception. Mosaic Insurance Group is not acting as the insured’s adviser; the insured should satisfy itself that the scope and limits meet its own and any third-party requirements.'));

    // ---- Signature ----
    ch.push(para('For and on behalf of Mosaic Insurance Group JSC', { before: 220, after: 200, bold: true }));
    ch.push(para('Mamur Sadikov', { after: 20, bold: true }));
    ch.push(para('Director, Financial Risks', { after: 20 }));
    ch.push(para('Date: ' + g('q-date')));

    const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: g('q-ref') + '   ·   Page ', size: 15, font: FONT, color: '999999' }),
                 new TextRun({ children: [PageNumber.CURRENT], size: 15, font: FONT, color: '999999' }),
                 new TextRun({ text: ' of ', size: 15, font: FONT, color: '999999' }),
                 new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 15, font: FONT, color: '999999' })] })] });

    const doc = new Document({
      styles: { default: { document: { run: { font: FONT, size: 20 } } } },
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        footers: { default: footer },
        children: ch,
      }],
    });

    let blob = await Packer.toBlob(doc);
    // Patch the fontTable relationship the UMD build omits (same fix as policy modules).
    try {
      const zip = await JSZip.loadAsync(blob);
      const relsPath = 'word/_rels/document.xml.rels';
      let rels = await zip.file(relsPath).async('string');
      if (zip.file('word/fontTable.xml') && !rels.includes('Target="fontTable.xml"')) {
        rels = rels.replace('</Relationships>', '<Relationship Id="rIdFontTablePatch" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>');
        zip.file(relsPath, rels);
        blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      }
    } catch (e) { /* non-fatal */ }

    const fname = (g('q-ref') || 'MIG_Quotation').replace(/[^\w\-]+/g, '_') + '.docx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);

    // Persist the quotation so it appears in the customer's portal and the
    // admin customer record (the .docx is stored base64 in the row).
    let saved = false;
    try {
      const b64 = await blobToBase64(blob);
      const me = (await sb.auth.getUser()).data.user;
      // Link to the customer: the submission's customer, else resolve by INN.
      let custId = (submission && submission.customer_id) || null;
      if (!custId && g('q-inn')) {
        try { const { data: cm } = await sb.from('customers').select('user_id').eq('inn', g('q-inn')).limit(1); if (cm && cm[0]) custId = cm[0].user_id; } catch (_) {}
      }
      const { error: insErr } = await sb.from('quotations').insert({
        created_by: me ? me.id : null,
        submission_id: (submission && submission.id) || null,
        customer_id: custId,
        reference: g('q-ref'), currency: curCode, total_premium: total,
        inn: g('q-inn') || null,
        lines: lines, doc_base64: b64, doc_filename: fname, status: 'sent',
      });
      saved = !insErr;
      if (insErr) console.error('Quotation save error:', insErr);
    } catch (e) { console.error('Quotation save exception:', e); }
    note.textContent = 'Generated ' + fname + (saved ? ' — saved to the customer record.' : ' (downloaded; not saved to DB).');
  } catch (e) {
    note.textContent = 'Error: ' + (e && e.message || e);
    console.error(e);
  } finally {
    btn.disabled = false; btn.textContent = 'Generate quotation (.docx)';
  }
}
