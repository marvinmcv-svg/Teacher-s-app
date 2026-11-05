"use client";
import { RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setStudentActive } from "@/lib/actions/classes";

type Student = { id: string; display_name: string; external_id: string | null };

export function StudentList({
  classId,
  active,
  inactive,
}: {
  classId: string;
  active: Student[];
  inactive: Student[];
}) {
  const t = useTranslations("roster");
  const [pending, startTransition] = useTransition();
  const [lastRemoved, setLastRemoved] = useState<Student | null>(null);

  function toggle(student: Student, makeActive: boolean) {
    startTransition(async () => {
      const res = await setStudentActive(student.id, classId, makeActive);
      if (res.ok) setLastRemoved(makeActive ? null : student);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {lastRemoved && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-paper px-3 py-2 text-sm">
          <span>{t("removed", { name: lastRemoved.display_name })}</span>
          <Button variant="link" onClick={() => toggle(lastRemoved, true)} disabled={pending}>
            {t("undo")}
          </Button>
        </div>
      )}
      {active.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
        <ol className="divide-y divide-rule" data-testid="student-list">
          {active.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3 py-1">
              <span className="tabular w-6 text-right text-sm text-ink-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{s.display_name}</span>
                {s.external_id && (
                  <span className="block text-xs text-ink-muted">{t("externalId", { id: s.external_id })}</span>
                )}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("remove", { name: s.display_name })}
                title={t("remove", { name: s.display_name })}
                disabled={pending}
                onClick={() => toggle(s, false)}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {inactive.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-ink-muted">
            {t("inactiveTitle")} ({inactive.length})
          </summary>
          <ul className="divide-y divide-rule">
            {inactive.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-1">
                <span className="truncate text-ink-muted">{s.display_name}</span>
                <Button variant="ghost" onClick={() => toggle(s, true)} disabled={pending}>
                  <RotateCcw aria-hidden /> {t("restore")}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
