/**
 * A minimal, correct RFC-4180 CSV reader.
 *
 * The reference CSVs contain quoted fields with embedded commas ("Route 5, Route 6 — grass"),
 * so a naive split(',') silently mis-columns four species rows. This handles quotes, escaped
 * quotes and CRLF, and nothing else — that is all the inputs need.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (i < src.length) {
    const ch = src[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '');
}

/** Parses a CSV into records keyed by the header row. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return [];
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => {
      rec[h.trim()] = (r[idx] ?? '').trim();
    });
    return rec;
  });
}

/** The reference data writes "missing" as an em dash. */
export function isBlank(v: string | undefined): boolean {
  const s = (v ?? '').trim();
  return s === '' || s === '—' || s === '-' || s === 'N/A';
}

export function num(v: string | undefined, field: string): number {
  const s = (v ?? '').trim().replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Expected a number for "${field}", got ${JSON.stringify(v)}`);
  return n;
}

export function numOrNull(v: string | undefined): number | null {
  if (isBlank(v)) return null;
  const n = Number((v ?? '').trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
