-- ============================================================
-- Financial-statements bucket: accept every Excel flavour + CSV
-- (xls / xlsx / xlsm / xlsb and the xlt / xltx / xltm templates).
-- The proposal form's FS upload offers these extensions; the bucket's
-- allow-list must match or the upload is rejected server-side.
-- ============================================================
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  -- Excel family
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',     -- .xlsx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',  -- .xltx
  'application/vnd.ms-excel',                                              -- .xls / .xlt
  'application/vnd.ms-excel.sheet.macroEnabled.12',                        -- .xlsm
  'application/vnd.ms-excel.sheet.binary.macroEnabled.12',                 -- .xlsb
  'application/vnd.ms-excel.template.macroEnabled.12',                     -- .xltm
  'text/csv',
  -- Word + images (unchanged)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png', 'image/jpeg'
]
where id = 'financial-statements';
