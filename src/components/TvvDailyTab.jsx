// ─────────────────────────────────────────────────────────────
// TvvDailyTab — port từ public/tvv-daily.html (vanilla JS) sang React
// Theo Dõi Kinh Doanh TVV Hàng Ngày — GA D07
// Logic nghiệp vụ (parse workbook, tính toán, so sánh delta) giữ nguyên
// từ file gốc. Đọc/ghi qua data layer chung src/lib/db.js.
// ─────────────────────────────────────────────────────────────
import React, { useState, useEffect, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { collection, getDocs } from 'firebase/firestore'
import {
  useDailySalesDoc, saveDailySalesDoc, useAuth,
  normalizeAgent, dateKey, getDocOnce, getFirebase, publishDailyTop,
} from '../lib/db'

// ---------- HELPERS (giữ nguyên logic file gốc) ----------
const isValidCode = (v) => v !== null && v !== undefined && /^\d+$/.test(String(v).trim())
const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n }
const excelDateIntToISO = (v) => {
  if (v === null || v === undefined || v === '') return null
  const s = String(v)
  if (s.length === 8 && /^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8)
  return null
}
const sheetToRows = (wb, name) => {
  if (!wb.SheetNames.includes(name)) return null
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null, raw: true })
}
const fmt = (n) => {
  if (n === undefined || n === null) return '0'
  return Math.round(Number(n)).toLocaleString('vi-VN')
}
const sumApe = (rows) => (rows || []).reduce((s, r) => s + (r.ape || 0), 0)

// Chuẩn hoá field agCode cũ → msdl khi đọc (giữ nguyên ý tưởng file gốc)
const normalizeDoc = (data) => {
  if (!data) return null
  const fixArr = (arr) => (arr || []).map((r) => normalizeAgent(r))
  const agents = {}
  Object.entries(data.agents || {}).forEach(([k, a]) => { agents[k] = normalizeAgent(a) })
  return { ...data, agents, proposalRows: fixArr(data.proposalRows), pendingRows: fixArr(data.pendingRows), pipelineRows: fixArr(data.pipelineRows) }
}

// ---------- PARSE WORKBOOK (5 sheet — port nguyên từ file gốc) ----------
function parseWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false })

  const sheetStatus = {}
  const proposalName = wb.SheetNames.includes('Proposal') ? 'Proposal' : (wb.SheetNames.includes('Export') ? 'Export' : null)
  const rawProposal = proposalName ? sheetToRows(wb, proposalName) : null
  const rawAgent = sheetToRows(wb, 'Agent')
  const rawLeader = sheetToRows(wb, 'Leader')
  const rawPending = sheetToRows(wb, 'Pending')
  const rawPipeline = sheetToRows(wb, 'Pipeline')
  sheetStatus.proposal = !!rawProposal; sheetStatus.agent = !!rawAgent; sheetStatus.leader = !!rawLeader
  sheetStatus.pending = !!rawPending; sheetStatus.pipeline = !!rawPipeline

  // --- Proposal (line-item, dùng cho đếm IF/PS/Khác và tab Khác) ---
  const proposalRows = []
  for (const r of (rawProposal || [])) {
    if (typeof r['Yearmonth'] !== 'number' || !r['AGCode']) continue
    const status = (r['PolicyStatus'] || '').toString().trim().toUpperCase()
    const statusGroup = status === 'IF' ? 'IF' : status === 'PS' ? 'PS' : 'OTHER'
    proposalRows.push({
      unit: r['UnitCode'] || '', msdl: String(r['AGCode']), agName: r['AGName'] || '',
      proposalNum: r['ProposalNum'] ? String(r['ProposalNum']) : '',
      status, statusGroup, statusFull: r['CurrentPolicyStatus'] || '',
      product: r['Remarked_ProductNameVN'] || r['ProductCode'] || '',
      proposalDate: excelDateIntToISO(r['ProposalDate']),
      firstIssuedDate: excelDateIntToISO(r['FirstIssuedDate']),
      caseSub: num(r['Case Sub (IF-PS)']), ipSub: num(r['IP Sub']), ipNet: num(r['IP Net']),
    })
  }

  // --- Agent (TVV level, chuẩn từ hệ thống) ---
  const agents = {}
  for (const r of (rawAgent || [])) {
    if (typeof r['YearMonth'] !== 'number' || !r['AGCode']) continue
    const msdl = String(r['AGCode'])
    agents[msdl] = {
      unit: r['UnitCode'] || '', leaderCode: r['LeaderCode'] ? String(r['LeaderCode']) : '',
      msdl, agName: r['AGName'] || '', agSeg: r['AGSegName'] || '',
      ipSub: num(r['IP Sub']), caseSub: num(r['Case Sub']), fyp: num(r['FYP']),
      ipNet: num(r['IP Net']), caseNet: num(r['Case Net']), fyc: num(r['FYC']),
      // Bổ sung cho Tổng Quan (TOP 60 + thẻ KPI): cấp bậc, APE, active, lũy kế
      level: r['AGLevel'] || '', apeNet: num(r['APE Net']), netMp: num(r['Net Manpower']),
      actFyc: num(r['Active Net (FYC)']), actCase: num(r['Active Net (Case)']),
      fypYtd: num(r['FYP YTD']), fycYtd: num(r['FYC YTD']),
      cIF: 0, cPS: 0, cOther: 0,
    }
  }
  // gắn đếm số hồ sơ IF/PS/Khác từ Proposal vào từng TVV
  for (const p of proposalRows) {
    if (!agents[p.msdl]) continue
    if (p.statusGroup === 'IF') agents[p.msdl].cIF++
    else if (p.statusGroup === 'PS') agents[p.msdl].cPS++
    else agents[p.msdl].cOther++
  }

  // --- Leader (Unit level, chuẩn từ hệ thống, thiếu IP nên cộng dồn thêm từ Agent) ---
  const units = {}
  for (const r of (rawLeader || [])) {
    if (typeof r['YearMonth'] !== 'number' || !r['UnitCode']) continue
    const unitCode = r['UnitCode']
    units[unitCode] = {
      unit: unitCode, leaderName: r['LeaderName'] || '', agSeg: r['AGSegName'] || '',
      manpower: num(r['#Manpower']),
      caseSubUnit: num(r['Case Sub Unit']), caseNetUnit: num(r['Case Net Unit']),
      apeSubUnit: num(r['APE Sub Unit']), apeNetUnit: num(r['APE Net Unit']),
      ipSubUnit: 0, ipNetUnit: 0, cIF: 0, cPS: 0, cOther: 0,
    }
  }
  for (const msdl in agents) {
    const a = agents[msdl]
    if (!units[a.unit]) units[a.unit] = { unit: a.unit, leaderName: '', agSeg: '', manpower: 0, caseSubUnit: 0, caseNetUnit: 0, apeSubUnit: 0, apeNetUnit: 0, ipSubUnit: 0, ipNetUnit: 0, cIF: 0, cPS: 0, cOther: 0 }
    const u = units[a.unit]
    u.ipSubUnit += a.ipSub; u.ipNetUnit += a.ipNet
    u.cIF += a.cIF; u.cPS += a.cPS; u.cOther += a.cOther
  }

  // --- Pending (chi tiết hồ sơ PS) ---
  const reqFields = ['Accept Letter', 'Compliance', 'Internal Pending', 'Medical Check', 'Medical Info', 'Personal Info', 'IndependentCall', 'Voice Recording']
  const pendingRows = []
  for (const r of (rawPending || [])) {
    if (!isValidCode(r['AGCode']) || !r['ProposalNum']) continue
    const requirements = reqFields
      .filter((f) => r[f] !== null && r[f] !== undefined && String(r[f]).trim() !== '')
      .map((f) => ({ name: f, detail: String(r[f]).slice(0, 200) }))
    pendingRows.push({
      unit: r['UnitCode'] || '', msdl: String(r['AGCode']), agName: r['AGName'] || '',
      proposalNum: String(r['ProposalNum']), proposalDate: excelDateIntToISO(r['ProposalDate']),
      product: r['ProductNameVN'] || r['BasicProductCode'] || '', ape: num(r['APE (mil)']),
      poName: r['POName'] || '', description: r['Description'] || '',
      classify: r['Classify'] || '', requirements,
    })
  }

  // --- Pipeline (chưa đóng phí) ---
  const pipelineRows = []
  for (const r of (rawPipeline || [])) {
    if (!isValidCode(r['AGCode']) || !r['ProposalNum']) continue
    pipelineRows.push({
      unit: r['UnitCode'] || '', msdl: String(r['AGCode']), agName: r['AGName'] || '',
      proposalNum: String(r['ProposalNum']), proposalDate: excelDateIntToISO(r['ProposalDate']),
      product: r['ProductNameVN'] || r['BasicProductCode'] || '', ape: num(r['APE (mil)']),
      poName: r['PO_Name'] || '', description: r['Description'] || '', classify: r['Classify'] || '',
    })
  }

  return { sheetStatus, proposalRows, agents, units, pendingRows, pipelineRows }
}

// Liệt kê các ngày đã có dữ liệu (db.js chưa có API list doc nên dùng
// singleton chung getFirebase — KHÔNG init Firebase riêng)
async function loadAllDates() {
  const { fs } = getFirebase()
  const snap = await getDocs(collection(fs, 'daily_sales_tvv'))
  const dates = []
  snap.forEach((d) => dates.push(d.id))
  return dates.sort()
}

// Màu cột theo nhóm chỉ số (port từ <style> của file gốc)
const COL = {
  case: { th: { background: '#dbeafe', color: '#1e40af' }, td: { background: '#eff6ff' } },
  ip: { th: { background: '#ede9fe', color: '#5b21b6' }, td: { background: '#f5f3ff' } },
  fyp: { th: { background: '#d1fae5', color: '#065f46' }, td: { background: '#ecfdf5' } },
  count: { th: { background: '#fef3c7', color: '#92400e' }, td: { background: '#fffbeb' } },
}
const SEG_STYLE = {
  Diamond: { color: '#0ea5e9', fontWeight: 600 },
  Platinum: { color: '#7c3aed', fontWeight: 600 },
  Gold: { color: '#d97706', fontWeight: 600 },
  Terminated: { color: '#94a3b8' },
}

// ---------- COMPONENT NHỎ ----------
const DeltaText = ({ cur, base }) => {
  if (base === undefined || base === null)
    return <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 20, fontSize: 10.5, fontWeight: 600, background: '#dcfce7', color: '#16a34a' }}>Mới</span>
  const d = cur - base
  if (Math.abs(d) < 0.0001) return <span style={{ color: '#8896aa', fontSize: 11 }}>0</span>
  return <span style={{ fontSize: 11 }} className={d > 0 ? 'val-green' : 'val-red'}>{d > 0 ? '+' : ''}{fmt(d)}</span>
}
const CellDelta = ({ cur, base, col }) => (
  <td style={COL[col].td}>{fmt(cur)}<br /><small><DeltaText cur={cur} base={base} /></small></td>
)
const KpiDelta = ({ cur, base }) => {
  if (base === undefined || base === null) return null
  const d = cur - base
  const cls = Math.abs(d) < 0.0001 ? 'flat' : d > 0 ? 'up' : 'down'
  return <span className={`kpi-badge ${cls}`}>{d > 0 ? '+' : ''}{fmt(d)}</span>
}
function SortTh({ tab, k, sort, onSort, children, style }) {
  const s = sort[tab]
  const active = s && s.key === k
  return (
    <th onClick={() => onSort(tab, k)} style={{ ...(style || {}), cursor: 'pointer', userSelect: 'none' }}>
      {children}{active ? (s.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )
}
const ReqTags = ({ requirements }) => {
  if (!requirements || !requirements.length) return null
  return (
    <span>
      {requirements.map((r, i) => (
        <span key={i} title={r.detail} style={{ display: 'inline-block', background: '#f1f5f9', color: '#334155', borderRadius: 6, padding: '1px 6px', fontSize: 11, margin: 1, cursor: 'help' }}>
          {r.name}
        </span>
      ))}
    </span>
  )
}
const NewBadge = () => (
  <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: '#dcfce7', color: '#16a34a' }}>Mới</span>
)
const EmptyRow = ({ colSpan, text }) => (
  <tr><td colSpan={colSpan} style={{ textAlign: 'center', padding: 30, color: '#8896aa', fontSize: 13 }}>{text}</td></tr>
)

function MultiDropdown({ label, values, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  const toggleAll = (e) => onChange(e.target.checked ? values.slice() : [])
  const btnText = selected.length === 0 || selected.length === values.length
    ? `Tất cả ${label}`
    : selected.length <= 2 ? selected.join(', ') : `${selected.length} ${label} đã chọn`
  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 170 }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', textAlign: 'left', padding: '8px 30px 8px 10px', border: '1px solid var(--border)', borderRadius: 7, background: '#fff', fontSize: 13, cursor: 'pointer' }}>
        {btnText} <span style={{ position: 'absolute', right: 10, color: '#94a3b8', fontSize: 11 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 6, maxHeight: 260, overflow: 'auto', zIndex: 80, minWidth: 210 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid var(--border)', marginBottom: 4, paddingBottom: 8 }}>
            <input type="checkbox" checked={values.length > 0 && selected.length === values.length} onChange={toggleAll} /><b>Chọn tất cả</b>
          </label>
          {values.length === 0 && <div style={{ padding: 6, color: '#94a3b8', fontSize: 12 }}>(chưa có dữ liệu)</div>}
          {values.map((v) => (
            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={selected.includes(v)} onChange={() => toggle(v)} /> {v}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- COMPONENT CHÍNH ----------
export default function TvvDailyTab() {
  const { user, isAdmin } = useAuth()

  // selectors ngày/tháng
  const [allDates, setAllDates] = useState([])
  const [datesLoading, setDatesLoading] = useState(true)
  const [month, setMonth] = useState('')
  const [viewDate, setViewDate] = useState('')
  const [baseDate, setBaseDate] = useState('')

  // bộ lọc + sắp xếp + tab
  const [search, setSearch] = useState('')
  const [unitSel, setUnitSel] = useState([])
  const [segSel, setSegSel] = useState([])
  const [sort, setSort] = useState({
    tvv: { key: null, dir: 1 }, leader: { key: null, dir: 1 }, pending: { key: null, dir: 1 },
    other: { key: null, dir: 1 }, pipeline: { key: null, dir: 1 },
  })
  const [activeTab, setActiveTab] = useState('tvv')

  // upload (admin)
  const [uploadDate, setUploadDate] = useState(() => dateKey(new Date()))
  const [parsed, setParsed] = useState(null)
  const [uploadMsg, setUploadMsg] = useState(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  // trend modal
  const [trend, setTrend] = useState(null) // {msdl, agName, metric, data[], pendingRows, pipelineRows, loading}

  // dữ liệu realtime của ngày xem + ngày so sánh
  const { data: dayRaw, loading: dayLoading } = useDailySalesDoc(viewDate)
  const { data: baseRaw } = useDailySalesDoc(baseDate)
  const dayData = useMemo(() => normalizeDoc(dayRaw), [dayRaw])
  const baseData = useMemo(() => normalizeDoc(baseRaw), [baseRaw])

  const months = useMemo(() => Array.from(new Set(allDates.map((d) => d.slice(0, 7)))).sort(), [allDates])
  const datesOfMonth = useMemo(() => allDates.filter((d) => d.startsWith(month)), [allDates, month])

  // init: nạp danh sách ngày, chọn mặc định (hôm nay nếu có, ngược lại ngày mới nhất)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setDatesLoading(true)
      try {
        const dates = await loadAllDates()
        if (cancelled) return
        setAllDates(dates)
        const today = dateKey(new Date())
        let m = '', v = ''
        if (dates.includes(today)) { m = today.slice(0, 7); v = today }
        else if (dates.length) { const last = dates[dates.length - 1]; m = last.slice(0, 7); v = last }
        setMonth(m)
        setViewDate(v)
        const dl = dates.filter((d) => d.startsWith(m))
        const idx = dl.indexOf(v)
        setBaseDate(idx > 0 ? dl[idx - 1] : '')
      } catch (e) {
        console.error('[TvvDailyTab] loadAllDates:', e)
      } finally {
        if (!cancelled) setDatesLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const refreshDates = async (preferredDate) => {
    try {
      const dates = await loadAllDates()
      setAllDates(dates)
      const m = preferredDate ? preferredDate.slice(0, 7) : (dates.length ? dates[dates.length - 1].slice(0, 7) : '')
      setMonth(m)
      const dl = dates.filter((d) => d.startsWith(m))
      const v = preferredDate && dl.includes(preferredDate) ? preferredDate : (dl[dl.length - 1] || '')
      setViewDate(v)
      const idx = dl.indexOf(v)
      setBaseDate(idx > 0 ? dl[idx - 1] : '')
    } catch (e) {
      console.error('[TvvDailyTab] refreshDates:', e)
    }
  }

  const handleMonthChange = (m) => {
    setMonth(m)
    const dl = allDates.filter((d) => d.startsWith(m))
    const v = dl[dl.length - 1] || ''
    setViewDate(v)
    const idx = dl.indexOf(v)
    setBaseDate(idx > 0 ? dl[idx - 1] : '')
  }
  const handleViewDateChange = (v) => {
    setViewDate(v)
    setBaseDate((prev) => (prev && prev !== v ? prev : ''))
  }

  // ---------- UPLOAD ----------
  const handleFileChange = async (e) => {
    const f = e.target.files[0]
    setParsed(null); setUploadMsg(null)
    if (!f) return
    try {
      const buf = await f.arrayBuffer()
      const p = parseWorkbook(buf)
      setParsed(p)
      setUploadMsg({
        type: 'info',
        summary: `Đã đọc: ${Object.keys(p.agents).length} TVV, ${Object.keys(p.units).length} Unit, ${p.pendingRows.length} hồ sơ Pending, ${p.pipelineRows.length} hồ sơ Pipeline, ${p.proposalRows.length} dòng Proposal.`,
        sheets: p.sheetStatus,
      })
    } catch (err) {
      setUploadMsg({ type: 'error', text: `Lỗi đọc file: ${err.message}` })
    }
  }
  const handleSave = async () => {
    if (!parsed) return
    if (!uploadDate) { setUploadMsg({ type: 'error', text: 'Vui lòng chọn ngày áp dụng' }); return }
    setSaving(true)
    try {
      await saveDailySalesDoc(uploadDate, {
        agents: parsed.agents, units: parsed.units,
        proposalRows: parsed.proposalRows, pendingRows: parsed.pendingRows, pipelineRows: parsed.pipelineRows,
      }, user?.email || null)
      // Đẩy snapshot gọn lên RTDB để TOP 60 ở Tổng Quan tự cập nhật.
      // Lỗi ở bước này không làm hỏng việc lưu chính ở trên.
      let topNote = ''
      try {
        const res = await publishDailyTop(uploadDate, parsed.agents)
        topNote = res.published
          ? ' TOP 60 ở Tổng Quan đã cập nhật.'
          : ` ⚠ TOP 60 giữ nguyên số liệu ngày ${res.date} (mới hơn ngày vừa nhập).`
      } catch (e) {
        console.error('[TvvDailyTab] publishDailyTop:', e)
        topNote = ` ⚠ Chưa cập nhật được TOP 60 ở Tổng Quan: ${e.message}`
      }
      setUploadMsg({ type: 'success', text: `✔ Đã lưu dữ liệu ngày ${uploadDate}.${topNote}` })
      setParsed(null)
      if (fileRef.current) fileRef.current.value = ''
      await refreshDates(uploadDate)
    } catch (err) {
      setUploadMsg({ type: 'error', text: `Lỗi lưu: ${err.message}` })
    } finally {
      setSaving(false)
    }
  }

  // ---------- EXPORT ----------
  const exportTvvLatest = async () => {
    const latestDate = allDates.length ? allDates[allDates.length - 1] : null
    if (!latestDate) { alert('Chưa có dữ liệu để xuất'); return }
    const dd = normalizeDoc(await getDocOnce('daily_sales_tvv', latestDate))
    const agents = dd ? dd.agents : {}
    let list = Object.values(agents)
    const unitF = unitSel.filter((v) => unitList.includes(v))
    const segF = segSel.filter((v) => segList.includes(v))
    if (unitF.length) list = list.filter((a) => unitF.includes(a.unit))
    if (segF.length) list = list.filter((a) => segF.includes(a.agSeg))
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((a) => (a.agName || '').toLowerCase().includes(q) || (a.msdl || '').toLowerCase().includes(q) || (a.unit || '').toLowerCase().includes(q))
    list = applySortLocal(list, sort.tvv)
    if (!list.length) { alert('Không có dữ liệu phù hợp bộ lọc hiện tại để xuất'); return }
    const rows = list.map((a) => ({
      'Unit': a.unit, 'Mã TVV': a.msdl, 'Tên TVV': a.agName, 'Hạng': a.agSeg,
      'Case Sub': Math.round(a.caseSub || 0), 'Case Net': Math.round(a.caseNet || 0),
      'IP Sub': Math.round(a.ipSub || 0), 'IP Net': Math.round(a.ipNet || 0),
      'FYP': Math.round(a.fyp || 0), 'FYC': Math.round(a.fyc || 0),
      'Số HS IF': a.cIF || 0, 'Số HS PS': a.cPS || 0, 'Số HS Khác': a.cOther || 0,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'TVV')
    XLSX.writeFile(wb, `TVV_${latestDate}.xlsx`)
  }

  // ---------- TREND MODAL ----------
  const openTrend = async (msdl, agName) => {
    const dates = allDates.filter((d) => d.startsWith(month))
    setTrend({ msdl, agName, metric: 'caseNet', loading: true, docs: [], data: [], pendingRows: [], pipelineRows: [] })
    try {
      const docs = await Promise.all(dates.map(async (d) => {
        const doc = await getDocOnce('daily_sales_tvv', d)
        const a = doc && doc.agents ? normalizeAgent(doc.agents[msdl]) : null
        return { date: d.slice(8, 10), full: d, agent: a }
      }))
      const latestDate = allDates.length ? allDates[allDates.length - 1] : null
      const latestDoc = latestDate ? normalizeDoc(await getDocOnce('daily_sales_tvv', latestDate)) : null
      setTrend({
        msdl, agName, metric: 'caseNet', loading: false, docs, latestDate,
        data: docs.map((x) => ({ date: x.date, value: x.agent ? (x.agent.caseNet || 0) : 0 })),
        pendingRows: latestDoc ? (latestDoc.pendingRows || []).filter((r) => r.msdl === msdl) : [],
        pipelineRows: latestDoc ? (latestDoc.pipelineRows || []).filter((r) => r.msdl === msdl) : [],
      })
    } catch (e) {
      console.error('[TvvDailyTab] openTrend:', e)
      setTrend((t) => t && { ...t, loading: false })
    }
  }
  const changeTrendMetric = (metric) => {
    setTrend((t) => t && { ...t, metric, data: t.docs.map((x) => ({ date: x.date, value: x.agent ? (x.agent[metric] || 0) : 0 })) })
  }

  // ---------- DỮ LIỆU ĐÃ LỌC (giữ nguyên logic render file gốc) ----------
  const agents = dayData ? dayData.agents : {}
  const baseAgents = baseData ? baseData.agents : {}
  const units = dayData ? dayData.units : {}
  const baseUnits = baseData ? baseData.units : {}
  const proposalRows = dayData ? (dayData.proposalRows || []) : []
  const pendingRows = dayData ? (dayData.pendingRows || []) : []
  const basePendingRows = baseData ? (baseData.pendingRows || []) : []
  const pipelineRows = dayData ? (dayData.pipelineRows || []) : []
  const basePipelineRows = baseData ? (baseData.pipelineRows || []) : []

  const unitList = useMemo(() => Array.from(new Set(Object.values(units).map((u) => u.unit).filter(Boolean))).sort(), [units])
  const segList = useMemo(() => Array.from(new Set(Object.values(agents).map((a) => a.agSeg).filter(Boolean))).sort(), [agents])
  const unitF = unitSel.filter((v) => unitList.includes(v))
  const segF = segSel.filter((v) => segList.includes(v))
  const q = search.trim().toLowerCase()

  const onSort = (tab, key) => setSort((s) => ({
    ...s, [tab]: { key, dir: s[tab].key === key ? -s[tab].dir : 1 },
  }))
  const applySort = (list, tab) => applySortLocal(list, sort[tab])

  // TVV
  let tvvList = Object.values(agents)
  if (unitF.length) tvvList = tvvList.filter((a) => unitF.includes(a.unit))
  if (segF.length) tvvList = tvvList.filter((a) => segF.includes(a.agSeg))
  if (q) tvvList = tvvList.filter((a) => (a.agName || '').toLowerCase().includes(q) || (a.msdl || '').toLowerCase().includes(q) || (a.unit || '').toLowerCase().includes(q))
  tvvList = applySort(tvvList, 'tvv')

  // Leader
  let leaderList = Object.values(units)
  if (unitF.length) leaderList = leaderList.filter((u) => unitF.includes(u.unit))
  if (q) leaderList = leaderList.filter((u) => (u.unit || '').toLowerCase().includes(q) || (u.leaderName || '').toLowerCase().includes(q))
  leaderList = applySort(leaderList, 'leader')

  // Pending
  let pendingList = pendingRows.slice()
  if (q) pendingList = pendingList.filter((r) => (r.agName || '').toLowerCase().includes(q) || (r.unit || '').toLowerCase().includes(q))
  pendingList = pendingList.map((r) => ({ ...r, daysPending: r.proposalDate ? Math.floor((new Date() - new Date(r.proposalDate)) / 86400000) : null }))
  pendingList = applySort(pendingList, 'pending')
  const basePendingSet = new Set(basePendingRows.map((r) => r.proposalNum))
  const curPendingSet = new Set(pendingRows.map((r) => r.proposalNum))
  const pendingResolved = basePendingRows.filter((r) => !curPendingSet.has(r.proposalNum)).length
  const pendingNew = pendingRows.filter((r) => !basePendingSet.has(r.proposalNum)).length

  // Other
  let otherList = proposalRows.filter((r) => r.statusGroup === 'OTHER')
  if (q) otherList = otherList.filter((r) => (r.agName || '').toLowerCase().includes(q) || (r.unit || '').toLowerCase().includes(q))
  otherList = applySort(otherList, 'other')

  // Pipeline
  let pipeList = pipelineRows.slice()
  if (q) pipeList = pipeList.filter((r) => (r.agName || '').toLowerCase().includes(q) || (r.unit || '').toLowerCase().includes(q))
  const basePipeSet = new Set(basePipelineRows.map((r) => r.proposalNum))
  const curPipeSet = new Set(pipelineRows.map((r) => r.proposalNum))
  const pipeResolved = basePipelineRows.filter((r) => !curPipeSet.has(r.proposalNum)).length
  const pipeNew = pipelineRows.filter((r) => !basePipeSet.has(r.proposalNum)).length
  const pipeByAgent = {}
  for (const r of pipeList) {
    if (!pipeByAgent[r.msdl]) pipeByAgent[r.msdl] = { unit: r.unit, msdl: r.msdl, agName: r.agName, count: 0, ape: 0 }
    pipeByAgent[r.msdl].count++; pipeByAgent[r.msdl].ape += r.ape
  }
  const pipeSummary = applySort(Object.values(pipeByAgent), 'pipeline')

  // KPI
  const totals = Object.values(agents).reduce((acc, a) => {
    acc.caseSub += a.caseSub; acc.caseNet += a.caseNet; acc.ipSub += a.ipSub; acc.ipNet += a.ipNet
    acc.cIF += a.cIF; acc.cPS += a.cPS; acc.cOther += a.cOther
    return acc
  }, { caseSub: 0, caseNet: 0, ipSub: 0, ipNet: 0, cIF: 0, cPS: 0, cOther: 0 })
  const baseTotals = Object.values(baseAgents).reduce((acc, a) => {
    acc.caseSub += a.caseSub; acc.caseNet += a.caseNet; acc.ipSub += a.ipSub; acc.ipNet += a.ipNet
    return acc
  }, { caseSub: 0, caseNet: 0, ipSub: 0, ipNet: 0 })
  const kpis = [
    { label: 'Số TVV', val: Object.values(agents).length, base: null, color: 'c5' },
    { label: 'Case Sub', val: totals.caseSub, base: baseTotals.caseSub, color: 'c1' },
    { label: 'Case Net', val: totals.caseNet, base: baseTotals.caseNet, color: 'c1' },
    { label: 'IP Sub', val: totals.ipSub, base: baseTotals.ipSub, color: 'c4' },
    { label: 'IP Net', val: totals.ipNet, base: baseTotals.ipNet, color: 'c4' },
    { label: 'Hồ sơ IF / PS / Khác', val: `${totals.cIF} / ${totals.cPS} / ${totals.cOther}`, base: null, color: 'c5' },
    { label: 'Tổng Pending (APE, tr)', val: sumApe(pendingRows), base: sumApe(basePendingRows), color: 'c7' },
    { label: 'Tổng Pipeline (APE chưa phí, tr)', val: sumApe(pipelineRows), base: sumApe(basePipelineRows), color: 'c2' },
  ]

  const tabBtn = (key, label) => (
    <button key={key} onClick={() => setActiveTab(key)}
      style={{
        padding: '10px 18px', background: 'none', border: 'none', fontSize: 14, cursor: 'pointer',
        color: activeTab === key ? 'var(--primary)' : 'var(--text3)',
        borderBottom: activeTab === key ? '3px solid var(--primary)' : '3px solid transparent',
        marginBottom: -2, fontWeight: 600,
      }}>
      {label}
    </button>
  )

  const loading = datesLoading || (viewDate && dayLoading)
  const inputStyle = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, fontSize: 13, minWidth: 140 }

  return (
    <div className="page-content">
      {/* ===== UPLOAD (chỉ admin) ===== */}
      {isAdmin && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="section-header"><span className="section-icon">⬆️</span>Tải file Daily Sales (đầy đủ sheet: Proposal, Agent, Leader, Pending, Pipeline)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>File Excel</label>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>Áp dụng cho ngày</label>
              <input type="date" value={uploadDate} onChange={(e) => setUploadDate(e.target.value)} style={inputStyle} />
            </div>
            <button className="upload-btn" disabled={!parsed || saving} onClick={handleSave}>
              {saving ? 'Đang lưu...' : 'Xử lý & Lưu vào hệ thống'}
            </button>
          </div>
          {uploadMsg && (
            <div style={{ fontSize: 13, marginTop: 8, whiteSpace: 'pre-line' }}>
              {uploadMsg.type === 'error' && <span style={{ color: 'var(--red)' }}>{uploadMsg.text}</span>}
              {uploadMsg.type === 'success' && <span style={{ color: 'var(--green)', fontWeight: 600 }}>{uploadMsg.text}</span>}
              {uploadMsg.type === 'info' && (
                <div>
                  <div>{uploadMsg.summary}</div>
                  <div style={{ fontSize: 12, marginTop: 8 }}>
                    {[['Proposal', 'proposal'], ['Agent', 'agent'], ['Leader', 'leader'], ['Pending', 'pending'], ['Pipeline', 'pipeline']].map(([label, key]) => (
                      <span key={key} style={{ display: 'inline-block', marginRight: 14, color: uploadMsg.sheets[key] ? 'var(--green)' : 'var(--red)' }}>
                        {uploadMsg.sheets[key] ? '✔' : '✘'} {label}
                      </span>
                    ))}
                  </div>
                  <div style={{ marginTop: 4, color: 'var(--text3)' }}>Chọn ngày áp dụng rồi bấm Lưu.</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== CONTROLS ===== */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="section-header"><span className="section-icon">🔎</span>Xem & So sánh dữ liệu</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>Tháng</label>
            <select value={month} onChange={(e) => handleMonthChange(e.target.value)} style={inputStyle}>
              {months.length === 0 && <option value="">(chưa có dữ liệu)</option>}
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>Ngày xem</label>
            <select value={viewDate} onChange={(e) => handleViewDateChange(e.target.value)} style={inputStyle}>
              {datesOfMonth.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>So sánh với ngày</label>
            <select value={baseDate} onChange={(e) => setBaseDate(e.target.value)} style={inputStyle}>
              <option value="">(không so sánh)</option>
              {datesOfMonth.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>Unit</label>
            <MultiDropdown label="Unit" values={unitList} selected={unitSel} onChange={setUnitSel} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>Hạng TVV</label>
            <MultiDropdown label="hạng" values={segList} selected={segSel} onChange={setSegSel} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>Tìm kiếm TVV / Unit</label>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tên, mã MSDL, Unit..." style={{ ...inputStyle, minWidth: 220 }} />
          </div>
          <button className="upload-btn" style={{ background: '#fff', color: 'var(--primary)', border: '1px solid var(--primary)', boxShadow: 'none' }} onClick={() => refreshDates(viewDate)}>
            ↻ Tải lại
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" /><div style={{ fontSize: 13, color: 'var(--text3)' }}>Đang tải dữ liệu...</div></div>
      ) : (
        <>
          {/* ===== KPI ===== */}
          <div className="kpi-grid" style={{ marginBottom: 14 }}>
            {kpis.map((k, i) => (
              <div key={i} className={`kpi-card ${k.color}`}>
                <div className="kpi-header"><span className="kpi-label">{k.label}</span></div>
                <div className="kpi-value">{typeof k.val === 'number' ? fmt(k.val) : k.val}</div>
                {k.base !== null && <div><KpiDelta cur={k.val} base={k.base} /></div>}
              </div>
            ))}
          </div>

          {/* ===== TABS ===== */}
          <div className="card">
            <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid var(--border)', marginBottom: 16, flexWrap: 'wrap' }}>
              {tabBtn('tvv', 'TVV')}
              {tabBtn('leader', 'Leader')}
              {tabBtn('pending', 'Pending (PS)')}
              {tabBtn('other', 'Khác (DC/CF/PO/WD)')}
              {tabBtn('pipeline', 'Pipeline (chưa phí)')}
            </div>

            {activeTab === 'tvv' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <button className="upload-btn" style={{ background: '#fff', color: 'var(--primary)', border: '1px solid var(--primary)', boxShadow: 'none' }} onClick={exportTvvLatest}>
                    ⬇️ Xuất Excel (dữ liệu mới nhất)
                  </button>
                </div>
                <div className="data-table-wrap" style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead><tr>
                      <SortTh tab="tvv" k="unit" sort={sort} onSort={onSort}>Unit</SortTh>
                      <SortTh tab="tvv" k="msdl" sort={sort} onSort={onSort}>Mã TVV</SortTh>
                      <SortTh tab="tvv" k="agName" sort={sort} onSort={onSort}>Tên TVV</SortTh>
                      <SortTh tab="tvv" k="agSeg" sort={sort} onSort={onSort}>Hạng</SortTh>
                      <SortTh tab="tvv" k="caseSub" sort={sort} onSort={onSort} style={COL.case.th}>Case Sub</SortTh>
                      <SortTh tab="tvv" k="caseNet" sort={sort} onSort={onSort} style={COL.case.th}>Case Net</SortTh>
                      <SortTh tab="tvv" k="ipSub" sort={sort} onSort={onSort} style={COL.ip.th}>IP Sub</SortTh>
                      <SortTh tab="tvv" k="ipNet" sort={sort} onSort={onSort} style={COL.ip.th}>IP Net</SortTh>
                      <SortTh tab="tvv" k="fyp" sort={sort} onSort={onSort} style={COL.fyp.th}>FYP</SortTh>
                      <SortTh tab="tvv" k="fyc" sort={sort} onSort={onSort} style={COL.fyp.th}>FYC</SortTh>
                      <SortTh tab="tvv" k="cIF" sort={sort} onSort={onSort} style={COL.count.th}>Số HS IF</SortTh>
                      <SortTh tab="tvv" k="cPS" sort={sort} onSort={onSort} style={COL.count.th}>Số HS PS</SortTh>
                      <SortTh tab="tvv" k="cOther" sort={sort} onSort={onSort} style={COL.count.th}>Số HS Khác</SortTh>
                      <th>Xu hướng</th>
                    </tr></thead>
                    <tbody>
                      {!tvvList.length && <EmptyRow colSpan={14} text="Không có dữ liệu — hãy tải file cho ngày này" />}
                      {tvvList.map((a) => {
                        const base = baseAgents[a.msdl]
                        return (
                          <tr key={a.msdl}>
                            <td>{a.unit}</td><td>{a.msdl}</td><td>{a.agName}</td>
                            <td style={SEG_STYLE[a.agSeg] || undefined}>{a.agSeg || ''}</td>
                            <CellDelta cur={a.caseSub} base={base?.caseSub} col="case" />
                            <CellDelta cur={a.caseNet} base={base?.caseNet} col="case" />
                            <CellDelta cur={a.ipSub} base={base?.ipSub} col="ip" />
                            <CellDelta cur={a.ipNet} base={base?.ipNet} col="ip" />
                            <CellDelta cur={a.fyp} base={base?.fyp} col="fyp" />
                            <CellDelta cur={a.fyc} base={base?.fyc} col="fyp" />
                            <td style={COL.count.td}>{a.cIF}</td>
                            <td style={COL.count.td}>{a.cPS}</td>
                            <td style={COL.count.td}>{a.cOther}</td>
                            <td><button onClick={() => openTrend(a.msdl, a.agName)}
                              style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--primary)' }}>📈</button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'leader' && (
              <div className="data-table-wrap" style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead><tr>
                    <SortTh tab="leader" k="unit" sort={sort} onSort={onSort}>Unit</SortTh>
                    <SortTh tab="leader" k="leaderName" sort={sort} onSort={onSort}>Leader</SortTh>
                    <SortTh tab="leader" k="manpower" sort={sort} onSort={onSort}>Số TVV</SortTh>
                    <SortTh tab="leader" k="caseSubUnit" sort={sort} onSort={onSort} style={COL.case.th}>Case Sub</SortTh>
                    <SortTh tab="leader" k="caseNetUnit" sort={sort} onSort={onSort} style={COL.case.th}>Case Net</SortTh>
                    <SortTh tab="leader" k="ipSubUnit" sort={sort} onSort={onSort} style={COL.ip.th}>IP Sub</SortTh>
                    <SortTh tab="leader" k="ipNetUnit" sort={sort} onSort={onSort} style={COL.ip.th}>IP Net</SortTh>
                    <SortTh tab="leader" k="apeSubUnit" sort={sort} onSort={onSort} style={COL.fyp.th}>APE Sub</SortTh>
                    <SortTh tab="leader" k="apeNetUnit" sort={sort} onSort={onSort} style={COL.fyp.th}>APE Net</SortTh>
                    <SortTh tab="leader" k="cIF" sort={sort} onSort={onSort} style={COL.count.th}>Số HS IF</SortTh>
                    <SortTh tab="leader" k="cPS" sort={sort} onSort={onSort} style={COL.count.th}>Số HS PS</SortTh>
                    <SortTh tab="leader" k="cOther" sort={sort} onSort={onSort} style={COL.count.th}>Số HS Khác</SortTh>
                  </tr></thead>
                  <tbody>
                    {!leaderList.length && <EmptyRow colSpan={12} text="Không có dữ liệu" />}
                    {leaderList.map((u) => {
                      const base = baseUnits[u.unit]
                      return (
                        <tr key={u.unit}>
                          <td>{u.unit}</td><td>{u.leaderName}</td><td>{u.manpower}</td>
                          <CellDelta cur={u.caseSubUnit} base={base?.caseSubUnit} col="case" />
                          <CellDelta cur={u.caseNetUnit} base={base?.caseNetUnit} col="case" />
                          <CellDelta cur={u.ipSubUnit} base={base?.ipSubUnit} col="ip" />
                          <CellDelta cur={u.ipNetUnit} base={base?.ipNetUnit} col="ip" />
                          <CellDelta cur={u.apeSubUnit} base={base?.apeSubUnit} col="fyp" />
                          <CellDelta cur={u.apeNetUnit} base={base?.apeNetUnit} col="fyp" />
                          <td style={COL.count.td}>{u.cIF}</td>
                          <td style={COL.count.td}>{u.cPS}</td>
                          <td style={COL.count.td}>{u.cOther}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'pending' && (
              <div>
                {basePendingRows.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', background: '#f8f9ff', border: '1px dashed var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                    So với ngày trước: {pendingResolved} hồ sơ đã xử lý xong (không còn Pending), {pendingNew} hồ sơ Pending mới.
                  </div>
                )}
                <div className="data-table-wrap" style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead><tr>
                      <th>Trạng thái</th><th>Unit</th><th>TVV</th><th>Số hồ sơ</th><th>Sản phẩm</th>
                      <SortTh tab="pending" k="proposalDate" sort={sort} onSort={onSort}>Ngày nộp</SortTh>
                      <SortTh tab="pending" k="daysPending" sort={sort} onSort={onSort}>Số ngày chờ</SortTh>
                      <SortTh tab="pending" k="ape" sort={sort} onSort={onSort}>APE (tr)</SortTh>
                      <th>Người xử lý (PO)</th><th>Lý do chính</th><th>Yêu cầu còn thiếu</th>
                    </tr></thead>
                    <tbody>
                      {!pendingList.length && <EmptyRow colSpan={11} text="Không có hồ sơ Pending (PS)" />}
                      {pendingList.map((r, i) => (
                        <tr key={r.proposalNum + '_' + i}>
                          <td>{basePendingRows.length && !basePendingSet.has(r.proposalNum) ? <NewBadge /> : ''}</td>
                          <td>{r.unit}</td><td>{r.agName}</td><td>{r.proposalNum}</td><td style={{ whiteSpace: 'normal' }}>{r.product}</td>
                          <td>{r.proposalDate || ''}</td><td>{r.daysPending ?? ''}</td><td>{fmt(r.ape)}</td>
                          <td>{r.poName}</td><td style={{ whiteSpace: 'normal' }}>{r.description}</td>
                          <td style={{ whiteSpace: 'normal' }}><ReqTags requirements={r.requirements} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'other' && (
              <div className="data-table-wrap" style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead><tr>
                    <th>Tình trạng</th><th>Unit</th><th>TVV</th><th>Số hồ sơ</th><th>Sản phẩm</th>
                    <SortTh tab="other" k="proposalDate" sort={sort} onSort={onSort}>Ngày nộp</SortTh>
                    <SortTh tab="other" k="ipSub" sort={sort} onSort={onSort}>IP Sub</SortTh>
                  </tr></thead>
                  <tbody>
                    {!otherList.length && <EmptyRow colSpan={7} text="Không có hồ sơ khác (DC/CF/PO/WD)" />}
                    {otherList.map((r, i) => (
                      <tr key={r.proposalNum + '_' + i}>
                        <td>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: '#fee2e2', color: '#991b1b', whiteSpace: 'nowrap' }}>
                            {r.status}
                          </span>{' '}{r.statusFull || ''}
                        </td>
                        <td>{r.unit}</td><td>{r.agName}</td><td>{r.proposalNum}</td>
                        <td style={{ whiteSpace: 'normal' }}>{r.product}</td>
                        <td>{r.proposalDate || ''}</td><td>{fmt(r.ipSub)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'pipeline' && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text2)', background: '#f8f9ff', border: '1px dashed var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                  Hồ sơ đã nộp nhưng <b>chưa đóng phí</b> nên chưa được ghi nhận Case/IP Sub — lấy trực tiếp từ sheet "Pipeline" trong file tải lên.
                </div>
                {basePipelineRows.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', background: '#f8f9ff', border: '1px dashed var(--border)', borderRadius: 8, padding: '10px 12px', marginTop: 6 }}>
                    So với ngày trước: {pipeResolved} hồ sơ đã đóng phí hoặc rời khỏi Pipeline, {pipeNew} hồ sơ Pipeline mới.
                  </div>
                )}
                <h3 style={{ fontSize: 13, margin: '14px 0 6px', color: 'var(--text2)' }}>Tổng hợp theo TVV</h3>
                <div className="data-table-wrap" style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead><tr>
                      <th>Unit</th><th>Mã TVV</th><th>Tên TVV</th>
                      <SortTh tab="pipeline" k="count" sort={sort} onSort={onSort}>Số hồ sơ</SortTh>
                      <SortTh tab="pipeline" k="ape" sort={sort} onSort={onSort}>Tổng APE chưa phí (tr)</SortTh>
                    </tr></thead>
                    <tbody>
                      {!pipeSummary.length && <EmptyRow colSpan={5} text="Không có dữ liệu Pipeline cho ngày này" />}
                      {pipeSummary.map((a) => (
                        <tr key={a.msdl}>
                          <td>{a.unit}</td><td>{a.msdl}</td><td>{a.agName}</td><td>{a.count}</td><td>{fmt(a.ape)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <h3 style={{ fontSize: 13, margin: '18px 0 6px', color: 'var(--text2)' }}>Chi tiết hồ sơ</h3>
                <div className="data-table-wrap" style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead><tr>
                      <th>Trạng thái</th><th>Unit</th><th>TVV</th><th>Số hồ sơ</th><th>Sản phẩm</th>
                      <SortTh tab="pipeline" k="proposalDate" sort={sort} onSort={onSort}>Ngày nộp</SortTh>
                      <SortTh tab="pipeline" k="ape" sort={sort} onSort={onSort}>APE (tr)</SortTh>
                      <th>PO</th>
                    </tr></thead>
                    <tbody>
                      {!pipeList.length && <EmptyRow colSpan={8} text="Không có dữ liệu Pipeline cho ngày này" />}
                      {pipeList.map((r, i) => (
                        <tr key={r.proposalNum + '_' + i}>
                          <td>{basePipelineRows.length && !basePipeSet.has(r.proposalNum) ? <NewBadge /> : ''}</td>
                          <td>{r.unit}</td><td>{r.agName}</td><td>{r.proposalNum}</td>
                          <td style={{ whiteSpace: 'normal' }}>{r.product}</td>
                          <td>{r.proposalDate || ''}</td><td>{fmt(r.ape)}</td><td>{r.poName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== TREND MODAL ===== */}
      {trend && (
        <div className="modal-overlay" onClick={() => setTrend(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Xu hướng theo ngày — {trend.agName} ({trend.msdl})</div>
              <button className="modal-close" onClick={() => setTrend(null)}>✕</button>
            </div>
            <div className="modal-body">
              <a href={`/tvv-profile.html?code=${encodeURIComponent(trend.msdl)}&year=${viewDate ? viewDate.slice(0, 4) : new Date().getFullYear()}&month=${viewDate ? Number(viewDate.slice(5, 7)) : new Date().getMonth() + 1}`}
                target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: 'var(--primary)', textDecoration: 'none', display: 'inline-block', marginBottom: 10 }}>
                🔗 Mở Hồ sơ TVV đầy đủ (tổng hợp mọi tab)
              </a>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                <label style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>Chỉ số</label>
                <select value={trend.metric} onChange={(e) => changeTrendMetric(e.target.value)} style={inputStyle}>
                  <option value="caseNet">Case Net</option>
                  <option value="caseSub">Case Sub</option>
                  <option value="ipNet">IP Net</option>
                  <option value="ipSub">IP Sub</option>
                  <option value="fyp">FYP</option>
                  <option value="fyc">FYC</option>
                </select>
              </div>
              {trend.loading ? (
                <div className="loading"><div className="spinner" /></div>
              ) : (
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f4ff" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => [fmt(v), trend.metric]} />
                      <Line type="monotone" dataKey="value" stroke="var(--primary)" fill="#e8edff" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 13, margin: '0 0 6px', color: 'var(--text2)' }}>
                  🕒 Hồ sơ đang Pending <span style={{ fontWeight: 400, color: 'var(--text3)' }}>{trend.latestDate ? `(cập nhật ngày ${trend.latestDate})` : ''}</span>
                </h3>
                <div className="data-table-wrap" style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead><tr><th>Số hồ sơ</th><th>Sản phẩm</th><th>Ngày nộp</th><th>APE (tr)</th><th>PO</th><th>Yêu cầu còn thiếu</th></tr></thead>
                    <tbody>
                      {!trend.pendingRows.length && <EmptyRow colSpan={6} text="Không có hồ sơ Pending" />}
                      {trend.pendingRows.map((r, i) => (
                        <tr key={r.proposalNum + '_' + i}>
                          <td>{r.proposalNum}</td><td style={{ whiteSpace: 'normal' }}>{r.product}</td><td>{r.proposalDate || ''}</td>
                          <td>{fmt(r.ape)}</td><td>{r.poName}</td><td style={{ whiteSpace: 'normal' }}><ReqTags requirements={r.requirements} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 13, margin: '0 0 6px', color: 'var(--text2)' }}>
                  💤 Hồ sơ Pipeline (chưa phí) <span style={{ fontWeight: 400, color: 'var(--text3)' }}>{trend.latestDate ? `(cập nhật ngày ${trend.latestDate})` : ''}</span>
                </h3>
                <div className="data-table-wrap" style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead><tr><th>Số hồ sơ</th><th>Sản phẩm</th><th>Ngày nộp</th><th>APE (tr)</th><th>PO</th></tr></thead>
                    <tbody>
                      {!trend.pipelineRows.length && <EmptyRow colSpan={5} text="Không có hồ sơ Pipeline" />}
                      {trend.pipelineRows.map((r, i) => (
                        <tr key={r.proposalNum + '_' + i}>
                          <td>{r.proposalNum}</td><td style={{ whiteSpace: 'normal' }}>{r.product}</td><td>{r.proposalDate || ''}</td>
                          <td>{fmt(r.ape)}</td><td>{r.poName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// sắp xếp chung (giữ nguyên logic file gốc)
function applySortLocal(list, s) {
  if (!s || !s.key) return list
  return [...list].sort((a, b) => {
    const av = a[s.key], bv = b[s.key]
    if (typeof av === 'string') return av.localeCompare(bv) * s.dir
    return ((av || 0) - (bv || 0)) * s.dir
  })
}
