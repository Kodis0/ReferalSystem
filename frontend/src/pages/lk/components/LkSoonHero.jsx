import "../dashboard/dashboard.css";
import "./lkSoonHeroDashboard.css";

/**
 * Hero в стиле баннера «Мои программы» для разделов SOON в ЛК (только текст, без карточек).
 */
export default function LkSoonHero({
  bannerTitle = "Раздел в разработке",
  bannerSub = "Мы активно ведём работу над этим блоком. В скором времени здесь появятся новые возможности личного кабинета.",
}) {
  return (
    <div className="lk-dashboard__programs-catalog-hero-collapse lk-dashboard__programs-catalog-hero-collapse--open lk-soon-hero-dashboard">
      <div className="lk-dashboard__programs-catalog-hero-collapse-sizer">
        <div className="lk-dashboard__my-programs-hero-stack">
          <div
            className="lk-dashboard__my-programs-catalog-banner lk-dashboard__programs-catalog-hero"
            data-testid="lk-soon-hero-banner"
          >
            <div className="lk-dashboard__my-programs-catalog-banner-inner">
              <div className="lk-dashboard__my-programs-catalog-banner-copy">
                <p className="lk-dashboard__my-programs-catalog-banner-title">{bannerTitle}</p>
                <p className="lk-dashboard__my-programs-catalog-banner-sub">{bannerSub}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
