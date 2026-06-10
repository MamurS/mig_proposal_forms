// ============================================================
// Shared Supabase Storage helpers for the private 'documents' bucket.
// New policy/quotation .docx files live here (referenced by doc_path) instead
// of as base64 in the DB row. Loaded via <script src="/shared/storage.js">.
// ============================================================
window.MIG_DOC = {
  bucket: 'documents',
  DOCX_MIME: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Upload a Blob; returns the stored path, or null on failure.
  async upload(sb, path, blob, contentType) {
    try {
      const { error } = await sb.storage.from('documents').upload(path, blob, {
        contentType: contentType || this.DOCX_MIME, upsert: true,
      });
      return error ? null : path;
    } catch (_) { return null; }
  },
  // Download a stored document as a Blob (RLS-checked); returns null on failure.
  async download(sb, path) {
    try {
      const { data, error } = await sb.storage.from('documents').download(path);
      return error ? null : data;
    } catch (_) { return null; }
  },
  // Trigger a browser download for a Blob.
  saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'document';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  },
};
