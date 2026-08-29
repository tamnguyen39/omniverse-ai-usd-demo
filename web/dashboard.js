// web/dashboard.js — OpenUSD Kitchen Monitor (single front view + device table).
// Serves static previews and triggers the pipeline. Keeps architecture:
// controller -> sync_to_usd.py; image via usdrecord (macOS; optional on Linux).
import express from "express";
import { execFile } from "node:child_process";
import { readFile, readdir, mkdir, unlink } from "node:fs/promises";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = process.env.DASHBOARD_PORT || 8080;
const PREVIEWS = join(ROOT, "previews");

const app = express();
app.use(express.json());
app.use("/previews", express.static(PREVIEWS));

async function listScenes() {
  const files = await readdir(join(ROOT, "scenes"));
  return files.filter((f) => f.endsWith(".usda")).sort((a, b) => b.localeCompare(a));
}

// Latest scene + baseline (front only). Summary JSON is written by sync_to_usd.py.
app.get("/api/list", async (_req, res) => {
  const scenes = await listScenes();
  const latest = scenes.includes("latest.usda") ? "latest.usda" : null;
  res.json({
    latest,
    baseline: scenes.includes("kitchen_baseline.usda") ? "kitchen_baseline.usda" : null,
    root: ROOT,
  });
});

// Render front view -> PNG (copy + add Cam, then usdrecord).
app.get("/api/render/:name", async (req, res) => {
  const name = basename(req.params.name);
  const usd = join(ROOT, "scenes", name);
  const png = join(PREVIEWS, name.replace(extname(name), "_front.png"));
  await mkdir(PREVIEWS, { recursive: true });
  const wrap = join(ROOT, "scenes", ".vw_" + name);
  await new Promise((res, rej) =>
    execFile("python3", ["usd_connector/make_views.py", usd, wrap], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 }, (e) => (e ? rej(e) : res()))
  );
  await new Promise((res, rej) =>
    execFile("usdrecord", [wrap, png, "--imageWidth", "1600"], { maxBuffer: 50 * 1024 * 1024 }, (e) => (e ? rej(e) : res()))
  );
  await unlink(wrap).catch(() => {});
  res.json({ png: `/previews/${basename(png)}`, filepath: png, ts: new Date().toLocaleTimeString() });
});

app.get("/api/status", async (_req, res) => {
  try {
    res.json(JSON.parse(await readFile(join(ROOT, "scenes", "run_summary.json"), "utf8")));
  } catch {
    res.json({ devices: [] });
  }
});

app.post("/api/run", async (req, res) => {
  const env = {
    THRESH_TEMP_WARN: String(req.query?.tw ?? 75),
    THRESH_TEMP_ERR:  String(req.query?.te ?? 85),
    THRESH_VIB_WARN:  String(req.query?.vw ?? 7),
    THRESH_VIB_ERR:   String(req.query?.ve ?? 9),
  };
  const log = [];
  const run = (cmd, args) =>
    new Promise((resolve, reject) => {
      const p = execFile(cmd, args, { cwd: ROOT, env }, (e) => (e ? reject(e) : resolve()));
      p.stdout?.on("data", (d) => log.push(d.toString()));
      p.stderr?.on("data", (d) => log.push(d.toString()));
    });
  try {
    await run("python3", ["usd_connector/sync_to_usd.py"]);
    const latest = "latest.usda";
    let summary = { devices: [] };
    try { summary = JSON.parse(await readFile(join(ROOT, "scenes", "run_summary.json"), "utf8")); } catch {}
    res.json({ ok: true, latest, summary, log: log.join("") });
  } catch (e) {
    res.json({ ok: false, error: String(e), log: log.join("") });
  }
});

app.get("/api/scene/:name", async (req, res) => {
  try {
    const txt = await readFile(join(ROOT, "scenes", basename(req.params.name)), "utf8");
    res.type("text/plain").send(txt);
  } catch { res.status(404).send("not found"); }
});

app.get("/", (_req, res) => res.type("html").send(DASHBOARD_HTML));
app.listen(PORT, () => console.log(`dashboard on http://localhost:${PORT}`));

const DASHBOARD_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenUSD Kitchen Monitor</title>
<style>
  :root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font:14px/1.5 system-ui;background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:12px;padding:14px 22px;background:var(--panel);border-bottom:1px solid var(--border)}
  header h1{font-size:16px;font-weight:600;flex:1}
  .lang{background:#21262d;color:var(--text);border:1px solid #30363d;padding:5px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600}
  .lang:hover{border-color:#58a6ff}
  section{border-bottom:1px solid var(--border);padding:16px 22px}
  section>h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:12px}
  .controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .ctl{display:flex;align-items:center;gap:6px;background:#11161d;border:1px solid var(--border);border-radius:6px;padding:5px 9px}
  .ctl span{font-size:11px;color:var(--muted);white-space:nowrap}
  .ctl input{width:46px;background:#0d1117;border:1px solid var(--border);color:var(--text);padding:4px 6px;border-radius:4px;font-size:13px}
  #run{background:#238636;color:#fff;border:0;padding:10px 18px;border-radius:7px;cursor:pointer;font-weight:700;font-size:14px}
  #run:hover{background:#2ea043} #run:disabled{opacity:.6;cursor:wait}
  .logic{background:#0a0f14;border:1px dashed #30363d;border-radius:8px;padding:12px;font-size:12.5px;color:#b8c4d0;margin-top:14px;line-height:1.65}
  .logic b{color:#58a6ff}
  .r-badge{display:inline-block;padding:1px 8px;border-radius:10px;margin:0 2px;font-size:11px}
  .r-badge.running{background:#033b6b;color:#7ee}.r-badge.warning{background:#5a3d00;color:#fd6}.r-badge.error{background:#5a0000;color:#f99}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--border)}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  td.reason{color:#adbac7;font-size:12px}
  .pill{display:inline-block;padding:2px 10px;border-radius:11px;font-size:11px;font-weight:600}
  .running{background:#033b6b;color:#7ee}.warning{background:#5a3d00;color:#fd6}.error{background:#5a0000;color:#f99}
  .dual{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:900px){.dual{grid-template-columns:1fr}}
  .pane{border:1px solid var(--border);border-radius:8px;padding:12px;background:#11161d}
  .pane>h3{font-size:12px;font-weight:600;margin-bottom:8px;color:#c9d1d9}
  .pane .viewer{background:#010409;border-radius:6px;padding:10px;display:flex;align-items:center;justify-content:center;min-height:170px;position:relative}
  .pane .viewer img{max-width:100%;max-height:46vh;border-radius:6px;background:#010409}
  .pathrow{display:flex;align-items:center;gap:8px;margin-top:8px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11px;color:#8b949e}
  .ptxt{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8b949e}
  .copybtn{background:#21262d;color:#c9d1d9;border:1px solid #30363d;padding:3px 10px;border-radius:5px;cursor:pointer;font-size:11px;flex-shrink:0}
  .copybtn:hover{border-color:#58a6ff}
  .viewer{position:relative;background:#010409;padding:18px;display:flex;align-items:center;justify-content:center;min-height:200px}
  .viewer img{max-width:100%;max-height:60vh;border-radius:8px;background:#010409}
  .viewer .cap{position:absolute;bottom:26px;left:26px;background:rgba(1,4,9,.72);padding:3px 10px;border-radius:5px;font-size:11px;color:#adbac7}
  .usd{background:#010409;padding:12px;border-radius:8px;font-family:ui-monospace,monospace;font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:28vh;overflow:auto}
  #log{height:22vh}
  .spinner{width:36px;height:36px;border:4px solid #30363d;border-top-color:#58a6ff;border-radius:50%;animation:spin .8s linear infinite;position:absolute;top:50%;left:50%;margin:-18px 0 0 -18px}
  @keyframes spin{to{transform:rotate(360deg)}}
</style></head>
<body>
<header>
  <h1 id="title">OpenUSD Kitchen Monitor — Agent → USD</h1>
  <button class="lang" id="langBtn">VI</button>
</header>

<section>
  <h2>Pipeline controls</h2>
  <div class="controls">
    <label class="ctl" title="Warning temperature (°C)"><span>Temp warn</span><input id="tw" value="75"></label>
    <label class="ctl" title="Error temperature (°C)"><span>Temp error</span><input id="te" value="85"></label>
    <label class="ctl" title="Warning vibration"><span>Vib warn</span><input id="vw" value="7"></label>
    <label class="ctl" title="Error vibration"><span>Vib error</span><input id="ve" value="9"></label>
    <button id="run">▶ Run pipeline</button>
  </div>
  <div class="logic" id="logic"></div>
</section>

<section>
  <h2>Devices & status (data written to OpenUSD)</h2>
  <table id="devices">
    <thead><tr>
      <th>Device</th>
      <th>Status</th>
      <th>Temp</th>
      <th>Vibration</th>
      <th>Reason</th>
    </tr></thead>
    <tbody id="devicesBody"></tbody>
  </table>
</section>

<section>
  <h2 style="display:flex;justify-content:space-between;align-items:center">
    <span>Front view (USD render)</span>
    <span class="d" id="viewMeta" style="text-transform:none;letter-spacing:0"></span>
  </h2>
  <div class="dual">
    <div class="pane">
      <h3>Baseline</h3>
      <div class="viewer"><img id="imgBase" src="" alt="baseline render"><div class="spinner" id="spBase" style="display:none"></div></div>
      <div class="pathrow"><span class="ptxt" id="pathImgBase">—</span><button class="copybtn" onclick="copyPath('pathImgBase')">Copy</button></div>
    </div>
    <div class="pane">
      <h3>Latest</h3>
      <div class="viewer"><img id="imgLatest" src="" alt="latest render"><div class="spinner" id="spLatest" style="display:none"></div></div>
      <div class="pathrow"><span class="ptxt" id="pathImgLatest">—</span><button class="copybtn" onclick="copyPath('pathImgLatest')">Copy</button></div>
    </div>
  </div>
</section>

<section>
  <h2>USD source</h2>
  <div class="dual">
    <div class="pane">
      <h3>Baseline</h3>
      <pre class="usd" id="usdBase">—</pre>
      <div class="pathrow"><span class="ptxt" id="pathUsdBase">—</span><button class="copybtn" onclick="copyPath('pathUsdBase')">Copy</button></div>
    </div>
    <div class="pane">
      <h3>Latest</h3>
      <pre class="usd" id="usdLatest">—</pre>
      <div class="pathrow"><span class="ptxt" id="pathUsdLatest">—</span><button class="copybtn" onclick="copyPath('pathUsdLatest')">Copy</button></div>
    </div>
  </div>
</section>

<section>
  <h2>Log</h2>
  <pre class="usd" id="log">—</pre>
</section>

<script>
const I18N = {
  en: {
    controlsTitle: "Pipeline controls",
    tempWarn: "Temp warn",
    tempErr: "Temp error",
    vibWarn: "Vib warn",
    vibErr: "Vib error",
    run: "Run pipeline",
    devicesTitle: "Devices & status (data written to OpenUSD)",
    thDevice: "Device", thStatus: "Status", thTemp: "Temp", thVib: "Vibration", thReason: "Reason",
    viewTitle: "Front view (USD render)",
    baseLabel: "Baseline",
    latestLabel: "Latest",
    usdTitle: "USD source",
    logTitle: "Log",
    logic: '<b>When you click "Run pipeline":</b> <br>'
      + '1. The agent reads each <b>4 appliances</b> telemetry (temperature, vibration) — fridge, toaster, kettle, ceil_light.<br>'
      + '2. Classification: <span class="r-badge error">error</span> if temp ≥ Error OR vibration ≥ Error; '
      + '<span class="r-badge warning">warning</span> if temp &gt; Warning OR vibration &gt; Warning; '
      + '<span class="r-badge running">running</span> otherwise.<br>'
      + '3. OpenUSD <b>receives</b> this: the connector writes status + temperature + vibration + reason into the scene and '
      + '<b>recolors</b> each appliance mesh in the Pixar Kitchen Set (error=red, warning=amber, running=blue).',
    noData: "No run yet — click Run pipeline.",
    running: "Running pipeline…"
  },
  vi: {
    controlsTitle: "Điều khiển pipeline",
    tempWarn: "Nhiệt CB",
    tempErr: "Nhiệt lỗi",
    vibWarn: "Rung CB",
    vibErr: "Rung lỗi",
    run: "Chạy pipeline",
    devicesTitle: "Thiết bị & trạng thái (dữ liệu ghi vào OpenUSD)",
    thDevice: "Thiết bị", thStatus: "Trạng thái", thTemp: "Nhiệt độ", thVib: "Rung", thReason: "Lý do",
    viewTitle: "Ảnh chính diện (render USD)",
    baseLabel: "Nguyên bản",
    latestLabel: "Mới nhất",
    usdTitle: "USD source",
    logTitle: "Log",
    logic: '<b>Logic khi bấm "Chạy pipeline":</b> <br>'
      + '1. Agent đọc cảm biến (nhiệt độ, rung) của <b>4 thiết bị</b> — fridge, toaster, kettle, ceil_light.<br>'
      + '2. Phân loại theo các ngưỡng bên trên: <span class="r-badge error">error</span> nếu nhiệt ≥ ngưỡng Lỗi HOẶC rung ≥ ngưỡng Lỗi; '
      + '<span class="r-badge warning">warning</span> nếu nhiệt &gt; ngưỡng Cảnh báo HOẶC rung &gt; ngưỡng Cảnh báo; '
      + '<span class="r-badge running">running</span> nếu còn lại.<br>'
      + '3. OpenUSD <b>nhận</b> kết quả này: connector ghi trạng thái + nhiệt độ + rung + lý do vào scene và '
      + '<b>đổi màu mesh</b> thiết bị trong Pixar Kitchen Set (error=đỏ, warning=vàng cam, running=xanh lam).',
    noData: "Chưa có dữ liệu — bấm Chạy pipeline.",
    running: "Đang chạy pipeline…"
  }
};
const STATUS_LABEL = { running: ["running", "running"], warning: ["warning", "warning"], error: ["error", "error"] };

let LANG = localStorage.getItem("lang") || "en";
function t(k){ return I18N[LANG][k]; }

function applyLang(){
  document.documentElement.lang = LANG;
  document.getElementById("langBtn").textContent = LANG === "en" ? "VI" : "EN";
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.getElementById("logic").innerHTML = t("logic");
  renderDevices(window._summary);
}
document.getElementById("langBtn").onclick = () => {
  LANG = LANG === "en" ? "vi" : "en";
  localStorage.setItem("lang", LANG);
  applyLang();
};

function renderDevices(summary){
  const body = document.getElementById("devicesBody");
  const meta = document.getElementById("viewMeta");
  if(!summary || !summary.devices || !summary.devices.length){
    body.innerHTML = '<tr><td colspan="5" style="color:#8b949e">' + t("noData") + "</td></tr>";
    meta.textContent = "";
    return;
  }
  body.innerHTML = summary.devices.map(d => {
    const st = d.status;
    return '<tr><td>' + d.id + '</td>'
      + '<td><span class="pill ' + st + '">' + st + '</span></td>'
      + '<td>' + d.temperature + '°C</td>'
      + '<td>' + d.vibration + '</td>'
      + '<td class="reason">' + (d.reason || "") + '</td></tr>';
  }).join("");
  meta.textContent = (summary.model || "") + (summary.scene ? " · " + summary.scene : "");
}

const api = (p,o) => fetch(p,o).then(r => r.json());
const SIDE = { base: {img:"imgBase", sp:"spBase", pimg:"pathImgBase"}, latest: {img:"imgLatest", sp:"spLatest", pimg:"pathImgLatest"} };

async function renderFront(name, side){
  if(!name) return;
  const s = SIDE[side];
  document.getElementById(s.sp).style.display = "block";
  try {
    const r = await api("/api/render/" + name);
    if(r.png){
      document.getElementById(s.img).src = r.png + "?t=" + Date.now();
      document.getElementById(s.pimg).textContent = r.filepath || "";
      document.getElementById(s.pimg).title = r.filepath || "";
    }
  } catch(e){ document.getElementById(s.pimg).textContent = "render error: " + e; }
  document.getElementById(s.sp).style.display = "none";
}
async function loadUsd(name, side){
  const id = side === "base" ? "usdBase" : "usdLatest";
  const pid = side === "base" ? "pathUsdBase" : "pathUsdLatest";
  const p = (window._root || "") + "/scenes/" + name;
  document.getElementById(pid).textContent = p;
  document.getElementById(pid).title = p;
  try { document.getElementById(id).textContent = await (await fetch("/api/scene/" + name)).text(); }
  catch(e){ document.getElementById(id).textContent = "—"; }
}
function copyPath(id){
  const txt = document.getElementById(id).title || document.getElementById(id).textContent;
  navigator.clipboard.writeText(txt).then(() => {
    const b = document.getElementById(id).parentElement.querySelector(".copybtn");
    const old = b.textContent; b.textContent = "✓"; setTimeout(() => b.textContent = old, 1200);
  });
}
async function refresh(){
  const list = await api("/api/list");
  window._root = list.root;
  window._latest = list.latest;
  const s = await api("/api/status");
  window._summary = s;
  renderDevices(s);
  if(list.baseline){ renderFront(list.baseline, "base"); loadUsd(list.baseline, "base"); }
  if(list.latest){ renderFront(list.latest, "latest"); loadUsd(list.latest, "latest"); }
}
document.getElementById("run").onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  document.getElementById("log").textContent = t("running");
  const p = new URLSearchParams({ tw: tw.value, te: te.value, vw: vw.value, ve: ve.value });
  const r = await api("/api/run?" + p.toString(), { method: "POST" });
  document.getElementById("log").textContent = (r.log || r.error || "");
  if(r.ok){ window._summary = r.summary; }
  await refresh();
  btn.disabled = false;
};
applyLang();
refresh();
</script>
</body></html>`;