const path = require("node:path");
const fs = require("node:fs");

// .env 파일이 있으면 읽는다(외부 패키지 없이 KEY=VALUE 형식만 지원).
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

function parseReminders(value) {
  // "MM-DD|제목|본문;MM-DD|제목|본문"
  return value
    .split(";")
    .map((item) => item.split("|").map((s) => s.trim()))
    .filter(([date, title]) => /^\d{2}-\d{2}$/.test(date) && title)
    .map(([date, title, text]) => ({ date, title, text: text || title }));
}

const DEFAULT_REMINDERS = [
  "03-15|공시가격(안) 열람 시작 즈음입니다|매년 3월 중순 국토교통부가 공동주택 공시가격(안)을 공개하고 약 3주간 소유자 의견을 받습니다. 열람 기간과 의견 제출 마감일을 확인하세요.",
  "04-29|공시가격 결정·공시 예정일 즈음입니다|매년 4월 말 공동주택 공시가격이 결정·공시되고 약 한 달간 이의신청을 받습니다. 공시되면 이 사이트가 확정 가격을 따로 알려드립니다.",
].join(";");

function loadConfig(root = path.join(__dirname, "..")) {
  loadDotEnv(path.join(root, ".env"));
  const env = process.env;
  const port = Number(env.PORT) || 3000;
  return {
    port,
    publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, ""),
    dataFile: path.resolve(root, env.DATA_FILE || "data/store.json"),
    mock: env.REALTYPRICE_MOCK === "1",
    checkIntervalHours: Number(env.CHECK_INTERVAL_HOURS) || 6,
    defaultSearch: env.DEFAULT_SEARCH || "장미",
    defaultRegion: env.DEFAULT_REGION || "송파구",
    adminToken: env.ADMIN_TOKEN || "",
    maxSubscriptions: Number(env.MAX_SUBSCRIPTIONS) || 500,
    smtp: {
      host: env.SMTP_HOST || "",
      port: Number(env.SMTP_PORT) || 587,
      user: env.SMTP_USER || "",
      pass: env.SMTP_PASS || "",
      from: env.SMTP_FROM || env.SMTP_USER || "",
    },
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || "",
    telegramBotName: env.TELEGRAM_BOT_NAME || "",
    ntfyServer: env.NTFY_SERVER || "https://ntfy.sh",
    reminders: parseReminders(env.REMINDERS || DEFAULT_REMINDERS),
  };
}

module.exports = { loadConfig, parseReminders };
