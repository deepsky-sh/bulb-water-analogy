// 임시 진단: 실제 단지·동·호·가격 조회 확인
const api = require("../src/realtyprice");
(async () => {
  const seen = new Map();
  for (const q of ["장미1", "장미2", "장미3", "장미아파트(장미3)", "잠실장미"]) {
    const list = await api.searchComplexes(q);
    const sp = list.filter((c) => /송파구/.test(c.landAddress + c.roadAddress));
    console.log(`== "${q}": n=${list.length}, 송파=${sp.map((c) => `${c.name}[${c.aptCode}] ${c.landAddress}`).join(" / ")}`);
    for (const c of sp) seen.set(c.aptCode, c);
  }
  for (const c of seen.values()) {
    const dongs = await api.listDongs(c.aptCode, c.noticeDate);
    console.log(`## ${c.name} ${c.aptCode} notice=${c.noticeDate} 동 ${dongs.length}개: ${dongs.map((d) => `${d.name}(${d.code})`).join(", ")}`);
    if (!dongs.length) continue;
    const hos = await api.listHos(c.aptCode, c.noticeDate, dongs[0].code);
    console.log(`   ${dongs[0].name} 호 ${hos.length}개: ${hos.slice(0, 6).map((h) => `${h.name}(${h.code})`).join(", ")}`);
    if (!hos.length) continue;
    const hist = await api.priceHistory(c.aptCode, c.noticeDate, dongs[0].code, hos[0].code);
    console.log(`   ${hos[0].name} 이력: ${hist.map((h) => `${h.year}=${h.priceWon}/${h.areaSqm}㎡/${h.noticeDate}`).join(", ")}`);
  }
})().catch((e) => { console.error("PROBE ERROR", e); process.exit(1); });
