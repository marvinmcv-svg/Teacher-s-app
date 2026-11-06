"use client";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Label, Select } from "@/components/ui/input";
import { setBlindCheckRate } from "@/lib/actions/calibration";

export function BlindCheckRate({ initial }: { initial: number }) {
  const t = useTranslations("settings");
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="blind-rate">{t("blindRate")}</Label>
        <Select
          id="blind-rate"
          value={value}
          disabled={pending}
          className="w-auto"
          onChange={(e) => {
            const v = Number(e.target.value);
            setValue(v);
            setSaved(false);
            start(async () => setSaved((await setBlindCheckRate(v)).ok));
          }}
        >
          {[0, 5, 10, 20].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? t("blindOff") : t("blindPct", { pct: n })}
            </option>
          ))}
        </Select>
      </div>
      <span role="status" className="text-sm text-ink-muted">
        {saved ? t("saved") : ""}
      </span>
    </div>
  );
}
