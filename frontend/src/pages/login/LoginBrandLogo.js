import { LkHeaderBrandMark } from "../lk/LkHeaderBrandMark";

/** Тот же знак, что в шапке ЛК (Group 17: LUMO + Referrals). */
export function LoginBrandLogo({ className } = {}) {
  return (
    <LkHeaderBrandMark
      className={["login-page__brand-logo", className].filter(Boolean).join(" ")}
    />
  );
}
