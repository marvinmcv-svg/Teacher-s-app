/** RFC 4180 CSV with a BOM so Excel (incl. Spanish locales) opens UTF-8 correctly. */
export function toCsv(rows: (string | number | null | undefined)[][], delimiter = ","): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    // neutralise spreadsheet formula injection from student/teacher text
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(delimiter)).join("\r\n") + "\r\n";
}
