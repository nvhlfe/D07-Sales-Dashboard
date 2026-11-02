// ─────────────────────────────────────────────────────────────
// src/lib/salesReportLogic.js — LOGIC THUẦN của tab Sales Report
// Port nguyên từ bản Sales Report standalone đang chạy production
// (d07-sales-report.vercel.app). Mọi hàm ở đây không phụ thuộc React/DOM
// để kiểm chứng được bằng test node độc lập.
// ─────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx'

export function genId() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

export function normalizeVi(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').trim()
}

// Danh sách TVV nhúng sẵn trong bản gốc (import từ data.xlsx, 80 dòng thực tế
// trong file nguồn) — dùng làm nền cho picker "+TVV"; dữ liệu Firestore
// (tvv_directory) merge đè lên theo MSDL.
export const TVV_SEED_DATA = 
[{"unit":"9EB","msdl":"60709108","name":"TRẦN THỊ TUYẾT NHUNG"},{"unit":"FTK","msdl":"60206189","name":"TRẦN THỊ ĐOAN TRÂM"},{"unit":"9CJ","msdl":"60525315","name":"PHẠM THỊ MỸ XUÂN"},{"unit":"TUQ","msdl":"60556971","name":"PHẠM THỊ MỸ TRANG"},{"unit":"TCG","msdl":"60776590","name":"PHẠM HOÀNG HUÂN"},{"unit":"SWZ","msdl":"60721271","name":"NGUYỄN THỊ NGỌC HÂN"},{"unit":"GB4","msdl":"60732652","name":"NGUYỄN THỊ HOÀNG OANH"},{"unit":"9CF","msdl":"60734793","name":"NGUYỄN THỊ CHUYỀN"},{"unit":"VA9","msdl":"60789834","name":"NGUYỄN THANH PHƯƠNG"},{"unit":"9HA","msdl":"60797524","name":"NGUYỄN HOÀNG QUÂN"},{"unit":"PKA","msdl":"60351587","name":"NGUYỄN ĐÌNH HUY"},{"unit":"PRH","msdl":"60697369","name":"LÊ MINH THANH"},{"unit":"PRH","msdl":"60733154","name":"LÊ HOÀNG VIỆT"},{"unit":"SWZ","msdl":"60704793","name":"LÊ HOÀNG THẮNG"},{"unit":"UVC","msdl":"60792098","name":"HUỲNH THANH THẢO"},{"unit":"PKA","msdl":"60709669","name":"HUỲNH NGỌC VINH"},{"unit":"B51","msdl":"60000607","name":"TRƯƠNG THỊ PHI NGA"},{"unit":"PKA","msdl":"60704790","name":"TRẦN THỊ TUYẾT HẠNH"},{"unit":"9EB","msdl":"60794072","name":"TRẦN THỊ THÚY QUANH"},{"unit":"PKA","msdl":"60337183","name":"TRẦN THỊ NGỌC PHƯƠNG"},{"unit":"UVC","msdl":"60807682","name":"NGUYỄN TRUNG HẬU"},{"unit":"OQA","msdl":"60668996","name":"NGUYỄN THỊ TOÀN"},{"unit":"V5W","msdl":"60796961","name":"NGUYỄN THỊ PHƯƠNG THẢO"},{"unit":"GB4","msdl":"60188196","name":"NGUYỄN THỊ KIỀU HẠNH"},{"unit":"PKA","msdl":"60730505","name":"NGUYỄN THỊ HẰNG"},{"unit":"GB4","msdl":"60807770","name":"NGUYỄN THANH LIÊM"},{"unit":"B51","msdl":"60611143","name":"NGUYỄN MINH TÂN"},{"unit":"GB4","msdl":"60514174","name":"NGUYỄN DUY NAM"},{"unit":"9CJ","msdl":"60593868","name":"LÊ NGUYỄN KIỀU TRINH"},{"unit":"UVC","msdl":"60807774","name":"HUỲNH THỊ CẨM LIỄU"},{"unit":"UVC","msdl":"60802513","name":"HOÀNG LÊ GIA HÂN"},{"unit":"G4D","msdl":"60386685","name":"HỒ HOÀNG QUYÊN"},{"unit":"9CJ","msdl":"60539952","name":"DƯƠNG CHÍ DŨNG"},{"unit":"UVC","msdl":"60798302","name":"ĐẶNG THỊ TUYẾT HẠNH"},{"unit":"VA9","msdl":"60806558","name":"NGUYỄN TRẦN ANH"},{"unit":"GB4","msdl":"60806779","name":"LÂM THỊ THÚY PHƯƠNG"},{"unit":"9HA","msdl":"60806792","name":"ĐỖ NGỌC THẢO"},{"unit":"9DA","msdl":"60806551","name":"ĐẶNG QUỐC THÁI"},{"unit":"GB4","msdl":"60805871","name":"TẠ LỄ CẦN"},{"unit":"PKA","msdl":"60742570","name":"THÁI VÂN AN"},{"unit":"SWZ","msdl":"60774698","name":"TĂNG THÙY NHỰT"},{"unit":"PRH","msdl":"60721274","name":"NGUYỄN VĂN ĐỐC"},{"unit":"UVC","msdl":"60791195","name":"NGUYỄN THỊ KIM QUỲNH"},{"unit":"PKA","msdl":"60725598","name":"NGUYỄN NGỌC TÚ QUYÊN"},{"unit":"UVC","msdl":"60805285","name":"LÝ NGỌC HÂN"},{"unit":"V5W","msdl":"60792131","name":"LƯU YẾN NHI"},{"unit":"GB4","msdl":"60144587","name":"LƯU THỊ XUÂN TRANG"},{"unit":"OQA","msdl":"60671946","name":"LÊ ANH VŨ"},{"unit":"PKA","msdl":"60709668","name":"HOÀNG THỊ NGA"},{"unit":"FTK","msdl":"60721099","name":"BÙI THỊ MAI TRÂM"},{"unit":"M1G","msdl":"60808386","name":"PHẠM NGUYỄN ĐĂNG TUYÊN"},{"unit":"OQA","msdl":"60621596","name":"PHẠM ANH TRÍ"},{"unit":"B51","msdl":"60808427","name":"LÊ THỊ ANH THƯ"},{"unit":"VA9","msdl":"60808447","name":"LÊ HOÀNG THỤY VI"},{"unit":"OQA","msdl":"60808385","name":"LÂM THỊ YẾN NHI"},{"unit":"B51","msdl":"60808438","name":"HUỲNH THÁI DUY"},{"unit":"SWZ","msdl":"60808089","name":"TRƯƠNG THỊ TUYẾT"},{"unit":"VA9","msdl":"60807719","name":"THÁI NGUYỄN HOÀNG YẾN PHỤNG"},{"unit":"FTK","msdl":"60807798","name":"HỒ TUẤN LINH"},{"unit":"9CF","msdl":"60807590","name":"PHẠM QUANG CHÍNH"},{"unit":"UVC","msdl":"60807577","name":"NGUYỄN VIẾT THÀNH"},{"unit":"9CF","msdl":"60807512","name":"NGUYỄN NGÔ NGỌC TRANG"},{"unit":"9EB","msdl":"60806919","name":"TRẦN THỊ TUYẾT PHƯỢNG"},{"unit":"G4D","msdl":"60787850","name":"PHẠM TÚ UYÊN"},{"unit":"B51","msdl":"60810015","name":"PHẠM ĐỨC HUY"},{"unit":"UVC","msdl":"60809952","name":"NGUYỄN CHÂU MỸ LINH"},{"unit":"UVC","msdl":"60808543","name":"TRƯƠNG THANH NHÀN"},{"unit":"GB4","msdl":"60808545","name":"PHAN QUỲNH NHƯ"},{"unit":"OQA","msdl":"60808573","name":"NGUYỄN HOÀNG DƯƠNG NGHĨA"},{"unit":"OQA","msdl":"60808574","name":"ĐOÀN THỊ THANH THÚY"},{"unit":"UVC","msdl":"60808544","name":"CHU VŨ HỒNG HẠNH"},{"unit":"SWZ","msdl":"60637083","name":"TRẦN THỊ TƯỜNG VI"},{"unit":"PKA","msdl":"60801160","name":"TÔ NHỰT ANH"},{"unit":"VA9","msdl":"60187605","name":"NGUYỄN THỊ SỬU"},{"unit":"VA9","msdl":"60804265","name":"NGŨ THỊ THÁI DUYÊN"},{"unit":"M1G","msdl":"60533962","name":"LÊ QUANG LIÊM"},{"unit":"QBC","msdl":"60726730","name":"LÊ HỒNG NHỰT"},{"unit":"G4D","msdl":"60178139","name":"HỒ TÚ QUYÊN"},{"unit":"UVC","msdl":"60790852","name":"ĐÀO THANH DUY"},{"unit":"GB4","msdl":"60651685","name":"ĐÀO MỸ TUYÊN"}];

// ── Trạng thái hồ sơ ─────────────────────────────────────────
export const STATUS_LBL = { none: 'Chưa phí', paid: 'Có phí', issued: 'Phát hành' }
export const STATUS_CLS = { none: 'none', paid: 'paid', issued: 'issued' }
export function statusBadge(s) { return STATUS_CLS[s] || 'none' }

export const daysInMonth = (year, month) => new Date(year, month, 0).getDate()
export const pad2 = (n) => String(n).padStart(2, '0')

// ── Tuổi hồ sơ ──
// "Ngày lên hồ sơ" chính là ngày (d) mà case được lưu vào trong daily{}, nên tuổi
// hồ sơ tính trực tiếp từ ngày đó — đúng với bản gốc (nowMs cho phép test cố định).
export const AGING_THRESHOLD_HOURS = 120 // 5 ngày — cảnh báo hồ sơ CF tồn lâu
export function caseAgeHours(year, month, day, nowMs = Date.now()) {
  const caseDate = new Date(year, month - 1, day, 0, 0, 0)
  return (nowMs - caseDate.getTime()) / 3600000
}
export function caseAgeDays(year, month, day, nowMs = Date.now()) {
  return Math.floor(caseAgeHours(year, month, day, nowMs) / 24)
}
export function ageChipClass(days) {
  if (days >= 10) return 'hot'
  if (days >= AGING_THRESHOLD_HOURS / 24) return 'warn'
  return 'ok'
}
export function isAgingCase(item, year, month, day, nowMs = Date.now()) {
  return item.status === 'none' && caseAgeHours(year, month, day, nowMs) > AGING_THRESHOLD_HOURS
}

// ── Phí: nhập/hiển thị theo TRIỆU, lưu nội bộ là VND (giữ nguyên bản gốc) ──
export function feeToTrieu(vnd) {
  const n = Number(vnd || 0)
  if (!n) return ''
  return Math.round(n / 1000) / 1000
}
export function validateFee(val) {
  if (val === '' || val === null || val === undefined) return { ok: true, value: '' }
  const n = Number(val)
  if (isNaN(n)) return { ok: false, msg: 'Phí phải là số, đơn vị triệu (vd 29.155 = 29.155.000đ)' }
  const vnd = Math.round(n * 1000000)
  if (Math.abs(vnd) > 500000000) return { ok: false, msg: 'Phí lớn bất thường (>500tr) — kiểm tra lại số' }
  return { ok: true, value: vnd }
}
/** Định dạng KPI kiểu bản gốc: ≥1.000.000 → "12.3M", nhỏ hơn → số có phân cách. */
export function fmtMoneyM(v) {
  const n = Number(v || 0)
  return Math.abs(n) >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n.toLocaleString('vi-VN')
}
export const fmtVnd = (v) => (v ? Number(v).toLocaleString('vi-VN') : '—')

// ── Tính tổng theo người ─────────────────────────────────────
export function calcTotal(p) {
  let t = 0
  Object.values(p.daily || {}).forEach((d) => { if (d.cases) d.cases.forEach((c) => { t += Number(c.fee || 0) }) })
  return t
}
export function calcIssued(p) {
  let t = 0
  Object.values(p.daily || {}).forEach((d) => { if (d.cases) d.cases.forEach((c) => { if (c.status === 'issued') t += Number(c.fee || 0) }) })
  return t
}
export function calcPersonStats(p) {
  let cases = 0, fee = 0, issued = 0, paid = 0, noFee = 0
  Object.values(p.daily || {}).forEach((d) => {
    if (!d.cases) return
    d.cases.forEach((c) => {
      const v = Number(c.fee || 0)
      cases++; fee += v
      if (c.status === 'issued') issued += v
      else if (c.status === 'paid') paid += v
      else if (c.status === 'none') noFee += v
    })
  })
  return { cases, fee, issued, paid, noFee, pending: fee - issued - noFee }
}

// ── Shape dữ liệu tháng: map {_id: person} ⇄ mảng có _order ──
export function personMapToArray(rawMap) {
  return Object.entries(rawMap || {})
    .map(([id, p]) => ({ ...p, _id: p._id || id }))
    .sort((a, b) => (a._order ?? 0) - (b._order ?? 0))
}
/** Mảng cũ → map theo _id kèm _order (migrate 1 lần như bản gốc). */
export function personArrayToMap(rawArr) {
  const map = {}
  rawArr.forEach((p, idx) => {
    const id = p._id || genId()
    map[id] = { ...p, _id: id, _order: (typeof p._order === 'number') ? p._order : idx }
  })
  return map
}
export function createDefaultPerson() {
  return { _id: genId(), _order: 0, group: 'G01', msdl: '100001', name: 'Nguyễn Văn A', daily: {} }
}
export function nextOrder(reportData) {
  return reportData.reduce((m, p) => Math.max(m, p._order ?? 0), 0) + 1
}

/**
 * Gộp snapshot server vào mảng local, GIỮ NGUYÊN người đang có thay đổi local
 * chưa lưu xong (pendingIds) — port nguyên mergeReportDataFromSnapshot của gốc.
 * Thuần: không mutate mảng đầu vào, trả mảng mới.
 */
export function mergeReportDataFromSnapshot(localPersons, remoteMap, pendingIds) {
  const pending = pendingIds || new Set()
  const remoteIds = new Set(Object.keys(remoteMap || {}))
  const out = (localPersons || []).filter((p) => remoteIds.has(p._id) || pending.has(p._id))
  remoteIds.forEach((id) => {
    if (pending.has(id)) return
    const remotePerson = { ...remoteMap[id], _id: id }
    const idx = out.findIndex((p) => p._id === id)
    if (idx === -1) out.push(remotePerson); else out[idx] = remotePerson
  })
  out.sort((a, b) => (a._order ?? 0) - (b._order ?? 0))
  return out
}

// ── Hồ sơ đang mở (chưa PH) cho tab "Chờ xử lý" + export "Hồ sơ tồn" ──
export function collectOpenCases(reportData, year, month, statusFilter, nowMs = Date.now()) {
  const out = []
  ;(reportData || []).forEach((person, pi) => {
    Object.keys(person.daily || {}).forEach((dStr) => {
      const d = parseInt(dStr)
      const cases = (person.daily[d] && person.daily[d].cases) || []
      cases.forEach((item, ci) => {
        if (item.status === 'issued') return
        if (statusFilter && item.status !== statusFilter) return
        out.push({
          pi, d, ci, person, item,
          ageDays: caseAgeDays(year, month, d, nowMs),
          ageHours: caseAgeHours(year, month, d, nowMs),
        })
      })
    })
  })
  out.sort((a, b) => b.ageHours - a.ageHours)
  return out
}

// ── Danh sách TVV dùng chung ─────────────────────────────────
/** Gộp seed (nền) + dữ liệu Firestore (đè theo MSDL) như bản gốc. */
export function mergeTvvDirectory(seed, remoteItems) {
  const merged = new Map((seed || []).map((t) => [t.msdl, t]))
  ;(remoteItems || []).forEach((t) => { if (t.msdl) merged.set(String(t.msdl), { ...t, msdl: String(t.msdl) }) })
  return [...merged.values()]
}
/** Nhận diện cột linh hoạt: Unit/Đơn vị, MSDL/Mã số đại lý, Tên TVV/Họ tên/Name. */
export function detectTvvColumns(headerRow) {
  const norm = (headerRow || []).map((h) => normalizeVi(h))
  const findCol = (patterns) => norm.findIndex((h) => patterns.some((p) => h.includes(p)))
  return {
    unit: findCol(['unit', 'don vi', 'ban']),
    msdl: findCol(['msdl', 'ma so', 'ma dai ly', 'ma tvv']),
    name: findCol(['ten tvv', 'ho ten', 'ten', 'name']),
  }
}
/** Tìm dòng tiêu đề trong 5 dòng đầu + trích danh sách TVV (port handleTvvFileSelect). */
export function parseTvvRows(rows) {
  let headerIdx = -1, cols = null
  for (let i = 0; i < Math.min(5, (rows || []).length); i++) {
    const c = detectTvvColumns(rows[i])
    const hits = [c.unit, c.msdl, c.name].filter((x) => x >= 0).length
    if (hits >= 2) { headerIdx = i; cols = c; break }
  }
  if (headerIdx === -1) return { headerIdx: -1, cols: null, items: [] }
  const items = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const msdl = String(cols.msdl >= 0 ? (r[cols.msdl] ?? '') : '').trim()
    const name = String(cols.name >= 0 ? (r[cols.name] ?? '') : '').trim()
    const unit = String(cols.unit >= 0 ? (r[cols.unit] ?? '') : '').trim()
    if (!msdl && !name) continue
    items.push({ unit, msdl, name })
  }
  return { headerIdx, cols, items }
}

// ─────────────────────────────────────────────────────────────
// ĐỐI CHIẾU PROPOSAL — port nguyên logic bản gốc.
// Khớp theo ProposalNum (ghi chú) + MSDL/AGCode của từng TVV:
// - IF → issued (PH), PS → paid (CP), DC/WD → phí về 0 (không đổi status)
// - Thiếu trong Sales Report → thêm mới, phí = IP Sub (triệu) × 1.000.000
// - Sai người → chuyển sang đúng người, phí theo IP Sub
// - Phí lệch > 500đ trên dòng đúng người → sửa theo IP Sub; dòng chỉ có
//   Pipeline và phí đang 0 → điền theo APE (triệu) × 1.000.000
// - Pipeline chưa có ở đâu → thêm dạng CF (fee 0, status 'none')
// ─────────────────────────────────────────────────────────────
export function mapRawStatus(raw) {
  if (raw === 'IF') return 'issued'
  if (raw === 'PS') return 'paid'
  return null
}
export function feeFromRow(row) { return Math.round(Number(row?.ipSub || 0) * 1000000) }

export function isYearMonth(v) {
  if (v === null || v === undefined || v === '') return false
  const n = Number(v)
  return !isNaN(n) && n > 200000 && n < 300000
}
export function excelDateIntToISO(v) {
  if (v === null || v === undefined || v === '') return null
  const s = String(v)
  if (s.length === 8 && /^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8)
  return null
}

/** Đọc sheet Proposal/Pipeline từ file Daily Sales Excel (port parseProposalPipelineExcel). */
export function parseProposalPipelineExcel(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false })
  const proposalName = wb.SheetNames.includes('Proposal') ? 'Proposal' : (wb.SheetNames.includes('Export') ? 'Export' : null)
  const rawProposal = proposalName ? XLSX.utils.sheet_to_json(wb.Sheets[proposalName], { defval: null, raw: true }) : []
  const rawPipeline = wb.SheetNames.includes('Pipeline') ? XLSX.utils.sheet_to_json(wb.Sheets['Pipeline'], { defval: null, raw: true }) : []
  const proposalRows = []
  for (const r of rawProposal) {
    if (!isYearMonth(r['Yearmonth']) || !r['AGCode']) continue
    const status = (r['PolicyStatus'] || '').toString().trim().toUpperCase()
    proposalRows.push({
      unit: r['UnitCode'] || '', msdl: String(r['AGCode']), agName: r['AGName'] || '',
      proposalNum: r['ProposalNum'] ? String(r['ProposalNum']) : '', status,
      product: r['Remarked_ProductNameVN'] || r['ProductCode'] || '',
      proposalDate: excelDateIntToISO(r['ProposalDate']),
      ipSub: Number(r['IP Sub']) || 0,
      policyNum: r['PolicyNum'] ? String(r['PolicyNum']) : '',
    })
  }
  const pipelineRows = []
  for (const r of rawPipeline) {
    if (!r['AGCode'] || !r['ProposalNum']) continue
    pipelineRows.push({
      unit: r['UnitCode'] || '', msdl: String(r['AGCode']), agName: r['AGName'] || '',
      proposalNum: String(r['ProposalNum']), proposalDate: excelDateIntToISO(r['ProposalDate']),
      product: r['ProductNameVN'] || r['BasicProductCode'] || '', ape: Number(r['APE (mil)']) || 0,
    })
  }
  return { proposalRows, pipelineRows }
}

/** Chuẩn hoá 1 dòng Proposal/Pipeline từ daily_sales_tvv (agCode cũ → msdl). */
export function normalizeProposalRow(r) {
  if (!r) return r
  const out = { ...r }
  if (out.msdl === undefined && out.agCode !== undefined) out.msdl = out.agCode
  if (out.msdl !== undefined) out.msdl = String(out.msdl)
  return out
}

/**
 * Tính toàn bộ thay đổi cần áp dụng (port computeReconcile). THUẦN — chỉ đọc,
 * không mutate reportData; các action giữ tham chiếu person/item để tầng UI
 * áp dụng đúng như bản gốc. Trả { statusActions, addActions, fixActions,
 * feeActions, pipelineActions, unmatched }.
 */
export function computeReconcile(reportData, proposalRows, pipelineRows, fallbackDateStr) {
  const byNote = new Map()
  ;(proposalRows || []).forEach((r) => {
    if (!r.proposalNum || !r.msdl) return
    if (!byNote.has(r.proposalNum)) byNote.set(r.proposalNum, new Map())
    byNote.get(r.proposalNum).set(String(r.msdl), r)
  })
  const statusByNote = new Map()
  ;(proposalRows || []).forEach((r) => { if (r.proposalNum && !statusByNote.has(r.proposalNum)) statusByNote.set(r.proposalNum, r.status) })
  const policyNumByNote = new Map()
  ;(proposalRows || []).forEach((r) => { if (r.proposalNum && r.policyNum && !policyNumByNote.has(r.proposalNum)) policyNumByNote.set(r.proposalNum, r.policyNum) })

  const casesByNote = new Map()
  ;(reportData || []).forEach((person, pi) => {
    Object.keys(person.daily || {}).forEach((dStr) => {
      const d = parseInt(dStr)
      const cases = (person.daily[d] && person.daily[d].cases) || []
      cases.forEach((item, ci) => {
        const note = String(item.note || '').trim()
        if (!note) return
        if (!casesByNote.has(note)) casesByNote.set(note, [])
        casesByNote.get(note).push({ pi, d, ci, person, item })
      })
    })
  })

  const pipelineByNote = new Map()
  ;(pipelineRows || []).forEach((r) => {
    if (!r.proposalNum || !r.msdl) return
    if (!pipelineByNote.has(r.proposalNum)) pipelineByNote.set(r.proposalNum, new Map())
    pipelineByNote.get(r.proposalNum).set(String(r.msdl), r)
  })
  const pipelineAddActions = []
  pipelineByNote.forEach((agMap, note) => {
    if (byNote.has(note)) return
    if (casesByNote.has(note)) return
    agMap.forEach((row, msdl) => {
      pipelineAddActions.push({ note, msdl, agName: row.agName, unit: row.unit, product: row.product, proposalDate: row.proposalDate })
    })
  })

  // 1) Cập nhật trạng thái / phí→0 (DC/WD) / bổ sung PolicyNum
  const statusActions = []
  const dcWdNotes = new Set()
  casesByNote.forEach((entries, note) => {
    if (!statusByNote.has(note)) return
    const raw = statusByNote.get(note)
    const mapped = mapRawStatus(raw)
    if (raw === 'DC' || raw === 'WD') dcWdNotes.add(note)
    const pnum = policyNumByNote.get(note) || ''
    entries.forEach(({ pi, d, ci, person, item }) => {
      if (mapped && item.status !== mapped) {
        statusActions.push({ pi, d, ci, person, item, note, action: 'status', before: item.status, after: mapped, policyNum: pnum })
      } else if ((raw === 'DC' || raw === 'WD') && Number(item.fee || 0) !== 0) {
        statusActions.push({ pi, d, ci, person, item, note, action: 'fee', before: item.fee, after: 0 })
      } else if (mapped && pnum && item.policyNum !== pnum) {
        statusActions.push({ pi, d, ci, person, item, note, action: 'policyNum', before: item.policyNum || '', after: item.status, policyNum: pnum })
      }
    })
  })

  // 2) Thiếu / sai người
  const addActions = []
  const fixActions = []
  byNote.forEach((agMap, note) => {
    const correctMsdls = [...agMap.keys()]
    const entries = casesByNote.get(note) || []
    const matchedMsdls = new Set(entries.filter((e) => agMap.has(String(e.person.msdl))).map((e) => String(e.person.msdl)))
    const wrongEntries = entries.filter((e) => !agMap.has(String(e.person.msdl)))
    const missingMsdls = correctMsdls.filter((ag) => !matchedMsdls.has(ag))
    missingMsdls.forEach((msdl, idx) => {
      const row = agMap.get(msdl)
      const status = mapRawStatus(row.status) || 'none'
      const fee = feeFromRow(row)
      if (idx < wrongEntries.length) {
        const w = wrongEntries[idx]
        fixActions.push({
          note, msdl, agName: row.agName, unit: row.unit, status, product: row.product, fee, oldFee: Number(w.item.fee || 0), policyNum: row.policyNum || '',
          wrongPi: w.pi, wrongD: w.d, wrongCi: w.ci, wrongPerson: w.person, wrongItem: w.item,
        })
      } else {
        addActions.push({ note, msdl, agName: row.agName, unit: row.unit, status, product: row.product, fee, proposalDate: row.proposalDate, policyNum: row.policyNum || '' })
      }
    })
  })

  // 2b) Phí sai lệch so với IP Sub trên dòng đã đúng người (bỏ qua DC/WD)
  const feeActions = []
  byNote.forEach((agMap, note) => {
    if (dcWdNotes.has(note)) return
    const entries = casesByNote.get(note) || []
    entries.forEach((e) => {
      const row = agMap.get(String(e.person.msdl))
      if (!row) return
      const correctFee = feeFromRow(row)
      const curFee = Number(e.item.fee || 0)
      if (correctFee > 0 && Math.abs(correctFee - curFee) > 500) {
        feeActions.push({ pi: e.pi, d: e.d, ci: e.ci, person: e.person, item: e.item, note, before: curFee, after: correctFee })
      }
    })
  })
  // 2c) Chỉ có ở Pipeline, đúng người, phí đang 0 → điền theo APE
  pipelineByNote.forEach((agMap, note) => {
    if (byNote.has(note)) return
    const entries = casesByNote.get(note) || []
    entries.forEach((e) => {
      const row = agMap.get(String(e.person.msdl))
      if (!row) return
      const curFee = Number(e.item.fee || 0)
      const pipelineFee = Math.round(Number(row.ape || 0) * 1000000)
      if (curFee === 0 && pipelineFee > 0) {
        feeActions.push({ pi: e.pi, d: e.d, ci: e.ci, person: e.person, item: e.item, note, before: curFee, after: pipelineFee, fromPipeline: true })
      }
    })
  })

  // 3) Cảnh báo: có ghi chú, chưa PH, không thấy trong Proposal
  const unmatched = []
  casesByNote.forEach((entries, note) => {
    if (byNote.has(note)) return
    entries.forEach((e) => { if (e.item.status !== 'issued') unmatched.push({ ...e, note }) })
  })

  return { statusActions, addActions, fixActions, feeActions, pipelineActions: pipelineAddActions, unmatched }
}

/** Tìm hoặc tạo person theo MSDL (reportData → tvvDirectory → dữ liệu Proposal). */
export function findOrCreatePerson(reportData, tvvDirectory, msdl, agName, unit) {
  const key = String(msdl)
  let person = reportData.find((p) => String(p.msdl) === key)
  if (person) return person
  const dir = (tvvDirectory || []).find((t) => String(t.msdl) === key)
  person = {
    _id: genId(), _order: nextOrder(reportData),
    group: (dir && dir.unit) || unit || 'GROUP', msdl: key,
    name: (dir && dir.name) || agName || key, daily: {},
  }
  reportData.push(person)
  return person
}
export function dayFromProposalDate(proposalDate, fallbackDateStr) {
  const src = proposalDate || fallbackDateStr
  const parts = String(src || '').split('-')
  const d = parts.length === 3 ? parseInt(parts[2]) : NaN
  if (d >= 1 && d <= 31) return d
  const fb = parseInt(String(fallbackDateStr || '').split('-')[2])
  return (fb >= 1 && fb <= 31) ? fb : 1
}

// ── Dựng dữ liệu xuất Excel (AOA) — port 3 hàm export của bản gốc ──
export function buildSummaryExportAoa(reportData) {
  const rows = [['STT', 'Mã nhóm', 'MSDL', 'Họ tên', 'Hồ sơ', 'Tổng phí', 'Phát hành', 'Pending', 'Có phí', 'Chưa phí']]
  ;(reportData || []).forEach((p, i) => {
    const s = calcPersonStats(p)
    rows.push([i + 1, p.group, p.msdl, p.name, s.cases, s.fee, s.issued, s.pending, s.paid, s.noFee])
  })
  return rows
}
export function buildOverviewExportAoa(reportData, dayList) {
  const header = ['STT', 'Mã nhóm', 'MSDL', 'Họ tên', ...dayList.map((d) => `Ngày ${d}`), 'Tổng', 'Phát hành', 'Có phí chưa PH', 'Chưa phí']
  const rows = [header]
  ;(reportData || []).forEach((person, i) => {
    let total = 0, issued = 0, paid = 0, noFee = 0
    const dayValues = dayList.map((d) => {
      const data = person.daily[d] || { cases: [] }
      let dayTot = 0
      ;(data.cases || []).forEach((item) => {
        const fee = Number(item.fee || 0)
        dayTot += fee; total += fee
        if (item.status === 'issued') issued += fee
        else if (item.status === 'paid') paid += fee
        else if (item.status === 'none') noFee += fee
      })
      return dayTot || ''
    })
    rows.push([i + 1, person.group, person.msdl, person.name, ...dayValues, total || '', issued || '', paid || '', noFee || ''])
  })
  return rows
}
export function buildTonExportAoa(rows) {
  const STATUS_TXT = { none: 'Chưa phí (CF)', paid: 'Có phí, chưa PH (CP)' }
  const aoa = [['STT', 'Mã nhóm', 'MSDL', 'Họ tên', 'Ngày lên HS', 'Trạng thái', 'Phí', 'Số ngày đã chờ', 'Ghi chú']]
  ;(rows || []).forEach((r, i) => {
    aoa.push([
      i + 1, r.person.group, r.person.msdl, r.person.name, r.d,
      STATUS_TXT[r.item.status] || r.item.status,
      Number(r.item.fee || 0), r.ageDays, r.item.note || '',
    ])
  })
  return aoa
}
