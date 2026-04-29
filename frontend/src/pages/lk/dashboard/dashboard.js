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

      <MyProgramsSection />
    </div>
  );
}

export default Dashboard;
