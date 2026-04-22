/**
 * Post-join query helpers (shared by registration redirect and dashboard banner).
 *
 * @jest-environment node
 */

import {
  buildPostJoinDashboardPath,
  formatSitePublicIdForDisplay,
  parsePostJoinFromSearchParams,
  resolvePostJoinSiteLabel,
} from "../pages/registration/postJoinNavigation";

describe("postJoinNavigation helpers", () => {
  it("buildPostJoinDashboardPath encodes site and outcome", () => {
    const sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(buildPostJoinDashboardPath(sid, "joined")).toBe(
      "/lk/dashboard?post_join=1&site=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&outcome=joined"
    );
    expect(buildPostJoinDashboardPath(sid, "already_joined")).toBe(
      "/lk/dashboard?post_join=1&site=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&outcome=already_joined"
    );
  });

  it("formatSitePublicIdForDisplay returns safe fingerprint", () => {
    expect(
      formatSitePublicIdForDisplay("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    ).toMatch(/Программа ·/);
  });

  it("parsePostJoinFromSearchParams validates UUID and outcome", () => {
    const p = new URLSearchParams(
      "post_join=1&site=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&outcome=joined"
    );
    expect(parsePostJoinFromSearchParams(p)).toEqual({
      site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      outcome: "joined",
    });
    expect(
      parsePostJoinFromSearchParams(
        new URLSearchParams("post_join=1&site=not-uuid&outcome=joined")
      )
    ).toBeNull();
    const p2 = new URLSearchParams(
      "post_join=1&site=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&outcome=already_joined"
    );
    expect(parsePostJoinFromSearchParams(p2)?.outcome).toBe("already_joined");
  });

  it("buildPostJoinDashboardPath adds optional site_label", () => {
    const sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const path = buildPostJoinDashboardPath(sid, "joined", "Мой магазин");
    const qs = path.includes("?") ? path.split("?")[1] : "";
    const sp = new URLSearchParams(qs);
    expect(sp.get("site_label")).toBe("Мой магазин");
  });

  it("parsePostJoinFromSearchParams reads site_label", () => {
    const sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const p = new URLSearchParams(
      `post_join=1&site=${sid}&outcome=joined&site_label=${encodeURIComponent(
        "shop.example"
      )}`
    );
    expect(parsePostJoinFromSearchParams(p)).toEqual({
      site_public_id: sid,
      outcome: "joined",
      site_display_label: "shop.example",
    });
  });

  it("resolvePostJoinSiteLabel prefers display label over UUID fingerprint", () => {
    const sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(resolvePostJoinSiteLabel("Store front", sid)).toBe("Store front");
    expect(resolvePostJoinSiteLabel("", sid)).toMatch(/Программа ·/);
    expect(resolvePostJoinSiteLabel(undefined, sid)).toMatch(/Программа ·/);
  });
});
