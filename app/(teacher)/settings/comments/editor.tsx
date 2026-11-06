"use client";
import { Search, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldError, Input, Label, Select, Textarea } from "@/components/ui/input";
import { deleteBankComment, saveBankComment } from "@/lib/actions/comments";

type Row = {
  id: string;
  text: string;
  locale: "es" | "en";
  subject: string | null;
  tags: string[];
  uses: number;
  source: "teacher" | "ai_approved";
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function CommentBankEditor({ initial }: { initial: Row[] }) {
  const t = useTranslations("bank");
  const uiLocale = useLocale() as "es" | "en";
  const router = useRouter();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [rows, setRows] = useState(initial);
  const [draft, setDraft] = useState({ text: "", subject: "", tags: "", locale: uiLocale });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const allTags = useMemo(() => [...new Set(rows.flatMap((r) => r.tags))].sort(), [rows]);
  const visible = rows.filter(
    (r) =>
      (!q || fold(`${r.text} ${r.subject ?? ""} ${r.tags.join(" ")}`).includes(fold(q))) &&
      (!tag || r.tags.includes(tag)),
  );
  const parseTags = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="font-medium">{t("add")}</h2>
        <Textarea
          aria-label={t("text")}
          placeholder={t("text")}
          className="min-h-16 font-hand text-lg"
          value={draft.text}
          maxLength={300}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="bank-subject">{t("subject")}</Label>
            <Input
              id="bank-subject"
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bank-tags">{t("tags")}</Label>
            <Input
              id="bank-tags"
              value={draft.tags}
              placeholder={t("tagsHint")}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bank-locale">{t("language")}</Label>
            <Select
              id="bank-locale"
              value={draft.locale}
              onChange={(e) => setDraft({ ...draft, locale: e.target.value as "es" | "en" })}
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </Select>
          </div>
        </div>
        {error && <FieldError>{error}</FieldError>}
        <Button
          className="self-start"
          disabled={pending || draft.text.trim().length < 3}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await saveBankComment(null, {
                text: draft.text,
                locale: draft.locale,
                subject: draft.subject.trim() || null,
                tags: parseTags(draft.tags),
              });
              if (!res.ok) return setError(t(`errors.${res.error}`));
              setDraft({ ...draft, text: "", tags: "" });
              router.refresh();
            })
          }
        >
          {t("save")}
        </Button>
      </Card>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <Search aria-hidden className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            aria-label={t("search")}
            placeholder={t("search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select aria-label={t("tags")} value={tag} onChange={(e) => setTag(e.target.value)} className="w-auto">
          <option value="">{t("allTags")}</option>
          {allTags.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
      </div>

      {visible.length === 0 ? (
        <Card className="p-6 text-ink-muted">{rows.length ? t("noMatch") : t("empty")}</Card>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="comment-bank">
          {visible.map((r) => (
            <li key={r.id}>
              <Card className="flex flex-wrap items-start gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-hand text-xl leading-snug">{r.text}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span>{r.locale.toUpperCase()}</span>
                    {r.subject && <span>· {r.subject}</span>}
                    <span>· {t("uses", { count: r.uses })}</span>
                    {r.source === "ai_approved" && (
                      <span className="inline-flex items-center gap-1">
                        · <Sparkles aria-hidden className="size-3" /> {t("fromAi")}
                      </span>
                    )}
                    {r.tags.map((x) => (
                      <span key={x} className="rounded-full border border-rule px-2">
                        {x}
                      </span>
                    ))}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("delete")}
                  title={t("delete")}
                  onClick={() =>
                    start(async () => {
                      const res = await deleteBankComment(r.id);
                      if (res.ok) setRows((xs) => xs.filter((x) => x.id !== r.id));
                    })
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
