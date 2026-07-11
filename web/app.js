"use strict";

const $view = document.getElementById("view");
const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");

// Turn a failed response into an Error carrying the server's {"detail": …}
// message (so users see "That username is taken." instead of a bare "409").
async function apiError(r) {
  let detail;
  try { detail = (await r.json()).detail; } catch { /* non-JSON body */ }
  return Object.assign(new Error(detail || ("Error " + r.status)), { status: r.status });
}
async function api(p) { const r = await fetch(p); if (!r.ok) throw await apiError(r); return r.json(); }

function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function highlight(text, q) {
  const esc = escapeHtml(text);
  const term = (q || "").trim();
  if (!term) return esc;
  try {
    const re = new RegExp("(" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\p{L}\\p{M}]*)", "giu");
    return esc.replace(re, "<mark>$1</mark>");
  } catch { return esc; }
}
function fmtDate(iso) { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }
// "9th July, 2026" — ordinal day + full month + comma + year (share subjects).
function ordinalSuffix(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; }
function fmtDateShare(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const mon = new Date(y, m - 1, d).toLocaleString("en", { month: "long" });
  return `${d}${ordinalSuffix(d)} ${mon}, ${y}`;
}
// "10072026" — ddmmyyyy (ISO parts are already zero-padded); for shared/saved
// image file names, e.g. GM_10072026.jpg.
function fmtDateFile(iso) { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}${m}${y}`; }
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
// Thumbnail <img> (lazy-loaded + async-decoded) or an empty placeholder box.
function thumbImg(e) { return e && e.thumb_url ? `<img class="thumb" src="${e.thumb_url}" alt="" loading="lazy" decoding="async">` : `<div class="thumb"></div>`; }

// --------------------------------------------------------------------------
// Local storage
// --------------------------------------------------------------------------
const store = {
  favs() { try { return JSON.parse(localStorage.getItem("wa:favorites") || "[]"); } catch { return []; } },
  isFav(id) { return store.favs().includes(String(id)); },
  toggleFav(id) { id = String(id); let f = store.favs(); f = f.includes(id) ? f.filter((x) => x !== id) : [id, ...f]; localStorage.setItem("wa:favorites", JSON.stringify(f)); return f.includes(id); },
  lastViewed() { try { return localStorage.getItem("wa:lastViewed") || ""; } catch { return ""; } },
  setLastViewed(id) { try { if (id) localStorage.setItem("wa:lastViewed", String(id)); } catch {} },
  comments(id) { try { return JSON.parse(localStorage.getItem("wa:comments:" + id) || "[]"); } catch { return []; } },
  addComment(id, text) { const l = store.comments(id); l.unshift({ text, ts: Date.now() }); localStorage.setItem("wa:comments:" + id, JSON.stringify(l)); },
  deleteComment(id, ts) { localStorage.setItem("wa:comments:" + id, JSON.stringify(store.comments(id).filter((c) => c.ts !== ts))); },
  token() { try { return localStorage.getItem("wa:token") || ""; } catch { return ""; } },
  setToken(t) { try { if (t) localStorage.setItem("wa:token", t); else localStorage.removeItem("wa:token"); } catch {} },
};

// Bearer header for the local admin-upload endpoints (harmless if unset; the
// archive ignores it). Community auth now runs through Supabase (see WA.* in
// wa-supabase.js), not this token.
function authHeaders() { const t = store.token(); return t ? { Authorization: "Bearer " + t } : {}; }

// Current signed-in user (cached in localStorage) + moderator gating for the nav.
function currentUser() { try { return JSON.parse(localStorage.getItem("wa:user") || "null"); } catch { return null; } }
function isModerator() { const u = currentUser(); return !!(store.token() && u && (u.role === "moderator" || u.role === "sutradhar")); }
function isSutradhar() { const u = currentUser(); return !!(store.token() && u && u.role === "sutradhar"); }
function isSignedIn() { return !!(store.token() && currentUser()); }
function refreshModNav() {
  document.getElementById("app").classList.toggle("is-mod", isModerator());
  updateAvatarFace();
  if (document.getElementById("avatar-pop") && !document.getElementById("avatar-pop").hidden) renderAvatarPop();
}

// ----- Account menu (avatar, top-right) -----
const AVATAR_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20c0-3.6 3-6 6.5-6s6.5 2.4 6.5 6"/></svg>`;

function updateAvatarFace() {
  const btn = document.getElementById("avatar-btn"); if (!btn) return;
  const u = currentUser();
  if (isSignedIn()) { btn.innerHTML = `<span class="av-initial">${escapeHtml((u.username || "?")[0].toUpperCase())}</span>`; btn.classList.add("signed"); btn.title = u.username; }
  else { btn.innerHTML = AVATAR_SVG; btn.classList.remove("signed"); btn.title = "Account — sign in"; }
}

function renderAvatarPop() {
  const pop = document.getElementById("avatar-pop"); if (!pop) return;
  if (isSignedIn()) {
    const u = currentUser();
    pop.innerHTML = `<div class="ap-user"><div class="ap-name">${escapeHtml(u.username)}</div><div class="ap-role">${escapeHtml(u.role)}</div></div>
      <button class="btn ap-signout">Sign out</button>`;
    pop.querySelector(".ap-signout").addEventListener("click", () => {
      WA.logout();
      store.setToken(""); try { localStorage.removeItem("wa:user"); } catch {}
      refreshModNav(); toast("Signed out"); closeAvatarPop(); safeRoute();
    });
  } else {
    pop.innerHTML = `<div class="ap-guest">You're browsing as a guest.</div><button class="btn primary ap-signin">Sign in</button>`;
    pop.querySelector(".ap-signin").addEventListener("click", (e) => { e.stopPropagation();
      pop.innerHTML = modSignInHtml();
      pop.classList.add("ap-formmode");
      wireModSignIn(pop, () => { pop.classList.remove("ap-formmode"); refreshModNav(); closeAvatarPop(); safeRoute(); });
    });
  }
}

function openAvatarPop() {
  const pop = document.getElementById("avatar-pop"), btn = document.getElementById("avatar-btn"); if (!pop || !btn) return;
  renderAvatarPop();
  const r = btn.getBoundingClientRect();
  pop.style.top = (r.bottom + 8) + "px";
  pop.style.right = Math.max(8, window.innerWidth - r.right) + "px";
  pop.style.left = "auto";
  pop.hidden = false;
}

function closeAvatarPop() { const pop = document.getElementById("avatar-pop"); if (pop && !pop.hidden) pop.hidden = true; }

function initAvatar() {
  const btn = document.getElementById("avatar-btn"); const pop = document.getElementById("avatar-pop");
  if (!btn || !pop) return;
  document.body.appendChild(pop);   // escape the topbar's overflow/backdrop-filter clipping
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop.hidden) openAvatarPop(); else closeAvatarPop();
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#avatar-wrap") && !e.target.closest("#avatar-pop")) closeAvatarPop(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAvatarPop(); });
  updateAvatarFace();
}
// Refresh the cached user from the live Supabase session so the Moderator nav
// reflects reality (role changes, sign-out in another tab, expired session).
async function initAuthState() {
  refreshModNav();
  try {
    const d = await WA.me();
    store.setToken(d.token);
    try { localStorage.setItem("wa:user", JSON.stringify(d.user)); } catch {}
  } catch {
    store.setToken(""); try { localStorage.removeItem("wa:user"); } catch {}
  }
  refreshModNav();
}

// --------------------------------------------------------------------------
// Icons + nav
// --------------------------------------------------------------------------
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  heart: '<path d="M12 20S4 14.5 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5.5-8 11-8 11z"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/>',
  shuffle: '<path d="M16 4h4v4"/><path d="M20 4 4 20"/><path d="M16 20h4v-4"/><path d="M4 4l6 6"/>',
  pie: '<circle cx="12" cy="12" r="9"/><path d="M12 12V3"/><path d="M12 12l7.8 4.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M3.5 7l2.6 1.5M17.9 15.5l2.6 1.5M3.5 17l2.6-1.5M17.9 8.5 20.5 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.5a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.1 1-1.1 1.8"/><path d="M12 17h.01"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>',
  shield: '<path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z"/><path d="M9.2 12l2 2 3.6-3.8"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[n] || ""}</svg>`;

const NAV = [
  { route: "home", label: "Home", hash: "#/", icon: "home" },
  { route: "search", label: "Search", hash: "#/search", icon: "search" },
  { route: "favorites", label: "Favorites", hash: "#/favorites", icon: "heart" },
  { route: "browse-date", label: "Browse by Date", hash: "#/browse/date", icon: "calendar" },
  { route: "random", label: "Your Lucky Msg for Today", hash: "#/random", icon: "shuffle" },
  { divider: true },
  { route: "admin", label: "Add Guru's Msg", hash: "#/admin", icon: "upload" },
  { route: "moderator", label: "Moderator", hash: "#/moderator", icon: "shield", modOnly: true },
  { route: "stats", label: "Statistics", hash: "#/stats", icon: "pie" },
  { route: "settings", label: "Settings", hash: "#/settings", icon: "gear" },
  { route: "about", label: "About", hash: "#/about", icon: "info" },
  { route: "help", label: "Help & Support", hash: "#/help", icon: "help" },
];
function buildNav() {
  const nav = document.getElementById("nav"); nav.innerHTML = "";
  NAV.forEach((it) => {
    if (it.divider) { nav.appendChild(el(`<div class="divider"></div>`)); return; }
    nav.appendChild(el(`<a href="${it.hash}" data-route="${it.route}"${it.modOnly ? ' class="mod-only"' : ""}><span class="ico">${icon(it.icon)}</span><span class="label">${it.label}</span></a>`));
  });
}
function setActiveNav(route) { document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === route)); }

// --------------------------------------------------------------------------
// Toast + read-more
// --------------------------------------------------------------------------
let toastT;
function toast(msg, opts) {
  let t = document.getElementById("wa-toast");
  if (!t) { t = document.createElement("div"); t.id = "wa-toast"; t.style.cssText = "position:fixed;left:50%;padding:10px 18px;border-radius:10px;font-size:13px;opacity:0;transition:opacity .2s;box-shadow:0 6px 24px rgba(0,0,0,.2);max-width:86%;text-align:center"; document.body.appendChild(t); }
  // Variants (the element is a reused singleton — reset every style each call):
  // - red edge-toast (opts.red): red box/white text, centred 30% below the
  //   screen middle (pos "down", pushing past the newest) or 30% above it
  //   (pos "up", pushing past the first/start).
  // - mobile default: just BELOW the fixed top panel, near the share/download
  //   buttons it reports on. Desktop: original bottom-centre position.
  const mobile = document.body.classList.contains("m-mode");
  t.style.background = opts && opts.red ? "#d32f2f" : "#2c2a33";
  t.style.color = "#fff";
  if (opts && opts.red) { t.style.top = opts.pos === "up" ? "20%" : "80%"; t.style.bottom = "auto"; t.style.transform = "translate(-50%,-50%)"; t.style.zIndex = "620"; }
  else if (mobile) { t.style.top = "calc(60px + env(safe-area-inset-top))"; t.style.bottom = "auto"; t.style.transform = "translateX(-50%)"; t.style.zIndex = "620"; }
  else { t.style.bottom = "24px"; t.style.top = "auto"; t.style.transform = "translateX(-50%)"; t.style.zIndex = "100"; }
  t.textContent = msg; t.style.opacity = "1"; clearTimeout(toastT); toastT = setTimeout(() => (t.style.opacity = "0"), 1800);
}
// Full-screen image viewer with click/scroll zoom + drag-to-pan.
function openLightbox(src) {
  const ov = el(`<div class="lightbox">
    <button class="lb-close" title="Close (Esc)" aria-label="Close">×</button>
    <div class="lb-stage"><img src="${src}" alt="" draggable="false"></div>
    <div class="lb-hint">Click image or scroll to zoom · drag to pan · Esc to close</div>
  </div>`);
  const stage = ov.querySelector(".lb-stage");
  const img = ov.querySelector("img");
  let zoom = 1, ox = 0, oy = 0, dragging = false, sx = 0, sy = 0;
  const apply = () => {
    img.style.transform = `translate(${ox}px, ${oy}px) scale(${zoom})`;
    stage.classList.toggle("zoomed", zoom > 1);
  };
  img.addEventListener("click", (e) => {
    e.stopPropagation();
    if (zoom > 1) { zoom = 1; ox = oy = 0; } else { zoom = 2.4; }
    apply();
  });
  ov.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoom = Math.min(6, Math.max(1, zoom + (e.deltaY < 0 ? 0.25 : -0.25)));
    if (zoom === 1) { ox = oy = 0; }
    apply();
  }, { passive: false });
  img.addEventListener("mousedown", (e) => { if (zoom <= 1) return; e.preventDefault(); dragging = true; sx = e.clientX - ox; sy = e.clientY - oy; });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  function onMove(e) { if (!dragging) return; ox = e.clientX - sx; oy = e.clientY - sy; apply(); }
  function onUp() { dragging = false; }
  function close() { ov.remove(); document.removeEventListener("keydown", onKey); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }
  function onKey(e) { if (e.key === "Escape") close(); }
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target === stage) close(); });
  ov.querySelector(".lb-close").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(ov);
}

function attachReadMore(root) {
  root.querySelectorAll(".wisdom-text").forEach((node) => {
    node.classList.add("clamp");
    requestAnimationFrame(() => {
      if (node.scrollHeight <= node.clientHeight + 4) { node.classList.remove("clamp"); return; }
      const btn = el(`<button class="read-more">Read more ▾</button>`);
      btn.addEventListener("click", () => { const open = node.classList.toggle("clamp"); btn.textContent = open ? "Read more ▾" : "Show less ▴"; });
      node.insertAdjacentElement("afterend", btn);
    });
  });
}

// --------------------------------------------------------------------------
// Shared detail builder
// --------------------------------------------------------------------------
const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>`;
const COPY_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const HEART_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 20S4 14.5 4 9a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 5.5-8 11-8 11z"/></svg>`;
const SHARE_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="12" r="2.4"/><circle cx="17.5" cy="6" r="2.4"/><circle cx="17.5" cy="18" r="2.4"/><path d="M8.2 11 15.3 7.1M8.2 13l7.1 3.9"/></svg>`;

// Reflect an entry's favorite state everywhere it shows at once: the list-rail
// hearts, the detail bar button, and the fav buttons on BOTH original images.
function applyFavState(id, on) {
  id = String(id);
  document.querySelectorAll(`.rail-item[data-id="${id}"] .heart`).forEach((h) => { h.classList.toggle("on", on); h.textContent = on ? "♥" : "♡"; });
  document.querySelectorAll(`.img-fav[data-id="${id}"]`).forEach((b) => { b.classList.toggle("active", on); b.title = on ? "In Favorites" : "Add to Favorites"; });
  document.querySelectorAll(`[data-fav][data-id="${id}"]`).forEach((b) => {
    b.classList.toggle("active", on); b.title = on ? "In Favorites" : "Add to Favorites";
    const s = b.querySelector("span"); if (s) s.textContent = on ? "In Favorites" : "Add to Favorites";
  });
}
// Toggle a favorite from anywhere, then sync every copy of its state.
function toggleFavFor(id) { const on = store.toggleFav(String(id)); applyFavState(id, on); return on; }
// Share one language's original image (as an actual file, not a link — this
// app runs on 127.0.0.1, a per-machine address, so a "link" to it is useless
// to anyone else's computer) via the OS's native share sheet (Mail, installed
// apps, Nearby Sharing, etc). Falls back gracefully in stages: text-only share
// if the browser can't attach files, then clipboard-copy of the text if Web
// Share isn't supported at all (e.g. desktop Firefox). Cancelling the native
// share dialog is not an error.
async function shareImage(url, filename, text) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return;
    }
    if (navigator.share) {
      await navigator.share({ text });
      toast("This browser can't share images directly — shared the text instead.");
      return;
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;   // user cancelled the share sheet
    // fall through to the clipboard fallback below
  }
  try { await navigator.clipboard.writeText(text); toast("Sharing isn't supported here — text copied to clipboard instead."); }
  catch { toast("Couldn't share."); }
}

// Copy the actual image to the clipboard (for pasting into a browser-based
// app — WhatsApp Web, Telegram Web, Gmail — that can't appear in the native
// share sheet, since only installed apps can register as share targets).
// Browsers only reliably accept PNG on the clipboard, not JPEG, so this
// decodes the source JPG onto a canvas and re-encodes it as PNG first; the
// pasted image is visually identical, just a differently-encoded file.
async function copyImageToClipboard(url) {
  try {
    const resp = await fetch(url);
    const jpgBlob = await resp.blob();
    const bitmap = await createImageBitmap(jpgBlob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    toast("Image copied — paste it (Ctrl+V) into WhatsApp, Telegram, Gmail, etc.");
  } catch {
    toast("Couldn't copy the image here — try Download instead.");
  }
}

// "topic\n\nbody\n\n— signature, date" — the caption shared alongside an image.
function shareCaption(topic, body, signature, date) {
  return `${topic ? topic + "\n\n" : ""}${body || ""}\n\n— ${signature}${date ? ", " + fmtDate(date) : ""}`.trim();
}

// One original-image panel with Favorite / Share / Download / Copy buttons in
// the top corner. Favorite acts on the whole entry (id), so toggling on either
// image (or the detail bar) keeps them all in sync. Share and Copy are both
// per-image: they act on THIS panel's own image file, not the other one.
function imageCell(label, url, dlName, id, shareText) {
  const cell = el(`<div class="panel-cell"><div class="panel-label">${label}</div><div class="panel">${url ? `<img src="${url}" alt="" class="zoomable" decoding="async">` : `<div class="missing">${label} not available</div>`}</div></div>`);
  if (url) {
    const fav = store.isFav(id);
    const actions = el(`<div class="img-actions">
      <button class="img-act img-fav ${fav ? "active" : ""}" data-id="${id}" title="${fav ? "In Favorites" : "Add to Favorites"}" aria-label="Add to Favorites">${HEART_ICON}</button>
      <button class="img-act img-share" data-id="${id}" title="Share" aria-label="Share">${SHARE_ICON}</button>
      <a class="img-act img-download" href="${url}" download="${dlName}" title="Download image" aria-label="Download image">${DOWNLOAD_ICON}</a>
      <button class="img-act img-copy" title="Copy image" aria-label="Copy image">${COPY_ICON}</button>
    </div>`);
    // stopPropagation on each so a click acts on the button, not the lightbox.
    actions.querySelector(".img-fav").addEventListener("click", (ev) => { ev.stopPropagation(); toggleFavFor(id); });
    actions.querySelector(".img-share").addEventListener("click", (ev) => { ev.stopPropagation(); shareImage(url, dlName, shareText); });
    actions.querySelector(".img-download").addEventListener("click", (ev) => ev.stopPropagation());
    actions.querySelector(".img-copy").addEventListener("click", (ev) => { ev.stopPropagation(); copyImageToClipboard(url); });
    cell.querySelector(".panel").appendChild(actions);
  }
  return cell;
}

// One transcript panel with a copy button in the right corner.
function transcriptCell(label, text, emptyMsg) {
  const cell = el(`<div class="panel-cell"><div class="panel-label">${label}</div><div class="panel">${text ? `<div class="ptext">${escapeHtml(text)}</div>` : `<div class="missing">${emptyMsg}</div>`}</div></div>`);
  if (text) {
    const btn = el(`<button class="txt-copy" title="Copy text" aria-label="Copy text">${COPY_ICON}</button>`);
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); toast("Text copied"); } catch { toast("Couldn't copy text"); }
    });
    cell.querySelector(".panel").appendChild(btn);
  }
  return cell;
}

function buildDetail(e, opts = {}) {
  const ctx = opts.context || "page";
  const wrap = document.createElement("div");
  const fav = store.isFav(e.id);
  const dotsSvg = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`;
  const head = el(`<div class="detail-bar">
    <span class="back">‹ Back to list</span>
    <div class="detail-bar-right">
      <div class="idblock"><div class="did">${e.id}</div><div class="dmeta">${fmtDate(e.date)} · ${e.weekday || ""}</div></div>
      <button class="btn ${fav ? "active" : ""}" data-fav data-id="${e.id}" title="${fav ? "In Favorites" : "Add to Favorites"}">${HEART_ICON}<span>${fav ? "In Favorites" : "Add to Favorites"}</span></button>
      <button class="btn icon-only" data-more>${dotsSvg}</button>
    </div></div>`);
  wrap.appendChild(head);

  const imgs = el(`<div class="dual"></div>`);
  imgs.appendChild(imageCell("Hindi (Original)", e.img_hi_url, `${e.id}_Hin.jpg`, e.id,
    shareCaption(e.topic_hi, e.body_hi, "बाबास्वामी", e.date)));
  imgs.appendChild(imageCell("English (Original)", e.img_en_url, `${e.id}_Eng.jpg`, e.id,
    shareCaption(e.topic_en, e.body_en, "Baba Swami", e.date)));
  wrap.appendChild(imgs);

  // Rare "second message of the same day" — surfaced as a small box that pops
  // the extra image(s) in the lightbox, so the main view stays clean.
  if (Array.isArray(e.extras) && e.extras.length) {
    const EXTRA_ICO = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h9l5 5v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/></svg>`;
    const box = el(`<div class="extra-msg"><span class="xm-ico">${EXTRA_ICO}</span><span class="xm-label">This day has an extra message.</span><span class="xm-links"></span></div>`);
    const links = box.querySelector(".xm-links");
    e.extras.forEach((x) => {
      const lang = x.lang === "hi" ? " (Hindi)" : x.lang === "en" ? " (English)" : "";
      const btn = el(`<button class="xm-view" type="button">View extra message${lang}</button>`);
      btn.addEventListener("click", () => openLightbox(x.url));
      links.appendChild(btn);
    });
    wrap.appendChild(box);
  }

  const txEn = e.disp_en || e.body_en;
  const txHi = e.disp_hi || e.body_hi;
  const txSection = el(`<section class="transcript-section collapsible">
    <div class="section-head"><h2>Transcripts</h2><div class="sh-actions"><button class="collapse-toggle" title="Collapse" aria-label="Collapse">▾</button></div></div>
    <div class="collapse-body"><div class="dual transcripts"></div></div>
  </section>`);
  const tx = txSection.querySelector(".transcripts");
  tx.appendChild(transcriptCell("Hindi (Transcript)", txHi, "No Hindi transcript"));
  tx.appendChild(transcriptCell("English (Transcript)", txEn, "No English transcript"));
  wireCollapsible(txSection);
  wrap.appendChild(txSection);

  wrap.querySelectorAll(".panel img.zoomable").forEach((im) => im.addEventListener("click", () => openLightbox(im.src)));

  if (ctx === "page") wrap.appendChild(commentsSection(e.id));

  head.querySelector(".back").addEventListener("click", () => (ctx === "home" ? selectStage(null) : history.back()));
  head.querySelector("[data-fav]").addEventListener("click", () => toggleFavFor(e.id));
  head.querySelector("[data-more]").addEventListener("click", () => toast("More options — coming soon"));
  return wrap;
}

function commentsSection(id) {
  const sec = el(`<div class="comments"><h3>My Comments</h3>
    <textarea placeholder="Write a private note or reflection on this Guru's msg…"></textarea>
    <div class="crow"><button class="btn primary" id="add-comment">Add note</button></div>
    <div class="comment-list"></div></div>`);
  const ta = sec.querySelector("textarea"); const listEl = sec.querySelector(".comment-list");
  function renderList() {
    listEl.innerHTML = "";
    const list = store.comments(id);
    if (!list.length) { listEl.appendChild(el(`<div class="page-sub" style="margin:0">No notes yet — your reflections are saved privately in this browser.</div>`)); return; }
    list.forEach((c) => {
      const item = el(`<div class="comment"><div class="ctime"><span>${new Date(c.ts).toLocaleString()}</span><button>Delete</button></div><div class="ctext">${escapeHtml(c.text)}</div></div>`);
      item.querySelector("button").addEventListener("click", () => { store.deleteComment(id, c.ts); renderList(); });
      listEl.appendChild(item);
    });
  }
  sec.querySelector("#add-comment").addEventListener("click", () => { const t = ta.value.trim(); if (!t) return; store.addComment(id, t); ta.value = ""; renderList(); });
  renderList();
  return sec;
}

// --------------------------------------------------------------------------
// Community helpers
// --------------------------------------------------------------------------
const COMMUNITY_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

function timeAgo(isoStr) {
  if (!isoStr) return "";
  const diff = Date.now() - new Date(isoStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + "h ago";
  const d = Math.floor(hr / 24);
  return d < 7 ? d + "d ago" : fmtDate(isoStr.slice(0, 10));
}

// --------------------------------------------------------------------------
// Sadhak's Conclusion — moderator's note per wisdom (server-stored). Not
// currently reachable from any UI (its only entry point was the removed
// Explore dial's "Sadhak's Conclusion" tab) — the functions below are kept
// since renderStage/renderEntry/showDetail still harmlessly no-op-call them
// (guarded on a #conc-panel-body that no longer gets created).
// --------------------------------------------------------------------------

let _stageId = null;         // the wisdom currently shown on the home stage
// Set while a search-result's detail view is open (to whatever restores the
// list); null while the list itself is showing. Lets Escape / the global
// keydown handler find "go back to list" without route()-specific plumbing.
let _searchBackFn = null;

// Compact read-only summary of a conclusion (for the right-column box).
function conclusionSummaryHtml(d) {
  if (!d || !d.exists) return `<div class="conc-empty">No conclusion shared yet.${d && d.can_edit ? " Expand to write one." : ""}</div>`;
  if (d.locked) return `<div class="conc-locked">🔒 Members-only conclusion. Sign in as a member to read it.</div>`;
  const badge = d.visibility === "community" ? `<span class="conc-badge members">Members only</span>` : `<span class="conc-badge public">Public</span>`;
  const meta = [d.author ? "by " + escapeHtml(d.author) : "", d.updated ? timeAgo(d.updated) : ""].filter(Boolean).join(" · ");
  return `<div class="conc-content">${escapeHtml(d.text).replace(/\n/g, "<br>")}</div>
    <div class="conc-meta">${badge}${meta ? `<span class="conc-by">${meta}</span>` : ""}</div>`;
}

async function loadConclusion(id) {
  const box = document.getElementById("conc-body-compact");
  if (!box) return;
  if (!id) { box.innerHTML = `<div class="conc-empty">Select a Guru's msg to see its conclusion.</div>`; return; }
  box.innerHTML = `<div class="loading">Loading…</div>`;
  try { const d = await WA.getConclusion(id); box.innerHTML = conclusionSummaryHtml(d); }
  catch { box.innerHTML = `<div class="conc-empty">No conclusion shared yet.</div>`; }
}

async function saveConclusion(id, text, visibility) {
  return await WA.saveConclusion(id, text, visibility);
}

async function modSignIn(identifier, password) {
  const d = await WA.login(identifier, password);
  store.setToken(d.token);
  try { localStorage.setItem("wa:user", JSON.stringify(d.user)); } catch {}
  return d.user;
}

async function modSignUp(username, email, password) {
  const d = await WA.register(username, email, password);
  store.setToken(d.token);
  try { localStorage.setItem("wa:user", JSON.stringify(d.user)); } catch {}
  return d.user;
}

// Moderator editor inside the panel.
function renderConclusionEditor(body, id, d) {
  const text = d.exists && !d.locked ? (d.text || "") : "";
  const vis = d.visibility || "public";
  body.innerHTML = `<div class="conc-edit">
    <label class="conc-label">Your conclusion for Guru's msg #${escapeHtml(String(id))}</label>
    <textarea class="conc-textarea" placeholder="Write the conclusion drawn from the community's discussion…">${escapeHtml(text)}</textarea>
    <div class="conc-vis">
      <span>Visibility:</span>
      <label><input type="radio" name="conc-vis" value="public" ${vis !== "community" ? "checked" : ""}> Public</label>
      <label><input type="radio" name="conc-vis" value="community" ${vis === "community" ? "checked" : ""}> Members only</label>
    </div>
    <div class="conc-actions">
      <button class="btn primary conc-save">Save conclusion</button>
      ${d.exists ? `<button class="btn conc-clear">Clear</button>` : ""}
      <button class="btn conc-signout">Sign out</button>
    </div>
    <div class="conc-result"></div>
  </div>`;
  const ta = body.querySelector(".conc-textarea");
  const result = body.querySelector(".conc-result");
  body.querySelector(".conc-save").addEventListener("click", async () => {
    const v = body.querySelector('input[name="conc-vis"]:checked').value;
    try { await saveConclusion(id, ta.value, v); result.innerHTML = `<div class="conc-ok">✓ Saved.</div>`; toast("Conclusion saved"); loadConclusion(id); }
    catch (err) { result.innerHTML = `<div class="conc-err">${escapeHtml(err.message)}</div>`; }
  });
  const clear = body.querySelector(".conc-clear");
  if (clear) clear.addEventListener("click", async () => {
    try { await saveConclusion(id, "", body.querySelector('input[name="conc-vis"]:checked').value); ta.value = ""; result.innerHTML = `<div class="conc-ok">Conclusion cleared.</div>`; toast("Cleared"); loadConclusion(id); }
    catch (err) { result.innerHTML = `<div class="conc-err">${escapeHtml(err.message)}</div>`; }
  });
  body.querySelector(".conc-signout").addEventListener("click", () => { WA.logout(); store.setToken(""); try { localStorage.removeItem("wa:user"); } catch {} refreshModNav(); renderConclusionPanelBody(id); loadConclusion(id); toast("Signed out"); });
}

// A password input wrapped with a show/hide eye toggle (handled by a delegated
// click listener wired once in init).
const PW_EYE = `<button type="button" class="pw-eye" aria-label="Show password" tabindex="-1">
  <svg class="eye-on" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
  <svg class="eye-off" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M3 3l18 18"/><path d="M10.6 6.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.1M6.5 7.6A18 18 0 0 0 2 12s3.5 7 10 7a10.6 10.6 0 0 0 3.5-.6"/><path d="M9.5 9.6a3 3 0 0 0 4.2 4.2"/></svg>
</button>`;
function pwField(cls, placeholder, autocomplete) {
  return `<div class="pw-wrap"><input class="${cls}" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}">${PW_EYE}</div>`;
}

// Sign-in + sign-up form (used by the Conclusion tab and the Moderator page).
function modSignInHtml() {
  return `<div class="conc-signin authbox">
    <div class="auth-view auth-signin">
      <div class="conc-signin-h">Sign in</div>
      <div class="conc-signin-sub">Sign in to your account.</div>
      <input class="conc-id" type="email" placeholder="Email" autocomplete="email">
      ${pwField("conc-pw", "Password", "current-password")}
      <button class="btn primary conc-login">Sign in</button>
      <div class="conc-login-result"></div>
      <div class="auth-alt">New here? <a class="auth-to-signup">Create an account</a></div>
    </div>
    <div class="auth-view auth-signup" hidden>
      <div class="conc-signin-h">Create account</div>
      <div class="conc-signin-sub">Register to join the community.</div>
      <input class="su-user" type="text" placeholder="Username (3–20 letters, numbers, _)" autocomplete="username">
      <input class="su-email" type="email" placeholder="Email" autocomplete="email">
      ${pwField("su-pw", "Password (min 6 characters)", "new-password")}
      <button class="btn primary su-submit">Create account</button>
      <div class="su-result"></div>
      <div class="auth-alt">Already have an account? <a class="auth-to-signin">Sign in</a></div>
    </div>
  </div>`;
}

function wireModSignIn(body, onSuccess) {
  onSuccess = onSuccess || function () {};
  const signinView = body.querySelector(".auth-signin");
  const signupView = body.querySelector(".auth-signup");
  const toSignup = body.querySelector(".auth-to-signup");
  const toSignin = body.querySelector(".auth-to-signin");
  if (toSignup) toSignup.addEventListener("click", () => { signinView.hidden = true; signupView.hidden = false; });
  if (toSignin) toSignin.addEventListener("click", () => { signupView.hidden = true; signinView.hidden = false; });

  // Sign in
  const btn = body.querySelector(".conc-login");
  if (btn) {
    const res = body.querySelector(".conc-login-result");
    const submit = async () => {
      const identifier = body.querySelector(".conc-id").value.trim();
      const password = body.querySelector(".conc-pw").value;
      if (!identifier || !password) { res.innerHTML = `<div class="conc-err">Enter your email and password.</div>`; return; }
      btn.disabled = true; btn.textContent = "Signing in…";
      try { const user = await modSignIn(identifier, password); refreshModNav(); toast("Signed in as " + user.username); onSuccess(); }
      catch (err) { res.innerHTML = `<div class="conc-err">${escapeHtml(err.message)}</div>`; btn.disabled = false; btn.textContent = "Sign in"; }
    };
    btn.addEventListener("click", submit);
    body.querySelector(".conc-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  // Sign up
  const sbtn = body.querySelector(".su-submit");
  if (sbtn) {
    const sres = body.querySelector(".su-result");
    const submit = async () => {
      const username = body.querySelector(".su-user").value.trim();
      const email = body.querySelector(".su-email").value.trim();
      const password = body.querySelector(".su-pw").value;
      if (!username || !email || !password) { sres.innerHTML = `<div class="conc-err">Fill in all fields.</div>`; return; }
      sbtn.disabled = true; sbtn.textContent = "Creating…";
      try { const user = await modSignUp(username, email, password); refreshModNav(); toast("Welcome, " + user.username); onSuccess(); }
      catch (err) { sres.innerHTML = `<div class="conc-err">${escapeHtml(err.message)}</div>`; sbtn.disabled = false; sbtn.textContent = "Create account"; }
    };
    sbtn.addEventListener("click", submit);
    body.querySelector(".su-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }
}

async function renderConclusionPanelBody(id) {
  const body = document.getElementById("conc-panel-body");
  if (!body) return;
  if (!id) { body.innerHTML = `<div class="conc-empty" style="padding:30px">Open a Guru's msg on the home page to see or write its conclusion.</div>`; return; }
  body.innerHTML = `<div class="loading" style="padding:24px">Loading…</div>`;
  let d;
  try { d = await WA.getConclusion(id); }
  catch { body.innerHTML = `<div class="conc-empty" style="padding:30px">Couldn't load the conclusion.</div>`; return; }

  if (d.can_edit) { renderConclusionEditor(body, id, d); return; }

  let html = "";
  if (!d.exists) html = `<div class="conc-empty" style="padding:30px 24px 8px">No conclusion has been written for this Guru's msg yet.</div>`;
  else if (d.locked) html = `<div class="conc-locked" style="margin:22px">🔒 This conclusion is for community members only.</div>`;
  else {
    const badge = d.visibility === "community" ? `<span class="conc-badge members">Members only</span>` : `<span class="conc-badge public">Public</span>`;
    const meta = [d.author ? "by " + escapeHtml(d.author) : "", d.updated ? timeAgo(d.updated) : ""].filter(Boolean).join(" · ");
    html = `<div class="conc-read"><div class="conc-read-meta">${badge}${meta ? `<span class="conc-by">${meta}</span>` : ""}</div>
      <div class="conc-read-text">${escapeHtml(d.text).replace(/\n/g, "<br>")}</div></div>`;
  }
  html += modSignInHtml();
  body.innerHTML = html;
  wireModSignIn(body, () => { renderConclusionPanelBody(id); loadConclusion(id); });
}

// --------------------------------------------------------------------------
// Home dashboard
// --------------------------------------------------------------------------
async function renderHome(params) {
  const nav = _nav;
  $view.innerHTML = `<div class="loading">Loading…</div>`;
  const latest = await api("/api/latest?limit=14");
  if (!current(nav)) return;
  const items = latest.results;
  if (!items.length) { $view.innerHTML = `<div class="empty">No Guru's msg yet. Add folders and run the importer.</div>`; return; }
  // Every fresh open of Home shows the latest wisdom. `sel` only carries a
  // specific entry across an in-session refresh (set via history.replaceState
  // in selectStage()) — it does not persist across a real app restart, so
  // opening the app never reopens whatever you happened to view last time.
  const forceLatest = params.get("latest") === "1";
  const sel = forceLatest ? items[0].id : (params.get("sel") || items[0].id);

  // The Latest / Recent / Conclusion / Community panels now live in the global
  // right sidebar (app shell). Home is just the big reading stage.
  const wrap = el(`<div class="home-wrap"></div>`);
  const stage = el(`<section class="stage" id="stage"></section>`);
  const main = el(`<div class="home-main"></div>`);
  main.appendChild(stage);
  wrap.appendChild(main);

  $view.replaceChildren(wrap);
  renderStage(sel);
}

// The old docked side-panel was removed (replaced by the floating "+" panel),
// but route() and the community feed still call this to close any open overlay,
// so it stays as a harmless no-op (always null) rather than scattering guards.
let _sidePanelClose = null;

// --------------------------------------------------------------------------
// Chat markdown renderer — escapes HTML first, then applies safe inline markup
// --------------------------------------------------------------------------
function renderMarkdown(text) {
  let s = escapeHtml(text);
  s = s.replace(/==(.+?)==/gs, '<mark class="chat-hl">$1</mark>');
  s = s.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  return s.replace(/\n/g, '<br>');
}

function insertAtCursor(ta, text) {
  ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
  ta.focus();
}

function wrapSelection(ta, before, after) {
  const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
  ta.setRangeText(before + sel + after, s, e, 'end');
  if (!sel) { ta.selectionStart = ta.selectionEnd = s + before.length; }
  ta.focus();
}

const CHAT_EMOJIS = ['😊','😂','🙏','❤️','👍','🙌','✨','🌟','💡','🔥','🌺','🕉️','☀️','🌸','💎','🦋','📿','🌿','💫','🎯','👁️','🌈','💜','🎵','🧘','🪷','🌙','⭐','🕊️','🙏🏽','🤍','🫶','🌊','🍃','🦚'];

// --------------------------------------------------------------------------
// Community tab — per-wisdom chat when a wisdom is open, recent feed otherwise
// --------------------------------------------------------------------------
async function renderCommunityTab(body) {
  const chatTarget = _stageId || store.lastViewed();
  if (chatTarget) {
    await renderWisdomChat(body, chatTarget);
  } else {
    // No wisdom selected — show global recent feed
    body.innerHTML = `<div class="cp-feed-wrap" id="cp-feed-wrap"><div class="loading" style="padding:24px">Loading…</div></div>`;
    const wrap = body.querySelector("#cp-feed-wrap");
    try {
      const data = await WA.communityRecent(20);
      if (!data.messages || !data.messages.length) {
        wrap.innerHTML = `<div class="comm-panel-empty">
          <div class="cpe-ico">${COMMUNITY_ICON}</div>
          <div class="cpe-h">No discussions yet</div>
          <div class="cpe-sub">Open a Guru's msg and join the discussion!</div>
        </div>`;
        return;
      }
      wrap.innerHTML = "";
      data.messages.forEach((m) => {
        const item = el(`<div class="cp-msg">
          <div class="cpm-avatar">${escapeHtml((m.user || "?")[0].toUpperCase())}</div>
          <div class="cpm-body">
            <div class="cpm-meta">
              <span class="cpm-user">${escapeHtml(m.user || "")}</span>
              <a class="cpm-wid" data-wid="${escapeHtml(m.wid)}" href="#">Guru's msg #${escapeHtml(m.wid)}</a>
              <span class="cpm-time">${timeAgo(m.ts)}</span>
            </div>
            <div class="cpm-text">${renderMarkdown(m.text || "")}</div>
          </div>
        </div>`);
        item.querySelector(".cpm-wid").addEventListener("click", (e) => { e.preventDefault(); if (_sidePanelClose) _sidePanelClose(); go(`#/entry/${m.wid}`); });
        wrap.appendChild(item);
      });
    } catch {
      wrap.innerHTML = `<div class="comm-empty" style="padding:28px">Could not load community feed.</div>`;
    }
  }
}

// ---- live chat (Server-Sent Events): one open stream per viewed wisdom ----
let _chatStream = null;

function closeChatStream() {
  if (_chatStream) { try { _chatStream.close(); } catch {} _chatStream = null; }
}

// Single source of truth for a message bubble — used by the initial render,
// our own optimistic send, and incoming live messages, so they all match.
function buildChatMsgEl(m, ctx) {
  const isMe = m.user === ctx.me;
  const msgEl = el(`<div class="wc-msg ${isMe ? "wc-msg-me" : ""}" data-mid="${escapeHtml(m.id || "")}">
    <div class="wc-avatar">${escapeHtml((m.user || "?")[0].toUpperCase())}</div>
    <div class="wc-bubble">
      <div class="wc-meta">
        <span class="wc-user">${escapeHtml(m.user || "")}</span>
        <span class="wc-time">${timeAgo(m.ts)}</span>
        ${ctx.canModerate ? `<button class="wc-del" title="Delete">✕</button>` : ""}
      </div>
      <div class="wc-text">${renderMarkdown(m.text || "")}</div>
    </div>
  </div>`);
  if (ctx.canModerate) {
    msgEl.querySelector(".wc-del").addEventListener("click", async () => {
      if (!confirm("Delete this message?")) return;
      try {
        await WA.deleteMessage(ctx.wid, m.id);
        msgEl.remove();   // remove now; the live stream also removes it for everyone else
      } catch { toast("Could not delete message."); }
    });
  }
  return msgEl;
}

function renderChatMessages(msgsEl, messages, ctx) {
  if (!messages || !messages.length) {
    msgsEl.innerHTML = `<div class="wc-empty">No messages yet — be the first to share a reflection!</div>`;
    return;
  }
  msgsEl.innerHTML = "";
  messages.forEach((m) => msgsEl.appendChild(buildChatMsgEl(m, ctx)));
  msgsEl.scrollTop = msgsEl.scrollHeight;
}

// Append one message live, skipping it if it's already on screen (e.g. our own
// optimistic copy echoed back by the stream). Keeps the view pinned to the
// bottom if the reader was already there, or if it's their OWN message (you
// always want to see what you just sent) — otherwise surfaces the small
// "↓" jump button instead of yanking them down from what they're reading.
function chatAppendLive(msgsEl, m, ctx) {
  if (m.id && msgsEl.querySelector(`[data-mid="${m.id}"]`)) return;
  const empty = msgsEl.querySelector(".wc-empty");
  if (empty) msgsEl.innerHTML = "";
  const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80;
  const isMe = m.user === ctx.me;
  msgsEl.appendChild(buildChatMsgEl(m, ctx));
  if (isMe || nearBottom) {
    msgsEl.scrollTop = msgsEl.scrollHeight;
  } else {
    const newMsgBtn = msgsEl.parentElement && msgsEl.parentElement.querySelector("#wc-new-msg");
    if (newMsgBtn) newMsgBtn.hidden = false;
  }
}

function openChatStream(wid, msgsEl, ctx) {
  closeChatStream();
  if (!isSignedIn()) return;   // not signed in; the manual refresh button still works
  // Live updates via Supabase Realtime (replaces the old SSE stream). Clearing a
  // chat deletes its rows, which arrive here as individual delete events.
  _chatStream = WA.subscribeChat(wid, {
    onMessage: (m) => chatAppendLive(msgsEl, m, ctx),
    onDelete: (id) => {
      const node = msgsEl.querySelector(`[data-mid="${id}"]`);
      if (node) node.remove();
      if (!msgsEl.querySelector(".wc-msg")) {
        msgsEl.innerHTML = `<div class="wc-empty">No messages yet — be the first to share a reflection!</div>`;
      }
    },
  });
}

async function renderWisdomChat(body, wid) {
  closeChatStream();
  body.innerHTML = `<div class="wc-wrap">
    <div class="wc-hdr">
      <span class="wc-title">${COMMUNITY_ICON} Guru's msg #${escapeHtml(wid)}</span>
      <button class="wc-refresh cp-refresh" title="Refresh">↻</button>
    </div>
    <div class="wc-msgs" id="wc-msgs"><div class="loading" style="padding:20px">Loading…</div></div>
    <button class="wc-new-msg" id="wc-new-msg" type="button" title="New message" aria-label="Jump to new message" hidden>↓</button>
    <div class="wc-foot" id="wc-foot"></div>
  </div>`;

  const wrap = body.querySelector(".wc-wrap");
  const msgsEl = body.querySelector("#wc-msgs");
  const footEl = body.querySelector("#wc-foot");
  const newMsgBtn = body.querySelector("#wc-new-msg");
  body.querySelector(".wc-refresh").addEventListener("click", () => renderWisdomChat(body, wid));
  newMsgBtn.addEventListener("click", () => {
    msgsEl.scrollTop = msgsEl.scrollHeight;
    newMsgBtn.hidden = true;
  });
  // Hide it as soon as the reader scrolls back down themselves, not only on click.
  msgsEl.addEventListener("scroll", () => {
    if (!newMsgBtn.hidden && msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 80) newMsgBtn.hidden = true;
  });

  let data;
  try {
    data = await WA.getChat(wid);
  } catch (err) {
    if (err.code === "AUTH") {
      msgsEl.innerHTML = "";
      const gate = el(`<div class="wc-gate"></div>`);
      gate.innerHTML = modSignInHtml();
      wrap.appendChild(gate);
      wireModSignIn(gate, () => renderWisdomChat(body, wid));
      return;
    }
    if (err.code === "FORBIDDEN") {
      msgsEl.innerHTML = `<div class="wc-negativity">
        <div class="wc-nz-ico">🚫</div>
        <div class="wc-nz-h">Negativity Zone</div>
        <div class="wc-nz-sub">Community discussions are for approved members only.</div>
      </div>`;
      return;
    }
    msgsEl.innerHTML = `<div class="comm-empty" style="padding:24px">Could not load chat.</div>`;
    return;
  }

  // Messages (shared renderer; the live stream reuses the same bubble builder)
  const ctx = { me: data.me, canModerate: !!data.can_moderate, wid, body };
  renderChatMessages(msgsEl, data.messages, ctx);
  openChatStream(wid, msgsEl, ctx);   // live updates for everyone — even muted readers

  // Input area — muted / no credits / normal
  let emojiOpen = false;
  const isMuted = !data.can_moderate && data.is_muted;
  const noCredits = !data.can_moderate && !data.is_muted && data.credits_remaining === 0;

  if (isMuted) {
    footEl.innerHTML = `<div class="wc-muted">🔇 You have been muted by the moderator.</div>`;
  } else if (noCredits) {
    footEl.innerHTML = `<div class="wc-no-credits">
      <span>You've used all your messages.</span>
      <button class="btn wc-req-btn" id="wc-req-credits">Request more</button>
    </div>`;
    footEl.querySelector("#wc-req-credits").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const d = await WA.requestCredits();
        if (d.already_pending) toast("Your request is already pending — the moderator will review it.");
        else toast("Request sent! The moderator will review it.");
      } catch { toast("Could not send request."); e.target.disabled = false; }
    });
  } else {
    const creditsHint = (!data.can_moderate && data.credits_remaining != null)
      ? `<span class="wc-credits">${data.credits_remaining} msg${data.credits_remaining === 1 ? "" : "s"} left</span>` : "";
    footEl.innerHTML = `
      <div class="wc-toolbar">
        <button class="wc-tb-btn" data-wrap="**||**" title="Bold"><strong>B</strong></button>
        <button class="wc-tb-btn" data-wrap="*||*" title="Italic"><em>I</em></button>
        <button class="wc-tb-btn wc-hl-btn" data-wrap="==||==" title="Highlight"><mark class="chat-hl">H</mark></button>
        <button class="wc-tb-btn wc-emoji-btn" title="Emoji">😊</button>
        <div class="wc-emoji-picker" id="wc-emoji-picker"></div>
      </div>
      <div class="wc-compose">
        <textarea class="wc-ta" id="wc-ta" placeholder="Share your reflection… (Enter to send, Shift+Enter for new line)" rows="2"></textarea>
        <button class="wc-send btn primary" id="wc-send">Send</button>
      </div>
      ${creditsHint}
    `;
  }

  if (!isMuted && !noCredits) {
    // Emoji picker. The outside-click listener is only ATTACHED while the
    // picker is actually open (not a one-shot added at render time) — it used
    // to remove itself on the first click anywhere on the page, open or not,
    // so after one unrelated click the picker would stop closing on outside
    // clicks for the rest of the session.
    const picker = footEl.querySelector("#wc-emoji-picker");
    function closeEmojiOnOutsideClick(e) {
      if (!e.target.closest(".wc-emoji-btn") && !e.target.closest("#wc-emoji-picker")) closeEmojiPicker();
    }
    function closeEmojiPicker() {
      picker.classList.remove("open");
      emojiOpen = false;
      document.removeEventListener("click", closeEmojiOnOutsideClick);
    }
    CHAT_EMOJIS.forEach((emoji) => {
      const b = el(`<button class="wc-emoji-item">${emoji}</button>`);
      b.addEventListener("click", () => { insertAtCursor(footEl.querySelector("#wc-ta"), emoji); closeEmojiPicker(); });
      picker.appendChild(b);
    });
    footEl.querySelector(".wc-emoji-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      emojiOpen = !emojiOpen;
      picker.classList.toggle("open", emojiOpen);
      if (emojiOpen) document.addEventListener("click", closeEmojiOnOutsideClick);
      else document.removeEventListener("click", closeEmojiOnOutsideClick);
    });

    // Format buttons
    footEl.querySelectorAll(".wc-tb-btn[data-wrap]").forEach((btn) => {
      btn.addEventListener("click", () => { const [b, a] = btn.dataset.wrap.split("||"); wrapSelection(footEl.querySelector("#wc-ta"), b, a); });
    });

    // Send
    const ta = footEl.querySelector("#wc-ta");
    const sendBtn = footEl.querySelector("#wc-send");
    const doSend = async () => {
      const text = ta.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      try {
        const d = await WA.postMessage(wid, text);
        ta.value = "";
        // Update credits hint without full reload
        if (d.credits_remaining != null) {
          const hint = footEl.querySelector(".wc-credits");
          if (hint) hint.textContent = `${d.credits_remaining} msg${d.credits_remaining === 1 ? "" : "s"} left`;
          if (d.credits_remaining === 0) { renderWisdomChat(body, wid); return; }
        }
        // Show our message at once; the live stream echoes it, but dedup-by-id avoids a double.
        if (d.message) chatAppendLive(msgsEl, d.message, ctx);
        sendBtn.disabled = false;
      } catch (err) {
        if (err.code === "NO_CREDITS" || err.code === "MUTED") { renderWisdomChat(body, wid); return; }
        toast(err.message || "Could not send message."); sendBtn.disabled = false;
      }
    };
    sendBtn.addEventListener("click", doSend);
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });
  }
}

// Click a section header (or its chevron) to collapse/expand its body.
function wireCollapsible(section) {
  const head = section.querySelector(".section-head");
  const toggle = section.querySelector(".collapse-toggle");
  if (!head || !toggle) return;
  const flip = () => section.classList.toggle("collapsed");
  toggle.addEventListener("click", (e) => { e.stopPropagation(); flip(); });
  head.addEventListener("click", (e) => { if (e.target.closest("a")) return; flip(); });
  head.style.cursor = "pointer";
}

function railItem(e) {
  const it = el(`<div class="rail-item" data-id="${e.id}">
    ${thumbImg(e)}
    <div>
      <div class="ri-id">#${e.id}</div>
      <div class="ri-date">${fmtDate(e.date)} · ${e.weekday || ""}</div>
      <div class="ri-topic">${escapeHtml(e.topic_en || e.topic_hi || "")}</div>
      <div class="ri-prev">${escapeHtml(e.preview_en || e.preview_hi || "")}</div>
    </div>
    <button class="heart ${store.isFav(e.id) ? "on" : ""}" title="Favorite">${store.isFav(e.id) ? "♥" : "♡"}</button>
  </div>`);
  it.addEventListener("click", (ev) => { if (ev.target.closest(".heart")) return; selectStage(e.id); });
  it.querySelector(".heart").addEventListener("click", (ev) => { ev.stopPropagation(); const on = store.toggleFav(e.id); ev.currentTarget.classList.toggle("on", on); ev.currentTarget.textContent = on ? "♥" : "♡"; });
  return it;
}

function selectStage(id) {
  // On the home page the selection drives the big reading stage; anywhere else
  // (the right sidebar is global now) open the full entry page instead.
  const st = document.querySelector("#stage");
  if (!st) { if (id) go(`#/entry/${id}`); return; }
  history.replaceState(null, "", id ? `#/?sel=${id}` : "#/");
  renderStage(id);
  if (id) st.scrollIntoView({ behavior: "smooth", block: "nearest" });
}


async function renderStage(id) {
  const stage = document.querySelector("#stage"); if (!stage) return;
  _stageId = id || null;
  document.querySelectorAll(".rail-item").forEach((r) => r.classList.toggle("active", r.dataset.id === String(id)));
  if (!id) {
    stage.innerHTML = `<div class="empty-stage">Select a Guru's msg from the list to read it here.</div>`;
    updateIdNav(null);
    loadConclusion(null);
    if (document.getElementById("conc-panel-body")) renderConclusionPanelBody(null);
    return;
  }
  stage.innerHTML = `<div class="loading">Loading…</div>`;
  let e; try { e = await api("/api/entry/" + id); } catch {
    stage.innerHTML = `<div class="empty-stage">Not found.</div>`; updateIdNav(null); loadConclusion(null); return;
  }
  store.setLastViewed(id);   // remember it so a refresh reopens this wisdom, not the latest
  const detail = buildDetail(e, { context: "home" });
  stage.replaceChildren(detail);
  updateIdNav(e.id, e.date);
  dropStageDetailBar(detail);   // id/date now in the ID button; fav/share on the images
  wireCarousel(detail, id);     // ‹ › arrows over the images to step to the prev/next dated wisdom
  // Refresh the per-wisdom Sadhak's Conclusion if it's open (right sidebar or overlay).
  loadConclusion(id);
  if (document.getElementById("conc-panel-body")) renderConclusionPanelBody(id);
}

// Left/right carousel arrows over the Hindi/English image pair. Generic:
// takes a click callback rather than assuming Home's date-based navigation,
// so the same button also works for the search-results-scoped carousel
// (steps by position in that list instead of by date). Only rendered on
// whichever side something actually exists to step to — no dot indicators.
const CHEVRON_LEFT = '<path d="M15 5l-7 7 7 7"/>';
const CHEVRON_RIGHT = '<path d="M9 5l7 7-7 7"/>';
function carouselArrow(dir, onClick) {
  const path = dir === "prev" ? CHEVRON_LEFT : CHEVRON_RIGHT;
  const label = dir === "prev" ? "Previous Guru's msg" : "Next Guru's msg";
  const btn = el(`<button class="carousel-arrow carousel-${dir}" type="button" title="${label}" aria-label="${label}">
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
  </button>`);
  btn.addEventListener("click", onClick);
  return btn;
}
async function wireCarousel(detail, id) {
  const dual = detail.querySelector(".dual");
  if (!dual) return;
  let neighbors;
  try { neighbors = await api("/api/entry/" + encodeURIComponent(id) + "/neighbors"); }
  catch { return; }
  if (_stageId !== id) return;   // a newer selection superseded this
  if (neighbors.older_id) dual.appendChild(carouselArrow("prev", () => selectStage(neighbors.older_id)));
  if (neighbors.newer_id) dual.appendChild(carouselArrow("next", () => selectStage(neighbors.newer_id)));
}

// The wisdom's id + date now live in the "ID" button, and its Favorite/Share
// actions live on the images — so the home stage just drops the inline detail
// bar (nothing is lifted into the topbar anymore).
function dropStageDetailBar(detail) {
  const bar = detail.querySelector(".detail-bar");
  if (bar) bar.remove();
}

async function initQuickStats() {
  const pop = document.getElementById("qs-pop");
  const wrap = document.getElementById("qs-wrap");
  if (!pop || !wrap) return;
  let stats = { total: "–", this_year: "–", days_covered: "–" };
  try { stats = await api("/api/stats"); } catch {}
  const yr = new Date().getFullYear();
  const row = (ico, num, label, route) => `<div class="qs-row${route ? " qs-row-link" : ""}"${route ? ` data-route="${route}"` : ""}><div class="sico">${ico}</div><div><div class="snum">${num}</div><div class="slabel">${label}</div></div></div>`;
  const render = () => {
    pop.innerHTML =
      row("📖", stats.total, "Total Guru's Msgs") +
      row("📅", stats.this_year, "This Year (" + yr + ")") +
      row("♡", store.favs().length, "Favorites", "favorites") +
      row("🕐", stats.days_covered, "Days Covered");
  };
  render();
  wrap.addEventListener("mouseenter", render); // refresh live Favorites count
  // Clicking a linked stat row (Favorites) jumps to that page.
  pop.addEventListener("click", (e) => {
    const r = e.target.closest(".qs-row-link");
    if (r && r.dataset.route) go("#/" + r.dataset.route);
  });
}

function cardGrid(items) {
  if (!items.length) return el(`<div class="empty">Nothing here yet.</div>`);
  const grid = el(`<div class="grid"></div>`);
  items.forEach((e) => {
    const card = el(`<div class="card" data-id="${e.id}">
      ${thumbImg(e)}
      <div class="cbody"><div class="cid">#${e.id}</div><div class="cdate">${fmtDate(e.date)} · ${e.weekday || ""}</div>
      <div class="ctopic">${escapeHtml(e.topic_en || e.topic_hi || "")}</div></div></div>`);
    card.addEventListener("click", () => go(`#/entry/${e.id}`));
    grid.appendChild(card);
  });
  return grid;
}

// --------------------------------------------------------------------------
// Shared thumbnail-list + Home-style detail view (Search results, Favorites)
// --------------------------------------------------------------------------
// A generic "‹ label" button — used at the top of any results list that
// returns to Home.
function backBtn(label, onClick) {
  const b = el(`<button class="arch-back-btn" type="button">${label}</button>`);
  b.addEventListener("click", onClick);
  return b;
}
// Search's own back button additionally clears the query/UI before leaving.
function searchBackBtn() {
  return backBtn("‹ Back", () => {
    if (searchInput) searchInput.value = "";
    searchClear.style.display = "none";
    document.getElementById("app").classList.remove("search-reveal");
    go("#/");
  });
}

// Renders a thumbnail-based results list, and — when a thumbnail is clicked —
// its Home-style detail view (dual image + transcript, carousel scoped to
// THIS list by position, "‹ Back to list" + Escape to return). Shared by
// Search and Favorites so both stay visually and behaviorally identical.
//
// items: array of row-shaped objects, each with at least
//   {id, date, weekday, topic_en, topic_hi, thumb_url}
// opts:
//   nav          — the caller's route-generation token (from `const nav = _nav`),
//                  so a stale async response from an abandoned route is dropped.
//   backButton   — element shown above the list (or null for none).
//   header       — element shown above the list, below backButton (or null).
//   emptyMsg     — shown instead of the list when items is empty.
//   snippet(item, lang) — returns ready-to-insert HTML for that language's
//                  column ("hi"/"en"); defaults to plain escaped body text.
//   fetchEntry(item) — resolves the FULL entry for the detail view. Search
//                  fetches it lazily (list rows don't carry images); Favorites
//                  already has it, so this can just return item directly.
function renderThumbList(items, opts) {
  const { nav, backButton, header, emptyMsg, fetchEntry } = opts;
  const snippet = opts.snippet || ((item, lang) => escapeHtml(item[`body_${lang}`] || ""));

  function showList() {
    _searchBackFn = null;
    _stageId = null;
    updateIdNav(null);
    if (document.getElementById("conc-panel-body")) renderConclusionPanelBody(null);
    const wrap = el(`<div class="flush-top"></div>`);
    if (backButton) wrap.appendChild(backButton);
    if (header) wrap.appendChild(header);
    if (!items.length) { wrap.appendChild(el(`<div class="empty">${emptyMsg}</div>`)); $view.replaceChildren(wrap); return; }
    const list = el(`<div class="results"></div>`);
    // Render in chunks: a common search word (or a long favorites list) can
    // match/hold hundreds of entries, and each row runs a highlight regex
    // over both transcripts — rendering them all at once janks the page.
    const CHUNK = 60;
    let shown = 0;
    const moreBtn = el(`<button class="btn load-more" style="display:block;margin:18px auto">Show more results</button>`);
    function renderChunk() {
      items.slice(shown, shown + CHUNK).forEach((r, idx) => {
        const i = shown + idx;
        const row = el(`<div class="result" data-id="${r.id}">
          <div class="meta">${thumbImg(r)}<div class="rdate">${fmtDate(r.date)}<br>${r.weekday || ""}</div>${(r.topic_en || r.topic_hi) ? `<div class="rtopic">${escapeHtml(r.topic_en || r.topic_hi)}</div>` : ""}</div>
          <div class="lang-col"><div class="lang-label">Hindi</div>${r.body_hi ? `<div class="wisdom-text hi">${snippet(r, "hi")}</div>` : `<div class="page-sub" style="margin:0">—</div>`}</div>
          <div class="lang-col"><div class="lang-label">English</div>${r.body_en ? `<div class="wisdom-text">${snippet(r, "en")}</div>` : `<div class="page-sub" style="margin:0">—</div>`}</div>
        </div>`);
        const thumb = row.querySelector(".thumb");
        if (thumb) thumb.addEventListener("click", () => showDetail(i));
        list.appendChild(row);
        attachReadMore(row);
      });
      shown = Math.min(shown + CHUNK, items.length);
      moreBtn.textContent = `Show more results (${items.length - shown} left)`;
      if (shown >= items.length) moreBtn.remove();
    }
    moreBtn.addEventListener("click", renderChunk);
    wrap.appendChild(list);
    wrap.appendChild(moreBtn);
    $view.replaceChildren(wrap);
    renderChunk();   // first batch
  }

  let detailToken = 0;
  async function showDetail(i) {
    const token = ++detailToken;
    let e;
    try { e = await fetchEntry(items[i]); }
    catch { toast("Couldn't load that Guru's msg."); return; }
    if (token !== detailToken || !current(nav)) return;   // superseded or navigated away

    _stageId = e.id;   // so the right-sidebar Conclusion panel + topbar ID button target this wisdom
    updateIdNav(e.id, e.date);

    // home-wrap matches Home's wider layout; flush-top zeroes the page's
    // usual top padding so "Back to list" sits flush under the topbar.
    const wrap = el(`<div class="home-wrap flush-top"></div>`);
    const back = el(`<button class="arch-back-btn" type="button">‹ Back to list</button>`);
    back.addEventListener("click", showList);
    _searchBackFn = showList;
    wrap.appendChild(back);

    const detail = buildDetail(e, { context: "home" });
    dropStageDetailBar(detail);   // same trimming Home's stage uses
    const dual = detail.querySelector(".dual");
    if (dual) {
      if (i > 0) dual.appendChild(carouselArrow("prev", () => showDetail(i - 1)));
      if (i < items.length - 1) dual.appendChild(carouselArrow("next", () => showDetail(i + 1)));
    }
    wrap.appendChild(detail);
    $view.replaceChildren(wrap);
    loadConclusion(e.id);
    if (document.getElementById("conc-panel-body")) renderConclusionPanelBody(e.id);
    window.scrollTo(0, 0);
  }

  showList();
}

async function renderSearch(q) {
  if (document.activeElement !== searchInput) searchInput.value = q;
  searchClear.style.display = q ? "block" : "none";
  document.getElementById("kbd-hint").style.display = q ? "none" : "block";
  if (!q.trim()) {
    $view.innerHTML = `<div class="page-title">Search</div><div class="empty">Type a word above to search every English and Hindi transcript.</div>`;
    $view.prepend(searchBackBtn());
    return;
  }
  const nav = _nav;
  $view.innerHTML = `<div class="loading">Searching “${escapeHtml(q)}”…</div>`;
  const data = await api("/api/search?q=" + encodeURIComponent(q));
  if (!current(nav)) return;

  renderThumbList(data.results, {
    nav,
    backButton: searchBackBtn(),
    header: el(`<div class="page-head"><div class="page-title">Search Results for <span class="hl-accent">“${escapeHtml(q)}”</span></div><div class="page-sub">Found ${data.count} Guru's msg${data.count === 1 ? "" : "s"}</div></div>`),
    emptyMsg: `No Guru's msg matched “${escapeHtml(q)}”.`,
    snippet: (r, lang) => highlight(r[`body_${lang}`], q),
    fetchEntry: (r) => api("/api/entry/" + encodeURIComponent(r.id)),   // list rows don't carry images
  });
}

// --------------------------------------------------------------------------
// Entry / favorites / browse / random / daily / stats / info
// --------------------------------------------------------------------------
async function renderEntry(id) {
  const nav = _nav;
  $view.innerHTML = `<div class="loading">Loading…</div>`;
  let e; try { e = await api("/api/entry/" + encodeURIComponent(id)); } catch { if (current(nav)) $view.innerHTML = `<div class="empty">Guru's msg #${escapeHtml(id)} not found.</div>`; return; }
  if (!current(nav)) return;
  store.setLastViewed(id);
  _stageId = id;   // so the right-sidebar Conclusion panel targets this wisdom
  updateIdNav(e.id, e.date);
  $view.replaceChildren(buildDetail(e, { context: "page" }));
  if (document.getElementById("conc-panel-body")) renderConclusionPanelBody(id);
}

async function renderFavorites() {
  const nav = _nav;
  $view.innerHTML = `<div class="page-title">Favorites</div><div class="loading">Loading…</div>`;
  const ids = store.favs();
  const entries = (await Promise.all(ids.map((id) => api("/api/entry/" + id).catch(() => null)))).filter(Boolean);
  if (!current(nav)) return;

  renderThumbList(entries, {
    nav,
    backButton: backBtn("‹ Back", () => go("#/")),
    header: el(`<div class="page-head"><div class="page-title">Favorites</div><div class="page-sub">${ids.length} saved ${ids.length === 1 ? "entry" : "entries"} · stored in this browser</div></div>`),
    emptyMsg: `No favorites yet. Open a Guru's msg and tap “Add to Favorites”.`,
    fetchEntry: (e) => Promise.resolve(e),   // already the full entry — no re-fetch needed
  });
}

function periodLabel(mode, period) {
  if (mode === "year") return period;
  if (mode === "month") { const [y] = period.split("-"); return new Date(`${period}-01`).toLocaleString("en", { month: "long" }) + ` ${y}`; }
  return fmtDate(period);
}
// --------------------------------------------------------------------------
// Browse by Date — archive view (grouped list + date picker + side calendar)
// --------------------------------------------------------------------------
function fmtDateLong(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const mon = new Date(y, m - 1, d).toLocaleString("en", { month: "short" });
  return `${String(d).padStart(2, "0")} ${mon} ${y}`;   // 11 Jun 2026
}
function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en", { month: "long", year: "numeric" }).toUpperCase();
}
function entriesWord(n) { return n === 1 ? "Entry" : "Entries"; }

// A reusable month calendar. `counts` is a Map<"YYYY-MM-DD", n>; only dates with
// entries are clickable. opts: { initial:"YYYY-MM(-DD)", selected, onPick(iso) }.
function buildCalendar(counts, opts) {
  const root = el(`<div class="cal"></div>`);
  let cur;
  if (opts.initial) { const [y, m] = opts.initial.split("-").map(Number); cur = { y, m: m - 1 }; }
  else { const n = new Date(); cur = { y: n.getFullYear(), m: n.getMonth() }; }
  const selected = opts.selected || null;
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  function draw() {
    const { y, m } = cur;
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;       // Monday-first
    const dim = new Date(y, m + 1, 0).getDate();
    const prevDim = new Date(y, m, 0).getDate();
    const total = Math.ceil((lead + dim) / 7) * 7;
    let cells = "";
    for (let i = 0; i < total; i++) {
      if (i < lead) { cells += `<span class="cal-d oth">${prevDim - lead + 1 + i}</span>`; }
      else if (i < lead + dim) {
        const day = i - lead + 1;
        const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const has = counts.has(iso);
        const isSel = iso === selected;
        cells += `<button class="cal-d${has ? " has" : ""}${isSel ? " sel" : ""}" data-iso="${iso}"${has ? "" : " disabled"}>${day}</button>`;
      } else { cells += `<span class="cal-d oth">${i - lead - dim + 1}</span>`; }
    }
    root.innerHTML = `
      <div class="cal-head">
        <button class="cal-nav" data-nav="-1" type="button" aria-label="Previous month">‹</button>
        <div class="cal-title">${new Date(y, m, 1).toLocaleString("en", { month: "long" })} ${y}</div>
        <button class="cal-nav" data-nav="1" type="button" aria-label="Next month">›</button>
      </div>
      <div class="cal-dow">${DOW.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="cal-grid">${cells}</div>`;
    root.querySelectorAll(".cal-nav").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      let nm = cur.m + Number(b.dataset.nav), ny = cur.y;
      if (nm < 0) { nm = 11; ny--; } else if (nm > 11) { nm = 0; ny++; }
      cur = { y: ny, m: nm }; draw();
    }));
    root.querySelectorAll(".cal-d.has").forEach((b) => b.addEventListener("click", () => opts.onPick(b.dataset.iso)));
  }
  draw();
  return root;
}

function monthTitle(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en", { month: "long", year: "numeric" });  // June 2026
}

// Group the (newest-first) dates into [{ key:"YYYY-MM", items, total }].
function groupByMonth(dates) {
  const groups = [];
  dates.forEach((d) => {
    const ym = d.period.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== ym) { g = { key: ym, items: [], total: 0 }; groups.push(g); }
    g.items.push(d); g.total += d.count;
  });
  return groups;
}

// The "Select a month" field + dropdown. Picking a month filters the archive to
// that month, shown at the top (the side calendar handles picking exact dates).
function buildMonthPicker(groups, activeKey) {
  const box = el(`<div class="arch-pick">
    <button class="arch-pick-field" type="button">
      <span class="apf-ico">${icon("calendar")}</span>
      <span class="apf-label">${activeKey ? monthTitle(activeKey) : "Select a month"}</span>
      <span class="apf-caret">▾</span>
    </button>
    <div class="arch-pick-pop arch-month-pop" hidden></div>
  </div>`);
  const field = box.querySelector(".arch-pick-field");
  const pop = box.querySelector(".arch-pick-pop");
  const allItem = el(`<button class="amp-item amp-all${activeKey ? "" : " on"}" type="button"><span class="amp-label">All months</span></button>`);
  allItem.addEventListener("click", () => { pop.hidden = true; box.classList.remove("open"); go("#/browse/date"); });
  pop.appendChild(allItem);
  groups.forEach((g) => {
    const item = el(`<button class="amp-item${g.key === activeKey ? " on" : ""}" type="button">
      <span class="amp-label">${monthTitle(g.key)}</span>
      <span class="amp-count">${g.total}</span></button>`);
    item.addEventListener("click", () => { pop.hidden = true; box.classList.remove("open"); go(`#/browse/date?m=${g.key}`); });
    pop.appendChild(item);
  });
  field.addEventListener("click", (e) => { e.stopPropagation(); const open = pop.hidden; pop.hidden = !open; box.classList.toggle("open", open); });
  const onDoc = (e) => {
    if (!box.isConnected) { document.removeEventListener("click", onDoc); return; }  // self-clean once detached
    if (!box.contains(e.target)) { pop.hidden = true; box.classList.remove("open"); }
  };
  document.addEventListener("click", onDoc);
  return box;
}

// The chronological list, grouped under MONTH YEAR headers (header → month browse).
function buildArchiveList(groups) {
  if (!groups.length) return el(`<div class="empty">No dated entries yet.</div>`);
  const wrap = el(`<div class="arch-groups"></div>`);
  groups.forEach((g) => {
    const sec = el(`<section class="arch-group" id="m-${g.key}"></section>`);
    const head = el(`<button class="arch-month" type="button">
      <span class="am-label">${monthLabel(g.key)}</span>
      <span class="am-count">${g.items.length} ${g.items.length === 1 ? "day" : "days"} · ${g.total} ${entriesWord(g.total).toLowerCase()}</span>
      <span class="am-go">View month →</span></button>`);
    head.addEventListener("click", () => go(`#/browse/month?sel=${g.key}`));
    sec.appendChild(head);
    const rows = el(`<div class="arch-rows"></div>`);
    g.items.forEach((d) => {
      const row = el(`<a class="arch-row">
        <span class="ar-ico">${icon("calendar")}</span>
        <span class="ar-date">${fmtDateLong(d.period)}</span>
        <span class="ar-badge">${d.count} ${entriesWord(d.count)}</span>
        <span class="ar-chev">›</span></a>`);
      row.addEventListener("click", () => go(`#/browse/date?sel=${d.period}`));
      rows.appendChild(row);
    });
    sec.appendChild(rows);
    wrap.appendChild(sec);
  });
  return wrap;
}

function buildRecentCard(dates, sel) {
  const card = el(`<div class="arch-card"><div class="arch-card-title">Recent Dates</div><div class="arch-recent"></div></div>`);
  const list = card.querySelector(".arch-recent");
  dates.slice(0, 5).forEach((d) => {
    const row = el(`<a class="arch-recent-row${sel === d.period ? " on" : ""}">
      <span class="arr-ico">${icon("calendar")}</span>
      <span class="arr-date">${fmtDateLong(d.period)}</span>
      <span class="arr-badge">${d.count} ${entriesWord(d.count)}</span></a>`);
    row.addEventListener("click", () => go(`#/browse/date?sel=${d.period}`));
    list.appendChild(row);
  });
  const all = el(`<button class="arch-viewall" type="button">View all dates →</button>`);
  all.addEventListener("click", () => go("#/browse/date"));
  card.appendChild(all);
  return card;
}

function buildCalendarCard(counts, initial, sel) {
  const card = el(`<div class="arch-card">
    <div class="arch-card-h"><span class="cal-ico">${icon("calendar")}</span>
      <div><div class="cal-t">Quick Calendar</div><div class="cal-s">Pick a date from the calendar</div></div></div></div>`);
  card.appendChild(buildCalendar(counts, { initial: sel || initial, selected: sel, onPick: (ds) => go(`#/browse/date?sel=${ds}`) }));
  return card;
}

async function renderArchive(params) {
  const nav = _nav;
  const sel = params.get("sel");
  const monthFilter = params.get("m");
  $view.innerHTML = `<div class="loading">Loading…</div>`;
  const data = await api("/api/browse?group=date");
  if (!current(nav)) return;
  const dates = data.periods;                                  // newest-first
  const counts = new Map(dates.map((d) => [d.period, d.count]));
  const groups = groupByMonth(dates);
  const initial = dates.length ? dates[0].period : null;
  const activeKey = sel ? sel.slice(0, 7) : (monthFilter || null);

  const wrap = document.createElement("div");
  wrap.appendChild(el(`<div class="page-head"><div class="page-title">Browse by Date</div><div class="page-sub">Pick a date to read its Guru's msgs.</div></div>`));

  const layout = el(`<div class="arch-layout"></div>`);
  const main = el(`<div class="arch-main"></div>`);
  const side = el(`<aside class="arch-side"></aside>`);
  layout.append(main, side);
  wrap.appendChild(layout);

  main.appendChild(buildMonthPicker(groups, activeKey));

  if (sel) {
    let res; try { res = await api(`/api/browse?date=${encodeURIComponent(sel)}`); } catch { res = { results: [] }; }
    const back = el(`<button class="arch-back-btn" type="button">‹ All dates</button>`);
    back.addEventListener("click", () => go("#/browse/date"));
    main.appendChild(back);
    main.appendChild(el(`<div class="section-head"><h2>${fmtDateLong(sel)}</h2></div>`));
    main.appendChild(res.results.length ? cardGrid(res.results) : el(`<div class="empty">Guru's msg not found</div>`));
  } else if (monthFilter) {
    const shown = groups.filter((g) => g.key === monthFilter);
    const back = el(`<button class="arch-back-btn" type="button">‹ All months</button>`);
    back.addEventListener("click", () => go("#/browse/date"));
    main.appendChild(back);
    main.appendChild(shown.length ? buildArchiveList(shown) : el(`<div class="empty">No entries for ${monthTitle(monthFilter)}.</div>`));
  } else {
    main.appendChild(buildArchiveList(groups));
  }

  side.appendChild(buildCalendarCard(counts, sel || monthFilter || initial, sel));
  side.appendChild(buildRecentCard(dates, sel));

  if (!current(nav)) return;
  $view.replaceChildren(wrap);
  window.scrollTo(0, 0);
}

async function renderBrowse(mode, params) {
  if (mode === "date") return renderArchive(params);
  const nav = _nav;
  const sel = params.get("sel");
  $view.innerHTML = `<div class="loading">Loading…</div>`;
  const data = await api("/api/browse?group=" + mode);
  if (!current(nav)) return;
  const titles = { date: "Browse by Date", month: "Browse by Month", year: "Browse by Year" };
  const wrap = document.createElement("div");
  wrap.appendChild(el(`<div class="page-head"><div class="page-title">${titles[mode]}</div><div class="page-sub">Pick a ${mode} to read its Guru's msgs.</div></div>`));
  const chips = el(`<div class="browse-chips"></div>`);
  data.periods.forEach((p) => {
    const c = el(`<button class="chip-btn ${sel === p.period ? "active" : ""}">${periodLabel(mode, p.period)} · ${p.count}</button>`);
    c.addEventListener("click", () => go(`#/browse/${mode}?sel=${encodeURIComponent(p.period)}`));
    chips.appendChild(c);
  });
  wrap.appendChild(chips);
  if (sel) {
    let url;
    if (mode === "year") url = `/api/browse?year=${sel}`;
    else if (mode === "month") { const [y, m] = sel.split("-"); url = `/api/browse?year=${y}&month=${m}`; }
    else url = `/api/browse?date=${encodeURIComponent(sel)}`;
    const res = await api(url);
    if (!current(nav)) return;
    wrap.appendChild(el(`<div class="section-head" style="margin-top:18px"><h2>${periodLabel(mode, sel)}</h2></div>`));
    wrap.appendChild(cardGrid(res.results));
  }
  if (!current(nav)) return;
  $view.replaceChildren(wrap);
}

// "Your Lucky Msg for Today": one random pick per device per DAY, not per
// click — the first visit of the day draws it, every later visit returns to
// the same msg until midnight.
async function renderRandom() {
  const nav = _nav;
  try {
    const t = new Date();
    const dayKey = `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`;
    let id = null;
    try { if (localStorage.getItem("wa:luckyDate") === dayKey) id = localStorage.getItem("wa:luckyId"); } catch {}
    if (id) {
      // The stored pick can vanish after a content update — fall back to a fresh draw.
      try { await api("/api/entry/" + encodeURIComponent(id)); } catch { id = null; }
    }
    if (!id) {
      const e = await api("/api/random");
      id = e.id;
      try { localStorage.setItem("wa:luckyDate", dayKey); localStorage.setItem("wa:luckyId", String(id)); } catch {}
    }
    if (!current(nav)) return;
    // On mobile this is a single, standalone pick — no swiping away to other
    // days (that's what the vertical feed everywhere else is for).
    go("#/entry/" + id + (MOBILE_UI.active ? "?single=1" : ""));
  } catch { if (current(nav)) $view.innerHTML = `<div class="empty">No Guru's msg available.</div>`; }
}

async function renderStats() {
  const nav = _nav;
  $view.innerHTML = `<div class="loading">Loading…</div>`;
  const [stats, months] = await Promise.all([api("/api/stats"), api("/api/browse?group=month")]);
  if (!current(nav)) return;
  const wrap = document.createElement("div");
  wrap.appendChild(el(`<div class="page-head"><div class="page-title">Statistics</div><div class="page-sub">An overview of the archive.</div></div>`));
  wrap.appendChild(el(`<div class="stats">
    <div class="stat"><div class="sico">📖</div><div><div class="snum">${stats.total}</div><div class="slabel">Total Guru's Msgs</div></div></div>
    <div class="stat"><div class="sico">📅</div><div><div class="snum">${stats.this_year}</div><div class="slabel">This Year (${new Date().getFullYear()})</div></div></div>
    <div class="stat"><div class="sico">♡</div><div><div class="snum">${store.favs().length}</div><div class="slabel">Favorites</div></div></div>
    <div class="stat"><div class="sico">🕐</div><div><div class="snum">${stats.days_covered}</div><div class="slabel">Days Covered</div></div></div></div>`));
  wrap.appendChild(el(`<div class="section-head" style="margin-top:26px"><h2>Entries by Month</h2></div>`));
  const chips = el(`<div class="browse-chips"></div>`);
  months.periods.forEach((p) => { const c = el(`<button class="chip-btn">${periodLabel("month", p.period)} · ${p.count}</button>`); c.addEventListener("click", () => go(`#/browse/month?sel=${p.period}`)); chips.appendChild(c); });
  wrap.appendChild(chips);
  $view.replaceChildren(wrap);
}

function renderInfo(kind) {
  const title = { settings: "Settings", about: "About", help: "Help & Support" }[kind];
  const body = {
    settings: `<h3>Settings</h3><p>Samarpan Upnishad runs locally on your computer. There is no account — your <strong>favorites</strong> and <strong>notes</strong> are stored privately in this browser.</p><ul><li>Use the « / » button to collapse or expand the sidebar.</li><li>Dark mode is coming soon.</li><li>To add a new day's Guru's msg, open <strong>Add Guru's Msg</strong> in the sidebar and drop in that day's files — it appears instantly, no restart needed.</li><li>To bulk-rebuild from all folders at once, you can still run the importer (<code>reimport.bat</code>).</li></ul>
      <div class="sync-box">
        <h3 style="margin-top:0">Latest Guru's Msg Sync</h3>
        <p>Checks the central archive for any new day's Guru's msg and adds it here automatically.</p>
        <button class="btn primary" id="sync-now-btn">Sync now</button>
        <div id="sync-status" class="sync-status"></div>
      </div>`,
    about: `<h3>About</h3><p>Samarpan Upnishad is a digital library of daily spiritual Guru's msgs, searchable across English and Hindi transcripts. Each entry preserves the original images and their transcribed text.</p><p style="font-family:var(--serif);font-size:17px;color:var(--accent)">“The purpose of life is realisation of the Self.”<br>— Baba Swami</p><p style="margin-top:22px;color:var(--muted,#888);font-size:13px">Samarpan Upnishad · version <span id="wa-version">…</span></p>`,
    help: `<h3>Help &amp; Support</h3><p>Search any word in English or Hindi from the bar at the top — matching Guru's msgs appear with the word highlighted in yellow. Click a result to read it in full, with both images and transcripts.</p><ul><li><strong>Add to Favorites</strong> to save an entry; find them under Favorites.</li><li>Write private notes under <strong>My Comments</strong> on any entry.</li><li><strong>Browse</strong> by Date, Month, or Year from the sidebar.</li></ul>`,
  }[kind];
  $view.innerHTML = `<div class="page-title">${title}</div><div class="prose">${body}</div>`;
  if (kind === "about") {
    // Fill the version number from the local backend (VERSION file next to the app).
    fetch("/api/version")
      .then((r) => r.json())
      .then((d) => {
        const el = document.getElementById("wa-version");
        if (el) el.textContent = d.version || "unknown";
      })
      .catch(() => {
        const el = document.getElementById("wa-version");
        if (el) el.textContent = "unknown";
      });
  }
  if (kind === "settings") {
    wireSyncBox();
    // Mobile app only: daily-reminder settings + mobile-appropriate wording
    // (wa-native.js owns all of it; no-op on desktop).
    if (window.WA_NATIVE && WA_NATIVE.enhanceSettings) WA_NATIVE.enhanceSettings();
    if (MOBILE_UI.active && MOBILE_UI.enhanceSettings) MOBILE_UI.enhanceSettings();
  }
}

// Renders the last-known sync outcome (checked on page load, no network call)
// and wires the manual button to trigger + display a fresh one.
function syncStatusHtml(d) {
  if (!d || d.checked_at == null) return `<span class="muted">Not checked yet this session.</span>`;
  if (d.error === "not_configured") return `<span class="muted">Central sync isn't set up on this install.</span>`;
  if (d.error) return `<span class="ar-err">Sync failed: ${escapeHtml(d.error)}</span>`;
  const added = d.added || [];
  const when = new Date(d.checked_at * 1000).toLocaleString();
  const what = added.length ? `Added ${added.length} new entr${added.length === 1 ? "y" : "ies"}: ${added.map(escapeHtml).join(", ")}.` : "Already up to date.";
  return `<span>${what}</span><div class="muted" style="margin-top:2px">Checked ${when}</div>`;
}
async function wireSyncBox() {
  const btn = document.getElementById("sync-now-btn");
  const status = document.getElementById("sync-status");
  if (!btn || !status) return;
  try { status.innerHTML = syncStatusHtml(await api("/api/sync")); } catch {}
  btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "Syncing…";
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      if (!r.ok) throw await apiError(r);
      const d = await r.json();
      status.innerHTML = syncStatusHtml(d);
      if ((d.added || []).length) toast(`Added ${d.added.length} new Guru's msg${d.added.length === 1 ? "" : "s"}`);
    } catch (e) { status.innerHTML = `<span class="ar-err">${escapeHtml(e.message || "Sync failed.")}</span>`; }
    finally { btn.disabled = false; btn.textContent = "Sync now"; }
  });
}

// --------------------------------------------------------------------------
// Admin — add a day's wisdom
// --------------------------------------------------------------------------
const ADMIN_FNAME_RE = /^(\d+)_(Eng|Hin)\.(txt|jpg)$/i;

// Recursively pull every File out of dropped DataTransfer entries (so dropping
// a whole folder works, not just loose files). Falls back to dataTransfer.files.
async function walkDataTransferEntries(entries) {
  const files = [];
  async function readAll(reader) {
    const out = [];
    while (true) {
      const batch = await new Promise((res) => reader.readEntries((x) => res(x), () => res([])));
      if (!batch.length) break;
      out.push(...batch);
    }
    return out;
  }
  async function walk(entry) {
    if (!entry) return;
    if (entry.isFile) {
      await new Promise((res) => entry.file((f) => { files.push(f); res(); }, () => res()));
    } else if (entry.isDirectory) {
      for (const kid of await readAll(entry.createReader())) await walk(kid);
    }
  }
  for (const e of entries) await walk(e);
  return files;
}

async function renderAdmin() {
  const wrap = document.createElement("div");
  wrap.appendChild(el(`<div class="page-head"><div class="page-title">Add Guru's Msg</div>
    <div class="page-sub">Drop today's files here to add a new entry — it appears in the archive instantly.</div></div>`));

  // In the mobile app there is no local archive folder to write into — adding
  // wisdom stays a desktop task; new entries arrive here through Sync.
  if (window.WA_NATIVE_ACTIVE) {
    wrap.appendChild(el(`<div class="empty">Adding Guru's msg is done from the desktop app.<br>New entries reach this app automatically through <strong>Settings → Latest Guru's Msg Sync</strong>.</div>`));
    $view.replaceChildren(wrap);
    return;
  }

  // Adding or replacing wisdom writes into the archive — moderators only.
  // Non-moderators (incl. signed-out visitors) get the sign-in / sign-up gate.
  if (!isModerator()) {
    const gate = el(`<div class="mod-gate"></div>`);
    gate.innerHTML = modSignInHtml();
    wireModSignIn(gate, () => renderAdmin());
    wrap.appendChild(gate);
    $view.replaceChildren(wrap);
    return;
  }

  const card = el(`<div class="admin-card">
    <label class="admin-drop" id="admin-drop">
      <input type="file" id="admin-input" multiple accept=".txt,.jpg" hidden />
      <input type="file" id="admin-folder" webkitdirectory directory hidden />
      <div class="ad-ico">${icon("upload")}</div>
      <div class="ad-main">Drop a folder here, or click to choose files</div>
      <div class="ad-hint">A day's 4 files: <code>3421_Eng.txt</code>, <code>3421_Eng.jpg</code>, <code>3421_Hin.txt</code>, <code>3421_Hin.jpg</code></div>
    </label>
    <div class="admin-folder-row">
      <button type="button" class="btn" id="admin-folder-btn">${icon("upload")} Choose a folder…</button>
      <span class="ad-hint">Pick a folder that contains the day's 4 files — the rest is ignored.</span>
    </div>
    <div class="admin-files" id="admin-files"></div>
    <div class="admin-topic">
      <label for="admin-topic-input">Topic <span>(optional — leave blank to auto-detect from the text)</span></label>
      <input type="text" id="admin-topic-input" placeholder="e.g. Gratitude" autocomplete="off" />
    </div>
    <div class="admin-actions">
      <button class="btn primary" id="admin-go" disabled>Add to Archive</button>
      <button class="btn" id="admin-reset">Clear</button>
    </div>
    <div class="admin-result" id="admin-result"></div>
  </div>`);
  wrap.appendChild(card);

  const recent = el(`<div class="admin-recent"><div class="section-head" style="margin-top:26px"><h2>Recently Added</h2></div><div id="admin-recent-grid"></div></div>`);
  wrap.appendChild(recent);

  $view.replaceChildren(wrap);

  const input = card.querySelector("#admin-input");
  const drop = card.querySelector("#admin-drop");
  const fileList = card.querySelector("#admin-files");
  const goBtn = card.querySelector("#admin-go");
  const resetBtn = card.querySelector("#admin-reset");
  const result = card.querySelector("#admin-result");
  let chosen = [];
  let dupId = null;       // id of an already-existing entry (duplicate), else null
  let dupToken = 0;       // guards against stale async duplicate checks

  // Ask the server whether this entry number already exists; if so, warn the
  // user and turn the action into an explicit "Replace" instead of a silent add.
  async function checkDuplicate(id) {
    const token = ++dupToken;
    dupId = null;
    try {
      const r = await fetch("/api/admin/exists/" + encodeURIComponent(id), { headers: authHeaders() });
      const d = await r.json();
      if (token !== dupToken) return;           // a newer selection superseded this
      if (d.exists) {
        dupId = id;
        const meta = [d.date ? fmtDate(d.date) : "", d.topic || ""].filter(Boolean).join(" · ");
        result.innerHTML = `<div class="ar-warn">⚠ Entry #${escapeHtml(id)} already exists${meta ? " (" + escapeHtml(meta) + ")" : ""}. Adding it again will <strong>replace</strong> the current one.</div>`;
        goBtn.textContent = `Replace entry #${id}`;
        goBtn.classList.add("danger");
      } else {
        goBtn.classList.remove("danger");
      }
    } catch (_) { /* offline / network — fall back to normal add, backend still guards */ }
  }

  function validate() {
    result.innerHTML = "";
    dupId = null; dupToken++; goBtn.classList.remove("danger");
    if (!chosen.length) { fileList.innerHTML = ""; goBtn.disabled = true; return; }
    const ids = new Set();
    let hasTxt = false, bad = null;
    chosen.forEach((f) => {
      const m = ADMIN_FNAME_RE.exec(f.name);
      if (!m) { bad = f.name; return; }
      ids.add(m[1]);
      if (m[3].toLowerCase() === "txt") hasTxt = true;
    });
    fileList.innerHTML = "";
    chosen.forEach((f) => {
      const ok = ADMIN_FNAME_RE.test(f.name);
      fileList.appendChild(el(`<div class="admin-file ${ok ? "" : "bad"}">
        <span>${ok ? "✓" : "✕"}</span><span class="af-name">${escapeHtml(f.name)}</span>
        <span class="af-size">${(f.size / 1024).toFixed(0)} KB</span></div>`));
    });
    let err = "";
    if (bad) err = `“${bad}” isn't named correctly. Use names like 3421_Eng.txt or 3421_Hin.jpg.`;
    else if (ids.size > 1) err = `All files must share one entry number. Found: ${[...ids].sort().join(", ")}.`;
    else if (!hasTxt) err = `Add at least one transcript (.txt) file — it carries the date and text.`;
    if (err) { result.innerHTML = `<div class="ar-err">${escapeHtml(err)}</div>`; goBtn.disabled = true; }
    else { goBtn.textContent = `Add entry #${[...ids][0]} to Archive`; goBtn.disabled = false; checkDuplicate([...ids][0]); }
  }

  const folderInput = card.querySelector("#admin-folder");
  const folderBtn = card.querySelector("#admin-folder-btn");

  // When the files come from a folder, silently keep only the day's 4 wisdom
  // files (ignore thumbs, notes, .DS_Store, etc.); for hand-picked files keep
  // everything so wrong names are flagged.
  function setFiles(list, fromFolder) {
    let arr = Array.from(list || []);
    if (fromFolder) arr = arr.filter((f) => ADMIN_FNAME_RE.test(f.name));
    chosen = arr;
    validate();
  }
  input.addEventListener("change", () => setFiles(input.files, false));
  folderInput.addEventListener("change", () => setFiles(folderInput.files, true));
  folderBtn.addEventListener("click", () => folderInput.click());

  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", async (e) => {
    const dt = e.dataTransfer; if (!dt) return;
    let files = [], hadDir = false;
    const items = dt.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const entries = [];
      for (const it of items) { const en = it.webkitGetAsEntry(); if (en) entries.push(en); }
      hadDir = entries.some((en) => en && en.isDirectory);
      files = await walkDataTransferEntries(entries);
    }
    if (!files.length) files = Array.from(dt.files || []);
    setFiles(files, hadDir);
  });
  resetBtn.addEventListener("click", () => { input.value = ""; folderInput.value = ""; card.querySelector("#admin-topic-input").value = ""; setFiles([]); });

  goBtn.addEventListener("click", async () => {
    const replacing = !!dupId;
    goBtn.disabled = true; goBtn.textContent = replacing ? "Replacing…" : "Adding…";
    const fd = new FormData();
    chosen.forEach((f) => fd.append("files", f, f.name));
    const topicVal = (card.querySelector("#admin-topic-input").value || "").trim();
    if (topicVal) fd.append("topic", topicVal);
    if (replacing) fd.append("overwrite", "true");  // user knowingly replaces a duplicate
    try {
      const r = await fetch("/api/admin/import", { method: "POST", body: fd, headers: authHeaders() });
      // Session expired / not a moderator — drop back to the sign-in gate.
      if (r.status === 401 || r.status === 403) {
        toast("Please sign in as a moderator to add Guru's msg.");
        store.setToken(""); try { localStorage.removeItem("wa:user"); } catch {}
        refreshModNav(); renderAdmin();
        return;
      }
      const data = await r.json();
      // Backend safety net: a duplicate slipped through (race) — surface it and
      // let the next click replace it intentionally.
      if (r.status === 409) {
        dupId = [...new Set(chosen.map((f) => (ADMIN_FNAME_RE.exec(f.name) || [])[1]))].filter(Boolean)[0] || dupId;
        result.innerHTML = `<div class="ar-warn">⚠ ${escapeHtml(data.detail || "Entry already exists.")} Click again to replace it.</div>`;
        goBtn.disabled = false; goBtn.textContent = `Replace entry #${dupId || ""}`.trim(); goBtn.classList.add("danger");
        return;
      }
      if (!r.ok) throw new Error(data.detail || ("Error " + r.status));
      result.innerHTML = `<div class="ar-ok">
        <div class="ar-ok-h">✓ ${replacing ? "Replaced" : "Added"} Guru's msg #${escapeHtml(data.id)}</div>
        <div class="ar-meta">${fmtDate(data.date)} · ${escapeHtml(data.weekday || "")} · ${escapeHtml((data.languages || []).join(" + ") || "—")}${data.topic ? " · " + escapeHtml(data.topic) : ""}</div>
        <button class="btn primary ar-view">View entry ›</button></div>`;
      result.querySelector(".ar-view").addEventListener("click", () => go("#/entry/" + data.id));
      input.value = ""; folderInput.value = ""; chosen = []; dupId = null; fileList.innerHTML = ""; card.querySelector("#admin-topic-input").value = ""; goBtn.textContent = "Add to Archive"; goBtn.classList.remove("danger");
      toast("Guru's msg #" + data.id + (replacing ? " replaced" : " added"));
      loadRecent();
    } catch (err) {
      result.innerHTML = `<div class="ar-err">${escapeHtml(err.message)}</div>`;
      goBtn.disabled = false; goBtn.textContent = replacing ? `Replace entry #${dupId}` : "Add to Archive";
    }
  });

  async function loadRecent() {
    const grid = () => document.getElementById("admin-recent-grid");
    try { const d = await api("/api/latest?limit=6"); if (grid()) grid().replaceChildren(cardGrid(d.results)); }
    catch { if (grid()) grid().innerHTML = ""; }
  }
  loadRecent();
}

// --------------------------------------------------------------------------
// Moderator settings page — members, roles, sign-ups (moderator only)
// --------------------------------------------------------------------------
async function renderModerator() {
  const nav = _nav;
  const wrap = el(`<div></div>`);
  wrap.appendChild(el(`<div class="page-head"><div class="page-title">Moderator</div><div class="page-sub">Manage members, roles, and sign-ups</div></div>`));

  let data;
  try { data = await WA.listUsers(); }
  catch {
    if (!current(nav)) return;
    // Not signed in (or not a moderator) — show the sign-in / sign-up form.
    const gate = el(`<div class="mod-gate"></div>`);
    gate.innerHTML = modSignInHtml();
    wireModSignIn(gate, () => renderModerator());
    wrap.appendChild(gate);
    $view.replaceChildren(wrap);
    return;
  }
  if (!current(nav)) return;

  const me = currentUser();

  // Sign-up toggle
  const signup = el(`<div class="mod-card">
    <div class="mod-row-between">
      <div><div class="mod-card-h">Public sign-ups</div><div class="mod-card-sub">Allow new people to register accounts.</div></div>
      <button class="btn mod-signup-btn ${data.signup_enabled ? "active" : ""}">${data.signup_enabled ? "ON" : "OFF"}</button>
    </div></div>`);
  const sBtn = signup.querySelector(".mod-signup-btn");
  sBtn.addEventListener("click", async () => {
    const next = !sBtn.classList.contains("active");
    try {
      await WA.setSignup(next);
      sBtn.classList.toggle("active", next); sBtn.textContent = next ? "ON" : "OFF"; toast("Sign-ups " + (next ? "enabled" : "disabled"));
    } catch (e) { toast("Couldn't update sign-ups"); }
  });
  wrap.appendChild(signup);

  // Members table
  const list = el(`<div class="mod-card"><div class="mod-card-h">Members (${data.users.length})</div><div class="mod-users"></div></div>`);
  const holder = list.querySelector(".mod-users");
  data.users.forEach((u) => holder.appendChild(modUserRow(u, me)));
  wrap.appendChild(list);

  // Credit requests
  const reqCard = el(`<div class="mod-card mod-credit-reqs"><div class="mod-card-h">Message credit requests</div><div class="mod-req-list"><div class="mod-req-empty">No pending requests.</div></div></div>`);
  wrap.appendChild(reqCard);
  (async () => {
    try {
      const rd = await WA.listCreditRequests();
      const reqList = reqCard.querySelector(".mod-req-list");
      if (!rd.requests || !rd.requests.length) return;
      reqList.innerHTML = "";
      rd.requests.forEach((req) => {
        const row = el(`<div class="mod-req-row">
          <div class="mod-req-info">
            <strong>${escapeHtml(req.username)}</strong>
            <span class="mod-req-credits">has ${req.chat_credits} left</span>
            <span class="mu-email">${timeAgo(req.requested_at)}</span>
          </div>
          <div class="mod-req-actions">
            <input class="mod-req-inp" type="number" value="20" min="1" max="9999" style="width:55px">
            <button class="btn primary mod-req-grant">Grant</button>
            <button class="btn danger mod-req-deny">Deny</button>
          </div>
        </div>`);
        row.querySelector(".mod-req-grant").addEventListener("click", async () => {
          const credits = parseInt(row.querySelector(".mod-req-inp").value, 10);
          if (isNaN(credits) || credits < 1) return;
          try {
            await WA.approveCreditRequest(req.id, credits);
            toast(`Granted ${credits} credits to ${req.username}`); row.remove();
            if (!reqCard.querySelector(".mod-req-row")) reqCard.querySelector(".mod-req-list").innerHTML = `<div class="mod-req-empty">No pending requests.</div>`;
          } catch (e) { toast(e.message); }
        });
        row.querySelector(".mod-req-deny").addEventListener("click", async () => {
          try {
            await WA.denyCreditRequest(req.id);
            toast(`Request from ${req.username} denied`); row.remove();
            if (!reqCard.querySelector(".mod-req-row")) reqCard.querySelector(".mod-req-list").innerHTML = `<div class="mod-req-empty">No pending requests.</div>`;
          } catch (e) { toast(e.message); }
        });
        reqList.appendChild(row);
      });
    } catch { /* silently skip if API fails */ }
  })();

  // Sign out
  const out = el(`<div class="mod-card"><button class="btn mod-signout">Sign out (${escapeHtml(me ? me.username : "")})</button></div>`);
  out.querySelector(".mod-signout").addEventListener("click", () => { WA.logout(); store.setToken(""); try { localStorage.removeItem("wa:user"); } catch {} refreshModNav(); toast("Signed out"); go("#/"); });
  wrap.appendChild(out);

  $view.replaceChildren(wrap);
}

function modUserRow(u, me) {
  const isSelf = me && me.id === u.id;
  const isSutradharRow = u.role === "sutradhar";
  const isModRow = u.role === "moderator";
  const isElevated = isSutradharRow || isModRow;
  const viewerIsSutradhar = me && me.role === "sutradhar";

  const roleLabel = isSutradharRow
    ? `<span class="mu-sutradhar-tag">Sutradhar</span>`
    : "";

  const roleSelect = !isSutradharRow
    ? `<select class="mu-role">
        ${["pending", "member", "moderator"].map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("")}
       </select>`
    : "";

  const chatControls = !isElevated
    ? `<div class="mu-chat-controls">
        <button class="btn mu-mute ${u.chat_muted ? "danger" : ""}">${u.chat_muted ? "Unmute" : "Mute"}</button>
        <span class="mu-credits-wrap"><input class="mu-credits-inp" type="number" value="${u.chat_credits ?? 30}" min="0" max="9999" style="width:60px"><button class="btn mu-credits-set">Set credits</button></span>
       </div>`
    : "";

  const transferBtn = (viewerIsSutradhar && isModRow)
    ? `<button class="btn mu-transfer" title="Make this person the Sutradhar">Make Sutradhar</button>`
    : "";

  const removeBtn = !isSutradharRow
    ? `<button class="btn danger mu-remove">Remove</button>`
    : "";

  const row = el(`<div class="mod-user">
    <div class="mu-main">
      <div class="mu-name">${escapeHtml(u.username)}${isSelf ? ' <span class="mu-you">you</span>' : ""}${roleLabel}${u.chat_muted ? ' <span class="mu-muted-tag">muted</span>' : ""}</div>
      <div class="mu-email">${escapeHtml(u.email || "")}</div>
    </div>
    ${roleSelect}
    ${chatControls}
    ${transferBtn}
    <button class="btn mu-rename">Rename</button>
    ${removeBtn}
  </div>`);

  if (!isElevated) {
    row.querySelector(".mu-mute").addEventListener("click", async () => {
      try {
        const d = await WA.toggleMute(u.id);
        toast(d.user.chat_muted ? `${u.username} muted` : `${u.username} unmuted`);
        renderModerator();
      } catch (e) { toast(e.message); }
    });
    row.querySelector(".mu-credits-set").addEventListener("click", async () => {
      const credits = parseInt(row.querySelector(".mu-credits-inp").value, 10);
      if (isNaN(credits) || credits < 0) return;
      try {
        await WA.setCredits(u.id, credits);
        toast(`${u.username}: ${credits} credits set`);
      } catch (e) { toast(e.message); }
    });
  }

  if (viewerIsSutradhar && isModRow) {
    row.querySelector(".mu-transfer").addEventListener("click", async () => {
      if (!confirm(`Transfer Sutradhar leadership to ${u.username}? You will become a moderator.`)) return;
      try {
        await WA.transferLeadership(u.id);
        toast(`Leadership transferred to ${u.username}`);
        // Update local user role
        try { const uu = JSON.parse(localStorage.getItem("wa:user") || "null"); if (uu) { uu.role = "moderator"; localStorage.setItem("wa:user", JSON.stringify(uu)); } } catch {}
        refreshModNav(); renderModerator();
      } catch (e) { toast(e.message); }
    });
  }

  if (!isSutradharRow) {
    row.querySelector(".mu-role").addEventListener("change", async (ev) => {
      const role = ev.target.value;
      try {
        await WA.setRole(u.id, role);
        u.role = role; toast(`${u.username} → ${role}`); refreshModNav();
      } catch (e) { ev.target.value = u.role; toast(e.message); }
    });

    row.querySelector(".mu-remove").addEventListener("click", async () => {
      if (!confirm(`Remove ${u.username}? This deletes their account.`)) return;
      try {
        await WA.deleteUser(u.id);
        toast("Removed"); renderModerator();
      } catch (e) { toast(e.message); }
    });
  }

  row.querySelector(".mu-rename").addEventListener("click", async () => {
    const name = prompt("New username for " + u.username + ":", u.username);
    if (!name || name === u.username) return;
    try {
      await WA.renameUser(u.id, name.trim());
      toast("Renamed"); renderModerator();
    } catch (e) { toast(e.message); }
  });

  return row;
}

// --------------------------------------------------------------------------
// Router
// --------------------------------------------------------------------------
function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { path, params: new URLSearchParams(qs || "") };
}
// Bumped on every navigation. An async render captures it and checks `current()`
// before painting, so a slow fetch from a route the user already left can't
// overwrite the page they're now on (a real race once hosted over a network).
let _nav = 0;
function current(nav) { return nav === _nav; }

async function route() {
  _nav++;
  const { path, params } = parseHash();
  const seg = path.split("/").filter(Boolean);
  if (_sidePanelClose) _sidePanelClose();
  // Clear the "current wisdom" — home/entry set it again; other pages leave it empty.
  _stageId = null;
  _searchBackFn = null;   // leaving search (even to re-search) drops any open detail view
  updateIdNav(null);
  if (document.getElementById("conc-panel-body")) renderConclusionPanelBody(null);
  // Mobile app shell (APK / ?waNativeTest=1): image-first pages take over
  // home / entry / #/m/* routes; every other route falls through to the
  // standard views below, framed by the mobile top bar.
  if (MOBILE_UI.active) {
    if (MOBILE_UI.handles(seg)) return MOBILE_UI.route(seg, params);
    MOBILE_UI.fallthrough(seg);
  }
  if (seg[0] === "entry" && seg[1]) { setActiveNav(""); return renderEntry(seg[1]); }
  if (seg[0] === "search") { setActiveNav("search"); return renderSearch(params.get("q") || ""); }
  if (seg[0] === "favorites") { setActiveNav("favorites"); return renderFavorites(); }
  if (seg[0] === "browse") { const mode = ["date", "month", "year"].includes(seg[1]) ? seg[1] : "month"; setActiveNav("browse-" + mode); return renderBrowse(mode, params); }
  if (seg[0] === "random") { setActiveNav("random"); return renderRandom(); }
  if (seg[0] === "admin") { setActiveNav("admin"); return renderAdmin(); }
  if (seg[0] === "moderator") { setActiveNav("moderator"); return renderModerator(); }
  if (seg[0] === "stats") { setActiveNav("stats"); return renderStats(); }
  if (seg[0] === "settings") { setActiveNav("settings"); return renderInfo("settings"); }
  if (seg[0] === "about") { setActiveNav("about"); return renderInfo("about"); }
  if (seg[0] === "help") { setActiveNav("help"); return renderInfo("help"); }
  setActiveNav("home"); return renderHome(params);
}
// Any failed view (e.g. the server is down) shows an error state instead of
// leaving the page stuck on "Loading…".
function showRouteError(err) {
  console.error(err);
  $view.innerHTML = `<div class="empty">Something went wrong loading this page. Make sure the server is running, then refresh.</div>`;
}
function safeRoute() { return route().catch(showRouteError); }
function go(hash) { if (location.hash === hash) safeRoute(); else location.hash = hash; }

// --------------------------------------------------------------------------
// Sidebar collapse + year dropdown + search wiring
// --------------------------------------------------------------------------
function applyCollapsed() { const v = localStorage.getItem("wa:collapsed"); const collapsed = v === null ? true : v === "1"; document.getElementById("app").classList.toggle("collapsed", collapsed); }
document.getElementById("collapse-btn").addEventListener("click", () => { localStorage.setItem("wa:collapsed", "1"); applyCollapsed(); });
document.getElementById("expand-btn").addEventListener("click", () => { localStorage.setItem("wa:collapsed", "0"); applyCollapsed(); });
document.getElementById("latest-btn").addEventListener("click", () => go("#/?latest=1"));

// --------------------------------------------------------------------------
// Community panel — opened directly from the topbar Community icon.
// (Replaces the old Explore speed-dial: Latest Wisdom/Wisdom History/Sadhak's
// Conclusion were also reachable from there and are no longer wired up.)
// --------------------------------------------------------------------------
function closeCommunityPanel() {
  closeChatStream();   // stop listening for live messages when the panel closes
  const panel = document.getElementById("fab-panel");
  if (panel) panel.hidden = true;
  setCommSplit(false);   // leaving the panel always exits the split view
}

// Community split view — wisdom stacks on the left, chat fills the freed space.
function setCommSplit(on) {
  document.getElementById("app").classList.toggle("comm-split", on);
  const btn = document.getElementById("fab-expand");
  if (btn) btn.title = on ? "Collapse" : "Expand";
}

function openCommunityPanel() {
  const panel = document.getElementById("fab-panel");
  const wasOpen = !panel.hidden;
  const body = document.getElementById("fab-panel-body");
  closeChatStream();
  body.innerHTML = `<div class="loading">Loading…</div>`;
  panel.hidden = false;
  // pop in only when first opening (not when just refreshing)
  if (!wasOpen) { panel.style.animation = "none"; void panel.offsetWidth; panel.style.animation = ""; }
  renderCommunityTab(body);
  setCommSplit(true);   // discussion-heavy, so it opens maximized by default
}

function initCommunityPanel() {
  const btn = document.getElementById("community-btn");
  if (!btn) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = document.getElementById("fab-panel");
    if (panel.hidden) openCommunityPanel(); else closeCommunityPanel();
  });
  document.getElementById("fab-panel-close").addEventListener("click", closeCommunityPanel);
  document.getElementById("fab-expand").addEventListener("click", (e) => {
    e.stopPropagation();
    setCommSplit(!document.getElementById("app").classList.contains("comm-split"));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCommunityPanel(); });
}

// --------------------------------------------------------------------------
// Auto-hide mode — hide all chrome (big content); reveal on edge-hover or toggle
// --------------------------------------------------------------------------
let _autohide = true;   // always start hidden (per preference)

function applyAutohide() {
  const app = document.getElementById("app");
  if (_autohide) {
    app.classList.remove("collapsed", "rcollapsed");   // panels reveal in full form
    app.classList.add("autohide");
  } else {
    app.classList.remove("autohide", "reveal-left", "reveal-top");
    applyCollapsed();                                   // restore the docked left-sidebar pref
  }
  const btn = document.getElementById("autohide-toggle");
  if (!btn) return;
  btn.classList.toggle("on", !_autohide);
  btn.title = _autohide ? "Show all content" : "Hide menus (big content)";
  const show = btn.querySelector(".ah-show"), hide = btn.querySelector(".ah-hide");
  if (show && hide) { show.style.display = _autohide ? "" : "none"; hide.style.display = _autohide ? "none" : ""; }
  const label = btn.querySelector(".ah-label");
  if (label) label.textContent = _autohide ? "Show all content" : "Hide menus";
}

// Reveal one panel while the cursor is over its edge-strip or the panel itself.
function wireReveal(side, stripId, panelSel) {
  const strip = document.getElementById(stripId);
  const panel = document.querySelector(panelSel);
  if (!strip || !panel) return;
  let t;
  const show = () => { clearTimeout(t); document.getElementById("app").classList.add("reveal-" + side); };
  const hide = () => { clearTimeout(t); t = setTimeout(() => document.getElementById("app").classList.remove("reveal-" + side), 180); };
  strip.addEventListener("mouseenter", show);
  strip.addEventListener("mouseleave", hide);
  panel.addEventListener("mouseenter", show);
  panel.addEventListener("mouseleave", hide);
}

function initAutohide() {
  const btn = document.getElementById("autohide-toggle");
  if (btn) {
    btn.addEventListener("click", () => { _autohide = !_autohide; applyAutohide(); });
    // The pulse is a one-time discovery hint. Once the user hovers the toggle they
    // understand what it does, so stop the animation — and remember that across
    // sessions so it never pulses again on this device.
    if (localStorage.getItem("wa:ahSeen")) btn.classList.add("learned");
    btn.addEventListener("mouseenter", () => {
      btn.classList.add("learned");
      try { localStorage.setItem("wa:ahSeen", "1"); } catch {}
    }, { once: true });
  }
  wireReveal("top", "hz-top", ".topbar");
  applyAutohide();
}

// dd/mm/yyyy <-> yyyy-mm-dd. displayToIso returns null for anything that
// isn't a real calendar date (e.g. 31/02/2026), not just wrong shape.
function isoToDisplay(iso) { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }
function displayToIso(v) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return null;
  const [, d, mo, y] = m;
  const dt = new Date(`${y}-${mo}-${d}T00:00:00`);
  if (dt.getFullYear() != +y || dt.getMonth() + 1 != +mo || dt.getDate() != +d) return null;
  return `${y}-${mo}-${d}`;
}

function initCalNav() {
  const wrap = document.getElementById("cal-nav-wrap");
  const ico = document.getElementById("cal-nav-ico");
  const input = document.getElementById("cal-nav-input");
  const pop = document.getElementById("cal-nav-pop");
  const errBox = document.getElementById("cal-nav-err");
  if (!wrap || !ico || !input || !pop || !errBox) return;

  // Escape the topbar's overflow:hidden by living on body
  document.body.appendChild(pop);
  document.body.appendChild(errBox);

  let counts = null;
  let errTimer = null;

  function positionPop() {
    const r = wrap.getBoundingClientRect();
    pop.style.top = (r.bottom + 8) + "px";
    pop.style.right = (window.innerWidth - r.right) + "px";
  }

  function hideErr() { errBox.hidden = true; clearTimeout(errTimer); }
  function showErr() {
    const r = wrap.getBoundingClientRect();
    errBox.style.top = (r.bottom + 8) + "px";
    errBox.style.right = (window.innerWidth - r.right) + "px";
    errBox.hidden = false;
    clearTimeout(errTimer);
    errTimer = setTimeout(hideErr, 3000);
  }

  // Jump straight to that date's wisdom on the home stage (dual image +
  // transcript + carousel arrows — same as clicking a card from Home),
  // instead of the Browse-by-Date list page. Shows the "not found" message
  // right under the date box (not a generic toast) if that date has no entry.
  async function goToDateEntry(iso) {
    try {
      const res = await api(`/api/browse?date=${encodeURIComponent(iso)}`);
      if (res.results && res.results.length) go(`#/?sel=${res.results[0].id}`);
      else showErr();
    } catch { showErr(); }
  }

  async function openPop() {
    hideErr();
    positionPop();
    pop.hidden = false;
    if (!counts) {
      pop.innerHTML = `<div style="padding:12px;font-size:13px;color:var(--muted)">Loading…</div>`;
      try {
        const data = await api("/api/browse?group=date");
        counts = new Map((data.periods || []).map((p) => [p.period, p.count]));
      } catch { counts = new Map(); }
    }
    pop.innerHTML = "";
    const cal = buildCalendar(counts, {
      onPick(iso) {
        pop.hidden = true;
        input.value = isoToDisplay(iso);
        goToDateEntry(iso);
      }
    });
    pop.appendChild(cal);
  }

  ico.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop.hidden) openPop(); else pop.hidden = true;
  });
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !wrap.contains(e.target)) pop.hidden = true;
  });

  // Auto-inserts "/" as digits are typed (dd/mm/yyyy). The calendar opens the
  // moment typing starts (so it's visible while entering the date), and the
  // instant a complete, real date is typed, it closes and shows that date's
  // results — no Enter needed.
  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "").slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    input.value = out;
    hideErr();

    if (digits.length === 0) { pop.hidden = true; return; }
    if (pop.hidden) openPop();

    if (digits.length === 8) {
      const iso = displayToIso(out);
      if (iso) { pop.hidden = true; goToDateEntry(iso); }
    }
  });
}

// Show which wisdom is currently on screen inside the ID button: the id is
// always visible; the date reveals on hover (see the .id-date CSS).
function updateIdNav(id, date) {
  const numEl = document.getElementById("id-num");
  const dateEl = document.getElementById("id-date");
  if (numEl && dateEl) {
    numEl.textContent = id ? String(id) : "";
    dateEl.textContent = id && date ? "· " + fmtDate(date) : "";
  }
  // Every place the viewed wisdom changes (Home's carousel, search/favorites
  // detail, the standalone entry page) funnels through here — so an already-
  // open Community panel's chat follows along to whichever wisdom is now
  // being viewed, instead of staying stuck on the one it opened with.
  const panel = document.getElementById("fab-panel");
  if (panel && !panel.hidden) {
    const body = document.getElementById("fab-panel-body");
    if (body) renderCommunityTab(body);
  }
}

// "ID" button — type a wisdom number and jump straight to it.
function initIdNav() {
  const btn = document.getElementById("id-nav-btn");
  const pop = document.getElementById("id-nav-pop");
  if (!btn || !pop) return;
  document.body.appendChild(pop);   // escape the topbar's overflow like the date popover
  pop.innerHTML = `<form class="id-nav-form">
    <label for="id-nav-input">Go to Guru's msg number</label>
    <div class="id-nav-row"><input id="id-nav-input" type="number" inputmode="numeric" min="1" step="1" placeholder="e.g. 3420" autocomplete="off"><button type="submit" class="btn primary">Go</button></div>
    <div class="id-nav-hint"></div></form>`;
  const input = pop.querySelector("#id-nav-input");
  const hint = pop.querySelector(".id-nav-hint");

  function positionPop() {
    const r = btn.getBoundingClientRect();
    pop.style.top = (r.bottom + 8) + "px";
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
  }
  function openPop() {
    pop.hidden = false; positionPop();
    input.value = "";
    hint.textContent = _stageId ? ("Currently showing ID " + _stageId) : "";
    input.focus();
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop.hidden) openPop(); else pop.hidden = true;
  });
  pop.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = parseInt(input.value, 10);
    if (!id || id < 1) { hint.textContent = "Enter a valid Guru's msg number."; return; }
    pop.hidden = true;
    selectStage(id);   // shows it on the home stage, or opens the entry page elsewhere
  });
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) pop.hidden = true;
  });
}

let debounce;
searchInput.addEventListener("input", () => {
  clearTimeout(debounce);
  const v = searchInput.value;
  debounce = setTimeout(() => { history.replaceState(null, "", v.trim() ? "#/search?q=" + encodeURIComponent(v) : "#/search"); safeRoute(); }, 200);
});
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(debounce); go("#/search?q=" + encodeURIComponent(searchInput.value)); } });
searchClear.addEventListener("click", () => { searchInput.value = ""; searchInput.focus(); go("#/search"); });
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); searchInput.focus(); } });

// Left/Right steps the carousel — Home's date-based one (_stageId set) or a
// search result's list-scoped one (_searchBackFn set) — by clicking whichever
// arrow button is actually rendered, so it naturally does nothing at either
// end (no button there = nothing to click). Skipped while typing anywhere, or
// while the lightbox (which has its own zoom/pan) is open.
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if ((!_stageId && !_searchBackFn) || e.ctrlKey || e.metaKey || e.altKey) return;
  const ae = document.activeElement;
  if (ae && (["INPUT", "TEXTAREA", "SELECT"].includes(ae.tagName) || ae.isContentEditable)) return;
  if (document.querySelector(".lightbox")) return;
  const btn = document.querySelector(e.key === "ArrowLeft" ? ".carousel-prev" : ".carousel-next");
  if (btn) { e.preventDefault(); btn.click(); }
});

// Escape closes a search result's detail view back to its list (only active
// while one is open — see _searchBackFn).
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && _searchBackFn) _searchBackFn();
});

// Show/hide password — works for any .pw-wrap eye button (current or future).
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".pw-eye"); if (!btn) return;
  const input = btn.parentElement.querySelector("input"); if (!input) return;
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.classList.toggle("on", show);
  btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  const on = btn.querySelector(".eye-on"), off = btn.querySelector(".eye-off");
  if (on && off) { on.style.display = show ? "none" : ""; off.style.display = show ? "" : "none"; }
});

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------
buildNav();
applyCollapsed();
initAvatar();
initAuthState();
initCommunityPanel();
initAutohide();
initCalNav();
initIdNav();
initQuickStats();
// ==========================================================================
// MOBILE SHELL — image-first UI for the Android app (and ?waNativeTest=1).
// Inactive on desktop: MOBILE_UI.active is false and nothing below runs.
//
// Routes it owns:   #/            latest wisdom, full-screen Hindi image
//                   #/entry/<id>  same viewer for any wisdom
//                   #/m/search    search by word / date / wisdom number
//                   #/m/community full-page community (reuses the chat tab)
//                   #/m/anushthan, #/m/special   placeholder pages (content later)
//                   #/m/contact   message to admin (Supabase admin_messages)
//                   #/m/account   sign in / profile
// Everything else (favorites, browse, stats, settings, …) falls through to the
// standard views, framed with the mobile top bar. Hindi/English switches with
// a book-flip; swipe (or the edge arrows) steps older/newer.
// ==========================================================================
const MOBILE_UI = (() => {
  const active = !!window.WA_NATIVE_ACTIVE;
  if (!active) return { active, handles: () => false, route: () => {}, fallthrough: () => {} };

  document.body.classList.add("m-mode");

  // ---- chrome (top bar, bottom bar, drawer) — injected once -------------
  document.body.insertAdjacentHTML("beforeend", `
    <header class="m-top" id="m-top">
      <button class="m-back" id="m-back" aria-label="Back">‹</button>
      <div class="m-title" id="m-title">Samarpan Upnishad</div>
    </header>
    <div class="m-vpanel" id="m-vpanel">
      <span class="m-vdate" id="m-panel-date"></span>
      <div class="m-vacts">
        <button class="m-vact m-vact-fav" id="m-panel-fav" title="Add to Favorites" aria-label="Add to Favorites">${HEART_ICON}</button>
        <button class="m-vact m-vact-share" id="m-panel-share" title="Share" aria-label="Share">${SHARE_ICON}</button>
        <a class="m-vact m-vact-dl" id="m-panel-dl" title="Download image" aria-label="Download image">${DOWNLOAD_ICON}</a>
      </div>
    </div>
    <nav class="m-bottom" id="m-bottom">
      <button class="m-navbtn m-menu-btn" id="m-menu-btn" title="Menu" aria-label="Menu">
        <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
      <button class="m-navbtn m-comm-btn" id="m-comm-btn" title="Community" aria-label="Community">
        <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
      <button class="m-navbtn m-home-btn" id="m-home-btn" title="Latest Guru's msg" aria-label="Latest Guru's msg">
        <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>
      </button>
      <div class="m-langseg" id="m-langseg" role="group" aria-label="Language">
        <button data-lang="hi" class="active">हिंदी</button>
        <button data-lang="en">English</button>
      </div>
    </nav>
    <div class="m-scrim" id="m-scrim" hidden></div>
    <aside class="m-drawer" id="m-drawer" aria-label="Menu">
      <a class="m-account" id="m-account-row" href="#/m/account"></a>
      <nav class="m-menu">
        <a href="#/m/search"><span class="mi">🔍</span> Search By</a>
        <a href="#/m/community"><span class="mi">💬</span> Community</a>
        <button class="m-menu-group" data-group="other"><span class="mi">🗂️</span> Other Messages <span class="m-caret">▾</span></button>
        <div class="m-submenu" data-sub="other" hidden>
          <a href="#/m/anushthan"><span class="mi">🪔</span> Anushthan Msg</a>
          <a href="#/m/special"><span class="mi">✨</span> Special Msg</a>
        </div>
        <a href="#/random" class="m-lucky"><span class="mi m-lucky-ico">🌟</span>
          <span class="m-lucky-text">Your Lucky Msg for Today</span>
          <span class="m-lucky-spark s1">✨</span><span class="m-lucky-spark s2">✨</span><span class="m-lucky-spark s3">⭐</span></a>
        <button class="m-menu-group" data-group="more"><span class="mi">➕</span> More <span class="m-caret">▾</span></button>
        <div class="m-submenu" data-sub="more" hidden>
          <a href="#/?latest=1"><span class="mi">🌅</span> Today's Guru's Msg</a>
          <a href="#/favorites"><span class="mi">♥</span> Favorites</a>
          <a href="#/browse/date"><span class="mi">📅</span> Browse by Date</a>
          <a href="#/stats"><span class="mi">📊</span> Statistics</a>
          <a href="#/m/contact"><span class="mi">✉️</span> Message to Admin</a>
          <a href="#/settings"><span class="mi">⚙️</span> Settings</a>
          <a href="#/about"><span class="mi">🕉️</span> About</a>
        </div>
      </nav>
    </aside>
    <div class="m-exit" id="m-exit" hidden>
      <div class="m-exit-card">
        <div class="m-exit-ico">🙏</div>
        <div class="m-exit-q">Do you want to exit Samarpan Upnishad?</div>
        <div class="m-exit-btns">
          <button class="btn" id="m-exit-no">Stay</button>
          <button class="btn primary" id="m-exit-yes">Exit</button>
        </div>
      </div>
    </div>`);

  const $ = (id) => document.getElementById(id);

  // ---- drawer ------------------------------------------------------------
  function refreshAccountRow() {
    const row = $("m-account-row");
    const u = currentUser();
    row.innerHTML = isSignedIn()
      ? `<span class="m-acc-avatar">${escapeHtml((u.username || "?")[0].toUpperCase())}</span>
         <span class="m-acc-name">${escapeHtml(u.username)}<small>${escapeHtml(u.role)}</small></span>`
      : `<span class="m-acc-avatar">॥</span>
         <span class="m-acc-name">Sign in<small>for community features</small></span>`;
  }
  function openDrawer() { refreshAccountRow(); $("m-drawer").classList.add("open"); $("m-scrim").hidden = false; }
  function closeDrawer() {
    const was = $("m-drawer").classList.contains("open");
    $("m-drawer").classList.remove("open"); $("m-scrim").hidden = true;
    // Fold the accordions so the drawer always reopens showing only the 5 main items.
    $("m-drawer").querySelectorAll(".m-submenu").forEach((s) => { s.hidden = true; });
    $("m-drawer").querySelectorAll(".m-menu-group").forEach((g) => g.classList.remove("open"));
    return was;
  }
  // Accordion groups (Other Messages / More)
  $("m-drawer").querySelectorAll(".m-menu-group").forEach((g) => {
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      const sub = $("m-drawer").querySelector(`.m-submenu[data-sub="${g.dataset.group}"]`);
      const opening = sub.hidden;
      sub.hidden = !opening;
      g.classList.toggle("open", opening);
    });
  });
  $("m-menu-btn").addEventListener("click", openDrawer);
  $("m-comm-btn").addEventListener("click", () => go("#/m/community"));
  $("m-home-btn").addEventListener("click", () => go("#/?latest=1"));
  $("m-scrim").addEventListener("click", closeDrawer);
  $("m-drawer").addEventListener("click", (e) => { if (e.target.closest("a")) closeDrawer(); });
  $("m-back").addEventListener("click", () => history.back());

  // ---- Android BACK + exit confirmation -----------------------------------
  // Registered here (not in wa-native.js) so the behaviour ships over-the-air.
  // Order: close an open overlay → walk history → on home, ask before exiting.
  function showExitSheet() { $("m-exit").hidden = false; }
  function hideExitSheet() { const was = !$("m-exit").hidden; $("m-exit").hidden = true; return was; }
  $("m-exit-no").addEventListener("click", hideExitSheet);
  $("m-exit").addEventListener("click", (e) => { if (e.target === $("m-exit")) hideExitSheet(); });
  $("m-exit-yes").addEventListener("click", () => {
    const app = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (app && app.exitApp) app.exitApp(); else hideExitSheet();   // browser test mode
  });
  function onHardwareBack() {
    if (hideExitSheet()) return;
    if (exitZoom()) return;
    if (closeDrawer()) return;
    const atHome = !location.hash || /^#\/?(\?.*)?$/.test(location.hash);
    if (atHome) { showExitSheet(); return; }
    const before = location.hash;
    history.back();
    // Deep-launched with no history to walk? Land on home instead of nowhere.
    setTimeout(() => { if (location.hash === before) location.hash = "#/"; }, 300);
  }
  window.WA_MOBILE_BACK = () => { onHardwareBack(); return true; };   // also serves older wa-native.js builds
  const _capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  if (_capApp && _capApp.addListener) _capApp.addListener("backButton", onHardwareBack);

  // ---- chrome state --------------------------------------------------------
  // mode: "home" (viewer, no back) | "viewer" (back + fav) | "page" (back + title)
  function setChrome(mode, title, entry) {
    const isImageScreen = mode === "home" || mode === "viewer";
    document.body.classList.toggle("m-viewing", isImageScreen);
    // Home/entry screens have no top bar at all now — the image goes full
    // height and each card's own overlay row (date + favorite/share/download)
    // takes its place. Every other page (Search, Settings, …) keeps the
    // normal back/title bar since it has no image to sit on top of.
    document.body.classList.toggle("m-notop", isImageScreen);
    $("m-back").style.visibility = mode === "home" ? "hidden" : "visible";
    $("m-title").textContent = title || "Samarpan Upnishad";
  }

  // ---- user display preferences (zoom bar side) -----------
  function pref(k, d) { try { return localStorage.getItem(k) || d; } catch { return d; } }
  function setPref(k, v) { try { localStorage.setItem(k, v); } catch {} }

  // ---- zoom mode (double-tap the image) ----------------------------------
  // Full-screen dark viewer with a vertical zoom bar on the chosen edge:
  // bottom = thumbnail (0.25x), middle notch = normal (1x), top = 4x.
  // One finger drags the zoomed image, two fingers pinch (the knob follows).
  // Double-tap again (or Android back) returns to the normal reader.
  let zoomWrap = null;
  const zScale = (v) => 0.25 * Math.pow(16, v / 100);          // 0→.25  50→1  100→4
  const zValue = (s) => 100 * Math.log(s / 0.25) / Math.log(16);
  function tDist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  // Robust double-tap (+ optional single-tap) detection. Each touch is tracked
  // from touchSTART: it only counts as a tap if it was a single finger, barely
  // moved, and was reasonably brief. Two such taps close in time/space fire the
  // double-tap; a lone tap (when onSingle is given) fires after a short delay
  // unless a second tap arrives first.
  //
  // Thresholds are tuned for REAL FINGERS, not a mouse. A physical "stationary"
  // tap routinely jitters 15-25px and a deliberate press easily runs past
  // 300ms — the earlier tight limits (12px / 300ms) silently rejected genuine
  // taps, so double-tap only worked "sometimes" on-device while testing clean
  // on desktop (0px, instant clicks). These looser limits still leave scrolls
  // and pans (which move far more) and pinches (multi-touch) correctly excluded.
  const DT_SLOP = 24;      // px a finger may drift and still be a "tap"
  const DT_TAP_MS = 550;   // max press duration to count as a tap
  const DT_GAP_MS = 450;   // max finger-OFF time between the two taps (release→next press)
  const DT_NEAR = 60;      // max distance between the two taps
  // After a touch double-tap, Android WebView synthesizes a native `dblclick`
  // hit-tested at the finger's position — which lands on whatever is topmost
  // AT THAT MOMENT. So opening zoom got instantly closed (the ghost dblclick
  // hit the just-mounted overlay) and closing zoom got instantly reopened (it
  // hit the image underneath). Defence 1: preventDefault() on the confirming
  // touchend stops the browser synthesizing mouse events from those touches.
  // Defence 2 (belt-and-braces for WebViews that synthesize anyway): stamp
  // every touchend globally, and ignore any dblclick within 800ms of a touch —
  // real mouse double-clicks (desktop, no touches) still pass.
  let _lastTouchTs = 0;
  document.addEventListener("touchend", () => { _lastTouchTs = Date.now(); }, { capture: true, passive: true });
  function wireDoubleTap(elm, onDouble, onSingle) {
    // lastEnd = timestamp the previous valid tap was RELEASED. The double-tap
    // window is measured release→next-press (finger-off time), NOT end→end, so
    // a slow/firm press on either tap doesn't blow the window — only how fast
    // the finger comes back down matters.
    let lastEnd = 0, lastX = 0, lastY = 0;
    let sx = 0, sy = 0, st = 0, moved = false, multi = false;
    let singleTimer = null;
    elm.addEventListener("touchstart", (e) => {
      if (e.touches.length > 1) { multi = true; return; }
      multi = false; moved = false;
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now();
    }, { passive: true });
    elm.addEventListener("touchmove", (e) => {
      const t = e.touches[0]; if (!t) return;
      if (Math.hypot(t.clientX - sx, t.clientY - sy) > DT_SLOP) moved = true;
    }, { passive: true });
    elm.addEventListener("touchend", (e) => {
      const t = e.changedTouches[0]; if (!t) return;
      // Not a clean tap (multi-touch, dragged, or long press) → reset, ignore.
      if (multi || moved || Date.now() - st > DT_TAP_MS) { lastEnd = 0; return; }
      // st = this tap's press time; lastEnd = previous tap's release time.
      // (st - lastEnd) is therefore the finger-off gap between the two taps.
      if (lastEnd && (st - lastEnd) < DT_GAP_MS && Math.hypot(t.clientX - lastX, t.clientY - lastY) < DT_NEAR) {
        lastEnd = 0;
        if (singleTimer) { clearTimeout(singleTimer); singleTimer = null; }
        if (e.cancelable) e.preventDefault();   // no synthesized click/dblclick from this gesture
        onDouble();
      } else {
        lastEnd = Date.now(); lastX = t.clientX; lastY = t.clientY;
        if (onSingle) {
          if (singleTimer) clearTimeout(singleTimer);
          singleTimer = setTimeout(() => { singleTimer = null; onSingle(); }, DT_GAP_MS + 30);
        }
      }
    });
    // Desktop/browser test mode only — a dblclick right after touch activity is
    // the WebView's synthesized ghost (see above), not a real mouse gesture.
    elm.addEventListener("dblclick", () => { if (Date.now() - _lastTouchTs < 800) return; onDouble(); });
  }
  function exitZoom() {
    if (!zoomWrap) return false;
    zoomWrap.remove(); zoomWrap = null;
    document.body.classList.remove("m-zoom");
    return true;
  }
  function enterZoom(imgSrc) {
    exitZoom();
    document.body.classList.add("m-zoom");
    const side = pref("wa:mobile:zoomBarSide", "right");
    // Compact volume-rocker capsule (bottom = thumbnail, mid tick = normal,
    // top = max), fill rises from the bottom. Sits low on the right edge and
    // auto-hides ~2s after the last interaction.
    zoomWrap = el(`<div class="m-zoomwrap${side === "left" ? " m-left" : ""}">
      <div class="m-zoomview"><img src="${imgSrc}" alt="" draggable="false"></div>
      <div class="m-zoombar m-hidden">
        <div class="m-zb-track"><div class="m-zb-fill"></div></div>
        <div class="m-zb-mid"></div>
        <div class="m-zb-knob"></div>
        <div class="m-zb-badge"></div>
      </div>
    </div>`);
    document.body.appendChild(zoomWrap);
    const img = zoomWrap.querySelector("img");
    const view = zoomWrap.querySelector(".m-zoomview");
    const bar = zoomWrap.querySelector(".m-zoombar");
    const fill = zoomWrap.querySelector(".m-zb-fill");
    const knob = zoomWrap.querySelector(".m-zb-knob");
    const badge = zoomWrap.querySelector(".m-zb-badge");
    let v = 50, tx = 0, ty = 0;
    const apply = () => {
      const s = zScale(v);
      const mx = Math.max(0, (img.clientWidth * s - view.clientWidth) / 2);
      const my = Math.max(0, (img.clientHeight * s - view.clientHeight) / 2);
      tx = Math.min(mx, Math.max(-mx, tx)); ty = Math.min(my, Math.max(-my, ty));
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      fill.style.height = v + "%";
      knob.style.bottom = v + "%";
      badge.style.bottom = v + "%";
      badge.textContent = Math.round(v) + "%";
    };
    img.addEventListener("load", apply);
    apply();

    // --- auto-hide (fades out ~2s after the last interaction)
    let hideTimer = null;
    const showBar = () => {
      bar.classList.remove("m-hidden");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => bar.classList.add("m-hidden"), 2000);
    };
    const hideBar = () => { clearTimeout(hideTimer); bar.classList.add("m-hidden"); };

    // --- capsule drag (with a light snap + haptic tick at the 50 = normal mark)
    let snapped = false;
    const setFromY = (clientY) => {
      const r = bar.getBoundingClientRect();
      let nv = Math.max(0, Math.min(100, 100 - ((clientY - r.top) / r.height) * 100));
      if (Math.abs(nv - 50) < 6) {
        if (!snapped) { try { navigator.vibrate && navigator.vibrate(8); } catch {} }
        nv = 50; snapped = true;
      } else snapped = false;
      v = nv; apply(); showBar();
    };
    bar.addEventListener("touchstart", (e) => { e.stopPropagation(); badge.classList.add("on"); setFromY(e.touches[0].clientY); }, { passive: true });
    bar.addEventListener("touchmove", (e) => { e.stopPropagation(); setFromY(e.touches[0].clientY); }, { passive: true });
    bar.addEventListener("touchend", (e) => { e.stopPropagation(); badge.classList.remove("on"); showBar(); }, { passive: true });
    bar.addEventListener("mousedown", (e) => {
      e.preventDefault(); badge.classList.add("on"); setFromY(e.clientY);
      const mv = (ev) => setFromY(ev.clientY);
      const up = () => { badge.classList.remove("on"); showBar(); window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
    });

    // --- one-finger pan, two-finger pinch
    let p0 = null, pinch0 = null;
    view.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) { p0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }; pinch0 = null; }
      else if (e.touches.length === 2) { pinch0 = { d: tDist(e.touches), v }; p0 = null; }
    }, { passive: true });
    view.addEventListener("touchmove", (e) => {
      if (e.touches.length === 1 && p0) {
        tx += e.touches[0].clientX - p0.x; ty += e.touches[0].clientY - p0.y;
        p0 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        apply();
      } else if (e.touches.length === 2 && pinch0) {
        v = Math.max(0, Math.min(100, zValue(zScale(pinch0.v) * tDist(e.touches) / pinch0.d)));
        apply(); showBar();
      }
    }, { passive: true });
    view.addEventListener("touchend", (e) => { if (!e.touches.length) { p0 = null; pinch0 = null; } }, { passive: true });

    // Double-tap exits zoom; a single tap on the image toggles the bar.
    wireDoubleTap(view, exitZoom, () => {
      if (bar.classList.contains("m-hidden")) showBar(); else hideBar();
    });
    showBar();   // visible on entry, then auto-hides
  }

  // ---- language toggle (bottom bar) → flips every mounted feed card -----
  let prefLang = "hi";   // Hindi on every app open; the user's flip choice then
                         // sticks while scrolling through days this session
  let _feedCards = [];   // controllers for the currently mounted slides
  // Set right before navigating from a curated list (Favorites, Word search)
  // into one of its items: confines the vertical feed to that list instead of
  // the whole chronological archive. Self-correcting — buildFeed() only
  // honours it while the entry actually being viewed is still in the list,
  // so a later unrelated navigation harmlessly falls back to normal browsing.
  let _activeList = null;   // { ids: [...], index: N } | null
  function setActiveList(ids, index) { _activeList = { ids: ids.slice(), index }; }
  function paintLang(lang) {
    $("m-langseg").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.lang === lang));
  }
  function applyLangToFeed(l, animate) {
    // Language toggle is a page-flip too — play the same flip sound, but only
    // when the language actually changes and the toggle was user-driven
    // (animate), not on silent programmatic sync.
    if (animate && l !== prefLang) playFlipSound();
    prefLang = l;
    paintLang(l);
    _feedCards.forEach((c) => c && c.setLang(l, animate));
  }
  $("m-langseg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    applyLangToFeed(b.dataset.lang, true);
  });

  // ---- page-flip sound (scrolling to another day, older or newer) ---------
  // A REAL recorded page-flip (user-supplied MP3), embedded as base64 so it
  // ships OTA inside app.js (no separate asset a new APK would need). Decoded
  // ONCE into a PCM AudioBuffer on the first touch (warmFlipAudio) and trimmed
  // to a ~400ms window centred on the clip's loud "flip" burst, with a fade in
  // from silence and out to silence -> plays as silence -> peak -> silence, one
  // full page-turn arc. Web Audio = ~0ms play latency + free overlap. Toggle
  // "Flip sound", default ON (same localStorage key as the old tick).
  const FLIP_MP3_B64 = "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VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//vUZAAP8Y0HMAP8yBBbhuUAf6MKBMQavg/vIACcA1QB/mgAPhWCKDFfgdk/e/jfCTNJlwysNT1aNYFLJjKwz+03VjRzSX2VbWf/X/3cXZq/1///aKm+enAJjlwFGdQmMasEWZkiwY+BuYlgsDhRDAXQ5p7MpmpuoBhB6WcZQwN4f979LJud//+WGooBBBg6OlR5+TVrJYfssjkZZfkasoYGCBOGXYs3//+oVT1r+oXIn25E3pgMIL0adJmVoxqRmKcCAU5oJnorPcyf/////0f///7f//oPnFJhzDdQfI5k3TTZ4OxFNmmMwRAwpkr7Ndi3P/////////////pTEFVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVPkgYfzJIRaY+Qqs3vZI0yP8zJKQ/mk464HHS5xggKOUVmL1SvnUzxt7y5cGkAiXhc0QWBGnyiBjmixe6Lr3Irsai+3u/r/1///X/r/1H4GJ1JjW4i4dSQWa3pYfBfnIvRrSSZeOBgSpUXFXVLT5wmp3///7f//s/2/7f//kv8mfC//vURECP8msNK4P90BAyANWQf7sAB5Qaqg/zIkKINhRB/Qz5qs8mYIjDxiRQYKYTmDmHgpOb/YhqQ8mYRsDwRGQZA6GzqhIGhwNFQVLBoseKuErhF2z3/////////+k/NW2dNYBL5DIahdkxJUN6MLmCRTB9QYwwUwEFMDHAhDmAwamNMfMuCStlDvTbuzEOzU9KaKNUcZsRmpLrstrWqt4BGAhYCgEDEhRIYUFIMYC4CgqiQwoKakzqjVqrGpM7OsaqzMak1WNGpMak21WNVhMak2sWNShqS7axqrkxrtrSh0oZa7aw6dKa7U8odKG2u2XsdKa7bUodIMxjlqSW5xJMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//vUZAAP8UcGrYP8yBBEyRRAf7QSBBQWuA/l4ACvA1PB/uwAP8BF+TFNwiA+1DzeqcNHF8yuODydNcJKFoy7Xes//////6f//////9J5yn8gbNgedmUKjsRiyQjWfD3IcuPqbKqMZ8FiB5TQGIZgb1gBnhYb96Tf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";
  const FLIP_START = 0.46, FLIP_LEN = 0.40, FLIP_FADE_IN = 0.13, FLIP_FADE_OUT = 0.06;
  let _sndCtx = null, _flipBuf = null, _flipWarming = false;
  function flipSoundEnabled() { return pref("wa:mobile:tickSound", "1") === "1"; }
  function _b64ToArrayBuffer(b64) {
    const bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  // Build the trimmed+faded AudioBuffer once, on the first user gesture (audio
  // can't start before one). Doing it early means the very first flip isn't
  // silent and has no decode lag.
  function warmFlipAudio() {
    if (_flipBuf || _flipWarming) return;
    _flipWarming = true;
    try {
      _sndCtx = _sndCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (_sndCtx.state === "suspended") _sndCtx.resume();
      _sndCtx.decodeAudioData(_b64ToArrayBuffer(FLIP_MP3_B64), (full) => {
        try {
          const ctx = _sndCtx, sr = full.sampleRate;
          const start = Math.max(0, Math.floor(FLIP_START * sr));
          const len = Math.min(Math.floor(FLIP_LEN * sr), full.length - start);
          const chs = full.numberOfChannels;
          const out = ctx.createBuffer(chs, len, sr);
          const fi = Math.max(1, Math.floor(FLIP_FADE_IN * sr));
          const fo = Math.max(1, Math.floor(FLIP_FADE_OUT * sr));
          for (let c = 0; c < chs; c++) {
            const s = full.getChannelData(c), d = out.getChannelData(c);
            for (let i = 0; i < len; i++) {
              let g = 1;
              if (i < fi) g = i / fi;                    // fade in from silence
              else if (i > len - fo) g = (len - i) / fo; // fade out to silence
              d[i] = s[start + i] * g;
            }
          }
          _flipBuf = out;
        } catch {}
      }, () => { _flipWarming = false; });
    } catch { _flipWarming = false; }
  }
  function playFlipSound() {
    if (!flipSoundEnabled()) return;
    if (!_flipBuf) { warmFlipAudio(); return; }   // first flip before warm finished — ready next time
    try {
      if (_sndCtx.state === "suspended") _sndCtx.resume();
      const s = _sndCtx.createBufferSource(); s.buffer = _flipBuf;
      s.connect(_sndCtx.destination); s.start();
    } catch {}
  }
  // Warm the audio engine on the first user interaction of any kind.
  ["touchstart", "pointerdown", "mousedown"].forEach((ev) =>
    document.addEventListener(ev, warmFlipAudio, { once: true, passive: true, capture: true }));

  // ---- the viewer (home + #/entry/<id>) ----------------------------------
  async function viewer(id, params, isHome) {
    setChrome(isHome ? "home" : "viewer", "Samarpan Upnishad", null);
    $view.innerHTML = `<div class="loading">Loading…</div>`;
    const nav = _nav;
    try {
      if (!id) {
        const sel = params && params.get("sel");
        if (sel) { id = sel; }
        else {
          const latest = await api("/api/latest?limit=1");
          if (!latest.results.length) { $view.innerHTML = `<div class="m-page"><div class="empty">No Guru's msg yet.</div></div>`; return; }
          id = latest.results[0].id;
        }
      }
      const e = await api("/api/entry/" + encodeURIComponent(id));
      if (!current(nav)) return;
      // Lucky Msg / a typed-in number lookup: one standalone message, no
      // scrolling away to other days.
      if (params && params.get("single") === "1") renderSingleCard(e);
      else await buildFeed(e, isHome);
    } catch (err) {
      if (!current(nav)) return;
      setChrome("page", "Guru's msg");
      $view.innerHTML = `<div class="m-page"><div class="empty">Guru's msg #${escapeHtml(String(id || ""))} not found.</div></div>`;
    }
  }

  function renderSingleCard(e) {
    setChrome("viewer", "Samarpan Upnishad", e);
    _stageId = e.id;
    store.setLastViewed(e.id);
    paintLang(prefLang);
    const ctl = buildViewerCard(e, true);
    _feedCards = [ctl];
    const wrap = el(`<div class="m-singlewrap"></div>`);
    wrap.appendChild(ctl.root);
    $view.replaceChildren(wrap);
  }

  function faceHtml(e, lang) {
    const url = lang === "hi" ? e.img_hi_url : e.img_en_url;
    if (url) return `<img src="${url}" alt="" decoding="async">`;
    const topic = escapeHtml(e.topic_hi || e.topic_en || "");
    const body = escapeHtml((lang === "hi" ? e.body_hi : e.body_en) || "");
    if (body) return `<div class="m-textface">${topic ? `<h3>${topic}</h3>` : ""}<p>${body.replace(/\n/g, "<br>")}</p></div>`;
    return `<div class="m-noimg">🕉️<br>${lang === "hi" ? "Hindi" : "English"} message is not available for this day.</div>`;
  }

  // ---- native Share / Save-to-Gallery (Android) --------------------------
  // True system-clipboard image copy needs custom native code with no
  // reliable ready-made plugin, so mobile drops "Copy" and keeps Share +
  // Download, both backed by real Capacitor plugins instead of the web APIs
  // (navigator.share / <a download>) that don't work inside the WebView.
  const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  async function nativeShareImage(url, filename, text) {
    const P = window.Capacitor.Plugins;
    const dataUri = await blobToDataUri(await (await fetch(url)).blob());
    const path = "wa-share/" + filename;
    await P.Filesystem.writeFile({ path, directory: "CACHE", data: dataUri.split(",")[1], recursive: true });
    const { uri } = await P.Filesystem.getUri({ path, directory: "CACHE" });
    // title doubles as the e-mail SUBJECT on mail targets; text is the caption
    // most chat apps show. Use the same line for both.
    await P.Share.share({ title: text, text, files: [uri], dialogTitle: "Share" });
  }
  const GALLERY_ALBUM = "Samarpan Upnishad";
  async function ensureGalleryAlbum() {
    const Media = window.Capacitor.Plugins.Media;
    try { await Media.createAlbum({ name: GALLERY_ALBUM }); } catch {}   // already exists — fine
    const { path } = await Media.getAlbumsPath();
    return path + "/" + GALLERY_ALBUM;
  }
  async function nativeSaveToGallery(url, filename) {
    const dataUri = await blobToDataUri(await (await fetch(url)).blob());
    const albumIdentifier = await ensureGalleryAlbum();
    await window.Capacitor.Plugins.Media.savePhoto({
      path: dataUri, albumIdentifier, fileName: filename.replace(/\.[^.]+$/, ""),
    });
  }

  // Fixed panel above the image (date/day left in accent + fav/share/download
  // right) — ONE shared DOM node (injected with the rest of the chrome), not
  // part of any card. Re-synced to whichever card is "current" every time a
  // card claims it, via wireVPanel(). Kept out of the per-card markup so
  // future tap-to-open-calendar wiring on the date has a single stable node
  // to attach to, instead of 3 recycled copies in the scrolling feed.
  function wireVPanel(e, curImg, curName, curCaption) {
    $("m-panel-date").textContent = fmtDate(e.date) + (e.weekday ? " · " + e.weekday : "");

    const fav = $("m-panel-fav");
    fav.classList.toggle("on", store.isFav(e.id));
    fav.onclick = () => { store.toggleFav(e.id); fav.classList.toggle("on", store.isFav(e.id)); };

    $("m-panel-share").onclick = async () => {
      const u = curImg(); if (!u) { toast("No image to share."); return; }
      if (isNativeApp && window.Capacitor.Plugins.Share) {
        try { await nativeShareImage(u, curName(), curCaption()); }
        catch (err) { toast("Couldn't share: " + (err && err.message ? err.message : "please try again.")); }
      } else {
        shareImage(u, curName(), curCaption());
      }
    };

    const dl = $("m-panel-dl");
    const u = curImg();
    if (u) { dl.href = u; dl.setAttribute("download", curName()); dl.classList.remove("m-vact-disabled"); }
    else { dl.removeAttribute("href"); dl.classList.add("m-vact-disabled"); }
    dl.onclick = async (ev) => {
      if (!isNativeApp) return;   // desktop/browser: the plain <a download> handles it
      ev.preventDefault();
      const uu = curImg(); if (!uu) { toast("No image to save."); return; }
      dl.classList.add("m-vact-disabled");
      try { await nativeSaveToGallery(uu, curName()); toast("Saved to Gallery → " + GALLERY_ALBUM); }
      catch (err) { toast("Couldn't save: " + (err && err.message ? err.message : "please try again.")); }
      finally { dl.classList.remove("m-vact-disabled"); }
    };
  }

  // One reading card: the flip image + extra pages. `cur` marks the centered
  // slide — only it drives the shared top panel. Cards are POOLED and reused
  // across flips (see getCard/_cardPool), so `cur` is mutable via setCurrent():
  // a pooled card re-wires the panel when it becomes the centre again, and its
  // already-decoded image is preserved (no re-decode), which is what keeps
  // rapid consecutive flips smooth. Returned as a controller so the language
  // toggle can update every mounted card at once.
  function buildViewerCard(e, isCurrent) {
    let cur = !!isCurrent;
    let lang = prefLang;
    if (lang === "hi" && !(e.img_hi_url || e.body_hi)) lang = "en";
    if (lang === "en" && !(e.img_en_url || e.body_en)) lang = "hi";

    const root = el(`<div class="m-viewer">
      <div class="m-flip"><div class="m-flip-inner">
        <div class="m-face m-front">${faceHtml(e, "hi")}</div>
        <div class="m-face m-back">${faceHtml(e, "en")}</div>
      </div></div>
      <div class="m-extras"></div>
    </div>`);
    const flip = root.querySelector(".m-flip");
    if (lang === "en") {
      flip.classList.add("flipped");
      const inner = flip.querySelector(".m-flip-inner");
      inner.style.transition = "none";
      requestAnimationFrame(() => { inner.style.transition = ""; });
    }


    const extrasBox = root.querySelector(".m-extras");
    const renderExtras = () => {
      const pages = (e.extras || []).filter((x) => x.lang === lang);
      extrasBox.innerHTML = pages.map((x) => `<img src="${x.url}" alt="" loading="lazy" decoding="async">`).join("");
    };
    renderExtras();

    // Double-tap the image → full-screen zoom mode on the visible language.
    wireDoubleTap(flip, () => {
      const im = root.querySelector(lang === "hi" ? ".m-front img" : ".m-back img");
      if (im && im.getAttribute("src")) enterZoom(im.getAttribute("src"));
    });

    // Share / Download act on whichever language image is visible now.
    const curImg = () => (lang === "hi" ? e.img_hi_url : e.img_en_url);
    const curName = () => `GM_${e.date ? fmtDateFile(e.date) : e.id}.jpg`;
    // Share subject/caption = one clean line, e.g. "Guru's Daily msg - 9th July, 2026".
    const curCaption = () => `Guru's Daily msg - ${fmtDateShare(e.date)}`;
    const wirePanel = () => wireVPanel(e, curImg, curName, curCaption);
    function setCurrent(v) { cur = !!v; if (cur) wirePanel(); }
    if (cur) wirePanel();

    function setLang(l, animate) {
      if (l === lang) return;
      lang = l;
      const inner = flip.querySelector(".m-flip-inner");
      const doFlip = () => {
        if (!animate) inner.style.transition = "none";
        flip.classList.toggle("flipped", lang === "en");   // reads live `lang` — safe on rapid re-toggles
        if (!animate) requestAnimationFrame(() => { inner.style.transition = ""; });
        renderExtras();
        if (cur) wirePanel();
      };
      // Decode the incoming face FIRST, then flip. Chromium never decodes (and
      // evicts any decoded bitmap of) the rotated-away backface-hidden image —
      // pre-decoding at build time measurably does NOT survive. So flipping
      // straight away rasterized an undecoded full-screen JPG: blank face,
      // then the bitmap "popped in" when the async decode landed (the visible
      // post-flip adjust). decode()-then-flip guarantees the bitmap is ready
      // for the animation's first frame; the timeout caps a slow/failed decode
      // so the gesture can never stall.
      const im = root.querySelector(lang === "hi" ? ".m-front img" : ".m-back img");
      if (animate && im && im.complete) {
        let done = false;
        const go = () => { if (!done) { done = true; doFlip(); } };
        try { im.decode().then(go, go); } catch { go(); }
        setTimeout(go, 250);
      } else {
        doFlip();
      }
    }

    return { root, setLang, setCurrent, entry: e };
  }

  function feedSlideEl(ctl, kind) {
    const slide = el(`<div class="m-feedslide" data-kind="${kind}"></div>`);
    slide.appendChild(ctl.root);
    return slide;
  }

  // ---- feed caches (consecutive flips rebuild from memory, not the API) ----
  // Entries are immutable, so the entry cache is safe. Neighbor lookups are
  // cached ONLY when a newer neighbor exists — the newest entry's "no newer"
  // answer must stay fresh so the daily sync's new message is seen without an
  // app restart. Image warmup fetches + decodes ahead so a flip never lands
  // on a cold image.
  const _entryCache = new Map(), _nbrCache = new Map(), _imgWarm = new Map();
  // Single, cancellable look-ahead prefetch handle (see buildFeed): each flip
  // cancels the previous flip's pending prefetch so rapid flipping can't pile
  // up a backlog of image-decode callbacks that fire all at once and stutter.
  let _prefetchHandle = null, _prefetchIsIdle = false;
  function cancelPrefetch() {
    if (_prefetchHandle == null) return;
    if (_prefetchIsIdle && window.cancelIdleCallback) cancelIdleCallback(_prefetchHandle);
    else clearTimeout(_prefetchHandle);
    _prefetchHandle = null;
  }
  function trimMap(m, max) { while (m.size > max) m.delete(m.keys().next().value); }
  async function getEntryCached(id) {
    if (_entryCache.has(id)) return _entryCache.get(id);
    const e = await api("/api/entry/" + encodeURIComponent(id));
    _entryCache.set(id, e); trimMap(_entryCache, 40);
    return e;
  }
  async function getNeighborsCached(id) {
    if (_nbrCache.has(id)) return _nbrCache.get(id);
    const n = await api("/api/entry/" + encodeURIComponent(id) + "/neighbors");
    if (n.newer_id) { _nbrCache.set(id, n); trimMap(_nbrCache, 60); }
    return n;
  }
  function warmImages(e) {
    if (!e) return;
    [e.img_hi_url, e.img_en_url].forEach((u) => {
      if (!u || _imgWarm.has(u)) return;
      const im = new Image(); im.decoding = "async"; im.src = u;
      _imgWarm.set(u, im); trimMap(_imgWarm, 24);
    });
  }

  // ---- card pool (Phase 2: reuse DOM + decoded images across flips) --------
  // The 4th-flip stutter was rebuild-per-flip: every settle tore down all three
  // slides and built three fresh <img>, forcing full-screen re-decodes + new
  // GPU textures that saturated after a few flips. Now cards are kept in an LRU
  // pool keyed by entry id and REUSED: a flip builds at most ONE new card (the
  // freshly-revealed neighbor); the two that carry over keep their live DOM and
  // already-decoded bitmaps, so nothing re-decodes and textures stay stable.
  const _cardPool = new Map();
  function getCard(e) {
    let c = _cardPool.get(e.id);
    if (c) {
      _cardPool.delete(e.id); _cardPool.set(e.id, c);   // LRU bump
      c.setLang(prefLang, false);                        // sync language if it changed while pooled
    } else {
      c = buildViewerCard(e, false);
      _cardPool.set(e.id, c);
      while (_cardPool.size > 6) {                        // evict oldest (never one of the 3 just bumped)
        const k = _cardPool.keys().next().value, old = _cardPool.get(k);
        _cardPool.delete(k);
        if (old.root.parentNode) old.root.parentNode.removeChild(old.root);
      }
    }
    return c;
  }

  // Vertical scroll-snap feed: OLDER (top) · CURRENT (middle) · NEWER (bottom).
  // Swiping DOWN reveals OLDER (a page-flip sound plays); swiping UP reveals
  // NEWER — the same up/down convention as Reels/Shorts.
  let _feedSettling = false;
  async function buildFeed(centerEntry, isHome) {
    setChrome(isHome ? "home" : "viewer", "Samarpan Upnishad", centerEntry);
    _stageId = centerEntry.id;
    store.setLastViewed(centerEntry.id);
    // replaceState (not a new history entry) — scrolling through days must
    // not flood the back-stack; the URL still stays accurate for sharing.
    // Home keeps hash "#/" throughout the whole scroll session (never rewritten
    // to a specific id) so the exit-popup's "am I at Home?" check keeps working
    // no matter how many older/newer entries the user has scrolled through.
    if (!isHome) history.replaceState(null, "", "#/entry/" + centerEntry.id);

    // Browsing a curated list (Favorites, Word search results)? Scroll within
    // just that list, in the order it was shown — not the whole chronological
    // archive. Self-correcting: only applies while the current id is still
    // actually in the list, so it can't leak into unrelated navigation.
    const listMode = _activeList && _activeList.ids.includes(centerEntry.id) ? _activeList : null;
    let olderId = null, newerId = null;
    if (listMode) {
      const idx = listMode.ids.indexOf(centerEntry.id);
      listMode.index = idx;
      olderId = idx > 0 ? listMode.ids[idx - 1] : null;
      newerId = idx < listMode.ids.length - 1 ? listMode.ids[idx + 1] : null;
    } else {
      try {
        const n = await getNeighborsCached(centerEntry.id);
        olderId = n.older_id; newerId = n.newer_id;
      } catch {}
    }
    const [olderE, newerE] = await Promise.all([
      olderId ? getEntryCached(olderId).catch(() => null) : Promise.resolve(null),
      newerId ? getEntryCached(newerId).catch(() => null) : Promise.resolve(null),
    ]);
    if (_stageId !== centerEntry.id) return;   // superseded by a newer navigation mid-fetch
    _entryCache.set(centerEntry.id, centerEntry);

    paintLang(prefLang);
    // Reuse pooled cards (keeps their decoded images) — only a brand-new
    // neighbor is actually built. Mark exactly one as current (drives panel).
    const oCtl = olderE ? getCard(olderE) : null;
    const cCtl = getCard(centerEntry);
    const nCtl = newerE ? getCard(newerE) : null;
    if (oCtl) oCtl.setCurrent(false);
    if (nCtl) nCtl.setCurrent(false);
    cCtl.setCurrent(true);
    _feedCards = [oCtl, cCtl, nCtl];

    // Slides exist only for REAL entries — no end-pages. At a boundary the
    // feed simply has nothing to scroll to; the "you're at the edge" feedback
    // is a red toast fired from the swipe attempt itself (below).
    const feed = el(`<div class="m-feed"></div>`);
    if (oCtl) feed.appendChild(feedSlideEl(oCtl, "older"));
    feed.appendChild(feedSlideEl(cCtl, "current"));
    if (nCtl) feed.appendChild(feedSlideEl(nCtl, "newer"));
    const centerIdx = oCtl ? 1 : 0;   // which slide is the current entry
    $view.replaceChildren(feed);
    feed.scrollTop = centerIdx * feed.clientHeight;   // land on the current slide, no animation
    // Belt-and-braces re-center once the async image loads (which resize the
    // off-screen slides) have had a moment to settle.
    setTimeout(() => { if (_stageId === centerEntry.id) feed.scrollTop = centerIdx * feed.clientHeight; }, 120);
    _feedSettling = false;

    // ---- page-flip sound: release-with-commit trigger ---------------------
    // The sound fires the instant the flip becomes inevitable, so it starts
    // together with the snap animation — not at settle (too late) and not at
    // drag-start (false-fires on aborted swipes):
    //  - finger lifted with the feed dragged past halfway → play at release;
    //  - fling released early → play the moment momentum crosses halfway;
    //  - while the finger is still down, never play (they may drag back).
    // onSettle keeps a fallback so exotic paths can't produce a silent flip;
    // soundDone guarantees exactly one sound per transition.
    let soundDone = false, fingerDown = false;
    const maybeFlipSound = () => {
      if (soundDone || fingerDown) return;
      const off = feed.scrollTop - centerIdx * feed.clientHeight;
      if ((off > feed.clientHeight * 0.5 && newerE) || (off < -feed.clientHeight * 0.5 && olderE)) {
        soundDone = true; playFlipSound();
      }
    };

    const onSettle = () => {
      if (_feedSettling || _stageId !== centerEntry.id) return;
      const h = feed.clientHeight;
      const idx = Math.round(feed.scrollTop / h);
      if (idx === centerIdx) return;   // still centered — nothing to do
      if (idx < centerIdx && olderE) { _feedSettling = true; if (!soundDone) { soundDone = true; playFlipSound(); } buildFeed(olderE, isHome); }
      else if (idx > centerIdx && newerE) { _feedSettling = true; if (!soundDone) { soundDone = true; playFlipSound(); } buildFeed(newerE, isHome); }
      else { feed.scrollTop = centerIdx * h; }   // defensive — no slide exists that way
    };
    let settleTimer = null;
    feed.addEventListener("scrollend", onSettle);
    // Fallback for WebViews without the 'scrollend' event: settle-by-debounce.
    feed.addEventListener("scroll", () => { maybeFlipSound(); clearTimeout(settleTimer); settleTimer = setTimeout(onSettle, 130); }, { passive: true });

    // Edge-attempt toasts: with no end-pages the feed can't move past a
    // boundary, so detect the ATTEMPT from the gesture — finger direction at
    // an edge with no entry that way. Position follows the direction: pushing
    // past the newest → low on screen; past the first/start → high.
    const atTop = () => feed.scrollTop <= 2;
    const atBottom = () => feed.scrollTop >= feed.scrollHeight - feed.clientHeight - 2;
    const edgeToast = (dir) => {   // dir: "newer" | "older" → true if toast shown
      if (dir === "newer" && !newerE && atBottom()) {
        toast(listMode ? "End of list reached" : "Guru's latest msg reached", { red: true, pos: "down" });
        return true;
      }
      if (dir === "older" && !olderE && atTop()) {
        toast(listMode ? "Start of list reached" : "Guru's first msg reached", { red: true, pos: "up" });
        return true;
      }
      return false;
    };
    let touchY = null, edgeToasted = false;
    feed.addEventListener("touchstart", (ev) => { fingerDown = true; touchY = ev.touches[0].clientY; edgeToasted = false; }, { passive: true });
    feed.addEventListener("touchmove", (ev) => {
      if (touchY === null || edgeToasted) return;
      const dy = ev.touches[0].clientY - touchY;
      if (dy < -26) edgeToasted = edgeToast("newer");        // finger up → wants newer
      else if (dy > 26) edgeToasted = edgeToast("older");    // finger down → wants older
    }, { passive: true });
    feed.addEventListener("touchend", (ev) => {
      if (!ev.touches.length) { fingerDown = false; maybeFlipSound(); }   // release-with-commit
    }, { passive: true });
    feed.addEventListener("touchcancel", () => { fingerDown = false; }, { passive: true });
    let wheelCool = 0;
    feed.addEventListener("wheel", (ev) => {                 // desktop/browser test mode
      const now = Date.now();
      if (now - wheelCool < 900) return;
      if ((ev.deltaY > 0 && edgeToast("newer")) || (ev.deltaY < 0 && edgeToast("older"))) wheelCool = now;
    }, { passive: true });

    // ---- prefetch ±2 (the Phase-1.5 cache) ---------------------------------
    // Warm the NEXT ring (data + images) so a later flip is instant and never
    // lands on an undecoded image. Deferred to IDLE time (regression fix, 8.48):
    // in 8.47 this ran the instant the slide mounted, so full-screen JPEG
    // decodes competed with the snap animation and the flip stuttered. Running
    // it only once the thread is free keeps the flip smooth while still warming
    // the look-ahead well before the user reaches it. Bails if superseded.
    const prefetchRing = async () => {
      if (_stageId !== centerEntry.id) return;
      warmImages(olderE); warmImages(newerE);
      const ring = listMode
        ? [listMode.index - 2, listMode.index + 2].map((i) => listMode.ids[i] || null)
        : await Promise.all([[olderId, "older_id"], [newerId, "newer_id"]].map(async ([nid, key]) => {
            if (!nid) return null;
            try { return (await getNeighborsCached(nid))[key]; } catch { return null; }
          }));
      for (const beyond of ring) {
        if (!beyond || _stageId !== centerEntry.id) continue;
        try { warmImages(await getEntryCached(beyond)); } catch {}
      }
    };
    // Cancel any prefetch still pending from the PREVIOUS flip, then schedule
    // just this one. During rapid flipping each new flip cancels the last, so
    // the decode work only ever runs once — after the user actually pauses —
    // instead of a stack of callbacks force-firing mid-flip (the 4th-flip lag).
    cancelPrefetch();
    if (window.requestIdleCallback) { _prefetchIsIdle = true; _prefetchHandle = requestIdleCallback(() => { _prefetchHandle = null; prefetchRing(); }, { timeout: 2000 }); }
    else { _prefetchIsIdle = false; _prefetchHandle = setTimeout(() => { _prefetchHandle = null; prefetchRing(); }, 600); }
  }

  // ---- generic page frame --------------------------------------------------
  function pageFrame(title, node, extraClass) {
    _feedCards = [];
    setChrome("page", title, null);
    const wrap = el(`<div class="m-page${extraClass ? " " + extraClass : ""}"></div>`);
    wrap.appendChild(node);
    $view.replaceChildren(wrap);
  }

  // ---- Search By (word / date / number) -----------------------------------
  // listCtx (optional): { ids: [...], index: N } — when set, opening this
  // result makes the vertical feed scroll through just THIS list (in the
  // order it's shown), not the whole chronological archive.
  function resultItem(r, hrefFor, listCtx) {
    const prev = (r.preview_hi || r.preview_en || r.body_hi || r.body_en || "").slice(0, 90);
    const href = hrefFor(r.id);
    const it = el(`<a class="m-result" href="${href}">
      ${thumbImg(r)}
      <div class="m-r-meta">
        <div class="m-r-top">#${r.id} · ${fmtDate(r.date)}</div>
        <div class="m-r-topic">${escapeHtml(r.topic_hi || r.topic_en || "")}</div>
        <div class="m-r-prev">${escapeHtml(prev)}</div>
      </div></a>`);
    if (listCtx && href.startsWith("#/entry/")) {
      it.addEventListener("click", () => setActiveList(listCtx.ids, listCtx.index));
    }
    return it;
  }
  // scoped=true: opening any row here confines vertical scrolling to this
  // exact list (Favorites, Word search). Leave false/omitted for contexts
  // where scoping wouldn't make sense (e.g. picking a Guru's msg for chat).
  function showResults(box, rows, emptyMsg, hrefFor, scoped) {
    box.innerHTML = "";
    if (!rows.length) { box.innerHTML = `<div class="empty">${emptyMsg}</div>`; return; }
    const ids = scoped ? rows.map((r) => r.id) : null;
    rows.forEach((r, i) => box.appendChild(resultItem(r, hrefFor, scoped ? { ids, index: i } : null)));
  }

  // Restored when returning from a result's detail page (item 1); cleared the
  // moment the user leaves Search By for anywhere else (see route()'s
  // preserveSearch check), per context (a plain search vs. the community
  // "pick a Guru's msg" picker).
  function freshSearchState() {
    return { tab: "word", word: "", wordResultsHtml: "", numberValue: "" };
  }
  const _searchState = { plain: freshSearchState(), chat: freshSearchState() };
  function resetSearchState() { _searchState.plain = freshSearchState(); _searchState.chat = freshSearchState(); _activeList = null; }

  function searchPage(params) {
    // for=chat → picking a Guru's msg for the community chat: results open the
    // chat on that msg instead of the reader.
    const forChat = !!(params && params.get("for") === "chat");
    const hrefFor = (id) => forChat ? "#/m/community?wid=" + id : "#/entry/" + id;
    const st = forChat ? _searchState.chat : _searchState.plain;

    const node = el(`<div class="m-searchwrap">
      <div class="m-tabs">
        <button data-t="word" class="active">Word</button>
        <button data-t="date">Date</button>
        <button data-t="number">Number</button>
      </div>
      <div class="m-tabbody"></div>
      <div class="m-results"></div>
    </div>`);
    pageFrame(forChat ? "Choose Guru's Msg" : "Search By", node, "m-page-scroll");
    const body = node.querySelector(".m-tabbody");
    const results = node.querySelector(".m-results");

    const tabs = {
      word() {
        body.innerHTML = `<div class="m-inputrow">
          <input type="search" id="m-q" placeholder="Search in English or Hindi…" autocomplete="off"></div>`;
        const q = body.querySelector("#m-q");
        q.value = st.word;
        results.innerHTML = st.wordResultsHtml;   // restore instantly, no re-fetch/flash
        let deb = null, seq = 0;
        const run = async () => {
          const term = q.value.trim();
          st.word = term;
          if (!term) { results.innerHTML = ""; st.wordResultsHtml = ""; return; }
          const mySeq = ++seq;
          try {
            const d = await api("/api/search?q=" + encodeURIComponent(term));
            if (mySeq !== seq) return;   // a newer keystroke's search already ran
            results.innerHTML = `<div class="m-count">${d.count} Guru's msg${d.count === 1 ? "" : "s"} found</div>`;
            const list = el(`<div></div>`); results.appendChild(list);
            showResults(list, d.results, "", hrefFor, !forChat);
            st.wordResultsHtml = results.innerHTML;
          } catch (err) { if (mySeq === seq) { results.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; st.wordResultsHtml = results.innerHTML; } }
        };
        // Live search: results appear as you type.
        q.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(run, 250); });
        q.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); clearTimeout(deb); run(); } });
        if (!st.word) q.focus();
      },
      date() {
        // Android's own calendar has no "jump to month" shortcut (only a year
        // list) — these two dropdowns fill that gap: pick Year then Month,
        // and the NATIVE calendar opens already showing that month, so the
        // actual day is still picked on the real OS picker. Tapping the date
        // field directly (skipping the dropdowns) still works as before.
        body.innerHTML = `
          <div class="m-inputrow m-daterow">
            <select id="m-year"><option value="">Year</option></select>
            <select id="m-month" disabled><option value="">Month</option></select>
          </div>
          <div class="m-inputrow"><input type="date" id="m-d"></div>
          <div class="m-hint">Pick a day to see its Guru's msg.</div>`;
        const yearSel = body.querySelector("#m-year");
        const monthSel = body.querySelector("#m-month");
        const dateInput = body.querySelector("#m-d");

        api("/api/browse?group=year").then((d) => {
          d.periods.forEach((p) => yearSel.appendChild(el(`<option value="${p.period}">${p.period} · ${p.count}</option>`)));
        }).catch(() => {});

        yearSel.addEventListener("change", async () => {
          const year = yearSel.value;
          monthSel.innerHTML = `<option value="">Month</option>`;
          monthSel.disabled = true;
          if (!year) return;
          try {
            const d = await api("/api/browse?group=month");
            d.periods.filter((p) => p.period.startsWith(year + "-")).forEach((p) => {
              monthSel.appendChild(el(`<option value="${p.period}">${periodLabel("month", p.period)} · ${p.count}</option>`));
            });
            monthSel.disabled = false;
          } catch {}
        });

        monthSel.addEventListener("change", () => {
          const ym = monthSel.value; if (!ym) return;
          dateInput.value = ym + "-01";
          // Opens the native calendar pre-set to that month; older WebViews
          // without showPicker() just leave the field ready to tap manually.
          if (dateInput.showPicker) { try { dateInput.showPicker(); } catch {} }
        });

        dateInput.addEventListener("change", async (ev) => {
          const iso = ev.target.value; if (!iso) return;
          results.innerHTML = `<div class="loading">Loading…</div>`;
          try {
            const d = await api("/api/browse?date=" + encodeURIComponent(iso));
            if (d.results.length === 1) { go(hrefFor(d.results[0].id)); return; }
            showResults(results, d.results, "Guru's msg was not shared on this day.", hrefFor, !forChat);
          } catch (err) { results.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; }
        });
      },
      number() {
        body.innerHTML = `<div class="m-inputrow">
          <input type="text" id="m-n" inputmode="numeric" placeholder="Guru's msg number, e.g. 3446">
          <button class="btn primary" id="m-n-go">Open</button></div>`;
        const n = body.querySelector("#m-n");
        n.value = st.numberValue;
        n.addEventListener("input", () => { st.numberValue = n.value; });
        const goN = () => {
          const v = n.value.trim(); if (v) go(hrefFor(encodeURIComponent(v)));
        };
        body.querySelector("#m-n-go").addEventListener("click", goN);
        n.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); goN(); } });
        if (!st.numberValue) n.focus();
      },
    };
    node.querySelector(".m-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      st.tab = b.dataset.t;
      node.querySelectorAll(".m-tabs button").forEach((x) => x.classList.toggle("active", x === b));
      results.innerHTML = "";
      tabs[st.tab]();
    });
    node.querySelectorAll(".m-tabs button").forEach((x) => x.classList.toggle("active", x.dataset.t === st.tab));
    tabs[st.tab]();
  }

  // ---- Community (full page, WhatsApp-style) -------------------------------
  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  function fmtHumanDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1] || ""} ${y}`;
  }
  async function communityPage(params) {
    const pick = params && params.get("wid");
    const wid = pick || _stageId || store.lastViewed();
    const node = el(`<div class="m-community"></div>`);
    pageFrame("Community", node);
    if (!wid) {
      node.innerHTML = `<div class="empty">Open a Guru's msg first, then join its discussion here.</div>`;
      return;
    }
    if (pick) store.setLastViewed(wid);
    _stageId = wid;
    // Header: human date + subject of the msg under discussion; tapping it
    // lets the user pick a different Guru's msg for the chat.
    const head = el(`<button class="m-chat-head" title="Change Guru's msg">
        <div class="m-ch-text"><div class="m-ch-date">Loading…</div><div class="m-ch-topic"></div></div>
        <span class="m-ch-change">Change ▾</span>
      </button>`);
    const body = el(`<div class="m-chatbody"></div>`);
    node.appendChild(head);
    node.appendChild(body);
    head.addEventListener("click", () => go("#/m/search?for=chat"));
    api("/api/entry/" + encodeURIComponent(wid)).then((e) => {
      head.querySelector(".m-ch-date").textContent = fmtHumanDate(e.date) + (e.weekday ? " · " + e.weekday : "");
      head.querySelector(".m-ch-topic").textContent = e.topic_hi || e.topic_en || "";
    }).catch(() => { head.querySelector(".m-ch-date").textContent = "Guru's msg #" + wid; });
    await renderWisdomChat(body, wid);
    // WhatsApp reading order: open at the latest message (bottom).
    const msgs = body.querySelector("#wc-msgs");
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  // ---- Favorites (search-list styling; opens like any Home msg) -----------
  async function favoritesPage() {
    const node = el(`<div class="m-searchwrap"><div class="m-results"></div></div>`);
    pageFrame("Favorites", node, "m-page-scroll");
    const results = node.querySelector(".m-results");
    results.innerHTML = `<div class="loading">Loading…</div>`;
    const ids = store.favs();
    const entries = (await Promise.all(ids.map((id) => api("/api/entry/" + id).catch(() => null)))).filter(Boolean);
    showResults(results, entries, "No favorites yet. Open a Guru's msg and tap ♡ to add it here.", (id) => "#/entry/" + id, true);
  }

  // ---- placeholders (content arrives later) -------------------------------
  function placeholderPage(title, hindi) {
    const node = el(`<div class="m-holder">
      <div class="m-holder-ico">🕉️</div>
      <h2>${escapeHtml(title)}</h2>
      <p class="m-holder-hi">${escapeHtml(hindi)}</p>
      <p>This page is ready — its messages will appear here soon.</p>
    </div>`);
    pageFrame(title, node);
  }

  // ---- Message to Admin ----------------------------------------------------
  async function contactPage() {
    const node = el(`<div class="m-contact"></div>`);
    pageFrame("Message to Admin", node);
    if (!isSignedIn()) {
      node.innerHTML = `<p class="m-hint" style="margin-bottom:14px">Sign in to send a message to the admin.</p>` + modSignInHtml();
      wireModSignIn(node, () => contactPage());
      return;
    }
    node.innerHTML = `
      <div class="m-inputcol">
        <textarea id="m-msg" rows="4" maxlength="2000" placeholder="Write your message to the admin…"></textarea>
        <button class="btn primary" id="m-msg-send">Send</button>
      </div>
      <div class="m-msglist" id="m-msg-mine"><div class="loading">Loading…</div></div>
      <div id="m-msg-mod"></div>`;
    const send = node.querySelector("#m-msg-send");
    send.addEventListener("click", async () => {
      const ta = node.querySelector("#m-msg");
      if (!ta.value.trim()) return;
      send.disabled = true; send.textContent = "Sending…";
      try { await WA.sendAdminMessage(ta.value); ta.value = ""; toast("Message sent 🙏"); loadMine(); }
      catch (err) { toast(err.message); }
      finally { send.disabled = false; send.textContent = "Send"; }
    });
    const mine = node.querySelector("#m-msg-mine");
    async function loadMine() {
      try {
        const d = await WA.myAdminMessages();
        mine.innerHTML = d.messages.length ? `<div class="m-count">Your messages</div>` : "";
        d.messages.forEach((m) => mine.appendChild(el(
          `<div class="m-msgitem"><div class="m-msgtext">${escapeHtml(m.text)}</div><div class="m-msgts">${timeAgo(m.ts)}</div></div>`)));
      } catch (err) { mine.innerHTML = `<div class="m-hint">${escapeHtml(err.message)}</div>`; }
    }
    loadMine();
    if (isModerator()) {
      const box = node.querySelector("#m-msg-mod");
      try {
        const d = await WA.listAdminMessages();
        box.innerHTML = `<div class="m-count">Received messages (${d.messages.length})</div>`;
        d.messages.forEach((m) => box.appendChild(el(
          `<div class="m-msgitem"><div class="m-msgfrom">${escapeHtml(m.user || "?")}</div><div class="m-msgtext">${escapeHtml(m.text)}</div><div class="m-msgts">${timeAgo(m.ts)}</div></div>`)));
      } catch { /* table not set up yet — the sender box already explains */ }
    }
  }

  // ---- Account -------------------------------------------------------------
  function accountPage() {
    const node = el(`<div class="m-contact"></div>`);
    pageFrame("Account", node);
    if (isSignedIn()) {
      const u = currentUser();
      node.innerHTML = `<div class="m-acc-card">
          <span class="m-acc-avatar big">${escapeHtml((u.username || "?")[0].toUpperCase())}</span>
          <div class="m-acc-name">${escapeHtml(u.username)}<small>${escapeHtml(u.role)}</small></div>
        </div>
        <button class="btn" id="m-signout">Sign out</button>`;
      node.querySelector("#m-signout").addEventListener("click", async () => {
        try { await WA.logout(); } catch {}
        store.setToken(""); localStorage.removeItem("wa:user");
        refreshModNav(); toast("Signed out"); accountPage();
      });
      return;
    }
    node.innerHTML = modSignInHtml();
    wireModSignIn(node, () => { refreshModNav(); accountPage(); });
  }

  // ---- router --------------------------------------------------------------
  const PAGE_TITLES = { favorites: "Favorites", browse: "Browse by Date", random: "Your Lucky Msg for Today",
    stats: "Statistics", settings: "Settings", about: "About", help: "Help & Support",
    moderator: "Moderator", admin: "Add Guru's Msg", search: "Search" };

  return {
    active,
    handles(seg) { return !seg.length || seg[0] === "entry" || seg[0] === "m" || seg[0] === "favorites"; },
    async route(seg, params) {
      closeDrawer();
      exitZoom();
      closeChatStream();
      // Leaving the Search By flow for anywhere except a result's detail page
      // (or staying within search itself) clears the remembered query/results.
      const preserveSearch = seg[0] === "entry" || (seg[0] === "m" && seg[1] === "search");
      if (!preserveSearch) resetSearchState();
      if (!seg.length) return viewer(null, params, true);
      if (seg[0] === "entry") return viewer(seg[1], params, false);
      if (seg[0] === "favorites") return favoritesPage();
      const p = seg[1];
      if (p === "search") return searchPage(params);
      if (p === "community") return communityPage(params);
      if (p === "anushthan") return placeholderPage("Anushthan Message", "अनुष्ठान संदेश");
      if (p === "special") return placeholderPage("Special Message", "विशेष संदेश");
      if (p === "contact") return contactPage();
      if (p === "account") return accountPage();
      return viewer(null, params, true);
    },
    fallthrough(seg) {
      closeDrawer();
      exitZoom();
      _feedCards = [];
      setChrome("page", PAGE_TITLES[seg[0]] || "Samarpan Upnishad", null);
    },
    enhanceSettings() {
      // Temporary "Display" card at the BOTTOM of Settings (the settings page
      // will be reorganised later). Two slide switches; off = right side.
      const prose = document.querySelector(".content .prose");
      if (!prose || document.getElementById("m-display-box")) return;
      const box = el(`<div class="sync-box" id="m-display-box">
        <h3 style="margin-top:0">Display</h3>
        <label class="m-switchrow">Zoom bar on left side
          <span class="m-switch"><input type="checkbox" id="m-zb-side"><i></i></span></label>
        <label class="m-switchrow">Flip sound
          <span class="m-switch"><input type="checkbox" id="m-tick-sound"><i></i></span></label>
        <div class="m-hint">Double-tap a Guru's msg image to open zoom. Off = right side (default).</div>
      </div>`);
      prose.appendChild(box);
      const zb = box.querySelector("#m-zb-side"), ts = box.querySelector("#m-tick-sound");
      zb.checked = pref("wa:mobile:zoomBarSide", "right") === "left";
      ts.checked = flipSoundEnabled();
      zb.addEventListener("change", () => setPref("wa:mobile:zoomBarSide", zb.checked ? "left" : "right"));
      ts.addEventListener("change", () => setPref("wa:mobile:tickSound", ts.checked ? "1" : "0"));
    },
  };
})();

window.addEventListener("hashchange", safeRoute);
safeRoute();
