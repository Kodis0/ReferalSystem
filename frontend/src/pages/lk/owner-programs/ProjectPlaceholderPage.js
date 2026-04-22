import { Link, useParams } from "react-router-dom";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";

export default function ProjectPlaceholderPage({ title, body }) {
  const { sitePublicId } = useParams();
  return (
    <div className="owner-programs__page">
      <h2 className="lk-partner__section-title">{title}</h2>
      <p className="owner-programs__muted" style={{ maxWidth: 520 }}>
        {body ||
          "Раздел в разработке. Используйте вкладки «Обзор» и «Виджет»."}
      </p>
      <p className="lk-partner__muted" style={{ marginTop: 12, fontSize: 12 }}>
        ID: <code>{sitePublicId}</code>
      </p>
      <p style={{ marginTop: 16 }}>
        <Link to={`/lk/partner/${sitePublicId}/overview`} className="owner-programs__tab">
          К обзору проекта
        </Link>
      </p>
    </div>
  );
}
