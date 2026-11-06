"use client";
import { EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError, Select } from "@/components/ui/input";
import { submitBlindCheck } from "@/lib/actions/calibration";
import { PageViewer, ScoreStepper } from "./page-viewer";
import type { ReviewData } from "./review-screen";

/**
 * Blind-check mode (§3.4): the teacher grades first. The server sent no AI
 * scores, rationale, confidence or AI pins for this paper; they appear after
 * the teacher's scores are saved, together with the agreement result.
 */
export function BlindCheck({ data }: { data: ReviewData }) {
  const t = useTranslations("review");
  const router = useRouter();
  const [scores, setScores] = useState<Record<string, { score: number; level: string | null } | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = data.items.every((i) => scores[i.id] !== undefined);
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-start gap-3 border-pen-blue p-4" role="note">
        <EyeOff aria-hidden className="mt-0.5 size-5 shrink-0 text-pen-blue" />
        <div>
          <p className="font-medium">{t("blindTitle")}</p>
          <p className="text-sm text-ink-muted">{t("blindBody")}</p>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-[55fr_45fr] lg:grid-cols-[60fr_40fr]">
        <div className="flex flex-col gap-4">
          {data.pages.map((p) => (
            <PageViewer
              key={p.id}
              page={p}
              pins={[]}
              lines={data.lines.filter((l) => l.pageId === p.id)}
              lowConfidenceKeys={new Set()}
              showTranscription={false}
              selectedPin={null}
              onSelectPin={() => {}}
              onAddNote={async () => {}}
              readOnly
            />
          ))}
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>{t("blindYourScores")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.items.map((item) => (
              <section
                key={item.id}
                aria-label={item.label}
                data-testid="blind-item"
                className="flex flex-col gap-2 rounded-xl border border-rule p-3"
              >
                <h3 className="font-medium">{item.label}</h3>
                {item.answer?.text && (
                  <p className="whitespace-pre-wrap rounded-lg bg-paper p-2 font-mono text-[13px]">
                    {item.answer.text}
                  </p>
                )}
                {item.levels ? (
                  <Select
                    aria-label={t("level")}
                    value={scores[item.id]?.level ?? ""}
                    onChange={(e) => {
                      const l = item.levels!.find((x) => x.label === e.target.value);
                      if (l) setScores((s) => ({ ...s, [item.id]: { score: l.points, level: l.label } }));
                    }}
                  >
                    <option value="">{t("blindPick")}</option>
                    {item.levels.map((l) => (
                      <option key={l.label} value={l.label}>
                        {l.label} · {l.points}
                      </option>
                    ))}
                  </Select>
                ) : scores[item.id] === undefined ? (
                  <Button
                    variant="outline"
                    className="self-start"
                    onClick={() => setScores((s) => ({ ...s, [item.id]: { score: item.max, level: null } }))}
                  >
                    {t("blindStart", { max: item.max })}
                  </Button>
                ) : (
                  <ScoreStepper
                    value={scores[item.id]!.score}
                    max={item.max}
                    label={`${t("score")} · ${item.label}`}
                    onChange={(v) => setScores((s) => ({ ...s, [item.id]: { score: v, level: null } }))}
                  />
                )}
              </section>
            ))}
            {error && <FieldError>{error}</FieldError>}
            <Button
              size="lg"
              disabled={!done || pending}
              data-testid="blind-submit"
              onClick={() =>
                start(async () => {
                  setError(null);
                  const res = await submitBlindCheck({
                    submissionId: data.submission.id,
                    scores: Object.fromEntries(Object.entries(scores).filter(([, v]) => v)) as Record<
                      string,
                      { score: number; level: string | null }
                    >,
                  });
                  if (!res.ok) return setError(t("blindFailed"));
                  router.refresh();
                })
              }
            >
              {t("blindReveal")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
