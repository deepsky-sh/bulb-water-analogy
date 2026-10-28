// 알림 채널: 이메일(SMTP), 텔레그램, ntfy(휴대폰 푸시), 웹훅(디스코드·슬랙·기타).

const net = require("node:net");

function createNotifier(config) {
  let transport = null;

  function emailEnabled() {
    return Boolean(config.smtp.host && config.smtp.from);
  }

  function telegramEnabled() {
    return Boolean(config.telegramBotToken);
  }

  async function sendEmail(to, title, text) {
    if (!emailEnabled()) throw new Error("서버에 SMTP가 설정되지 않아 이메일을 보낼 수 없습니다.");
    if (!transport) {
      const nodemailer = require("nodemailer");
      transport = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      });
    }
    await transport.sendMail({ from: config.smtp.from, to, subject: title, text });
  }

  async function sendTelegram(chatId, title, text) {
    if (!telegramEnabled()) throw new Error("서버에 텔레그램 봇 토큰이 설정되지 않았습니다.");
    await postJson(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      chat_id: chatId,
      text: `${title}\n\n${text}`,
      disable_web_page_preview: true,
    });
  }

  async function sendNtfy(topic, title, text, link) {
    const headers = { Title: encodeHeader(title), Tags: "house" };
    if (link) headers.Click = link;
    const res = await fetch(`${config.ntfyServer.replace(/\/$/, "")}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers,
      body: text,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`ntfy 전송 실패: HTTP ${res.status}`);
  }

  async function sendWebhook(url, title, text) {
    const host = new URL(url).hostname;
    let payload;
    if (/discord(app)?\.com$/.test(host)) payload = { content: `**${title}**\n${text}` };
    else if (host === "hooks.slack.com") payload = { text: `*${title}*\n${text}` };
    else payload = { title, text };
    await postJson(url, payload);
  }

  // message: { title, text, link }
  async function send(sub, message) {
    const ch = sub.channels || {};
    const jobs = [];
    if (ch.email) jobs.push(["email", () => sendEmail(ch.email, message.title, withLink(message))]);
    if (ch.telegramChatId) jobs.push(["telegram", () => sendTelegram(ch.telegramChatId, message.title, withLink(message))]);
    if (ch.ntfyTopic) jobs.push(["ntfy", () => sendNtfy(ch.ntfyTopic, message.title, message.text, message.link)]);
    if (ch.webhookUrl) jobs.push(["webhook", () => sendWebhook(ch.webhookUrl, message.title, withLink(message))]);

    const results = await Promise.allSettled(jobs.map(([, fn]) => fn()));
    return results.map((r, i) => ({
      channel: jobs[i][0],
      ok: r.status === "fulfilled",
      error: r.status === "rejected" ? r.reason.message : undefined,
    }));
  }

  return { send, emailEnabled, telegramEnabled };
}

function withLink({ text, link }) {
  return link ? `${text}\n\n알림 설정 변경·해지: ${link}` : text;
}

// HTTP 헤더에는 ASCII만 들어가므로 ntfy가 지원하는 RFC 2047 형식으로 감싼다.
function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`전송 실패: HTTP ${res.status}`);
}

// 사용자가 입력한 웹훅 주소로 서버가 요청을 보내므로 내부망 주소는 막는다.
function isSafeWebhookUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (net.isIP(host)) {
    return !/^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|f[cd]|fe80)/.test(host);
  }
  return host.includes(".");
}

module.exports = { createNotifier, isSafeWebhookUrl };
