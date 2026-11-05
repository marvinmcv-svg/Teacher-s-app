"use client";
import { Camera, Check, Plus, Sparkles, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldError, FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  createAssignment,
  extractAnswerKey,
  type CreateAssignmentResult,
  type ExtractKeyResult,
  type ExtractedRow,
} from "@/lib/actions/assignments";
import {
  FEEDBACK_STYLES,
  QUESTION_TYPES,
  criterionMax,
  type FeedbackSettings,
  type RubricCriterion,
} from "@/lib/grading/assignment";
import { SCALE_PRESETS, ScaleSchema, type Scale } from "@/lib/grading/scales";
import { cn } from "@/lib/utils";

type Row = Omit<ExtractedRow, "extraction_confidence"> & {
  uid: string;
  extraction_confidence?: number;
  answersText: string;
  equivalentsText: string;
};
type Template = { id: string; title: string; criteria: RubricCriterion[] };
type KeyMode = "typed" | "snap_key" | "snap_blank" | "rubric";

let uidCounter = 0;
const uid = () => `r${++uidCounter}`;
const splitList = (s: string) =>
  s
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);

function blankRow(n: number): Row {
  return {
    uid: uid(),
    label: String(n),
    prompt_text: "",
    type: "short_answer",
    max_points: 1,
    correct_answers: [],
    equivalents: [],
    form_matters: false,
    partial_credit_rules: "",
    notes: "",
    source: "typed",
    teacher_confirmed: true,
    answersText: "",
    equivalentsText: "",
  };
}

export function AssignmentWizard({
  classId,
  defaults,
  templates,
}: {
  classId: string;
  defaults: { subject: string; gradeLevel: string; feedbackLocale: "es" | "en" };
  templates: Template[];
}) {
  const t = useTranslations("assignments");
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState(defaults.subject);
  const [gradeLevel, setGradeLevel] = useState(defaults.gradeLevel);
  const [feedbackLocale, setFeedbackLocale] = useState<"es" | "en">(defaults.feedbackLocale);
  const [presetKey, setPresetKey] = useState<string>("bo_100");
  const [custom, setCustom] = useState({ min: 1, max: 100, pass_mark: 51, decimals: 0 });
  const [rows, setRows] = useState<Row[]>([blankRow(1)]);
  const [mode, setMode] = useState<KeyMode>("typed");
  const [templateId, setTemplateId] = useState<string>("");
  const [feedback, setFeedback] = useState<FeedbackSettings>({
    style: "glow_grow",
    tone: "warm",
    length: "short",
    show_correct_answers: false,
    show_score: true,
    practice_item: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);
  const [pending, startTransition] = useTransition();

  const scale: Scale =
    presetKey === "custom"
      ? { type: "numeric", preset: "custom", ...custom }
      : (SCALE_PRESETS[presetKey as keyof typeof SCALE_PRESETS] as Scale);
  const scaleValid = ScaleSchema.safeParse(scale).success;
  const criteria = templates.find((x) => x.id === templateId)?.criteria ?? [];
  const unconfirmed = rows.filter((r) => r.source !== "typed" && !r.teacher_confirmed).length;
  const totalPoints =
    rows.reduce((s, r) => s + (Number.isFinite(r.max_points) ? r.max_points : 0), 0) +
    criteria.reduce((s, c) => s + criterionMax(c), 0);

  function goNext() {
    setError(null);
    if (step === 1) {
      if (!title.trim()) return setTitleError(true);
      if (!scaleValid) return;
    }
    if (step === 2) {
      if (!rows.length && !criteria.length) return setError(t("errors.needs_key"));
      if (unconfirmed) return setError(t("errors.unconfirmed"));
    }
    setStep((s) => Math.min(3, s + 1));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res: CreateAssignmentResult = await createAssignment({
        class_id: classId,
        title: title.trim(),
        subject: subject.trim() || null,
        grade_level: gradeLevel.trim() || null,
        feedback_locale: feedbackLocale,
        scale,
        questions: rows.map((r) => ({
          label: r.label.trim(),
          prompt_text: r.prompt_text,
          type: r.type,
          max_points: r.max_points,
          correct_answers: splitList(r.answersText),
          equivalents: splitList(r.equivalentsText),
          form_matters: r.form_matters,
          partial_credit_rules: r.partial_credit_rules,
          notes: r.notes,
          source: r.source,
          teacher_confirmed: r.teacher_confirmed,
        })),
        criteria,
        feedback,
      });
      // success redirects; we only get here on failure
      if (res && !res.ok) setError(t(`errors.${res.error}`));
    });
  }

  const steps = [t("stepBasics"), t("stepKey"), t("stepFeedback")];
  return (
    <div className="flex flex-col gap-6">
      <ol className="grid grid-cols-3 gap-2" aria-label={t("stepOf", { step, total: 3 })}>
        {steps.map((label, i) => (
          <li
            key={label}
            aria-current={step === i + 1 ? "step" : undefined}
            className={cn(
              "rounded-lg border-t-4 pt-2 text-sm",
              step > i ? "border-ink text-ink" : "border-rule text-ink-muted",
            )}
          >
            <span className="tabular mr-1">{i + 1}.</span>
            {label}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">{t("titleLabel")}</Label>
              <Input
                id="title"
                value={title}
                maxLength={160}
                autoFocus
                placeholder={t("titlePlaceholder")}
                onChange={(e) => (setTitle(e.target.value), setTitleError(false))}
                aria-invalid={titleError || undefined}
              />
              {titleError && <FieldError>{t("titleRequired")}</FieldError>}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="subject">{t("subjectLabel")}</Label>
                <Input id="subject" value={subject} maxLength={60} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="grade">{t("gradeLabel")}</Label>
                <Input id="grade" value={gradeLevel} maxLength={60} onChange={(e) => setGradeLevel(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="scale">{t("scaleLabel")}</Label>
                <Select id="scale" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
                  {[...Object.keys(SCALE_PRESETS), "custom"].map((k) => (
                    <option key={k} value={k}>
                      {t(`scalePresets.${k}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="flocale">{t("feedbackLocaleLabel")}</Label>
                <Select
                  id="flocale"
                  value={feedbackLocale}
                  onChange={(e) => setFeedbackLocale(e.target.value as "es" | "en")}
                >
                  <option value="es" lang="es">
                    Español
                  </option>
                  <option value="en" lang="en">
                    English
                  </option>
                </Select>
              </div>
            </div>
            {presetKey === "custom" && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(["min", "max", "pass_mark", "decimals"] as const).map((k) => (
                  <div key={k} className="flex flex-col gap-1">
                    <Label htmlFor={`scale-${k}`}>
                      {t(
                        k === "min"
                          ? "scaleMin"
                          : k === "max"
                            ? "scaleMax"
                            : k === "pass_mark"
                              ? "scalePass"
                              : "scaleDecimals",
                      )}
                    </Label>
                    <Input
                      id={`scale-${k}`}
                      type="number"
                      inputMode="decimal"
                      step={k === "decimals" ? 1 : "any"}
                      min={k === "decimals" ? 0 : undefined}
                      max={k === "decimals" ? 2 : undefined}
                      value={custom[k]}
                      onChange={(e) => setCustom((c) => ({ ...c, [k]: Number(e.target.value) }))}
                    />
                  </div>
                ))}
              </div>
            )}
            {!scaleValid && <FieldError>{t("scaleInvalid")}</FieldError>}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <KeyStep
          mode={mode}
          setMode={setMode}
          rows={rows}
          setRows={setRows}
          templates={templates}
          templateId={templateId}
          setTemplateId={setTemplateId}
          criteria={criteria}
          unconfirmed={unconfirmed}
          totalPoints={totalPoints}
        />
      )}

      {step === 3 && <FeedbackStep feedback={feedback} setFeedback={setFeedback} />}

      {error && <FieldError>{error}</FieldError>}
      <div className="flex items-center justify-between gap-3">
        {step > 1 ? (
          <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
            {t("back")}
          </Button>
        ) : (
          <span />
        )}
        {step < 3 ? (
          <Button onClick={goNext}>{t("next")}</Button>
        ) : (
          <Button size="lg" onClick={submit} disabled={pending}>
            {pending ? t("creating") : t("create")}
          </Button>
        )}
      </div>
    </div>
  );
}

function KeyStep(props: {
  mode: KeyMode;
  setMode: (m: KeyMode) => void;
  rows: Row[];
  setRows: React.Dispatch<React.SetStateAction<Row[]>>;
  templates: Template[];
  templateId: string;
  setTemplateId: (id: string) => void;
  criteria: RubricCriterion[];
  unconfirmed: number;
  totalPoints: number;
}) {
  const t = useTranslations("assignments");
  const { mode, setMode, rows, setRows } = props;
  const modes: [KeyMode, string][] = [
    ["typed", t("keyModeTyped")],
    ["snap_key", t("keyModeSnapKey")],
    ["snap_blank", t("keyModeSnapBlank")],
    ["rubric", t("keyModeRubric")],
  ];
  const update = (id: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.uid === id ? { ...r, ...patch } : r)));

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl border border-rule bg-card p-1 sm:grid-cols-4">
        {modes.map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "min-h-11 rounded-lg px-2 text-sm font-medium",
              mode === m ? "bg-ink text-paper" : "text-ink-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {(mode === "snap_key" || mode === "snap_blank") && (
        <SnapKey
          mode={mode === "snap_key" ? "key" : "blank"}
          onRows={(extracted) => {
            setRows((rs) => [
              ...rs.filter((r) => r.source !== "typed" || r.answersText || r.notes || r.prompt_text),
              ...extracted.map((x) => ({
                ...x,
                uid: uid(),
                answersText: x.correct_answers.join(" | "),
                equivalentsText: x.equivalents.join(" | "),
              })),
            ]);
            setMode("typed");
          }}
        />
      )}

      {mode === "rubric" ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <FieldHint>{t("rubricHint")}</FieldHint>
            <div className="flex flex-col gap-2">
              <Label htmlFor="tpl">{t("rubricTemplate")}</Label>
              <Select id="tpl" value={props.templateId} onChange={(e) => props.setTemplateId(e.target.value)}>
                <option value="">{t("rubricNone")}</option>
                {props.templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.title}
                  </option>
                ))}
              </Select>
            </div>
            {props.criteria.length > 0 && (
              <ul className="divide-y divide-rule rounded-xl border border-rule">
                {props.criteria.map((c) => (
                  <li key={c.key} className="flex flex-col gap-1 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{c.title}</span>
                      <span className="tabular text-sm text-ink-muted">
                        {t("criterionLevels", { count: c.levels.length })} ·{" "}
                        {t("criterionPoints", { points: criterionMax(c) })}
                      </span>
                    </div>
                    <p className="text-sm text-ink-muted">{c.levels.map((l) => l.label).join(" · ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.length === 0 && <p className="text-ink-muted">{t("noQuestions")}</p>}
          {rows.map((r) => (
            <QuestionRow
              key={r.uid}
              row={r}
              onChange={(p) => update(r.uid, p)}
              onRemove={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}
            />
          ))}
          <Button
            variant="outline"
            onClick={() => setRows((rs) => [...rs, blankRow(rs.length + 1)])}
            className="self-start"
          >
            <Plus aria-hidden /> {t("addQuestion")}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="tabular text-ink-muted">{t("totalPoints", { count: props.totalPoints })}</span>
        {props.unconfirmed > 0 && (
          <span className="text-pen-amber">{t("unconfirmedCount", { count: props.unconfirmed })}</span>
        )}
      </div>
    </div>
  );
}

function QuestionRow({
  row,
  onChange,
  onRemove,
}: {
  row: Row;
  onChange: (p: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("assignments");
  const id = useId();
  const needsConfirm = row.source !== "typed";
  return (
    <Card className={cn(needsConfirm && !row.teacher_confirmed && "border-pen-amber")} data-testid="question-row">
      <CardContent className="flex flex-col gap-3 p-4">
        {needsConfirm && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 rounded-full bg-pen-amber/10 px-2 py-0.5 text-pen-amber">
              <Sparkles aria-hidden className="size-3.5" />
              {row.source === "ai_proposed" ? t("aiProposedBadge") : t("extractedBadge")}
            </span>
            {row.extraction_confidence !== undefined && row.extraction_confidence < 0.7 && (
              <span className="text-pen-red">{t("lowConfidence")}</span>
            )}
          </div>
        )}
        <div className="grid grid-cols-[4.5rem_1fr_5rem_auto] items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-label`}>{t("questionLabel")}</Label>
            <Input
              id={`${id}-label`}
              value={row.label}
              maxLength={20}
              onChange={(e) => onChange({ label: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-type`}>{t("questionType")}</Label>
            <Select
              id={`${id}-type`}
              value={row.type}
              onChange={(e) => onChange({ type: e.target.value as Row["type"] })}
            >
              {QUESTION_TYPES.map((q) => (
                <option key={q} value={q}>
                  {t(`types.${q}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${id}-pts`}>{t("maxPoints")}</Label>
            <Input
              id={`${id}-pts`}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={row.max_points}
              onChange={(e) => onChange({ max_points: Number(e.target.value) })}
            />
          </div>
          <Button variant="ghost" size="icon" aria-label={t("removeQuestion", { label: row.label })} onClick={onRemove}>
            <Trash2 aria-hidden />
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-ans`}>{t("correctAnswers")}</Label>
          <Input
            id={`${id}-ans`}
            value={row.answersText}
            onChange={(e) => onChange({ answersText: e.target.value })}
            aria-describedby={`${id}-ans-hint`}
          />
          <FieldHint id={`${id}-ans-hint`}>{t("correctAnswersHint")}</FieldHint>
        </div>
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-ink-muted">
            {t("prompt")} · {t("equivalents")} · {t("notes")}
          </summary>
          <div className="flex flex-col gap-3 pt-1">
            <Textarea
              aria-label={t("prompt")}
              value={row.prompt_text}
              className="min-h-20"
              onChange={(e) => onChange({ prompt_text: e.target.value })}
              placeholder={t("prompt")}
            />
            <Input
              aria-label={t("equivalents")}
              placeholder={t("equivalents")}
              value={row.equivalentsText}
              onChange={(e) => onChange({ equivalentsText: e.target.value })}
            />
            <Input
              aria-label={t("notes")}
              placeholder={t("notes")}
              value={row.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
            />
            <Input
              aria-label={t("partialCredit")}
              placeholder={t("partialCredit")}
              value={row.partial_credit_rules}
              onChange={(e) => onChange({ partial_credit_rules: e.target.value })}
            />
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={row.form_matters}
                onChange={(e) => onChange({ form_matters: e.target.checked })}
              />
              {t("formMatters")}
            </label>
          </div>
        </details>
        {needsConfirm && (
          <label className="flex min-h-11 items-center gap-2 font-medium">
            <input
              type="checkbox"
              className="size-5"
              checked={row.teacher_confirmed}
              onChange={(e) => onChange({ teacher_confirmed: e.target.checked })}
            />
            {t("confirmRow")}
          </label>
        )}
      </CardContent>
    </Card>
  );
}

function SnapKey({ mode, onRows }: { mode: "key" | "blank"; onRows: (rows: ExtractedRow[]) => void }) {
  const t = useTranslations("assignments");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ExtractKeyResult | null>(null);
  const id = useId();
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <FieldHint>{mode === "key" ? t("snapKeyHint") : t("snapBlankHint")}</FieldHint>
        <form
          className="flex flex-col gap-3"
          action={(fd) => {
            fd.set("mode", mode);
            startTransition(async () => {
              const res = await extractAnswerKey(fd);
              setResult(res);
              if (res.ok) onRows(res.rows);
            });
          }}
        >
          <Label htmlFor={id}>{t("chooseImages")}</Label>
          <Input id={id} name="images" type="file" accept="image/*" capture="environment" multiple className="py-2" />
          <Button type="submit" disabled={pending}>
            <Camera aria-hidden /> {pending ? t("extracting") : t("extract")}
          </Button>
        </form>
        {result && !result.ok && <FieldError>{t(`extractErrors.${result.error}`)}</FieldError>}
      </CardContent>
    </Card>
  );
}

function FeedbackStep({
  feedback,
  setFeedback,
}: {
  feedback: FeedbackSettings;
  setFeedback: React.Dispatch<React.SetStateAction<FeedbackSettings>>;
}) {
  const t = useTranslations("assignments");
  const set = <K extends keyof FeedbackSettings>(k: K, v: FeedbackSettings[K]) =>
    setFeedback((f) => ({ ...f, [k]: v }));
  const preview = feedback;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="style">{t("feedbackStyle")}</Label>
            <Select
              id="style"
              value={feedback.style}
              onChange={(e) => set("style", e.target.value as FeedbackSettings["style"])}
            >
              {FEEDBACK_STYLES.map((s) => (
                <option key={s} value={s}>
                  {t(`styles.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="tone">{t("tone")}</Label>
              <Select
                id="tone"
                value={feedback.tone}
                onChange={(e) => set("tone", e.target.value as FeedbackSettings["tone"])}
              >
                {(["warm", "neutral", "direct"] as const).map((x) => (
                  <option key={x} value={x}>
                    {t(`tones.${x}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="length">{t("length")}</Label>
              <Select
                id="length"
                value={feedback.length}
                onChange={(e) => set("length", e.target.value as FeedbackSettings["length"])}
              >
                {(["short", "medium", "long"] as const).map((x) => (
                  <option key={x} value={x}>
                    {t(`lengths.${x}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {(
            [
              ["show_score", "showScore"],
              ["show_correct_answers", "showAnswers"],
              ["practice_item", "practiceItem"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={feedback[k]}
                onChange={(e) => set(k, e.target.checked)}
              />
              {t(label)}
            </label>
          ))}
        </CardContent>
      </Card>
      <Card aria-labelledby="preview-title">
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="preview-title" className="font-serif text-2xl">
              {t("previewTitle")}
            </h2>
            <span className="rounded-full border border-rule px-2 py-0.5 text-xs text-ink-muted">
              {t("previewExample")}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium text-pen-green">{t("glows")}</p>
            <p className="flex gap-2">
              <Check aria-hidden className="mt-1 size-4 shrink-0 text-pen-green" />
              {t("previewGlow")}
            </p>
          </div>
          {preview.style !== "next_steps" && (
            <div>
              <p className="text-sm font-medium text-pen-red">{t("grows")}</p>
              <p>{preview.style === "socratic" ? t("previewQuestion") : t("previewGrow")}</p>
              {preview.length !== "short" && preview.style !== "socratic" && (
                <p className="text-ink-muted">{t("previewHow")}</p>
              )}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-pen-blue">{t("nextStep")}</p>
            <p>{t("previewNext")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
