import { getSiteLifecycleStatus } from "./siteDisplay";

describe("getSiteLifecycleStatus", () => {
  it("maps active status to success", () => {
    expect(getSiteLifecycleStatus({ status: "active", widget_enabled: true })).toMatchObject({
      tone: "success",
      label: "Активен",
    });
  });

  it("maps verified status to a non-success ready state", () => {
    expect(getSiteLifecycleStatus({ status: "verified", widget_enabled: true })).toMatchObject({
      tone: "warning",
      label: "Готов к активации",
    });
  });

  it("maps draft status to a non-success draft state", () => {
    expect(getSiteLifecycleStatus({ status: "draft", widget_enabled: true })).toMatchObject({
      tone: "muted",
      label: "Черновик",
    });
  });

  it("keeps disabled widget out of success tone", () => {
    expect(getSiteLifecycleStatus({ status: "active", widget_enabled: false })).toMatchObject({
      tone: "muted",
      label: "Виджет выключен",
    });
  });

  it("does not treat found connection as active lifecycle", () => {
    expect(
      getSiteLifecycleStatus({
        status: "draft",
        widget_enabled: true,
        connection_check: { status: "found" },
        verification_status: "widget_seen",
      }),
    ).toMatchObject({
      tone: "muted",
      label: "Черновик",
    });
  });

  it("does not treat healthy integration as active lifecycle", () => {
    expect(
      getSiteLifecycleStatus({
        status: "verified",
        widget_enabled: true,
        integration_status: "healthy",
      }),
    ).toMatchObject({
      tone: "warning",
      label: "Готов к активации",
    });
  });
});
