// Servidor do Navegador Roku: roda o Chromium de verdade e envia imagens da página para a TV.
const express = require("express");
const puppeteer = require("puppeteer");

const PORT = process.env.PORT || 10000;
const TOKEN = process.env.TOKEN || ""; // opcional: senha de acesso (?k=...)
const HOME = process.env.HOME_URL || "https://www.google.com";
const W = 1280, H = 720;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36";

const app = express();
let browserPromise = null;
const sessions = new Map();

function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-zygote", "--mute-audio", "--lang=pt-BR"],
    }).then((b) => {
      b.on("disconnected", () => { browserPromise = null; sessions.clear(); });
      return b;
    }).catch((e) => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

async function getSession(id) {
  let s = sessions.get(id);
  if (s && !s.page.isClosed()) { s.last = Date.now(); return s; }
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8" });
  // Mantém tudo numa aba só: links que abririam nova aba abrem na mesma.
  await page.evaluateOnNewDocument(() => {
    window.open = (u) => { if (u) location.href = u; return window; };
    document.addEventListener("click", (e) => {
      const a = e.target && e.target.closest && e.target.closest("a[target]");
      if (a) a.target = "_self";
    }, true);
  });
  s = { page, last: Date.now() };
  sessions.set(id, s);
  page.goto(HOME, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  return s;
}

// Fecha sessões paradas há mais de 15 minutos para economizar memória.
setInterval(() => {
  for (const [id, s] of sessions) {
    if (Date.now() - s.last > 15 * 60 * 1000) { s.page.close().catch(() => {}); sessions.delete(id); }
  }
}, 60 * 1000);

app.get("/health", (_req, res) => res.send("ok"));

app.use((req, res, next) => {
  if (TOKEN && req.query.k !== TOKEN) return res.status(401).send("senha incorreta");
  if (!req.query.s) return res.status(400).send("falta s");
  next();
});

const wrap = (fn) => async (req, res) => {
  try {
    const s = await getSession(String(req.query.s));
    const out = await fn(s.page, req.query);
    if (Buffer.isBuffer(out)) {
      res.set("Content-Type", "image/jpeg").set("Cache-Control", "no-store").send(out);
    } else {
      res.json(out || { ok: true });
    }
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
};

const fixUrl = (u) => {
  u = String(u || "").trim();
  if (!u) return HOME;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(u)) return "https://" + u;
  return "https://www.google.com/search?q=" + encodeURIComponent(u);
};

app.get("/frame", wrap((p, q) => p.screenshot({ type: "jpeg", quality: Number(q.q) || 55 })));
app.get("/info", wrap(async (p) => ({ url: p.url(), title: await p.title().catch(() => "") })));
app.get("/goto", wrap(async (p, q) => { p.goto(fixUrl(q.url), { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}); }));
app.get("/click", wrap(async (p, q) => { await p.mouse.click(Number(q.x) || 0, Number(q.y) || 0); }));
app.get("/move", wrap(async (p, q) => { await p.mouse.move(Number(q.x) || 0, Number(q.y) || 0); }));
app.get("/scroll", wrap(async (p, q) => { await p.mouse.wheel({ deltaY: Number(q.dy) || 0 }); }));
app.get("/type", wrap(async (p, q) => {
  await p.keyboard.type(String(q.text || ""), { delay: 10 });
  if (q.enter === "1") await p.keyboard.press("Enter");
}));
app.get("/key", wrap(async (p, q) => { await p.keyboard.press(String(q.key || "Enter")); }));
app.get("/back", wrap(async (p) => { p.goBack({ timeout: 15000 }).catch(() => {}); }));
app.get("/forward", wrap(async (p) => { p.goForward({ timeout: 15000 }).catch(() => {}); }));
app.get("/reload", wrap(async (p) => { p.reload({ timeout: 30000 }).catch(() => {}); }));

app.listen(PORT, () => console.log("Navegador Roku servidor na porta " + PORT));
