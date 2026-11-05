"use client";
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, EyeOff, RotateCcw, Sparkles, Stamp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ConfidenceChip, StatusChip } from "@/components/chips";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { setSubmissionStudent } from "@/lib/actions/capture";
import {
  acknowledgeItem,
  acknowledgeWellbeing,
  addAnnotation,
  approveSubmission,
  markOpened,
  regenerateComment,
  reopenSubmission,
  setItemScore,
  updateAnnotation,
  updateFeedback,
} from "@/lib/actions/review";
import { toScale, type Scale } from "@/lib/grading/scales";
import { cn } from "@/lib/utils";
import {
  PIN_STYLE,
  PageViewer,
  ScoreStepper,
  type BBox,
  type Line,
  type PageImg,
  type Pin,
  type PinKind,
} from "./page-viewer";

type Item = {
  id: string;
  key: string;
  label: string;
  aiScore: number;
  max: number;
  teacherScore: number | null;
  levels: { label: string; points: number }[] | null;
  aiLevel: string | null;
  teacherLevel: string | null;
  band: "high" | "medium" | "low" | null;
  verifierScore: number | null;
  disagreement: boolean;
  rationale: string;
  evidenceKeys: string[];
  acknowledged: boolean;
  answer: { text: string | null; struck: string | null; diagram: string | null } | null;
};

export type ReviewData = {
  assignment: { id: string; title: string; scale: Scale };
  submission: {
    id: string;
    status: string;
    flags: string[];
    studentId: string | null;
    suggestedStudentId: string | null;
    errorCode: string | null;
    opened: boolean;
  };
  roster: { id: string; display_name: string }[];
  pages: PageImg[];
  lines: Line[];
  pins: (Omit<Pin, "region"> & { region: BBox | null; anchor_line_keys: string[] })[];
  items: Item[];
  feedback: {
    glows: string[];
    grows: { point: string; how: string }[];
    nextStep: string;
    practiceItem: string | null;
    summary: string;
  } | null;
  nav: { prev: string | null; next: string | null; position: number; total: number };
};

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

export function ReviewScreen({ data }: { data: ReviewData }) {
  const t = useTranslations("review");
  const tc = useTranslations("confidence");
  const router = useRouter();
  const { submission: sub, assignment } = data;
  const readOnly = sub.status === "released";
  const reviewable = sub.status === "ready";
  const [items, setItems] = useState(data.items);
  const [pins, setPins] = useState(data.pins);
  const [focused, setFocused] = useState(0);
  const [showTx, setShowTx] = useState(false);
  const [selectedPin, setSelectedPin] = useState<string | null>(null);
  const [wellbeingAck, setWellbeingAck] = useState(sub.flags.includes("wellbeing_acknowledged"));
  const [approveError, setApproveError] = useState<string | null>(null);
  const [stamped, setStamped] = useState(false);
  const [pending, start] = useTransition();
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (!sub.opened) void markOpened(sub.id); // counts toward the green sample (§3.4)
  }, [sub.id, sub.opened]);

  const effective = (i: Item) => i.teacherScore ?? i.aiScore;
  const blocking = items.filter((i) => i.teacherScore === null && i.band !== "high" && !i.acknowledged);
  const needsWellbeing = sub.flags.includes("wellbeing_review") && !wellbeingAck;
  const total = items.reduce((s, i) => s + effective(i), 0);
  const max = items.reduce((s, i) => s + i.max, 0);
  const scaled = max ? toScale(assignment.scale, total, max) : null;

  const lowConfidenceKeys = useMemo(
    () => new Set(items.filter((i) => i.band === "low" && i.teacherScore === null).flatMap((i) => i.evidenceKeys)),
    [items],
  );

  const setScore = useCallback((item: Item, value: number, level: string | null = null) => {
    setItems((xs) =>
      xs.map((x) => (x.id === item.id ? { ...x, teacherScore: value, teacherLevel: level, acknowledged: true } : x)),
    );
    start(async () => {
      const res = await setItemScore(item.id, value, level);
      if (!res.ok) setItems((xs) => xs.map((x) => (x.id === item.id ? item : x)));
    });
  }, []);

  const ack = (item: Item) => {
    setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, acknowledged: true } : x)));
    start(async () => void (await acknowledgeItem(item.id)));
  };

  const approve = useCallback(() => {
    setApproveError(null);
    start(async () => {
      const res = await approveSubmission(sub.id);
      if (!res.ok) return setApproveError(t(`approveErrors.${res.error}`));
      setStamped(true);
      setTimeout(
        () =>
          router.push(
            data.nav.next
              ? `/assignments/${assignment.id}/review/${data.nav.next}`
              : `/assignments/${assignment.id}/review`,
          ),
        700,
      );
    });
  }, [sub.id, t, router, data.nav.next, assignment.id]);

  // Keyboard shortcuts (§3.4)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j" && data.nav.next) router.push(`/assignments/${assignment.id}/review/${data.nav.next}`);
      else if (k === "k" && data.nav.prev) router.push(`/assignments/${assignment.id}/review/${data.nav.prev}`);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = Math.max(0, Math.min(items.length - 1, focused + (e.key === "ArrowDown" ? 1 : -1)));
        setFocused(next);
        itemRefs.current[next]?.focus();
      } else if (/^[0-9]$/.test(e.key) && reviewable) {
        const item = items[focused];
        const v = Number(e.key);
        if (item && v <= item.max && !item.levels) setScore(item, v);
      } else if (k === "e") {
        e.preventDefault();
        feedbackRef.current?.focus();
      } else if (k === "a" && reviewable) approve();
      else if (k === "t") setShowTx((s) => !s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data.nav, assignment.id, router, items, focused, reviewable, setScore, approve]);

  const studentName = data.roster.find((s) => s.id === sub.studentId)?.display_name;
  const suggested = data.roster.find((s) => s.id === sub.suggestedStudentId);

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StudentHeader
            submissionId={sub.id}
            name={studentName}
            suggested={suggested ?? null}
            roster={data.roster}
            readOnly={readOnly}
          />
          {sub.flags
            .filter((f) => f !== "wellbeing_acknowledged")
            .map((f) => (
              <StatusChip
                key={f}
                label={t.has(`flags.${f}`) ? t(`flags.${f}`) : f}
                tone={f === "wellbeing_review" ? "warn" : "neutral"}
              />
            ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("prev")}
            title={t("prev")}
            disabled={!data.nav.prev}
            onClick={() => router.push(`/assignments/${assignment.id}/review/${data.nav.prev}`)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="tabular text-sm text-ink-muted">
            {data.nav.position} / {data.nav.total}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("next")}
            title={t("next")}
            disabled={!data.nav.next}
            onClick={() => router.push(`/assignments/${assignment.id}/review/${data.nav.next}`)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>

      {sub.flags.includes("wellbeing_review") && (
        <Card role="alert" className="border-pen-red p-4">
          <p className="flex items-center gap-2 font-medium text-pen-red">
            <AlertTriangle aria-hidden className="size-5" /> {t("wellbeingTitle")}
          </p>
          <p className="mt-1 text-sm">{t("wellbeingBody")}</p>
          {!wellbeingAck && !readOnly && (
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => start(async () => void ((await acknowledgeWellbeing(sub.id)).ok && setWellbeingAck(true)))}
            >
              {t("wellbeingAck")}
            </Button>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-[55fr_45fr] lg:grid-cols-[60fr_40fr]">
        {/* left: the page is the hero */}
        <div className="flex flex-col gap-4">
          <Button variant="outline" onClick={() => setShowTx((s) => !s)} aria-pressed={showTx} className="self-start">
            {showTx ? <EyeOff aria-hidden /> : <Eye aria-hidden />}{" "}
            {showTx ? t("hideTranscription") : t("showTranscription")} (T)
          </Button>
          {data.pages.map((p) => (
            <PageViewer
              key={p.id}
              page={p}
              pins={pins.filter((x) => x.page_id === p.id)}
              lines={data.lines.filter((l) => l.pageId === p.id)}
              lowConfidenceKeys={lowConfidenceKeys}
              showTranscription={showTx}
              selectedPin={selectedPin}
              onSelectPin={setSelectedPin}
              readOnly={readOnly}
              onAddNote={async (region, text, kind) => {
                const res = await addAnnotation(sub.id, p.id, region, text, kind);
                if (res.ok)
                  setPins((ps) => [
                    ...ps,
                    {
                      id: res.id,
                      page_id: p.id,
                      kind,
                      region,
                      approximate: false,
                      text,
                      author: "teacher",
                      hidden: false,
                      position: ps.length + 1,
                      anchor_line_keys: [],
                    },
                  ]);
              }}
            />
          ))}
        </div>

        {/* right: items, feedback, comments */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-baseline justify-between">
              <CardTitle>{t("items")}</CardTitle>
              <span className="tabular text-sm">
                {t("total")}: {total} / {max}
                {scaled && <strong className="ml-2 font-serif text-xl">{scaled.display}</strong>}
              </span>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {items.map((item, i) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  ref={(el) => void (itemRefs.current[i] = el)}
                  focused={focused === i}
                  onFocus={() => setFocused(i)}
                  readOnly={!reviewable}
                  onScore={(v, level) => setScore(item, v, level)}
                  onAck={() => ack(item)}
                  bandLabel={item.band ? tc(item.band) : null}
                />
              ))}
            </CardContent>
          </Card>

          {data.feedback && (
            <FeedbackEditor
              submissionId={sub.id}
              initial={data.feedback}
              readOnly={!reviewable}
              textareaRef={feedbackRef}
            />
          )}

          <CommentsList
            pins={pins}
            setPins={setPins}
            selected={selectedPin}
            onSelect={setSelectedPin}
            readOnly={!reviewable}
          />

          {/* approve */}
          <Card className={cn("sticky bottom-2 z-10 flex flex-col gap-2 p-4 shadow-md", stamped && "border-pen-green")}>
            {sub.status === "ready" && (
              <>
                {blocking.length > 0 && (
                  <p className="text-sm text-pen-amber">{t("approveBlocked", { count: blocking.length })}</p>
                )}
                {approveError && <FieldError>{approveError}</FieldError>}
                <Button
                  size="lg"
                  onClick={approve}
                  disabled={pending || blocking.length > 0 || needsWellbeing}
                  data-testid="approve"
                >
                  <Stamp aria-hidden /> {pending ? t("approving") : `${t("approve")} (A)`}
                </Button>
              </>
            )}
            {(sub.status === "approved" || stamped) && (
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "font-serif text-2xl text-pen-green",
                    stamped && "animate-[stamp_200ms_ease-out] motion-reduce:animate-none",
                  )}
                >
                  {t("approvedStamp")} ✓
                </span>
                {sub.status === "approved" && (
                  <Button
                    variant="ghost"
                    onClick={() => start(async () => void ((await reopenSubmission(sub.id)).ok && router.refresh()))}
                  >
                    <RotateCcw aria-hidden /> {t("reopen")}
                  </Button>
                )}
              </div>
            )}
            {sub.status === "released" && <StatusChip label={t("approvedStamp")} tone="good" />}
            <p className="hidden text-xs text-ink-muted md:block">{t("shortcuts")}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StudentHeader({
  submissionId,
  name,
  suggested,
  roster,
  readOnly,
}: {
  submissionId: string;
  name?: string;
  suggested: { id: string; display_name: string } | null;
  roster: { id: string; display_name: string }[];
  readOnly: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (name) return <h1 className="font-serif text-3xl">{name}</h1>;
  const assign = (id: string) =>
    start(async () => void ((await setSubmissionStudent(submissionId, id)).ok && router.refresh()));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="font-serif text-3xl text-ink-muted">{t("review.unmatched")}</h1>
      {!readOnly && suggested && (
        <Button variant="outline" disabled={pending} onClick={() => assign(suggested.id)}>
          {t("hub.suggested", { name: suggested.display_name })} {t("hub.confirm")}
        </Button>
      )}
      {!readOnly && (
        <Select
          aria-label={t("hub.choose")}
          defaultValue=""
          disabled={pending}
          onChange={(e) => e.target.value && assign(e.target.value)}
          className="w-auto"
        >
          <option value="">{t("hub.choose")}</option>
          {roster.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

function ItemCard({
  item,
  ref,
  focused,
  onFocus,
  readOnly,
  onScore,
  onAck,
  bandLabel,
}: {
  item: Item;
  ref: (el: HTMLElement | null) => void;
  focused: boolean;
  onFocus: () => void;
  readOnly: boolean;
  onScore: (v: number, level: string | null) => void;
  onAck: () => void;
  bandLabel: string | null;
}) {
  const t = useTranslations("review");
  const score = item.teacherScore ?? item.aiScore;
  const deduction = score < item.max;
  const needsYou = item.teacherScore === null && item.band !== "high" && !item.acknowledged;
  return (
    <section
      ref={ref}
      tabIndex={-1}
      onFocus={onFocus}
      onClick={onFocus}
      aria-label={item.label}
      data-testid="review-item"
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3 outline-none",
        focused ? "border-ink" : "border-rule",
        needsYou && "border-l-4 border-l-pen-red",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{item.label}</h3>
        <div className="flex items-center gap-2">
          {item.teacherScore !== null && (
            <span className="text-xs text-ink-muted">{t("aiScore", { score: item.aiScore })}</span>
          )}
          {item.band && bandLabel && <ConfidenceChip band={item.band} label={bandLabel} />}
        </div>
      </div>

      {item.levels ? (
        <Select
          aria-label={t("level")}
          disabled={readOnly}
          value={item.teacherLevel ?? item.aiLevel ?? ""}
          onChange={(e) => {
            const lvl = item.levels!.find((l) => l.label === e.target.value);
            if (lvl) onScore(lvl.points, lvl.label);
          }}
        >
          {item.levels.map((l) => (
            <option key={l.label} value={l.label}>
              {l.label} · {l.points}
            </option>
          ))}
        </Select>
      ) : (
        <ScoreStepper
          value={score}
          max={item.max}
          disabled={readOnly}
          label={`${t("score")} · ${item.label}`}
          onChange={(v) => onScore(v, null)}
        />
      )}

      {item.disagreement && item.verifierScore !== null && (
        <p className="flex items-center gap-1 text-sm text-pen-amber">
          <AlertTriangle aria-hidden className="size-4" /> {t("disagreement")} ·{" "}
          {t("verifier", { score: item.verifierScore })}
        </p>
      )}

      <div className="rounded-lg bg-paper p-2 text-sm">
        <p className="text-xs text-ink-muted">{t("evidence")}</p>
        <p className="whitespace-pre-wrap font-mono text-[13px]">{item.answer?.text || t("noEvidence")}</p>
        {item.answer?.struck && (
          <p className="text-xs text-ink-muted line-through">{t("struck", { text: item.answer.struck })}</p>
        )}
        {item.answer?.diagram && (
          <p className="text-xs text-ink-muted">{t("diagram", { text: item.answer.diagram })}</p>
        )}
      </div>

      {/* Deductions always show their rationale expanded (§3.4 automation-bias counter) */}
      <details open={deduction || needsYou} className="text-sm">
        <summary className="min-h-9 cursor-pointer text-ink-muted">{t("rationale")}</summary>
        <p className="pt-1">{item.rationale}</p>
        {deduction && item.teacherScore === null && <p className="pt-1 text-xs text-pen-amber">{t("deductionNote")}</p>}
      </details>

      {!readOnly && item.teacherScore === null && item.band !== "high" && (
        <Button
          variant={needsYou ? "outline" : "ghost"}
          onClick={onAck}
          disabled={!needsYou}
          className="self-start"
          aria-describedby={needsYou ? `${item.id}-needs` : undefined}
        >
          {needsYou ? t("acknowledge") : t("acknowledged")}
        </Button>
      )}
      {needsYou && (
        <p id={`${item.id}-needs`} className="sr-only">
          {t("needsYou")}
        </p>
      )}
    </section>
  );
}

function FeedbackEditor({
  submissionId,
  initial,
  readOnly,
  textareaRef,
}: {
  submissionId: string;
  initial: NonNullable<ReviewData["feedback"]>;
  readOnly: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const t = useTranslations("review");
  const [fb, setFb] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const save = (next = fb) => {
    setState("saving");
    void updateFeedback(submissionId, {
      glows: next.glows,
      grows: next.grows,
      next_step: next.nextStep,
      practice_item: next.practiceItem,
    }).then(() => setState("saved"));
  };
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between">
        <CardTitle>{t("feedback")}</CardTitle>
        <span role="status" className="text-xs text-ink-muted">
          {state === "saving" ? t("saving") : state === "saved" ? t("saved") : ""}
        </span>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {fb.summary && (
          <p className="rounded-lg bg-paper p-2 text-sm text-ink-muted">
            <Sparkles aria-hidden className="mr-1 inline size-3.5" />
            {t("summaryForTeacher")}: {fb.summary}
          </p>
        )}
        <fieldset className="flex flex-col gap-2" disabled={readOnly}>
          <legend className="text-sm font-medium text-pen-green">{t("glows")}</legend>
          {fb.glows.map((g, i) => (
            <Textarea
              key={i}
              ref={i === 0 ? textareaRef : undefined}
              aria-label={`${t("glows")} ${i + 1}`}
              className="min-h-16"
              value={g}
              onChange={(e) => setFb({ ...fb, glows: fb.glows.map((x, j) => (j === i ? e.target.value : x)) })}
              onBlur={() => save()}
            />
          ))}
          <Button variant="ghost" className="self-start" onClick={() => setFb({ ...fb, glows: [...fb.glows, ""] })}>
            + {t("addGlow")}
          </Button>
        </fieldset>
        <fieldset className="flex flex-col gap-2" disabled={readOnly}>
          <legend className="text-sm font-medium text-pen-red">{t("grows")}</legend>
          {fb.grows.map((g, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-lg border border-rule p-2">
              <Textarea
                aria-label={`${t("grows")} ${i + 1}`}
                className="min-h-14"
                value={g.point}
                onChange={(e) =>
                  setFb({ ...fb, grows: fb.grows.map((x, j) => (j === i ? { ...x, point: e.target.value } : x)) })
                }
                onBlur={() => save()}
              />
              <Label className="text-xs text-ink-muted">{t("how")}</Label>
              <Textarea
                aria-label={`${t("how")} ${i + 1}`}
                className="min-h-14"
                value={g.how}
                onChange={(e) =>
                  setFb({ ...fb, grows: fb.grows.map((x, j) => (j === i ? { ...x, how: e.target.value } : x)) })
                }
                onBlur={() => save()}
              />
            </div>
          ))}
          <Button
            variant="ghost"
            className="self-start"
            onClick={() => setFb({ ...fb, grows: [...fb.grows, { point: "", how: "" }] })}
          >
            + {t("addGrow")}
          </Button>
        </fieldset>
        <div className="flex flex-col gap-1">
          <Label htmlFor="next-step" className="text-pen-blue">
            {t("nextStep")}
          </Label>
          <Textarea
            id="next-step"
            disabled={readOnly}
            className="min-h-16"
            value={fb.nextStep}
            onChange={(e) => setFb({ ...fb, nextStep: e.target.value })}
            onBlur={() => save()}
          />
        </div>
        {fb.practiceItem !== null && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="practice">{t("practiceItem")}</Label>
            <Textarea
              id="practice"
              disabled={readOnly}
              className="min-h-16"
              value={fb.practiceItem}
              onChange={(e) => setFb({ ...fb, practiceItem: e.target.value })}
              onBlur={() => save()}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CommentsList({
  pins,
  setPins,
  selected,
  onSelect,
  readOnly,
}: {
  pins: ReviewData["pins"];
  setPins: React.Dispatch<React.SetStateAction<ReviewData["pins"]>>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("review");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState("");
  const [suggestion, setSuggestion] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const patch = (id: string, p: Partial<Pin>) => setPins((ps) => ps.map((x) => (x.id === id ? { ...x, ...p } : x)));
  if (!pins.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("comments")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-2">
          {pins.map((p, i) => {
            const S = PIN_STYLE[p.kind as PinKind];
            return (
              <li
                key={p.id}
                className={cn(
                  "rounded-lg border p-2",
                  selected === p.id ? "border-ink" : "border-rule",
                  p.hidden && "opacity-60",
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-start gap-2 text-left"
                  onClick={() => onSelect(selected === p.id ? null : p.id)}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-white",
                      S.fill,
                    )}
                  >
                    <S.Icon aria-hidden className="size-3.5" strokeWidth={3} />
                  </span>
                  <span className="tabular text-sm text-ink-muted">{p.position ?? i + 1}.</span>
                  <span className={cn("flex-1", p.hidden && "line-through")}>
                    <span className="sr-only">{t(`kinds.${p.kind}`)}: </span>
                    {p.text}
                  </span>
                </button>
                {!readOnly && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      className="min-h-9"
                      onClick={() => (setEditing(p.id), setDraft(p.text), setSuggestion(null), setErr(null))}
                    >
                      {t("edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      className="min-h-9"
                      onClick={() => (
                        patch(p.id, { hidden: !p.hidden }),
                        void updateAnnotation(p.id, { hidden: !p.hidden })
                      )}
                    >
                      {p.hidden ? t("show") : t("hide")}
                    </Button>
                  </div>
                )}
                {editing === p.id && (
                  <div className="mt-2 flex flex-col gap-2">
                    <Textarea
                      aria-label={t("edit")}
                      className="min-h-16 font-hand text-lg"
                      value={draft}
                      maxLength={300}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => {
                          patch(p.id, { text: draft });
                          setEditing(null);
                          void updateAnnotation(p.id, { text: draft });
                        }}
                      >
                        {t("save")}
                      </Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>
                        {t("cancel")}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Input
                        aria-label={t("regenerateHint")}
                        placeholder={t("regenerateHint")}
                        value={hint}
                        onChange={(e) => setHint(e.target.value)}
                        className="min-w-40 flex-1"
                      />
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            setErr(null);
                            const res = await regenerateComment(p.id, hint);
                            if (res.ok) setSuggestion({ id: p.id, text: res.text });
                            else setErr(t(`regenerateErrors.${res.error}`));
                          })
                        }
                      >
                        <Sparkles aria-hidden /> {t("regenerate")}
                      </Button>
                    </div>
                    {suggestion?.id === p.id && (
                      <div className="flex items-start gap-2 rounded-lg bg-paper p-2">
                        <p className="flex-1 font-hand text-lg">{suggestion.text}</p>
                        <Button variant="outline" onClick={() => setDraft(suggestion.text)}>
                          {t("useSuggestion")}
                        </Button>
                      </div>
                    )}
                    {err && <FieldError>{err}</FieldError>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
