import { formatActivateConflictMessage } from "./useSiteShellIntegrationActions";

describe("formatActivateConflictMessage", () => {
  it("when widget was seen but embed_readiness.widget_enabled is false, explains LK toggle — not missing script", () => {
    const msg = formatActivateConflictMessage(
      {
        code: "site_not_ready_for_activate",
        detail: "site_not_ready_for_activate",
        embed_readiness: {
          origins_configured: true,
          widget_enabled: false,
          publishable_key_present: true,
          public_id_present: true,
        },
      },
      { last_widget_seen_at: "2026-01-01T00:00:00Z" },
    );
    expect(msg).toContain("выключен в настройках");
  });

  it("does not use that copy when last_widget_seen_at is absent", () => {
    const msg = formatActivateConflictMessage(
      {
        code: "site_not_ready_for_activate",
        detail: "site_not_ready_for_activate",
        embed_readiness: { widget_enabled: false },
      },
      {},
    );
    expect(msg).not.toContain("выключен в настройках");
  });
});
