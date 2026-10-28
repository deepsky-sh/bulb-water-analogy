// 알림 구독을 JSON 파일 하나에 저장한다. 구독자가 수백 명 규모일 때를 가정한 단순 저장소.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class Store {
  constructor(file) {
    this.file = file;
    this.data = { subscriptions: [], meta: {} };
    if (fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, "utf8"));
      this.data.subscriptions ||= [];
      this.data.meta ||= {};
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  all() {
    return this.data.subscriptions;
  }

  get(token) {
    return this.data.subscriptions.find((s) => s.token === token) || null;
  }

  create(fields) {
    const now = new Date().toISOString();
    const sub = { ...fields, token: crypto.randomBytes(18).toString("base64url"), createdAt: now, updatedAt: now };
    this.data.subscriptions.push(sub);
    this.save();
    return sub;
  }

  update(token, fields) {
    const sub = this.get(token);
    if (!sub) return null;
    Object.assign(sub, fields, { updatedAt: new Date().toISOString() });
    this.save();
    return sub;
  }

  remove(token) {
    const before = this.data.subscriptions.length;
    this.data.subscriptions = this.data.subscriptions.filter((s) => s.token !== token);
    if (this.data.subscriptions.length === before) return false;
    this.save();
    return true;
  }

  getMeta(key) {
    return this.data.meta[key];
  }

  setMeta(key, value) {
    this.data.meta[key] = value;
    this.save();
  }
}

module.exports = { Store };
