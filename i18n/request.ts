import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, isLocale, negotiateLocale } from "@/lib/i18n/config";

// UI locale: explicit cookie (set from the language switcher / teacher
// profile) → Accept-Language → Spanish. No locale prefix in URLs: the teacher
// app is behind auth and links are shared per student, not per language.
// An explicit locale (getTranslations({ locale })) always wins — the student
// view renders in the student's feedback language, whoever opens the link.
export default getRequestConfig(async ({ locale: explicit }) => {
  let locale;
  if (isLocale(explicit)) locale = explicit;
  else {
    const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
    locale = isLocale(cookieLocale) ? cookieLocale : negotiateLocale((await headers()).get("accept-language"));
  }
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
