import { Link } from "react-router-dom";
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
      ? "Вы уже участвуете в этой агентской программе."
      : "Вы подключились к агентской программе.";

  return (
    <div className="lk-dashboard__post-join" role="status">
      <p className="lk-dashboard__post-join-title">{intro}</p>
      <p className="lk-dashboard__post-join-site">{siteLabel}</p>
      <p className="lk-dashboard__post-join-next">
        Учёт участия идёт автоматически. Детали и материалы смотрите на сайте организатора.
      </p>
      <div className="lk-dashboard__post-join-links">
        <Link to={`/lk/referral-program/${sitePublicId}`} className="lk-dashboard__post-join-link">
          Открыть программу
        </Link>
        <Link to="/lk/programs" className="lk-dashboard__post-join-link lk-dashboard__post-join-link_secondary">
          К агентским программам
        </Link>
      </div>
      <button type="button" className="lk-dashboard__post-join-dismiss" onClick={onDismiss}>
        Понятно
      </button>
    </div>
  );
}
