"use client";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";
import { setSubmissionStudent } from "@/lib/actions/capture";

/** Shows the student, or the name-reading suggestion as a confirm chip (§3.2), or a picker. */
export function SubmissionStudent({
  submissionId,
  studentId,
  suggested,
  roster,
}: {
  submissionId: string;
  studentId: string | null;
  suggested: { id: string; name: string } | null;
  roster: { id: string; display_name: string }[];
}) {
  const t = useTranslations("hub");
  const id = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState(false);
  const assign = (sid: string | null) =>
    start(async () => {
      const res = await setSubmissionStudent(submissionId, sid);
      setError(!res.ok);
    });
  const name = roster.find((s) => s.id === studentId)?.display_name;
  if (name) return <span className="font-medium">{name}</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggested ? (
        <>
          <span className="text-ink-muted">{t("suggested", { name: suggested.name })}</span>
          <Button variant="outline" disabled={pending} onClick={() => assign(suggested.id)} className="min-h-9">
            {t("confirm")}
          </Button>
        </>
      ) : (
        <span className="text-ink-muted">{t("unmatched")}</span>
      )}
      <label htmlFor={id} className="sr-only">
        {t("choose")}
      </label>
      <select
        id={id}
        disabled={pending}
        defaultValue=""
        onChange={(e) => e.target.value && assign(e.target.value)}
        className="min-h-9 rounded-lg border border-rule bg-card px-2 text-sm"
      >
        <option value="">{t("choose")}</option>
        {roster.map((s) => (
          <option key={s.id} value={s.id}>
            {s.display_name}
          </option>
        ))}
      </select>
      {error && <FieldError>{t("duplicateStudent")}</FieldError>}
    </div>
  );
}
