"use client";
import { Copy, FileDown, Image as ImageIcon, MessageCircle, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { releaseSubmissions, revokeRelease } from "@/lib/actions/release";

export function ReleaseControls({
  submissionIds,
  names,
}: {
  submissionIds: string[];
  names: { id: string; name: string }[];
}) {
  const t = useTranslations("release");
  const router = useRouter();
  const [expiry, setExpiry] = useState<string>("90");
  const [pending, start] = useTransition();
  const release = (ids: string[]) =>
    start(async () => {
      await releaseSubmissions({ submissionIds: ids, expiresInDays: expiry === "never" ? null : Number(expiry) });
      router.refresh();
    });
  if (!submissionIds.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="expiry">{t("expiry")}</Label>
          <Select id="expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-44">
            {["7", "30", "90", "365"].map((d) => (
              <option key={d} value={d}>
                {t("expiryDays", { days: Number(d) })}
              </option>
            ))}
            <option value="never">{t("expiryNever")}</option>
          </Select>
        </div>
        <Button size="lg" disabled={pending} onClick={() => release(submissionIds)}>
          <Send aria-hidden /> {pending ? t("releasing") : t("releaseAll")}
        </Button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {names.map((n) => (
          <li key={n.id}>
            <Button variant="outline" disabled={pending} onClick={() => release([n.id])}>
              {t("releaseOne")} · {n.name}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReleasedRow({
  submissionId,
  name,
  url,
  releaseId,
  viewed,
  title,
}: {
  submissionId: string;
  name: string;
  url: string;
  releaseId: string;
  viewed: boolean;
  title: string;
}) {
  const t = useTranslations("release");
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const wa = `https://wa.me/?text=${encodeURIComponent(t("whatsappText", { title, url }))}`;
  return (
    <li className="flex flex-wrap items-center gap-2 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name}</span>
        <span className="text-xs text-ink-muted">{viewed ? t("viewed") : t("notViewed")}</span>
      </span>
      <Button
        variant="outline"
        onClick={async () => {
          await navigator.clipboard?.writeText(url);
          setCopied(true);
        }}
        data-testid="copy-link"
        data-url={url}
      >
        <Copy aria-hidden /> {copied ? t("copied") : t("copyLink")}
      </Button>
      <Button asChild variant="ghost" size="icon" aria-label={t("whatsapp")} title={t("whatsapp")}>
        <a href={wa} target="_blank" rel="noopener noreferrer">
          <MessageCircle aria-hidden />
        </a>
      </Button>
      <Button asChild variant="ghost" size="icon" aria-label={t("pdf")} title={t("pdf")}>
        <a href={`/api/submissions/${submissionId}/annotated.pdf`} target="_blank" rel="noopener">
          <FileDown aria-hidden />
        </a>
      </Button>
      <Button asChild variant="ghost" size="icon" aria-label={t("png")} title={t("png")}>
        <a href={`/api/submissions/${submissionId}/annotated.png`} target="_blank" rel="noopener">
          <ImageIcon aria-hidden />
        </a>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("revoke")}
        title={t("revoke")}
        disabled={pending}
        onClick={() => start(async () => void ((await revokeRelease(releaseId)).ok && router.refresh()))}
      >
        <X aria-hidden />
      </Button>
    </li>
  );
}
