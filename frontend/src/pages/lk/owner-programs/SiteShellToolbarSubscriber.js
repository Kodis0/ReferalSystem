import { useEffect } from "react";
import SiteShellWidgetActionsBar from "../widget-install/SiteShellWidgetActionsBar";
import { useSiteShellIntegrationActions } from "./useSiteShellIntegrationActions";

/**
 * Держит панель действий по сайту в шапке `SiteProjectLayout` на всех вкладках сайта
 * (дашборд, виджет, настройки, пользователи), не только на экране виджета.
 */
export default function SiteShellToolbarSubscriber({
  sitePublicId,
  projectId: projectIdProp,
  setSiteShellToolbar,
  reloadProjectEntry,
  buildProjectPath,
  projectEntry,
}) {
  const {
    loading,
    data,
    diag,
    widgetEnabled,
    verifyLoading,
    refreshBusy,
    deleteSiteBusy,
    saving,
    activateLoading,
    activateError,
    actionsRef,
  } = useSiteShellIntegrationActions({
    sitePublicId,
    projectIdProp,
    projectEntry,
    reloadProjectEntry,
    buildProjectPath,
    deleteContext: "shell",
  });

  useEffect(() => {
    if (typeof setSiteShellToolbar !== "function") {
      return undefined;
    }
    if (loading || !data) {
      setSiteShellToolbar(null);
      return undefined;
    }
    const lifecycleForToolbar = diag?.site_status || data?.status;
    setSiteShellToolbar(
      <>
        {activateError ? (
          <div className="owner-programs__site-shell-toolbar-alert" role="alert">
            {activateError}
          </div>
        ) : null}
        <SiteShellWidgetActionsBar
          actionsRef={actionsRef}
          deleteSiteBusy={deleteSiteBusy}
          verifyLoading={verifyLoading}
          refreshBusy={refreshBusy}
          lifecycleStatus={lifecycleForToolbar}
          widgetEnabled={widgetEnabled}
          toggleBusy={saving || activateLoading}
          variant="toolbar"
        />
      </>,
    );
    return () => setSiteShellToolbar(null);
  }, [
    activateLoading,
    activateError,
    data,
    deleteSiteBusy,
    diag?.site_status,
    loading,
    refreshBusy,
    saving,
    setSiteShellToolbar,
    verifyLoading,
    widgetEnabled,
    actionsRef,
  ]);

  return null;
}
