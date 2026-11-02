// ─────────────────────────────────────────────────────────────
// src/lib/manmarkImport.js — Đọc file Excel cam kết ManMark (DATA.xlsx)
// Port nguyên logic từ bản ManMark cũ (public/manmark.html) vốn đã chạy
// đúng với file DATA thật của GA D07, tách thành hàm thuần để kiểm chứng
// được bằng test tự động:
// - Tìm dòng tiêu đề: dòng đầu tiên trong 15 dòng đầu có ô chứa AGCode/MSDL
// - Bỏ dòng trống + dòng TỔNG ở cuối file
// - Đoán cột: Unit / Mã TVV / Tên / Segment / Cam kết tháng / FYP+HS từng tuần
// - Suy ra khoảng ngày của tuần từ tiêu đề cột, vd "FYP Tuần 1 (1–7)"
// ─────────────────────────────────────────────────────────────
import * as XLSX from 'xlsx'

/** Số từ ô Excel: chấp nhận số sẵn, hoặc chuỗi kiểu VN "150.000" / "150,000". */
export function parseAmount(v) {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  const s = String(v).replace(/\s+/g, '').replace(/[^0-9.,-]/g, '')
  if (!s) return 0
  // Dạng nghìn phân tách: 1.500.000 / 1,500,000 / 150.000
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, '')) || 0
  const n = Number(s.replace(',', '.'))
  return isNaN(n) ? 0 : n
}

export const RMS_PROTECTED_MSG = 'File đang bị khóa bảo mật Prudential (nhãn Restricted — khóa RMS/IRM) nên dashboard không đọc được nội dung. Mở file bằng Excel vẫn xem bình thường, nhưng file đã mã hoá nên không bộ đọc Excel nào trên web mở được. Hãy mở file trong Excel rồi lưu một bản sao không khóa — Save As dạng "CSV UTF-8" là dễ nhất, hoặc đổi nhãn Sensitivity xuống mức không khóa rồi lưu bản sao .xlsx — và upload bản sao đó.'

/** File Excel của Prudential thường bị áp nhãn Restricted → mã hoá RMS/IRM.
 *  Dấu vết trong file OLE: các stream EncryptedPackage / DRMEncryptedDataSpace. */
export function isRmsProtected(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  const t = s.replace(/\x00/g, '')
  return t.includes('EncryptedPackage') || t.includes('DRMEncryptedDataSpace') || t.includes('Microsoft.Container.DataSpaces')
}

function extractFromWorkbook(wb) {
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('File không có sheet nào')
  const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
  let headerRowIdx = -1
  for (let i = 0; i < Math.min(allRows.length, 15); i++) {
    const r = allRows[i] || []
    if (r.some((c) => typeof c === 'string' && /agcode|msdl/i.test(c))) { headerRowIdx = i; break }
  }
  if (headerRowIdx === -1) throw new Error('Không tìm thấy dòng tiêu đề (cần có cột MSDL/AGCode)')
  const headers = (allRows[headerRowIdx] || []).map((h) => (h == null ? '' : String(h).trim()))
  // Các dòng phía trên tiêu đề (tên plan, ghi chú...) — dùng nhận diện tháng/năm của plan
  const preamble = allRows.slice(0, headerRowIdx)
    .map((r) => (r || []).filter((c) => c != null && c !== '').map(String).join(' '))
    .filter(Boolean)
  const rows = []
  for (let i = headerRowIdx + 1; i < allRows.length; i++) {
    const r = allRows[i] || []
    if (r.every((c) => c === null || c === '')) continue
    const joined = r.map((c) => String(c || '')).join(' ')
    if (/^TỔNG|TONG DỰ KIẾN|TONG DU KIEN/i.test(joined.trim())) continue
    rows.push(r)
  }
  return { headers, rows, preamble }
}

/** Đọc workbook Excel (.xlsx/.xls) → { headers, rows }. */
export function parseManmarkWorkbook(arrayBuffer) {
  if (isRmsProtected(arrayBuffer)) {
    const e = new Error(RMS_PROTECTED_MSG)
    e.code = 'RMS_PROTECTED'
    throw e
  }
  let wb
  try {
    wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' })
  } catch (err) {
    if (/encrypt|password/i.test(err?.message || '')) {
      const e = new Error('File Excel đang được bảo vệ bằng mật khẩu/khoá nên dashboard không đọc được. Hãy mở file trong Excel, lưu một bản sao không đặt mật khẩu (hoặc Save As dạng CSV UTF-8) rồi upload bản sao đó.')
      e.code = 'ENCRYPTED'
      throw e
    }
    throw err
  }
  return extractFromWorkbook(wb)
}

/** Đọc file CSV (bản sao Save As từ Excel) → { headers, rows }. */
export function parseManmarkCsvText(text) {
  return extractFromWorkbook(XLSX.read(text, { type: 'string' }))
}

/** Điểm vào duy nhất cho nút Upload: tự nhận diện Excel / CSV theo tên + magic bytes. */
export function parseManmarkUpload(arrayBuffer, fileName = '') {
  const b = new Uint8Array(arrayBuffer)
  const isZip = b[0] === 0x50 && b[1] === 0x4B // PK — .xlsx
  const isOle = b[0] === 0xD0 && b[1] === 0xCF // .xls / file RMS
  if (/\.csv$/i.test(fileName) || (!isZip && !isOle)) {
    return parseManmarkCsvText(new TextDecoder().decode(arrayBuffer))
  }
  return parseManmarkWorkbook(arrayBuffer)
}

function guessCol(headers, patterns) {
  for (const p of patterns) {
    const idx = headers.findIndex((h) => p.test(h))
    if (idx !== -1) return idx
  }
  return -1
}

/** Đoán cột từ tiêu đề — người dùng vẫn xác nhận/sửa lại ở màn hình mapping. */
export function guessManmarkColumns(headers) {
  const unitIdx = guessCol(headers, [/unit/i])
  const codeIdx = guessCol(headers, [/agcode/i, /^msdl$/i, /mã.*tvv/i])
  const nameIdx = guessCol(headers, [/agname/i, /tên.*tvv/i, /họ.*tên/i])
  const segmentIdx = guessCol(headers, [/ag.?segment/i, /segment/i])
  const monthIdx = guessCol(headers, [/^dự kiến tháng \d+$/i, /dự kiến tháng/i, /cam kết tháng/i, /mục tiêu/i])

  const weekFyp = {}, weekHs = {}
  headers.forEach((h, idx) => {
    let m = h.match(/FYP.*Tuần\s*(\d+)/i) || h.match(/Tuần\s*(\d+).*FYP/i) || h.match(/^W(\d+)\s*số/i)
    if (m) weekFyp[parseInt(m[1])] = idx
    m = h.match(/HS.*Tuần\s*(\d+)/i) || h.match(/Tuần\s*(\d+).*HS/i) || h.match(/^W(\d+)\s*hồ sơ/i)
    if (m) weekHs[parseInt(m[1])] = idx
  })
  const weekNums = Array.from(new Set([...Object.keys(weekFyp), ...Object.keys(weekHs)].map(Number))).sort((a, b) => a - b)

  const derivedWeeks = weekNums.map((n) => {
    const hIdx = weekFyp[n] ?? weekHs[n]
    const h = headers[hIdx] || ''
    const rm = h.match(/\((\d+)\s*[–\-]\s*(\d+)\)/)
    return rm ? { label: `Tuần ${n}`, start: parseInt(rm[1]), end: parseInt(rm[2]) } : null
  })

  return { unitIdx, codeIdx, nameIdx, segmentIdx, monthIdx, weekFyp, weekHs, weekNums, derivedWeeks }
}

/** Nhận tháng/năm của plan từ dòng tiêu đề trên đầu file, vd "PLAN THÁNG 11/2026 — ...". */
export function detectPlanMonth(preamble) {
  const text = (preamble || []).join(' ')
  const m = text.match(/tháng\s*(\d{1,2})\s*\/\s*(\d{4})/i)
  return m ? { month: parseInt(m[1]), year: parseInt(m[2]) } : null
}

// ─────────────────────────────────────────────────────────────
// Định dạng "Plan tháng" mà GA D07 đang dùng từ T11/2026
// (file MANMARK_-_T11.xlsx, sheet "Plan T11"):
// - Tiêu đề ở dòng 8: Xếp hạng | UnitCode | AGCode | AGName | AGSegment |
//   Mục tiêu PH T11 | W1 số (1–9) | W1 hồ sơ | W2 số (10–16) | W2 hồ sơ |
//   W3 số (17–23) | W3 hồ sơ | W4 số (24–30) | W4 hồ sơ | % W1+W2
// - Số tiền trong file tính bằng TRIỆU đồng; ManMark lưu theo NGHÌN đồng
//   → nhân 1000 (scale) khi nạp. Số hồ sơ giữ nguyên.
// - Khoảng ngày mỗi tuần nằm ngay trong tiêu đề cột "(1–9)" — lấy làm
//   cấu hình tuần của tháng đó.
// Nhận diện được định dạng này thì nạp thẳng, không cần xác nhận cột tay.
// ─────────────────────────────────────────────────────────────
export function detectPlanFormat(headers) {
  const codeIdx = guessCol(headers, [/agcode/i, /^msdl$/i])
  const monthIdx = guessCol(headers, [/mục tiêu/i])
  if (codeIdx === -1 || monthIdx === -1) return null
  const weekMoney = {}, weekCases = {}
  headers.forEach((h, idx) => {
    let m = h.match(/^W(\d+)\s*số/i)
    if (m) weekMoney[parseInt(m[1])] = idx
    m = h.match(/^W(\d+)\s*hồ sơ/i)
    if (m) weekCases[parseInt(m[1])] = idx
  })
  const weekNums = Object.keys(weekMoney).map(Number).sort((a, b) => a - b)
  if (!weekNums.length) return null
  const rangeOf = (idx) => {
    const rm = String(headers[idx] || '').match(/\((\d+)\s*[–\-]\s*(\d+)\)/)
    return rm ? { start: parseInt(rm[1]), end: parseInt(rm[2]) } : null
  }
  const weekCols = weekNums.map((n) => ({ n, fypIdx: weekMoney[n], hsIdx: weekCases[n] ?? -1 }))
  const weeks = []
  for (const n of weekNums) {
    const r = rangeOf(weekMoney[n]) || (weekCases[n] != null ? rangeOf(weekCases[n]) : null)
    if (!r) return null // thiếu khoảng ngày → không tự cấu hình, dùng luồng xác nhận tay
    weeks.push({ label: `Tuần ${n}`, start: r.start, end: r.end })
  }
  return {
    unitIdx: guessCol(headers, [/unit/i]),
    codeIdx,
    nameIdx: guessCol(headers, [/agname/i, /tên.*tvv/i, /họ.*tên/i]),
    segmentIdx: guessCol(headers, [/segment/i]),
    monthIdx,
    weekCols,
    weeks,
    scale: 1000, // triệu đồng (file) → nghìn đồng (ManMark)
  }
}

/**
 * Dựng commits từ dòng dữ liệu + mapping người dùng đã xác nhận.
 * mapping: { unitIdx, codeIdx, nameIdx, segmentIdx, monthIdx,
 *            weekCols: [{ n, fypIdx, hsIdx }] }
 * Trả về { commits, imported } — commits đã gộp với bản cũ (trừ khi replaceAll).
 */
export function buildManmarkCommits({ rows, mapping, existingCommits, replaceAll }) {
  const { unitIdx, codeIdx, nameIdx, segmentIdx, monthIdx, weekCols } = mapping
  const scale = mapping.scale || 1 // hệ số quy đổi tiền về nghìn đồng (Plan tháng: triệu → ×1000)
  const commits = replaceAll ? {} : { ...(existingCommits || {}) }
  const codes = []
  let imported = 0
  ;(rows || []).forEach((r) => {
    const rawCode = r[codeIdx]
    if (rawCode === null || rawCode === undefined || rawCode === '') return
    const code = String(rawCode).trim()
    if (!code) return
    const prev = commits[code] || {}
    const weekly = weekCols && weekCols.length
      ? weekCols.map((w) => ({
          fyp: w.fypIdx >= 0 ? parseAmount(r[w.fypIdx]) * scale : 0,
          hs: w.hsIdx >= 0 ? parseAmount(r[w.hsIdx]) : 0,
        }))
      : (prev.weekly || [])
    commits[code] = {
      unit: unitIdx >= 0 ? String(r[unitIdx] || '') : (prev.unit || ''),
      name: nameIdx >= 0 ? String(r[nameIdx] || '') : (prev.name || ''),
      segment: segmentIdx >= 0 ? String(r[segmentIdx] || '') : (prev.segment || ''),
      monthTarget: monthIdx >= 0 ? parseAmount(r[monthIdx]) * scale : (prev.monthTarget || 0),
      weekly,
    }
    codes.push(code)
    imported++
  })
  return { commits, imported, codes }
}
