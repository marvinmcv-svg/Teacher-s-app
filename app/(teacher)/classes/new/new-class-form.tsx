"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, FieldHint, Input, Label, Select } from "@/components/ui/input";
import { createClass, type CreateClassState } from "@/lib/actions/classes";

export function NewClassForm({ defaultLocale }: { defaultLocale: string }) {
  const t = useTranslations("classes");
  const [state, action, pending] = useActionState<CreateClassState, FormData>(createClass, { error: null });
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">{t("nameLabel")}</Label>
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          autoFocus
          placeholder={t("namePlaceholder")}
          aria-invalid={state.error === "nameRequired" || undefined}
          aria-describedby={state.error === "nameRequired" ? "name-error" : undefined}
        />
        {state.error === "nameRequired" && <FieldError id="name-error">{t("nameRequired")}</FieldError>}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="grade_level">{t("gradeLabel")}</Label>
          <Input id="grade_level" name="grade_level" maxLength={60} placeholder={t("gradePlaceholder")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="subject">{t("subjectLabel")}</Label>
          <Input id="subject" name="subject" maxLength={60} placeholder={t("subjectPlaceholder")} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="locale">{t("localeLabel")}</Label>
        <Select id="locale" name="locale" defaultValue={defaultLocale} aria-describedby="locale-hint">
          <option value="es" lang="es">
            Español
          </option>
          <option value="en" lang="en">
            English
          </option>
        </Select>
        <FieldHint id="locale-hint">{t("localeHint")}</FieldHint>
      </div>
      {state.error === "createError" && <FieldError>{t("createError")}</FieldError>}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t("creating") : t("create")}
      </Button>
    </form>
  );
}
