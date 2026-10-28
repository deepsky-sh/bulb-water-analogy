const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const mock = require("../src/mock");
const { createApp } = require("../src/server");
const { Store } = require("../src/store");
const { isSafeWebhookUrl } = require("../src/notifier");
const { parseReminders } = require("../src/config");

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jangmi-"));
  const sent = [];
  const notifier = {
    emailEnabled: () => true,
    telegramEnabled: () => false,
    async send(sub, message) {
      sent.push({ token: sub.token, ...message });
      return [{ channel: "ntfy", ok: true }];
    },
  };
  const config = {
    mock: true,
    publicUrl: "http://test",
    defaultSearch: "장미",
    defaultRegion: "송파구",
    adminToken: "secret",
    maxSubscriptions: 10,
    checkIntervalHours: 6,
    smtp: { host: "smtp.example.com", from: "a@example.com" },
    telegramBotToken: "",
    ntfyServer: "https://ntfy.sh",
    reminders: parseReminders("03-15|열람 시작|본문"),
  };
  const silent = { info() {}, warn() {}, error() {} };
  const app = createApp(config, { api: mock, store: new Store(path.join(dir, "store.json")), notifier, log: silent });
  const server = http.createServer(app.handle);
  return new Promise((resolve) =>
    server.listen(0, () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const call = async (method, p, body, headers = {}) => {
        const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, body: body && JSON.stringify(body) });
        return { status: res.status, body: await res.json() };
      };
      resolve({ app, server, call, sent });
    })
  );
}

test("세대 조회부터 알림 등록, 새 공시 감지, 해지까지", async (t) => {
  mock.setLatestYear(2026);
  const { app, server, call, sent } = await setup();
  t.after(() => server.close());

  const complexes = (await call("GET", "/api/complexes?q=장미")).body;
  assert.deepStrictEqual(complexes.map((c) => c.name), ["장미1차", "장미2차", "장미3차"]);
  const c = complexes[0];
  const dongs = (await call("GET", `/api/dongs?aptCode=${c.aptCode}&noticeDate=${c.noticeDate}`)).body;
  const hos = (await call("GET", `/api/hos?aptCode=${c.aptCode}&noticeDate=${c.noticeDate}&dongCode=${dongs[0].code}`)).body;
  const history = (await call("GET", `/api/history?aptCode=${c.aptCode}&noticeDate=${c.noticeDate}&dongCode=${dongs[0].code}&hoCode=${hos[0].code}`)).body;
  assert.strictEqual(history[0].year, 2026);

  const bad = await call("POST", "/api/subscriptions", { complex: c, unit: { dongName: dongs[0].name, hoName: hos[0].name }, channels: {} });
  assert.strictEqual(bad.status, 400);

  const created = await call("POST", "/api/subscriptions", {
    complex: c,
    unit: { dongName: dongs[0].name, hoName: hos[0].name },
    channels: { ntfyTopic: "jangmi-test-topic" },
    options: { notifyNewNotice: true, scheduleReminders: true },
  });
  assert.strictEqual(created.status, 200, JSON.stringify(created.body));
  const token = created.body.subscription.token;
  assert.strictEqual(created.body.subscription.lastNotifiedYear, 2026);
  assert.match(sent.at(-1).title, /알림 등록 완료/);

  // 같은 해에는 다시 알리지 않는다.
  sent.length = 0;
  await app.checker.checkPrices();
  assert.strictEqual(sent.length, 0);

  // 다음 해 공시가 올라오면 한 번만 알린다.
  mock.setLatestYear(2027);
  await app.checker.checkPrices();
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].title, /2027년/);
  assert.match(sent[0].text, /전년\(2026\) 대비/);
  await app.checker.checkPrices();
  assert.strictEqual(sent.length, 1);

  // 일정 알림은 해당 날짜에 한 번만.
  assert.strictEqual(await app.checker.sendReminders("2027-03-15"), 1);
  assert.strictEqual(await app.checker.sendReminders("2027-03-15"), 0);
  assert.strictEqual(await app.checker.sendReminders("2027-03-16"), 0);

  const updated = await call("PUT", `/api/subscriptions/${token}`, { channels: { webhookUrl: "https://hooks.slack.com/services/x" }, options: { notifyNewNotice: true } });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.channels.webhookUrl, "https://hooks.slack.com/services/x");
  assert.strictEqual(updated.body.channels.ntfyTopic, "");

  assert.strictEqual((await call("POST", "/api/admin/check")).status, 401);
  assert.strictEqual((await call("POST", "/api/admin/check", null, { Authorization: "Bearer secret" })).status, 200);

  assert.strictEqual((await call("DELETE", `/api/subscriptions/${token}`)).status, 200);
  assert.strictEqual((await call("GET", `/api/subscriptions/${token}`)).status, 404);
});

test("변동률 기준 미만이면 알리지 않는다", async (t) => {
  mock.setLatestYear(2027);
  const { app, server, call, sent } = await setup();
  t.after(() => server.close());
  const [c] = (await call("GET", "/api/complexes?q=장미")).body;
  await call("POST", "/api/subscriptions", {
    complex: c,
    unit: { dongName: "11동", hoName: "101호" },
    channels: { ntfyTopic: "jangmi-threshold" },
    options: { minChangePct: 50 },
  });
  sent.length = 0;
  mock.setLatestYear(2028); // 2027→2028 약 4% 상승
  await app.checker.checkPrices();
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(app.store.all()[0].lastNotifiedYear, 2028);
});

test("웹훅 주소 검사", () => {
  assert.ok(isSafeWebhookUrl("https://discord.com/api/webhooks/1/abc"));
  assert.ok(!isSafeWebhookUrl("http://discord.com/api/webhooks/1/abc"));
  assert.ok(!isSafeWebhookUrl("https://localhost/x"));
  assert.ok(!isSafeWebhookUrl("https://127.0.0.1/x"));
  assert.ok(!isSafeWebhookUrl("https://192.168.0.10/x"));
  assert.ok(!isSafeWebhookUrl("https://[::1]/x"));
});

test("공시가격 사이트 표기 정규화", async () => {
  const { label, sameName, display, findComplexes } = require("../src/jangmi");
  assert.strictEqual(label("장미아파트(장미1)"), "장미1차");
  assert.strictEqual(label("장미3차맨션(장미3)"), "장미3차");
  assert.ok(sameName("22", "22동"));
  assert.ok(sameName("1동", "1"));
  assert.ok(sameName("101", "101호"));
  assert.strictEqual(display("22", "동"), "22동");
  const fake = {
    async searchComplexes(q) {
      return [
        { aptCode: "9", name: "장미아파트(장미1)", roadAddress: "서울특별시 용산구", landAddress: "서울특별시 용산구 한남동" },
        { aptCode: "2369", name: "장미아파트(장미1)", roadAddress: "서울특별시 송파구 올림픽로35길 104", landAddress: "서울특별시 송파구 신천동 7" },
        { aptCode: "2370", name: "장미3차맨션(장미3)", roadAddress: "서울특별시 송파구 올림픽로35길 94", landAddress: "서울특별시 송파구 신천동 11" },
      ].filter((c) => c.name.includes(q.slice(-1)));
    },
  };
  const found = await findComplexes(fake);
  assert.deepStrictEqual(found.map((c) => [c.name, c.aptCode]), [["장미1차", "2369"], ["장미3차", "2370"]]);
});
