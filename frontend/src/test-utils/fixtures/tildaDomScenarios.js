/**
 * Tilda-like DOM trees for widget integration tests (approximate published markup; not a Tilda clone).
 */

function el(tag, className, attrs, children) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (attrs) {
    Object.keys(attrs).forEach((k) => {
      if (k === "text") n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
  }
  (children || []).forEach((c) => {
    if (typeof c === "string") n.appendChild(document.createTextNode(c));
    else if (c) n.appendChild(c);
  });
  return n;
}

function inputEmail(value) {
  const em = document.createElement("input");
  em.type = "text";
  em.name = "email";
  em.value = value;
  return em;
}

/** Inline Tilda-style block: tariff row + form in same .t-rec */
function buildInlineFormWithPriceBlock() {
  const rec = el("div", "t-rec t-item");
  const price = el("div", "js-price", { text: "9990" });
  const wrap = el("div", "t-form");
  const form = el("form", "");
  form.appendChild(inputEmail("buyer@example.com"));
  wrap.appendChild(form);
  rec.appendChild(price);
  rec.appendChild(wrap);
  return { root: rec, form, price };
}

/** Popup container (simplified): form inside .t-popup */
function buildPopupForm() {
  const popup = el("div", "t-popup");
  const inner = el("div", "t-popup__container");
  const form = el("form", "");
  form.appendChild(inputEmail("pop@example.com"));
  const btn = el("span", "t-submit", { text: "Send" });
  form.appendChild(btn);
  inner.appendChild(form);
  popup.appendChild(inner);
  return { root: popup, form };
}

/** Hidden wrapper (display:none) — unhide to simulate late reveal */
function buildHiddenBlockForm() {
  const wrap = el("div", "", { style: "display:none" });
  wrap.className = "t-rec";
  const form = el("form", "");
  form.appendChild(inputEmail("hidden@example.com"));
  wrap.appendChild(form);
  return { root: wrap, form };
}

/** Success message node (Tilda documents .t-form__successbox) */
function buildSuccessBox(text) {
  const box = el("div", "t-form__successbox", { text: text || "Thank you" });
  box.style.display = "block";
  return box;
}

function buildErrorBox(text) {
  const box = el("div", "t-form__errorbox", { text: text || "Please fix" });
  box.style.display = "block";
  return box;
}

module.exports = {
  el,
  buildInlineFormWithPriceBlock,
  buildPopupForm,
  buildHiddenBlockForm,
  buildSuccessBox,
  buildErrorBox,
};
