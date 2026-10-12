import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  useManMark, saveManMark, useReportsDoc, usePendingCases,
  useAuth, getDocOnce, normalizeAgent,
} from '../lib/db'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import * as XLSX from 'xlsx'

// ─────────────────────────────────────────────────────────────
// ManMark — Theo dõi cam kết tuần (port từ public/manmark.html)
// ─────────────────────────────────────────────────────────────
// Logic nghiệp vụ giữ nguyên bản gốc:
// - Cam kết tuần (FYP/HS) + ghi chú lưu ở manmark/{yyyy-m}
// - Thực đạt: 2 nguồn — Sales Report nhập tay (reports/{yyyy-m}, tách
//   Đã chắc issued/PH vs Tiềm năng) hoặc TVV Hàng Ngày chính thức
//   (daily_sales_tvv, số lũy kế → delta theo tuần)
// - Đơn vị: cam kết nhập theo nghìn đồng, số gốc tính bằng đồng →
//   chia 1000 (UNIT_DIV) để cùng đơn vị
// - Dự báo 3 kịch bản + tỷ lệ chuyển đổi lịch sử + z-score cảnh báo
// ─────────────────────────────────────────────────────────────

const UNIT_DIV = 1000
const CONV_MIN_PERSONAL = 5
const CONV_MIN_UNIT = 15
const CONV_DEFAULT_RATE = 0.5

const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n }
const fmt = (n) => Math.round(Number(n || 0)).toLocaleString('vi-VN')
const daysInMonth = (y, m) => new Date(y, m, 0).getDate()
const pad2 = (n) => String(n).padStart(2, '0')

function defaultWeeks(y, m) {
  const total = daysInMonth(y, m)
  return [
    { label: 'Tuần 1', start: 1, end: 7 },
    { label: 'Tuần 2', start: 8, end: 14 },
    { label: 'Tuần 3', start: 15, end: 21 },
    { label: 'Tuần 4', start: 22, end: total },
  ]
}

function statusClass(actual, target) {
  target = num(target); actual = num(actual)
  if (!target) return 'status-gray'
  const pct = actual / target
  if (pct >= 1) return 'status-green'
  if (pct >= 0.7) return 'status-amber'
  return 'status-red'
}

// Tách "Đã chắc" (status=issued/PH) và "Tiềm năng" (paid/CP hoặc none/CF)
function actualsForPerson(person, weeks) {
  const res = weeks.map(() => ({ fyp: 0, hs: 0, confirmedFyp: 0, confirmedHs: 0, potentialFyp: 0, potentialHs: 0 }))
  if (!person || !person.daily) return res
  Object.keys(person.daily).forEach((dayKey) => {
    const day = parseInt(dayKey)
    const wIdx = weeks.findIndex((w) => day >= w.start && day <= w.end)
    if (wIdx === -1) return
    const cases = person.daily[dayKey]?.cases || []
    cases.forEach((c) => {
      const fee = num(c.fee) / UNIT_DIV
      res[wIdx].fyp += fee; res[wIdx].hs += 1
      if (c.status === 'issued') { res[wIdx].confirmedFyp += fee; res[wIdx].confirmedHs += 1 }
      else { res[wIdx].potentialFyp += fee; res[wIdx].potentialHs += 1 }
    })
  })
  return res
}

// Nguồn chính thức: mỗi ngày là số lũy kế trong tháng → delta theo tuần
function officialActualsForCode(official, code, weeks) {
  const res = weeks.map(() => ({ fyp: 0, fyc: 0, caseNet: 0, ipNet: 0 }))
  let prev = { fyp: 0, fyc: 0, caseNet: 0, ipNet: 0 }
  official.dates.forEach((dateStr) => {
    const day = parseInt(dateStr.slice(8, 10))
    const a = official.agents[dateStr]?.[code]
    const cur = a
      ? { fyp: num(a.fyp) / UNIT_DIV, fyc: num(a.fyc) / UNIT_DIV, caseNet: num(a.caseNet), ipNet: num(a.ipNet) / UNIT_DIV }
      : prev
    const wIdx = weeks.findIndex((w) => day >= w.start && day <= w.end)
    if (wIdx !== -1) {
      res[wIdx].fyp += cur.fyp - prev.fyp
      res[wIdx].fyc += cur.fyc - prev.fyc
      res[wIdx].caseNet += cur.caseNet - prev.caseNet
      res[wIdx].ipNet += cur.ipNet - prev.ipNet
    }
    prev = cur
  })
  return res
}

function officialLatestForCode(official, code) {
  for (let i = official.dates.length - 1; i >= 0; i--) {
    const a = official.agents[official.dates[i]]?.[code]
    if (a) return { fyp: num(a.fyp) / UNIT_DIV, fyc: num(a.fyc) / UNIT_DIV, caseNet: num(a.caseNet), ipNet: num(a.ipNet) / UNIT_DIV }
  }
  return { fyp: 0, fyc: 0, caseNet: 0, ipNet: 0 }
}

function officialAgentInfoForCode(official, code) {
  for (let i = official.dates.length - 1; i >= 0; i--) {
    const a = official.agents[official.dates[i]]?.[code]
    if (a) return { unit: a.unit || '', agName: a.agName || '', agSeg: a.agSeg || '' }
  }
  return null
}

// Giá trị hồ sơ đang Pending / Pipeline (tiềm năng), theo MSDL — lấy từ
// daily_sales_tvv (ngày mới nhất trong tháng); pending_cases chỉ giữ statuses
function pendingValueByCode(official, statuses, code) {
  const norm = (r) => ({
    proposalNum: r.proposalNum, productName: r.product,
    ape: num(r.ape) / UNIT_DIV, proposalDate: r.proposalDate, msdl: r.msdl,
  })
  const mine = (rows) => rows
    .map(normalizeAgent)
    .filter((r) => String(r.msdl || '').trim() === String(code).trim())
    .map(norm)
  const pendingMine = mine(official.pendingRows).filter(
    (r) => (statuses[`${r.proposalNum}::${r.msdl}`] ?? statuses[String(r.proposalNum)]) !== 'WD'
  )
  const pipelineMine = mine(official.pipelineRows)
  const pendApe = pendingMine.reduce((s, r) => s + num(r.ape), 0)
  const pipeApe = pipelineMine.reduce((s, r) => s + num(r.ape), 0)
  return {
    value: pendApe + pipeApe,
    count: pendingMine.length + pipelineMine.length,
    cases: pendingMine.concat(pipelineMine),
    pendingApe: pendApe, pipelineApe: pipeApe,
  }
}

// Xu hướng theo tháng: mảng 12 tháng + MA3 + z-score tháng gần nhất đã hoàn tất
function monthlyTrendForCode(yearly, curM, code) {
  const months = []
  for (let m = 1; m <= 12; m++) {
    const h = yearly[m]
    if (!h) { months.push({ m, commit: 0, actual: 0 }); continue }
    const commit = h.commits?.[code]?.monthTarget || 0
    const person = (h.reportData || []).find((p) => String(p?.msdl || '').trim() === String(code).trim())
    let actual = 0
    if (person && person.daily) {
      Object.values(person.daily).forEach((d) => {
        (d?.cases || []).forEach((c) => { actual += num(c.fee) / UNIT_DIV })
      })
    }
    months.push({ m, commit, actual })
  }
  const ma3 = months.map((_, i) => {
    const slice = months.slice(Math.max(0, i - 2), i + 1).map((x) => x.actual)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
  const priorWithData = months.filter((x) => x.m < curM && x.actual > 0)
  let z = null, trendDir = 'flat', baselineMean = null, baselineStd = null, lastCompletedMonth = null
  if (priorWithData.length >= 4) {
    lastCompletedMonth = priorWithData[priorWithData.length - 1]
    const baseline = priorWithData.slice(0, -1)
    const mean = baseline.reduce((s, x) => s + x.actual, 0) / baseline.length
    const variance = baseline.reduce((s, x) => s + Math.pow(x.actual - mean, 2), 0) / baseline.length
    const std = Math.sqrt(variance)
    baselineMean = mean; baselineStd = std
    if (std > 0) {
      z = (lastCompletedMonth.actual - mean) / std
      if (z <= -1.5) trendDir = 'down'; else if (z >= 1.5) trendDir = 'up'
    }
  }
  return { months, ma3, trendDir, z, baselineMean, baselineStd, lastCompletedMonth }
}

// Tỷ lệ chuyển đổi từ lịch sử THẬT các tháng đã qua trong năm
function buildConversionIndex(yearly, curM) {
  const byCode = {}, byUnit = {}
  for (let m = 1; m < curM; m++) {
    const h = yearly[m]
    if (!h) continue
    (h.reportData || []).forEach((p) => {
      if (!p?.daily) return
      const code = String(p.msdl || '').trim()
      if (!code) return
      const unit = String(p.group || '').trim()
      byCode[code] = byCode[code] || { issuedSum: 0, totalSum: 0, issuedCount: 0, totalCount: 0 }
      byUnit[unit] = byUnit[unit] || { issuedSum: 0, totalSum: 0, issuedCount: 0, totalCount: 0 }
      Object.values(p.daily).forEach((d) => {
        (d?.cases || []).forEach((c) => {
          const fee = num(c.fee), issued = c.status === 'issued'
          byCode[code].totalSum += fee; byCode[code].totalCount++
          byUnit[unit].totalSum += fee; byUnit[unit].totalCount++
          if (issued) { byCode[code].issuedSum += fee; byCode[code].issuedCount++; byUnit[unit].issuedSum += fee; byUnit[unit].issuedCount++ }
        })
      })
    })
  }
  return { byCode, byUnit }
}

function personalConversionRate(idx, code, unit) {
  const p = idx.byCode[code]
  if (p && p.totalCount >= CONV_MIN_PERSONAL) {
    return { rate: p.totalSum ? p.issuedSum / p.totalSum : CONV_DEFAULT_RATE, source: 'personal', sample: p.totalCount }
  }
  const u = idx.byUnit[unit]
  if (u && u.totalCount >= CONV_MIN_UNIT) {
    return { rate: u.totalSum ? u.issuedSum / u.totalSum : CONV_DEFAULT_RATE, source: 'unit', sample: u.totalCount }
  }
  return { rate: CONV_DEFAULT_RATE, source: 'default', sample: 0 }
}

function buildRows({ mm, weeks, reportData, official, statuses, yearly, actualSource, todayDay, curMonth }) {
  const codes = new Set(Object.keys(mm.commits || {}))
  reportData.forEach((p) => { if (p && p.msdl) codes.add(String(p.msdl).trim()) })
  if (actualSource === 'official') {
    official.dates.forEach((d) => { Object.keys(official.agents[d] || {}).forEach((c) => codes.add(String(c).trim())) })
  }
  const excluded = mm.excluded || {}
  const list = [...codes].filter((c) => c && !excluded[c])
  const convIdx = buildConversionIndex(yearly, curMonth)
  return list.map((code) => {
    const commit = mm.commits?.[code]
    const person = reportData.find((p) => String(p?.msdl || '').trim() === code)
    const offInfo = actualSource === 'official' ? officialAgentInfoForCode(official, code) : null
    const isNew = !commit
    const unit = commit?.unit || person?.group || offInfo?.unit || ''
    const segment = commit?.segment || offInfo?.agSeg || ''
    const name = commit?.name || person?.name || offInfo?.agName || '(chưa rõ tên)'
    const monthTarget = commit?.monthTarget || 0
    const weekly = commit?.weekly || weeks.map(() => ({ fyp: 0, hs: 0 }))
    let actuals, monthActual, monthConfirmed, monthPotential
    if (actualSource === 'official') {
      const offWeeks = officialActualsForCode(official, code, weeks)
      const latest = officialLatestForCode(official, code)
      actuals = offWeeks.map((w) => ({ fyp: w.fyp, hs: w.caseNet, confirmedFyp: w.fyp, confirmedHs: w.caseNet, potentialFyp: 0, potentialHs: 0 }))
      monthActual = latest.fyp
      monthConfirmed = latest.fyp
      monthPotential = 0
    } else {
      actuals = actualsForPerson(person, weeks)
      monthActual = actuals.reduce((s, a) => s + a.fyp, 0)
      monthConfirmed = actuals.reduce((s, a) => s + a.confirmedFyp, 0)
      monthPotential = actuals.reduce((s, a) => s + a.potentialFyp, 0)
    }
    const pending = pendingValueByCode(official, statuses, code)
    const conv = personalConversionRate(convIdx, code, unit)
    const convertible = monthPotential + pending.value
    const forecastLow = monthConfirmed
    const forecastMid = monthConfirmed + convertible * conv.rate
    const forecastHigh = monthConfirmed + convertible
    const weeksData = weeks.map((w, wi) => ({
      ckfyp: (weekly[wi] || {}).fyp || 0,
      tdfyp: (actuals[wi] || {}).fyp || 0,
      confirmedFyp: (actuals[wi] || {}).confirmedFyp || 0,
      potentialFyp: (actuals[wi] || {}).potentialFyp || 0,
      ckhs: (weekly[wi] || {}).hs || 0,
      tdhs: (actuals[wi] || {}).hs || 0,
      confirmedHs: (actuals[wi] || {}).confirmedHs || 0,
      potentialHs: (actuals[wi] || {}).potentialHs || 0,
      note: mm.notes?.[code]?.[wi] || '',
      passed: w.end <= todayDay,
      miss: w.end <= todayDay && (weekly[wi]?.fyp || 0) > 0 && (actuals[wi]?.fyp || 0) < (weekly[wi]?.fyp || 0),
    }))
    let consecutiveMiss = 0, maxConsecutiveMiss = 0
    weeksData.forEach((wd) => {
      if (wd.passed) { consecutiveMiss = wd.miss ? consecutiveMiss + 1 : 0; maxConsecutiveMiss = Math.max(maxConsecutiveMiss, consecutiveMiss) }
    })
    const trend = monthlyTrendForCode(yearly, curMonth, code)
    return {
      code, unit, segment, name, monthTarget, monthActual,
      monthDiff: monthActual - monthTarget,
      monthConfirmed, monthPotential, pending,
      forecast: forecastMid, forecastLow, forecastMid, forecastHigh, conv,
      maxConsecutiveMiss, trend, isNew, weeks: weeksData,
    }
  })
}

function getColValue(row, colId) {
  if (colId === 'unit') return row.unit
  if (colId === 'segment') return row.segment
  if (colId === 'code') return row.code
  if (colId === 'name') return row.name
  if (colId === 'monthTarget') return row.monthTarget
  if (colId === 'monthActual') return row.monthActual
  if (colId === 'monthDiff') return row.monthDiff
  if (colId === 'pending') return row.pending.value
  if (colId === 'forecast') return row.forecast
  const m = colId.match(/^w(\d+)_(ckfyp|tdfyp|ckhs|tdhs|note)$/)
  if (m) return row.weeks[+m[1]]?.[m[2]]
  return ''
}

function isNumericCol(colId) {
  return colId !== 'unit' && colId !== 'segment' && colId !== 'code' && colId !== 'name' && !colId.endsWith('_note')
}

// ── Ô filter text + dropdown multi-select (định nghĩa ngoài component
// để React không remount input mỗi lần render → không mất focus khi gõ)
function FilterInput({ value, onChange }) {
  return (
    <input
      className="mm-filter-input"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function MultiFilter({ options, selected, onToggle }) {
  const sel = selected || []
  const btnLabel = !sel.length ? 'Tất cả' : sel.length <= 2 ? sel.join(', ') : `${sel.length} đã chọn`
  return (
    <details className="mm-ddown">
      <summary className="mm-ddown-btn">{btnLabel}</summary>
      <div className="mm-ddown-panel">
        {options.length ? options.map((o) => (
          <label key={o} className="mm-ddown-item">
            <input type="checkbox" checked={sel.includes(o)} onChange={() => onToggle(o)} /> {o}
          </label>
        )) : <div style={{ padding: 4, color: '#9aa4ba', fontSize: 11 }}>(chưa có)</div>}
      </div>
    </details>
  )
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function ManMarkTab() {
  const nowD = new Date()
  const [year, setYear] = useState(nowD.getFullYear())
  const [month, setMonth] = useState(nowD.getMonth() + 1)
  const { user, isAdmin } = useAuth()
  const { data: mmRaw, loading: mmLoading } = useManMark(year, month)
  const { data: repDoc, loading: repLoading } = useReportsDoc(year, month)
  const { data: pendingDoc } = usePendingCases()

  // Dữ liệu "chính thức" cả tháng từ daily_sales_tvv (lấy qua data layer,
  // từng ngày trong tháng — đủ để tính delta theo tuần + pending/pipeline)
  const [official, setOfficial] = useState({ dates: [], agents: {}, pendingRows: [], pipelineRows: [] })
  const [officialLoading, setOfficialLoading] = useState(true)

  // Lịch sử cả năm (cho xu hướng tháng + tỷ lệ chuyển đổi + z-score)
  const [yearly, setYearly] = useState({})

  // UI state
  const [quick, setQuick] = useState('all')
  const [weekSel, setWeekSel] = useState('all')
  const [compact, setCompact] = useState(false)
  const [sort, setSort] = useState({ col: 'name', dir: 'asc' })
  const [filters, setFilters] = useState({})
  const [drafts, setDrafts] = useState({})       // giá trị đang gõ trong ô input
  const [saveState, setSaveState] = useState('idle') // idle|saving|saved|error
  const [showAddTvv, setShowAddTvv] = useState(false)
  const [showWeekCfg, setShowWeekCfg] = useState(false)
  const [detailCode, setDetailCode] = useState(null)

  // ManMark doc gộp với giá trị mặc định
  const mm = useMemo(() => {
    const m = mmRaw || {}
    return {
      weeks: (m.weeks && m.weeks.length) ? m.weeks : defaultWeeks(year, month),
      commits: m.commits || {},
      notes: m.notes || {},
      excluded: m.excluded || {},
      dataSource: m.dataSource === 'official' ? 'official' : 'salesreport',
      weeksSeeded: m.weeksSeeded,
    }
  }, [mmRaw, year, month])
  const mmRef = useRef(mm)
  useEffect(() => { mmRef.current = mm }, [mm])

  const reportData = useMemo(() => {
    const raw = repDoc?.data
    const arr = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : [])
    return arr.map(normalizeAgent)
  }, [repDoc])

  const statuses = pendingDoc?.statuses || {}
  const actualSource = mm.dataSource
  const weeks = mm.weeks
  const todayDay = (month === nowD.getMonth() + 1 && year === nowD.getFullYear()) ? nowD.getDate() : 999
  const curWeekIdx = (month === nowD.getMonth() + 1 && year === nowD.getFullYear())
    ? weeks.findIndex((w) => nowD.getDate() >= w.start && nowD.getDate() <= w.end)
    : -1
  const wkVisible = (wi) => {
    if (weekSel === 'all') return true
    if (weekSel === 'cur') return curWeekIdx === -1 || curWeekIdx === wi
    return String(wi) === String(weekSel)
  }

  // ── Load daily_sales_tvv cả tháng ──
  useEffect(() => {
    let cancelled = false
    setOfficialLoading(true)
    const total = daysInMonth(year, month)
    const jobs = []
    for (let d = 1; d <= total; d++) {
      const key = `${year}-${pad2(month)}-${pad2(d)}`
      jobs.push(
        getDocOnce('daily_sales_tvv', key)
          .then((doc) => ({ key, doc }))
          .catch(() => ({ key, doc: null }))
      )
    }
    Promise.all(jobs).then((results) => {
      if (cancelled) return
      const dates = []
      const agents = {}
      results.forEach(({ key, doc }) => {
        if (doc) { dates.push(key); agents[key] = doc.agents || {} }
      })
      dates.sort()
      let pendingRows = [], pipelineRows = []
      if (dates.length) {
        const latest = results.find((r) => r.key === dates[dates.length - 1])?.doc || {}
        pendingRows = (latest.pendingRows || []).map(normalizeAgent)
        pipelineRows = (latest.pipelineRows || []).map(normalizeAgent)
      }
      setOfficial({ dates, agents, pendingRows, pipelineRows })
      setOfficialLoading(false)
    })
    return () => { cancelled = true }
  }, [year, month])

  // ── Load lịch sử 12 tháng của năm ──
  useEffect(() => {
    let cancelled = false
    Promise.all(
      Array.from({ length: 12 }, (_, i) => i + 1).map(async (m) => {
        try {
          const [rep, mmDoc] = await Promise.all([
            getDocOnce('reports', `${year}-${m}`),
            getDocOnce('manmark', `${year}-${m}`),
          ])
          const raw = rep?.data
          const rData = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : [])
          return { m, reportData: rData.map(normalizeAgent), commits: mmDoc?.commits || {} }
        } catch { return { m, reportData: [], commits: {} } }
      })
    ).then((rs) => {
      if (cancelled) return
      const h = {}
      rs.forEach((r) => { h[r.m] = r })
      setYearly(h)
    })
    return () => { cancelled = true }
  }, [year])

  // Đổi tháng → xóa draft đang gõ dở
  useEffect(() => { setDrafts({}) }, [year, month])

  // ── Lưu manmark (debounce 500ms như bản gốc) ──
  const saveTimer = useRef(null)
  const persist = useCallback((next) => {
    clearTimeout(saveTimer.current)
    setSaveState('saving')
    saveTimer.current = setTimeout(async () => {
      try {
        await saveManMark(year, month, {
          weeks: next.weeks,
          commits: next.commits,
          notes: next.notes,
          excluded: next.excluded,
          dataSource: next.dataSource,
          weeksSeeded: next.weeksSeeded,
        }, user?.email || 'unknown')
        setSaveState('saved')
        setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000)
      } catch (e) {
        console.error('[ManMark] save error:', e)
        setSaveState('error')
      }
    }, 500)
  }, [year, month, user])

  const updateMm = useCallback((fn) => {
    const base = structuredClone(mmRef.current)
    fn(base)
    mmRef.current = base
    persist(base)
  }, [persist])

  const ensureCommit = (next, code) => {
    if (!next.commits[code]) {
      const person = reportData.find((p) => String(p?.msdl || '').trim() === code)
      next.commits[code] = {
        unit: '', name: person?.name || '', segment: '',
        monthTarget: 0, weekly: next.weeks.map(() => ({ fyp: 0, hs: 0 })),
      }
    }
    if (!next.commits[code].weekly) next.commits[code].weekly = next.weeks.map(() => ({ fyp: 0, hs: 0 }))
    while (next.commits[code].weekly.length < next.weeks.length) next.commits[code].weekly.push({ fyp: 0, hs: 0 })
  }

  // ── Build rows ──
  const allRows = useMemo(() => buildRows({
    mm, weeks, reportData, official, statuses, yearly, actualSource, todayDay, curMonth: month,
  }), [mm, weeks, reportData, official, statuses, yearly, actualSource, todayDay, month])

  const rows = useMemo(() => {
    let out = allRows
    if (quick === 'warn') out = out.filter((r) => r.maxConsecutiveMiss >= 2)
    if (quick === 'below') out = out.filter((r) => r.monthTarget > 0 && r.monthActual < r.monthTarget)
    if (quick === 'fcLow') out = out.filter((r) => r.monthTarget > 0 && r.forecast < r.monthTarget)
    if (quick === 'new') out = out.filter((r) => r.isNew)
    Object.keys(filters).forEach((colId) => {
      const f = filters[colId]
      if (colId === 'unit' || colId === 'segment') {
        if (Array.isArray(f) && f.length) out = out.filter((r) => f.includes(getColValue(r, colId)))
        return
      }
      const fs = (f || '').trim().toLowerCase()
      if (!fs) return
      out = out.filter((r) => String(getColValue(r, colId) ?? '').toLowerCase().includes(fs))
    })
    const col = sort.col
    if (col) {
      const dir = sort.dir === 'asc' ? 1 : -1
      const numeric = isNumericCol(col)
      out = [...out].sort((a, b) => {
        const va = getColValue(a, col), vb = getColValue(b, col)
        if (numeric) return (num(va) - num(vb)) * dir
        return String(va || '').localeCompare(String(vb || ''), 'vi') * dir
      })
    }
    return out
  }, [allRows, quick, filters, sort])

  const unitOptions = useMemo(() => [...new Set(allRows.map((r) => r.unit).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [allRows])
  const segmentOptions = useMemo(() => [...new Set(allRows.map((r) => r.segment).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi')), [allRows])

  // ── Inline edit helpers (draft → blur mới lưu) ──
  const draftVal = (key, fallback) => (key in drafts ? drafts[key] : fallback)
  const setDraft = (key, v) => setDrafts((d) => ({ ...d, [key]: v }))
  const commitDraft = (key, apply) => {
    if (!(key in drafts)) return
    const v = drafts[key]
    setDrafts((d) => { const n = { ...d }; delete n[key]; return n })
    apply(v)
  }

  const onSegment = (code) => (v) => updateMm((next) => { ensureCommit(next, code); next.commits[code].segment = String(v || '').trim() })
  const onMonthTarget = (code) => (v) => updateMm((next) => { ensureCommit(next, code); next.commits[code].monthTarget = num(v) })
  const onWeekField = (code, wi, field) => (v) => updateMm((next) => {
    ensureCommit(next, code); next.commits[code].weekly[wi][field] = num(v)
  })
  const onNote = (code, wi) => (v) => updateMm((next) => {
    next.notes[code] = next.notes[code] || {}
    next.notes[code][wi] = v
  })

  const deleteRow = (code) => {
    if (!window.confirm(`Xoá TVV ${code} khỏi ManMark?\n(Nếu TVV này vẫn có hồ sơ trong Sales Report, sẽ không tự hiện lại nữa cho tới khi bạn Thêm TVV lại thủ công.)`)) return
    updateMm((next) => {
      if (next.commits) delete next.commits[code]
      if (next.notes) delete next.notes[code]
      next.excluded[code] = true
    })
  }

  const setActualSource = (v) => updateMm((next) => { next.dataSource = v })

  // ── Tổng hợp ──
  const totals = useMemo(() => {
    const t = { count: rows.length, monthCommit: 0, monthActual: 0, pending: 0, forecast: 0 }
    const wt = weeks.map(() => ({ ckFyp: 0, tdFyp: 0, ckHs: 0, tdHs: 0 }))
    rows.forEach((r) => {
      t.monthCommit += r.monthTarget; t.monthActual += r.monthActual
      t.pending += r.pending.value; t.forecast += r.forecast
      r.weeks.forEach((wd, wi) => { wt[wi].ckFyp += wd.ckfyp; wt[wi].tdFyp += wd.tdfyp; wt[wi].ckHs += wd.ckhs; wt[wi].tdHs += wd.tdhs })
    })
    return { ...t, weekTotals: wt }
  }, [rows, weeks])

  const toggleSort = (colId) => setSort((s) => s.col === colId
    ? { col: colId, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { col: colId, dir: 'asc' })
  const arrow = (colId) => sort.col === colId ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''

  const setFilter = (colId, v) => setFilters((f) => ({ ...f, [colId]: v }))
  const toggleMultiFilter = (colId, opt) => setFilters((f) => {
    const arr = Array.isArray(f[colId]) ? [...f[colId]] : []
    const i = arr.indexOf(opt)
    if (i > -1) arr.splice(i, 1); else arr.push(opt)
    return { ...f, [colId]: arr }
  })

  const loading = mmLoading || repLoading
  const saveLabel = saveState === 'saving' ? '⏳ Đang lưu...'
    : saveState === 'saved' ? '✓ Đã lưu'
    : saveState === 'error' ? '⚠ Lỗi lưu' : (mmRaw?.updatedBy ? `Cập nhật: ${mmRaw.updatedBy}` : '')

  // ── Export Excel ──
  const exportExcel = () => {
    const header = ['STT', 'Unit', 'Mã TVV', 'Tên TVV', 'AG Segment', 'Cam kết tháng', 'Thực đạt tháng', 'Chênh lệch', 'Pending', 'Dự báo tháng']
    weeks.forEach((w) => header.push(`${w.label} CK FYP`, `${w.label} TĐ FYP`, `${w.label} CK HS`, `${w.label} TĐ HS`, `${w.label} Ghi chú`))
    const aoa = [header]
    rows.forEach((row, i) => {
      const r = [i + 1, row.unit, row.code, row.name, row.segment, row.monthTarget, row.monthActual, Math.round(row.monthDiff), row.pending.value, Math.round(row.forecast)]
      row.weeks.forEach((wd) => r.push(wd.ckfyp, wd.tdfyp, wd.ckhs, wd.tdhs, wd.note))
      aoa.push(r)
    })
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ManMark')
    XLSX.writeFile(wb, `ManMark_T${month}_${year}.xlsx`)
  }

  const visWeeks = weeks.map((w, wi) => ({ w, wi })).filter(({ wi }) => wkVisible(wi))
  const detailRow = detailCode ? allRows.find((r) => r.code === detailCode) : null
  const pct = totals.monthCommit ? Math.round(totals.monthActual / totals.monthCommit * 100) : 0
  const fpct = totals.monthCommit ? Math.round(totals.forecast / totals.monthCommit * 100) : 0
  const curY = nowD.getFullYear()

  const btnStyle = (bg, color) => ({
    padding: '6px 12px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', background: bg, color, whiteSpace: 'nowrap',
  })

  return (
    <div className="page-content">
      <style>{MM_CSS}</style>

      {/* ── Toolbar ── */}
      <div className="card" style={{ marginBottom: 12, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8896aa' }}>Tháng</span>
          <select value={month} onChange={(e) => setMonth(+e.target.value)} style={btnStyle('#fff', '#1a1f36')}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>Tháng {m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(+e.target.value)} style={btnStyle('#fff', '#1a1f36')}>
            {[curY - 1, curY, curY + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8896aa' }}>Nguồn thực đạt</span>
          <select
            value={actualSource}
            disabled={!isAdmin}
            title={isAdmin ? '' : 'Chỉ admin được đổi nguồn'}
            onChange={(e) => setActualSource(e.target.value)}
            style={btnStyle('#fff', '#1a1f36')}
          >
            <option value="salesreport">Sales Report (nhập tay)</option>
            <option value="official">TVV Hàng Ngày (chính thức)</option>
          </select>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8896aa' }}>Xem nhanh</span>
          <select value={quick} onChange={(e) => setQuick(e.target.value)} style={btnStyle('#fff', '#1a1f36')}>
            <option value="all">Tất cả TVV</option>
            <option value="warn">⚠️ Trễ cam kết ≥2 tuần</option>
            <option value="below">Chưa đạt cam kết tháng</option>
            <option value="fcLow">Dự báo thấp hơn cam kết</option>
            <option value="new">Chưa có cam kết</option>
          </select>
          <select value={weekSel} onChange={(e) => setWeekSel(e.target.value)} title="Chỉ hiện cột của 1 tuần" style={btnStyle('#fff', '#1a1f36')}>
            <option value="all">Tất cả tuần</option>
            <option value="cur">Tuần hiện tại</option>
            {weeks.map((w, wi) => <option key={wi} value={wi}>{w.label} ({w.start}–{w.end})</option>)}
          </select>
          <button onClick={() => setCompact((c) => !c)} title="Thu gọn dòng để xem được nhiều TVV hơn" style={btnStyle('#f1f3f9', '#5b6478')}>
            {compact ? '↕ Rộng' : '↕ Gọn'}
          </button>
          {isAdmin && (
            <>
              <button onClick={() => setShowWeekCfg(true)} style={btnStyle('#eef2ff', '#4361ee')}>📅 Cấu hình tuần</button>
              <button onClick={() => setShowAddTvv(true)} style={btnStyle('#e6faf2', '#065f46')}>＋ Thêm TVV</button>
            </>
          )}
          <button onClick={exportExcel} style={btnStyle('#fef3c7', '#92400e')}>⬇ Xuất Excel</button>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: saveState === 'error' ? '#991b1b' : saveState === 'saved' ? '#065f46' : '#92400e' }}>
            {saveLabel}
          </span>
        </div>
        {!isAdmin && (
          <div style={{ fontSize: 11, color: '#8896aa', marginTop: 8 }}>
            👁 Chế độ xem — chỉ tài khoản admin mới được nhập/sửa cam kết.
            {officialLoading ? ' Đang tải số liệu chính thức…' : ''}
          </div>
        )}
      </div>

      {/* ── KPI ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { cls: 'c1', label: 'Tổng TVV', value: totals.count, color: '#1a1f36' },
          { cls: 'c1', label: 'Cam kết tháng', value: fmt(totals.monthCommit), color: '#1a1f36' },
          {
            cls: 'c2', label: actualSource === 'official' ? 'Thực đạt tháng · CHÍNH THỨC' : 'Thực đạt tháng · NHẬP TAY',
            value: fmt(totals.monthActual), color: '#4361ee',
          },
          { cls: 'c3', label: '% Đạt', value: `${pct}%`, color: pct >= 100 ? '#0f9d58' : pct >= 70 ? '#b45309' : '#c0243c' },
          { cls: 'c4', label: 'Dự báo tháng', value: fmt(Math.round(totals.forecast)), color: fpct >= 100 ? '#0f9d58' : fpct >= 70 ? '#b45309' : '#c0243c' },
        ].map((k, i) => (
          <div key={i} className={`kpi-card ${k.cls}`} style={{ flex: '1 1 150px' }}>
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value" style={{ color: k.color }}>{k.value}</div>
            <div className="kpi-unit">nghìn đồng</div>
          </div>
        ))}
      </div>

      {/* ── Bảng cam kết tuần ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div className="loading"><div className="spinner" /><div>Đang tải dữ liệu ManMark…</div></div>
          ) : (
            <table className="mm-table" style={compact ? { fontSize: 10 } : undefined}>
              <thead>
                <tr>
                  <th rowSpan="3" style={{ minWidth: 30 }}>STT</th>
                  <th rowSpan="3" className="sortable" onClick={() => toggleSort('unit')}>Unit{arrow('unit')}</th>
                  <th rowSpan="3" className="sortable" onClick={() => toggleSort('code')}>Mã TVV{arrow('code')}</th>
                  <th rowSpan="3" className="sortable" onClick={() => toggleSort('name')} style={{ minWidth: 140, textAlign: 'left' }}>Tên TVV{arrow('name')}</th>
                  <th rowSpan="3" className="sortable" onClick={() => toggleSort('segment')} style={{ minWidth: 80 }}>AG Segment{arrow('segment')}</th>
                  <th rowSpan="3" className="sortable" onClick={() => toggleSort('monthTarget')} style={{ minWidth: 80 }}>Cam kết tháng{arrow('monthTarget')}</th>
                  <th rowSpan="3" className="grp-actual sortable" onClick={() => toggleSort('monthActual')} style={{ minWidth: 90 }}>Thực đạt tháng{arrow('monthActual')}</th>
                  <th rowSpan="3" className="sortable" onClick={() => toggleSort('monthDiff')} style={{ minWidth: 80 }}>Chênh lệch{arrow('monthDiff')}</th>
                  <th rowSpan="3" className="grp-pending sortable" onClick={() => toggleSort('pending')} style={{ minWidth: 70 }} title="Tổng APE hồ sơ đang chờ xử lý (chưa PH, chưa rút)">Pending{arrow('pending')}</th>
                  <th rowSpan="3" className="grp-forecast sortable" onClick={() => toggleSort('forecast')} style={{ minWidth: 90 }} title="Đã chắc + tỷ lệ chuyển đổi lịch sử × (tiềm năng + pending)">Dự báo tháng{arrow('forecast')}</th>
                  {visWeeks.map(({ w, wi }) => <th key={wi} className="week-head" colSpan="5">{w.label} ({w.start}–{w.end})</th>)}
                  {isAdmin && <th rowSpan="3" style={{ minWidth: 34 }}>Xoá</th>}
                </tr>
                <tr>
                  {visWeeks.map(({ wi }) => (
                    <React.Fragment key={wi}>
                      {[['ckfyp', 'CK FYP'], ['tdfyp', 'TĐ FYP'], ['ckhs', 'CK HS'], ['tdhs', 'TĐ HS'], ['note', 'Ghi chú']].map(([f, lbl]) => {
                        const id = `w${wi}_${f}`
                        const grp = (f === 'tdfyp' || f === 'tdhs') ? 'grp-actual' : ''
                        return <th key={id} className={`week-head sortable ${grp}`} onClick={() => toggleSort(id)}>{lbl}{arrow(id)}</th>
                      })}
                    </React.Fragment>
                  ))}
                </tr>
                <tr>
                  <th><MultiFilter options={unitOptions} selected={filters.unit} onToggle={(o) => toggleMultiFilter('unit', o)} /></th>
                  <th><FilterInput value={filters.code} onChange={(v) => setFilter('code', v)} /></th>
                  <th><FilterInput value={filters.name} onChange={(v) => setFilter('name', v)} /></th>
                  <th><MultiFilter options={segmentOptions} selected={filters.segment} onToggle={(o) => toggleMultiFilter('segment', o)} /></th>
                  <th><FilterInput value={filters.monthTarget} onChange={(v) => setFilter('monthTarget', v)} /></th>
                  <th className="grp-actual"><FilterInput value={filters.monthActual} onChange={(v) => setFilter('monthActual', v)} /></th>
                  <th><FilterInput value={filters.monthDiff} onChange={(v) => setFilter('monthDiff', v)} /></th>
                  <th className="grp-pending"><FilterInput value={filters.pending} onChange={(v) => setFilter('pending', v)} /></th>
                  <th className="grp-forecast"><FilterInput value={filters.forecast} onChange={(v) => setFilter('forecast', v)} /></th>
                  {visWeeks.map(({ wi }) => (
                    <React.Fragment key={wi}>
                      {['ckfyp', 'tdfyp', 'ckhs', 'tdhs', 'note'].map((f) => {
                        const id = `w${wi}_${f}`
                        const grp = (f === 'tdfyp' || f === 'tdhs') ? 'grp-actual' : ''
                        return <th key={id} className={`week-head ${grp}`}><FilterInput value={filters[id]} onChange={(v) => setFilter(id, v)} /></th>
                      })}
                    </React.Fragment>
                  ))}
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.code}>
                    <td>{i + 1}</td>
                    <td>{row.unit}</td>
                    <td>{row.code}</td>
                    <td style={{ textAlign: 'left', fontWeight: 600 }}>
                      <span className="mm-name-link" onClick={() => setDetailCode(row.code)}>{row.name}</span>
                      {row.isNew && <span className="mm-new-badge">Mới</span>}
                      {row.maxConsecutiveMiss >= 2 && (
                        <span className="mm-warn-badge miss" title={`Chưa đạt cam kết ${row.maxConsecutiveMiss} tuần liên tiếp`}>⚠️ {row.maxConsecutiveMiss} tuần</span>
                      )}
                      {row.trend.trendDir === 'down' && row.trend.z !== null && (
                        <span className="mm-warn-badge trend" title={`Tháng gần nhất thấp hơn trung bình cá nhân (z=${row.trend.z.toFixed(1)})`}>📉 Bất thường (z={row.trend.z.toFixed(1)})</span>
                      )}
                    </td>
                    <td>
                      {isAdmin ? (
                        <input
                          className="mm-cell" style={{ width: 76, textAlign: 'left' }} placeholder="—"
                          value={draftVal(`seg:${row.code}`, row.segment)}
                          onChange={(e) => setDraft(`seg:${row.code}`, e.target.value)}
                          onBlur={() => commitDraft(`seg:${row.code}`, onSegment(row.code))}
                        />
                      ) : (row.segment || '—')}
                    </td>
                    <td>
                      {isAdmin ? (
                        <input
                          className="mm-cell" type="number"
                          value={draftVal(`mt:${row.code}`, row.monthTarget || '')}
                          onChange={(e) => setDraft(`mt:${row.code}`, e.target.value)}
                          onBlur={() => commitDraft(`mt:${row.code}`, onMonthTarget(row.code))}
                        />
                      ) : fmt(row.monthTarget)}
                    </td>
                    <td className={`mm-actual grp-actual ${statusClass(row.monthActual, row.monthTarget)}`}>
                      {fmt(row.monthActual)}
                      <div className="mm-breakdown"><span className="confirmed">{fmt(row.monthConfirmed)} chắc</span> · <span className="potential">{fmt(row.monthPotential)} TN</span></div>
                    </td>
                    <td className={statusClass(row.monthDiff, 1)} style={{ fontWeight: 700 }}>
                      {row.monthTarget ? `${row.monthDiff >= 0 ? '+' : ''}${fmt(row.monthDiff)}` : '—'}
                    </td>
                    <td className="mm-pending grp-pending">
                      {fmt(row.pending.value)}
                      {row.pending.count ? <div className="mm-breakdown">{row.pending.count} hồ sơ</div> : null}
                    </td>
                    <td
                      className={`mm-forecast grp-forecast ${statusClass(row.forecast, row.monthTarget)}`}
                      title={row.conv.source === 'personal'
                        ? `Tỷ lệ chuyển đổi cá nhân: ${Math.round(row.conv.rate * 100)}% (${row.conv.sample} hồ sơ lịch sử)`
                        : row.conv.source === 'unit'
                          ? `Chưa đủ dữ liệu cá nhân — dùng tỷ lệ Unit: ${Math.round(row.conv.rate * 100)}% (${row.conv.sample} hồ sơ)`
                          : 'Chưa đủ dữ liệu lịch sử — dùng tỷ lệ mặc định 50%'}
                    >
                      {fmt(Math.round(row.forecastMid))}
                      <div className="mm-breakdown">Thấp {fmt(Math.round(row.forecastLow))} · Cao {fmt(Math.round(row.forecastHigh))}</div>
                    </td>
                    {visWeeks.map(({ wi }) => {
                      const wd = row.weeks[wi]
                      return (
                        <React.Fragment key={wi}>
                          <td>
                            {isAdmin ? (
                              <input
                                className="mm-cell" type="number"
                                value={draftVal(`w:${row.code}:${wi}:fyp`, wd.ckfyp || '')}
                                onChange={(e) => setDraft(`w:${row.code}:${wi}:fyp`, e.target.value)}
                                onBlur={() => commitDraft(`w:${row.code}:${wi}:fyp`, onWeekField(row.code, wi, 'fyp'))}
                              />
                            ) : fmt(wd.ckfyp)}
                          </td>
                          <td className={`mm-actual grp-actual ${statusClass(wd.tdfyp, wd.ckfyp)}`}>
                            {fmt(wd.tdfyp)}
                            {wd.tdfyp ? <div className="mm-breakdown"><span className="confirmed">{fmt(wd.confirmedFyp)}</span>/<span className="potential">{fmt(wd.potentialFyp)}</span></div> : null}
                          </td>
                          <td>
                            {isAdmin ? (
                              <input
                                className="mm-cell" type="number"
                                value={draftVal(`w:${row.code}:${wi}:hs`, wd.ckhs || '')}
                                onChange={(e) => setDraft(`w:${row.code}:${wi}:hs`, e.target.value)}
                                onBlur={() => commitDraft(`w:${row.code}:${wi}:hs`, onWeekField(row.code, wi, 'hs'))}
                              />
                            ) : fmt(wd.ckhs)}
                          </td>
                          <td className={`mm-actual grp-actual ${statusClass(wd.tdhs, wd.ckhs)}`}>{fmt(wd.tdhs)}</td>
                          <td>
                            {isAdmin ? (
                              <input
                                className="mm-note" type="text" placeholder="Ghi chú..."
                                value={draftVal(`n:${row.code}:${wi}`, wd.note)}
                                onChange={(e) => setDraft(`n:${row.code}:${wi}`, e.target.value)}
                                onBlur={() => commitDraft(`n:${row.code}:${wi}`, onNote(row.code, wi))}
                              />
                            ) : (wd.note || '')}
                          </td>
                        </React.Fragment>
                      )
                    })}
                    {isAdmin && (
                      <td><button className="mm-del-btn" title="Xoá TVV khỏi ManMark" onClick={() => deleteRow(row.code)}>🗑</button></td>
                    )}
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={99} style={{ padding: 20, color: '#8896aa' }}>
                      Chưa có dữ liệu — hãy upload DATA tháng ở tab Sales Report/TVV Hàng Ngày
                      {actualSource === 'official'
                        ? `, hoặc kiểm tra collection daily_sales_tvv đã có dữ liệu tháng ${month}/${year} chưa.`
                        : `, hoặc kiểm tra reports/${year}-${month} đã có dữ liệu sales report chưa.`}
                    </td>
                  </tr>
                )}
                {/* ── TỔNG cuối tháng ── */}
                {!!rows.length && (
                  <tr style={{ background: '#f8f9ff', fontWeight: 700 }}>
                    <td colSpan="4" style={{ textAlign: 'left' }}>TỔNG ({rows.length} TVV)</td>
                    <td>{fmt(totals.monthCommit)}</td>
                    <td>{fmt(totals.monthActual)}</td>
                    <td>{fmt(totals.monthActual - totals.monthCommit)}</td>
                    <td>{fmt(totals.pending)}</td>
                    <td>{fmt(Math.round(totals.forecast))}</td>
                    {visWeeks.map(({ wi }) => {
                      const wt = totals.weekTotals[wi]
                      return (
                        <React.Fragment key={wi}>
                          <td>{fmt(wt.ckFyp)}</td>
                          <td>{fmt(wt.tdFyp)}</td>
                          <td>{fmt(wt.ckHs)}</td>
                          <td>{fmt(wt.tdHs)}</td>
                          <td />
                        </React.Fragment>
                      )
                    })}
                    {isAdmin && <td />}
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ fontSize: 10.5, color: '#8896aa', marginTop: 10, lineHeight: 1.6 }}>
        Đơn vị: nghìn đồng. Cam kết &amp; Thực đạt cùng đơn vị (số gốc tính bằng đồng ÷ 1000).
        Nguồn "TVV Hàng Ngày (chính thức)": số lũy kế trong tháng → chênh lệch theo tuần.
        Dự báo: Thấp = chỉ tính FYP đã chắc (PH) · Vừa = Đã chắc + (Tiềm năng + Pending) × tỷ lệ chuyển đổi lịch sử thật
        (ưu tiên cá nhân ≥5 hồ sơ, rồi Unit ≥15 hồ sơ, mặc định 50%) · Cao = toàn bộ chuyển đổi.
      </div>

      {/* ── Modals ── */}
      {showAddTvv && (
        <AddTvvModal
          weeks={weeks}
          onClose={() => setShowAddTvv(false)}
          onSave={(code, entry) => updateMm((next) => {
            next.commits[code] = entry
            delete next.excluded[code]
          })}
        />
      )}
      {showWeekCfg && (
        <WeekConfigModal
          weeks={weeks}
          defaultWeeks={defaultWeeks(year, month)}
          onClose={() => setShowWeekCfg(false)}
          onSave={(w) => updateMm((next) => { next.weeks = w })}
        />
      )}
      {detailRow && (
        <TvvDetailModal row={detailRow} weeks={weeks} onClose={() => setDetailCode(null)} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Modal thêm TVV mới (admin)
// ─────────────────────────────────────────────────────────────
function AddTvvModal({ weeks, onClose, onSave }) {
  const [unit, setUnit] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [segment, setSegment] = useState('')
  const [monthTarget, setMonthTarget] = useState('')
  const [wfyp, setWfyp] = useState({})
  const [whs, setWhs] = useState({})

  const save = () => {
    const c = code.trim()
    if (!c) { window.alert('Bắt buộc nhập Mã TVV'); return }
    onSave(c, {
      unit: unit.trim(),
      name: name.trim(),
      segment: segment.trim(),
      monthTarget: num(monthTarget),
      weekly: weeks.map((_, wi) => ({ fyp: num(wfyp[wi]), hs: num(whs[wi]) })),
    })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">➕ Thêm TVV mới</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {[
            ['Unit', unit, setUnit, 'text'],
            ['Mã TVV (MSDL)', code, setCode, 'text'],
            ['Tên TVV', name, setName, 'text'],
            ['AG Segment', segment, setSegment, 'text'],
            ['Cam kết tháng', monthTarget, setMonthTarget, 'number'],
          ].map(([lbl, val, set, type]) => (
            <div key={lbl} style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 10.5, fontWeight: 600, color: '#6b7690', display: 'block', marginBottom: 3 }}>{lbl}</label>
              <input type={type} value={val} onChange={(e) => set(e.target.value)} className="mm-form-input" />
            </div>
          ))}
          <div className="section-divider">Cam kết theo tuần</div>
          {weeks.map((w, wi) => (
            <div key={wi} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, color: '#6b7690', minWidth: 90 }}>{w.label} ({w.start}–{w.end})</span>
              <input type="number" placeholder="CK FYP" value={wfyp[wi] || ''} onChange={(e) => setWfyp((s) => ({ ...s, [wi]: e.target.value }))} className="mm-form-input" />
              <input type="number" placeholder="CK HS" value={whs[wi] || ''} onChange={(e) => setWhs((s) => ({ ...s, [wi]: e.target.value }))} className="mm-form-input" />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #e8ecf4', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Hủy</button>
            <button onClick={save} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#06d6a0', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>💾 Lưu</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Modal cấu hình tuần trong tháng (admin)
// ─────────────────────────────────────────────────────────────
function WeekConfigModal({ weeks, defaultWeeks, onClose, onSave }) {
  const [rows, setRows] = useState(() => weeks.map((w) => ({ ...w })))
  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const save = () => {
    const cleaned = rows.map((r) => ({
      label: String(r.label || '').trim() || 'Tuần',
      start: parseInt(r.start) || 1,
      end: parseInt(r.end) || 1,
    }))
    if (!cleaned.length) { window.alert('Cần ít nhất 1 tuần'); return }
    onSave(cleaned)
    onClose()
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">📅 Cấu hình tuần trong tháng</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: '#8896aa', marginBottom: 10, lineHeight: 1.5 }}>
            Lịch tuần thay đổi theo từng tháng — nhập tay ngày bắt đầu/kết thúc (theo ngày trong tháng) cho từng tuần.
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <input type="text" value={r.label} onChange={(e) => setRow(i, 'label', e.target.value)} placeholder="Nhãn (Tuần 1)" className="mm-form-input" style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: '#8896aa' }}>từ ngày</span>
              <input type="number" min="1" max="31" value={r.start} onChange={(e) => setRow(i, 'start', e.target.value)} className="mm-form-input" style={{ width: 60 }} />
              <span style={{ fontSize: 10, color: '#8896aa' }}>đến</span>
              <input type="number" min="1" max="31" value={r.end} onChange={(e) => setRow(i, 'end', e.target.value)} className="mm-form-input" style={{ width: 60 }} />
              <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} style={{ border: 'none', background: '#f1f3f9', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>✕</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => setRows((rs) => [...rs, { label: `Tuần ${rs.length + 1}`, start: '', end: '' }])} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#f1f3f9', color: '#5b6478', fontWeight: 600, cursor: 'pointer' }}>＋ Thêm tuần</button>
            <button onClick={() => setRows(defaultWeeks.map((w) => ({ ...w })))} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: '#f1f3f9', color: '#5b6478', fontWeight: 600, cursor: 'pointer' }}>↺ Mặc định 4 tuần (1-7/8-14/15-21/22-cuối tháng)</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #e8ecf4', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Hủy</button>
            <button onClick={save} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#06d6a0', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>💾 Lưu cấu hình tuần</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Modal chi tiết TVV: chart tuần + xu hướng năm + pending
// ─────────────────────────────────────────────────────────────
function TvvDetailModal({ row, weeks, onClose }) {
  const barData = weeks.map((w, wi) => ({
    name: w.label,
    'Cam kết': row.weeks[wi]?.ckfyp || 0,
    'Thực đạt': row.weeks[wi]?.tdfyp || 0,
  }))
  const lineData = row.trend.months.map((m, i) => ({
    name: `T${m.m}`,
    'Cam kết': m.commit,
    'Thực đạt': m.actual,
    'TB trượt 3T': Math.round(row.trend.ma3[i]),
  }))
  const t = row.trend
  const dirLabel = t.trendDir === 'up' ? '📈 Xu hướng tăng' : t.trendDir === 'down' ? '📉 Bất thường thấp' : '➡️ Ổn định'
  const dirBg = t.trendDir === 'up' ? '#e6faf2' : t.trendDir === 'down' ? '#fee2e2' : '#f1f3f9'
  const dirColor = t.trendDir === 'up' ? '#065f46' : t.trendDir === 'down' ? '#991b1b' : '#5b6478'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 880 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{row.name} {row.isNew ? '(chưa có cam kết)' : ''}</div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: '#8896aa' }}>Unit {row.unit || '—'} · Mã TVV {row.code}</div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: dirBg, color: dirColor }}>{dirLabel}</span>
            {row.maxConsecutiveMiss >= 2 && <span className="mm-warn-badge miss">⚠️ Chưa đạt cam kết {row.maxConsecutiveMiss} tuần liên tiếp</span>}
          </div>
          <div style={{ fontSize: 10.5, color: '#8896aa', marginTop: 6 }}>
            {t.z !== null
              ? `Tháng ${t.lastCompletedMonth.m} (gần nhất đã hoàn tất): ${fmt(t.lastCompletedMonth.actual)} — trung bình cá nhân ${fmt(Math.round(t.baselineMean))} ± ${fmt(Math.round(t.baselineStd))} (z=${t.z.toFixed(1)})`
              : 'Chưa đủ dữ liệu lịch sử (cần ≥4 tháng có phát sinh) để tính độ lệch chuẩn.'}
          </div>
          <div style={{ fontSize: 10.5, color: '#8896aa', marginTop: 2 }}>
            Dự báo tháng: <b>Thấp {fmt(Math.round(row.forecastLow))}</b> · <b style={{ color: '#4361ee' }}>Vừa {fmt(Math.round(row.forecastMid))}</b> · <b>Cao {fmt(Math.round(row.forecastHigh))}</b>
            {' '}— tỷ lệ chuyển đổi dùng: {Math.round(row.conv.rate * 100)}% ({row.conv.source === 'personal' ? `cá nhân, ${row.conv.sample} hồ sơ` : row.conv.source === 'unit' ? `theo Unit, ${row.conv.sample} hồ sơ` : 'mặc định, chưa đủ dữ liệu'})
          </div>

          <div className="grid-2" style={{ marginTop: 14 }}>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#4a5568', marginBottom: 8 }}>Cam kết vs Thực đạt theo tuần (tháng đang xem)</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Cam kết" fill="#c7d2fe" />
                  <Bar dataKey="Thực đạt" fill="#4361ee" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#4a5568', marginBottom: 8 }}>Xu hướng theo tháng (cả năm) + trung bình trượt 3 tháng</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={lineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="Cam kết" stroke="#c7d2fe" dot={false} />
                  <Line type="monotone" dataKey="Thực đạt" stroke="#4361ee" dot={false} />
                  <Line type="monotone" dataKey="TB trượt 3T" stroke="#f59e0b" strokeDasharray="5 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card" style={{ padding: 12, marginTop: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: '#4a5568', marginBottom: 8 }}>Hồ sơ đang chờ xử lý (Pending)</div>
            {row.pending.cases.length ? (
              <div style={{ maxHeight: 180, overflow: 'auto' }}>
                <table className="data-table" style={{ fontSize: 10 }}>
                  <thead><tr><th>ProposalNum</th><th>Sản phẩm</th><th style={{ textAlign: 'right' }}>APE</th><th>Ngày nộp</th></tr></thead>
                  <tbody>
                    {row.pending.cases.map((c, i) => (
                      <tr key={i}><td>{c.proposalNum}</td><td>{c.productName || ''}</td><td style={{ textAlign: 'right' }}>{fmt(c.ape)}</td><td>{c.proposalDate || ''}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div style={{ color: '#8896aa', padding: 8 }}>Không có hồ sơ đang chờ xử lý.</div>}
          </div>

          <div style={{ fontSize: 10, color: '#8896aa', background: '#f8f9ff', borderRadius: 8, padding: '8px 10px', marginTop: 10, lineHeight: 1.6 }}>
            <b>3 kịch bản dự báo:</b> Thấp = chỉ tính FYP đã chắc (PH). Cao = giả định toàn bộ tiềm năng (CP/CF) + Pending đều chuyển đổi thành công.
            Vừa = Đã chắc + (Tiềm năng + Pending) × <b>tỷ lệ chuyển đổi lịch sử thật</b> của từng người (ưu tiên cá nhân ≥5 hồ sơ quá khứ, nếu chưa đủ dùng tỷ lệ Unit ≥15 hồ sơ, nếu vẫn chưa đủ dùng mặc định 50%).<br />
            <b>Cảnh báo bất thường</b> (📉) so tháng gần nhất đã hoàn tất với trung bình ± độ lệch chuẩn của các tháng trước đó của chính người đó (z ≤ −1.5), không dùng ngưỡng % cố định chung cho mọi người.<br />
            Đây là ước tính tham khảo dựa trên dữ liệu lịch sử trong năm đang chọn, không phải cam kết chính thức.
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// CSS riêng của tab (port từ manmark.html, dùng cùng index.css)
// ─────────────────────────────────────────────────────────────
const MM_CSS = `
.mm-table{border-collapse:collapse;width:100%;background:#fff;font-size:11.5px}
.mm-table th,.mm-table td{border:1px solid #edf0f9;padding:5px 7px;text-align:center;white-space:nowrap}
.mm-table thead th{background:#eef2ff;color:#4361ee;font-weight:700;font-size:10.5px}
.mm-table th.sortable{cursor:pointer;user-select:none}
.mm-table th.sortable:hover{background:#dfe6ff}
.mm-table .week-head{background:#e0e7ff!important}
.mm-table th.grp-actual{background:#dbeafe!important;color:#1e40af!important}
.mm-table th.grp-pending{background:#fef3c7!important;color:#92400e!important}
.mm-table th.grp-forecast{background:#d1fae5!important;color:#065f46!important}
.mm-table td.grp-actual{background:#eff6ff}
.mm-table td.grp-pending{background:#fffbeb}
.mm-table td.grp-forecast{background:#ecfdf5}
.mm-cell{width:56px;border:1px solid transparent;border-radius:5px;padding:2px 4px;font-size:11px;text-align:right;background:transparent;font-family:inherit}
.mm-cell:hover{border-color:#dde3f8}
.mm-cell:focus{border-color:#4361ee;background:#f8f9ff;outline:none}
.mm-note{width:110px;border:1px solid transparent;border-radius:5px;padding:2px 4px;font-size:10.5px;text-align:left;background:transparent;font-family:inherit}
.mm-note:hover{border-color:#dde3f8}
.mm-note:focus{border-color:#4361ee;background:#f8f9ff;outline:none}
.mm-actual{font-weight:700}
.mm-pending{font-weight:700;color:#7c3aed}
.mm-forecast{font-weight:800}
.mm-breakdown{font-size:9px;font-weight:500;color:#8896aa;margin-top:1px;line-height:1.3}
.mm-breakdown .confirmed{color:#0f9d58}
.mm-breakdown .potential{color:#b45309}
.status-green{color:#0f9d58}.status-amber{color:#b45309}.status-red{color:#c0243c}.status-gray{color:#9aa4ba}
.mm-filter-input{width:100%;min-width:44px;border:1px solid #d7deef;border-radius:5px;padding:2px 4px;font-size:10px;text-align:center;background:#fff;color:#334;font-family:inherit}
.mm-filter-input:focus{border-color:#4361ee;outline:none}
.mm-ddown{position:relative;min-width:60px}
.mm-ddown-btn{width:100%;text-align:left;padding:2px 4px;border:1px solid #d7deef;border-radius:5px;background:#fff;font-size:10px;cursor:pointer;color:#334;list-style:none}
.mm-ddown-btn::-webkit-details-marker{display:none}
.mm-ddown-panel{position:absolute;top:calc(100% + 3px);left:0;background:#fff;border:1px solid #d7deef;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:6px;max-height:240px;overflow:auto;z-index:80;min-width:170px;white-space:nowrap}
.mm-ddown-item{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;font-size:11.5px;cursor:pointer;font-weight:400;text-align:left}
.mm-ddown-item:hover{background:#f1f5f9}
.mm-new-badge{background:#fee2e2;color:#b91c1c;font-size:9px;font-weight:700;padding:1px 5px;border-radius:5px;margin-left:4px}
.mm-warn-badge{display:inline-block;font-size:9px;font-weight:700;padding:1px 5px;border-radius:5px;margin-left:3px}
.mm-warn-badge.miss{background:#fee2e2;color:#b91c1c}
.mm-warn-badge.trend{background:#fef3c7;color:#92400e}
.mm-name-link{cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px}
.mm-name-link:hover{color:#4361ee}
.mm-del-btn{border:none;background:#fee2e2;color:#b91c1c;border-radius:6px;padding:3px 7px;cursor:pointer;font-size:11px}
.mm-del-btn:hover{background:#f87171;color:#fff}
.mm-form-input{width:100%;border:1.5px solid #e8ecf4;border-radius:7px;padding:7px 10px;font-size:12px;font-family:inherit;outline:none}
.mm-form-input:focus{border-color:#4361ee}
`
