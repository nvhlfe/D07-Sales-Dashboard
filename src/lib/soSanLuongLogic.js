// ─────────────────────────────────────────────────────────────────
// 📋 SỔ SẢN LƯỢNG — logic thuần (không phụ thuộc React/Firebase).
// Ý tưởng từ dashboard "Sổ Sản Lượng" của VP D03, áp trên dữ liệu
// Proposal + Daily Sales mà GA D07 đã nạp sẵn trong app:
// mỗi doc daily_sales_tvv là snapshot LŨY KẾ của tháng, lấy doc mới nhất.
//
// Định nghĩa (đã đối chiếu file Daily thật 25/10/2026):
//  - NỘP trong tháng = hồ sơ đã lên phí (IF + PS trong Proposal của tháng)
//    + hồ sơ chưa lên phí (Pipeline). PO/DC/WD/CF… xếp vào nhóm "Khác".
//  - PHÁT HÀNH (gộp) = hồ sơ có NGÀY PHÁT HÀNH trong tháng VÀ IP Net > 0
//    (kể cả hồ sơ nộp tháng trước nếu xuất hiện trong file tháng này).
//    Hồ sơ CF trong file luôn có IP Net = 0 (hệ thống đã trừ) nên tự bị loại;
//    IF chưa có ngày phát hành hoặc IP Net = 0 cũng không tính phát hành.
//  - PHÁT HÀNH RÒNG = Phát hành gộp − hồ sơ tháng trước vốn là IF (IP Net > 0)
//    nhưng tháng này chuyển CF (phát hành rồi huỷ), khớp theo số HSYC.
//  - PENDING = hồ sơ PS + chi tiết sheet Pending (lý do chờ = các yêu cầu
//    còn thiếu), kèm tuổi hồ sơ tính tới ngày của snapshot mới nhất.
// Đơn vị tiền: triệu đồng (như dữ liệu Daily).
// ─────────────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function inMonth(iso, year, month) {
  if (!iso) return false
  const p = String(iso).split('-')
  return p.length === 3 && Number(p[0]) === year && Number(p[1]) === month
}

export function prevYearMonth(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

/** Doc Daily mới nhất trong danh sách (snapshot lũy kế → chỉ lấy doc cuối). */
export function latestDailyDoc(docs) {
  const valid = (docs || []).filter((d) => d && d.id && d.data)
  if (!valid.length) return null
  return valid.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))[valid.length - 1]
}

function daysBetween(isoFrom, isoTo) {
  if (!isoFrom || !isoTo) return null
  const a = new Date(`${isoFrom}T00:00:00`)
  const b = new Date(`${isoTo}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  return Math.round((b - a) / 86400000)
}

const emptyMetrics = () => ({
  subN: 0, subIp: 0,          // đã lên phí IF+PS: số HS + IP Sub
  ifN: 0, psN: 0,             // tách IF / PS
  pipeN: 0, pipeApe: 0,       // Pipeline chưa lên phí
  nopN: 0,                    // tổng số hồ sơ nộp = subN + pipeN
  issN: 0, issIp: 0,          // phát hành gộp (theo ngày PH + IP Net)
  cfN: 0, cfIp: 0,            // trừ CF liên tháng
  netN: 0, netIp: 0,          // phát hành RÒNG
  pendN: 0, pendIp: 0,        // pending (theo PS): số HS + IP Sub
  otherN: 0,                  // PO/DC/WD/CF trong tháng…
  rate: null,                 // tỷ lệ phát hành theo IP = netIp / subIp
})

function addTo(m, c) {
  if (c.kind === 'sub') {
    // Hồ sơ nộp tháng trước nhưng phát hành tháng này (countSub=false):
    // chỉ tính vào phát hành, không tính vào "nộp trong tháng" (đúng mẫu D03).
    if (c.countSub !== false) {
      m.subN += 1; m.subIp += num(c.ipSub)
      if (c.statusGroup === 'IF') m.ifN += 1
      if (c.statusGroup === 'PS') m.psN += 1
    }
  } else if (c.kind === 'pipeline') {
    m.pipeN += 1; m.pipeApe += num(c.ape)
  } else if (c.kind === 'other') {
    m.otherN += 1
  }
  if (c.issued) { m.issN += 1; m.issIp += num(c.ipNet) }
  m.nopN = m.subN + m.pipeN
}

function finish(m) {
  m.netN = m.issN - m.cfN
  m.netIp = m.issIp - m.cfIp
  m.rate = m.subIp > 0 ? m.netIp / m.subIp : null
  return m
}

/**
 * Phân tích 1 tháng của Sổ Sản Lượng.
 * curDocs/prevDocs: mảng doc daily_sales_tvv của tháng đang xem / tháng trước.
 * Trả { asOf, hasData, totals, units[], agents[], cases{...}, cfFlips[], topNet[], topSub[] }
 * cases của từng agent nằm trong agents[i].detail { issued[], pending[], pipeline[], others[] }.
 */
export function analyzeSoSanLuong(curDocs, prevDocs, { year, month }) {
  const cur = latestDailyDoc(curDocs)
  const prev = latestDailyDoc(prevDocs)
  const asOf = cur?.id || null
  const result = {
    asOf, hasData: !!cur,
    totals: finish(emptyMetrics()),
    units: [], agents: [],
    pendingAll: [], cfFlips: [], topNet: [], topSub: [],
  }
  if (!cur) return result
  const data = cur.data || {}
  const proposals = data.proposalRows || []

  // ── CF liên tháng: hồ sơ tháng trước là IF (IP Net > 0), tháng này thành CF ──
  const curByProposal = new Map()
  proposals.forEach((p) => { if (p.proposalNum) curByProposal.set(String(p.proposalNum), p) })
  const cfDeductByAgent = new Map() // msdl -> { n, ip }
  if (prev) {
    const pm = prevYearMonth(year, month)
    ;(prev.data?.proposalRows || []).forEach((p) => {
      if (p.statusGroup !== 'IF' || num(p.ipNet) <= 0) return
      if (p.firstIssuedDate && !inMonth(p.firstIssuedDate, pm.year, pm.month)) return
      const now = p.proposalNum ? curByProposal.get(String(p.proposalNum)) : null
      if (now && String(now.status || '').toUpperCase() === 'CF') {
        const key = String(p.msdl || '')
        const cur2 = cfDeductByAgent.get(key) || { n: 0, ip: 0 }
        cur2.n += 1; cur2.ip += num(p.ipNet)
        cfDeductByAgent.set(key, cur2)
        result.cfFlips.push({
          msdl: key, name: p.agName || '', unit: p.unit || '',
          proposalNum: String(p.proposalNum), policyNum: p.policyNum || '',
          product: p.product || '', ipNetPrev: num(p.ipNet),
          issuedDate: p.firstIssuedDate || '',
        })
      }
    })
  }

  // ── Chi tiết Pending theo số HSYC ──
  const pendingDetail = new Map()
  ;(data.pendingRows || []).forEach((r) => {
    if (r.proposalNum) pendingDetail.set(String(r.proposalNum), r)
  })

  // ── Phân loại hồ sơ của tháng ──
  const agentMap = new Map()
  const ensureAgent = (msdl, name, unit) => {
    const key = String(msdl || '')
    if (!agentMap.has(key)) {
      agentMap.set(key, {
        msdl: key, name: name || '', unit: unit || '',
        metrics: emptyMetrics(),
        detail: { issued: [], pending: [], pipeline: [], others: [] },
      })
    }
    const a = agentMap.get(key)
    if (!a.name && name) a.name = name
    if (!a.unit && unit) a.unit = unit
    return a
  }

  proposals.forEach((p) => {
    const submittedThisMonth = !p.proposalDate || inMonth(p.proposalDate, year, month)
    const issued = inMonth(p.firstIssuedDate, year, month) && num(p.ipNet) > 0
    const kind = (p.statusGroup === 'IF' || p.statusGroup === 'PS') ? 'sub' : 'other'
    // Hồ sơ không nộp tháng này và không phát hành tháng này → không thuộc sổ tháng này
    if (!submittedThisMonth && !issued) return
    const a = ensureAgent(p.msdl, p.agName, p.unit)
    const c = {
      kind, statusGroup: p.statusGroup, status: p.status || '', statusFull: p.statusFull || '',
      ipSub: num(p.ipSub), ipNet: num(p.ipNet), issued, countSub: submittedThisMonth,
      proposalNum: p.proposalNum || '', policyNum: p.policyNum || '',
      product: p.product || '', proposalDate: p.proposalDate || '', issuedDate: p.firstIssuedDate || '',
    }
    addTo(a.metrics, c)
    if (issued) a.detail.issued.push(c)
    if (kind === 'sub' && p.statusGroup === 'PS') {
      const det = pendingDetail.get(String(p.proposalNum))
      const pend = {
        ...c,
        ape: det ? num(det.ape) : num(p.ipSub),
        reasons: det ? (det.requirements || []).map((r) => r.name) : [],
        reasonDetails: det ? (det.requirements || []) : [],
        description: det?.description || '', classify: det?.classify || '', poName: det?.poName || '',
        hasDetail: !!det,
        ageDays: daysBetween(p.proposalDate, asOf),
      }
      a.detail.pending.push(pend)
      result.pendingAll.push({ ...pend, msdl: a.msdl, name: a.name, unit: a.unit })
    } else if (kind === 'other') {
      a.detail.others.push(c)
    }
  })

  // Pending có chi tiết nhưng không còn ở trạng thái PS trong Proposal (sheet lệch nhau) → vẫn đưa vào danh sách chờ của TVV
  ;(data.pendingRows || []).forEach((r) => {
    const key = String(r.proposalNum || '')
    const inProposal = proposals.some((p) => String(p.proposalNum) === key && p.statusGroup === 'PS')
    if (inProposal) return
    const a = ensureAgent(r.msdl, r.agName, r.unit)
    const pend = {
      kind: 'sub', statusGroup: 'PS', status: 'PS', statusFull: 'PS - Pending',
      ipSub: num(r.ape), ipNet: 0, issued: false,
      proposalNum: key, policyNum: '', product: r.product || '',
      proposalDate: r.proposalDate || '', issuedDate: '',
      ape: num(r.ape),
      reasons: (r.requirements || []).map((x) => x.name),
      reasonDetails: r.requirements || [],
      description: r.description || '', classify: r.classify || '', poName: r.poName || '',
      hasDetail: true,
      ageDays: daysBetween(r.proposalDate, asOf),
    }
    a.detail.pending.push(pend)
    result.pendingAll.push({ ...pend, msdl: a.msdl, name: a.name, unit: a.unit })
  })

  // ── Pipeline (chưa lên phí) ──
  ;(data.pipelineRows || []).forEach((r) => {
    if (r.proposalDate && !inMonth(r.proposalDate, year, month)) return
    const a = ensureAgent(r.msdl, r.agName, r.unit)
    const c = {
      kind: 'pipeline', statusGroup: '', status: '', statusFull: '',
      ipSub: 0, ipNet: 0, issued: false, ape: num(r.ape),
      proposalNum: r.proposalNum || '', policyNum: '', product: r.product || '',
      proposalDate: r.proposalDate || '', issuedDate: '',
      description: r.description || '', classify: r.classify || '', poName: r.poName || '',
      ageDays: daysBetween(r.proposalDate, asOf),
    }
    addTo(a.metrics, c)
    a.detail.pipeline.push(c)
  })

  // ── Áp trừ CF + hoàn thiện chỉ số từng TVV ──
  agentMap.forEach((a) => {
    const ded = cfDeductByAgent.get(a.msdl)
    if (ded) { a.metrics.cfN = ded.n; a.metrics.cfIp = ded.ip }
    // Pending hiển thị theo DANH SÁCH CHI TIẾT (PS của tháng + sheet Pending),
    // không theo số PS nộp trong tháng — đây mới là số hồ sơ đang chờ thật.
    a.metrics.pendN = a.detail.pending.length
    a.metrics.pendIp = a.detail.pending.reduce((s, x) => s + num(x.ape ?? x.ipSub), 0)
    finish(a.metrics)
  })
  // TVV chỉ có trừ CF (không còn hồ sơ tháng này trong Proposal) vẫn phải xuất hiện
  cfDeductByAgent.forEach((ded, msdl) => {
    if (agentMap.has(msdl)) return
    const flip = result.cfFlips.find((f) => f.msdl === msdl)
    const a = ensureAgent(msdl, flip?.name, flip?.unit)
    a.metrics.cfN = ded.n; a.metrics.cfIp = ded.ip
    finish(a.metrics)
  })

  result.agents = [...agentMap.values()]
    .filter((a) => a.metrics.nopN > 0 || a.metrics.issN > 0 || a.metrics.cfN > 0 || a.metrics.otherN > 0 || a.detail.pending.length > 0)
    .sort((x, y) => y.metrics.netIp - x.metrics.netIp || y.metrics.subIp - x.metrics.subIp)

  // ── Gộp theo Unit ──
  const unitMap = new Map()
  result.agents.forEach((a) => {
    const unit = a.unit || '—'
    if (!unitMap.has(unit)) unitMap.set(unit, { unit, metrics: emptyMetrics(), agentCount: 0 })
    const u = unitMap.get(unit)
    u.agentCount += 1
    ;['subN', 'subIp', 'ifN', 'psN', 'pipeN', 'pipeApe', 'issN', 'issIp', 'cfN', 'cfIp', 'pendN', 'pendIp', 'otherN']
      .forEach((k) => { u.metrics[k] += a.metrics[k] })
  })
  unitMap.forEach((u) => { u.metrics.nopN = u.metrics.subN + u.metrics.pipeN; finish(u.metrics) })
  result.units = [...unitMap.values()].sort((x, y) => y.metrics.netIp - x.metrics.netIp || y.metrics.subIp - x.metrics.subIp)

  // ── Tổng toàn GA = tổng các TVV (đã gồm trừ CF) ──
  const t = emptyMetrics()
  result.agents.forEach((a) => {
    ;['subN', 'subIp', 'ifN', 'psN', 'pipeN', 'pipeApe', 'issN', 'issIp', 'cfN', 'cfIp', 'pendN', 'pendIp', 'otherN']
      .forEach((k) => { t[k] += a.metrics[k] })
  })
  t.nopN = t.subN + t.pipeN
  result.totals = finish(t)

  result.pendingAll.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1))
  result.topNet = result.agents.filter((a) => a.metrics.netIp > 0).slice(0, 5)
    .map((a) => ({ msdl: a.msdl, name: a.name, unit: a.unit, netIp: a.metrics.netIp, netN: a.metrics.netN }))
  result.topSub = result.agents.filter((a) => a.metrics.nopN > 0)
    .slice().sort((x, y) => y.metrics.nopN - x.metrics.nopN || y.metrics.subIp - x.metrics.subIp)
    .slice(0, 5)
    .map((a) => ({ msdl: a.msdl, name: a.name, unit: a.unit, nopN: a.metrics.nopN, subIp: a.metrics.subIp }))
  return result
}

/**
 * Che số nhạy cảm (số HSYC / số hợp đồng) ở mức HIỂN THỊ: chỉ hiện 2 ký tự cuối.
 * canSeeFull=true (tài khoản quản trị cao nhất) thì hiện đầy đủ.
 * LƯU Ý: đây là che phía client — dữ liệu gốc vẫn nằm trong Firestore,
 * không phải che ở máy chủ như bản D03.
 */
export function maskSensitive(value, canSeeFull) {
  if (value === null || value === undefined || value === '') return '—'
  const s = String(value)
  if (canSeeFull) return s
  if (s.length <= 2) return s
  return `${'•'.repeat(Math.min(Math.max(s.length - 2, 2), 8))}${s.slice(-2)}`
}
