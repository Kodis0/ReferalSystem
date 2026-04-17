/**
 * ReferralSystem embed widget (v1) — production-oriented capture, Tilda-aware.
 *
 * Embed (values from Django admin → Site; script is served with the SPA build):
 *   <script src="https://lumoref.ru/widgets/referral-widget.v1.js"
 *     data-rs-api="https://api.lumoref.ru"
 *     data-rs-site="SITE_PUBLIC_UUID"
 *     data-rs-key="SITE_PUBLISHABLE_KEY"
 *     async></script>
 *
 * Optional: data-rs-debug="1" — safe verbose logging (no field values).
 * Optional: data-rs-observe-success="1" — DOM outcome heuristics (Tilda-oriented; not proof of conversion).
 * Optional: data-rs-report-observed-outcome="1" — POST client-observed outcome follow-ups (requires observe; not proof of conversion).
 * Optional: data-rs-platform="tilda"|"generic" — override auto platform detection.
 * URL: ?rs_widget_debug=1 | ?rs_observe_success=1 | ?rs_report_observed_outcome=1 (same semantics as data-* flags).
 *
 * Behaviour: reads ?ref=, persists ref, adds hidden ref to forms, POSTs lead_submitted
 * on native form submit (does not block Tilda / default form handling). If the platform
 * submits via JS without dispatching submit, a conservative click fallback on
 * submit-like controls still records one lead per user action (deduped with submit).
 * Late / popup / dynamic DOM: MutationObserver + debounced rescans; each form wired once.
 *
 * Layers: bootstrap → platform adapter → form discovery / wiring → field extraction →
 * contextual selectors → transport. Internal stages are separated for future success UX.
 *
 * Backend: rows stay ``submit_attempt`` / ``submission_stage=submit_attempt``; optional
 * ``lead_client_outcome`` follow-up records client-heuristic observations separately.
 */
(function () {
  "use strict";

  var doc = document;
  var wiredForms = new WeakSet();
  /** Latest widget-config JSON; set when fetch resolves so POST uses current selectors. */
  var lastResolvedWidgetConfig = null;
  var runtimeDebugEnabled = false;
  /** When true: record outcome trace + optional Tilda DOM success/failure heuristics (still not guaranteed). */
  var observeSuccessEnabled = false;
  /** When true: send optional ``lead_client_outcome`` POST after ingest (site config / flag; heuristic only). */
  var reportObservedOutcomeEnabled = false;
  var resolvedAdapterId = "generic";
  var TRACE_MAX = 80;
  var traceBuffer = [];
  /** Public API object (filled at end; updated when widget-config resolves). */
  var publicApi = null;

  var script = doc.currentScript;
  if (!script || !script.dataset) return;

  var apiBase = (script.dataset.rsApi || "").replace(/\/+$/, "");
  var siteId = script.dataset.rsSite || "";
  var publishableKey = script.dataset.rsKey || "";
  if (!apiBase || !siteId || !publishableKey) return;

  var GUARD_KEY = "__rsReferralWidgetV1";
  var w = typeof window !== "undefined" ? window : null;

  function readDebugFromUrl() {
    try {
      var u = new URL(window.location.href);
      return u.searchParams.get("rs_widget_debug") === "1";
    } catch (e) {
      return false;
    }
  }

  function readObserveSuccessFromUrl() {
    try {
      var u = new URL(window.location.href);
      return u.searchParams.get("rs_observe_success") === "1";
    } catch (e) {
      return false;
    }
  }

  function scriptDebugFlag() {
    var d = script.dataset && script.dataset.rsDebug;
    return d === "1" || d === "true" || d === "yes";
  }

  function scriptObserveSuccessFlag() {
    var d = script.dataset && script.dataset.rsObserveSuccess;
    return d === "1" || d === "true" || d === "yes";
  }

  function applyDebugFlags() {
    runtimeDebugEnabled = scriptDebugFlag() || readDebugFromUrl();
  }

  function applyObserveSuccessBootstrap() {
    observeSuccessEnabled = scriptObserveSuccessFlag() || readObserveSuccessFromUrl();
  }

  function readReportObservedOutcomeFromUrl() {
    try {
      var u = new URL(window.location.href);
      return u.searchParams.get("rs_report_observed_outcome") === "1";
    } catch (e) {
      return false;
    }
  }

  function scriptReportObservedOutcomeFlag() {
    var d = script.dataset && script.dataset.rsReportObservedOutcome;
    return d === "1" || d === "true" || d === "yes";
  }

  function applyReportObservedOutcomeBootstrap() {
    reportObservedOutcomeEnabled =
      scriptReportObservedOutcomeFlag() || readReportObservedOutcomeFromUrl();
  }

  applyDebugFlags();
  applyObserveSuccessBootstrap();
  applyReportObservedOutcomeBootstrap();

  /** Runtime / outcome stages (local; optional extension fields for ingest later). */
  var OUTCOME = {
    SUBMIT_ATTEMPT_DETECTED: "submit_attempt_detected",
    INGEST_REQUESTED: "ingest_requested",
    INGEST_ACCEPTED: "ingest_accepted",
    INGEST_FAILED: "ingest_failed",
    SITE_FORM_SUCCESS_OBSERVED: "site_form_success_observed",
    SITE_FORM_SUCCESS_NOT_OBSERVED: "site_form_success_not_observed",
    SITE_FORM_FAILURE_OBSERVED: "site_form_failure_observed",
    CLIENT_OUTCOME_REPORT_REQUESTED: "client_outcome_report_requested",
    CLIENT_OUTCOME_REPORT_ACCEPTED: "client_outcome_report_accepted",
    CLIENT_OUTCOME_REPORT_FAILED: "client_outcome_report_failed",
  };

  function shouldCaptureTrace() {
    return runtimeDebugEnabled || observeSuccessEnabled;
  }

  function sanitizeTraceDetail(d) {
    var out = {};
    if (!d || typeof d !== "object") return out;
    var allow = [
      "formId",
      "adapter",
      "status",
      "ok",
      "reason",
      "heuristic",
      "marker",
      "fieldCount",
      "url",
      "idx",
      "id",
      "windowMs",
      "leadEventId",
      "outcome",
    ];
    for (var i = 0; i < allow.length; i++) {
      var k = allow[i];
      if (Object.prototype.hasOwnProperty.call(d, k) && d[k] != null && d[k] !== "") out[k] = d[k];
    }
    return out;
  }

  function pushTrace(stage, detail) {
    if (!shouldCaptureTrace()) return;
    var row = { t: Date.now(), stage: stage, detail: sanitizeTraceDetail(detail || {}) };
    traceBuffer.push(row);
    if (traceBuffer.length > TRACE_MAX) traceBuffer.shift();
    if (runtimeDebugEnabled) dbg(stage, row.detail);
  }

  function syncPublicApi() {
    if (!publicApi) return;
    try {
      publicApi.debug = runtimeDebugEnabled;
      publicApi.observeSuccess = observeSuccessEnabled;
      publicApi.reportObservedOutcome = reportObservedOutcomeEnabled;
    } catch (e) {}
  }

  function resolveObserveSuccessFromWidgetConfig(cfg) {
    if (scriptObserveSuccessFlag() || readObserveSuccessFromUrl()) return true;
    if (!cfg || typeof cfg !== "object") return false;
    var nested = cfg.config && typeof cfg.config === "object" ? cfg.config : {};
    var v = nested.observe_success != null ? nested.observe_success : cfg.observe_success;
    if (v === true) return true;
    var s = String(v == null ? "" : v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }

  function resolveReportObservedOutcomeFromWidgetConfig(cfg) {
    if (scriptReportObservedOutcomeFlag() || readReportObservedOutcomeFromUrl()) return true;
    if (!cfg || typeof cfg !== "object") return false;
    if (cfg.report_observed_outcome === true) return true;
    var nested = cfg.config && typeof cfg.config === "object" ? cfg.config : {};
    var v = nested.report_observed_outcome != null ? nested.report_observed_outcome : cfg.report_observed_outcome;
    if (v === true) return true;
    var s = String(v == null ? "" : v).trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes";
  }

  function makeClientOutcomeEventId(gen) {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return "rsoc_" + crypto.randomUUID();
      }
    } catch (e) {}
    return "rsoc_" + gen + "_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  function dbg() {
    if (!runtimeDebugEnabled || typeof console === "undefined" || !console.log) return;
    var args = ["[rs-widget]"];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    try {
      console.log.apply(console, args);
    } catch (e) {}
  }

  /** Second script tag / duplicate execution: do not register observers or fetch again. */
  if (w && w[GUARD_KEY] && w[GUARD_KEY].initialized) {
    dbg("skip: already initialized (singleton guard)");
    try {
      w.rsReferralWidget = w.rsReferralWidget || {};
      w.rsReferralWidget.v1 = w.rsReferralWidget.v1 || {};
      w.rsReferralWidget.v1.singletonSkipped = true;
    } catch (e) {}
    return;
  }

  if (w) {
    w[GUARD_KEY] = {
      initialized: true,
      version: 1,
      siteId: siteId,
      at: Date.now(),
    };
  }

  var PLATFORMS = { TILDA: "tilda", GENERIC: "generic" };

  function detectPlatform() {
    var ov = (script.dataset && script.dataset.rsPlatform) || "";
    ov = String(ov).trim().toLowerCase();
    if (ov === "tilda" || ov === "generic") return ov;
    var win = typeof window !== "undefined" ? window : null;
    if (win && (win.tildaForm || win.tildastat || win.tildaBrowserLang)) return PLATFORMS.TILDA;
    return PLATFORMS.GENERIC;
  }

  /**
   * Platform adapters influence container resolution, submit-like detection, and scan roots.
   * They share most behaviour; differences are real (especially Tilda block/popup DOM).
   */
  function createPlatformAdapter(platformId) {
    var isTilda = platformId === PLATFORMS.TILDA;

    function nearestLogicalContainer(form) {
      if (!form || form.nodeType !== 1) return null;
      if (isTilda) {
        var t =
          form.closest(".t-form") ||
          form.closest(".t-popup__container") ||
          form.closest(".t-popup") ||
          form.closest(".t396__carrier") ||
          form.closest(".t396__artboard") ||
          form.closest(".r") ||
          form.closest(".t-rec");
        if (t) return t;
      }
      return (
        form.closest("section") ||
        form.closest("[role='dialog']") ||
        form.closest(".modal") ||
        form.parentElement
      );
    }

    function getOutcomeScanRoot(form) {
      var base = nearestLogicalContainer(form) || form;
      if (isTilda) {
        try {
          var pop = form.closest(".t-popup");
          if (pop) return pop;
        } catch (e) {}
      }
      return base;
    }

    function isSubmitLikeControl(el, form) {
      if (!el || el.nodeType !== 1 || !form.contains(el)) return false;
      if ("disabled" in el && el.disabled) return false;
      var tag = el.tagName;
      if (tag === "INPUT") {
        var it = String(el.type || "").toLowerCase();
        return it === "submit" || it === "image";
      }
      if (tag === "BUTTON") {
        var bt = String(el.getAttribute("type") || "").toLowerCase();
        if (bt === "button" || bt === "reset") return false;
        return true;
      }
      if (el.classList && el.classList.contains("t-submit")) return true;
      if (typeof el.className === "string" && /\bt-submit\b/.test(el.className)) return true;
      return false;
    }

    return {
      id: platformId,
      nearestLogicalContainer: nearestLogicalContainer,
      getOutcomeScanRoot: getOutcomeScanRoot,
      /** Tilda: DOM markers documented in help / exported pages; generic: no heuristic layer. */
      outcomeHeuristicMode: isTilda ? "tilda" : "none",
      isSubmitLikeControl: isSubmitLikeControl,
    };
  }

  function onReady(fn) {
    if (doc.readyState !== "loading") {
      fn();
      return;
    }
    var done = false;
    function runOnce() {
      if (done) return;
      done = true;
      doc.removeEventListener("DOMContentLoaded", runOnce);
      fn();
    }
    doc.addEventListener("DOMContentLoaded", runOnce);
    if (typeof setTimeout !== "undefined") {
      setTimeout(function () {
        if (doc.readyState !== "loading") runOnce();
      }, 0);
    }
  }

  function storageSet(key, val) {
    try {
      sessionStorage.setItem(key, val);
    } catch (e) {}
  }

  function storageGet(key) {
    try {
      return sessionStorage.getItem(key) || "";
    } catch (e) {
      return "";
    }
  }

  function readUrlRef() {
    try {
      var u = new URL(window.location.href);
      return u.searchParams.get("ref") || "";
    } catch (e) {
      return "";
    }
  }

  function resolveRef(storageKey) {
    var fromQuery = readUrlRef();
    if (fromQuery) {
      storageSet(storageKey, fromQuery);
      return fromQuery;
    }
    return storageGet(storageKey);
  }

  function trimStr(s) {
    return String(s == null ? "" : s).replace(/^\s+|\s+$/g, "");
  }

  function shouldSkipControl(el) {
    if (!el || !el.name) return true;
    if ("disabled" in el && el.disabled) return true;
    var tag = el.tagName;
    var typ = String(el.type || "").toLowerCase();
    if (tag === "INPUT") {
      if (typ === "file" || typ === "password") return true;
      if (typ === "submit" || typ === "image" || typ === "button" || typ === "reset") return true;
    }
    if (tag === "BUTTON") return true;
    if (tag === "FIELDSET") return true;
    return false;
  }

  function mergeFieldValue(store, name, value) {
    var v = trimStr(value);
    if (!v) return;
    if (!Object.prototype.hasOwnProperty.call(store, name)) {
      store[name] = v;
      return;
    }
    var cur = store[name];
    if (cur === v) return;
    store[name] = cur + ", " + v;
  }

  /**
   * Collect scalar string fields only (backend normalizes dict fields to flat strings;
   * arrays/objects would be dropped server-side).
   */
  function collectFormFields(form) {
    var out = {};
    var els = form.elements;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el || !el.name || shouldSkipControl(el)) continue;
      if (el.type === "hidden" && el.name === "ref") continue;

      var tag = el.tagName;
      var typ = String(el.type || "").toLowerCase();

      if (tag === "SELECT") {
        if (el.multiple) {
          var opts = el.options;
          var parts = [];
          for (var oi = 0; oi < opts.length; oi++) {
            if (opts[oi].selected) {
              var ov = trimStr(opts[oi].value);
              if (ov) parts.push(ov);
            }
          }
          if (parts.length) mergeFieldValue(out, el.name, parts.join(", "));
        } else {
          var sv = el.value != null ? String(el.value) : "";
          mergeFieldValue(out, el.name, sv);
        }
        continue;
      }

      if (tag === "TEXTAREA") {
        mergeFieldValue(out, el.name, el.value != null ? String(el.value) : "");
        continue;
      }

      if (tag === "INPUT") {
        if (typ === "checkbox") {
          if (el.checked) {
            var cv = el.value != null && trimStr(el.value) ? String(el.value) : "on";
            mergeFieldValue(out, el.name, cv);
          }
          continue;
        }
        if (typ === "radio") {
          if (el.checked) mergeFieldValue(out, el.name, el.value != null ? String(el.value) : "");
          continue;
        }
        mergeFieldValue(out, el.name, el.value != null ? String(el.value) : "");
      }
    }
    return out;
  }

  function controlHints(el) {
    var parts = [];
    if (el.name) parts.push(el.name);
    var typ = el.type ? String(el.type).toLowerCase() : "";
    if (typ) parts.push(typ);
    var ac = el.getAttribute && el.getAttribute("autocomplete");
    if (ac) parts.push(ac);
    var ph = el.getAttribute && el.getAttribute("placeholder");
    if (ph) parts.push(ph);
    var ar = el.getAttribute && el.getAttribute("aria-label");
    if (ar) parts.push(ar);
    try {
      if (el.labels && el.labels.length) {
        var lt = el.labels[0].textContent || "";
        if (lt) parts.push(lt.replace(/\s+/g, " ").trim());
      }
    } catch (e) {}
    return parts.join(" ").toLowerCase();
  }

  function pickFirstValue(form, names) {
    for (var i = 0; i < names.length; i++) {
      var el = form.elements[names[i]];
      if (!el) continue;
      if (el.length && !el.options && el.type !== "select-one" && el.type !== "select-multiple") {
        for (var j = 0; j < el.length; j++) {
          var node = el[j];
          if (node && (node.type === "radio" || node.type === "checkbox")) {
            if (node.checked && "value" in node && trimStr(node.value)) return String(node.value);
          } else if (node && "value" in node && trimStr(node.value)) {
            return String(node.value);
          }
        }
        continue;
      }
      if ("value" in el && trimStr(el.value)) return String(el.value);
    }
    return "";
  }

  function inferFromHints(form, re) {
    var els = form.querySelectorAll("input, textarea, select");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (shouldSkipControl(el)) continue;
      var h = controlHints(el);
      if (re.test(h)) {
        if (el.type === "checkbox" && !el.checked) continue;
        if (el.type === "radio" && !el.checked) continue;
        if ("value" in el && trimStr(el.value)) return trimStr(el.value);
      }
    }
    return "";
  }

  function inferEmail(form, fields) {
    var e = pickFirstValue(form, ["email", "Email", "E-mail", "E-Mail", "mail"]);
    if (e) return e;
    var inp = form.querySelector('input[type="email"]');
    if (inp && "value" in inp && trimStr(inp.value)) return trimStr(inp.value);
    e = inferFromHints(form, /e-mail|email|почт|mail/);
    if (e) return e;
    for (var k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k) && /email|e-mail|mail/i.test(k) && fields[k])
        return fields[k];
    }
    return "";
  }

  function inferPhone(form, fields) {
    var p = pickFirstValue(form, ["phone", "Phone", "tel", "Tel", "Mobile", "mobile", "telephone"]);
    if (p) return p;
    var inp = form.querySelector('input[type="tel"]');
    if (inp && "value" in inp && trimStr(inp.value)) return trimStr(inp.value);
    p = inferFromHints(form, /phone|tel|mobile|телефон|мобильн/);
    if (p) return p;
    for (var k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k) && /phone|tel|mobile|telephone/i.test(k) && fields[k])
        return fields[k];
    }
    return "";
  }

  function inferName(form, fields) {
    var n = pickFirstValue(form, ["name", "Name", "fullname", "Fullname", "full_name", "customer_name"]);
    if (n) return n;
    n = inferFromHints(form, /^name$|\bname\b|имя|фио|fullname|full_name|first_name|last_name/);
    if (n) return n;
    for (var k in fields) {
      if (Object.prototype.hasOwnProperty.call(fields, k) && /^name$/i.test(k) && fields[k]) return fields[k];
    }
    return "";
  }

  function ensureHiddenRef(form, ref) {
    if (!ref) return;
    var fieldName = "ref";
    if (form.querySelector('input[type="hidden"][name="' + fieldName + '"]')) return;
    var inp = doc.createElement("input");
    inp.type = "hidden";
    inp.name = fieldName;
    inp.value = ref;
    form.appendChild(inp);
  }

  function siteLeadSelectors(cfg) {
    var c = (cfg && cfg.config) || {};
    return {
      amountSelector: (cfg && cfg.amount_selector) || c.amount_selector || "",
      currency: (cfg && cfg.currency) || c.currency || "",
      productNameSelector:
        (cfg && cfg.product_name_selector) || c.product_name_selector || "",
    };
  }

  function querySelectorScoped(selector, roots) {
    if (!selector || typeof selector !== "string") return null;
    var s = selector.trim();
    if (!s) return null;
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (!root || root.nodeType !== 1) continue;
      try {
        if (root.matches && root.matches(s)) return root;
      } catch (e) {}
      try {
        var el = root.querySelector(s);
        if (el) return el;
      } catch (e) {}
    }
    return null;
  }

  function getSelectorSearchRoots(form, adapter) {
    var roots = [];
    var seen = new WeakSet();
    function add(r) {
      if (!r || r.nodeType !== 1) return;
      try {
        if (seen.has(r)) return;
        seen.add(r);
      } catch (e) {
        return;
      }
      roots.push(r);
    }

    add(form);
    var logical = adapter.nearestLogicalContainer(form);
    add(logical);

    var p = form.parentElement;
    var depth = 0;
    while (p && depth < 6) {
      add(p);
      p = p.parentElement;
      depth++;
    }
    add(doc.body || doc.documentElement);

    try {
      if (logical && logical.parentElement) add(logical.parentElement);
    } catch (e) {}

    return roots;
  }

  function readDomValueFromElement(el) {
    if (!el) return "";
    if ("value" in el) {
      var vv = el.value;
      if (vv != null && trimStr(String(vv))) return trimStr(String(vv));
    }
    var t = el.textContent != null ? String(el.textContent) : "";
    return t.replace(/\s+/g, " ").trim();
  }

  function readDomBySelectorInContext(selector, form, adapter) {
    if (!selector || typeof selector !== "string") return "";
    var roots = getSelectorSearchRoots(form, adapter);
    var el = querySelectorScoped(selector.trim(), roots);
    if (!el) {
      try {
        el = doc.querySelector(selector.trim());
      } catch (e) {
        el = null;
      }
    }
    var val = readDomValueFromElement(el);
    dbg("selector resolve", { selector: selector, found: !!el, adapter: adapter.id });
    return val;
  }

  /** Pipeline stages (local only; not sent to API). */
  var STAGE = {
    FOUND: "form_found",
    ARMED: "form_armed",
    SUBMIT_ATTEMPT: "submit_attempt",
    PAYLOAD_BUILT: "payload_built",
    INGEST_REQUEST: "ingest_request",
  };

  var OUTCOME_OBSERVE_MS = 8000;

  function flushBufferedOutcomeReport(form, ingestUrl) {
    if (!reportObservedOutcomeEnabled || !observeSuccessEnabled) return;
    if (!form) return;
    var buf = form._rsBufferedOutcome;
    var lid = form._rsLeadEventIdForOutcome;
    if (!buf || lid == null) return;
    if (form._rsOutcomeReportSentForGen === buf.gen) return;
    form._rsOutcomeReportSentForGen = buf.gen;
    postClientOutcome(ingestUrl, lid, buf.kind, buf.detail, buf.eventId);
    form._rsBufferedOutcome = null;
  }

  function postClientOutcome(ingestUrl, leadEventId, kind, detail, clientEventId) {
    var code =
      kind === "success"
        ? "success_observed"
        : kind === "failure"
          ? "failure_observed"
          : "not_observed";
    var source = "tilda_dom_heuristic";
    var reason = "";
    if (detail && typeof detail === "object" && detail.reason) {
      reason = String(detail.reason);
    }
    var payload = {
      event: "lead_client_outcome",
      lead_event_id: leadEventId,
      client_observed_outcome: code,
      client_outcome_source: source,
      client_outcome_reason: reason.slice(0, 255),
      client_event_id: clientEventId || "",
    };
    pushTrace(OUTCOME.CLIENT_OUTCOME_REPORT_REQUESTED, { leadEventId: leadEventId, outcome: code });
    dbg("client outcome report", { leadEventId: leadEventId, outcome: code });
    fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Publishable-Key": publishableKey,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then(function (r) {
        if (r && r.ok) {
          pushTrace(OUTCOME.CLIENT_OUTCOME_REPORT_ACCEPTED, { ok: true, status: r.status });
        } else {
          pushTrace(OUTCOME.CLIENT_OUTCOME_REPORT_FAILED, { ok: false, status: r ? r.status : 0 });
        }
      })
      .catch(function () {
        pushTrace(OUTCOME.CLIENT_OUTCOME_REPORT_FAILED, { ok: false, reason: "network" });
      });
  }

  function isVisibleEl(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      if (doc.body && !doc.body.contains(el)) return false;
    } catch (e) {}
    try {
      var st = doc.defaultView && doc.defaultView.getComputedStyle(el);
      if (st) {
        if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
      }
    } catch (e2) {}
    try {
      if (el.getBoundingClientRect) {
        var r = el.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) {
          /* jsdom / headless often reports 0×0 for unlaid-out boxes; for heuristic markers, trust non-empty text. */
          return trimStr(el.textContent || "").length > 0;
        }
      }
    } catch (e3) {}
    return true;
  }

  function tildaSuccessCandidates(root) {
    var out = [];
    if (!root || root.nodeType !== 1) return out;
    var sel = [".t-form__successbox", ".js-successbox"];
    for (var i = 0; i < sel.length; i++) {
      try {
        var n = root.querySelector(sel[i]);
        if (n) out.push(n);
      } catch (e) {}
    }
    return out;
  }

  function tildaFailureCandidates(root) {
    var out = [];
    if (!root || root.nodeType !== 1) return out;
    var sel = [".t-form__errorbox", ".js-errorbox", ".js-errorbox-all"];
    for (var i = 0; i < sel.length; i++) {
      try {
        var n = root.querySelector(sel[i]);
        if (n) out.push(n);
      } catch (e) {}
    }
    try {
      var errs = root.querySelectorAll(".t-input-error");
      for (var j = 0; j < errs.length; j++) out.push(errs[j]);
    } catch (e2) {}
    return out;
  }

  function scanTildaFormOutcome(form, root) {
    /* Form-level classes: do not rely on textContent/bbox (inputs are not in textContent; jsdom layout is weak). */
    if (
      form &&
      form.classList &&
      form.classList.contains("js-send-form-success") &&
      doc.body &&
      doc.body.contains(form)
    ) {
      return { kind: "success", marker: "form.js-send-form-success", heuristic: true };
    }
    if (
      form &&
      form.classList &&
      form.classList.contains("js-send-form-error") &&
      doc.body &&
      doc.body.contains(form)
    ) {
      return { kind: "failure", marker: "form.js-send-form-error", heuristic: true };
    }
    if (!root || root.nodeType !== 1) return null;
    var fc = tildaFailureCandidates(root);
    for (var b = 0; b < fc.length; b++) {
      if (isVisibleEl(fc[b]) && trimStr(fc[b].textContent || "").length > 0) {
        return { kind: "failure", marker: "tilda_errorbox_or_input_error", heuristic: true };
      }
    }
    var sc = tildaSuccessCandidates(root);
    for (var a = 0; a < sc.length; a++) {
      if (isVisibleEl(sc[a])) return { kind: "success", marker: "tilda_successbox", heuristic: true };
    }
    return null;
  }

  function beginOutcomeObservation(form, adapter, ingestUrl) {
    if (!observeSuccessEnabled) return;
    if (!adapter || adapter.outcomeHeuristicMode !== "tilda") {
      pushTrace(OUTCOME.SITE_FORM_SUCCESS_NOT_OBSERVED, {
        reason: "outcome_heuristics_skipped_non_tilda_adapter",
        adapter: adapter && adapter.id,
        heuristic: true,
      });
      return;
    }
    var root = adapter.getOutcomeScanRoot ? adapter.getOutcomeScanRoot(form) : form;
    var formId = form.id || form.getAttribute("name") || "";
    var gen = (form._rsOutcomeGen || 0) + 1;
    form._rsOutcomeGen = gen;
    try {
      if (form._rsOutcomeMo && typeof form._rsOutcomeMo.disconnect === "function") {
        form._rsOutcomeMo.disconnect();
      }
      if (form._rsOutcomeTimer && typeof clearTimeout !== "undefined") {
        clearTimeout(form._rsOutcomeTimer);
        form._rsOutcomeTimer = null;
      }
    } catch (e) {}

    var settled = false;
    function finish(kind, detail) {
      if (settled) return;
      settled = true;
      try {
        if (form._rsOutcomeMo && typeof form._rsOutcomeMo.disconnect === "function") form._rsOutcomeMo.disconnect();
      } catch (e2) {}
      form._rsOutcomeMo = null;
      if (form._rsOutcomeTimer && typeof clearTimeout !== "undefined") {
        clearTimeout(form._rsOutcomeTimer);
        form._rsOutcomeTimer = null;
      }
      if (kind === "success") pushTrace(OUTCOME.SITE_FORM_SUCCESS_OBSERVED, detail);
      else if (kind === "failure") pushTrace(OUTCOME.SITE_FORM_FAILURE_OBSERVED, detail);
      else pushTrace(OUTCOME.SITE_FORM_SUCCESS_NOT_OBSERVED, detail);
      if (reportObservedOutcomeEnabled && observeSuccessEnabled) {
        var eid = makeClientOutcomeEventId(gen);
        form._rsBufferedOutcome = { gen: gen, kind: kind, detail: detail || {}, eventId: eid };
        flushBufferedOutcomeReport(form, ingestUrl);
      }
    }

    function scan() {
      if (gen !== form._rsOutcomeGen) return;
      var res = scanTildaFormOutcome(form, root);
      if (!res) return;
      if (res.kind === "success") {
        finish("success", {
          formId: formId,
          reason: "dom_marker",
          marker: res.marker,
          heuristic: true,
        });
        return;
      }
      if (res.kind === "failure") {
        finish("failure", {
          formId: formId,
          reason: "dom_marker",
          marker: res.marker,
          heuristic: true,
        });
      }
    }

    if (typeof MutationObserver !== "undefined") {
      try {
        var mo = new MutationObserver(function () {
          scan();
        });
        mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
        form._rsOutcomeMo = mo;
      } catch (e3) {}
    }
    scan();
    form._rsOutcomeTimer =
      typeof setTimeout !== "undefined"
        ? setTimeout(function () {
            if (gen !== form._rsOutcomeGen) return;
            if (!settled) {
              finish("none", {
                formId: formId,
                reason: "no_confirmation_within_window",
                windowMs: OUTCOME_OBSERVE_MS,
                heuristic: true,
              });
            }
          }, OUTCOME_OBSERVE_MS)
        : 0;
  }

  function postLead(ingestUrl, ref, form, adapter) {
    var fid = form.id || form.getAttribute("name") || "";
    pushTrace(OUTCOME.SUBMIT_ATTEMPT_DETECTED, { formId: fid });
    dbg(STAGE.SUBMIT_ATTEMPT, { formId: fid });
    var selCfg = siteLeadSelectors(lastResolvedWidgetConfig);
    var fields = collectFormFields(form);
    dbg(STAGE.PAYLOAD_BUILT, { fieldCount: Object.keys(fields).length });

    var payload = {
      event: "lead_submitted",
      ref: ref,
      page_url: window.location.href,
      form_id: form.id || form.getAttribute("name") || form.getAttribute("data-formid") || "",
      email: inferEmail(form, fields),
      name: inferName(form, fields),
      phone: inferPhone(form, fields),
      fields: fields,
    };
    var cur = (selCfg.currency && String(selCfg.currency).trim()) || "";
    if (cur) payload.currency = cur;
    var amt = readDomBySelectorInContext(selCfg.amountSelector, form, adapter);
    if (amt) payload.amount = amt;
    var pn = readDomBySelectorInContext(selCfg.productNameSelector, form, adapter);
    if (pn) payload.product_name = pn;

    pushTrace(OUTCOME.INGEST_REQUESTED, { url: ingestUrl });
    dbg(STAGE.INGEST_REQUEST, { url: ingestUrl });
    fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Publishable-Key": publishableKey,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then(function (r) {
        dbg("ingest response", { ok: r.ok, status: r.status });
        if (r && r.ok) {
          pushTrace(OUTCOME.INGEST_ACCEPTED, { ok: true, status: r.status });
          return r
            .json()
            .then(function (j) {
              try {
                if (j && j.lead_event_id != null && form) {
                  form._rsLeadEventIdForOutcome = j.lead_event_id;
                  flushBufferedOutcomeReport(form, ingestUrl);
                }
              } catch (eIn) {}
            })
            .catch(function () {});
        }
        pushTrace(OUTCOME.INGEST_FAILED, { ok: false, status: r ? r.status : 0 });
        return r;
      })
      .catch(function () {
        dbg("ingest network failure");
        pushTrace(OUTCOME.INGEST_FAILED, { ok: false, reason: "network" });
      });
  }

  var LEAD_DEDUP_MS = 800;

  function shouldSkipLeadDedup(form) {
    var t = form._rsLeadSentAt;
    if (t == null) return false;
    return Date.now() - t < LEAD_DEDUP_MS;
  }

  function sendLeadOnce(ingestUrl, ref, form, adapter) {
    if (shouldSkipLeadDedup(form)) {
      dbg("skip: client dedup");
      return;
    }
    form._rsLeadSentAt = Date.now();
    beginOutcomeObservation(form, adapter, ingestUrl);
    postLead(ingestUrl, ref, form, adapter);
  }

  function findSubmitLikeFromClickTarget(form, rawTarget, adapter) {
    var el = rawTarget;
    if (el && el.nodeType === 3 && el.parentElement) el = el.parentElement;
    if (!el || el.nodeType !== 1) return null;
    while (el && el !== form) {
      if (adapter.isSubmitLikeControl(el, form)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function wireForm(form, ref, ingestUrl, adapter) {
    if (wiredForms.has(form)) return;
    wiredForms.add(form);
    var wfId = form.id || form.getAttribute("name") || "";
    pushTrace(STAGE.FOUND, { id: wfId });
    dbg(STAGE.ARMED, { formId: wfId });
    pushTrace(STAGE.ARMED, { formId: wfId });
    ensureHiddenRef(form, ref);
    form.addEventListener(
      "submit",
      function () {
        sendLeadOnce(ingestUrl, ref, form, adapter);
      },
      true
    );
    form.addEventListener("click", function (ev) {
      var sub = findSubmitLikeFromClickTarget(form, ev.target, adapter);
      if (!sub) return;
      setTimeout(function () {
        if (shouldSkipLeadDedup(form)) return;
        sendLeadOnce(ingestUrl, ref, form, adapter);
      }, 0);
    });
  }

  function mutationMayAddForms(record) {
    var nodes = record.addedNodes;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeType !== 1) continue;
      if (node.tagName === "FORM") return true;
      if (typeof node.getElementsByTagName === "function") {
        try {
          if (node.getElementsByTagName("form").length) return true;
        } catch (e) {}
      }
    }
    return false;
  }

  function mutationMayToggleVisibility(record) {
    if (record.type !== "attributes") return false;
    var n = record.target;
    if (!n || n.nodeType !== 1) return false;
    var name = record.attributeName || "";
    return name === "class" || name === "style" || name === "hidden";
  }

  function startLateFormObserver(scan, debouncedScan) {
    if (typeof MutationObserver === "undefined") return;
    var root = doc.body || doc.documentElement;
    if (!root) return;

    /* One active observer per page; disconnect before replacing (embed reloads / test harness). */
    var win = typeof window !== "undefined" ? window : null;
    if (win && win.__rsLeadFormMo) {
      try {
        win.__rsLeadFormMo.disconnect();
      } catch (e) {}
      win.__rsLeadFormMo = null;
    }

    var mo = new MutationObserver(function (records) {
      var addedForm = false;
      var vis = false;
      for (var r = 0; r < records.length; r++) {
        if (mutationMayAddForms(records[r])) addedForm = true;
        if (mutationMayToggleVisibility(records[r])) vis = true;
      }
      /* New <form> nodes: wire immediately (tests / popups); no timer delay. */
      if (addedForm) scan();
      /* class/style/hidden toggles: debounce to avoid storms on animations. */
      else if (vis) debouncedScan();
    });
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    if (win) win.__rsLeadFormMo = mo;
    dbg("observer: mutation wired on root");
    return mo;
  }

  function wireAllForms(cfg, adapter) {
    observeSuccessEnabled = resolveObserveSuccessFromWidgetConfig(cfg);
    reportObservedOutcomeEnabled = resolveReportObservedOutcomeFromWidgetConfig(cfg);
    syncPublicApi();

    var storageKey = (cfg && cfg.storage_key) || "rs_ref_v1_" + siteId;
    var ingestUrl =
      (cfg && cfg.lead_ingest_url) ||
      apiBase + "/public/v1/events/leads?site=" + encodeURIComponent(siteId);

    if (cfg && cfg.debug === true) {
      runtimeDebugEnabled = true;
      dbg("debug enabled from widget-config");
    }
    syncPublicApi();

    function scan() {
      var ref = resolveRef(storageKey);
      var forms = doc.querySelectorAll("form");
      dbg("scan: forms=", forms.length);
      for (var i = 0; i < forms.length; i++) {
        var f = forms[i];
        dbg(STAGE.FOUND, { idx: i, id: f.id || "" });
        wireForm(f, ref, ingestUrl, adapter);
      }
    }

    var debouncedScan = (function () {
      var t = null;
      return function () {
        if (t != null && typeof clearTimeout !== "undefined") clearTimeout(t);
        t =
          typeof setTimeout !== "undefined"
            ? setTimeout(function () {
                t = null;
                scan();
              }, 60)
            : 0;
        if (t === 0) scan();
      };
    })();

    scan();
    startLateFormObserver(scan, debouncedScan);
  }

  var platformDetected = detectPlatform();
  var adapter = createPlatformAdapter(platformDetected);
  resolvedAdapterId = adapter.id;

  dbg("init", { platform: platformDetected, adapter: adapter.id, siteId: siteId });

  var configUrl =
    apiBase + "/public/v1/sites/" + encodeURIComponent(siteId) + "/widget-config";

  fetch(configUrl, { headers: { "X-Publishable-Key": publishableKey } })
    .then(function (r) {
      dbg("widget-config fetch", { ok: r.ok, status: r.status });
      return r.ok ? r.json() : Promise.reject(new Error("config"));
    })
    .then(function (cfg) {
      lastResolvedWidgetConfig = cfg && typeof cfg === "object" ? cfg : null;
      onReady(function () {
        wireAllForms(lastResolvedWidgetConfig, adapter);
      });
    })
    .catch(function () {
      dbg("widget-config failed, using defaults");
      lastResolvedWidgetConfig = null;
      onReady(function () {
        wireAllForms(null, adapter);
      });
    });

  publicApi = {
    platform: platformDetected,
    adapter: resolvedAdapterId,
    siteId: siteId,
    debug: runtimeDebugEnabled,
    observeSuccess: observeSuccessEnabled,
    reportObservedOutcome: reportObservedOutcomeEnabled,
    guardKey: GUARD_KEY,
    /** Stable strings for runtime outcome stages (local; not all sent to API). */
    outcomeStages: OUTCOME,
    getTrace: function () {
      return traceBuffer.slice();
    },
    clearTrace: function () {
      traceBuffer.length = 0;
    },
  };

  if (typeof window !== "undefined") {
    window.rsReferralWidget = window.rsReferralWidget || {};
    window.rsReferralWidget.v1 = publicApi;
  }
  syncPublicApi();
})();
