const TXT = {
  en: { s: ["Open Google Maps", "Type what you are looking for", "Choose where: the visible map, cities, or a whole region", "Press Search, then export to Excel / Sheets"], open: "Open Google Maps", toggle: "Show / hide the panel", first: "Open Google Maps first.", reload: "Reload the Google Maps page (F5).", saved: "{n} places saved." },
  fr: { s: ["Ouvrez Google Maps", "Indiquez ce que vous cherchez", "Choisissez où : carte visible, villes ou région entière", "Lancez la recherche, puis exportez vers Excel / Sheets"], open: "Ouvrir Google Maps", toggle: "Afficher / masquer le panneau", first: "Ouvrez d'abord Google Maps.", reload: "Rechargez la page Google Maps (F5).", saved: "{n} établissements enregistrés." },
  ar: { s: ["افتح Google Maps", "اكتب ما تبحث عنه", "اختر المكان: الخريطة الظاهرة أو مدن أو منطقة كاملة", "اضغط «ابحث» ثم صدّر إلى Excel أو Sheets"], open: "افتح Google Maps", toggle: "إظهار / إخفاء اللوحة", first: "افتح Google Maps أولًا.", reload: "أعد تحميل صفحة Google Maps (F5).", saved: "{n} محلًا محفوظًا." },
};
const isMaps = (u) => /^https:\/\/(www\.google\.[a-z.]+\/maps|maps\.google\.[a-z.]+\/)/i.test(u || "");
let L = "en";
let settings = {};
let count = 0;

function pick(l) {
  if (l && l !== "auto" && TXT[l]) return l;
  const n = (navigator.language || "en").slice(0, 2);
  return TXT[n] ? n : "en";
}
function paint() {
  const T = TXT[L];
  document.documentElement.dir = L === "ar" ? "rtl" : "ltr";
  document.getElementById("steps").innerHTML = "";
  T.s.forEach((x) => { const li = document.createElement("li"); li.textContent = x; document.getElementById("steps").appendChild(li); });
  document.getElementById("open").textContent = T.open;
  document.getElementById("toggle").textContent = T.toggle;
  document.getElementById("info").textContent = count ? T.saved.replace("{n}", count) : "";
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
document.getElementById("open").onclick = async () => {
  const tab = await activeTab();
  if (tab && isMaps(tab.url)) window.close();
  else chrome.tabs.create({ url: "https://www.google.com/maps" });
};
document.getElementById("toggle").onclick = async () => {
  const tab = await activeTab();
  if (!tab || !isMaps(tab.url)) return (document.getElementById("info").textContent = TXT[L].first);
  chrome.tabs.sendMessage(tab.id, { type: "gml-toggle" }, () => {
    if (chrome.runtime.lastError) document.getElementById("info").textContent = TXT[L].reload;
    else window.close();
  });
};
document.getElementById("lang").onchange = async (e) => {
  settings.lang = e.target.value;
  await chrome.storage.local.set({ gml_settings: settings });
  L = pick(settings.lang);
  paint();
};
(async () => {
  const d = await chrome.storage.local.get(["gml_rows", "gml_settings"]);
  settings = d.gml_settings || {};
  count = (d.gml_rows || []).length;
  document.getElementById("lang").value = settings.lang || "auto";
  L = pick(settings.lang);
  paint();
})();
