"use client";
import { Minus, Pencil, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { PIN_STYLE, pinAnchor, type PinKind } from "@/components/pin-style";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type BBox = { x: number; y: number; w: number; h: number };
export type { PinKind };
export { PIN_STYLE };
export type Pin = {
  id: string;
  page_id: string;
  kind: PinKind;
  region: BBox | null;
  approximate: boolean;
  text: string;
  author: "ai" | "teacher";
  hidden: boolean;
  position: number | null;
};
export type Line = { key: string; text: string; pageId: string; bbox: BBox; confidence: number | null };
export type PageImg = { id: string; position: number; url: string | null; width: number; height: number };

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

export function PageViewer({
  page,
  pins,
  lines,
  lowConfidenceKeys,
  showTranscription,
  selectedPin,
  onSelectPin,
  onAddNote,
  readOnly,
}: {
  page: PageImg;
  pins: Pin[];
  lines: Line[];
  lowConfidenceKeys: Set<string>;
  showTranscription: boolean;
  selectedPin: string | null;
  onSelectPin: (id: string | null) => void;
  onAddNote: (region: BBox, text: string, kind: PinKind) => Promise<void>;
  readOnly: boolean;
}) {
  const t = useTranslations("review");
  const [zoom, setZoom] = useState(1);
  const [adding, setAdding] = useState<{ x: number; y: number } | null>(null);
  const [armed, setArmed] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteKind, setNoteKind] = useState<PinKind>("note");
  const visible = pins.filter((p) => !p.hidden && p.region);

  return (
    <figure className="flex flex-col gap-2" aria-label={t("page", { n: page.position })}>
      <div className="flex items-center justify-between gap-2">
        <figcaption className="text-sm text-ink-muted">{t("page", { n: page.position })}</figcaption>
        <div className="flex items-center gap-1">
          {!readOnly && (
            <Button variant={armed ? "primary" : "outline"} onClick={() => setArmed((a) => !a)} aria-pressed={armed}>
              <Pencil aria-hidden /> {t("addNote")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("zoomOut")}
            onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
          >
            <ZoomOut aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("zoomIn")}
            onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
          >
            <ZoomIn aria-hidden />
          </Button>
        </div>
      </div>
      {armed && <p className="text-sm text-pen-blue">{t("addNoteHint")}</p>}
      <div className="max-h-[75dvh] overflow-auto rounded-[var(--radius-card)] border border-rule bg-card">
        <div
          className={cn("relative", armed && "cursor-crosshair")}
          style={{ width: `${zoom * 100}%`, aspectRatio: `${page.width} / ${page.height}` }}
          onClick={(e) => {
            if (!armed) return;
            const r = e.currentTarget.getBoundingClientRect();
            setAdding({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
            setArmed(false);
          }}
        >
          {page.url ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
            <img
              src={page.url}
              alt={t("page", { n: page.position })}
              className="absolute inset-0 size-full select-none"
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 bg-rule" />
          )}

          {/* low-confidence evidence regions are highlighted (§3.4) */}
          {lines
            .filter((l) => lowConfidenceKeys.has(l.key))
            .map((l) => (
              <div
                key={`lc-${l.key}`}
                aria-hidden
                className="absolute rounded bg-pen-amber/20 ring-2 ring-pen-amber"
                style={{ left: pct(l.bbox.x), top: pct(l.bbox.y), width: pct(l.bbox.w), height: pct(l.bbox.h) }}
              />
            ))}

          {showTranscription &&
            lines.map((l) => (
              <div
                key={`tr-${l.key}`}
                className="absolute overflow-hidden rounded border border-pen-blue/60 bg-card/85 px-0.5 text-[10px] leading-tight text-ink sm:text-xs"
                style={{ left: pct(l.bbox.x), top: pct(l.bbox.y), width: pct(l.bbox.w), minHeight: pct(l.bbox.h) }}
                title={`${l.key} · ${l.confidence?.toFixed(2) ?? "?"}`}
              >
                {l.text}
              </div>
            ))}

          {visible.map((p, i) => {
            const s = PIN_STYLE[p.kind];
            const r = p.region!;
            // pins sit in the margin next to the region so they never cover the writing (§5)
            const { x: pinX, y: pinY } = pinAnchor(r);
            const selected = selectedPin === p.id;
            return (
              <div key={p.id}>
                <div
                  aria-hidden
                  className={cn(
                    "absolute rounded-md border",
                    s.tint,
                    p.approximate && "border-dashed",
                    selected ? "border-2" : "border-0",
                  )}
                  style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}
                />
                <button
                  type="button"
                  onClick={(e) => (e.stopPropagation(), onSelectPin(selected ? null : p.id))}
                  aria-label={`${p.position ?? i + 1}. ${t(`kinds.${p.kind}`)}: ${p.text}${p.approximate ? ` (${t("approximate")})` : ""}`}
                  aria-pressed={selected}
                  className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                  style={{ left: pct(pinX), top: pct(pinY) }}
                >
                  <span
                    className={cn(
                      "flex size-7 items-center justify-center rounded-full text-white ring-2 ring-[var(--pin-outline)]",
                      s.fill,
                      selected && "scale-110",
                    )}
                  >
                    <s.Icon aria-hidden className="size-4" strokeWidth={3} />
                  </span>
                  <span className="tabular absolute -right-0.5 -top-0.5 rounded-full bg-ink px-1 text-[10px] font-medium text-paper">
                    {p.position ?? i + 1}
                  </span>
                </button>
                {selected && (
                  <div
                    role="tooltip"
                    className="absolute z-10 max-w-64 rounded-lg border border-rule bg-card p-2 font-hand text-lg leading-snug text-ink shadow-md"
                    style={{ left: pct(Math.min(0.7, r.x)), top: pct(Math.min(0.95, r.y + r.h + 0.01)) }}
                  >
                    {p.text}
                  </div>
                )}
              </div>
            );
          })}

          {adding && (
            <span
              aria-hidden
              className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-pen-blue ring-2 ring-white"
              style={{ left: pct(adding.x), top: pct(adding.y) }}
            />
          )}
        </div>
      </div>

      {adding && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!noteText.trim()) return;
            await onAddNote(
              { x: Math.max(0, adding.x - 0.03), y: Math.max(0, adding.y - 0.012), w: 0.06, h: 0.024 },
              noteText.trim(),
              noteKind,
            );
            setAdding(null);
            setNoteText("");
          }}
        >
          <Select
            aria-label={t("level")}
            value={noteKind}
            onChange={(e) => setNoteKind(e.target.value as PinKind)}
            className="w-36"
          >
            {(Object.keys(PIN_STYLE) as PinKind[]).map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
          <Input
            autoFocus
            value={noteText}
            maxLength={300}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder={t("notePlaceholder")}
            className="min-w-48 flex-1"
            aria-label={t("notePlaceholder")}
          />
          <Button type="submit">{t("save")}</Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(null)}>
            {t("cancel")}
          </Button>
        </form>
      )}
    </figure>
  );
}

export function ScoreStepper({
  value,
  max,
  onChange,
  disabled,
  label,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const t = useTranslations("review");
  const step = max <= 10 ? 0.5 : 1;
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <Button
        variant="outline"
        size="icon"
        aria-label={t("decrease")}
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, value - step))}
      >
        <Minus aria-hidden />
      </Button>
      <input
        type="number"
        inputMode="decimal"
        aria-label={t("score")}
        className="tabular h-11 w-16 rounded-xl border border-rule bg-card text-center text-lg"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0 && v <= max) onChange(v);
        }}
      />
      <Button
        variant="outline"
        size="icon"
        aria-label={t("increase")}
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
      >
        <Plus aria-hidden />
      </Button>
      <span className="tabular ml-1 text-sm text-ink-muted">{t("of", { max })}</span>
    </div>
  );
}
