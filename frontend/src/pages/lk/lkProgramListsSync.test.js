import { dispatchLumorefSiteStatusChanged, LUMOREF_SITE_STATUS_CHANGED_EVENT } from "./lkProgramListsSync";

describe("dispatchLumorefSiteStatusChanged", () => {
  it("dispatches current site status payload", () => {
    const handler = jest.fn();
    window.addEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, handler);

    dispatchLumorefSiteStatusChanged({
      public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      status: "active",
      widget_enabled: true,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual({
      site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      site_status: "active",
      widget_enabled: true,
      program_active: true,
    });

    window.removeEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, handler);
  });

  it("marks disabled widget as inactive in event payload", () => {
    const handler = jest.fn();
    window.addEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, handler);

    dispatchLumorefSiteStatusChanged({
      site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      site_status: "active",
      widget_enabled: false,
    });

    expect(handler.mock.calls[0][0].detail).toMatchObject({
      site_status: "active",
      widget_enabled: false,
      program_active: false,
    });

    window.removeEventListener(LUMOREF_SITE_STATUS_CHANGED_EVENT, handler);
  });
});
