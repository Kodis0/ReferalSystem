/**
 * Shared helpers to execute referral-widget.v1.js in jsdom with a mocked currentScript.
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

/** fetch().then(r=>r.json()).then(...) needs extra ticks beyond Promise.resolve loops */
async function flushWidgetReady() {
  await flushMicrotasks();
  await new Promise((r) => {
    setTimeout(r, 0);
  });
  await flushMicrotasks();
}

function createMockScript(overrides = {}) {
  const el = document.createElement("script");
  el.dataset.rsApi = "https://api.example.com";
  el.dataset.rsSite = "00000000-0000-0000-0000-000000000001";
  el.dataset.rsKey = "pk_test_1";
  Object.assign(el.dataset, overrides);
  return el;
}

function clearWidgetGlobals() {
  try {
    delete global.rsReferralWidget;
  } catch (e) {
    /* ignore */
  }
  try {
    delete window.__rsReferralWidgetV1;
  } catch (e) {
    /* ignore */
  }
  try {
    if (window.__rsLeadFormMo && typeof window.__rsLeadFormMo.disconnect === "function") {
      window.__rsLeadFormMo.disconnect();
    }
    delete window.__rsLeadFormMo;
  } catch (e) {
    /* ignore */
  }
  try {
    delete window.tildaForm;
    delete window.tildastat;
    delete window.tildaBrowserLang;
  } catch (e) {
    /* ignore */
  }
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

module.exports = {
  widgetPath,
  flushMicrotasks,
  flushWidgetReady,
  createMockScript,
  clearWidgetGlobals,
  runWidgetWithCurrentScript,
};
