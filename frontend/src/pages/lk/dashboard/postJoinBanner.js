import {
  resolvePostJoinSiteLabel,
} from "../../registration/postJoinNavigation";
import "./dashboard.css";

/**
 * @param {{ outcome: "joined"|"already_joined", sitePublicId: string, siteDisplayLabel?: string, onDismiss: () => void }} props
 */
export function PostJoinBanner({ outcome, sitePublicId, siteDisplayLabel, onDismiss }) {
  const siteLabel = resolvePostJoinSiteLabel(siteDisplayLabel, sitePublicId);
  const intro =
    outcome === "already_joined"
      ? "Вы уже участвуете в программе этой площадки."
      : "Вы успешно присоединились к программе.";

  return (
    <div className="lk-dashboard__post-join" role="status">
      <p className="lk-dashboard__post-join-title">{intro}</p>
      <p className="lk-dashboard__post-join-site">{siteLabel}</p>
      <p className="lk-dashboard__post-join-next">
        Дальше можно пользоваться панелью — участие учитывается автоматически. Вернитесь на
        сайт организатора, когда будете готовы.
      </p>
      <button type="button" className="lk-dashboard__post-join-dismiss" onClick={onDismiss}>
        Понятно
      </button>
    </div>
  );
}
