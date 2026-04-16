/**
 * ReferralSystem embed widget (v1) — conservative, Tilda-friendly.
 *
 * Embed (values from Django admin → Site; script is served with the SPA build):
 *   <script src="https://lumoref.ru/widgets/referral-widget.v1.js"
 *     data-rs-api="https://api.lumoref.ru"
 *     data-rs-site="SITE_PUBLIC_UUID"
 *     data-rs-key="SITE_PUBLISHABLE_KEY"
 *     async></script>
 *
 * Behaviour: reads ?ref=, persists ref, adds hidden ref to forms, POSTs lead_submitted
 * on native form submit (does not block Tilda / default form handling). If the platform
 * submits via JS without dispatching submit, a conservative click fallback on
 * submit-like controls still records one lead per user action (deduped with submit).
 * Forms injected after DOMContentLoaded (e.g. Tilda popups/blocks) are picked up via
 * MutationObserver rescans; each form element is wired at most once (WeakSet).
 * Platform detection is shallow so non-Tilda sites can reuse the same script later.
 */
(function () {
  "use strict";

  var doc = document;
  var wiredForms = new WeakSet();
  var script = doc.currentScript;
  if (!script || !script.dataset) return;

  var apiBase = (script.dataset.rsApi || "").replace(/\/+$/, "");
  var siteId = script.dataset.rsSite || "";
  var publishableKey = script.dataset.rsKey || "";
  if (!apiBase || !siteId || !publishableKey) return;

  var PLATFORMS = { TILDA: "tilda", GENERIC: "generic" };

  function detectPlatform() {
    var w = typeof window !== "undefined" ? window : null;
    if (w && (w.tildaForm || w.tildastat || w.tildaBrowserLang)) return PLATFORMS.TILDA;
    return PLATFORMS.GENERIC;
  }

  function onReady(fn) {
    if (doc.readyState !== "loading") fn();
    else doc.addEventListener("DOMContentLoaded", fn);
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

  function pickFirstValue(form, names) {
    for (var i = 0; i < names.length; i++) {
      var el = form.elements[names[i]];
      if (el && "value" in el && el.value) return String(el.value);
    }
    return "";
  }

  function collectFormFields(form) {
    var out = {};
    for (var i = 0; i < form.elements.length; i++) {
      var el = form.elements[i];
      if (!el || !el.name) continue;
      if (el.type === "hidden" && el.name === "ref") continue;
      if (!("value" in el)) continue;
      var v = String(el.value || "").trim();
      if (v) out[el.name] = v;
    }
    return out;
  }

  function inferEmail(form, fields) {
    var e = pickFirstValue(form, ["email", "Email", "E-mail", "E-Mail"]);
    if (e) return e;
    var inp = form.querySelector('input[type="email"]');
    if (inp && inp.value) return String(inp.value).trim();
    for (var k in fields) {
      if (/email/i.test(k) && fields[k]) return fields[k];
    }
    return "";
  }

  function inferPhone(form, fields) {
    var p = pickFirstValue(form, ["phone", "Phone", "tel", "Tel", "Mobile", "mobile"]);
    if (p) return p;
    var inp = form.querySelector('input[type="tel"]');
    if (inp && inp.value) return String(inp.value).trim();
    for (var k in fields) {
      if (/phone|tel|mobile/i.test(k) && fields[k]) return fields[k];
    }
    return "";
  }

  function inferName(form, fields) {
    var n = pickFirstValue(form, ["name", "Name", "fullname", "Fullname", "full_name"]);
    if (n) return n;
    for (var k in fields) {
      if (/^name$/i.test(k) && fields[k]) return fields[k];
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

  function postLead(ingestUrl, ref, form) {
    var fields = collectFormFields(form);
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
    fetch(ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Publishable-Key": publishableKey,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () {});
  }

  /** Short window so native submit + click fallback still produce a single POST. */
  var LEAD_DEDUP_MS = 800;

  function shouldSkipLeadDedup(form) {
    var t = form._rsLeadSentAt;
    if (t == null) return false;
    return Date.now() - t < LEAD_DEDUP_MS;
  }

  function sendLeadOnce(ingestUrl, ref, form) {
    if (shouldSkipLeadDedup(form)) return;
    form._rsLeadSentAt = Date.now();
    postLead(ingestUrl, ref, form);
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

  function findSubmitLikeFromClickTarget(form, rawTarget) {
    var el = rawTarget;
    if (el && el.nodeType === 3 && el.parentElement) el = el.parentElement;
    if (!el || el.nodeType !== 1) return null;
    while (el && el !== form) {
      if (isSubmitLikeControl(el, form)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function wireForm(form, ref, ingestUrl) {
    if (wiredForms.has(form)) return;
    wiredForms.add(form);
    ensureHiddenRef(form, ref);
    form.addEventListener(
      "submit",
      function () {
        sendLeadOnce(ingestUrl, ref, form);
      },
      true
    );
    form.addEventListener("click", function (ev) {
      var sub = findSubmitLikeFromClickTarget(form, ev.target);
      if (!sub) return;
      setTimeout(function () {
        if (shouldSkipLeadDedup(form)) return;
        sendLeadOnce(ingestUrl, ref, form);
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

  function startLateFormObserver(scan) {
    if (typeof MutationObserver === "undefined") return;
    var root = doc.body || doc.documentElement;
    if (!root) return;
    var mo = new MutationObserver(function (records) {
      for (var r = 0; r < records.length; r++) {
        if (mutationMayAddForms(records[r])) {
          scan();
          return;
        }
      }
    });
    mo.observe(root, { childList: true, subtree: true });
  }

  function wireAllForms(cfg) {
    var storageKey =
      (cfg && cfg.storage_key) || "rs_ref_v1_" + siteId;
    var ingestUrl =
      (cfg && cfg.lead_ingest_url) ||
      apiBase + "/public/v1/events/leads?site=" + encodeURIComponent(siteId);
    function scan() {
      var ref = resolveRef(storageKey);
      var forms = doc.querySelectorAll("form");
      for (var i = 0; i < forms.length; i++) {
        wireForm(forms[i], ref, ingestUrl);
      }
    }
    scan();
    startLateFormObserver(scan);
  }

  var configUrl =
    apiBase + "/public/v1/sites/" + encodeURIComponent(siteId) + "/widget-config";

  fetch(configUrl, { headers: { "X-Publishable-Key": publishableKey } })
    .then(function (r) {
      return r.ok ? r.json() : Promise.reject(new Error("config"));
    })
    .then(function (cfg) {
      onReady(function () {
        wireAllForms(cfg);
      });
    })
    .catch(function () {
      onReady(function () {
        wireAllForms(null);
      });
    });

  if (typeof window !== "undefined") {
    window.rsReferralWidget = window.rsReferralWidget || {};
    window.rsReferralWidget.v1 = {
      platform: detectPlatform(),
      siteId: siteId,
    };
  }
})();
