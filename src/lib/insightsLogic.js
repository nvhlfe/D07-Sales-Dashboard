// ─────────────────────────────────────────────────────────────────
// Logic thuần cho tab Điều Hành (Insights) — gom từ dữ liệu sẵn có:
// Compensation (monthlyKpis, agList, umList), Sales Report (reports),
// ManMark (commits). Không phụ thuộc React/Firebase để test được.
// Đơn vị tiền: FYP/FYC theo triệu VND (như monthlyKpis/agList);
// phí hồ sơ Sales Report theo VND (chia 1e6 khi hiển thị triệu).
// ─────────────────────────────────────────────────────────────────

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * Nhịp độ tháng: so % đạt mục tiêu với % thời gian đã trôi qua.
 * - Tháng quá khứ: elapsedPct = 100; tháng tương lai: 0; tháng hiện tại: theo ngày.
 * - verdict: 'no-target' | 'done' (quá khứ đạt) | 'missed' (quá khứ trượt)
 *   | 'ahead' (đang nhanh hơn nhịp) | 'ontrack' (lệch ≤5 điểm %) | 'behind'.
 * - projected: ước cuối tháng theo nhịp hiện tại (chỉ tháng hiện tại).
 * - perDayNeeded: số cần đạt mỗi ngày còn lại để về đích (tháng hiện tại).
 */
export function monthPace({ actual, target, year, month, today }) {
  const dim = daysInMonth(year, month)
  const t = today || new Date()
  const curY = t.getFullYear(), curM = t.getMonth() + 1, curD = t.getDate()
  let phase, elapsedPct, dayIdx
  if (year < curY || (year === curY && month < curM)) { phase = 'past'; elapsedPct = 100; dayIdx = dim }
  else if (year > curY || (year === curY && month > curM)) { phase = 'future'; elapsedPct = 0; dayIdx = 0 }
  else { phase = 'current'; dayIdx = curD; elapsedPct = (curD / dim) * 100 }

  const act = num(actual), tgt = num(target)
  const donePct = tgt > 0 ? (act / tgt) * 100 : null
  const paceDiff = donePct === null ? null : donePct - elapsedPct

  let verdict
  if (donePct === null) verdict = 'no-target'
  else if (phase === 'past') verdict = donePct >= 100 ? 'done' : 'missed'
  else if (paceDiff >= 0) verdict = 'ahead'
  else if (paceDiff >= -5) verdict = 'ontrack'
  else verdict = 'behind'

  const projected = phase === 'current' && dayIdx > 0 ? (act / dayIdx) * dim : null
  const remaining = tgt > 0 ? Math.max(tgt - act, 0) : 0
  const daysLeft = phase === 'current' ? dim - dayIdx : 0
  const perDayNeeded = daysLeft > 0 && tgt > 0 ? remaining / daysLeft : null

  return {
    phase, daysInMonth: dim, dayIdx, elapsedPct,
    actual: act, target: tgt, donePct, paceDiff, verdict,
    projected, remaining, daysLeft, perDayNeeded,
  }
}

/** Phễu hồ sơ 1 tháng từ mảng person của Sales Report. */
export function funnelStats(persons) {
  const out = {
    total: 0, totalFee: 0,
    cf: { n: 0, fee: 0 },  // 'none'  — Có phí/Chưa phí (CF)
    cp: { n: 0, fee: 0 },  // 'paid'  — Pending (CP)
    ph: { n: 0, fee: 0 },  // 'issued'— Phát hành (PH)
  }
  ;(persons || []).forEach((p) => {
    Object.values(p.daily || {}).forEach((day) => {
      ;(day?.cases || []).forEach((c) => {
        const fee = num(c.fee)
        out.total += 1; out.totalFee += fee
        const bucket = c.status === 'issued' ? out.ph : c.status === 'paid' ? out.cp : out.cf
        bucket.n += 1; bucket.fee += fee
      })
    })
  })
  out.convIssued = out.total > 0 ? (out.ph.n / out.total) * 100 : 0
  out.feeIssuedShare = out.totalFee > 0 ? (out.ph.fee / out.totalFee) * 100 : 0
  return out
}

// Xếp hạng bậc PE — đồng bộ TVVTab/UMTab (KC=3, BK=2, V=1, khác=0)
export function peRankOf(val) {
  const v = String(val || '').toUpperCase()
  if (v.includes('KIM CƯƠNG')) return 3
  if (v.includes('BẠCH KIM')) return 2
  if (v.includes('VÀNG') || v.includes('VANG')) return 1
  return 0
}

/** Thống kê theo Unit từ agList (AG-PE). Trả về mảng sắp xếp FYC quý giảm dần. */
export function unitStats(agList) {
  const map = new Map()
  ;(agList || []).forEach((a) => {
    const unit = String(a.unit || '').trim() || '—'
    if (!map.has(unit)) map.set(unit, {
      unit, tvv: 0, activeFyc: 0, fycQuy: 0, fycL12m: 0,
      peKC: 0, peBK: 0, peV: 0, peDat: 0,
    })
    const u = map.get(unit)
    u.tvv += 1
    const f = num(a.fyc)
    if (f > 0) u.activeFyc += 1
    u.fycQuy += f
    u.fycL12m += num(a.fyc12m)
    const r = peRankOf(a.peHienTai)
    if (r === 3) u.peKC += 1
    else if (r === 2) u.peBK += 1
    else if (r === 1) u.peV += 1
    if (r >= 1) u.peDat += 1
  })
  const rows = [...map.values()].map((u) => ({ ...u, avgFyc: u.tvv > 0 ? u.fycQuy / u.tvv : 0 }))
  rows.sort((a, b) => b.fycQuy - a.fycQuy)
  return rows
}

/** TVV sắp đạt PE: còn thiếu FYC (pe_fycCanThem) trong (0, maxGap] triệu. */
export function nearPEList(agList, maxGap = 2, limit = 8) {
  return (agList || [])
    .map((a) => ({ name: a.agentName || '', msddl: a.msddl || '', unit: a.unit || '', gap: num(a.pe_fycCanThem), peHienTai: a.peHienTai || '' }))
    .filter((x) => x.gap > 0 && x.gap <= maxGap)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, limit)
}

/** TVV chưa có FYC trong quý (theo AG-PE): đếm + vài tên đầu. */
export function zeroFycAgents(agList, limit = 6) {
  const list = (agList || []).filter((a) => num(a.fyc) <= 0)
  return {
    count: list.length,
    names: list.slice(0, limit).map((a) => a.agentName || a.msddl || ''),
  }
}

/** Top N theo 1 trường số. */
export function topBy(list, key, limit = 5) {
  return [...(list || [])].sort((a, b) => num(b[key]) - num(a[key])).slice(0, limit)
}
