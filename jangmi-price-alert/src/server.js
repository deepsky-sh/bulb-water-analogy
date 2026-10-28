const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("./config");
const { Store } = require("./store");
const { createNotifier, isSafeWebhookUrl } = require("./notifier");
const { createChecker, priceMessage } = require("./checker");
const { findComplexes } = require("./jangmi");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function str(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validateSubscription(body, config) {
  const complex = body.complex || {};
  const unit = body.unit || {};
  const channels = body.channels || {};
  const options = body.options || {};

  const out = {
    complex: {
      aptCode: str(complex.aptCode, 40),
      name: str(complex.name, 100),
      roadAddress: str(complex.roadAddress),
      landAddress: str(complex.landAddress),
    },
    unit: { dongName: str(unit.dongName, 50), hoName: str(unit.hoName, 50) },
    channels: {
      email: str(channels.email, 200),
      telegramChatId: str(channels.telegramChatId, 40),
      ntfyTopic: str(channels.ntfyTopic, 64),
      webhookUrl: str(channels.webhookUrl, 500),
    },
    options: {
      notifyNewNotice: options.notifyNewNotice !== false,
      scheduleReminders: Boolean(options.scheduleReminders),
      minChangePct: Math.min(100, Math.max(0, Number(options.minChangePct) || 0)),
    },
  };

  if (!out.complex.name || !out.unit.dongName || !out.unit.hoName) throw new HttpError(400, "단지·동·호를 모두 선택하세요.");
  const c = out.channels;
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new HttpError(400, "이메일 주소 형식이 올바르지 않습니다.");
  if (c.email && !(config.smtp.host && config.smtp.from)) throw new HttpError(400, "이 서버는 이메일 발송이 설정되지 않았습니다.");
  if (c.telegramChatId && !/^-?\d{3,20}$/.test(c.telegramChatId)) throw new HttpError(400, "텔레그램 chat ID는 숫자여야 합니다.");
  if (c.telegramChatId && !config.telegramBotToken) throw new HttpError(400, "이 서버는 텔레그램 발송이 설정되지 않았습니다.");
  if (c.ntfyTopic && !/^[A-Za-z0-9_-]{6,64}$/.test(c.ntfyTopic)) throw new HttpError(400, "ntfy 토픽은 영문·숫자·-·_ 6~64자로 정하세요.");
  if (c.webhookUrl && !isSafeWebhookUrl(c.webhookUrl)) throw new HttpError(400, "웹훅 주소는 외부 https 주소여야 합니다.");
  if (!c.email && !c.telegramChatId && !c.ntfyTopic && !c.webhookUrl) throw new HttpError(400, "알림 받을 방법을 하나 이상 입력하세요.");
  if (!out.options.notifyNewNotice && !out.options.scheduleReminders) throw new HttpError(400, "받을 알림 종류를 하나 이상 고르세요.");
  return out;
}

function publicSub(sub) {
  const { remindersSent, ...rest } = sub;
  return rest;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, "요청이 너무 큽니다.");
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw new HttpError(400, "JSON 형식이 올바르지 않습니다.");
  }
}

function createApp(config, deps = {}) {
  const api = deps.api || (config.mock ? require("./mock") : require("./realtyprice"));
  const store = deps.store || new Store(config.dataFile);
  const notifier = deps.notifier || createNotifier(config);
  const checker = createChecker({ api, store, notifier, config, log: deps.log || console });

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

  route("GET", /^\/api\/config$/, () => ({
    mock: config.mock,
    defaultSearch: config.defaultSearch,
    defaultRegion: config.defaultRegion,
    channels: { email: notifier.emailEnabled(), telegram: notifier.telegramEnabled(), ntfy: true, webhook: true },
    telegramBotName: config.telegramBotName,
    ntfyServer: config.ntfyServer,
    reminders: config.reminders.map(({ date, title }) => ({ date, title })),
    checkIntervalHours: config.checkIntervalHours,
    lastRunAt: store.getMeta("lastRunAt") || null,
  }));

  route("GET", /^\/api\/complexes$/, async (req, url) => {
    const q = str(url.searchParams.get("q"), 50) || config.defaultSearch;
    const region = url.searchParams.has("region") ? str(url.searchParams.get("region"), 50) : config.defaultRegion;
    if (q === config.defaultSearch && region === config.defaultRegion) return findComplexes(api);
    const list = await api.searchComplexes(q);
    return list.filter((c) => !region || `${c.roadAddress} ${c.landAddress}`.includes(region));
  });

  route("GET", /^\/api\/dongs$/, async (req, url) => {
    const p = url.searchParams;
    return api.listDongs(str(p.get("aptCode")), str(p.get("noticeDate")));
  });

  route("GET", /^\/api\/hos$/, async (req, url) => {
    const p = url.searchParams;
    return api.listHos(str(p.get("aptCode")), str(p.get("noticeDate")), str(p.get("dongCode")));
  });

  route("GET", /^\/api\/history$/, async (req, url) => {
    const p = url.searchParams;
    return api.priceHistory(str(p.get("aptCode")), str(p.get("noticeDate")), str(p.get("dongCode")), str(p.get("hoCode")));
  });

  route("POST", /^\/api\/subscriptions$/, async (req) => {
    if (store.all().length >= config.maxSubscriptions) throw new HttpError(429, "등록 가능한 알림 수를 초과했습니다.");
    const fields = validateSubscription(await readJson(req), config);
    // 지금 공시된 가격은 기준으로만 저장하고, 다음 해 공시부터 알린다.
    const history = await checker.resolveHistory(fields);
    const [latest, previous] = history;
    const sub = store.create({
      ...fields,
      lastNotifiedYear: latest?.year || 0,
      lastPriceWon: latest?.priceWon ?? null,
      lastCheckedAt: new Date().toISOString(),
    });
    const link = `${config.publicUrl}/?manage=${sub.token}`;
    const confirm = latest
      ? priceMessage(sub, latest, previous, link)
      : { title: "[공시가격] 알림 등록 완료", text: "아직 공시된 가격이 없습니다.", link };
    confirm.title = `[알림 등록 완료] ${confirm.title.replace(/^\[공시가격\] /, "")}`;
    confirm.text = `공시가격 알림이 등록되었습니다. 새 공시가격이 발표되면 알려드립니다.\n\n${confirm.text}`;
    const delivery = await notifier.send(sub, confirm);
    store.update(sub.token, { lastDelivery: delivery });
    return { subscription: publicSub(store.get(sub.token)), manageUrl: link, history, delivery };
  });

  route("GET", /^\/api\/subscriptions\/([\w-]+)$/, (req, url, [token]) => {
    const sub = store.get(token);
    if (!sub) throw new HttpError(404, "알림을 찾을 수 없습니다. 이미 해지되었을 수 있습니다.");
    return publicSub(sub);
  });

  route("PUT", /^\/api\/subscriptions\/([\w-]+)$/, async (req, url, [token]) => {
    const sub = store.get(token);
    if (!sub) throw new HttpError(404, "알림을 찾을 수 없습니다.");
    const body = await readJson(req);
    // 세대는 바꾸지 않고 알림 방법·조건만 수정한다.
    const fields = validateSubscription({ ...body, complex: sub.complex, unit: sub.unit }, config);
    return publicSub(store.update(token, { channels: fields.channels, options: fields.options }));
  });

  route("DELETE", /^\/api\/subscriptions\/([\w-]+)$/, (req, url, [token]) => {
    if (!store.remove(token)) throw new HttpError(404, "알림을 찾을 수 없습니다.");
    return { ok: true };
  });

  route("POST", /^\/api\/subscriptions\/([\w-]+)\/test$/, async (req, url, [token]) => {
    const sub = store.get(token);
    if (!sub) throw new HttpError(404, "알림을 찾을 수 없습니다.");
    return notifier.send(sub, {
      title: "[공시가격 알림] 테스트",
      text: `${sub.complex.name} ${sub.unit.dongName} ${sub.unit.hoName} 알림이 정상적으로 연결되었습니다.`,
      link: `${config.publicUrl}/?manage=${sub.token}`,
    });
  });

  route("POST", /^\/api\/admin\/check$/, async (req) => {
    if (!config.adminToken || req.headers.authorization !== `Bearer ${config.adminToken}`) throw new HttpError(401, "관리자 토큰이 필요합니다.");
    api.clearCache();
    return checker.runOnce();
  });

  async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) {
        for (const r of routes) {
          const m = r.method === req.method && url.pathname.match(r.pattern);
          if (m) return sendJson(res, 200, await r.handler(req, url, m.slice(1)));
        }
        throw new HttpError(404, "없는 API입니다.");
      }
      return serveStatic(url.pathname, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return sendJson(res, status, { error: err.message || "서버 오류" });
    }
  }

  return { handle, checker, store, notifier };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function serveStatic(pathname, res) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

if (require.main === module) {
  const config = loadConfig();
  const app = createApp(config);
  http.createServer(app.handle).listen(config.port, () => {
    console.log(`장미아파트 공시가격 알림: ${config.publicUrl} (포트 ${config.port}${config.mock ? ", 모의 데이터" : ""})`);
    console.log(`공시가격 확인 주기: ${config.checkIntervalHours}시간`);
  });
  app.checker.start();
}

module.exports = { createApp, validateSubscription };
