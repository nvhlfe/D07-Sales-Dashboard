// ─────────────────────────────────────────────────────────────────
// ⑲ CHẨN ĐOÁN TVV CHƯA ACTIVE — logic thuần (test bằng node độc lập).
// Mục tiêu (Lan chốt 14/11/2026): phân tích dữ liệu để ĐẨY TVV chưa
// active — tách người chưa đạt mốc thành 3 nhóm nguyên nhân, mỗi nhóm
// một cách can thiệp khác nhau, kèm tổng hợp theo Unit.
//
// Chuẩn tính (ghi rõ trên UI):
//  - Active = IP PHÁT HÀNH RÒNG của tháng ≥ 15 triệu (số ròng theo
//    Sổ Sản Lượng: phát hành gộp − CF liên tháng, từ Daily mới nhất).
//  - Mỗi TVV chưa Active thuộc đúng 1 nhóm, theo thứ tự ưu tiên:
//      1) chuaNop    — chưa có hồ sơ nào trong tháng (IF/PS/Pipeline đều 0)
//      2) ketPending — có hồ sơ đang chờ xử lý (đẩy pending là hướng chính)
//      3) nopThua    — đã nộp/phát hành nhưng nhịp chưa đủ tới mốc
//  - quaMocNeuThong: IP ròng + giá trị hồ sơ đang chờ ≥ 15tr — nếu các
//    hồ sơ chờ được phát hành hết thì TVV qua mốc Active.
// Đơn vị tiền: triệu đồng.
// ─────────────────────────────────────────────────────────────────

export const ACTIVE_IP_THRESHOLD = 15 // triệu đồng IP phát hành ròng / tháng

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * roster: [{ msdl, name, unit }] — danh sách TVV chuẩn (AG-PE + Daily).
 * analysisAgents: agents[] từ analyzeSoSanLuong (có metrics + detail).
 * Trả { total, activeCount, groups: {chuaNop[], ketPending[], nopThua[]},
 *       byUnit: [{unit, chuaNop, ketPending, nopThua, total, active, activePct}] }
 */
export function diagnoseActivation(roster, analysisAgents) {
  const byMsdl = new Map()
  ;(analysisAgents || []).forEach((a) => { if (a.msdl) byMsdl.set(String(a.msdl), a) })

  const seen = new Set()
  const members = []
  const pushPerson = (msdl, name, unit) => {
    const key = String(msdl || '')
    if (!key || seen.has(key)) return
    seen.add(key)
    const a = byMsdl.get(key)
    const m = a?.metrics || {}
    const netIp = num(m.netIp)
    members.push({
      msdl: key,
      name: (a?.name || name || ''),
      unit: (a?.unit || unit || ''),
      netIp,
      subIp: num(m.subIp), subN: num(m.subN),
      pipeN: num(m.pipeN), pipeApe: num(m.pipeApe),
      pendN: num(m.pendN), pendIp: num(m.pendIp),
      nopN: num(m.nopN),
      active: netIp >= ACTIVE_IP_THRESHOLD,
      thieu: Math.max(0, ACTIVE_IP_THRESHOLD - netIp),
      quaMocNeuThong: netIp < ACTIVE_IP_THRESHOLD && (netIp + num(m.pendIp)) >= ACTIVE_IP_THRESHOLD,
    })
  }
  ;(roster || []).forEach((r) => pushPerson(r.msdl, r.name, r.unit))
  // TVV có hoạt động trong Daily nhưng không có trong danh sách chuẩn vẫn tính
  ;(analysisAgents || []).forEach((a) => pushPerson(a.msdl, a.name, a.unit))

  const groups = { chuaNop: [], ketPending: [], nopThua: [] }
  let activeCount = 0
  members.forEach((p) => {
    if (p.active) { activeCount += 1; return }
    if (p.nopN === 0 && p.pendN === 0) groups.chuaNop.push(p)
    else if (p.pendN > 0) groups.ketPending.push(p)
    else groups.nopThua.push(p)
  })
  const byThieu = (x, y) => x.thieu - y.thieu || y.netIp - x.netIp
  groups.ketPending.sort(byThieu)
  groups.nopThua.sort(byThieu)
  groups.chuaNop.sort((x, y) => String(x.name).localeCompare(String(y.name), 'vi'))

  const unitMap = new Map()
  members.forEach((p) => {
    const unit = p.unit || '—'
    if (!unitMap.has(unit)) unitMap.set(unit, { unit, chuaNop: 0, ketPending: 0, nopThua: 0, total: 0, active: 0 })
    const u = unitMap.get(unit)
    u.total += 1
    if (p.active) u.active += 1
  })
  groups.chuaNop.forEach((p) => { unitMap.get(p.unit || '—').chuaNop += 1 })
  groups.ketPending.forEach((p) => { unitMap.get(p.unit || '—').ketPending += 1 })
  groups.nopThua.forEach((p) => { unitMap.get(p.unit || '—').nopThua += 1 })
  const byUnit = [...unitMap.values()]
    .map((u) => ({ ...u, activePct: u.total ? Math.round((u.active / u.total) * 1000) / 10 : 0 }))
    .sort((a, b) => (b.chuaNop + b.ketPending + b.nopThua) - (a.chuaNop + a.ketPending + a.nopThua))

  return { total: members.length, activeCount, groups, byUnit }
}
