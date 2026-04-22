import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { parsePostJoinFromSearchParams } from "../../registration/postJoinNavigation";
import { PostJoinBanner } from "./postJoinBanner";
import { MyProgramsSection } from "./myProgramsSection";
import "./dashboard.css";

function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [postJoin, setPostJoin] = useState(null);

  const parsed = useMemo(
    () => parsePostJoinFromSearchParams(searchParams),
    [searchParams]
  );

  useEffect(() => {
    if (!parsed) {
      return;
    }
    setPostJoin(parsed);
    setSearchParams({}, { replace: true });
  }, [parsed, setSearchParams]);

  const dismissBanner = () => setPostJoin(null);

  return (
    <div className="lk-dashboard">
      {postJoin && (
        <PostJoinBanner
          outcome={postJoin.outcome}
          sitePublicId={postJoin.site_public_id}
          siteDisplayLabel={postJoin.site_display_label}
          onDismiss={dismissBanner}
        />
      )}

      <h1 className="lk-dashboard__title">Панель</h1>
      <p className="lk-dashboard__subtitle">
        Краткий обзор аккаунта и список агентских программ, к которым вы подключены.
      </p>

      <MyProgramsSection />
    </div>
  );
}

export default Dashboard;
