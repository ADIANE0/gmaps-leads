// GMaps Leads v2 - service worker
// - lecture des sites web (emails + reseaux sociaux) en arriere-plan, sans ouvrir d'onglet
// - liste des villes d'une region (OpenStreetMap / Overpass)
// - envoi vers Google Sheets (Apps Script) et ouverture d'onglets

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,24}/gi;
const BAD_EMAIL =
  /\.(png|jpe?g|gif|webp|svg|bmp|ico|css|js|woff2?|ttf|mp4|pdf)$|@(?:\d+x|example\.|domain\.|email\.(?:com|fr)$|sentry|wixpress|.*\.wix\.com|sentry-next|.*\.sentry\.io|godaddy|yourdomain|votredomaine|exemple\.)|^(?:name|nom|email|e-mail|user|username|votre|your|info@example)@/i;
const SKIP_HOSTS = /(?:^|\.)(facebook|fb|instagram|twitter|x|tiktok|youtube|linkedin|wa\.me|whatsapp|google|goo\.gl|bit\.ly|linktr\.ee)\./i;
const CONTACT_WORDS = /contact|contacter|joindre|nous-joindre|a-propos|apropos|about|qui-sommes|impressum|kontakt|%D8%A7%D8%AA%D8%B5%D9%84/i;

const SOCIAL = [
  ["facebook", /https?:\/\/(?:www\.|m\.|web\.)?(?:facebook|fb)\.com\/(?!sharer|share|dialog|plugins|tr\b|login|groups\/?$)[^\s"'<>?#]+/i],
  ["instagram", /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore|accounts|share)[A-Za-z0-9_.]+/i],
  ["linkedin", /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in|school)\/[^\s"'<>?#]+/i],
  ["twitter", /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|search|hashtag)[A-Za-z0-9_]{1,30}(?=[\/"'?#\s<]|$)/i],
  ["tiktok", /https?:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9_.]+/i],
  ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(?:channel\/|c\/|user\/|@)[^\s"'<>?#]+/i],
  ["whatsapp", /https?:\/\/(?:wa\.me\/\+?\d{6,15}|(?:api|web)\.whatsapp\.com\/send\/?\?phone=\+?\d{6,15})/i],
];

const cache = new Map();
const queue = [];
let active = 0;
const MAX_ACTIVE = 4;

function decodeHtml(s) {
  return s
    .replace(/&#64;|&#x40;|&commat;/gi, "@")
    .replace(/&#46;|&#x2e;|&period;/gi, ".")
    .replace(/&amp;/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/\s*\[\s*(?:at|arobase)\s*\]\s*|\s*\(\s*(?:at|arobase)\s*\)\s*/gi, "@")
    .replace(/\s*\[\s*(?:dot|point)\s*\]\s*|\s*\(\s*(?:dot|point)\s*\)\s*/gi, ".")
    .replace(/\\u0040/gi, "@");
}

function extractEmails(text) {
  const found = new Set();
  for (const m of text.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    try {
      found.add(decodeURIComponent(m[1]).toLowerCase());
    } catch {
      found.add(m[1].toLowerCase());
    }
  }
  for (const m of text.matchAll(EMAIL_RE)) found.add(m[0].toLowerCase());
  return [...found]
    .map((e) => e.trim().replace(/^[.\-_]+|[.\-_]+$/g, ""))
    .filter((e) => e.length <= 80 && /^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/.test(e) && !BAD_EMAIL.test(e));
}

function extractSocials(text, out) {
  for (const [k, re] of SOCIAL) {
    if (out[k]) continue;
    const g = new RegExp(re.source, "gi");
    for (const m of text.matchAll(g)) {
      let u = m[0].replace(/[\\.,;)]+$/, "");
      if (k === "facebook" && /facebook\.com\/(?:[^/]+\/)?(?:photos?|videos?|events|posts)\b/i.test(u)) continue;
      if (k === "whatsapp") {
        const d = (u.match(/\d{6,15}/) || [])[0];
        if (!d) continue;
        u = "https://wa.me/" + d;
      }
      out[k] = u;
      break;
    }
  }
  return out;
}

async function fetchText(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", credentials: "omit" });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || (ct && !/text|html|xml|json/i.test(ct))) return { html: "", finalUrl: r.url || url };
    const html = (await r.text()).slice(0, 3_000_000);
    return { html, finalUrl: r.url || url };
  } catch {
    return { html: "", finalUrl: url };
  } finally {
    clearTimeout(t);
  }
}

function normalizeSite(site) {
  try {
    let s = site.trim();
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    const u = new URL(s);
    if (/google\./i.test(u.hostname) && u.searchParams.get("q")) return normalizeSite(u.searchParams.get("q"));
    return u;
  } catch {
    return null;
  }
}

function sortEmails(list, host) {
  const base = host.replace(/^www\./, "").split(".").slice(-2, -1)[0] || "";
  const score = (e) => (e.includes(base) ? 0 : 2) + (/^(contact|info|commercial|vente|sales|hello|bonjour|office)@/.test(e) ? 0 : 1);
  return list.sort((a, b) => score(a) - score(b));
}

async function scanSite(site) {
  const u = normalizeSite(site);
  if (!u) return { emails: [], socials: {} };
  const socials = {};
  // un "site web" qui est deja un reseau social
  if (SKIP_HOSTS.test(u.hostname + ".")) {
    extractSocials(u.href, socials);
    return { emails: [], socials };
  }
  const key = u.origin + u.pathname;
  if (cache.has(key)) return cache.get(key);

  const emails = new Set();
  const first = await fetchText(u.href);
  const text = decodeHtml(first.html);
  extractEmails(text).forEach((e) => emails.add(e));
  extractSocials(text, socials);

  if (emails.size === 0) {
    let origin = u.origin;
    try {
      origin = new URL(first.finalUrl).origin;
    } catch {}
    const candidates = new Set();
    for (const m of first.html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
      if (!CONTACT_WORDS.test(m[1])) continue;
      try {
        const link = new URL(m[1], first.finalUrl);
        if (link.origin === origin && /^https?:$/.test(link.protocol)) candidates.add(link.href);
      } catch {}
      if (candidates.size >= 3) break;
    }
    ["/contact", "/contact-us", "/contactez-nous"].forEach((p) => candidates.add(origin + p));
    let tries = 0;
    for (const c of candidates) {
      if (tries++ >= 5 || emails.size) break;
      const r = await fetchText(c, 10000);
      const tx = decodeHtml(r.html);
      extractEmails(tx).forEach((e) => emails.add(e));
      extractSocials(tx, socials);
    }
  }
  const out = { emails: sortEmails([...emails], u.hostname).slice(0, 5), socials };
  cache.set(key, out);
  return out;
}

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active++;
    scanSite(job.url)
      .then((r) => job.resolve(r))
      .catch(() => job.resolve({ emails: [], socials: {} }))
      .finally(() => {
        active--;
        pump();
      });
  }
}

// ------------------------------------------------------------ villes d'une region (OSM)
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

function reEsc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/"/g, '\\"');
}

async function getCities(region, types) {
  const r = reEsc(region.trim());
  const place = types === "all" ? "city|town|village" : types === "city" ? "city" : "city|town";
  const q = `[out:json][timeout:90];
(
 area["boundary"="administrative"]["name"~"^${r}$",i];
 area["boundary"="administrative"]["name:en"~"^${r}$",i];
 area["boundary"="administrative"]["name:fr"~"^${r}$",i];
 area["boundary"="administrative"]["name:ar"~"^${r}$",i];
 area["boundary"="administrative"]["int_name"~"^${r}$",i];
)->.a;
node(area.a)["place"~"^(${place})$"];
out;`;
  let lastErr = "";
  for (const ep of OVERPASS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 100000);
      const res = await fetch(ep, {
        method: "POST",
        body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        lastErr = "HTTP " + res.status;
        continue;
      }
      const data = await res.json();
      const seen = new Set();
      const rank = { city: 0, town: 1, village: 2 };
      const list = [];
      for (const el of data.elements || []) {
        const tg = el.tags || {};
        const name = tg["name:en"] || tg["name:fr"] || tg.int_name || tg.name;
        if (!name) continue;
        const k = name.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        list.push({
          name,
          lat: el.lat,
          lng: el.lon,
          pop: parseInt(String(tg.population || "0").replace(/[^\d]/g, ""), 10) || 0,
          rank: rank[tg.place] ?? 3,
        });
      }
      list.sort((a, b) => b.pop - a.pop || a.rank - b.rank);
      return { ok: true, cities: list };
    } catch (e) {
      lastErr = String(e && e.message ? e.message : e);
    }
  }
  return { ok: false, error: lastErr || "network" };
}

// ------------------------------------------------------------ messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === "gml-site" && msg.url) {
    queue.push({ url: msg.url, resolve: (r) => sendResponse(r) });
    pump();
    return true;
  }
  if (msg.type === "gml-cities") {
    getCities(msg.region || "", msg.types || "town").then(sendResponse);
    return true;
  }
  if (msg.type === "gml-open" && msg.url) {
    chrome.tabs.create({ url: msg.url, index: sender.tab ? sender.tab.index + 1 : undefined }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "gml-sheets" && msg.url) {
    fetch(msg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(msg.payload), redirect: "follow" })
      .then(async (r) => {
        let txt = "";
        try {
          txt = await r.text();
        } catch {}
        sendResponse({ ok: r.ok, status: r.status, text: txt.slice(0, 300) });
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
