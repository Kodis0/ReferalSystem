/**
 * Tilda-oriented DOM scenarios: realistic markup fixtures + outcome heuristics (jsdom).
 * These complement referral-widget.v1.test.js happy-path checks.
 *
 * @jest-environment jsdom
 */

const {
  flushMicrotasks,
  flushWidgetReady,
  createMockScript,
  clearWidgetGlobals,
  runWidgetWithCurrentScript,
} = require("../test-utils/referral-widget-harness");
const {
  buildInlineFormWithPriceBlock,
  buildPopupForm,
  buildSuccessBox,
  buildErrorBox,
  el,
} = require("../test-utils/fixtures/tildaDomScenarios");

describe("Tilda-like runtime scenarios (fixtures)", () => {
  let fetchMock;

  beforeEach(() => {
    clearWidgetGlobals();
    sessionStorage.clear();
    document.body.innerHTML = "";
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    if (typeof window !== "undefined") window.fetch = fetchMock;
    try {
      window.history.replaceState({}, "", "https://example.com/page");
    } catch (e) {
      /* ignore */
    }
  });

  afterEach(() => {
    clearWidgetGlobals();
    jest.useRealTimers();
  });

  function defaultConfigFetch() {
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });
  }

  function configFetchWithObserveSuccess() {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("widget-config")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              storage_key: "sk_test",
              lead_ingest_url: "https://api.example.com/public/v1/events/leads?site=x",
              config: { observe_success: true },
            }),
        });
      }
      if (String(url).includes("/events/leads")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });
  }

  it("inline .t-rec: amount resolves from nearest .js-price (contextual)", async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("widget-config")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              lead_ingest_url: "https://api.example.com/public/v1/events/leads?site=x",
              amount_selector: ".js-price",
              currency: "RUB",
            }),
        });
      }
      if (String(url).includes("/events/leads")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });
    const { root, form } = buildInlineFormWithPriceBlock();
    document.body.appendChild(root);

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "tilda" }));
    await flushWidgetReady();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/events/leads"));
    const body = JSON.parse(leadCall[1].body);
    expect(body.amount).toBe("9990");
  });

  it("popup .t-popup: submit dispatches ingest", async () => {
    defaultConfigFetch();
    const { root, form } = buildPopupForm();
    document.body.appendChild(root);

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "tilda" }));
    await flushWidgetReady();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/events/leads"));
    expect(leadCalls.length).toBe(1);
  });

  it("delayed render: form inserted after load is wired once", async () => {
    defaultConfigFetch();
    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "tilda" }));
    await flushWidgetReady();

    const late = buildInlineFormWithPriceBlock();
    document.body.appendChild(late.root);
    await flushMicrotasks();

    late.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/events/leads"));
    expect(leadCalls.length).toBe(1);
  });

  it("multiple blocks: two forms → two POSTs", async () => {
    defaultConfigFetch();
    const a = buildInlineFormWithPriceBlock();
    const b = buildInlineFormWithPriceBlock();
    b.form.querySelector('[name="email"]').value = "second@example.com";
    document.body.appendChild(a.root);
    document.body.appendChild(b.root);

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "tilda" }));
    await flushWidgetReady();

    a.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    b.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/events/leads"));
    expect(leadCalls.length).toBe(2);
  });

  it("hidden block revealed: subtree appended after load (mutation adds form)", async () => {
    defaultConfigFetch();
    const holder = document.createElement("div");
    holder.className = "t-rec";
    holder.style.display = "none";
    document.body.appendChild(holder);

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "tilda" }));
    await flushWidgetReady();

    holder.style.display = "block";
    const block = buildInlineFormWithPriceBlock();
    holder.appendChild(block.root);
    await flushMicrotasks();

    block.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/events/leads"));
    expect(leadCalls.length).toBe(1);
  });

  it("outcome: js-send-form-success on form → site_form_success_observed", async () => {
    configFetchWithObserveSuccess();
    const wrap = el("div", "t-form");
    const form = el("form", "");
    const em = document.createElement("input");
    em.type = "text";
    em.name = "email";
    em.value = "cls@example.com";
    form.appendChild(em);
    wrap.appendChild(form);
    document.body.appendChild(wrap);

    runWidgetWithCurrentScript(
      createMockScript({
        rsPlatform: "tilda",
        rsObserveSuccess: "1",
      }),
    );
    await flushWidgetReady();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.classList.add("js-send-form-success");
    await flushMicrotasks();

    const stages = window.rsReferralWidget.v1.getTrace().map((x) => x.stage);
    expect(stages).toContain("site_form_success_observed");
  });

  it("outcome: .t-form__successbox appears → site_form_success_observed in trace", async () => {
    configFetchWithObserveSuccess();
    const wrap = el("div", "t-form");
    const form = el("form", "");
    const em = document.createElement("input");
    em.type = "text";
    em.name = "email";
    em.value = "ok@example.com";
    form.appendChild(em);
    wrap.appendChild(form);
    document.body.appendChild(wrap);

    runWidgetWithCurrentScript(
      createMockScript({
        rsPlatform: "tilda",
        rsObserveSuccess: "1",
      }),
    );
    await flushWidgetReady();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    wrap.appendChild(buildSuccessBox("Спасибо"));
    await flushMicrotasks();

    const stages = window.rsReferralWidget.v1.getTrace().map((x) => x.stage);
    expect(stages).toContain("site_form_success_observed");
  });

  it("outcome: .t-form__errorbox with text → site_form_failure_observed", async () => {
    configFetchWithObserveSuccess();
    const wrap = el("div", "t-form");
    const form = el("form", "");
    const em = document.createElement("input");
    em.type = "text";
    em.name = "email";
    em.value = "bad";
    form.appendChild(em);
    wrap.appendChild(form);
    document.body.appendChild(wrap);

    runWidgetWithCurrentScript(
      createMockScript({
        rsPlatform: "tilda",
        rsObserveSuccess: "1",
      }),
    );
    await flushWidgetReady();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    wrap.appendChild(buildErrorBox("Invalid email"));
    await flushMicrotasks();

    const stages = window.rsReferralWidget.v1.getTrace().map((x) => x.stage);
    expect(stages).toContain("site_form_failure_observed");
  });

  it("outcome: no markers within window → site_form_success_not_observed", async () => {
    configFetchWithObserveSuccess();
    const wrap = el("div", "t-form");
    const form = el("form", "");
    const em = document.createElement("input");
    em.type = "text";
    em.name = "email";
    em.value = "x@y.co";
    form.appendChild(em);
    wrap.appendChild(form);
    document.body.appendChild(wrap);

    runWidgetWithCurrentScript(
      createMockScript({
        rsPlatform: "tilda",
        rsObserveSuccess: "1",
      }),
    );
    await flushWidgetReady();

    await flushWidgetReady();

    jest.useFakeTimers();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    jest.advanceTimersByTime(9000);
    await flushMicrotasks();
    jest.useRealTimers();

    const trace = window.rsReferralWidget.v1.getTrace();
    const notObs = trace.find((x) => x.stage === "site_form_success_not_observed");
    expect(notObs).toBeTruthy();
    expect(notObs.detail.reason).toBe("no_confirmation_within_window");
  });

  it("getTrace is empty when neither debug nor observe-success", async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("widget-config")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              lead_ingest_url: "https://api.example.com/public/v1/events/leads?site=x",
            }),
        });
      }
      if (String(url).includes("/events/leads")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });

    const wrap = el("div", "t-form");
    const form = el("form", "");
    const em = document.createElement("input");
    em.type = "text";
    em.name = "email";
    em.value = "a@b.co";
    form.appendChild(em);
    wrap.appendChild(form);
    document.body.appendChild(wrap);

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "tilda" }));
    await flushWidgetReady();

    expect(window.rsReferralWidget.v1.getTrace().length).toBe(0);

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    expect(window.rsReferralWidget.v1.getTrace().length).toBe(0);
  });

  it("generic adapter + observe-success: heuristic layer skipped (trace reason)", async () => {
    configFetchWithObserveSuccess();
    const form = el("form", "");
    const em = document.createElement("input");
    em.type = "text";
    em.name = "email";
    em.value = "g@example.com";
    form.appendChild(em);
    document.body.appendChild(form);

    runWidgetWithCurrentScript(
      createMockScript({
        rsPlatform: "generic",
        rsObserveSuccess: "1",
      }),
    );
    await flushWidgetReady();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const row = window.rsReferralWidget.v1
      .getTrace()
      .find((x) => x.stage === "site_form_success_not_observed");
    expect(row).toBeTruthy();
    expect(row.detail.reason).toBe("outcome_heuristics_skipped_non_tilda_adapter");
  });

  it("filters optional fields by public capture_config", async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("widget-config")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              lead_ingest_url: "https://api.example.com/public/v1/events/leads?site=x",
              capture_config: { enabled_optional_fields: ["email"] },
            }),
        });
      }
      if (String(url).includes("/events/leads")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });

    const form = document.createElement("form");
    const name = document.createElement("input");
    name.name = "name";
    name.value = "Alice";
    const email = document.createElement("input");
    email.name = "email";
    email.value = "alice@example.com";
    const phone = document.createElement("input");
    phone.name = "phone";
    phone.value = "+79001112233";
    form.appendChild(name);
    form.appendChild(email);
    form.appendChild(phone);
    document.body.appendChild(form);

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "generic" }));
    await flushWidgetReady();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/events/leads"));
    const body = JSON.parse(leadCall[1].body);
    expect(body.email).toBe("alice@example.com");
    expect(body.name).toBe("");
    expect(body.phone).toBe("");
    expect(body.fields).toEqual({ email: "alice@example.com" });
  });
});
