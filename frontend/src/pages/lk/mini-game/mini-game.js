import "../bug/bug.css";
import "../dashboard/dashboard.css";
import BlockBlastGame from "./BlockBlastGame";
import miniGameChallengeBanner from "../../../static/images/mini-game-daily-challenge-banner.png";

export default function MiniGamePage() {
  return (
    <div className="lk-simple-page">
      <div
        className="lk-dashboard__my-programs-catalog-banner lk-dashboard__my-programs-catalog-banner--mini-game"
        data-testid="mini-game-challenge-banner"
      >
        <div className="lk-dashboard__my-programs-catalog-banner-inner">
          <div className="lk-dashboard__my-programs-catalog-banner-copy">
            <p className="lk-dashboard__my-programs-catalog-banner-title">Челлендж</p>
            <p className="lk-dashboard__my-programs-catalog-banner-sub">
              Собирайте линии, зарабатывайте XP и поднимайтесь в рейтинге. У вас 5 жизней: каждый раунд тратит одну,
              новая жизнь восстанавливается каждые 4 часа.
            </p>
          </div>
          <div className="lk-dashboard__my-programs-catalog-banner-art" aria-hidden="true">
            <img src={miniGameChallengeBanner} alt="" decoding="async" />
          </div>
        </div>
      </div>

      <section id="mini-game-play" aria-label="Мини игра">
        <BlockBlastGame />
      </section>
    </div>
  );
}
