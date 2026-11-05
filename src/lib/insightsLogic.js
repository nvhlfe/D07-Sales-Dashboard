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

// ─────────────────────────────────────────────────────────────────
// DAILY SALES — mỗi doc daily_sales_tvv/{yyyy-mm-dd} là SNAPSHOT LŨY KẾ
// từ đầu tháng tới ngày đó (agents/units/proposalRows đều lũy kế).
// Vì vậy: trạng thái hiện tại = doc MỚI NHẤT; "tăng thêm" = hiệu 2 doc.
// ─────────────────────────────────────────────────────────────────

const dayMs = 86400000
const isoToMs = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return Date.UTC(y, (m || 1) - 1, d || 1) }

function docGaCum(data) {
  const agents = Object.values(data?.agents || {})
  return {
    fyp: agents.reduce((s, a) => s + num(a.fyp), 0),
    fyc: agents.reduce((s, a) => s + num(a.fyc), 0),
    ipNet: agents.reduce((s, a) => s + num(a.ipNet), 0),
    caseNet: agents.reduce((s, a) => s + num(a.caseNet), 0),
    activeAgents: agents.filter((a) => num(a.fyp) > 0 || num(a.fyc) > 0 || num(a.ipNet) > 0).length,
  }
}

function docUnitCum(data) {
  // FYP/FYC theo Unit cộng từ agents (sheet Leader không có FYP/FYC)
  const map = new Map()
  Object.values(data?.agents || {}).forEach((a) => {
    const unit = String(a.unit || '').trim() || '—'
    if (!map.has(unit)) map.set(unit, { fyp: 0, fyc: 0 })
    const u = map.get(unit)
    u.fyp += num(a.fyp); u.fyc += num(a.fyc)
  })
  return map
}

/**
 * Tổng hợp Daily Sales của 1 tháng từ danh sách doc (mảng {id, data}).
 * Trả về trạng thái lũy kế mới nhất + chuỗi tăng thêm + thống kê theo Unit
 * + proposal/pipeline của snapshot mới nhất.
 */
export function aggregateDailyMonth(docs) {
  const sorted = [...(docs || [])].filter((d) => d?.id).sort((a, b) => (a.id < b.id ? -1 : 1))
  if (!sorted.length) return null
  const latest = sorted[sorted.length - 1]
  const latestData = latest.data || {}

  // Chuỗi lũy kế toàn GA + tăng thêm từng snapshot
  const cumSeries = sorted.map((d) => ({ date: d.id, ...docGaCum(d.data) }))
  const increments = cumSeries.map((c, i) => ({
    date: c.date,
    fyp: i === 0 ? c.fyp : c.fyp - cumSeries[i - 1].fyp,
    fyc: i === 0 ? c.fyc : c.fyc - cumSeries[i - 1].fyc,
  }))

  // Unit: nền từ units (Leader) của doc mới nhất, FYP/FYC cộng từ agents
  const unitMap = new Map()
  const ensure = (unit) => {
    if (!unitMap.has(unit)) unitMap.set(unit, {
      unit, leaderName: '', manpower: 0,
      fyp: 0, fyc: 0, ipSub: 0, ipNet: 0, caseSub: 0, caseNet: 0,
      cIF: 0, cPS: 0, cOther: 0, psIp: 0, ifIp: 0,
      tvvCoSo: 0, trendPct: null, delta7: 0,
    })
    return unitMap.get(unit)
  }
  Object.values(latestData.units || {}).forEach((u) => {
    const row = ensure(String(u.unit || '').trim() || '—')
    row.leaderName = u.leaderName || ''
    row.manpower = num(u.manpower)
    row.ipSub = num(u.ipSubUnit); row.ipNet = num(u.ipNetUnit)
    row.caseSub = num(u.caseSubUnit); row.caseNet = num(u.caseNetUnit)
    row.cIF = num(u.cIF); row.cPS = num(u.cPS); row.cOther = num(u.cOther)
  })
  Object.values(latestData.agents || {}).forEach((a) => {
    const row = ensure(String(a.unit || '').trim() || '—')
    row.fyp += num(a.fyp); row.fyc += num(a.fyc)
    if (num(a.fyp) > 0 || num(a.fyc) > 0 || num(a.ipNet) > 0) row.tvvCoSo += 1
    if (!latestData.units) { row.ipSub += num(a.ipSub); row.ipNet += num(a.ipNet); row.caseSub += num(a.caseSub); row.caseNet += num(a.caseNet) }
  })
  // IP theo trạng thái hồ sơ (proposal của snapshot mới nhất)
  ;(latestData.proposalRows || []).forEach((p) => {
    const row = ensure(String(p.unit || '').trim() || '—')
    if (p.statusGroup === 'IF') row.ifIp += num(p.ipSub)
    else if (p.statusGroup === 'PS') row.psIp += num(p.ipSub)
  })
  // APE Pipeline đang chờ theo Unit (để tính kỳ vọng phát hành theo Unit)
  ;(latestData.pipelineRows || []).forEach((p) => {
    const row = ensure(String(p.unit || '').trim() || '—')
    row.pipeApe = (row.pipeApe || 0) + num(p.ape)
    row.pipeN = (row.pipeN || 0) + 1
  })

  // Xu hướng 7 ngày theo Unit: tăng FYP 7 ngày gần nhất vs 7 ngày trước đó
  const latestMs = isoToMs(latest.id)
  const cumAt = (msLimit) => {
    let best = null
    for (const d of sorted) { if (isoToMs(d.id) <= msLimit) best = d; else break }
    return best ? docUnitCum(best.data) : new Map()
  }
  const cumNow = docUnitCum(latestData)
  const cum7 = cumAt(latestMs - 7 * dayMs)
  const cum14 = cumAt(latestMs - 14 * dayMs)
  unitMap.forEach((row, unit) => {
    const v0 = cumNow.get(unit)?.fyp || 0
    const v7 = cum7.get(unit)?.fyp || 0
    const v14 = cum14.get(unit)?.fyp || 0
    const d7 = v0 - v7
    const dPrev = v7 - v14
    row.delta7 = d7
    row.trendPct = sorted.length >= 2 && cum7.size ? (dPrev > 0 ? (d7 / dPrev - 1) * 100 : (d7 > 0 ? 100 : null)) : null
    const hs = row.cIF + row.cPS + row.cOther
    row.hsNop = hs
    row.pctIF = hs > 0 ? (row.cIF / hs) * 100 : null
  })
  const units = [...unitMap.values()].sort((a, b) => b.fyp - a.fyp)

  // Proposal + Pipeline toàn GA (snapshot mới nhất)
  const props = latestData.proposalRows || []
  const byGroup = (g) => props.filter((p) => p.statusGroup === g)
  const ifRows = byGroup('IF'), psRows = byGroup('PS'), otherRows = byGroup('OTHER')
  const ifIp = ifRows.reduce((s, p) => s + num(p.ipSub), 0)
  const psIp = psRows.reduce((s, p) => s + num(p.ipSub), 0)
  const proposals = {
    total: props.length, ifN: ifRows.length, psN: psRows.length, otherN: otherRows.length,
    ifIp, psIp,
    convCount: props.length > 0 ? (ifRows.length / props.length) * 100 : 0,
    convValue: (ifIp + psIp) > 0 ? (ifIp / (ifIp + psIp)) * 100 : 0,
  }
  const pipelineRows = latestData.pipelineRows || []
  const pendingRows = latestData.pendingRows || []
  const pipeline = { n: pipelineRows.length, ape: pipelineRows.reduce((s, p) => s + num(p.ape), 0) }
  const pending = { n: pendingRows.length, ape: pendingRows.reduce((s, p) => s + num(p.ape), 0) }

  const totals = cumSeries[cumSeries.length - 1]
  // Tăng thêm 7 ngày gần nhất (toàn GA)
  const gaCumAt = (msLimit) => {
    let best = null
    for (let i = 0; i < sorted.length; i++) { if (isoToMs(sorted[i].id) <= msLimit) best = cumSeries[i]; else break }
    return best
  }
  const prev7 = gaCumAt(latestMs - 7 * dayMs)
  const delta7 = prev7 ? totals.fyp - prev7.fyp : totals.fyp

  return {
    latestDate: latest.id, docCount: sorted.length,
    cumSeries, increments, units, totals, proposals, pipeline, pending,
    delta7,
  }
}

/**
 * Dự toán cuối tháng từ Daily Sales:
 * - theoNhịp: lũy kế ÷ ngày đã qua × số ngày tháng (model nhịp chuẩn).
 * - theoMA7: lũy kế + (tăng TB/ngày của 7 ngày gần nhất) × ngày còn lại.
 * - kỳ vọng phát hành thêm từ PS + Pipeline theo tỷ lệ chuyển đổi giá trị của tháng.
 */
export function forecastFromDaily(agg, { year, month, today }) {
  if (!agg) return null
  const dim = daysInMonth(year, month)
  const latestDay = Number(String(agg.latestDate).slice(8, 10)) || 0
  const cum = agg.totals.fyp
  const theoNhip = latestDay > 0 ? (cum / latestDay) * dim : null
  const avg7 = agg.delta7 / 7
  const daysLeft = Math.max(dim - latestDay, 0)
  const theoMA7 = cum + avg7 * daysLeft
  const conv = agg.proposals.convValue / 100
  const choPhatHanh = agg.proposals.psIp + agg.pipeline.ape
  const kyVongPhatHanhThem = choPhatHanh * conv
  return {
    cum, latestDay, daysInMonth: dim, daysLeft,
    theoNhip, theoMA7, avg7,
    convValue: agg.proposals.convValue,
    choPhatHanh, kyVongPhatHanhThem,
  }
}

// ─────────────────────────────────────────────────────────────────
// KỸ THUẬT ÁP TỪ MANMARK: tỷ lệ chuyển đổi từ lịch sử THẬT (reports
// các tháng đã qua) — issuedSum/totalSum theo phí. Ngưỡng tin cậy:
// Unit ≥ 15 hồ sơ trong lịch sử; thiếu thì lùi về toàn GA; vẫn thiếu
// thì dùng mặc định 50% (giống hằng số của ManMark).
// ─────────────────────────────────────────────────────────────────
export const CONV_MIN_UNIT = 15
export const CONV_DEFAULT_RATE = 0.5

/**
 * monthsPersons: mảng (theo tháng đã qua) các mảng person của Sales Report.
 * unitOf(person): hàm trả unit của 1 person (để map đúng mã Unit).
 * Trả { byUnit: { [unit]: {rate, sample} }, ga: {rate, sample} }.
 */
export function buildConversionRates(monthsPersons, unitOf) {
  const byUnit = {}
  const ga = { issuedSum: 0, totalSum: 0, issuedCount: 0, totalCount: 0 }
  ;(monthsPersons || []).forEach((persons) => {
    ;(persons || []).forEach((p) => {
      if (!p?.daily) return
      const unit = String(unitOf ? unitOf(p) : p.group || '').trim() || '—'
      if (!byUnit[unit]) byUnit[unit] = { issuedSum: 0, totalSum: 0, issuedCount: 0, totalCount: 0 }
      const u = byUnit[unit]
      Object.values(p.daily).forEach((d) => {
        ;(d?.cases || []).forEach((c) => {
          const fee = num(c.fee)
          u.totalSum += fee; u.totalCount++
          ga.totalSum += fee; ga.totalCount++
          if (c.status === 'issued') {
            u.issuedSum += fee; u.issuedCount++
            ga.issuedSum += fee; ga.issuedCount++
          }
        })
      })
    })
  })
  const finish = (x) => ({ rate: x.totalSum > 0 ? x.issuedSum / x.totalSum : null, sample: x.totalCount })
  const out = { byUnit: {}, ga: finish(ga) }
  Object.entries(byUnit).forEach(([unit, x]) => { out.byUnit[unit] = finish(x) })
  return out
}

/** Lấy tỷ lệ chuyển đổi áp cho 1 Unit theo chuỗi fallback của ManMark. */
export function conversionRateFor(index, unit) {
  const u = index?.byUnit?.[unit]
  if (u && u.sample >= CONV_MIN_UNIT && u.rate !== null) return { rate: u.rate, source: 'unit', sample: u.sample }
  const ga = index?.ga
  if (ga && ga.sample >= CONV_MIN_UNIT && ga.rate !== null) return { rate: ga.rate, source: 'ga', sample: ga.sample }
  return { rate: CONV_DEFAULT_RATE, source: 'default', sample: u?.sample || 0 }
}

/**
 * Kịch bản về đích (phong cách tính kịch bản của các công cụ hoạch định):
 * - upliftPct: % cần tăng tốc so với nhịp 7 ngày để vừa đạt mục tiêu.
 * - finishDate: ngày dự kiến chạm mục tiêu nếu giữ nhịp 7 ngày (null nếu quá tháng).
 * - scenarios: giữ nhịp / +10% / +20% → FYP cuối tháng + % mục tiêu.
 */
export function finishScenarios({ cum, avg7, daysLeft, target, latestDateISO, year, month }) {
  const tgt = num(target)
  const remaining = Math.max(tgt - num(cum), 0)
  const perDayNeeded = daysLeft > 0 ? remaining / daysLeft : null
  const upliftPct = (avg7 > 0 && perDayNeeded !== null) ? (perDayNeeded / avg7 - 1) * 100 : null

  let finishDate = null
  if (avg7 > 0 && remaining > 0) {
    const need = Math.ceil(remaining / avg7)
    const base = new Date(`${latestDateISO}T00:00:00`)
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + need)
    if (d.getFullYear() === year && (d.getMonth() + 1) === month) {
      finishDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
    }
  }
  const mk = (label, g) => {
    const value = num(cum) + avg7 * (1 + g) * daysLeft
    return { label, value, pct: tgt > 0 ? (value / tgt) * 100 : null }
  }
  return {
    remaining, perDayNeeded, upliftPct, finishDate,
    scenarios: [mk('Giữ nhịp 7 ngày', 0), mk('Tăng tốc +10%', 0.1), mk('Tăng tốc +20%', 0.2)],
  }
}

/** Phân tầng tuổi hồ sơ đang chờ (đầu ra của collectOpenCases). */
export function ageBuckets(openCases) {
  const defs = [
    { key: 'b03', label: '0–3 ngày', test: (d) => d <= 3 },
    { key: 'b47', label: '4–7 ngày', test: (d) => d >= 4 && d <= 7 },
    { key: 'b814', label: '8–14 ngày', test: (d) => d >= 8 && d <= 14 },
    { key: 'b15', label: '> 14 ngày', test: (d) => d > 14 },
  ]
  const out = defs.map((d) => ({ ...d, n: 0, fee: 0 }))
  ;(openCases || []).forEach((c) => {
    const b = out.find((x) => x.test(c.ageDays || 0))
    if (b) { b.n += 1; b.fee += num(c.item?.fee) }
  })
  return out
}
