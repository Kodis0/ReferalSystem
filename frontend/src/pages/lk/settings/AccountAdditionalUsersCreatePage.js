import { Link } from "react-router-dom";
import "./settings.css";

/** Заглушка: полный сценарий создания доп. пользователя подключим отдельно. */
export default function AccountAdditionalUsersCreatePage() {
  return (
    <div className="lk-settings" data-testid="account-additional-user-create-stub">
      <section className="lk-settings__section" aria-labelledby="lk-settings-create-additional-user-heading">
        <h1 className="lk-settings__section-title" id="lk-settings-create-additional-user-heading">
          Дополнительный пользователь
        </h1>
        <p className="lk-settings__muted">
          Создание отдельной учётной записи с авторизацией в рамках вашего аккаунта будет доступно здесь позже.
        </p>
        <div className="lk-settings__account-users-create-wrap">
          <Link className="lk-settings__account-users-create-btn" to="/lk/settings">
            Назад к настройкам
          </Link>
        </div>
      </section>
    </div>
  );
}
