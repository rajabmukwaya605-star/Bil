// Cyphronex-Bluevane - web app (no build step). Pages: Chats, Groups, Channels, Status, Settings.
import { CONFIG } from "./config.js";
import * as C from "./crypto.js";
import { h, icon, avatar, fmtTime, fmtSize, toast, modal, classifyIdentifier } from "./ui.js";
import { THEMES, DEFAULT_PREF, applyTheme, buildPalette, loadLocalTheme, saveLocalTheme } from "./theme.js";

const SB_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const LS_URL = "cyph_sb_url", LS_KEY = "cyph_sb_key";
const MAX_FILE = 25 * 1024 * 1024;
const root = document.getElementById("app");

const S = {
  sb: null, user: null, profile: null, keys: null,
  convs: [], others: {}, contacts: [], profiles: {}, members: {}, unread: {},
  route: { page: "chats", id: null }, open: null, seen: new Set(),
  channelsTab: "mine", chatsTab: "chats", listFilter: "", rt: null, hashBound: false, installEvt: null,
};
const PAGES = { chats: "direct", groups: "group", channels: "channel" };
const NAV = [["chats", "Chats", "chat"], ["groups", "Groups", "users"], ["channels", "Channels", "channel"], ["status", "Status", "status"], ["settings", "Settings", "settings"]];
const $ = (sel, el = document) => el.querySelector(sel);
const me = () => S.user.id;
const errMsg = (e) => e?.message || String(e);

/* ------------------------------------------------------------------ boot */
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installEvt = e; });
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));

async function boot() {
  applyTheme(loadLocalTheme() || DEFAULT_PREF);
  const url = CONFIG.SUPABASE_URL || localStorage.getItem(LS_URL);
  const key = CONFIG.SUPABASE_ANON_KEY || localStorage.getItem(LS_KEY);
  if (!url || !key) return renderSetup();
  try {
    const { createClient } = await import(SB_CDN);
    S.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  } catch (e) { return renderFatal("Could not load the Supabase library. Check your internet connection and reload.", e); }
  S.sb.auth.onAuthStateChange((ev) => {
    if (ev === "SIGNED_OUT") { teardown(); renderAuth(); }
    if (ev === "PASSWORD_RECOVERY") promptNewPassword();
  });
  const { data } = await S.sb.auth.getSession();
  if (data.session) startApp(data.session.user); else renderAuth();
}

function renderFatal(msg, e) {
  if (e) console.error(e);
  root.replaceChildren(h("div", { class: "center-screen" }, h("div", { class: "card narrow" },
    h("h2", null, "Something went wrong"), h("p", { class: "muted" }, msg),
    h("button", { class: "btn", onclick: () => location.reload() }, "Reload"),
    S.sb ? h("button", { class: "btn ghost", onclick: () => S.sb.auth.signOut() }, "Sign out") : null)));
}

/* ----------------------------------------------------------- setup screen */
function renderSetup() {
  const url = h("input", { type: "url", placeholder: "https://YOUR-PROJECT.supabase.co", autocomplete: "off", required: true });
  const key = h("input", { type: "text", placeholder: "anon / publishable key", autocomplete: "off", required: true });
  const err = h("p", { class: "error" });
  const form = h("form", { class: "stack", onsubmit: (e) => {
    e.preventDefault();
    let u = url.value.trim().replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/, "");
    const k = key.value.trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(u) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u)) { err.textContent = "Use the project URL, e.g. https://abcd1234.supabase.co (no /rest/v1/ at the end)."; return; }
    if (k.startsWith("{") || k.length < 20) { err.textContent = "That isn't an anon/publishable key. Copy it from Project Settings > API (not the JWKS / JWT secret)."; return; }
    localStorage.setItem(LS_URL, u); localStorage.setItem(LS_KEY, k); location.reload();
  } },
    h("label", null, "Project URL", url), h("label", null, "Anon / publishable key", key), err,
    h("button", { class: "btn", type: "submit" }, "Connect"));
  root.replaceChildren(h("div", { class: "center-screen" }, h("div", { class: "card" },
    brand(), h("h2", null, "Connect your Supabase project"),
    h("p", { class: "muted" }, "Run supabase_schema.sql once in your project's SQL editor, then paste the project URL and anon key here. They are stored in this browser only."), form)));
}
const brand = () => h("div", { class: "brand" }, h("img", { src: "./favicon.svg", alt: "", width: 40, height: 40 }), h("span", null, "Cyphronex-Bluevane"));

/* ----------------------------------------------------------------- auth */
function renderAuth(mode = "in") {
  const f = {
    email: h("input", { type: "email", required: true, autocomplete: "email", placeholder: "you@example.com" }),
    pass: h("input", { type: "password", required: true, minLength: 8, autocomplete: mode === "in" ? "current-password" : "new-password", placeholder: "At least 8 characters" }),
    user: h("input", { type: "text", pattern: "[A-Za-z0-9_]{3,24}", placeholder: "alex_vane", autocomplete: "username" }),
    name: h("input", { type: "text", placeholder: "Alex Vane", autocomplete: "name" }),
    phone: h("input", { type: "tel", placeholder: "+256700123456 (optional)", autocomplete: "tel" }),
  };
  const msg = h("p", { class: "error" });
  const btn = h("button", { class: "btn", type: "submit" }, mode === "in" ? "Sign in" : "Create account");
  const form = h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = ""; msg.className = "error"; btn.disabled = true;
    try {
      if (mode === "in") {
        const { data, error } = await S.sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.pass.value });
        if (error) throw error; await startApp(data.user);
      } else {
        let phone = f.phone.value.trim();
        if (phone) { const c = classifyIdentifier(phone); if (c.kind !== "phone") throw new Error("Enter a valid phone number with country code, e.g. +256700123456."); phone = c.value; }
        const { data, error } = await S.sb.auth.signUp({ email: f.email.value.trim(), password: f.pass.value,
          options: { data: { username: f.user.value.trim().toLowerCase(), display_name: f.name.value.trim(), phone } } });
        if (error) throw error;
        if (data.session) await startApp(data.user);
        else { msg.className = "ok"; msg.textContent = "Account created. Check your email for the confirmation link, then sign in."; }
      }
    } catch (er) { msg.textContent = errMsg(er); } finally { btn.disabled = false; }
  } },
    mode === "up" ? [h("label", null, "Display name", f.name), h("label", null, "Username", f.user)] : null,
    h("label", null, "Email", f.email), h("label", null, "Password", f.pass),
    mode === "up" ? h("label", null, "Phone (so friends can find you)", f.phone) : null,
    msg, btn,
    mode === "in" ? h("button", { class: "link", type: "button", onclick: async () => {
      if (!f.email.value.trim()) { msg.textContent = "Type your email first."; return; }
      const { error } = await S.sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: location.origin + location.pathname });
      msg.className = error ? "error" : "ok"; msg.textContent = error ? errMsg(error) : "Password reset email sent.";
    } }, "Forgot password?") : null);
  root.replaceChildren(h("div", { class: "center-screen" }, h("div", { class: "card" }, brand(),
    h("div", { class: "seg" },
      h("button", { class: mode === "in" ? "on" : "", onclick: () => renderAuth("in") }, "Sign in"),
      h("button", { class: mode === "up" ? "on" : "", onclick: () => renderAuth("up") }, "Sign up")),
    form,
    !CONFIG.SUPABASE_URL ? h("button", { class: "link", onclick: () => { localStorage.removeItem(LS_URL); localStorage.removeItem(LS_KEY); location.reload(); } }, "Change Supabase project") : null)));
}

function promptNewPassword() {
  const p = h("input", { type: "password", minLength: 8, required: true, placeholder: "New password" });
  const m = modal("Set a new password", h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault(); const { error } = await S.sb.auth.updateUser({ password: p.value });
    if (error) toast(errMsg(error), "error"); else { toast("Password updated.", "ok"); m.close(); }
  } }, p, h("button", { class: "btn", type: "submit" }, "Update password")));
}

function teardown() {
  S.rt && S.sb.removeChannel(S.rt);
  Object.assign(S, { user: null, profile: null, keys: null, convs: [], others: {}, contacts: [], profiles: {}, members: {}, unread: {}, open: null, rt: null, seen: new Set() });
}

/* ------------------------------------------------------------- start app */
async function startApp(user) {
  S.user = user;
  const { data: prof, error } = await S.sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error || !prof) return renderFatal("Your profile could not be loaded. Make sure supabase_schema.sql has been run in your Supabase project.", error);
  S.profile = prof; S.profiles[prof.id] = prof;
  if (prof.theme_preference?.id) { const t = applyTheme(prof.theme_preference); saveLocalTheme(t); }
  try {
    S.keys = await C.loadOrCreateKeys(user.id);
    if (prof.public_key !== S.keys.publicB64) {
      if (prof.public_key) toast("This browser has a new encryption key. Older encrypted chats from another device can't be read here unless you import your key backup (Settings > Security).", "warn");
      const { data } = await S.sb.from("profiles").update({ public_key: S.keys.publicB64, key_fingerprint: S.keys.fingerprint }).eq("id", user.id).select().single();
      if (data) { S.profile = data; S.profiles[data.id] = data; }
    }
  } catch (e) { console.error(e); toast("Encryption is unavailable in this browser (needs HTTPS or localhost).", "error"); }
  await Promise.all([loadConvs(), loadContacts()]);
  subscribe();
  renderShell();
  if (!S.hashBound) { window.addEventListener("hashchange", route); S.hashBound = true; }
  if (!location.hash || location.hash === "#") location.hash = "#/chats"; else route();
}

/* ------------------------------------------------------------ data layer */
async function fetchProfiles(ids) {
  const miss = [...new Set(ids)].filter((i) => i && !S.profiles[i]);
  if (!miss.length) return;
  const { data } = await S.sb.from("profiles").select("*").in("id", miss);
  (data || []).forEach((p) => (S.profiles[p.id] = p));
}
async function loadConvs() {
  const { data, error } = await S.sb.from("conversation_participants").select("role, conversations(*)").eq("user_id", me());
  if (error) { toast(errMsg(error), "error"); return; }
  S.convs = (data || []).filter((r) => r.conversations).map((r) => ({ ...r.conversations, myRole: r.role }))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const dIds = S.convs.filter((c) => c.type === "direct").map((c) => c.id);
  S.others = {};
  if (dIds.length) {
    const { data: ps } = await S.sb.from("conversation_participants").select("conversation_id, user_id").in("conversation_id", dIds).neq("user_id", me());
    (ps || []).forEach((p) => (S.others[p.conversation_id] = p.user_id));
    await fetchProfiles(Object.values(S.others));
  }
}
async function loadContacts() {
  const { data } = await S.sb.from("contacts").select("*").or(`user_id.eq.${me()},contact_user_id.eq.${me()}`);
  const seen = new Set();
  S.contacts = (data || []).map((r) => ({ id: r.id, otherId: r.user_id === me() ? r.contact_user_id : r.user_id, nickname: r.user_id === me() ? r.nickname : null, verified: r.safety_number_verified, mine: r.user_id === me() }))
    .filter((c) => !seen.has(c.otherId) && seen.add(c.otherId));
  await fetchProfiles(S.contacts.map((c) => c.otherId));
}
const profileName = (uid) => { const c = S.contacts.find((x) => x.otherId === uid); const p = S.profiles[uid]; return c?.nickname || p?.display_name || p?.username || "Unknown"; };
const convOther = (c) => S.profiles[S.others[c.id]];
const convTitle = (c) => c.type === "direct" ? profileName(S.others[c.id]) : c.name || "Untitled";
const convAvatar = (c, size) => c.type === "direct" ? avatar(convOther(c)?.avatar_url, convTitle(c), size) : avatar(c.avatar_url, convTitle(c), size);
const canAdmin = (c) => c.myRole === "owner" || c.myRole === "admin";

function subscribe() {
  S.rt && S.sb.removeChannel(S.rt);
  S.rt = S.sb.channel("cyph-rt")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, onNewMessage)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_participants", filter: `user_id=eq.${me()}` }, async () => { await loadConvs(); refreshList(); updateNav(); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "statuses" }, () => { if (S.route.page === "status") render(); })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "contacts", filter: `contact_user_id=eq.${me()}` }, async () => { await loadContacts(); refreshList(); })
    .subscribe();
}
async function onNewMessage({ new: m }) {
  if (S.seen.has(m.id)) return;
  const conv = S.convs.find((c) => c.id === m.conversation_id);
  if (!conv) { await loadConvs(); refreshList(); updateNav(); return; }
  conv.updated_at = m.created_at; S.convs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  if (S.open?.id === m.conversation_id) appendMessage(conv, m);
  else if (m.sender_id !== me()) { S.unread[conv.id] = (S.unread[conv.id] || 0) + 1; if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification(convTitle(conv), { body: "New message", icon: "./favicon.svg" }); }
  refreshList(); updateNav();
}

/* ------------------------------------------------------- shell & routing */
function renderShell() {
  const nav = h("nav", { class: "nav", "aria-label": "Main" },
    h("div", { class: "nav-logo" }, h("img", { src: "./favicon.svg", alt: "Cyphronex", width: 30, height: 30 })),
    NAV.map(([id, label, ic]) => h("a", { href: "#/" + id, class: "nav-item", dataset: { page: id }, "aria-label": label }, icon(ic, 22), h("span", null, label), h("i", { class: "badge hidden" }))),
    h("div", { class: "nav-me" }, h("a", { href: "#/settings", "aria-label": "Profile" }, avatar(S.profile.avatar_url, S.profile.display_name, 34))));
  root.replaceChildren(h("div", { class: "app" }, nav, h("main", { id: "page", class: "page" })));
}
function updateNav() {
  const totals = { chats: 0, groups: 0, channels: 0 };
  for (const c of S.convs) { const k = Object.keys(PAGES).find((p) => PAGES[p] === c.type); totals[k] += S.unread[c.id] || 0; }
  document.querySelectorAll(".nav-item").forEach((a) => {
    const p = a.dataset.page; a.classList.toggle("active", p === S.route.page);
    const b = $(".badge", a); const n = totals[p] || 0; b.textContent = n > 99 ? "99+" : n; b.classList.toggle("hidden", !n);
  });
  const n = totals.chats + totals.groups + totals.channels; document.title = (n ? `(${n}) ` : "") + "Cyphronex-Bluevane";
}
function route() {
  const m = location.hash.replace(/^#\/?/, "").split("/");
  const page = NAV.some((n) => n[0] === m[0]) ? m[0] : "chats";
  S.route = { page, id: m[1] || null };
  render();
}
function render() {
  if (!S.user || !$("#page")) return;
  const el = $("#page"); S.open = null; updateNav();
  el.className = "page page-" + S.route.page;
  if (S.route.page === "status") return pageStatus(el);
  if (S.route.page === "settings") return pageSettings(el);
  pageList(el);
}
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

/* ------------------------------------------- list pages (chats/groups/channels) */
function pageList(el) {
  const { page, id } = S.route;
  const list = h("section", { class: "list-pane" }), thread = h("section", { class: "thread-pane" });
  el.replaceChildren(h("div", { class: "split" + (id ? " has-thread" : "") }, list, thread));
  buildListHeader(list);
  if (id) openRoute(thread, page, id); else thread.append(emptyThread(page));
}
function emptyThread(page) {
  const t = { chats: ["chat", "Select a chat or add a contact to start an end-to-end encrypted conversation."], groups: ["users", "Select a group or create a new one."], channels: ["channel", "Select a channel, or discover public channels to join."] }[page];
  return h("div", { class: "empty-thread" }, icon(t[0], 48), h("p", null, t[1]));
}
function seg(options, current, onPick) {
  return h("div", { class: "seg small" }, options.map(([k, label]) => h("button", { class: current === k ? "on" : "", onclick: () => onPick(k) }, label)));
}
function buildListHeader(list) {
  const { page } = S.route;
  const title = { chats: "Chats", groups: "Groups", channels: "Channels" }[page];
  const add = page === "chats" ? () => addContactModal() : page === "groups" ? () => newConversationModal("group") : () => newConversationModal("channel");
  const addLabel = { chats: "Add contact", groups: "New group", channels: "New channel" }[page];
  const search = h("input", { type: "search", placeholder: "Search", value: S.listFilter, oninput: (e) => { S.listFilter = e.target.value; fillList(); }, "aria-label": "Search" });
  const tabs = page === "chats" ? seg([["chats", "Chats"], ["contacts", "Contacts"]], S.chatsTab, (k) => { S.chatsTab = k; buildListHeader(list); })
    : page === "channels" ? seg([["mine", "Subscribed"], ["discover", "Discover"]], S.channelsTab, (k) => { S.channelsTab = k; buildListHeader(list); }) : null;
  list.replaceChildren(
    h("header", { class: "pane-head" }, h("h1", null, title), h("button", { class: "icon-btn accent", onclick: add, title: addLabel, "aria-label": addLabel }, icon("plus"))),
    tabs, h("div", { class: "search" }, icon("search", 16), search), h("div", { id: "list-body", class: "list-body" }));
  fillList();
}
function refreshList() { if ($("#list-body")) fillList(); }

async function fillList() {
  const body = $("#list-body"); if (!body) return;
  const { page, id } = S.route, q = S.listFilter.trim().toLowerCase();
  if (page === "chats" && S.chatsTab === "contacts") return fillContacts(body, q);
  if (page === "channels" && S.channelsTab === "discover") return fillDiscover(body, q);
  const items = S.convs.filter((c) => c.type === PAGES[page] && convTitle(c).toLowerCase().includes(q));
  if (!items.length) {
    const msg = { chats: "No chats yet. Add a contact by email, phone, username or Cyphron tag.", groups: "No groups yet.", channels: "You haven't subscribed to any channels yet." }[page];
    body.replaceChildren(h("div", { class: "empty-list" }, h("p", null, q ? "No matches." : msg)));
    return;
  }
  body.replaceChildren(items.map((c) => {
    const sub = c.type === "direct" ? (convOther(c)?.bio || "Encrypted chat") : c.type === "group" ? "Group" : (c.description || "Channel");
    const n = S.unread[c.id] || 0;
    return h("a", { class: "item" + (c.id === id ? " active" : ""), href: `#/${page}/${c.id}` },
      convAvatar(c, 46),
      h("div", { class: "item-main" }, h("div", { class: "item-title" }, convTitle(c)), h("div", { class: "item-sub" }, sub)),
      h("div", { class: "item-side" }, h("span", { class: "item-time" }, fmtTime(c.updated_at)), n ? h("i", { class: "badge" }, n > 99 ? "99+" : n) : null));
  }));
}
function fillContacts(body, q) {
  const items = S.contacts.filter((c) => profileName(c.otherId).toLowerCase().includes(q));
  if (!items.length) { body.replaceChildren(h("div", { class: "empty-list" }, h("p", null, q ? "No matches." : "No contacts yet."), h("button", { class: "btn", onclick: () => addContactModal() }, "Add a contact"))); return; }
  body.replaceChildren(items.map((c) => {
    const p = S.profiles[c.otherId] || {};
    return h("div", { class: "item", role: "button", tabindex: 0, onclick: () => startChat(c.otherId), onkeydown: (e) => e.key === "Enter" && startChat(c.otherId) },
      avatar(p.avatar_url, profileName(c.otherId), 46),
      h("div", { class: "item-main" }, h("div", { class: "item-title" }, profileName(c.otherId)), h("div", { class: "item-sub mono" }, p.cyphron_tag || "")),
      c.mine ? h("button", { class: "icon-btn", title: "Remove contact", "aria-label": "Remove contact", onclick: async (e) => {
        e.stopPropagation(); if (!confirm(`Remove ${profileName(c.otherId)} from your contacts? Existing chats are kept.`)) return;
        const { error } = await S.sb.from("contacts").delete().eq("id", c.id); if (error) return toast(errMsg(error), "error");
        await loadContacts(); fillList();
      } }, icon("trash", 18)) : null);
  }));
}
async function fillDiscover(body, q) {
  body.replaceChildren(h("div", { class: "empty-list" }, h("p", { class: "muted" }, "Loading public channels…")));
  const { data, error } = await S.sb.from("conversations").select("*").eq("type", "channel").eq("is_public", true).order("updated_at", { ascending: false }).limit(60);
  if (S.channelsTab !== "discover" || !$("#list-body")) return;
  if (error) return body.replaceChildren(h("div", { class: "empty-list" }, h("p", { class: "error" }, errMsg(error))));
  const mine = new Set(S.convs.map((c) => c.id));
  const items = (data || []).filter((c) => !mine.has(c.id) && (c.name || "").toLowerCase().includes(q));
  if (!items.length) return body.replaceChildren(h("div", { class: "empty-list" }, h("p", null, "No public channels to discover right now. Create one!")));
  body.replaceChildren(items.map((c) => h("a", { class: "item", href: "#/channels/" + c.id },
    avatar(c.avatar_url, c.name, 46),
    h("div", { class: "item-main" }, h("div", { class: "item-title" }, c.name), h("div", { class: "item-sub" }, c.description || "Public channel")),
    h("button", { class: "btn small", onclick: (e) => { e.preventDefault(); e.stopPropagation(); joinChannel(c.id); } }, "Join"))));
}
async function joinChannel(cid) {
  const { error } = await S.sb.rpc("join_channel", { cid });
  if (error) return toast(errMsg(error), "error");
  await loadConvs(); S.channelsTab = "mine"; go("#/channels/" + cid);
}
async function startChat(uid) {
  const { data, error } = await S.sb.rpc("start_direct_chat", { other: uid });
  if (error) return toast(errMsg(error), "error");
  await loadConvs(); S.chatsTab = "chats"; go("#/chats/" + data);
}

/* --------------------------------------------------------------- modals */
function addContactModal() {
  const input = h("input", { type: "text", required: true, placeholder: "name@email.com, +256700123456, CYPH-4891-B7 or username", autocomplete: "off" });
  const nick = h("input", { type: "text", placeholder: "Nickname (optional)" });
  const hint = h("p", { class: "hint" }), err = h("p", { class: "error" });
  const kinds = { email: "Email address", phone: "Phone number", tag: "Cyphron tag", username: "Username", invalid: "Not recognised" };
  input.addEventListener("input", () => { err.textContent = ""; hint.textContent = input.value.trim() ? "Detected: " + kinds[classifyIdentifier(input.value).kind] : ""; });
  const btn = h("button", { class: "btn", type: "submit" }, "Find & add");
  const m = modal("Add contact", h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    const c = classifyIdentifier(input.value);
    if (c.kind === "invalid") { err.textContent = c.error; return; }
    btn.disabled = true;
    try {
      const { data, error } = await S.sb.rpc("find_profile", { identifier: c.value });
      if (error) throw error;
      const p = data?.[0];
      if (!p) throw new Error(`No registered user matches that ${kinds[c.kind].toLowerCase()}. Ask them to sign up (and add their phone in Settings > Profile).`);
      if (p.id === me()) throw new Error("That's you!");
      S.profiles[p.id] = { ...S.profiles[p.id], ...p };
      const { error: e2 } = await S.sb.from("contacts").insert({ user_id: me(), contact_user_id: p.id, nickname: nick.value.trim() || null, status: "accepted" });
      if (e2 && e2.code !== "23505") throw e2;
      await loadContacts(); m.close(); toast(`${p.display_name || p.username} added.`, "ok"); await startChat(p.id);
    } catch (er) { err.textContent = errMsg(er); } finally { btn.disabled = false; }
  } }, h("p", { class: "muted" }, "Find someone by the email or phone number on their account, their Cyphron tag, or their username."), input, hint, nick, err, btn));
}

function newConversationModal(type) {
  const name = h("input", { type: "text", required: true, maxLength: 60, placeholder: type === "group" ? "Group name" : "Channel name" });
  const desc = h("textarea", { rows: 2, maxLength: 200, placeholder: "Description (optional)" });
  const pub = h("input", { type: "checkbox", checked: true });
  const picks = S.contacts.map((c) => ({ c, box: h("input", { type: "checkbox" }) }));
  const err = h("p", { class: "error" });
  const m = modal(type === "group" ? "New group" : "New channel", h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    const { data, error } = await S.sb.rpc("create_conversation", { p_type: type, p_name: name.value, p_description: desc.value, p_is_public: type === "channel" && pub.checked, p_members: picks.filter((p) => p.box.checked).map((p) => p.c.otherId) });
    if (error) { err.textContent = errMsg(error); return; }
    await loadConvs(); m.close(); go(`#/${type === "group" ? "groups" : "channels"}/${data}`);
  } }, name, desc,
    type === "channel" ? h("label", { class: "check" }, pub, h("span", null, "Public - anyone can find and join it. Only admins can post.")) : null,
    h("div", { class: "pick-label" }, type === "group" ? "Add members" : "Invite contacts"),
    h("div", { class: "pick-list" }, picks.length ? picks.map(({ c, box }) => h("label", { class: "check" }, box, avatar(S.profiles[c.otherId]?.avatar_url, profileName(c.otherId), 28), h("span", null, profileName(c.otherId)))) : h("p", { class: "muted" }, "Add contacts first to invite them (you can also add members later.)")),
    err, h("button", { class: "btn", type: "submit" }, "Create")));
}

async function loadMembers(conv) {
  const { data } = await S.sb.from("conversation_participants").select("user_id, role").eq("conversation_id", conv.id);
  S.members[conv.id] = data || [];
  await fetchProfiles((data || []).map((r) => r.user_id));
  return S.members[conv.id];
}
async function infoModal(conv) {
  const body = h("div", { class: "stack" }); const m = modal(convTitle(conv), body);
  if (conv.type === "direct") {
    const p = convOther(conv), ct = S.contacts.find((c) => c.otherId === p?.id);
    let theirs = "(no key yet)"; try { if (p?.public_key) theirs = await C.fingerprint(p.public_key); } catch {}
    body.append(h("div", { class: "profile-hero" }, avatar(p?.avatar_url, convTitle(conv), 72), h("h3", null, convTitle(conv)), h("p", { class: "mono muted" }, p?.cyphron_tag || ""), h("p", null, p?.bio || "")),
      h("div", { class: "pick-label" }, "Safety numbers"), h("p", { class: "muted" }, "Compare these with your contact over a trusted channel. If they match, nobody is intercepting your chat."),
      h("p", { class: "mono box" }, h("b", null, "You: "), S.keys?.fingerprint || "-"), h("p", { class: "mono box" }, h("b", null, "Them: "), theirs),
      ct?.mine ? h("button", { class: "btn", onclick: async () => { const { error } = await S.sb.from("contacts").update({ safety_number_verified: !ct.verified }).eq("id", ct.id); if (error) return toast(errMsg(error), "error"); await loadContacts(); toast(ct.verified ? "Marked unverified." : "Marked verified.", "ok"); m.close(); } }, ct.verified ? "Verified ✓ (tap to undo)" : "Mark as verified") : null);
    return;
  }
  const members = await loadMembers(conv);
  const render = () => {
    const have = new Set((S.members[conv.id] || []).map((r) => r.user_id));
    const addable = S.contacts.filter((c) => !have.has(c.otherId)).map((c) => ({ c, box: h("input", { type: "checkbox" }) }));
    body.replaceChildren(
      h("div", { class: "profile-hero" }, convAvatar(conv, 72), h("p", null, conv.description || (conv.type === "channel" ? "Channel" : "Group")), h("p", { class: "muted" }, `${(S.members[conv.id] || []).length} member(s)${conv.type === "channel" && conv.is_public ? " · public" : ""}`)),
      h("div", { class: "pick-label" }, "Members"),
      h("div", { class: "pick-list" }, (S.members[conv.id] || []).map((r) => h("div", { class: "member" }, avatar(S.profiles[r.user_id]?.avatar_url, profileName(r.user_id), 30), h("span", null, r.user_id === me() ? "You" : profileName(r.user_id)), r.role !== "member" ? h("em", { class: "role" }, r.role) : null))),
      canAdmin(conv) && addable.length ? [h("div", { class: "pick-label" }, "Add contacts"), h("div", { class: "pick-list" }, addable.map(({ c, box }) => h("label", { class: "check" }, box, avatar(S.profiles[c.otherId]?.avatar_url, profileName(c.otherId), 28), h("span", null, profileName(c.otherId))))),
        h("button", { class: "btn", onclick: async () => { const ids = addable.filter((a) => a.box.checked).map((a) => a.c.otherId); if (!ids.length) return;
          const { error } = await S.sb.rpc("add_members", { cid: conv.id, p_members: ids }); if (error) return toast(errMsg(error), "error"); await loadMembers(conv); render(); toast("Members added.", "ok"); } }, "Add selected")] : null,
      h("button", { class: "btn danger", onclick: async () => { if (!confirm(`Leave ${conv.name}?`)) return;
        const { error } = await S.sb.from("conversation_participants").delete().eq("conversation_id", conv.id).eq("user_id", me()); if (error) return toast(errMsg(error), "error");
        await loadConvs(); m.close(); go("#/" + S.route.page); } }, "Leave"));
  };
  render();
}

/* ---------------------------------------------------------------- thread */
async function openRoute(pane, page, id) {
  const conv = S.convs.find((c) => c.id === id && c.type === PAGES[page]);
  if (conv) return openThread(pane, conv, page);
  if (page === "channels") {
    const { data } = await S.sb.from("conversations").select("*").eq("id", id).eq("type", "channel").maybeSingle();
    if (data) return pane.replaceChildren(h("div", { class: "thread-head" }, h("a", { class: "icon-btn back", href: "#/channels", "aria-label": "Back" }, icon("back")), avatar(data.avatar_url, data.name, 40), h("div", { class: "grow" }, h("b", null, data.name))),
      h("div", { class: "empty-thread" }, avatar(data.avatar_url, data.name, 72), h("h2", null, data.name), h("p", null, data.description || "Public channel"), h("button", { class: "btn", onclick: () => joinChannel(data.id) }, "Join channel")));
  }
  pane.replaceChildren(h("div", { class: "empty-thread" }, h("p", null, "This conversation wasn't found."), h("a", { class: "btn", href: "#/" + page }, "Back")));
}

const blobCache = new Map();
async function getKey(conv) { const o = convOther(conv); if (!o?.public_key || !S.keys) return null; return C.sharedKey(S.keys.privateKey, o.public_key); }
function getBlob(conv, meta) {
  if (!blobCache.has(meta.path)) blobCache.set(meta.path, (async () => {
    const { data, error } = await S.sb.storage.from("attachments").download(meta.path); if (error) throw error;
    let bytes = new Uint8Array(await data.arrayBuffer());
    if (meta.enc) { const key = await getKey(conv); if (!key) throw new Error("no key"); bytes = await C.decryptBytes(key, bytes, meta.iv); }
    return new Blob([bytes], { type: meta.mime || "application/octet-stream" });
  })().catch((e) => { blobCache.delete(meta.path); throw e; }));
  return blobCache.get(meta.path);
}
async function decodeText(conv, m) {
  if (m.iv === "plain") return m.encrypted_content;
  try { const key = await getKey(conv); if (!key) return null; return await C.decryptText(key, m.encrypted_content, m.iv); } catch { return null; }
}

function attachmentNode(conv, m) {
  const meta = m.attachment_meta;
  if (m.message_type === "image" && /^image\//.test(meta.mime || "")) {
    const box = h("div", { class: "att-image" }, h("span", { class: "muted" }, "Loading image…"));
    getBlob(conv, meta).then((b) => { const u = URL.createObjectURL(b); box.replaceChildren(h("img", { src: u, alt: meta.name, class: "att-img", onclick: () => modal(meta.name, h("img", { src: u, class: "lightbox", alt: meta.name })) })); })
      .catch(() => box.replaceChildren(h("span", { class: "muted" }, "Image unavailable")));
    return box;
  }
  const btn = h("button", { class: "icon-btn", title: "Download", "aria-label": "Download " + meta.name, onclick: async () => {
    btn.disabled = true;
    try { const b = await getBlob(conv, meta); const a = h("a", { href: URL.createObjectURL(b), download: meta.name }); document.body.append(a); a.click(); a.remove(); }
    catch (e) { toast("Couldn't download file: " + errMsg(e), "error"); } finally { btn.disabled = false; }
  } }, icon("download", 18));
  return h("div", { class: "att-file" }, icon("file", 26), h("div", { class: "grow" }, h("div", { class: "att-name" }, meta.name), h("div", { class: "muted small" }, fmtSize(meta.size || 0))), btn);
}

async function appendMessage(conv, m) {
  if (S.seen.has(m.id)) return; S.seen.add(m.id);
  const box = document.getElementById("msgs"); if (!box || S.open?.id !== conv.id) return;
  if (conv.type !== "direct") await fetchProfiles([m.sender_id]);
  const text = await decodeText(conv, m);
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  const mine = m.sender_id === me();
  const node = h("div", { class: "msg " + (mine ? "mine" : "them") }, h("div", { class: "bubble" },
    !mine && conv.type !== "direct" ? h("div", { class: "sender" }, profileName(m.sender_id)) : null,
    m.attachment_meta ? attachmentNode(conv, m) : null,
    text === null ? h("div", { class: "undecryptable" }, icon("lock", 14), " Can't decrypt on this device") : text ? h("div", { class: "text" }, text) : null,
    h("div", { class: "meta" }, conv.type === "direct" ? icon("lock", 11) : null, fmtTime(m.created_at))));
  box.append(node);
  if (near || mine) box.scrollTop = box.scrollHeight;
}

async function openThread(pane, conv, page) {
  S.open = conv; S.seen = new Set(); S.unread[conv.id] = 0; updateNav(); refreshList();
  const msgs = h("div", { class: "messages", id: "msgs" }, h("p", { class: "muted center" }, "Loading…"));
  const sub = conv.type === "direct" ? "End-to-end encrypted" : conv.type === "group" ? "Group · server-side encrypted (TLS)" : (conv.is_public ? "Public channel" : "Private channel");
  const head = h("div", { class: "thread-head" },
    h("a", { class: "icon-btn back", href: "#/" + page, "aria-label": "Back" }, icon("back")), convAvatar(conv, 40),
    h("div", { class: "grow" }, h("b", null, convTitle(conv)), h("div", { class: "muted small" }, conv.type === "direct" ? [icon("lock", 11), " ", sub] : sub)),
    h("button", { class: "icon-btn", title: "Details", "aria-label": "Details", onclick: () => infoModal(conv) }, icon("info")));
  let composer;
  if (conv.type === "channel" && !canAdmin(conv)) composer = h("div", { class: "composer readonly" }, "Only channel admins can post.");
  else if (conv.type === "direct" && !convOther(conv)?.public_key) composer = h("div", { class: "composer readonly" }, "This contact hasn't set up encryption yet. They need to sign in once.");
  else composer = buildComposer(conv, msgs);
  pane.replaceChildren(head, msgs, composer);
  if (conv.type !== "direct") loadMembers(conv);
  const { data, error } = await S.sb.from("messages").select("*").eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(200);
  if (S.open?.id !== conv.id) return;
  msgs.replaceChildren();
  if (error) return msgs.append(h("p", { class: "error center" }, errMsg(error)));
  if (!data.length) msgs.append(h("p", { class: "muted center empty-hint" }, conv.type === "direct" ? "Say hello - messages and files are end-to-end encrypted." : "No messages yet."));
  for (const m of data.reverse()) { msgs.querySelector(".empty-hint")?.remove(); await appendMessage(conv, m); }
  msgs.scrollTop = msgs.scrollHeight;
}

function buildComposer(conv, msgs) {
  const fileIn = h("input", { type: "file", multiple: true, class: "hidden", onchange: () => { sendFiles([...fileIn.files]); fileIn.value = ""; } });
  const ta = h("textarea", { rows: 1, placeholder: "Message", "aria-label": "Message", oninput: () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; },
    onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendText(); } },
    onpaste: (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); sendFiles(fs); } } });
  const sendBtn = h("button", { class: "icon-btn send", title: "Send", "aria-label": "Send", onclick: () => sendText() }, icon("send"));
  let busy = false;
  const insert = async (text, extra = {}) => {
    let ct = text, iv = "plain";
    if (conv.type === "direct") { const key = await getKey(conv); if (!key) throw new Error("Missing encryption key for this contact."); ({ ct, iv } = await C.encryptText(key, text)); }
    const { data, error } = await S.sb.from("messages").insert({ conversation_id: conv.id, sender_id: me(), encrypted_content: ct, iv, message_type: "text", ...extra }).select().single();
    if (error) throw error; await appendMessage(conv, data);
  };
  async function sendText() {
    const text = ta.value.trim(); if (!text || busy) return; busy = true; ta.value = ""; ta.style.height = "auto";
    try { await insert(text); } catch (e) { ta.value = text; toast("Couldn't send: " + errMsg(e), "error"); } finally { busy = false; ta.focus(); }
  }
  async function sendFiles(files) {
    if (busy || !files.length) return; busy = true; sendBtn.disabled = true;
    let caption = ta.value.trim(); ta.value = "";
    try {
      for (const f of files) {
        if (f.size > MAX_FILE) { toast(`${f.name} is larger than ${fmtSize(MAX_FILE)}.`, "error"); continue; }
        toast(`Uploading ${f.name}…`);
        let bytes = new Uint8Array(await f.arrayBuffer()), enc = false, iv = null;
        if (conv.type === "direct") { const key = await getKey(conv); if (!key) throw new Error("Missing encryption key."); const r = await C.encryptBytes(key, bytes); bytes = r.data; iv = r.iv; enc = true; }
        const safe = f.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
        const path = `${conv.id}/${crypto.randomUUID()}-${safe}`;
        const { error } = await S.sb.storage.from("attachments").upload(path, new Blob([bytes], { type: "application/octet-stream" }), { contentType: "application/octet-stream" });
        if (error) throw error;
        await insert(caption, { message_type: /^image\//.test(f.type) ? "image" : "file", attachment_meta: { path, name: f.name, size: f.size, mime: f.type || "application/octet-stream", enc, iv } });
        caption = "";
      }
    } catch (e) { toast("Couldn't send file: " + errMsg(e), "error"); } finally { busy = false; sendBtn.disabled = false; }
  }
  msgs.addEventListener("dragover", (e) => { e.preventDefault(); msgs.classList.add("drop"); });
  msgs.addEventListener("dragleave", () => msgs.classList.remove("drop"));
  msgs.addEventListener("drop", (e) => { e.preventDefault(); msgs.classList.remove("drop"); sendFiles([...e.dataTransfer.files]); });
  return h("div", { class: "composer" }, fileIn, h("button", { class: "icon-btn", title: "Attach file", "aria-label": "Attach file", onclick: () => fileIn.click() }, icon("clip")), ta, sendBtn);
}

/* ------------------------------------------------------- image utilities */
async function resizeImage(file, max, square = false, quality = 0.86) {
  try {
    const bmp = await createImageBitmap(file);
    let sw = bmp.width, sh = bmp.height, sx = 0, sy = 0, w, hgt;
    if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; w = hgt = Math.min(max, s); }
    else { const k = Math.min(1, max / Math.max(sw, sh)); w = Math.round(sw * k); hgt = Math.round(sh * k); }
    const cv = document.createElement("canvas"); cv.width = w; cv.height = hgt;
    cv.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, w, hgt);
    return await new Promise((res) => cv.toBlob((b) => res(b || file), "image/jpeg", quality));
  } catch { return file; }
}
const pubUrl = (bucket, path) => S.sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;

/* ----------------------------------------------------------- status page */
const STATUS_COLORS = ["#0284c7", "#7c3aed", "#db2777", "#059669", "#d97706", "#dc2626", "#0f172a"];
async function pageStatus(el) {
  const body = h("div", { class: "status-body" }, h("p", { class: "muted center" }, "Loading…"));
  el.replaceChildren(h("div", { class: "single" }, h("header", { class: "pane-head" }, h("h1", null, "Status"),
    h("button", { class: "icon-btn accent", title: "Add status", "aria-label": "Add status", onclick: () => addStatusModal() }, icon("plus"))), body));
  const { data, error } = await S.sb.from("statuses").select("*").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true });
  if (S.route.page !== "status") return;
  if (error) return body.replaceChildren(h("p", { class: "error center" }, errMsg(error)));
  const by = {}; (data || []).forEach((s) => (by[s.user_id] ||= []).push(s));
  await fetchProfiles(Object.keys(by));
  const mine = by[me()] || [];
  const others = Object.entries(by).filter(([u]) => u !== me()).sort((a, b) => new Date(b[1].at(-1).created_at) - new Date(a[1].at(-1).created_at));
  const ring = (list, p, name, size = 54) => h("span", { class: "ring" + (list.length ? " has" : "") }, avatar(p?.avatar_url, name, size));
  body.replaceChildren(
    h("div", { class: "item", role: "button", tabindex: 0, onclick: () => mine.length ? viewStatuses(mine, () => pageStatus(el)) : addStatusModal(), onkeydown: (e) => e.key === "Enter" && (mine.length ? viewStatuses(mine, () => pageStatus(el)) : addStatusModal()) },
      ring(mine, S.profile, S.profile.display_name),
      h("div", { class: "item-main" }, h("div", { class: "item-title" }, "My status"), h("div", { class: "item-sub" }, mine.length ? `${mine.length} update(s) · last ${fmtTime(mine.at(-1).created_at)}` : "Tap to add a status that disappears after 24 hours"))),
    h("div", { class: "pick-label pad" }, "Recent updates"),
    others.length ? others.map(([uid, list]) => h("div", { class: "item", role: "button", tabindex: 0, onclick: () => viewStatuses(list), onkeydown: (e) => e.key === "Enter" && viewStatuses(list) },
      ring(list, S.profiles[uid], profileName(uid)),
      h("div", { class: "item-main" }, h("div", { class: "item-title" }, profileName(uid)), h("div", { class: "item-sub" }, `${list.length} update(s) · ${fmtTime(list.at(-1).created_at)}`))))
      : h("div", { class: "empty-list" }, h("p", null, "No recent updates from your contacts.")));
}

function addStatusModal() {
  let kind = "text", color = STATUS_COLORS[0], file = null;
  const text = h("textarea", { rows: 4, maxLength: 280, placeholder: "What's on your mind?" });
  const preview = h("div", { class: "status-preview", style: { background: color } }, text);
  const swatches = h("div", { class: "swatches" }, STATUS_COLORS.map((c) => h("button", { type: "button", class: "swatch", style: { background: c }, "aria-label": "Colour " + c, onclick: () => { color = c; preview.style.background = c; } })));
  const pic = h("input", { type: "file", accept: "image/*", class: "hidden", onchange: () => { file = pic.files[0] || null; if (!file) return; kind = "image"; img.src = URL.createObjectURL(file); sync(); } });
  const img = h("img", { class: "status-img", alt: "Preview" });
  const caption = h("input", { type: "text", maxLength: 140, placeholder: "Caption (optional)" });
  const err = h("p", { class: "error" });
  const tabs = h("div", { class: "seg small" });
  const sync = () => {
    tabs.replaceChildren(h("button", { type: "button", class: kind === "text" ? "on" : "", onclick: () => { kind = "text"; sync(); } }, "Text"), h("button", { type: "button", class: kind === "image" ? "on" : "", onclick: () => { kind = "image"; sync(); if (!file) pic.click(); } }, "Photo"));
    preview.hidden = swatches.hidden = kind !== "text"; img.hidden = caption.hidden = kind !== "image" || !file;
  };
  const btn = h("button", { class: "btn", type: "submit" }, "Post status");
  const m = modal("New status", h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ""; btn.disabled = true;
    try {
      let row;
      if (kind === "text") { if (!text.value.trim()) throw new Error("Write something first."); row = { user_id: me(), kind: "text", content: text.value.trim(), bg: color }; }
      else {
        if (!file) throw new Error("Choose a photo first.");
        const blob = await resizeImage(file, 1280); const path = `${me()}/${crypto.randomUUID()}.jpg`;
        const { error } = await S.sb.storage.from("statuses").upload(path, blob, { contentType: "image/jpeg" }); if (error) throw error;
        row = { user_id: me(), kind: "image", content: caption.value.trim() || null, media_path: path, media_url: pubUrl("statuses", path) };
      }
      const { error } = await S.sb.from("statuses").insert(row); if (error) throw error;
      m.close(); toast("Status posted.", "ok"); if (S.route.page === "status") render();
    } catch (er) { err.textContent = errMsg(er); } finally { btn.disabled = false; }
  } }, tabs, preview, swatches, pic, img, caption, err, btn));
  sync();
}

function viewStatuses(list, onChange) {
  let i = 0, timer; const own = list[0].user_id === me(), DUR = 5000;
  const bars = h("div", { class: "sv-bars" }), stage = h("div", { class: "sv-stage" });
  const close = () => { clearTimeout(timer); wrap.remove(); document.removeEventListener("keydown", key); };
  const key = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); };
  const step = (d) => { i += d; if (i >= list.length) return close(); if (i < 0) i = 0; show(); };
  function show() {
    clearTimeout(timer); const s = list[i];
    bars.replaceChildren(list.map((_, k) => h("span", { class: k < i ? "done" : k === i ? "run" : "", style: k === i ? { animationDuration: DUR + "ms" } : null })));
    stage.style.background = s.kind === "text" ? s.bg || "#0284c7" : "#000";
    stage.replaceChildren(s.kind === "image" ? h("img", { src: s.media_url, alt: s.content || "Status photo" }) : null,
      s.content ? h("div", { class: s.kind === "text" ? "sv-text" : "sv-caption" }, s.content) : null);
    timer = setTimeout(() => step(1), DUR);
  }
  const wrap = h("div", { class: "sv", role: "dialog", "aria-modal": "true", "aria-label": "Status viewer" },
    bars,
    h("div", { class: "sv-head" }, avatar(S.profiles[list[0].user_id]?.avatar_url, profileName(list[0].user_id), 36), h("b", null, own ? "My status" : profileName(list[0].user_id)),
      h("span", { class: "grow" }),
      own ? h("button", { class: "icon-btn", title: "Delete this status", "aria-label": "Delete this status", onclick: async () => {
        const s = list[i]; if (!confirm("Delete this status?")) return; clearTimeout(timer);
        const { error } = await S.sb.from("statuses").delete().eq("id", s.id); if (error) { toast(errMsg(error), "error"); return show(); }
        if (s.media_path) S.sb.storage.from("statuses").remove([s.media_path]);
        close(); onChange?.(); } }, icon("trash")) : null,
      h("button", { class: "icon-btn", onclick: close, "aria-label": "Close" }, icon("x"))),
    stage,
    h("button", { class: "sv-nav left", "aria-label": "Previous", onclick: () => step(-1) }), h("button", { class: "sv-nav right", "aria-label": "Next", onclick: () => step(1) }));
  document.addEventListener("keydown", key); document.body.append(wrap); show();
}

/* --------------------------------------------------------- settings page */
async function pageSettings(el) {
  const { data: priv } = await S.sb.from("profile_private").select("*").eq("id", me()).maybeSingle();
  if (S.route.page !== "settings") return;
  const p = S.profile;

  // --- Profile
  const f = {
    name: h("input", { type: "text", value: p.display_name || "", maxLength: 50, required: true }),
    user: h("input", { type: "text", value: p.username || "", pattern: "[A-Za-z0-9_]{3,24}", required: true, autocapitalize: "none" }),
    bio: h("textarea", { rows: 2, maxLength: 140 }, p.bio || ""),
    phone: h("input", { type: "tel", value: priv?.phone || "", placeholder: "+256700123456" }),
  };
  const avBox = h("div", { class: "av-edit" });
  const drawAvatar = () => avBox.replaceChildren(avatar(S.profile.avatar_url, S.profile.display_name, 96),
    h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => avIn.click() }, icon("camera", 16), " Change photo"),
      S.profile.avatar_url ? h("button", { class: "btn small ghost", type: "button", onclick: () => saveAvatar(null) }, "Remove") : null));
  const avIn = h("input", { type: "file", accept: "image/*", class: "hidden", onchange: async () => {
    const file = avIn.files[0]; avIn.value = ""; if (!file) return;
    try { const blob = await resizeImage(file, 256, true); const path = `${me()}/avatar-${Date.now()}.jpg`;
      const { error } = await S.sb.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" }); if (error) throw error; await saveAvatar(pubUrl("avatars", path)); }
    catch (e) { toast("Couldn't upload photo: " + errMsg(e), "error"); }
  } });
  async function saveAvatar(url) {
    const { data, error } = await S.sb.from("profiles").update({ avatar_url: url }).eq("id", me()).select().single();
    if (error) return toast(errMsg(error), "error"); S.profile = data; S.profiles[me()] = data; drawAvatar(); $(".nav-me")?.replaceChildren(h("a", { href: "#/settings" }, avatar(url, data.display_name, 34))); toast("Photo updated.", "ok");
  }
  drawAvatar();
  const perr = h("p", { class: "error" });
  const profileForm = h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault(); perr.textContent = "";
    const username = f.user.value.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) { perr.textContent = "Username: 3-24 letters, numbers or underscores."; return; }
    let phone = null; if (f.phone.value.trim()) { const c = classifyIdentifier(f.phone.value); if (c.kind !== "phone") { perr.textContent = "Enter a valid phone number with country code, e.g. +256700123456."; return; } phone = c.value; }
    const { data, error } = await S.sb.from("profiles").update({ display_name: f.name.value.trim(), username, bio: f.bio.value.trim() }).eq("id", me()).select().single();
    if (error) { perr.textContent = error.code === "23505" ? "That username is already taken." : errMsg(error); return; }
    const { error: e2 } = await S.sb.from("profile_private").upsert({ id: me(), email: (S.user.email || "").toLowerCase(), phone });
    if (e2) { perr.textContent = e2.code === "23505" ? "That phone number is already registered to another account." : errMsg(e2); return; }
    S.profile = data; S.profiles[me()] = data; toast("Profile saved.", "ok"); drawAvatar();
  } },
    h("label", null, "Display name", f.name), h("label", null, "Username", f.user), h("label", null, "About", f.bio),
    h("label", null, "Phone number", f.phone, h("small", { class: "muted" }, "Lets people find you by phone. Never shown publicly.")),
    h("label", null, "Email", h("input", { type: "email", value: S.user.email || "", disabled: true })),
    h("label", null, "Your Cyphron tag", h("div", { class: "copy-row" }, h("code", { class: "mono" }, p.cyphron_tag || ""), h("button", { class: "btn small ghost", type: "button", onclick: () => navigator.clipboard?.writeText(p.cyphron_tag).then(() => toast("Tag copied.", "ok")) }, "Copy"))),
    perr, h("button", { class: "btn", type: "submit" }, "Save profile"));

  // --- Appearance (personal themes)
  let pref = { ...DEFAULT_PREF, ...(loadLocalTheme() || {}), ...(S.profile.theme_preference?.id ? S.profile.theme_preference : {}) };
  pref.custom = { ...DEFAULT_PREF.custom, ...(pref.custom || {}) };
  let saveTimer;
  const commit = () => { applyTheme(pref); saveLocalTheme(pref); sync(); clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => { const { data, error } = await S.sb.from("profiles").update({ theme_preference: pref }).eq("id", me()).select().single(); if (!error && data) { S.profile = data; S.profiles[me()] = data; } }, 700); };
  const grid = h("div", { class: "theme-grid" });
  const customPanel = h("div", { class: "custom-panel stack" });
  const cards = {};
  const allThemes = [...Object.values(THEMES), { id: "custom", name: "Custom", description: "Your own colours" }];
  for (const t of allThemes) {
    const pal = t.id === "custom" ? buildPalette({ id: "custom", custom: pref.custom }) : t;
    const sw = h("span", { class: "sw", style: { background: pal.bgDark, borderColor: pal.borderColor } }, h("i", { style: { background: pal.bgSurface } }), h("i", { style: { background: pal.accent } }));
    const card = h("button", { type: "button", class: "theme-card", title: t.description, onclick: () => {
      if (t.id === "custom" && pref.id !== "custom") { const b = buildPalette(pref); pref.custom = { accent: b.accent, bg: b.bgDark, surface: b.bgSurface, text: b.textPrimary }; }
      pref.id = t.id; commit(); } }, sw, h("span", null, t.name));
    cards[t.id] = { card, sw }; grid.append(card);
  }
  const colorField = (label, key) => { const i = h("input", { type: "color", value: pref.custom[key], oninput: () => { pref.custom[key] = i.value; pref.id = "custom"; commit(); } }); return h("label", { class: "color-field" }, i, h("span", null, label)); };
  const selBubble = h("select", { onchange: () => { pref.bubble = selBubble.value; commit(); } }, [["cyber", "Cyber (default)"], ["rounded", "Rounded"], ["sharp", "Sharp"]].map(([v, l]) => h("option", { value: v, selected: pref.bubble === v }, l)));
  const selFont = h("select", { onchange: () => { pref.font = selFont.value; commit(); } }, [["sm", "Small"], ["base", "Medium"], ["lg", "Large"]].map(([v, l]) => h("option", { value: v, selected: pref.font === v }, l)));
  const glow = h("input", { type: "checkbox", checked: !!pref.glow, onchange: () => { pref.glow = glow.checked; commit(); } });
  customPanel.append(h("div", { class: "color-grid" }, colorField("Accent", "accent"), colorField("Background", "bg"), colorField("Panels", "surface"), colorField("Text", "text")));
  function sync() {
    for (const [id, { card, sw }] of Object.entries(cards)) { card.classList.toggle("sel", pref.id === id); if (id === "custom") { const pal = buildPalette({ id: "custom", custom: pref.custom }); sw.style.background = pal.bgDark; sw.children[0].style.background = pal.bgSurface; sw.children[1].style.background = pal.accent; } }
    customPanel.hidden = pref.id !== "custom";
  }
  sync();
  const appearance = h("div", { class: "stack" }, h("p", { class: "muted" }, "Your theme is saved to your account and follows you to every device."), grid, customPanel,
    h("div", { class: "row wrap" }, h("label", null, "Message bubbles", selBubble), h("label", null, "Text size", selFont), h("label", { class: "check" }, glow, h("span", null, "Glow effects"))),
    h("button", { class: "btn ghost", type: "button", onclick: () => { pref = { ...DEFAULT_PREF, custom: { ...DEFAULT_PREF.custom } }; commit(); selBubble.value = pref.bubble; selFont.value = pref.font; glow.checked = pref.glow; } }, "Reset to default"));

  // --- Security
  const keyIn = h("input", { type: "file", accept: "application/json,.json", class: "hidden", onchange: async () => {
    const file = keyIn.files[0]; keyIn.value = ""; if (!file) return;
    try { const j = JSON.parse(await file.text()); if (!j.priv || !j.pub) throw new Error("Not a Cyphronex key backup."); if (!confirm("Replace this browser's encryption key with the backup? This lets you read chats from the other device.")) return;
      localStorage.setItem("cyph_ecdh_" + me(), JSON.stringify({ priv: j.priv, pub: j.pub })); toast("Key imported. Reloading…", "ok"); setTimeout(() => location.reload(), 900); }
    catch (e) { toast(errMsg(e), "error"); }
  } });
  const security = h("div", { class: "stack" },
    h("p", { class: "muted" }, "Direct chats and their files are end-to-end encrypted. Your private key lives only in this browser. Back it up to read your chats on another device."),
    h("p", { class: "mono box" }, h("b", null, "Your safety number: "), S.keys?.fingerprint || "-"),
    h("div", { class: "row wrap" },
      h("button", { class: "btn ghost", type: "button", onclick: () => { const raw = localStorage.getItem("cyph_ecdh_" + me()); if (!raw) return toast("No key found.", "error");
        const a = h("a", { href: URL.createObjectURL(new Blob([raw], { type: "application/json" })), download: "cyphronex-key-backup.json" }); document.body.append(a); a.click(); a.remove();
        toast("Keep this file private - anyone with it can read your direct chats.", "warn"); } }, "Download key backup"),
      h("button", { class: "btn ghost", type: "button", onclick: () => keyIn.click() }, "Import key backup")), keyIn,
    h("p", { class: "muted small" }, "Groups and channels are protected in transit (TLS) and by access rules, but they are not end-to-end encrypted."));

  // --- App / account
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const app = h("div", { class: "stack" },
    S.installEvt ? h("button", { class: "btn", onclick: async () => { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; pageSettings(el); } }, "Install app")
      : h("p", { class: "muted" }, "Install: in Chrome/Edge use the install icon in the address bar; on iPhone/iPad tap Share > Add to Home Screen."),
    perm === "default" ? h("button", { class: "btn ghost", onclick: async () => { await Notification.requestPermission(); pageSettings(el); } }, "Enable message notifications") : h("p", { class: "muted small" }, perm === "granted" ? "Notifications are on." : perm === "denied" ? "Notifications are blocked in your browser settings." : ""),
    h("button", { class: "btn danger", onclick: () => S.sb.auth.signOut() }, "Sign out"));

  const card = (title, ...kids) => h("section", { class: "card flat" }, h("h2", null, title), ...kids);
  el.replaceChildren(h("div", { class: "single scroll" }, h("header", { class: "pane-head" }, h("h1", null, "Settings")),
    h("div", { class: "settings" }, card("Profile", avBox, avIn, profileForm), card("Appearance", appearance), card("Security", security), card("App & account", app))));
}

boot();
