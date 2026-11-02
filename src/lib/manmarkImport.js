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

/** Đọc workbook → { headers, rows } hoặc ném lỗi có thông điệp rõ ràng. */
export function parseManmarkWorkbook(arrayBuffer) {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' })
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
  const rows = []
  for (let i = headerRowIdx + 1; i < allRows.length; i++) {
    const r = allRows[i] || []
    if (r.every((c) => c === null || c === '')) continue
    const joined = r.map((c) => String(c || '')).join(' ')
    if (/^TỔNG|TONG DỰ KIẾN|TONG DU KIEN/i.test(joined.trim())) continue
    rows.push(r)
  }
  return { headers, rows }
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
  const monthIdx = guessCol(headers, [/^dự kiến tháng \d+$/i, /dự kiến tháng/i, /cam kết tháng/i])

  const weekFyp = {}, weekHs = {}
  headers.forEach((h, idx) => {
    let m = h.match(/FYP.*Tuần\s*(\d+)/i) || h.match(/Tuần\s*(\d+).*FYP/i)
    if (m) weekFyp[parseInt(m[1])] = idx
    m = h.match(/HS.*Tuần\s*(\d+)/i) || h.match(/Tuần\s*(\d+).*HS/i)
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

/**
 * Dựng commits từ dòng dữ liệu + mapping người dùng đã xác nhận.
 * mapping: { unitIdx, codeIdx, nameIdx, segmentIdx, monthIdx,
 *            weekCols: [{ n, fypIdx, hsIdx }] }
 * Trả về { commits, imported } — commits đã gộp với bản cũ (trừ khi replaceAll).
 */
export function buildManmarkCommits({ rows, mapping, existingCommits, replaceAll }) {
  const { unitIdx, codeIdx, nameIdx, segmentIdx, monthIdx, weekCols } = mapping
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
          fyp: w.fypIdx >= 0 ? parseAmount(r[w.fypIdx]) : 0,
          hs: w.hsIdx >= 0 ? parseAmount(r[w.hsIdx]) : 0,
        }))
      : (prev.weekly || [])
    commits[code] = {
      unit: unitIdx >= 0 ? String(r[unitIdx] || '') : (prev.unit || ''),
      name: nameIdx >= 0 ? String(r[nameIdx] || '') : (prev.name || ''),
      segment: segmentIdx >= 0 ? String(r[segmentIdx] || '') : (prev.segment || ''),
      monthTarget: monthIdx >= 0 ? parseAmount(r[monthIdx]) : (prev.monthTarget || 0),
      weekly,
    }
    codes.push(code)
    imported++
  })
  return { commits, imported, codes }
}
