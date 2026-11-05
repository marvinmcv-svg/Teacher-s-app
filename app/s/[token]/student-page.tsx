"use client";
import { useState } from "react";
import { PIN_STYLE, pinAnchor, type PinKind } from "@/components/pin-style";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type BBox = { x: number; y: number; w: number; h: number };
type Work = {
  assignment: { title: string; subject: string | null };
  studentName: string | null;
  showScore: boolean;
  grade: { display: string; passing: boolean } | null;
  pages: { id: string; position: number; url: string | null; width: number; height: number }[];
  pins: {
    id: string;
    page_id: string;
    kind: string;
    region: BBox | null;
    approximate: boolean;
    text: string;
    number: number;
  }[];
  feedback: { glows: string[]; grows: { point: string; how: string }[]; nextStep: string; practiceItem: string | null };
};
type Labels = {
  title: string;
  grade: string;
  glows: string;
  grows: string;
  how: string;
  nextStep: string;
  practice: string;
  comments: string;
  disclosure: string;
  page: string[];
  kinds: Record<PinKind, string>;
};
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

/** Mobile-first, printable student view: the page is the hero, comments live on it (§4). */
export function StudentPage({ work, labels }: { work: Work; labels: Labels }) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <header className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted">{work.studentName ?? labels.title}</p>
        <h1 className="font-serif text-4xl">{work.assignment.title}</h1>
        {work.showScore && work.grade && (
          <p className="text-lg" data-testid="student-grade">
            {labels.grade}: <strong className="tabular font-serif text-3xl">{work.grade.display}</strong>
          </p>
        )}
      </header>

      {work.pages.map((p, i) => (
        <figure key={p.id} className="flex flex-col gap-2 break-inside-avoid">
          <figcaption className="text-sm text-ink-muted">{labels.page[i]}</figcaption>
          <div
            className="relative w-full overflow-hidden rounded-[var(--radius-card)] border border-rule bg-card"
            style={{ aspectRatio: `${p.width} / ${p.height}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
            {p.url && <img src={p.url} alt={labels.page[i]} className="absolute inset-0 size-full" />}
            {work.pins
              .filter((x) => x.page_id === p.id && x.region)
              .map((x) => {
                const s = PIN_STYLE[x.kind as PinKind];
                const r = x.region!;
                const { x: pinX } = pinAnchor(r);
                return (
                  <div key={x.id}>
                    <div
                      aria-hidden
                      className={cn("absolute rounded-md border", s.tint, x.approximate && "border-dashed")}
                      style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
                    />
                    <button
                      type="button"
                      onClick={() => setSelected(selected === x.id ? null : x.id)}
                      aria-label={`${x.number}. ${labels.kinds[x.kind as PinKind]}: ${x.text}`}
                      aria-pressed={selected === x.id}
                      className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                      style={{ left: pct(pinX), top: pct(r.y + r.h / 2) }}
                    >
                      <span
                        className={cn(
                          "flex size-7 items-center justify-center rounded-full text-white ring-2 ring-[var(--pin-outline)]",
                          s.fill,
                        )}
                      >
                        <s.Icon aria-hidden className="size-4" strokeWidth={3} />
                      </span>
                    </button>
                    {selected === x.id && (
                      <div
                        role="tooltip"
                        className="absolute z-10 max-w-64 rounded-lg border border-rule bg-card p-2 font-hand text-lg leading-snug shadow-md"
                        style={{ left: pct(Math.min(0.65, r.x)), top: pct(Math.min(0.93, r.y + r.h + 0.01)) }}
                      >
                        {x.text}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </figure>
      ))}

      <Card className="flex flex-col gap-4 p-5">
        {work.feedback.glows.length > 0 && (
          <section>
            <h2 className="font-medium text-pen-green">{labels.glows}</h2>
            <ul className="mt-1 list-disc pl-5">
              {work.feedback.glows.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </section>
        )}
        {work.feedback.grows.length > 0 && (
          <section>
            <h2 className="font-medium text-pen-red">{labels.grows}</h2>
            <ul className="mt-1 flex flex-col gap-2">
              {work.feedback.grows.map((g, i) => (
                <li key={i}>
                  {g.point}
                  {g.how && <p className="text-ink-muted">{g.how}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {work.feedback.nextStep && (
          <section>
            <h2 className="font-medium text-pen-blue">{labels.nextStep}</h2>
            <p>{work.feedback.nextStep}</p>
          </section>
        )}
        {work.feedback.practiceItem && (
          <section>
            <h2 className="font-medium">{labels.practice}</h2>
            <p>{work.feedback.practiceItem}</p>
          </section>
        )}
      </Card>

      {work.pins.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">{labels.comments}</h2>
          <ol className="flex flex-col gap-1">
            {work.pins.map((x) => (
              <li key={x.id} className="flex gap-2">
                <span className="tabular text-ink-muted">{x.number}.</span>
                <span>
                  <span className="sr-only">{labels.kinds[x.kind as PinKind]}: </span>
                  {x.text}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="text-sm text-ink-muted">{labels.disclosure}</p>
    </>
  );
}
