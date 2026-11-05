"use client";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, Label, Textarea } from "@/components/ui/input";
import { addStudents, type AddStudentsState } from "@/lib/actions/classes";
import { cn } from "@/lib/utils";

type Mode = "paste" | "csv";

export function RosterImport({ classId }: { classId: string }) {
  const t = useTranslations("roster");
  const [mode, setMode] = useState<Mode>("paste");
  const [state, action, pending] = useActionState<AddStudentsState, FormData>(addStudents, { status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "added") formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <input type="hidden" name="class_id" value={classId} />
      <div role="tablist" aria-label={t("addTitle")} className="grid grid-cols-2 rounded-xl border border-rule p-1">
        {(["paste", "csv"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            aria-controls={`roster-${m}`}
            onClick={() => setMode(m)}
            className={cn(
              "min-h-11 rounded-lg text-sm font-medium",
              mode === m ? "bg-ink text-paper" : "text-ink-muted hover:text-ink",
            )}
          >
            {m === "paste" ? t("pasteTab") : t("csvTab")}
          </button>
        ))}
      </div>

      {mode === "paste" ? (
        <div id="roster-paste" role="tabpanel" className="flex flex-col gap-2">
          <Label htmlFor="roster_text">{t("pasteLabel")}</Label>
          <Textarea
            id="roster_text"
            name="roster_text"
            rows={8}
            placeholder={t("pastePlaceholder")}
            spellCheck={false}
          />
        </div>
      ) : (
        <div id="roster-csv" role="tabpanel" className="flex flex-col gap-2">
          <Label htmlFor="roster_file">{t("csvLabel")}</Label>
          <Input
            id="roster_file"
            name="roster_file"
            type="file"
            accept=".csv,text/csv,.txt,text/plain"
            className="py-2"
            aria-describedby="csv-hint"
          />
          <FieldHint id="csv-hint">{t("csvHint")}</FieldHint>
        </div>
      )}

      <div aria-live="polite" className="text-sm">
        {state.status === "added" && (
          <p className="text-pen-green" data-testid="roster-result">
            {t("added", { count: state.added })}
            {state.skipped > 0 && <span className="text-ink-muted"> {t("skipped", { count: state.skipped })}</span>}
          </p>
        )}
        {state.status === "nothing" && <p className="text-ink-muted">{t("nothingToAdd")}</p>}
        {state.status === "tooMany" && <FieldError>{t("tooMany", { max: state.max })}</FieldError>}
        {state.status === "error" && <FieldError>{t("addError")}</FieldError>}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? t("adding") : t("add")}
      </Button>
    </form>
  );
}
