// GMaps Leads v2 - panneau d'extraction dans Google Maps
(() => {
  if (window.__gmlLoaded) return;
  window.__gmlLoaded = true;
  const I18N = window.GML_I18N;

  // ================================================================ config
  const FIELD_IDS = ["name", "phone", "phoneIntl", "whatsapp", "email", "socials", "website", "address", "category", "rating", "reviews", "status", "hours", "score", "plus", "link", "gps", "search"];
  const DEFAULT_FIELDS = { name: 1, phone: 1, phoneIntl: 1, whatsapp: 1, email: 1, socials: 1, website: 1, address: 1, category: 1, rating: 1, reviews: 1, status: 1, hours: 0, score: 1, plus: 0, link: 1, gps: 0, search: 1 };
  const SOCIAL_KEYS = ["facebook", "instagram", "linkedin", "twitter", "tiktok", "youtube", "whatsapp"];
  const SOCIAL_LABEL = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", twitter: "X / Twitter", tiktok: "TikTok", youtube: "YouTube", whatsapp: "WhatsApp (site)" };
  const SPEED = { slow: 1.8, normal: 1, fast: 0.55 };
  const DEFAULT_FILTERS = { minRating: 0, minReviews: 0, website: "any", hideClosed: true, needPhone: false };

  const S = {
    rows: [],
    history: [],
    settings: {
      lang: "auto",
      theme: "auto",
      cc: "",
      scoreProfile: "general",
      autoSite: false,
      sheetsUrl: "",
      fields: { ...DEFAULT_FIELDS },
      filters: { ...DEFAULT_FILTERS },
      mode: "full",
      speed: "normal",
      limit: 200,
      what: "",
      where: "",
      region: "",
      regionMax: 25,
      regionTypes: "town",
      whereMode: "map",
      grid: 0,
      onlyPhone: false,
      onlyEmail: false,
      open: true,
      x: null,
      y: null,
      min: false,
      tab: "search",
      showFilters: false,
      showFields: false,
    },
    running: false,
    siteRun: false,
    pendingSites: 0,
    status: "",
    statusKind: "",
    skipped: 0,
  };
  const keys = new Set();
  let job = null; // {id,label,items,i,grid,added,skipped,active,paused,nav}

  // ================================================================ i18n
  function lang() {
    const l = S.settings.lang;
    if (l && l !== "auto" && I18N[l]) return l;
    const n = (navigator.language || "en").slice(0, 2).toLowerCase();
    return I18N[n] ? n : "en";
  }
  function t(k, v = {}) {
    const d = I18N[lang()] || I18N.en;
    const s = d[k] !== undefined ? d[k] : I18N.en[k] !== undefined ? I18N.en[k] : k;
    return String(s).replace(/\{(\w+)\}/g, (m, x) => (v[x] !== undefined ? v[x] : ""));
  }
  const fmtN = (n) => {
    try {
      return Number(n).toLocaleString(lang() === "ar" ? "en-US" : lang());
    } catch {
      return String(n);
    }
  };

  // ================================================================ helpers
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const F = () => SPEED[S.settings.speed] || 1;
  const pause = (ms) => sleep(ms * F() * (0.85 + Math.random() * 0.3));
  const clean = (s) =>
    (s || "")
      .replace(/[-​-‏‪-‮⁦-⁩]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const num = (s) => {
    const m = String(s || "").replace(/[\s  ]/g, "").match(/\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(",", ".")) : "";
  };
  const intOf = (s) => {
    const d = String(s || "").replace(/[^\d]/g, "");
    return d ? parseInt(d, 10) : "";
  };
  const splitList = (txt) =>
    String(txt || "")
      .split(/[,;\n،]/)
      .map((x) => x.trim())
      .filter(Boolean);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function waitFor(fn, timeout = 8000, step = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        const v = fn();
        if (v) return v;
      } catch {}
      await sleep(step);
    }
    return null;
  }

  function placeKey(href, name, address) {
    const m = String(href || "").match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || String(href || "").match(/[?&]cid=(\d+)/);
    if (m) return m[1].toLowerCase();
    const p = String(href || "").match(/\/maps\/place\/([^/]+)/);
    if (p && address) return (p[1] + "|" + address).toLowerCase();
    return ((name || "") + "|" + (address || "")).toLowerCase();
  }

  function coordsFrom(url) {
    let m = String(url || "").match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return [parseFloat(m[1]), parseFloat(m[2])];
    m = String(url || "").match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : ["", ""];
  }

  function currentSearch() {
    const inp = document.querySelector("input#searchboxinput, input[name='q']");
    if (inp && inp.value) return clean(inp.value);
    const m = location.pathname.match(/\/maps\/search\/([^/]+)/);
    if (m) {
      try {
        return clean(decodeURIComponent(m[1].replace(/\+/g, " ")));
      } catch {}
    }
    return "";
  }

  // ================================================================ phones
  const COUNTRY_CC = [
    [/united states|\busa\b|états-unis|etats-unis|الولايات المتحدة/i, "1"],
    [/canada|كندا/i, "1"],
    [/morocco|maroc|المغرب/i, "212"],
    [/algeria|algérie|algerie|الجزائر/i, "213"],
    [/tunisia|tunisie|تونس/i, "216"],
    [/libya|libye|ليبيا/i, "218"],
    [/egypt|égypte|egypte|مصر/i, "20"],
    [/mauritania|mauritanie|موريتانيا/i, "222"],
    [/senegal|sénégal|السنغال/i, "221"],
    [/côte d.ivoire|cote d.ivoire|ivory coast|ساحل العاج/i, "225"],
    [/saudi arabia|arabie saoudite|السعودية/i, "966"],
    [/united arab emirates|émirats arabes unis|emirats arabes unis|\buae\b|الإمارات/i, "971"],
    [/qatar|قطر/i, "974"],
    [/kuwait|koweït|الكويت/i, "965"],
    [/bahrain|bahreïn|البحرين/i, "973"],
    [/oman|عمان/i, "968"],
    [/jordan|jordanie|الأردن/i, "962"],
    [/lebanon|liban|لبنان/i, "961"],
    [/iraq|irak|العراق/i, "964"],
    [/turkey|türkiye|turquie|تركيا/i, "90"],
    [/united kingdom|royaume-uni|\buk\b|england|scotland|wales|المملكة المتحدة/i, "44"],
    [/ireland|irlande|أيرلندا/i, "353"],
    [/france|فرنسا/i, "33"],
    [/belgium|belgique|بلجيكا/i, "32"],
    [/netherlands|pays-bas|هولندا/i, "31"],
    [/luxembourg|لوكسمبورغ/i, "352"],
    [/switzerland|suisse|سويسرا/i, "41"],
    [/germany|allemagne|deutschland|ألمانيا/i, "49"],
    [/austria|autriche|النمسا/i, "43"],
    [/spain|espagne|españa|إسبانيا/i, "34"],
    [/portugal|البرتغال/i, "351"],
    [/italy|italie|italia|إيطاليا/i, "39"],
    [/sweden|suède|السويد/i, "46"],
    [/norway|norvège|النرويج/i, "47"],
    [/denmark|danemark|الدنمارك/i, "45"],
    [/poland|pologne|بولندا/i, "48"],
    [/australia|australie|أستراليا/i, "61"],
    [/india|inde|الهند/i, "91"],
    [/pakistan|باكستان/i, "92"],
    [/brazil|brésil|البرازيل/i, "55"],
    [/mexico|mexique|المكسيك/i, "52"],
  ];
  const US_STATE_ZIP = /,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?(?:,|$)/;

  function ccFromAddress(addr) {
    const a = String(addr || "");
    const last = a.split(",").slice(-1)[0] || "";
    for (const [re, cc] of COUNTRY_CC) if (re.test(last)) return cc;
    for (const [re, cc] of COUNTRY_CC) if (re.test(a)) return cc;
    if (US_STATE_ZIP.test(a)) return "1";
    return "";
  }

  function intlPhone(raw, tel, address) {
    let src = String(tel || "").trim() || String(raw || "").trim();
    if (!src) return "";
    let d = src.replace(/[^\d+]/g, "");
    if (!d.startsWith("+") && raw && String(raw).trim().startsWith("+")) d = String(raw).replace(/[^\d+]/g, "");
    if (d.startsWith("+")) return "+" + d.slice(1).replace(/\D/g, "");
    if (d.startsWith("00")) return "+" + d.slice(2);
    const cc = String(S.settings.cc || "").replace(/\D/g, "") || ccFromAddress(address);
    if (!cc) return "";
    if (cc === "1") {
      if (d.length === 10) return "+1" + d;
      if (d.length === 11 && d.startsWith("1")) return "+" + d;
      return "";
    }
    if (d.startsWith(cc) && d.length > cc.length + 6) return "+" + d;
    if (d.startsWith("0") && cc !== "39") d = d.slice(1);
    return d.length >= 6 ? "+" + cc + d : "";
  }
  const waLink = (intl) => (intl ? "https://wa.me/" + intl.replace(/\D/g, "") : "");
  const phoneIntlOf = (r) => r.phoneIntl || intlPhone(r.phone, r.tel, r.address);

  // ================================================================ score
  function score(r) {
    if (r.status === "closed") return 0;
    const rv = parseInt(r.reviews, 10) || 0;
    const rt = parseFloat(r.rating) || 0;
    const revPts = Math.min(20, Math.round(Math.log10(rv + 1) * 8));
    const hasSoc = r.socials && Object.values(r.socials).some(Boolean);
    let s = 0;
    if (S.settings.scoreProfile === "web") {
      if (!r.website) s += 35;
      if (r.phone) s += 25;
      s += revPts;
      if (rt >= 4) s += 10;
      else if (rt >= 3) s += 5;
      if (r.status !== "temp") s += 5;
      if (hasSoc || r.email) s += 5;
    } else {
      if (r.phone) s += 25;
      if (r.email) s += 20;
      if (r.website) s += 10;
      if (rt >= 4.5) s += 15;
      else if (rt >= 4) s += 10;
      else if (rt >= 3) s += 5;
      s += revPts;
      if (hasSoc) s += 5;
      if (r.status !== "temp") s += 5;
    }
    if (r.status === "temp") s = Math.round(s * 0.5);
    return Math.max(0, Math.min(100, s));
  }

  // ================================================================ storage
  let saveTimer = null;
  const snapshot = () => ({ gml_rows: S.rows, gml_settings: S.settings, gml_job: job, gml_history: S.history });
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        chrome.storage.local.set(snapshot());
      } catch {}
    }, 400);
  }
  async function saveNow() {
    clearTimeout(saveTimer);
    try {
      await chrome.storage.local.set(snapshot());
    } catch {}
  }
  async function load() {
    try {
      const d = await chrome.storage.local.get(["gml_rows", "gml_settings", "gml_job", "gml_history"]);
      job = d.gml_job && d.gml_job.active ? d.gml_job : null;
      if (Array.isArray(d.gml_rows)) S.rows = d.gml_rows;
      if (Array.isArray(d.gml_history)) S.history = d.gml_history;
      if (d.gml_settings) {
        const g = d.gml_settings;
        S.settings = { ...S.settings, ...g, fields: { ...DEFAULT_FIELDS, ...(g.fields || {}) }, filters: { ...DEFAULT_FILTERS, ...(g.filters || {}) } };
      }
    } catch {}
    S.rows.forEach((r) => {
      keys.add(r.key);
      if (r.emailState && !r.siteState) r.siteState = r.emailState === "done" ? "done" : "";
      if (r.siteState === "pending") r.siteState = "";
      if (!r.sid) r.sid = "legacy";
    });
    if (S.rows.some((r) => r.sid === "legacy") && !S.history.some((h) => h.id === "legacy"))
      S.history.unshift({ id: "legacy", label: t("hist_legacy"), date: Date.now() });
  }

  function newSession(label) {
    const h = { id: uid(), label: label || t("hist_manual"), date: Date.now() };
    S.history.push(h);
    return h.id;
  }

  // ================================================================ DOM Google Maps
  const getFeed = () => document.querySelector('div[role="feed"]');
  const feedLinks = (feed) => [...feed.querySelectorAll('a[href*="/maps/place/"]')];

  function endOfList(feed) {
    if (feed.querySelector(".HlvSq")) return true;
    const tx = (feed.lastElementChild && feed.lastElementChild.innerText) || "";
    return /fin de la liste|end of the list|نهاية القائمة|final de la lista|Ende der Liste/i.test(tx);
  }

  function placePanel() {
    const hs = [...document.querySelectorAll("h1")].filter((h) => clean(h.textContent) && h.closest('[role="main"]'));
    const h = hs.find((x) => x.classList.contains("DUwDvf")) || hs[hs.length - 1];
    return h ? { h1: h, root: h.closest('[role="main"]') } : null;
  }

  function infoText(e) {
    if (!e) return "";
    const inner = e.querySelector(".Io6YTe, .fontBodyMedium");
    let s = clean(inner ? inner.textContent : "");
    if (!s) {
      const al = e.getAttribute("aria-label") || "";
      s = clean(al.includes(":") ? al.slice(al.indexOf(":") + 1) : al);
    }
    if (!s) s = clean(e.textContent);
    return s;
  }

  const RX_CLOSED = /permanently closed|fermé définitivement|définitivement fermé|ferme definitivement|مغلق نهائي|مغلق بشكل دائم|cerrado permanentemente|dauerhaft geschlossen|chiuso definitivamente/i;
  const RX_TEMP = /temporarily closed|fermé temporairement|temporairement fermé|ferme temporairement|مغلق مؤقت|cerrado temporalmente|vorübergehend geschlossen|chiuso temporaneamente/i;
  const RX_DAY = /^(mon|tue|wed|thu|fri|sat|sun|lun|mar|mer|jeu|ven|sam|dim|الاثنين|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت|الأحد|lunes|martes|montag)/i;

  function statusOf(text) {
    if (RX_CLOSED.test(text)) return "closed";
    if (RX_TEMP.test(text)) return "temp";
    return "open";
  }

  function parseHours(root) {
    const rows = [];
    for (const tr of root.querySelectorAll("table tr")) {
      const tds = tr.querySelectorAll("td");
      if (tds.length < 2) continue;
      const d = clean(tds[0].textContent);
      if (!RX_DAY.test(d)) continue;
      const h = clean(tds[1].getAttribute("aria-label") || tds[1].textContent);
      if (h) rows.push(`${d}: ${h}`);
    }
    if (rows.length >= 3) return rows.slice(0, 7).join(" | ");
    const e = [...root.querySelectorAll("[aria-label]")].find((x) => {
      const a = x.getAttribute("aria-label") || "";
      return a.length > 30 && (a.match(/;/g) || []).length >= 3 && RX_DAY.test(clean(a));
    });
    if (e) {
      const a = clean(e.getAttribute("aria-label")).split(/\.\s|\bHide\b|Masquer|إخفاء/)[0];
      return a.split(/;\s*/).map(clean).filter(Boolean).join(" | ");
    }
    return "";
  }

  function baseRow(o) {
    return {
      key: "",
      sid: "",
      name: "",
      phone: "",
      tel: "",
      phoneIntl: "",
      email: "",
      socials: {},
      website: "",
      address: "",
      category: "",
      rating: "",
      reviews: "",
      status: "",
      hours: "",
      plus: "",
      link: "",
      lat: "",
      lng: "",
      search: "",
      siteState: "",
      ts: Date.now(),
      ...o,
    };
  }

  function parsePlace(root, fb = {}) {
    const q = (s) => root.querySelector(s);
    const name = clean(q("h1") && q("h1").textContent) || fb.name || "";
    const category = clean((q('button[jsaction*="category"]') || q("button.DkEaL") || {}).textContent);
    const address = infoText(q('button[data-item-id="address"]'));

    const phoneEl = q('button[data-item-id^="phone:tel:"], a[data-item-id^="phone:tel:"], [data-item-id^="phone:"]');
    let phone = infoText(phoneEl);
    const tel = phoneEl ? (phoneEl.getAttribute("data-item-id") || "").replace(/^phone:(tel:)?/, "") : "";
    if (phoneEl && !/\d{4,}/.test(phone.replace(/\D/g, ""))) phone = tel;

    const webEl = q('a[data-item-id="authority"]') || q('a[aria-label^="Site Web"], a[aria-label^="Website"], a[aria-label^="الموقع"]');
    let website = webEl ? webEl.href || "" : "";
    if (website.includes("google.") && website.includes("/url?")) {
      try {
        website = new URL(website).searchParams.get("q") || website;
      } catch {}
    }
    const plus = infoText(q('button[data-item-id="oloc"]'));

    let rating = "";
    let reviews = "";
    const f7 = q("div.F7nice");
    if (f7) {
      const spans = f7.querySelectorAll('span[aria-hidden="true"]');
      if (spans[0]) rating = num(spans[0].textContent);
      const rv = [...f7.querySelectorAll("span[aria-label]")].find((s) => /\d/.test(s.getAttribute("aria-label")) && !/étoile|star|نجم/i.test(s.getAttribute("aria-label")));
      if (rv) reviews = intOf(rv.getAttribute("aria-label"));
      if (!reviews) {
        const m = f7.textContent.match(/\(([\d\s.,  ]+)\)/);
        if (m) reviews = intOf(m[1]);
      }
    }
    if (!rating) {
      const img = [...root.querySelectorAll('[role="img"][aria-label]')].find((e) => /étoile|star|نجم|estrella|Stern/i.test(e.getAttribute("aria-label")));
      if (img) rating = num(img.getAttribute("aria-label"));
    }
    const head = (root.innerText || "").slice(0, 2500);
    const status = statusOf(head);
    const hours = parseHours(root);
    const cur = coordsFrom(location.href);
    const [lat, lng] = cur.some((v) => v !== "") ? cur : coordsFrom(fb.link);
    const link = fb.link || location.href;
    const r = baseRow({ key: placeKey(link, name, address), name, phone, tel, website, address, category, rating, reviews, status, hours, plus, link, lat, lng, search: fb.search || currentSearch() });
    r.phoneIntl = intlPhone(phone, tel, address);
    return r;
  }

  function parseCard(a, search) {
    const card = a.closest('[role="article"]') || a.parentElement;
    const name = clean(a.getAttribute("aria-label")) || clean((card.querySelector(".qBF1Pd") || {}).textContent);
    const text = card.innerText || "";
    const lines = text.split("\n").map(clean).filter((l) => l && l !== name);
    const rating = num((card.querySelector(".MW4etd") || {}).textContent);
    const reviews = intOf((card.querySelector(".UY7F9") || {}).textContent);
    let phone = clean((card.querySelector(".UsdlK") || {}).textContent);
    if (!phone) {
      const m = text.match(/(?:\+|00)?\d[\d\s().-]{7,}\d/);
      if (m && m[0].replace(/\D/g, "").length >= 8) phone = clean(m[0]);
    }
    const web = card.querySelector('a[data-value="Website"], a[data-value="Site Web"], a.lcr4fd, a[aria-label*="site" i][href^="http"]:not([href*="google."])');
    let category = "";
    let address = "";
    for (const l of lines) {
      if (/^\d[.,]\d/.test(l) || /^\(\d/.test(l)) continue;
      const parts = l.split("·").map(clean).filter(Boolean);
      if (parts.length && !category && !/ouvert|fermé|open|closed|مفتوح|مغلق/i.test(parts[0])) {
        category = parts[0];
        address = parts.slice(1).filter((p) => !/^[$€£]+$/.test(p) && p !== phone).join(" · ");
        break;
      }
    }
    const [lat, lng] = coordsFrom(a.href);
    const r = baseRow({ key: placeKey(a.href, name, address), name, phone, website: web ? web.href : "", address, category, rating, reviews, status: statusOf(text), link: a.href, lat, lng, search });
    r.phoneIntl = intlPhone(phone, "", address);
    return r;
  }

  // ================================================================ filters
  function failsFilter(r, partial) {
    const f = S.settings.filters;
    if (f.minRating > 0 && r.rating !== "" && r.rating < f.minRating) return true;
    if (f.minRating > 0 && r.rating === "" && !partial) return true;
    if (f.minReviews > 0 && (parseInt(r.reviews, 10) || 0) < f.minReviews && (!partial || r.reviews !== "")) return true;
    if (f.hideClosed && (r.status === "closed" || r.status === "temp")) return true;
    if (partial) return false;
    if (f.website === "with" && !r.website) return true;
    if (f.website === "without" && r.website) return true;
    if (f.needPhone && !r.phone) return true;
    return false;
  }

  // ================================================================ sites (emails + reseaux sociaux)
  const siteQueue = [];
  let siteActive = 0;
  const siteTodo = () => S.rows.filter((r) => r.website && r.siteState !== "done" && r.siteState !== "pending");

  function startSites() {
    if (S.siteRun) return;
    const todo = siteTodo();
    if (!todo.length) return setStatus(t("st_sites_none"));
    S.siteRun = true;
    todo.forEach((r) => siteQueue.push(r));
    S.pendingSites = siteQueue.length;
    setStatus(t("st_sites_start", { n: fmtN(todo.length) }));
    pumpSites();
  }
  function stopSites() {
    S.siteRun = false;
    siteQueue.length = 0;
    S.pendingSites = siteActive;
    setStatus(t("st_sites_stop"));
  }
  function pumpSites() {
    while (S.siteRun && siteActive < 4 && siteQueue.length) {
      const row = siteQueue.shift();
      if (!row.website || row.siteState === "done") continue;
      siteActive++;
      row.siteState = "pending";
      const finish = (res) => {
        siteActive--;
        if (res) {
          row.email = (res.emails || []).join(", ");
          row.socials = { ...(row.socials || {}), ...(res.socials || {}) };
          row.siteState = "done";
        } else if (row.siteState === "pending") row.siteState = "";
        S.pendingSites = siteQueue.length + siteActive;
        if (S.siteRun && !siteQueue.length && !siteActive) {
          S.siteRun = false;
          setStatus(t("st_sites_done", { e: fmtN(S.rows.filter((r) => r.email).length), s: fmtN(S.rows.filter((r) => r.socials && Object.values(r.socials).some(Boolean)).length) }), "ok");
        }
        save();
        render();
        pumpSites();
      };
      try {
        chrome.runtime.sendMessage({ type: "gml-site", url: row.website }, (resp) => {
          void chrome.runtime.lastError;
          finish(resp || { emails: [], socials: {} });
        });
      } catch {
        finish(null);
      }
    }
    render();
  }

  function addRow(row, sid) {
    if (!row.name || keys.has(row.key)) return false;
    keys.add(row.key);
    row.sid = sid || row.sid || "manual";
    S.rows.push(row);
    save();
    render();
    return true;
  }

  // ================================================================ extraction
  async function openAndParse(a, search) {
    const href = a.href;
    const idm = href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    const name = clean(a.getAttribute("aria-label"));
    const before = placePanel();
    const beforeH1 = before ? before.h1 : null;
    a.scrollIntoView({ block: "center" });
    a.click();
    await waitFor(() => {
      const p = placePanel();
      if (!p) return false;
      const urlOk = idm ? decodeURIComponent(location.href).toLowerCase().includes(idm[1].toLowerCase()) : true;
      const nameOk = !name || clean(p.h1.textContent) === name;
      return urlOk && (nameOk || p.h1 !== beforeH1);
    }, 9000);
    const p = await waitFor(() => {
      const pp = placePanel();
      if (!pp) return null;
      return pp.root.querySelector('button[data-item-id="address"], [data-item-id^="phone:"], a[data-item-id="authority"], button[data-item-id="oloc"]') ? pp : null;
    }, 3000);
    await pause(beforeH1 && clean(beforeH1.textContent) === name ? 900 : 400);
    const pp = p || placePanel();
    if (!pp) return parseCard(a, search);
    const row = parsePlace(pp.root, { name, link: href, search });
    if (!row.name) row.name = name;
    return row;
  }

  let prefix = "";
  const status = (s, kind) => setStatus(prefix + s, kind);

  async function run() {
    if (S.running || (job && !job.paused)) return;
    if (!getFeed()) {
      if (placePanel()) return addCurrent();
      return setStatus(t("st_no_list"), "warn");
    }
    prefix = "";
    const sid = newSession(currentSearch() || t("hist_manual"));
    const r = await extract(currentSearch(), sid);
    setStatus(t(S.running === false && r.stopped ? "st_stopped" : "st_done_one", { n: fmtN(r.added), k: fmtN(r.skipped) }), "ok");
  }

  async function extract(search, sid) {
    S.running = true;
    const limit = Math.max(1, parseInt(S.settings.limit, 10) || 200);
    let added = 0;
    let skipped = 0;
    let idle = 0;
    let stopped = false;
    const seen = new Set();
    render();
    status(t("st_working", { n: 0 }));
    try {
      while (added < limit) {
        if (!S.running) {
          stopped = true;
          break;
        }
        const feed = getFeed();
        if (!feed) break;
        const links = feedLinks(feed).filter((a) => !seen.has(a.href));
        if (links.length) {
          idle = 0;
          for (const a of links) {
            if (!S.running) {
              stopped = true;
              break;
            }
            if (added >= limit) break;
            seen.add(a.href);
            const quick = placeKey(a.href, clean(a.getAttribute("aria-label")), "");
            if (/^0x/.test(quick) && keys.has(quick)) continue;
            // pre-filtre sur la carte de la liste (evite d'ouvrir les fiches inutiles)
            const pre = parseCard(a, search);
            if (failsFilter(pre, true)) {
              skipped++;
              S.skipped++;
              continue;
            }
            const row = S.settings.mode === "fast" ? pre : await openAndParse(a, search);
            if (!S.running) {
              stopped = true;
              break;
            }
            if (failsFilter(row, S.settings.mode === "fast")) {
              skipped++;
              S.skipped++;
              keys.add(row.key);
              continue;
            }
            if (addRow(row, sid)) {
              added++;
              status(t("st_working", { n: fmtN(added) }) + (skipped ? " · " + t("st_skipped", { k: fmtN(skipped) }) : ""));
            }
          }
          continue;
        }
        if (endOfList(feed)) break;
        feed.scrollTop = feed.scrollHeight;
        feed.dispatchEvent(new Event("scroll"));
        await pause(1600);
        if (++idle > 8) break;
      }
    } finally {
      S.running = false;
      save();
      render();
    }
    return { added, skipped, stopped };
  }

  function addCurrent() {
    const p = placePanel();
    if (!p) return setStatus(t("st_open_place"), "warn");
    let h = S.history.find((x) => x.id === "manual");
    if (!h) S.history.push({ id: "manual", label: t("hist_manual"), date: Date.now() });
    const row = parsePlace(p.root, { link: location.href, search: currentSearch() });
    if (addRow(row, "manual")) setStatus(t("st_added_one", { name: row.name }), "ok");
    else setStatus(t("st_exists"), "warn");
  }

  // ================================================================ recherche automatique
  const encQ = (q) => encodeURIComponent(q).replace(/%20/g, "+");
  const searchUrl = (it) => `${location.origin}/maps/search/${encQ(it.q)}` + (it.at ? `/@${it.at}` : "");

  function mapView() {
    let href = location.href;
    try {
      href = decodeURIComponent(href);
    } catch {}
    const m = href.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)([zm])/);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    let z = parseFloat(m[3]);
    if (m[4] === "m") z = Math.log2((156543.03 * Math.cos((lat * Math.PI) / 180) * window.innerHeight) / Math.max(1, z));
    z = Math.min(21, Math.max(2, Math.round(z * 10) / 10));
    return { lat, lng, z, at: `${lat.toFixed(6)},${lng.toFixed(6)},${z}z` };
  }

  function gridCells(n, it) {
    const v = it.view || mapView();
    if (!v) return [];
    const { lat, lng, z } = v;
    const degPerPx = 360 / (256 * Math.pow(2, z));
    const spanLng = window.innerWidth * degPerPx;
    const spanLat = window.innerHeight * degPerPx * Math.cos((lat * Math.PI) / 180);
    const subZ = Math.min(18, Math.max(3, Math.round(z + Math.log2(n))));
    const cells = [];
    let k = 0;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) {
        k++;
        const clat = lat + spanLat * (0.5 - (r + 0.5) / n);
        const clng = lng + spanLng * ((c + 0.5) / n - 0.5);
        cells.push({ q: it.act, act: it.act, zone: it.zone, kind: "cell", at: `${clat.toFixed(6)},${clng.toFixed(6)},${subZ}z`, label: `${it.label} [${k}/${n * n}]` });
      }
    return cells;
  }

  function fetchCities(region) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "gml-cities", region, types: S.settings.regionTypes }, (r) => {
          void chrome.runtime.lastError;
          resolve(r || { ok: false });
        });
      } catch {
        resolve({ ok: false });
      }
    });
  }

  let citiesBusy = false;
  async function loadCities(intoText) {
    const region = clean(S.settings.region);
    if (!region) return setStatus(t("st_region_empty"), "warn"), null;
    citiesBusy = true;
    setStatus(t("st_cities_loading", { r: region }));
    const r = await fetchCities(region);
    citiesBusy = false;
    if (!r.ok || !r.cities || !r.cities.length) {
      setStatus(t("st_cities_fail", { r: region }), "warn");
      return null;
    }
    const max = parseInt(S.settings.regionMax, 10) || 0;
    const list = max > 0 ? r.cities.slice(0, max) : r.cities;
    if (intoText) {
      S.settings.where = list.map((c) => `${c.name}, ${region}`).join("; ");
      S.settings.whereMode = "text";
      save();
    }
    setStatus(t("st_cities_ok", { n: fmtN(list.length), all: fmtN(r.cities.length), r: region, ex: list.slice(0, 5).map((c) => c.name).join(", ") }), "ok");
    return list;
  }

  async function startSearch() {
    if (S.running || job || citiesBusy) return;
    const st = S.settings;
    const acts = splitList(st.what);
    if (!acts.length) return setStatus(t("st_what_empty"), "warn");
    const items = [];
    let label = "";
    if (st.whereMode === "map") {
      const v = mapView();
      if (!v) return setStatus(t("st_map_unknown"), "warn");
      label = `${acts.join(", ")} — ${t("where_map_short")} (${v.lat.toFixed(3)}, ${v.lng.toFixed(3)})`;
      for (const a of acts) items.push({ q: a, act: a, zone: `${v.lat.toFixed(3)},${v.lng.toFixed(3)}`, kind: "main", at: v.at, view: v, label: `${a} (${t("where_map_short")})` });
    } else if (st.whereMode === "region") {
      const cities = await loadCities(false);
      if (!cities) return;
      const region = clean(st.region);
      label = `${acts.join(", ")} — ${region} (${fmtN(cities.length)})`;
      for (const a of acts)
        for (const c of cities) items.push({ q: `${a} ${c.name}, ${region}`, act: a, zone: c.name, kind: "main", at: `${c.lat.toFixed(6)},${c.lng.toFixed(6)},13z`, label: `${a} — ${c.name}` });
    } else {
      const zones = (/[;\n]/.test(st.where) ? st.where.split(/[;\n]/) : st.where.split(/[,\u060C]/)).map((x) => x.trim()).filter(Boolean);
      if (!zones.length) return setStatus(t("st_where_empty"), "warn");
      label = `${acts.join(", ")} — ${zones.length > 3 ? zones.slice(0, 3).join(" · ") + " …" : zones.join(" · ")}`;
      for (const a of acts) for (const z of zones) items.push({ q: `${a} ${z}`, act: a, zone: z, kind: "main", label: `${a} — ${z}` });
    }
    const sid = newSession(label);
    job = { id: sid, label, items, i: 0, grid: parseInt(st.grid, 10) || 0, added: 0, skipped: 0, active: true, paused: false, nav: 0 };
    S.skipped = 0;
    await gotoItem();
  }

  async function gotoItem() {
    const it = job.items[job.i];
    it.tries = (it.tries || 0) + 1;
    job.nav = Date.now();
    job.paused = false;
    setStatus(t("st_job_goto", { i: fmtN(job.i + 1), n: fmtN(job.items.length), l: it.label }));
    await saveNow();
    location.assign(searchUrl(it));
  }

  async function finishJob() {
    const done = job;
    job = null;
    prefix = "";
    await saveNow();
    setStatus(t("st_job_done", { n: fmtN(done.items.length), a: fmtN(done.added), k: fmtN(done.skipped || 0) }), "ok");
    if (S.settings.autoSite && siteTodo().length) startSites();
  }

  async function pauseJob() {
    S.running = false;
    if (job) {
      job.paused = true;
      await saveNow();
      setStatus(t("st_job_paused", { i: fmtN(job.i + 1), n: fmtN(job.items.length), a: fmtN(job.added) }), "warn");
    } else setStatus(t("st_stopping"));
    render();
  }

  async function cancelJob() {
    S.running = false;
    job = null;
    prefix = "";
    await saveNow();
    setStatus(t("st_job_cancel"));
  }

  async function continueJob() {
    if (!job) return;
    job.paused = false;
    await gotoItem();
  }

  async function resumeJob() {
    const it = job && job.items[job.i];
    if (!it) return finishJob();
    if (!/\/maps\/(search|place)\//.test(location.pathname)) {
      if ((it.tries || 0) < 2) return gotoItem();
      job.i++;
      return job.i >= job.items.length ? finishJob() : gotoItem();
    }
    prefix = t("st_job_prefix", { i: fmtN(job.i + 1), n: fmtN(job.items.length), l: it.label });
    status(t("st_waiting"));
    render();
    await waitFor(() => (getFeed() && feedLinks(getFeed()).length) || placePanel() || /no results|aucun résultat|لا توجد نتائج|لم يتم العثور/i.test(document.body.innerText.slice(0, 4000)), 20000 * F(), 300);
    await pause(900);
    if (!job || job.paused) return;
    const cells = job.grid > 1 && it.kind === "main" && getFeed() ? gridCells(job.grid, it) : [];
    let res = { added: 0, skipped: 0, stopped: false };
    if (getFeed()) res = await extract(it.label, job.id);
    else if (placePanel()) {
      const row = parsePlace(placePanel().root, { link: location.href, search: it.label });
      if (!failsFilter(row, false) && addRow(row, job.id)) res.added = 1;
    }
    if (!job || job.paused || res.stopped) return;
    job.added += res.added;
    job.skipped = (job.skipped || 0) + res.skipped;
    if (cells.length) job.items.splice(job.i + 1, 0, ...cells);
    job.i++;
    if (job.i >= job.items.length) return finishJob();
    await pause(1200);
    if (!job || job.paused) return;
    await gotoItem();
  }

  // ================================================================ export
  function exportCols() {
    const f = S.settings.fields;
    const cols = [];
    const add = (id, w, get, extra = {}) => cols.push({ col: t("col_" + id), w, get, ...extra });
    for (const id of FIELD_IDS) {
      if (!f[id]) continue;
      if (id === "gps") {
        add("lat", 11, (r) => r.lat);
        add("lng", 11, (r) => r.lng);
      } else if (id === "socials") {
        for (const k of SOCIAL_KEYS) cols.push({ col: SOCIAL_LABEL[k], w: 30, get: (r) => (r.socials && r.socials[k]) || "", link: true });
      } else if (id === "phoneIntl") add(id, 17, phoneIntlOf);
      else if (id === "whatsapp") add(id, 28, (r) => waLink(phoneIntlOf(r)), { link: true });
      else if (id === "status") add(id, 14, (r) => (r.status ? t("status_" + r.status) : ""));
      else if (id === "score") add(id, 8, (r) => score(r));
      else if (id === "search") add(id, 26, (r) => r.search || "");
      else if (id === "website" || id === "link") add(id, 32, (r) => r[id] || "", { link: true });
      else if (id === "name") add(id, 32, (r) => r.name);
      else if (id === "address") add(id, 42, (r) => r.address);
      else if (id === "hours") add(id, 50, (r) => r.hours);
      else add(id, { phone: 18, email: 32, category: 22, rating: 7, reviews: 9, plus: 16 }[id] || 16, (r) => r[id]);
    }
    return cols;
  }

  function exportSet() {
    return S.rows.filter((r) => (!S.settings.onlyPhone || r.phone) && (!S.settings.onlyEmail || r.email));
  }

  function fileBase(label) {
    const s = (label || currentSearch() || "google-maps")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w؀-ۿ]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `leads_${s || "maps"}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
  }

  function download(bytes, filename, mime) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function exportXlsx(rows, label) {
    if (!rows.length) return setStatus(t("st_nothing"), "warn");
    const cols = exportCols();
    const data = [cols.map((c) => c.col)];
    for (const r of rows)
      data.push(
        cols.map((c) => {
          const v = c.get(r);
          if (v === "" || v === null || v === undefined) return "";
          if (c.link && /^https?:/i.test(v)) return { v, link: v };
          if (c.col === t("col_rating") && typeof v === "number") return { v, style: 4 };
          return v;
        })
      );
    const cnt = (fn) => rows.filter(fn).length;
    const resume = [
      [{ v: t("sum_search"), style: 3 }, label || [...new Set(rows.map((r) => r.search).filter(Boolean))].slice(0, 20).join(" | ")],
      [{ v: t("sum_date"), style: 3 }, new Date().toLocaleString(lang())],
      [{ v: t("sum_places"), style: 3 }, rows.length],
      [{ v: t("sum_phone"), style: 3 }, cnt((r) => r.phone)],
      [{ v: t("sum_web"), style: 3 }, cnt((r) => r.website)],
      [{ v: t("sum_noweb"), style: 3 }, cnt((r) => !r.website)],
      [{ v: t("sum_email"), style: 3 }, cnt((r) => r.email)],
      [{ v: t("sum_social"), style: 3 }, cnt((r) => r.socials && Object.values(r.socials).some(Boolean))],
      [{ v: t("sum_score"), style: 3 }, rows.length ? Math.round(rows.reduce((s, r) => s + score(r), 0) / rows.length) : 0],
    ];
    const bytes = window.GMLXlsx.build([
      { name: "Leads", rows: data, widths: cols.map((c) => c.w), header: true, freeze: true, autofilter: true },
      { name: t("sum_sheet").slice(0, 30), rows: resume, widths: [26, 60] },
    ]);
    download(bytes, fileBase(label) + ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    setStatus(t("st_exported", { n: fmtN(rows.length), f: "Excel" }), "ok");
  }

  function tableText(rows, sep) {
    const cols = exportCols();
    const q = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      if (sep === "\t") return s.replace(/[\t\r\n]+/g, " ");
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.map((c) => q(c.col)).join(sep)];
    rows.forEach((r) => lines.push(cols.map((c) => q(c.get(r))).join(sep)));
    return lines.join("\r\n");
  }

  function exportCsv(rows, label) {
    if (!rows.length) return setStatus(t("st_nothing"), "warn");
    download("﻿" + tableText(rows, ";"), fileBase(label) + ".csv", "text/csv;charset=utf-8");
    setStatus(t("st_exported", { n: fmtN(rows.length), f: "CSV" }), "ok");
  }

  async function writeClip(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    }
  }

  async function copyList(list, what) {
    if (!list.length) return setStatus(t("st_copy_none"), "warn");
    await writeClip(list.join("\n"));
    setStatus(t("st_copied", { n: fmtN(list.length), w: t(what) }), "ok");
  }
  const phonesOf = (rows) => [...new Set(rows.map((r) => phoneIntlOf(r) || r.phone).filter(Boolean))];
  const emailsOf = (rows) => [...new Set(rows.flatMap((r) => (r.email ? r.email.split(/,\s*/) : [])))];

  async function toSheets(rows, label) {
    if (!rows.length) return setStatus(t("st_nothing"), "warn");
    const url = clean(S.settings.sheetsUrl);
    if (url) {
      const cols = exportCols();
      setStatus(t("st_sheets_sending", { n: fmtN(rows.length) }));
      const payload = { sheet: (label || "Leads").slice(0, 90), headers: cols.map((c) => c.col), rows: rows.map((r) => cols.map((c) => { const v = c.get(r); return v === undefined || v === null ? "" : v; })) };
      chrome.runtime.sendMessage({ type: "gml-sheets", url, payload }, (resp) => {
        void chrome.runtime.lastError;
        if (resp && resp.ok) setStatus(t("st_sheets_ok", { n: fmtN(rows.length) }), "ok");
        else setStatus(t("st_sheets_fail", { e: (resp && (resp.error || resp.status)) || "?" }), "warn");
      });
      return;
    }
    await writeClip(tableText(rows, "\t"));
    chrome.runtime.sendMessage({ type: "gml-open", url: "https://sheets.new" }, () => void chrome.runtime.lastError);
    setStatus(t("st_sheets_paste", { n: fmtN(rows.length) }), "ok");
  }

  const APPS_SCRIPT = `function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = String(d.sheet || 'Leads').replace(/[\\[\\]\\*\\?\\/\\\\:]/g, ' ').slice(0, 90);
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(d.headers);
  if (d.rows.length) sh.getRange(sh.getLastRow() + 1, 1, d.rows.length, d.headers.length).setValues(d.rows);
  return ContentService.createTextOutput(JSON.stringify({ ok: true, added: d.rows.length }));
}`;

  // ================================================================ UI
  let host, $;
  function setStatus(s, kind) {
    S.status = s;
    S.statusKind = kind || "";
    render();
  }

  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:"Segoe UI",Roboto,Tahoma,Arial,sans-serif}
  .theme{--bg:#fff;--bg2:#f8f9fa;--bg3:#f1f3f4;--fg:#1f1f1f;--mut:#5f6368;--bd:#dadce0;--line:#eceff1;--acc:#1a73e8;--accbg:#e8f0fe;--ok:#137333;--okbg:#e6f4ea;--warn:#b06000;--warnbg:#fef7e0;--red:#d93025;--green:#188038;--shadow:0 8px 30px rgba(0,0,0,.25)}
  .theme.dark{--bg:#202124;--bg2:#2a2b2e;--bg3:#35363a;--fg:#e8eaed;--mut:#9aa0a6;--bd:#4a4c50;--line:#36373a;--acc:#8ab4f8;--accbg:#283a55;--ok:#81c995;--okbg:#1e3a2a;--warn:#fdd663;--warnbg:#3c3420;--red:#f28b82;--green:#5bb974;--shadow:0 8px 30px rgba(0,0,0,.6)}
  .panel{position:fixed;z-index:2147483000;width:360px;max-height:calc(100vh - 80px);display:flex;flex-direction:column;background:var(--bg);color:var(--fg);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;font-size:13px}
  .hd{display:flex;align-items:center;gap:8px;padding:9px 12px;background:#1a73e8;color:#fff;cursor:move;user-select:none}
  .hd b{font-size:14px;flex:1}
  .badge{background:#fff;color:#1a73e8;border-radius:999px;padding:1px 9px;font-weight:700;font-size:12px}
  .ib{background:transparent;border:0;color:#fff;font-size:15px;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1}
  .ib:hover{background:rgba(255,255,255,.18)}
  .tabs{display:flex;border-bottom:1px solid var(--line);background:var(--bg)}
  .tabs button{flex:1;border:0;background:transparent;color:var(--mut);padding:8px 4px;font-size:12.5px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent}
  .tabs button.on{color:var(--acc);border-bottom-color:var(--acc)}
  .bd{padding:10px 12px;overflow:auto}
  h4{margin:10px 0 6px;font-size:12px;color:var(--mut);font-weight:600}
  h4:first-child{margin-top:2px}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px 6px}
  label{display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12.5px;white-space:nowrap;color:var(--fg)}
  input[type=checkbox],input[type=radio]{accent-color:var(--acc);margin:0}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .seg{display:flex;border:1px solid var(--bd);border-radius:8px;overflow:hidden}
  .seg label{padding:6px 8px;gap:4px;justify-content:center;flex:1}
  .seg label:has(input:checked){background:var(--accbg);color:var(--acc);font-weight:600}
  .seg input{display:none}
  .seg.wide{width:100%;margin-bottom:6px}
  input[type=number],input[type=text],select,textarea{padding:5px 7px;border:1px solid var(--bd);border-radius:7px;font-size:12.5px;background:var(--bg);color:var(--fg);outline:none}
  input[type=number]{width:72px;direction:ltr}
  input:focus,select:focus,textarea:focus{border-color:var(--acc)}
  .tx{width:100%;padding:7px 9px;font-size:13px;margin-bottom:6px;direction:auto}
  textarea.tx{min-height:54px;resize:vertical;font-family:inherit}
  .btn{border:0;border-radius:8px;padding:8px 10px;font-size:13px;font-weight:600;cursor:pointer;background:var(--bg3);color:var(--fg)}
  .btn:hover{filter:brightness(.95)}
  .btn:disabled{opacity:.5;cursor:default}
  .btn.go{background:#1a73e8;color:#fff}
  .btn.stop{background:#d93025;color:#fff}
  .btn.xl{background:#188038;color:#fff}
  .btn.sheet{background:#0f9d58;color:#fff}
  .btn.sec2{background:var(--accbg);color:var(--acc)}
  .btn.mail{background:var(--warnbg);color:var(--warn)}
  .btn.sm{padding:5px 8px;font-size:12px}
  .btn.full{width:100%;margin-top:6px}
  .btns{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
  .btns3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px}
  .status{margin-top:8px;padding:7px 9px;background:var(--bg2);border-radius:8px;color:var(--fg);min-height:30px;font-size:12.5px;line-height:1.45}
  .status.ok{background:var(--okbg);color:var(--ok)}
  .status.warn{background:var(--warnbg);color:var(--warn)}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px}
  .stat{background:var(--bg2);border-radius:8px;padding:6px 2px;text-align:center}
  .stat b{display:block;font-size:15px;color:var(--acc)}
  .stat span{font-size:10.5px;color:var(--mut)}
  .list{margin-top:8px;border:1px solid var(--line);border-radius:8px;max-height:130px;overflow:auto}
  .it{padding:5px 8px;border-bottom:1px solid var(--line);font-size:12px;display:flex;justify-content:space-between;gap:6px}
  .it:last-child{border-bottom:0}
  .it .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:auto}
  .it .p{color:var(--mut);direction:ltr;white-space:nowrap}
  .muted{color:var(--mut);font-size:11.5px;line-height:1.4}
  .mapinfo{background:var(--okbg);color:var(--ok);border-radius:8px;padding:7px 9px;font-size:12px;line-height:1.5;margin-bottom:6px}
  .banner{background:var(--warnbg);color:var(--warn);border-radius:8px;padding:8px 9px;margin-bottom:8px;font-size:12.5px}
  details{border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-top:8px}
  summary{cursor:pointer;font-weight:600;font-size:12.5px;color:var(--fg);list-style:none}
  summary::-webkit-details-marker{display:none}
  summary::before{content:"▸ ";color:var(--mut)}
  details[open] summary::before{content:"▾ "}
  .f2{display:grid;grid-template-columns:auto 1fr;gap:6px 8px;align-items:center;margin-top:8px}
  .f2 > span{color:var(--mut);font-size:12px}
  .hist{border:1px solid var(--line);border-radius:8px;padding:8px;margin-bottom:6px}
  .hist .t{font-weight:600;direction:auto;overflow-wrap:anywhere}
  .hist .m{color:var(--mut);font-size:11.5px;margin:2px 0 6px}
  .fab{position:fixed;z-index:2147483000;width:48px;height:48px;border-radius:50%;background:#1a73e8;color:#fff;border:0;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer;font-size:12px;font-weight:700}
  .danger{color:var(--red)}
  .scorepill{display:inline-block;min-width:30px;text-align:center;border-radius:999px;padding:1px 6px;font-weight:700;font-size:11.5px}
  /* table */
  .ov{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
  .modal{width:min(1250px,95vw);height:min(860px,90vh);background:var(--bg);color:var(--fg);border-radius:14px;box-shadow:var(--shadow);display:flex;flex-direction:column;overflow:hidden;font-size:13px}
  .mh{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);flex-wrap:wrap}
  .mh b{font-size:15px;margin-inline-end:auto}
  .tb{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--line)}
  .tb input[type=text]{width:220px}
  .tw{flex:1;overflow:auto}
  table{border-collapse:collapse;width:100%;font-size:12.5px}
  th{position:sticky;top:0;background:var(--bg2);color:var(--mut);font-weight:600;text-align:start;padding:7px 8px;border-bottom:1px solid var(--bd);cursor:pointer;white-space:nowrap;user-select:none}
  td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  td.w{white-space:normal;min-width:180px}
  tr:hover td{background:var(--bg2)}
  tr.sel td{background:var(--accbg)}
  a{color:var(--acc);text-decoration:none}
  a:hover{text-decoration:underline}
  .ltr{direction:ltr;unicode-bidi:plaintext}
  .mf{display:flex;gap:8px;align-items:center;padding:8px 14px;border-top:1px solid var(--line);flex-wrap:wrap}
  .soc a{margin-inline-end:6px;font-weight:600}
  `;

  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k === "class") e.className = v;
      else if (k === "style") e.setAttribute("style", v);
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "value") e.value = v;
      else if (k === "checked" || k === "selected" || k === "disabled" || k === "open") e[k] = !!v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
    return e;
  }

  function isDark() {
    const th = S.settings.theme;
    if (th === "dark") return true;
    if (th === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function build() {
    host = document.createElement("div");
    host.id = "gml-host";
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.append(el("style", {}, CSS));
    const wrap = el("div", { class: "theme" });
    root.append(wrap);
    $ = { root, wrap };
    root.addEventListener("pointerdown", () => (pointerDown = true), true);
    window.addEventListener("pointerup", () => setTimeout(() => (pointerDown = false), 0), true);
    window.addEventListener("pointercancel", () => (pointerDown = false), true);
    try {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
    } catch {}
    render();
  }

  function position(panel) {
    const st = S.settings;
    if (st.x !== null && st.y !== null) {
      panel.style.left = Math.min(Math.max(0, st.x), window.innerWidth - 60) + "px";
      panel.style.top = Math.min(Math.max(0, st.y), window.innerHeight - 60) + "px";
    } else {
      if (lang() === "ar") panel.style.right = "64px";
      else panel.style.right = "64px";
      panel.style.top = "64px";
    }
  }

  function drag(handle, panel) {
    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      const r = panel.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const move = (ev) => {
        S.settings.x = ev.clientX - dx;
        S.settings.y = ev.clientY - dy;
        panel.style.right = "auto";
        panel.style.left = S.settings.x + "px";
        panel.style.top = S.settings.y + "px";
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        save();
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      e.preventDefault();
    });
  }

  // Pas de redessin pendant un clic (sinon le bouton est remplace entre mousedown et mouseup)
  // et au plus ~4 redessins par seconde pendant l'extraction.
  let renderQueued = false;
  let pointerDown = false;
  let lastDraw = 0;
  function render() {
    if (!$ || renderQueued) return;
    renderQueued = true;
    const go = () => {
      if (pointerDown) return setTimeout(go, 60);
      const wait = 250 - (Date.now() - lastDraw);
      if (wait > 0 && (S.running || S.siteRun)) return setTimeout(go, wait);
      requestAnimationFrame(() => {
        renderQueued = false;
        lastDraw = Date.now();
        draw();
      });
    };
    go();
  }

  const set = (k, v) => {
    S.settings[k] = v;
    save();
    render();
  };
  const setF = (k, v) => {
    S.settings.filters[k] = v;
    save();
    render();
  };

  function scorePill(v) {
    const c = v >= 70 ? ["#e6f4ea", "#137333"] : v >= 40 ? ["#fef7e0", "#b06000"] : ["#fce8e6", "#c5221f"];
    return el("span", { class: "scorepill", style: `background:${c[0]};color:${c[1]}` }, String(v));
  }

  // ---------------------------------------------------------------- tab: search
  function viewSearch() {
    const st = S.settings;
    const busy = S.running || (job && !job.paused);
    const view = mapView();
    const out = [];

    if (job && job.paused)
      out.push(
        el(
          "div",
          { class: "banner" },
          t("resume_banner", { l: job.label, i: fmtN(job.i + 1), n: fmtN(job.items.length), a: fmtN(job.added) }),
          el("div", { class: "row", style: "margin-top:6px" }, el("button", { class: "btn go sm", onclick: continueJob }, t("btn_continue")), el("button", { class: "btn sm", onclick: cancelJob }, t("btn_cancel")))
        )
      );

    out.push(
      el("h4", {}, t("h_what")),
      el("input", { class: "tx", "data-k": "what", type: "text", value: st.what, placeholder: t("ph_what"), oninput: (e) => { st.what = e.target.value; save(); } }),
      el("h4", {}, t("h_where")),
      el(
        "div",
        { class: "seg wide" },
        el("label", {}, el("input", { type: "radio", name: "wm", checked: st.whereMode === "map", onchange: () => set("whereMode", "map") }), t("where_map")),
        el("label", {}, el("input", { type: "radio", name: "wm", checked: st.whereMode === "text", onchange: () => set("whereMode", "text") }), t("where_text")),
        el("label", {}, el("input", { type: "radio", name: "wm", checked: st.whereMode === "region", onchange: () => set("whereMode", "region") }), t("where_region"))
      )
    );
    if (st.whereMode === "map")
      out.push(el("div", { class: "mapinfo" }, view ? t("map_info", { lat: view.lat.toFixed(4), lng: view.lng.toFixed(4), z: Math.round(view.z) }) : t("map_move")));
    else if (st.whereMode === "text")
      out.push(el("textarea", { class: "tx", "data-k": "where", value: st.where, placeholder: t("ph_where"), oninput: (e) => { st.where = e.target.value; save(); } }));
    else
      out.push(
        el("input", { class: "tx", "data-k": "region", type: "text", value: st.region, placeholder: t("ph_region"), oninput: (e) => { st.region = e.target.value; save(); } }),
        el(
          "div",
          { class: "row" },
          el("select", { onchange: (e) => set("regionMax", parseInt(e.target.value, 10)) }, [10, 25, 50, 100, 0].map((n) => el("option", { value: String(n), selected: st.regionMax === n }, n ? t("cities_n", { n }) : t("cities_all")))),
          el("select", { onchange: (e) => set("regionTypes", e.target.value) }, ["city", "town", "all"].map((v) => el("option", { value: v, selected: st.regionTypes === v }, t("ptype_" + v)))),
          el("button", { class: "btn sm sec2", disabled: citiesBusy, onclick: () => loadCities(true) }, t("btn_cities"))
        ),
        el("div", { class: "muted", style: "margin-top:4px" }, t("region_hint"))
      );

    out.push(
      el(
        "div",
        { class: "row", style: "margin-top:4px" },
        el("span", { class: "muted" }, t("coverage")),
        el(
          "select",
          { onchange: (e) => set("grid", parseInt(e.target.value, 10)) },
          el("option", { value: "0", selected: !st.grid }, t("cov_0")),
          el("option", { value: "3", selected: st.grid === 3 }, t("cov_3")),
          el("option", { value: "5", selected: st.grid === 5 }, t("cov_5"))
        )
      )
    );

    // filters
    const f = st.filters;
    const nFilters = (f.minRating > 0) + (f.minReviews > 0) + (f.website !== "any") + !!f.hideClosed + !!f.needPhone;
    out.push(
      el(
        "details",
        { open: st.showFilters, ontoggle: (e) => { st.showFilters = e.target.open; save(); } },
        el("summary", {}, t("h_filters") + (nFilters ? ` (${fmtN(nFilters)})` : "")),
        el(
          "div",
          { class: "f2" },
          el("span", {}, t("f_rating")),
          el("select", { onchange: (e) => setF("minRating", parseFloat(e.target.value)) }, [0, 3, 3.5, 4, 4.5].map((v) => el("option", { value: String(v), selected: f.minRating === v }, v ? `≥ ${v} ★` : t("f_any")))),
          el("span", {}, t("f_reviews")),
          el("input", { type: "number", min: "0", value: f.minReviews || 0, onchange: (e) => setF("minReviews", parseInt(e.target.value, 10) || 0) }),
          el("span", {}, t("f_website")),
          el("select", { onchange: (e) => setF("website", e.target.value) }, ["any", "with", "without"].map((v) => el("option", { value: v, selected: f.website === v }, t("f_web_" + v))))
        ),
        el(
          "div",
          { class: "row", style: "margin-top:8px" },
          el("label", {}, el("input", { type: "checkbox", checked: f.hideClosed, onchange: (e) => setF("hideClosed", e.target.checked) }), t("f_closed")),
          el("label", {}, el("input", { type: "checkbox", checked: f.needPhone, onchange: (e) => setF("needPhone", e.target.checked) }), t("f_phone"))
        )
      )
    );

    // fields
    out.push(
      el(
        "details",
        { open: st.showFields, ontoggle: (e) => { st.showFields = e.target.open; save(); } },
        el("summary", {}, t("h_fields", { n: fmtN(FIELD_IDS.filter((id) => st.fields[id]).length) })),
        el(
          "div",
          { class: "grid", style: "margin-top:8px" },
          FIELD_IDS.map((id) => el("label", {}, el("input", { type: "checkbox", checked: !!st.fields[id], onchange: (e) => { st.fields[id] = e.target.checked ? 1 : 0; save(); render(); } }), t("fld_" + id)))
        )
      )
    );

    // mode / speed / limit
    out.push(
      el(
        "div",
        { class: "f2" },
        el("span", {}, t("h_mode")),
        el(
          "div",
          { class: "seg" },
          el("label", { title: t("mode_full_tip") }, el("input", { type: "radio", name: "m", checked: st.mode === "full", onchange: () => set("mode", "full") }), t("mode_full")),
          el("label", { title: t("mode_fast_tip") }, el("input", { type: "radio", name: "m", checked: st.mode === "fast", onchange: () => set("mode", "fast") }), t("mode_fast"))
        ),
        el("span", {}, t("h_speed")),
        el(
          "div",
          { class: "seg" },
          ["slow", "normal", "fast"].map((v) => el("label", { title: t("speed_tip") }, el("input", { type: "radio", name: "sp", checked: st.speed === v, onchange: () => set("speed", v) }), t("speed_" + v)))
        ),
        el("span", {}, t("h_limit")),
        el("input", { type: "number", min: "1", max: "5000", value: st.limit, onchange: (e) => set("limit", parseInt(e.target.value, 10) || 200) })
      )
    );

    out.push(
      busy
        ? el("button", { class: "btn stop full", style: "margin-top:10px", onclick: pauseJob }, "⏸ " + t("btn_stop"))
        : el("button", { class: "btn go full", style: "margin-top:10px;padding:10px", disabled: citiesBusy || (job && job.paused), onclick: startSearch }, "🔍 " + (st.whereMode === "map" ? t("btn_go_map") : t("btn_go"))),
      el(
        "div",
        { class: "btns" },
        el("button", { class: "btn sec2 sm", disabled: busy, title: t("btn_visible_tip"), onclick: run }, "▶ " + t("btn_visible")),
        el("button", { class: "btn sm", disabled: busy, onclick: addCurrent }, "＋ " + t("btn_this"))
      )
    );
    return out;
  }

  // ---------------------------------------------------------------- shared: status, stats, export
  function viewCommon() {
    const st = S.settings;
    const withPhone = S.rows.filter((r) => r.phone).length;
    const withEmail = S.rows.filter((r) => r.email).length;
    const withSoc = S.rows.filter((r) => r.socials && Object.values(r.socials).some(Boolean)).length;
    const todo = siteTodo().length;
    const last = S.rows.slice(-25).reverse();
    return [
      el("div", { class: "status " + (S.statusKind || "") }, S.status || t("st_hello")),
      el(
        "div",
        { class: "stats" },
        el("div", { class: "stat" }, el("b", {}, fmtN(S.rows.length)), el("span", {}, t("stat_places"))),
        el("div", { class: "stat" }, el("b", {}, fmtN(withPhone)), el("span", {}, t("stat_phones"))),
        el("div", { class: "stat" }, el("b", {}, fmtN(withEmail)), el("span", {}, t("stat_emails"))),
        el("div", { class: "stat" }, el("b", {}, fmtN(withSoc)), el("span", {}, t("stat_socials")))
      ),
      S.siteRun
        ? el("button", { class: "btn stop full", onclick: stopSites }, "⏸ " + t("btn_sites_stop", { n: fmtN(S.pendingSites) }))
        : el("button", { class: "btn mail full", title: t("btn_sites_tip"), onclick: startSites }, "📧 " + t("btn_sites", { n: fmtN(todo) })),
      el("label", { style: "margin-top:5px" }, el("input", { type: "checkbox", checked: st.autoSite, onchange: (e) => set("autoSite", e.target.checked) }), el("span", { class: "muted" }, t("auto_sites"))),
      last.length
        ? el(
            "div",
            { class: "list" },
            last.map((r) => el("div", { class: "it" }, el("span", { class: "n", title: r.address || "" }, r.name), el("span", { class: "p" }, r.phone || (r.email ? r.email.split(",")[0] : ""))))
          )
        : null,
      el("h4", {}, t("h_export")),
      el(
        "div",
        { class: "row" },
        el("label", {}, el("input", { type: "checkbox", checked: st.onlyPhone, onchange: (e) => set("onlyPhone", e.target.checked) }), t("only_phone")),
        el("label", {}, el("input", { type: "checkbox", checked: st.onlyEmail, onchange: (e) => set("onlyEmail", e.target.checked) }), t("only_email"))
      ),
      el(
        "div",
        { class: "btns3" },
        el("button", { class: "btn xl sm", onclick: () => exportXlsx(exportSet()) }, "⬇ Excel"),
        el("button", { class: "btn sm", onclick: () => exportCsv(exportSet()) }, "⬇ CSV"),
        el("button", { class: "btn sheet sm", title: t("sheets_tip"), onclick: () => toSheets(exportSet()) }, "📗 Sheets")
      ),
      el(
        "div",
        { class: "btns3" },
        el("button", { class: "btn sm", onclick: () => openTable() }, "📊 " + t("btn_table")),
        el("button", { class: "btn sm", onclick: () => copyList(phonesOf(exportSet()), "w_phones") }, "📋 " + t("btn_copy_phones")),
        el("button", { class: "btn sm", onclick: () => copyList(emailsOf(exportSet()), "w_emails") }, "📋 " + t("btn_copy_emails"))
      ),
    ];
  }

  // ---------------------------------------------------------------- tab: history
  function viewHistory() {
    const counts = {};
    S.rows.forEach((r) => (counts[r.sid] = (counts[r.sid] || 0) + 1));
    const hs = S.history.filter((h) => counts[h.id] || (job && job.id === h.id)).slice().reverse();
    if (!hs.length) return [el("div", { class: "muted", style: "padding:12px 0" }, t("hist_empty"))];
    return [
      el("div", { class: "muted", style: "margin-bottom:8px" }, t("hist_hint")),
      ...hs.map((h) => {
        const rows = S.rows.filter((r) => r.sid === h.id);
        return el(
          "div",
          { class: "hist" },
          el("div", { class: "t" }, h.label),
          el("div", { class: "m" }, `${new Date(h.date).toLocaleString(lang())} · ${t("hist_count", { n: fmtN(counts[h.id] || 0) })}${job && job.id === h.id ? " · " + t("hist_running") : ""}`),
          el(
            "div",
            { class: "row" },
            el("button", { class: "btn sm sec2", onclick: () => openTable(h.id) }, "📊 " + t("btn_view")),
            el("button", { class: "btn sm xl", onclick: () => exportXlsx(rows, h.label) }, "⬇ Excel"),
            el("button", { class: "btn sm", onclick: () => exportCsv(rows, h.label) }, "CSV"),
            el("button", { class: "btn sm sheet", onclick: () => toSheets(rows, h.label) }, "Sheets"),
            el(
              "button",
              {
                class: "btn sm danger",
                onclick: () => {
                  if (!confirm(t("confirm_del_hist", { n: rows.length }))) return;
                  S.rows = S.rows.filter((r) => r.sid !== h.id);
                  keys.clear();
                  S.rows.forEach((r) => keys.add(r.key));
                  S.history = S.history.filter((x) => x.id !== h.id);
                  save();
                  setStatus(t("st_deleted", { n: fmtN(rows.length) }));
                },
              },
              "🗑"
            )
          )
        );
      }),
    ];
  }

  // ---------------------------------------------------------------- tab: settings
  function viewSettings() {
    const st = S.settings;
    return [
      el(
        "div",
        { class: "f2" },
        el("span", {}, t("set_lang")),
        el(
          "select",
          { onchange: (e) => { S.status = ""; S.statusKind = ""; set("lang", e.target.value); } },
          [["auto", t("set_auto")], ["ar", "العربية"], ["fr", "Français"], ["en", "English"]].map(([v, l]) => el("option", { value: v, selected: st.lang === v }, l))
        ),
        el("span", {}, t("set_theme")),
        el("select", { onchange: (e) => set("theme", e.target.value) }, ["auto", "light", "dark"].map((v) => el("option", { value: v, selected: st.theme === v }, t("theme_" + v)))),
        el("span", {}, t("set_cc")),
        el("input", { type: "text", "data-k": "cc", value: st.cc, placeholder: t("ph_cc"), style: "width:110px;direction:ltr", oninput: (e) => { st.cc = e.target.value.replace(/[^\d]/g, ""); save(); } }),
        el("span", {}, t("set_score")),
        el("select", { onchange: (e) => set("scoreProfile", e.target.value) }, ["general", "web"].map((v) => el("option", { value: v, selected: st.scoreProfile === v }, t("score_" + v))))
      ),
      el("div", { class: "muted", style: "margin-top:6px" }, t("cc_hint")),
      el("div", { class: "muted", style: "margin-top:4px" }, t("score_hint_" + st.scoreProfile)),
      el("h4", {}, "📗 Google Sheets"),
      el("div", { class: "muted", style: "margin-bottom:6px" }, t("sheets_hint")),
      el("input", { class: "tx", type: "text", "data-k": "sheetsUrl", value: st.sheetsUrl, placeholder: "https://script.google.com/macros/s/…/exec", style: "direction:ltr", oninput: (e) => { st.sheetsUrl = e.target.value.trim(); save(); } }),
      el(
        "div",
        { class: "row" },
        el("button", { class: "btn sm", onclick: async () => { await writeClip(APPS_SCRIPT); setStatus(t("st_script_copied"), "ok"); } }, "📋 " + t("btn_copy_script")),
        el("button", { class: "btn sm", onclick: () => chrome.runtime.sendMessage({ type: "gml-open", url: "https://script.new" }, () => void chrome.runtime.lastError) }, "↗ script.new")
      ),
      el("div", { class: "muted", style: "margin-top:6px" }, t("sheets_steps")),
      el("h4", {}, t("set_data")),
      el(
        "div",
        { class: "row" },
        el("button", { class: "btn sm", onclick: () => { st.x = null; st.y = null; save(); render(); } }, t("btn_reset_pos")),
        el(
          "button",
          {
            class: "btn sm danger",
            onclick: () => {
              if (!confirm(t("confirm_clear", { n: S.rows.length }))) return;
              stopSites();
              S.rows = [];
              S.history = [];
              keys.clear();
              job = null;
              save();
              setStatus(t("st_cleared"));
            },
          },
          "🗑 " + t("btn_clear")
        )
      ),
    ];
  }

  // ---------------------------------------------------------------- table modal
  const TV = { open: false, q: "", sid: "all", quick: "all", sort: "", dir: -1, sel: new Set(), limit: 300 };

  function openTable(sid) {
    TV.open = true;
    TV.sid = sid || "all";
    TV.sel.clear();
    TV.limit = 300;
    render();
  }

  function tableRows() {
    const q = TV.q.trim().toLowerCase();
    let rows = S.rows.filter((r) => {
      if (TV.sid !== "all" && r.sid !== TV.sid) return false;
      switch (TV.quick) {
        case "phone":
          if (!r.phone) return false;
          break;
        case "email":
          if (!r.email) return false;
          break;
        case "web":
          if (!r.website) return false;
          break;
        case "noweb":
          if (r.website) return false;
          break;
        case "social":
          if (!(r.socials && Object.values(r.socials).some(Boolean))) return false;
          break;
        case "hot":
          if (score(r) < 70) return false;
          break;
      }
      if (q && ![r.name, r.phone, r.email, r.address, r.category, r.website].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
    if (TV.sort) {
      const get = {
        name: (r) => (r.name || "").toLowerCase(),
        category: (r) => (r.category || "").toLowerCase(),
        rating: (r) => parseFloat(r.rating) || 0,
        reviews: (r) => parseInt(r.reviews, 10) || 0,
        score: (r) => score(r),
        address: (r) => (r.address || "").toLowerCase(),
      }[TV.sort];
      if (get) rows = rows.slice().sort((a, b) => (get(a) > get(b) ? 1 : get(a) < get(b) ? -1 : 0) * TV.dir);
    }
    return rows;
  }

  function viewTable() {
    const rows = tableRows();
    const shown = rows.slice(0, TV.limit);
    const selRows = () => rows.filter((r) => TV.sel.has(r.key));
    const target = () => (TV.sel.size ? selRows() : rows);
    const hist = S.history.filter((h) => S.rows.some((r) => r.sid === h.id));
    const th = (id, label) =>
      el(
        "th",
        {
          onclick: () => {
            if (!id) return;
            if (TV.sort === id) TV.dir = -TV.dir;
            else {
              TV.sort = id;
              TV.dir = id === "name" || id === "address" || id === "category" ? 1 : -1;
            }
            render();
          },
        },
        label + (TV.sort === id ? (TV.dir > 0 ? " ▲" : " ▼") : "")
      );
    const allSel = shown.length && shown.every((r) => TV.sel.has(r.key));
    const host_ = (u) => {
      try {
        return new URL(u).hostname.replace(/^www\./, "");
      } catch {
        return u;
      }
    };
    const SOC_ICON = { facebook: "f", instagram: "ig", linkedin: "in", twitter: "x", tiktok: "tt", youtube: "yt", whatsapp: "wa" };

    const tbody = el(
      "tbody",
      {},
      shown.map((r) => {
        const intl = phoneIntlOf(r);
        return el(
          "tr",
          { class: TV.sel.has(r.key) ? "sel" : "" },
          el("td", {}, el("input", { type: "checkbox", checked: TV.sel.has(r.key), onchange: (e) => { e.target.checked ? TV.sel.add(r.key) : TV.sel.delete(r.key); render(); } })),
          el("td", { class: "w" }, r.link ? el("a", { href: r.link, target: "_blank", rel: "noopener" }, r.name) : r.name, r.category ? el("div", { class: "muted" }, r.category) : null),
          el("td", { class: "ltr" }, r.phone || "", intl ? el("div", {}, el("a", { href: waLink(intl), target: "_blank", rel: "noopener", title: "WhatsApp" }, "WhatsApp ↗")) : null),
          el("td", { class: "ltr" }, (r.email || "").split(/,\s*/).filter(Boolean).slice(0, 2).map((m) => el("div", {}, el("a", { href: "mailto:" + m }, m)))),
          el(
            "td",
            {},
            r.website ? el("a", { href: r.website, target: "_blank", rel: "noopener", class: "ltr" }, host_(r.website)) : el("span", { class: "muted" }, "—"),
            r.socials && Object.values(r.socials).some(Boolean)
              ? el("div", { class: "soc" }, SOCIAL_KEYS.filter((k) => r.socials[k]).map((k) => el("a", { href: r.socials[k], target: "_blank", rel: "noopener", title: SOCIAL_LABEL[k] }, SOC_ICON[k])))
              : null
          ),
          el("td", {}, r.rating !== "" ? `${r.rating} ★` : ""),
          el("td", {}, r.reviews !== "" ? fmtN(r.reviews) : ""),
          el("td", {}, r.status ? t("status_" + r.status) : ""),
          el("td", {}, scorePill(score(r))),
          el("td", { class: "w", title: r.hours || "" }, r.address || ""),
          el(
            "td",
            {},
            el(
              "button",
              {
                class: "btn sm danger",
                title: t("btn_delete"),
                onclick: () => {
                  S.rows = S.rows.filter((x) => x !== r);
                  keys.delete(r.key);
                  TV.sel.delete(r.key);
                  save();
                  render();
                },
              },
              "🗑"
            )
          )
        );
      })
    );

    return el(
      "div",
      { class: "ov", onclick: (e) => { if (e.target.classList.contains("ov")) { TV.open = false; render(); } } },
      el(
        "div",
        { class: "modal", dir: lang() === "ar" ? "rtl" : "ltr" },
        el(
          "div",
          { class: "mh" },
          el("b", {}, "📊 " + t("tbl_title", { n: fmtN(rows.length), all: fmtN(S.rows.length) })),
          el("button", { class: "btn sm", onclick: () => { TV.open = false; render(); } }, "✕ " + t("btn_close"))
        ),
        el(
          "div",
          { class: "tb" },
          el("input", { type: "text", "data-k": "tq", value: TV.q, placeholder: "🔎 " + t("tbl_search"), oninput: (e) => { TV.q = e.target.value; TV.limit = 300; render(); } }),
          el("select", { onchange: (e) => { TV.sid = e.target.value; TV.sel.clear(); render(); } }, el("option", { value: "all", selected: TV.sid === "all" }, t("tbl_all_searches")), hist.slice().reverse().map((h) => el("option", { value: h.id, selected: TV.sid === h.id }, h.label.slice(0, 60)))),
          el("select", { onchange: (e) => { TV.quick = e.target.value; render(); } }, ["all", "phone", "email", "web", "noweb", "social", "hot"].map((v) => el("option", { value: v, selected: TV.quick === v }, t("q_" + v))))
        ),
        el(
          "div",
          { class: "tw" },
          el(
            "table",
            {},
            el(
              "thead",
              {},
              el(
                "tr",
                {},
                el("th", {}, el("input", { type: "checkbox", checked: !!allSel, onchange: (e) => { shown.forEach((r) => (e.target.checked ? TV.sel.add(r.key) : TV.sel.delete(r.key))); render(); } })),
                th("name", t("col_name")),
                th("", t("col_phone")),
                th("", t("col_email")),
                th("", t("col_website")),
                th("rating", t("col_rating")),
                th("reviews", t("col_reviews")),
                th("", t("col_status")),
                th("score", t("col_score")),
                th("address", t("col_address")),
                el("th", {}, "")
              )
            ),
            tbody
          ),
          rows.length > shown.length ? el("div", { style: "padding:10px;text-align:center" }, el("button", { class: "btn sm", onclick: () => { TV.limit += 300; render(); } }, t("tbl_more", { n: fmtN(rows.length - shown.length) }))) : null
        ),
        el(
          "div",
          { class: "mf" },
          el("span", { class: "muted" }, TV.sel.size ? t("tbl_sel", { n: fmtN(TV.sel.size) }) : t("tbl_nosel")),
          el("button", { class: "btn sm", onclick: () => { rows.forEach((r) => TV.sel.add(r.key)); render(); } }, t("btn_sel_all", { n: fmtN(rows.length) })),
          TV.sel.size ? el("button", { class: "btn sm", onclick: () => { TV.sel.clear(); render(); } }, t("btn_sel_none")) : null,
          TV.sel.size
            ? el(
                "button",
                {
                  class: "btn sm danger",
                  onclick: () => {
                    if (!confirm(t("confirm_del_sel", { n: TV.sel.size }))) return;
                    S.rows = S.rows.filter((r) => !TV.sel.has(r.key));
                    TV.sel.forEach((k) => keys.delete(k));
                    TV.sel.clear();
                    save();
                    render();
                  },
                },
                "🗑 " + t("btn_del_sel")
              )
            : null,
          el("span", { style: "flex:1" }),
          el("button", { class: "btn sm xl", onclick: () => exportXlsx(target()) }, "⬇ Excel"),
          el("button", { class: "btn sm", onclick: () => exportCsv(target()) }, "⬇ CSV"),
          el("button", { class: "btn sm sheet", onclick: () => toSheets(target()) }, "📗 Sheets"),
          el("button", { class: "btn sm", onclick: () => copyList(phonesOf(target()), "w_phones") }, "📋 " + t("btn_copy_phones")),
          el("button", { class: "btn sm", onclick: () => copyList(emailsOf(target()), "w_emails") }, "📋 " + t("btn_copy_emails"))
        )
      )
    );
  }

  // ---------------------------------------------------------------- draw
  function draw() {
    const st = S.settings;
    const bdOld = $.wrap.querySelector(".bd");
    const scrollTop = bdOld ? bdOld.scrollTop : 0;
    const twOld = $.wrap.querySelector(".tw");
    const twScroll = twOld ? twOld.scrollTop : 0;
    const ae = $.root.activeElement;
    const focusKey = ae && ae.dataset ? ae.dataset.k : null;
    const sel = focusKey && ae.selectionStart !== undefined && ae.selectionStart !== null ? [ae.selectionStart, ae.selectionEnd] : null;

    $.wrap.className = "theme" + (isDark() ? " dark" : "");
    $.wrap.textContent = "";
    if (!st.open) return;
    const dir = lang() === "ar" ? "rtl" : "ltr";

    if (st.min) {
      const fab = el("button", { class: "fab", title: "GMaps Leads", onclick: () => set("min", false) }, fmtN(S.rows.length));
      fab.style.right = "64px";
      fab.style.top = "64px";
      $.wrap.append(fab);
    } else {
      const tabs = [
        ["search", "🔍 " + t("tab_search")],
        ["history", "🕘 " + t("tab_history")],
        ["settings", "⚙ " + t("tab_settings")],
      ];
      const body = st.tab === "history" ? viewHistory() : st.tab === "settings" ? viewSettings() : [...viewSearch()];
      const panel = el(
        "div",
        { class: "panel", dir },
        el(
          "div",
          { class: "hd" },
          el("span", { class: "badge" }, fmtN(S.rows.length)),
          el("b", { dir: "ltr" }, "GMaps Leads"),
          el("button", { class: "ib", title: t("theme_toggle"), onclick: () => set("theme", isDark() ? "light" : "dark") }, isDark() ? "☀" : "☾"),
          el("button", { class: "ib", title: t("btn_min"), onclick: () => set("min", true) }, "–"),
          el("button", { class: "ib", title: t("btn_close"), onclick: () => set("open", false) }, "✕")
        ),
        el("div", { class: "tabs" }, tabs.map(([id, l]) => el("button", { class: st.tab === id ? "on" : "", onclick: () => set("tab", id) }, l))),
        el("div", { class: "bd" }, body, viewCommon())
      );
      position(panel);
      $.wrap.append(panel);
      drag(panel.querySelector(".hd"), panel);
      const bd = panel.querySelector(".bd");
      if (bd) bd.scrollTop = scrollTop;
    }
    if (TV.open) {
      $.wrap.append(viewTable());
      const tw = $.wrap.querySelector(".tw");
      if (tw) tw.scrollTop = twScroll;
    }
    if (focusKey) {
      const f = $.wrap.querySelector(`[data-k="${focusKey}"]`);
      if (f) {
        f.focus();
        if (sel && f.setSelectionRange)
          try {
            f.setSelectionRange(sel[0], sel[1]);
          } catch {}
      }
    }
  }

  // ================================================================ boot
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "gml-toggle") {
      S.settings.open = !S.settings.open || S.settings.min;
      S.settings.min = false;
      save();
      render();
      sendResponse({ open: S.settings.open });
    }
    if (msg && msg.type === "gml-ping") sendResponse({ ok: true, count: S.rows.length });
  });

  chrome.storage.onChanged.addListener((ch) => {
    if (ch.gml_settings && ch.gml_settings.newValue && ch.gml_settings.newValue.lang !== S.settings.lang) {
      S.settings.lang = ch.gml_settings.newValue.lang;
      S.status = "";
      render();
    }
  });

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (S.settings.whereMode === "map" && !S.running && S.settings.tab === "search") render();
    }
  }, 700);

  load().then(() => {
    build();
    if (job) {
      S.settings.open = true;
      S.settings.min = false;
      if (!job.paused && job.nav && Date.now() - job.nav < 120000) resumeJob();
      else {
        job.paused = true;
        save();
        render();
      }
    }
  });
})();
