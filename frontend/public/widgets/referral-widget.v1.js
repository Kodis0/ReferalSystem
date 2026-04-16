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
 * on native form submit (does not block Tilda / default form handling).
 * Platform detection is shallow so non-Tilda sites can reuse the same script later.
 */
(function () {
  "use strict";

  var doc = document;
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

  function wireForm(form, ref, ingestUrl) {
    ensureHiddenRef(form, ref);
    form.addEventListener(
      "submit",
      function () {
        postLead(ingestUrl, ref, form);
      },
      true
    );
  }

  function wireAllForms(cfg) {
    var storageKey =
      (cfg && cfg.storage_key) || "rs_ref_v1_" + siteId;
    var ingestUrl =
      (cfg && cfg.lead_ingest_url) ||
      apiBase + "/public/v1/events/leads?site=" + encodeURIComponent(siteId);
    var ref = resolveRef(storageKey);
    var forms = doc.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      wireForm(forms[i], ref, ingestUrl);
    }
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
