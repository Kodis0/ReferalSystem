/**
 * Expected behaviour (public embed widget):
 * - Singleton guard: duplicate script execution does not register duplicate observers or fetches.
 * - After widget-config loads, all <form> in the document get capture-phase submit listener
 *   and optional hidden ref field; submit triggers POST to lead ingest URL (keepalive fetch).
 * - Forms added later (e.g. Tilda) are discovered via MutationObserver subtree rescans.
 * - Each form element is wired at most once (no duplicate listeners on rescan).
 * - Amount/product selectors resolve in form context first, not only globally.
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

describe("referral-widget.v1.js", () => {
  let fetchMock;

  beforeEach(() => {
    clearWidgetGlobals();
    sessionStorage.clear();
    document.body.innerHTML = "";
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    if (typeof window !== "undefined") window.fetch = fetchMock;
    try {
      window.history.replaceState({}, "", "https://example.com/");
    } catch (e) {
      /* ignore */
    }
  });

  afterEach(() => {
    clearWidgetGlobals();
  });

  it("singleton guard: second load does not fetch widget-config again", async () => {
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
      return Promise.reject(new Error("unexpected fetch: " + url));
    });

    const scriptTag = createMockScript();
    runWidgetWithCurrentScript(scriptTag);
    runWidgetWithCurrentScript(createMockScript());

    await flushWidgetReady();

    const configCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("widget-config"));
    expect(configCalls.length).toBe(1);
    expect(window.rsReferralWidget.v1.singletonSkipped).toBe(true);
  });

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

    await flushWidgetReady();

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

    second.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flushMicrotasks();

    const leadCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/public/v1/events/leads"),
    );
    expect(leadCalls.length).toBe(2);
    expect(leadCalls[0][1]).toMatchObject({ method: "POST" });
    expect(leadCalls[1][1]).toMatchObject({ method: "POST" });
  });

  it("includes amount and product_name from configured selectors in lead payload", async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("widget-config")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              storage_key: "sk_test",
              lead_ingest_url: "https://api.example.com/public/v1/events/leads?site=x",
              amount_selector: "#amt",
              currency: "RUB",
              product_name_selector: "#title",
            }),
        });
      }
      if (String(url).includes("/events/leads")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });

    const price = document.createElement("div");
    price.id = "amt";
    price.textContent = "1500.00";
    const title = document.createElement("div");
    title.id = "title";
    title.textContent = "Course A";
    document.body.appendChild(price);
    document.body.appendChild(title);

    runWidgetWithCurrentScript(createMockScript());
    await flushWidgetReady();

    const form = document.createElement("form");
    const in1 = document.createElement("input");
    in1.name = "email";
    in1.value = "a@b.co";
    form.appendChild(in1);
    document.body.appendChild(form);
    await flushMicrotasks();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/public/v1/events/leads"),
    );
    expect(leadCall).toBeTruthy();
    const body = JSON.parse(leadCall[1].body);
    expect(body.amount).toBe("1500.00");
    expect(body.currency).toBe("RUB");
    expect(body.product_name).toBe("Course A");
  });

  it("adds hidden order fields from configured selectors before form submit", async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("widget-config")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              storage_key: "sk_test",
              lead_ingest_url: "https://api.example.com/public/v1/events/leads?site=x",
              amount_selector: "#amt",
              product_name_selector: "#title",
            }),
        });
      }
      if (String(url).includes("/events/leads")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });

    const price = document.createElement("div");
    price.id = "amt";
    price.textContent = "79 р.";
    const title = document.createElement("div");
    title.id = "title";
    title.textContent = "Dining Chair";
    document.body.appendChild(price);
    document.body.appendChild(title);

    runWidgetWithCurrentScript(createMockScript());
    await flushWidgetReady();

    const form = document.createElement("form");
    const em = document.createElement("input");
    em.name = "email";
    em.value = "a@b.co";
    form.appendChild(em);
    document.body.appendChild(form);
    await flushMicrotasks();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    expect(form.querySelector('input[type="hidden"][name="sum"]').value).toBe("79");
    expect(form.querySelector('input[type="hidden"][name="product_name"]').value).toBe("Dining Chair");
  });

  it("adds hidden order sum from clicked Tilda product card", async () => {
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

    const card = document.createElement("div");
    card.className = "t776__content";
    const title = document.createElement("div");
    title.className = "js-product-name";
    title.textContent = "Dining Chair";
    const price = document.createElement("div");
    price.className = "js-product-price";
    price.textContent = "79";
    const buy = document.createElement("a");
    buy.className = "t776__btn_second";
    buy.href = "#order";
    buy.textContent = "Buy now";
    card.appendChild(title);
    card.appendChild(price);
    card.appendChild(buy);
    document.body.appendChild(card);

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "tilda" }));
    await flushWidgetReady();

    const form = document.createElement("form");
    form.id = "order";
    const em = document.createElement("input");
    em.name = "email";
    em.value = "a@b.co";
    form.appendChild(em);
    document.body.appendChild(form);
    await flushMicrotasks();

    buy.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    expect(form.querySelector('input[type="hidden"][name="sum"]').value).toBe("79");
    expect(form.querySelector('input[type="hidden"][name="product_name"]').value).toBe("Dining Chair");
  });

  it("adds hidden order sum from generic Tilda product blocks such as t922", async () => {
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

    const card = document.createElement("div");
    card.className = "t-col t922__card-container";
    const title = document.createElement("div");
    title.className = "t922__title js-product-name";
    title.textContent = "Traffic Hybrid Bike";
    const price = document.createElement("div");
    price.className = "t922__price-value js-product-price";
    price.textContent = "399";
    const oldPrice = document.createElement("div");
    oldPrice.className = "t922__price_old";
    oldPrice.textContent = "599";
    const buy = document.createElement("a");
    buy.className = "t-btn t922__btn";
    buy.href = "#order";
    buy.textContent = "BUY NOW";
    card.appendChild(title);
    card.appendChild(price);
    card.appendChild(oldPrice);
    card.appendChild(buy);
    document.body.appendChild(card);

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "tilda" }));
    await flushWidgetReady();

    buy.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const form = document.createElement("form");
    form.id = "order";
    const em = document.createElement("input");
    em.name = "email";
    em.value = "a@b.co";
    form.appendChild(em);
    document.body.appendChild(form);
    await flushMicrotasks();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    expect(form.querySelector('input[type="hidden"][name="sum"]').value).toBe("399");
    expect(form.querySelector('input[type="hidden"][name="product_name"]').value).toBe("Traffic Hybrid Bike");
  });

  it("resolves amount from nearest block context, not first global match", async () => {
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

    const blockA = document.createElement("div");
    blockA.className = "t-rec";
    const priceA = document.createElement("div");
    priceA.className = "js-price";
    priceA.textContent = "100";
    const formA = document.createElement("form");
    const emA = document.createElement("input");
    emA.name = "email";
    emA.value = "a@a.co";
    formA.appendChild(emA);
    blockA.appendChild(priceA);
    blockA.appendChild(formA);

    const blockB = document.createElement("div");
    blockB.className = "t-rec";
    const priceB = document.createElement("div");
    priceB.className = "js-price";
    priceB.textContent = "200";
    const formB = document.createElement("form");
    const emB = document.createElement("input");
    emB.name = "email";
    emB.value = "b@b.co";
    formB.appendChild(emB);
    blockB.appendChild(priceB);
    blockB.appendChild(formB);

    document.body.appendChild(blockA);
    document.body.appendChild(blockB);

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "tilda" }));
    await flushWidgetReady();

    formB.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/public/v1/events/leads"),
    );
    const body = JSON.parse(leadCall[1].body);
    expect(body.amount).toBe("200");
  });

  it("collects checkbox, radio, select, textarea; joins repeated names; ignores empty", async () => {
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

    runWidgetWithCurrentScript(createMockScript());
    await flushWidgetReady();

    const form = document.createElement("form");
    const t1 = document.createElement("input");
    t1.name = "title";
    t1.value = "  ";
    form.appendChild(t1);

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.name = "agree";
    cb.value = "yes";
    cb.checked = true;
    form.appendChild(cb);

    const r1 = document.createElement("input");
    r1.type = "radio";
    r1.name = "plan";
    r1.value = "a";
    const r2 = document.createElement("input");
    r2.type = "radio";
    r2.name = "plan";
    r2.value = "b";
    r2.checked = true;
    form.appendChild(r1);
    form.appendChild(r2);

    const ta = document.createElement("textarea");
    ta.name = "msg";
    ta.value = "hello";
    form.appendChild(ta);

    const sel = document.createElement("select");
    sel.name = "country";
    const o1 = document.createElement("option");
    o1.value = "ru";
    o1.text = "RU";
    o1.selected = true;
    sel.appendChild(o1);
    form.appendChild(sel);

    const dup = document.createElement("input");
    dup.name = "tag";
    dup.value = "one";
    form.appendChild(dup);
    const dup2 = document.createElement("input");
    dup2.name = "tag";
    dup2.value = "two";
    form.appendChild(dup2);

    document.body.appendChild(form);
    await flushMicrotasks();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/public/v1/events/leads"),
    );
    const body = JSON.parse(leadCall[1].body);
    expect(body.fields).not.toHaveProperty("title");
    expect(body.fields.agree).toBe("yes");
    expect(body.fields.plan).toBe("b");
    expect(body.fields.msg).toBe("hello");
    expect(body.fields.country).toBe("ru");
    expect(body.fields.tag).toBe("one, two");
  });

  it("infers email/phone/name from name-like hints and autocomplete", async () => {
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

    runWidgetWithCurrentScript(createMockScript());
    await flushWidgetReady();

    const form = document.createElement("form");
    const em = document.createElement("input");
    em.name = "field_123";
    em.setAttribute("autocomplete", "email");
    em.value = "x@y.co";
    form.appendChild(em);

    const ph = document.createElement("input");
    ph.name = "p1";
    ph.setAttribute("placeholder", "Телефон");
    ph.value = "+7 900 111-22-33";
    form.appendChild(ph);

    const nm = document.createElement("input");
    nm.name = "f";
    nm.setAttribute("aria-label", "Your full name");
    nm.value = "Ivan Petrov";
    form.appendChild(nm);

    document.body.appendChild(form);
    await flushMicrotasks();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/public/v1/events/leads"),
    );
    const body = JSON.parse(leadCall[1].body);
    expect(body.email).toBe("x@y.co");
    expect(body.phone).toBe("+7 900 111-22-33");
    expect(body.name).toBe("Ivan Petrov");
  });

  it("exposes adapter generic vs tilda via data-rs-platform", async () => {
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
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "tilda" }));
    await flushWidgetReady();
    expect(window.rsReferralWidget.v1.adapter).toBe("tilda");

    clearWidgetGlobals();
    fetchMock.mockClear();

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
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    runWidgetWithCurrentScript(createMockScript({ rsPlatform: "generic" }));
    await flushWidgetReady();
    expect(window.rsReferralWidget.v1.adapter).toBe("generic");
  });

  it("click on submit-like control sends lead; dedup suppresses duplicate with submit", async () => {
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

    runWidgetWithCurrentScript(createMockScript());
    await flushWidgetReady();

    const form = document.createElement("form");
    const em = document.createElement("input");
    em.name = "email";
    em.value = "e@e.co";
    form.appendChild(em);
    /* span.t-submit: Tilda-style control without jsdom's unimplemented form.submit() path */
    const btn = document.createElement("span");
    btn.className = "t-submit";
    btn.textContent = "Go";
    form.appendChild(btn);
    document.body.appendChild(form);
    await flushMicrotasks();

    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushMicrotasks();
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/public/v1/events/leads"),
    );
    expect(leadCalls.length).toBe(1);
  });

  it("debug logs only when debug is enabled", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    fetchMock.mockImplementation((url) => {
      if (String(url).includes("widget-config")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              lead_ingest_url: "https://api.example.com/public/v1/events/leads?site=x",
              debug: true,
            }),
        });
      }
      if (String(url).includes("/events/leads")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });

    runWidgetWithCurrentScript(createMockScript());
    await flushWidgetReady();

    const form = document.createElement("form");
    const em = document.createElement("input");
    em.name = "email";
    em.value = "a@b.co";
    form.appendChild(em);
    document.body.appendChild(form);
    await flushMicrotasks();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const rsLogs = logSpy.mock.calls.filter((c) => c[0] === "[rs-widget]");
    expect(rsLogs.length).toBeGreaterThan(0);

    logSpy.mockRestore();
    clearWidgetGlobals();
    fetchMock.mockClear();

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

    const logSpy2 = jest.spyOn(console, "log").mockImplementation(() => {});
    runWidgetWithCurrentScript(createMockScript());
    await flushWidgetReady();

    const form2 = document.createElement("form");
    const em2 = document.createElement("input");
    em2.name = "email";
    em2.value = "c@d.co";
    form2.appendChild(em2);
    document.body.appendChild(form2);
    await flushMicrotasks();

    form2.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const rsLogs2 = logSpy2.mock.calls.filter((c) => c[0] === "[rs-widget]");
    expect(rsLogs2.length).toBe(0);

    logSpy2.mockRestore();
  });

  it("omits amount when selector matches nothing; submit still succeeds", async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("widget-config")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              lead_ingest_url: "https://api.example.com/public/v1/events/leads?site=x",
              amount_selector: "#missing-el",
              currency: "USD",
            }),
        });
      }
      if (String(url).includes("/events/leads")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });

    runWidgetWithCurrentScript(createMockScript());
    await flushWidgetReady();

    const form = document.createElement("form");
    const in1 = document.createElement("input");
    in1.name = "email";
    in1.value = "z@y.co";
    form.appendChild(in1);
    document.body.appendChild(form);
    await flushMicrotasks();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushMicrotasks();

    const leadCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/public/v1/events/leads"),
    );
    expect(leadCall).toBeTruthy();
    const body = JSON.parse(leadCall[1].body);
    expect(body).not.toHaveProperty("amount");
    expect(body.currency).toBe("USD");
    expect(body.email).toBe("z@y.co");
  });

  it("sends lead_client_outcome follow-up when observe + report + Tilda success heuristic", async () => {
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("widget-config")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              lead_ingest_url: "https://api.example.com/public/v1/events/leads?site=x",
              observe_success: true,
              report_observed_outcome: true,
            }),
        });
      }
      if (String(url).includes("/events/leads")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ lead_event_id: 42, status: "ok", result: "created" }),
        });
      }
      return Promise.reject(new Error("unexpected fetch: " + url));
    });

    runWidgetWithCurrentScript(
      createMockScript({
        rsPlatform: "tilda",
        rsObserveSuccess: "1",
        rsReportObservedOutcome: "1",
      }),
    );
    await flushWidgetReady();

    const form = document.createElement("form");
    form.classList.add("js-send-form-success");
    const em = document.createElement("input");
    em.name = "email";
    em.value = "tilda@example.com";
    form.appendChild(em);
    document.body.appendChild(form);
    await flushMicrotasks();
    await flushMicrotasks();

    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushWidgetReady();

    const leadCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/public/v1/events/leads"),
    );
    const leadBodies = leadCalls.map((c) => JSON.parse(c[1].body));
    expect(leadBodies.some((b) => b.event === "lead_submitted")).toBe(true);
    const outcome = leadBodies.find((b) => b.event === "lead_client_outcome");
    expect(outcome).toBeTruthy();
    expect(outcome.lead_event_id).toBe(42);
    expect(outcome.client_observed_outcome).toBe("success_observed");
    expect(window.rsReferralWidget.v1.reportObservedOutcome).toBe(true);
  });
});
