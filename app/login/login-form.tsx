"use client";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { sendMagicLink, signInWithGoogle, type MagicLinkState } from "@/lib/actions/auth";

function GoogleIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export function LoginForm({ next, errorKey }: { next: string; errorKey: "error" | "callbackError" | null }) {
  const t = useTranslations("login");
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <p role="status" className="flex items-start gap-3 text-pen-green">
        <Mail aria-hidden className="mt-0.5 size-5 shrink-0" />
        <span>{t("linkSent")}</span>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {errorKey && <FieldError>{t(errorKey)}</FieldError>}
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" variant="outline" size="lg" className="w-full">
          <GoogleIcon />
          {t("google")}
        </Button>
      </form>
      <div className="flex items-center gap-3 text-sm text-ink-muted" aria-hidden>
        <span className="h-px flex-1 bg-rule" />
        {t("or")}
        <span className="h-px flex-1 bg-rule" />
      </div>
      <form action={action} className="flex flex-col gap-3" noValidate>
        <input type="hidden" name="next" value={next} />
        <Label htmlFor="email">{t("emailLabel")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder={t("emailPlaceholder")}
          aria-invalid={state.status === "invalid" || undefined}
          aria-describedby={state.status === "invalid" || state.status === "error" ? "email-error" : undefined}
        />
        {state.status === "invalid" && <FieldError id="email-error">{t("invalidEmail")}</FieldError>}
        {state.status === "error" && <FieldError id="email-error">{t("error")}</FieldError>}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t("sending") : t("sendLink")}
        </Button>
      </form>
    </div>
  );
}
