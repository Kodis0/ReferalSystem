/**
 * Expected behaviour (public embed widget):
 * - After widget-config loads, all <form> in the document get a capture-phase submit listener
 *   and optional hidden ref field; submit triggers POST to lead ingest URL (keepalive fetch).
 * - Forms added later (e.g. Tilda) are discovered via MutationObserver subtree rescans.
 * - Each form element is wired at most once (no duplicate listeners on rescan).
 *
 * @jest-environment jsdom
 */

const fs = require("fs");
const path = require("path");

const widgetPath = path.join(__dirname, "../../public/widgets/referral-widget.v1.js");

async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

function createMockScript() {
  const el = document.createElement("script");
  el.dataset.rsApi = "https://api.example.com";
  el.dataset.rsSite = "00000000-0000-0000-0000-000000000001";
  el.dataset.rsKey = "pk_test_1";
  return el;
}

function runWidgetWithCurrentScript(mockScript) {
  const code = fs.readFileSync(widgetPath, "utf8");
  Object.defineProperty(document, "currentScript", {
    configurable: true,
    get() {
      return mockScript;
    },
  });
  try {
    // eslint-disable-next-line no-new-func
    new Function(code)();
  } finally {
    try {
      Reflect.deleteProperty(document, "currentScript");
    } catch (e) {
      /* ignore */
    }
  }
}

describe("referral-widget.v1.js", () => {
  let fetchMock;

  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = "";
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    delete global.rsReferralWidget;
  });

  /**
   * Single load: the widget registers a MutationObserver on document.body; loading the
   * script twice would register two observers (not expected in production embed).
   */
  it("wires forms added after config (MutationObserver) and attaches at most one submit listener per form", async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("widget-config")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              storage_key: "sk_test",
              lead_ingest_url: "https://api.example.com/public/v1/events/leads?site=x",
            }),
        });
      }
      if (String(url).includes("/events/leads")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });

    runWidgetWithCurrentScript(createMockScript());

    await flushMicrotasks();

    const first = document.createElement("form");
    first.id = "first";
    const in1 = document.createElement("input");
    in1.name = "email";
    in1.value = "a@b.co";
    first.appendChild(in1);
    document.body.appendChild(first);

    await flushMicrotasks();

    first.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flushMicrotasks();

    const second = document.createElement("form");
    const in2 = document.createElement("input");
    in2.name = "email";
    in2.value = "c@d.co";
    second.appendChild(in2);
    document.body.appendChild(second);

    await flushMicrotasks();

    first.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flushMicrotasks();

    const leadCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/public/v1/events/leads")
    );
    expect(leadCalls.length).toBe(2);
    expect(leadCalls[0][1]).toMatchObject({ method: "POST" });
    expect(leadCalls[1][1]).toMatchObject({ method: "POST" });
  });
});
