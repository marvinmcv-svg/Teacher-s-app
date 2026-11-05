/**
 * Roster import: turns a pasted list or a CSV export into student rows.
 * Pure and dependency-free so it can run on the server action and be unit-tested.
 */
export type ParsedStudent = { displayName: string; externalId: string | null };
export type SkippedLine = { line: number; text: string; reason: "empty_name" | "duplicate" | "too_long" };
export type RosterParseResult = { students: ParsedStudent[]; skipped: SkippedLine[] };

export const MAX_NAME_LENGTH = 120;
export const MAX_ROSTER_SIZE = 200;

const NAME_HEADERS = [
  "name",
  "nombre",
  "nombres",
  "display_name",
  "student",
  "estudiante",
  "alumno",
  "alumna",
  "nombre completo",
  "full name",
];
const ID_HEADERS = [
  "id",
  "external_id",
  "codigo",
  "código",
  "code",
  "student id",
  "rude",
  "ci",
  "matricula",
  "matrícula",
];
const FIRST_HEADERS = ["first name", "first", "nombre de pila", "nombres"];
const LAST_HEADERS = ["last name", "last", "surname", "apellido", "apellidos"];

/** Accent-, case- and whitespace-insensitive key for duplicate detection and fuzzy matching. */
export function normaliseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function cleanName(raw: string): string {
  return raw
    .replace(/^\s*(?:[-*•·]|\d{1,3}[.)\-:]|\(\d{1,3}\))\s*/u, "") // "1. ", "2) ", "- ", "• "
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimal RFC-4180 line splitter supporting quotes and `,` / `;` / tab delimiters. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(lines: string[]): string | null {
  const sample = lines.slice(0, 5);
  for (const d of ["\t", ";", ","]) {
    if (sample.length > 0 && sample.every((l) => l.includes(d))) return d;
  }
  return null;
}

function findColumn(header: string[], candidates: string[]): number {
  const norm = header.map((h) => normaliseName(h));
  for (const c of candidates) {
    const idx = norm.indexOf(normaliseName(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function parseRoster(input: string, existingNames: string[] = []): RosterParseResult {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const delimiter = detectDelimiter(nonEmpty);

  const seen = new Set(existingNames.map(normaliseName));
  const students: ParsedStudent[] = [];
  const skipped: SkippedLine[] = [];

  let nameCol = 0;
  let idCol = -1;
  let firstCol = -1;
  let lastCol = -1;
  let startLine = 0;

  if (delimiter) {
    const firstIdx = lines.findIndex((l) => l.trim().length > 0);
    const header = splitCsvLine(lines[firstIdx], delimiter);
    const n = findColumn(header, NAME_HEADERS);
    const id = findColumn(header, ID_HEADERS);
    const f = findColumn(header, FIRST_HEADERS);
    const l = findColumn(header, LAST_HEADERS);
    if (n >= 0 || (f >= 0 && l >= 0) || id >= 0) {
      startLine = firstIdx + 1;
      nameCol = n;
      idCol = id;
      if (n < 0 || (f >= 0 && l >= 0 && n === f)) {
        firstCol = f;
        lastCol = l;
      }
      if (nameCol < 0 && firstCol < 0) nameCol = header.findIndex((_, i) => i !== idCol);
    }
  }

  for (let i = startLine; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;
    let name: string;
    let externalId: string | null = null;
    if (delimiter) {
      const cells = splitCsvLine(rawLine, delimiter);
      name =
        firstCol >= 0 && lastCol >= 0 ? `${cells[firstCol] ?? ""} ${cells[lastCol] ?? ""}` : (cells[nameCol] ?? "");
      externalId = idCol >= 0 ? cells[idCol] || null : null;
    } else {
      name = rawLine;
    }
    name = cleanName(name);
    if (!name) {
      skipped.push({ line: i + 1, text: rawLine, reason: "empty_name" });
      continue;
    }
    if (name.length > MAX_NAME_LENGTH) {
      skipped.push({ line: i + 1, text: rawLine, reason: "too_long" });
      continue;
    }
    const key = normaliseName(name);
    if (seen.has(key)) {
      skipped.push({ line: i + 1, text: rawLine, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    students.push({ displayName: name, externalId: externalId?.slice(0, 64) ?? null });
  }
  return { students, skipped };
}
