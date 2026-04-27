import { ReactComponent as LumoGroup14BrandSvg } from "../../static/images/LumoGroup14Brand.svg";

/** Логотип в шапке облака входа/регистрации (анимация точки на букве U — см. login.css). */
export function LoginBrandLogo() {
  return (
    <LumoGroup14BrandSvg
      className="login-page__brand-logo"
      aria-hidden
      focusable="false"
    />
  );
}
