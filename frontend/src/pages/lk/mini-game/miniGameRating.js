import "../bug/bug.css";
import "../dashboard/dashboard.css";
import "./miniGameRating.css";
import { DiamondIcon } from "./DiamondIcon";

/** Демо (без API), в одном духе с таблицей в BlockBlastGame. */
const MINI_GAME_RATING_MOCK = [
  { rank: 1, name: "Участник A", score: 2840 },
  { rank: 2, name: "Участник B", score: 2510 },
  { rank: 3, name: "Участник C", score: 2185 },
  { rank: 4, name: "Участник D", score: 1960 },
  { rank: 5, name: "Участник E", score: 1742 },
];

export default function MiniGameRatingPage() {
  return (
    <div className="lk-simple-page">
      <h1 className="lk-simple-page__title" id="mini-game-rating-heading">
        Рейтинг
      </h1>
      <p className="mini-game-rating__note">Демо-данные, без синхронизации с сервером.</p>
      <div className="mini-game-rating__panel" role="region" aria-label="Таблица рейтинга">
        <div className="lk-header__menu mini-game-rating__menu" role="list">
          {MINI_GAME_RATING_MOCK.map((row) => (
            <div
              key={row.rank}
              className="lk-header__menu-item mini-game-rating__row"
              role="listitem"
            >
              <span className="mini-game-rating__rank" aria-label={`Место ${row.rank}`}>
                {row.rank <= 3 ? (
                  <DiamondIcon
                    className={`mini-game-rating__diamond mini-game-rating__diamond--${row.rank}`}
                    size={18}
                    strokeWidth={2}
                  />
                ) : (
                  row.rank
                )}
              </span>
              <span className="lk-header__menu-item-text">{row.name}</span>
              <span className="mini-game-rating__score">{row.score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
