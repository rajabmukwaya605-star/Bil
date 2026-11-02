// Small DOM + UI helpers (no framework). All user content goes through textContent - never innerHTML.
export const h = (tag, props, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "for") e.htmlFor = v;
    else if (k in e && k !== "list") { try { e[k] = v; } catch { e.setAttribute(k, v); } }
    else e.setAttribute(k, v === true ? "" : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else e.append(c instanceof Node ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return e;
};

// replaceChildren()/append() would stringify null or arrays; flatten and skip empties instead.
const flat = (a) => a.flat(Infinity).filter((x) => x != null && x !== false);
const _replace = Element.prototype.replaceChildren, _append = Element.prototype.append;
Element.prototype.replaceChildren = function (...a) { return _replace.apply(this, flat(a)); };
Element.prototype.append = function (...a) { return _append.apply(this, flat(a)); };

const ICONS = {
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  channel: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  status: '<circle cx="12" cy="12" r="9" stroke-dasharray="4 3"/><circle cx="12" cy="12" r="3"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  clip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
};
export const icon = (name, size = 20) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size); s.setAttribute("height", size);
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name] || ""; // static, trusted strings only
  return s;
};

export function avatar(url, name, size = 40) {
  const initials = (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
  let hue = 0; for (const c of name || "?") hue = (hue * 31 + c.charCodeAt(0)) % 360;
  const box = h("span", { class: "avatar", style: { width: size + "px", height: size + "px", fontSize: Math.round(size * 0.38) + "px", background: `hsl(${hue} 55% 38%)` } }, initials);
  if (url) {
    const img = h("img", { src: url, alt: "", loading: "lazy", onerror: () => img.remove() });
    box.append(img);
  }
  return box;
}

export const fmtTime = (iso) => {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const diff = (now - d) / 864e5;
  if (diff < 6) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
};
export const fmtSize = (n) => n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";

let toastEl;
export function toast(msg, kind = "info") {
  toastEl?.remove();
  toastEl = h("div", { class: "toast " + kind, role: "status" }, msg);
  document.body.append(toastEl);
  setTimeout(() => toastEl?.remove(), 3800);
}

// Modal dialog. body: Node. Returns { close }.
export function modal(title, body, opts = {}) {
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); opts.onClose?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const wrap = h("div", { class: "modal-wrap", onclick: (e) => { if (e.target === wrap) close(); } },
    h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "modal-head" }, h("h3", null, title), h("button", { class: "icon-btn", onclick: close, "aria-label": "Close" }, icon("x"))),
      h("div", { class: "modal-body" }, body)));
  document.addEventListener("keydown", onKey);
  document.body.append(wrap);
  wrap.querySelector("input,textarea,select")?.focus();
  return { close };
}

// Detect what the user typed into a "find person" box.
export function classifyIdentifier(raw) {
  const v = (raw || "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return { kind: "email", value: v.toLowerCase() };
  const d = v.replace(/[\s().-]/g, "");
  if (/^\+?\d{7,15}$/.test(d)) return { kind: "phone", value: d };
  if (v.includes("@")) return { kind: "invalid", error: "That doesn't look like a valid email address." };
  if (/^\+?[\d\s().-]+$/.test(v) && /\d/.test(v)) return { kind: "invalid", error: "Phone numbers need 7-15 digits. Include the country code, e.g. +256700123456." };
  if (/^cyph-/i.test(v)) return { kind: "tag", value: v.toUpperCase() };
  return { kind: "username", value: v.replace(/^@/, "") };
}
