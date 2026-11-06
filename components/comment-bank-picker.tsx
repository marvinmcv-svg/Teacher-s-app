"use client";
import { BookMarked } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markCommentUsed, searchCommentBank, type BankComment } from "@/lib/actions/comments";

/** Quick-insert from the teacher's comment bank (§3.4). */
export function CommentBankPicker({ submissionId, onPick }: { submissionId: string; onPick: (text: string) => void }) {
  const t = useTranslations("bank");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<BankComment[] | null>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const id = setTimeout(async () => {
      const res = await searchCommentBank(submissionId, q);
      if (alive) setItems(res);
    }, 200);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [open, q, submissionId]);
  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <BookMarked aria-hidden /> {t("insert")}
      </Button>
      {open && (
        <div
          id={listId}
          className="absolute right-0 z-30 mt-1 flex w-80 max-w-[90vw] flex-col gap-2 rounded-xl border border-rule bg-card p-2 shadow-md"
        >
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            aria-label={t("search")}
          />
          {items === null ? (
            <p className="p-2 text-sm text-ink-muted">{t("loading")}</p>
          ) : items.length === 0 ? (
            <p className="p-2 text-sm text-ink-muted">{q ? t("noMatch") : t("empty")}</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="min-h-11 w-full rounded-lg px-2 py-1 text-left font-hand text-lg leading-snug hover:bg-paper"
                    onClick={() => {
                      onPick(c.text);
                      setOpen(false);
                      void markCommentUsed(c.id);
                    }}
                  >
                    {c.text}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
