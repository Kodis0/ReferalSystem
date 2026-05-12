import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { API_ENDPOINTS } from "../../../config/api";
import "./admin.css";

function formatDateTime(value) {
  if (!value) return "—";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

function DetailRow({ label, children }) {
  return (
    <div className="lk-admin-user-detail__row">
      <span className="lk-admin-user-detail__row-label">{label}</span>
      <span className="lk-admin-user-detail__row-value">{children}</span>
    </div>
  );
}

export default function AdminProjectDetailPage() {
  const { projectId } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [project, setProject] = useState(null);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setNotFound(false);
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch {
        // ignore
      }
    }
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const token =
        typeof window !== "undefined" ? window.localStorage.getItem("access_token") : null;
      const res = await fetch(API_ENDPOINTS.adminProjectDetail(projectId), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        signal: controller.signal,
      });
      if (res.status === 404) {
        setNotFound(true);
        setProject(null);
        return;
      }
      if (!res.ok) {
        setError(res.status === 403 ? "Недостаточно прав" : "Не удалось загрузить проект");
        setProject(null);
        return;
      }
      const payload = await res.json().catch(() => null);
      setProject(payload || null);
    } catch (e) {
      if (e && e.name === "AbortError") return;
      setError("Сетевая ошибка, попробуйте позже");
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    return () => {
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [load]);

  const backLink = (
    <Link to="/admin-console/projects" className="lk-admin-user-detail__back">
      <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>К списку проектов</span>
    </Link>
  );

  if (loading) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-project-detail-title"
      >
        {backLink}
        <p className="lk-admin-users__muted">Загрузка…</p>
      </section>
    );
  }

  if (notFound) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-project-detail-title"
      >
        {backLink}
        <h1
          id="lk-admin-project-detail-title"
          className="lk-admin-cabinet__title"
        >
          Проект не найден
        </h1>
        <p className="lk-admin-users__muted">
          Проекта с идентификатором {projectId} нет в системе.
        </p>
      </section>
    );
  }

  if (error || !project) {
    return (
      <section
        className="lk-admin-user-detail"
        aria-labelledby="lk-admin-project-detail-title"
      >
        {backLink}
        <div className="lk-admin-users__error" role="alert">
          {error || "Не удалось загрузить проект"}
        </div>
      </section>
    );
  }

  const heading = project.name || `#${project.id}`;

  return (
    <section
      className="lk-admin-user-detail"
      aria-labelledby="lk-admin-project-detail-title"
    >
      {backLink}
      <header className="lk-admin-user-detail__header">
        <h1
          id="lk-admin-project-detail-title"
          className="lk-admin-cabinet__title"
        >
          {heading}
        </h1>
      </header>

      <div className="lk-admin-user-detail__cards">
        <article className="lk-admin-user-detail__card" aria-label="Основное">
          <h2 className="lk-admin-user-detail__card-title">Основное</h2>
          <DetailRow label="ID">{project.id}</DetailRow>
          <DetailRow label="Название">{project.name || "—"}</DetailRow>
          <DetailRow label="Описание">{project.description || "—"}</DetailRow>
          <DetailRow label="Создан">{formatDateTime(project.created_at)}</DetailRow>
          <DetailRow label="Обновлён">{formatDateTime(project.updated_at)}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Владелец">
          <h2 className="lk-admin-user-detail__card-title">Владелец</h2>
          <DetailRow label="Email">{project.owner_email || "—"}</DetailRow>
          <DetailRow label="public_id">{project.owner_public_id || "—"}</DetailRow>
          <DetailRow label="ФИО">{project.owner_fio || "—"}</DetailRow>
          <DetailRow label="Телефон">{project.owner_phone || "—"}</DetailRow>
        </article>

        <article className="lk-admin-user-detail__card" aria-label="Сайты">
          <h2 className="lk-admin-user-detail__card-title">Сайты</h2>
          <DetailRow label="Всего сайтов">
            {Number(project.sites_count) || 0}
          </DetailRow>
          <DetailRow label="Активных">
            {Number(project.active_sites_count) || 0}
          </DetailRow>
          <DetailRow label="Архивных">
            {Number(project.archived_sites_count) || 0}
          </DetailRow>
        </article>
      </div>
    </section>
  );
}
