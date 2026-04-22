import { Link, useParams } from "react-router-dom";
import "../dashboard/dashboard.css";
import "../partner/partner.css";
import "./owner-programs.css";

export default function ProjectPlaceholderPage({ title, body }) {
  const { sitePublicId } = useParams();
  return (
    <div className="lk-dashboard lk-partner owner-programs__shell">
      <h2 className="lk-partner__section-title">{title}</h2>
      <p className="owner-programs__muted" style={{ maxWidth: 520 }}>
        {body ||
          "Этот раздел появится в следующих итерациях. Пока используйте «Обзор» и «Виджет» в меню проекта."}
      </p>
      <p className="lk-partner__muted" style={{ marginTop: 12, fontSize: 12 }}>
        Site <code>{sitePublicId}</code>
      </p>
      <p style={{ marginTop: 16 }}>
        <Link to={`/lk/partner/${sitePublicId}/overview`} className="owner-programs__tab">
          К обзору проекта
        </Link>
      </p>
    </div>
  );
}
