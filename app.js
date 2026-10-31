"use strict";
// ---------------------------------------------------------------- Telegram and storage
const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined
  ? window.Telegram.WebApp : null;
if (tg) { tg.ready(); tg.expand(); }
const params = new URLSearchParams(location.search);
const CHANNEL = ((tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || params.get("c") || "risk_management")
  .replace(/[^a-z_]/g, "");

// The reader's topics live in their own Telegram account (CloudStorage); outside Telegram, in the browser.
const cloud = tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast("6.9") ? tg.CloudStorage : null;
function load(key) {
  return new Promise(resolve => {
    if (cloud) { cloud.getItem(key, (err, value) => resolve(err ? null : value || null)); return; }
    try { resolve(localStorage.getItem(key)); } catch (e) { resolve(null); }
  });
}
function save(key, value) {
  if (cloud) { cloud.setItem(key, value, () => {}); return; }
  try { localStorage.setItem(key, value); } catch (e) { /* private mode: topics last for this visit only */ }
}
function safeUrl(url) { return /^https?:\/\/[^\s<>"']+$/i.test(url || "") ? url : ""; }
function openLink(url) {
  url = safeUrl(url);
  if (!url) return;   // only ordinary web links are ever opened
  if (tg) tg.openLink(url); else window.open(url, "_blank", "noopener");
}

// ---------------------------------------------------------------- search words (same rules as the bot's archive)
const FOLD = {"ə": "e", "Ə": "e", "ı": "i", "I": "i", "İ": "i", "ş": "s", "Ş": "s", "ç": "c", "Ç": "c",
              "ğ": "g", "Ğ": "g", "ö": "o", "Ö": "o", "ü": "u", "Ü": "u"};
const STOP = new Set(("ve ile ucun bu bir da de ki the and of in on for to a an is are what nedir ne hansi nece " +
  "qeder olub olunub edib barede haqqinda kim harada niye son how which when did does do much many who why " +
  "about yeni qarsi uzre bagli new latest against recent gunlerde").split(" "));
const ENDINGS = ["larinin", "lerinin", "larin", "lerin", "lari", "leri", "ndan", "nden", "nin", "nun", "dan", "den",
                 "lar", "ler", "nda", "nde", "in", "un", "da", "de", "ya", "ye", "ni", "nu", "a", "e", "i", "u"];
function fold(text) { return (text || "").replace(/[əƏıIİşŞçÇğĞöÖüÜ]/g, c => FOLD[c]).toLowerCase(); }
function tokens(text) { return fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean); }
function stem(w) {
  if (w.length < 6 || !/^\p{L}+$/u.test(w)) return w;
  for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 4) return w.slice(0, -e.length);
  return w;
}
function terms(query) {
  const out = [];
  for (const w of tokens(query)) {
    if (w.length < 2 || STOP.has(w)) continue;
    const s = stem(w);
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 6);
}
// a word of 4+ letters also matches longer words ("sanksiya" finds "sanksiyalar"); shorter ones must match exactly
function hit(term, toks) { return term.length >= 4 ? toks.some(t => t.startsWith(term)) : toks.includes(term); }
function find(query) {
  const words = terms(query);
  if (!words.length) return {list: [], partial: false};
  const all = STORIES.filter(s => words.every(w => hit(w, s.toks)));
  if (all.length || words.length < 2) return {list: all, partial: false};
  // partial matches: a rare word counts more than a common one ("kapital" over "bank"), as in the bot's search
  const weight = {};
  for (const w of words) {
    const df = STORIES.filter(s => hit(w, s.toks)).length;
    weight[w] = df ? Math.log(1 + STORIES.length / df) : 0;
  }
  const scored = STORIES.map(s => [words.filter(w => hit(w, s.toks)).reduce((sum, w) => sum + weight[w], 0), s])
    .filter(x => x[0] > 0);
  scored.sort((a, b) => b[0] - a[0] || b[1].t - a[1].t);
  return {list: scored.map(x => x[1]), partial: true};
}

// ---------------------------------------------------------------- rendering
let DATA = null, STORIES = [], BY_ID = new Map();
const dayFmt = new Intl.DateTimeFormat("en-GB", {timeZone: "Asia/Baku", day: "2-digit", month: "2-digit"});
const timeFmt = new Intl.DateTimeFormat("en-GB", {timeZone: "Asia/Baku", day: "2-digit", month: "2-digit",
                                                  hour: "2-digit", minute: "2-digit"});
function day(iso) { return dayFmt.format(new Date(iso)).replace("/", "."); }
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function item(s, isNew) {
  const box = el("div", "item");
  const h = el("div", "h");
  if (isNew) h.appendChild(el("span", "new", "YENİ"));
  h.appendChild(document.createTextNode((s.en ? "🇬🇧 " : "") + s.h));
  h.onclick = () => box.classList.toggle("open");
  box.appendChild(h);
  const meta = el("div", "meta", day(s.at) + (s.l ? " · " : ""));
  if (safeUrl(s.u)) {
    const a = el("a", "", (s.l || "mənbə") + " ↗");
    a.href = safeUrl(s.u);
    a.onclick = ev => { ev.preventDefault(); openLink(s.u); };
    meta.appendChild(a);
  }
  box.appendChild(meta);
  if (s.s) box.appendChild(el("div", "s", s.s));
  return box;
}
function list(target, stories, limit, isNew) {
  let shown = 0;
  const more = el("button", "btn more", "Daha çox");
  function next() {
    stories.slice(shown, shown + limit).forEach(s => target.insertBefore(item(s, isNew && isNew(s)), more));
    shown += limit;
    if (shown >= stories.length) more.remove();
  }
  more.onclick = next;
  target.appendChild(more);
  next();
}

function renderToday() {
  const box = document.getElementById("today");
  box.textContent = "";
  const since = Date.parse(DATA.updated) - 24 * 3600 * 1000;
  const brief = DATA.brief.map(id => BY_ID.get(id)).filter(Boolean);
  const briefIds = new Set(DATA.brief);
  const others = STORIES.filter(s => s.t >= since && !briefIds.has(s.id))
    .sort((a, b) => b.sc - a.sc || b.t - a.t);
  if (brief.length) { box.appendChild(el("h2", "", "Səhər brifinqi")); brief.forEach(s => box.appendChild(item(s))); }
  box.appendChild(el("h2", "", "Digər xəbərlər"));
  if (others.length) list(box, others, 30);
  else box.appendChild(el("div", "empty", "Son 24 saatda başqa xəbər yoxdur."));
}

let searchTimer = null;
function renderSearch() {
  const q = document.getElementById("q").value;
  const box = document.getElementById("results");
  box.textContent = "";
  if (!q.trim()) {
    box.appendChild(el("div", "note", "Son " + Math.round((Date.now() - new Date(STORIES.length ?
      STORIES[STORIES.length - 1].at : Date.now()).getTime()) / 86400000) + " günün xəbərlərində axtarış. " +
      "Azərbaycan hərfləri olmadan da yaza bilərsiniz (sigorta = sığorta)."));
    return;
  }
  const res = find(q);
  if (!res.list.length) { box.appendChild(el("div", "empty", "Heç nə tapılmadı. Başqa söz yoxlayın.")); return; }
  if (res.partial) box.appendChild(el("div", "note", "Bütün sözlər birlikdə tapılmadı; ən yaxın nəticələr:"));
  list(box, res.list, 20);
}

// ---------------------------------------------------------------- topic watch
const FOLLOWS_KEY = "follows", SEEN_KEY = "seen_" + CHANNEL;
let FOLLOWS = [], SEEN = null;
function matches(topic) { return find(topic).list; }
function fresh(topic) { return SEEN ? matches(topic).filter(s => s.t > SEEN) : []; }
function updateBadge() {
  const n = new Set(FOLLOWS.flatMap(t => fresh(t).map(s => s.id))).size;
  const badge = document.getElementById("badge");
  badge.textContent = "";
  if (n) badge.appendChild(el("span", "badge", String(n)));
}
function renderWatch(openTopic) {
  const box = document.getElementById("watch");
  box.textContent = "";
  if (openTopic) {
    const back = el("span", "back", "← Mövzular");
    back.onclick = () => renderWatch();
    box.appendChild(back);
    box.appendChild(el("h2", "", openTopic));
    const found = matches(openTopic);
    if (found.length) list(box, found, 20, s => SEEN && s.t > SEEN);
    else box.appendChild(el("div", "empty", "Bu mövzuda hələ xəbər yoxdur."));
    return;
  }
  const row = el("div", "row");
  const input = el("input");
  input.placeholder = "Ad və ya mövzu: Filanbank, sanksiyalar…";
  const add = el("button", "btn", "İzlə");
  add.onclick = () => {
    const t = input.value.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!t || !terms(t).length || FOLLOWS.includes(t) || FOLLOWS.length >= 20) return;
    FOLLOWS.push(t);
    save(FOLLOWS_KEY, JSON.stringify(FOLLOWS));
    renderWatch();
    updateBadge();
  };
  row.appendChild(input); row.appendChild(add);
  box.appendChild(row);
  if (!FOLLOWS.length) {
    box.appendChild(el("div", "note", "İzləmək istədiyiniz adı və ya mövzunu yazın. Hər açılışda bu mövzular üzrə " +
      "yeni xəbərlər burada görünəcək. Siyahı yalnız sizin Telegram hesabınızda saxlanılır."));
    return;
  }
  FOLLOWS.forEach(t => {
    const r = el("div", "topic");
    const name = el("span", "name", t);
    const n = fresh(t).length;
    if (n) { const b = el("span", "badge", String(n)); name.appendChild(b); }
    name.onclick = () => renderWatch(t);
    const x = el("button", "x", "✕");
    x.title = "Sil";
    x.onclick = () => { FOLLOWS = FOLLOWS.filter(f => f !== t); save(FOLLOWS_KEY, JSON.stringify(FOLLOWS));
                        renderWatch(); updateBadge(); };
    r.appendChild(name); r.appendChild(x);
    box.appendChild(r);
  });
}

// ---------------------------------------------------------------- tabs and start
let watchVisited = false;
function show(tab) {
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  ["today", "search", "watch"].forEach(id => document.getElementById(id).classList.toggle("hidden", id !== tab));
  if (tab === "search") { renderSearch(); document.getElementById("q").focus(); }
  if (tab === "watch") { renderWatch(); watchVisited = true; }
}
document.querySelectorAll("nav button").forEach(b => { b.onclick = () => show(b.dataset.tab); });
document.getElementById("q").addEventListener("input", () => {
  clearTimeout(searchTimer); searchTimer = setTimeout(renderSearch, 200);
});
// "new" is measured from the last time the reader looked at their topics; it moves forward only after they have
// opened the İzlə tab, so unread news keeps its count until then
function markSeen() { if (DATA && watchVisited) save(SEEN_KEY, DATA.updated); }
window.addEventListener("pagehide", markSeen);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") markSeen(); });

async function start() {
  try {
    const hour = Math.floor(Date.now() / 3600000);   // a fresh copy every hour
    const r = await fetch("data/" + CHANNEL + ".json?v=" + hour);
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch (e) {
    document.getElementById("today").appendChild(el("div", "empty",
      "Məlumat yüklənmədi. Bir az sonra yenidən açın."));
    return;
  }
  STORIES = DATA.stories;
  STORIES.forEach(s => { s.toks = tokens([s.h, s.s, s.he].join(" ")); s.t = Date.parse(s.at); BY_ID.set(s.id, s); });
  document.getElementById("title").textContent = DATA.name;
  document.getElementById("updated").textContent = "Yenilənib: " + timeFmt.format(new Date(DATA.updated))
    .replace("/", ".").replace(",", "");
  try {   // the reader's own stored list; a damaged value must not break the page
    const stored = JSON.parse((await load(FOLLOWS_KEY)) || "[]");
    FOLLOWS = Array.isArray(stored) ? stored.filter(t => typeof t === "string").slice(0, 20) : [];
  } catch (e) { FOLLOWS = []; }
  const seen = await load(SEEN_KEY);
  if (seen) SEEN = Date.parse(seen);
  else { SEEN = Date.parse(DATA.updated); save(SEEN_KEY, DATA.updated); }   // first visit: nothing is "new" yet
  renderToday();
  updateBadge();
}
start();
