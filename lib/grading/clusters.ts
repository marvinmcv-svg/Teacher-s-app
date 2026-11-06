/**
 * Answer clustering (§3.4 "grade the group once"). Pure so the page and the
 * server action group answers identically.
 *
 * Normalisation only removes differences of *writing*, never of *value*:
 * "3/4", "\frac{3}{4}" and " 3 / 4 ." are one group, but "0.75" stays its own
 * group ("14 wrote 3/4", "6 wrote 0.75") so the teacher decides whether the
 * form matters. Spanish decimal commas are read as decimal points.
 */
export const CLUSTERABLE_TYPES = ["numeric", "short_answer", "multiple_choice"] as const;
export const EMPTY_KEY = "∅";

export function normaliseAnswer(text: string | null | undefined, type: string): string {
  let s = (text ?? "").trim();
  if (!s || /^\[?illegible\]?$/i.test(s)) return EMPTY_KEY;
  s = s
    .replace(/\$+/g, "")
    .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\(left|right)\s*/g, "")
    .replace(/\\(cdot|times)/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\%/g, "%")
    .replace(/\\,|\;|\\!|\\ /g, " ")
    .replace(/[{}]/g, "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .replace(/\s*([=+\-*/^()<>%])\s*/g, "$1")
    .replace(/[.;,:!?]+$/g, "")
    .trim();
  if (type === "multiple_choice") {
    const m = /^\(?([a-h])\)?(?:[.)]|\s|$)/.exec(s);
    if (m) return m[1];
  }
  if (type === "numeric" || type === "short_answer") {
    // "x=7" and "7" are not merged (that's a value judgement), but a leading "r:" / "resp:" label is noise.
    s = s.replace(/^(r|resp|respuesta|answer|ans)\s*[:=]\s*/, "");
  }
  return s || EMPTY_KEY;
}

export type ClusterInput = {
  answerId: string;
  submissionId: string;
  text: string | null;
  status: string;
};

export type Cluster<T extends ClusterInput = ClusterInput> = {
  key: string;
  /** The most common original spelling, shown to the teacher. */
  display: string;
  members: T[];
};

export function buildClusters<T extends ClusterInput>(answers: T[], type: string): Cluster<T>[] {
  const groups = new Map<string, T[]>();
  for (const a of answers) {
    const key = a.status === "no_answer" ? EMPTY_KEY : normaliseAnswer(a.text, type);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return [...groups.entries()]
    .map(([key, members]) => {
      const spellings = new Map<string, number>();
      for (const m of members) {
        const t = (m.text ?? "").trim();
        if (t) spellings.set(t, (spellings.get(t) ?? 0) + 1);
      }
      const display = [...spellings.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return { key, display, members };
    })
    .sort(
      (a, b) =>
        Number(a.key === EMPTY_KEY) - Number(b.key === EMPTY_KEY) || // blanks last
        b.members.length - a.members.length ||
        a.key.localeCompare(b.key),
    );
}
