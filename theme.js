// Personal themes: built-in palettes + a fully custom palette, bubble shape, font size and glow.
import { THEMES } from "./themes.js";
export { THEMES };

export const DEFAULT_PREF = { id: "stealth", custom: { accent: "#00f0ff", bg: "#070b14", surface: "#0d1527", text: "#f8fafc" }, bubble: "cyber", font: "base", glow: true };
const LS = "cyph_theme";

const hex2rgb = (x) => { x = x.replace("#", ""); if (x.length === 3) x = [...x].map((c) => c + c).join(""); const n = parseInt(x, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgb2hex = (r) => "#" + r.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
const lum = (x) => { const [r, g, b] = hex2rgb(x).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const onColor = (bg) => lum(bg) > 0.4 ? "#0b1020" : "#ffffff";
const alpha = (x, a) => { const [r, g, b] = hex2rgb(x); return `rgba(${r}, ${g}, ${b}, ${a})`; };

export function buildPalette(pref) {
  if (pref.id !== "custom" && THEMES[pref.id]) return THEMES[pref.id];
  const c = { ...DEFAULT_PREF.custom, ...(pref.custom || {}) };
  return {
    id: "custom", name: "Custom", accent: c.accent, accentHover: mix(c.accent, c.text, 0.25), accentGlow: alpha(c.accent, 0.35),
    bgDark: c.bg, bgSurface: c.surface, bgSurfaceHover: mix(c.surface, c.text, 0.08), borderColor: mix(c.surface, c.text, 0.16),
    textPrimary: c.text, textSecondary: mix(c.text, c.bg, 0.4), bubbleMeBg: c.accent, bubbleMeText: onColor(c.accent),
    bubbleThemBg: mix(c.surface, c.text, 0.08), bubbleThemText: c.text, badgeBg: alpha(c.accent, 0.18), badgeText: c.accent,
  };
}

export function applyTheme(pref) {
  pref = { ...DEFAULT_PREF, ...pref, custom: { ...DEFAULT_PREF.custom, ...(pref?.custom || {}) } };
  const p = buildPalette(pref), r = document.documentElement.style;
  const map = { bg: p.bgDark, surface: p.bgSurface, "surface-hover": p.bgSurfaceHover, border: p.borderColor, text: p.textPrimary, text2: p.textSecondary,
    accent: p.accent, "accent-hover": p.accentHover, glow: p.accentGlow, "me-bg": p.bubbleMeBg, "me-text": p.bubbleMeText, "them-bg": p.bubbleThemBg,
    "them-text": p.bubbleThemText, "badge-bg": p.badgeBg, "badge-text": p.badgeText };
  for (const [k, v] of Object.entries(map)) r.setProperty("--" + k, v);
  r.setProperty("--on-accent", onColor(p.accent));
  r.setProperty("--bubble-radius", { rounded: "18px", sharp: "4px", cyber: "14px 14px 4px 14px" }[pref.bubble] || "14px");
  r.setProperty("--bubble-radius-them", { rounded: "18px", sharp: "4px", cyber: "14px 14px 14px 4px" }[pref.bubble] || "14px");
  r.setProperty("--font-size", { sm: "14px", base: "16px", lg: "18px" }[pref.font] || "16px");
  r.setProperty("--glow-shadow", pref.glow ? `0 0 14px ${p.accentGlow}` : "none");
  document.documentElement.dataset.scheme = lum(p.bgDark) > 0.4 ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", p.bgDark);
  return pref;
}
export const loadLocalTheme = () => { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch { return null; } };
export const saveLocalTheme = (pref) => localStorage.setItem(LS, JSON.stringify(pref));
