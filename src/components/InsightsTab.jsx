import React, { useEffect, useMemo, useState } from 'react'
import { formatNum, formatNum2, mocActInfo } from '../utils/parseExcel'
import { useReportsDoc, useManMark, useDailyTopDoc, listDailySalesInMonth, getDocOnce, normalizeAgent } from '../lib/db'
import { collectOpenCases } from '../lib/salesReportLogic'
import ColumnToggle, { useVisibleColumns } from './ColumnToggle'
import {
  monthPace, funnelStats, unitStats, nearPEList, zeroFycAgents, topBy,
  aggregateDailyMonth, forecastFromDaily,
  buildConversionRates, conversionRateFor, finishScenarios, ageBuckets,
  issuedIpByAgent, raceNovTier, q4BonusIp, q4GiftTier, unitRowHasData,
} from '../lib/insightsLogic'

const DATA_YEAR = 2026
const VN_MONTHS = { 1:'T1',2:'T2',3:'T3',4:'T4',5:'T5',6:'T6',7:'T7',8:'T8',9:'T9',10:'T10',11:'T11',12:'T12' }
const tr = (vnd) => formatNum((Number(vnd) || 0) / 1e6) // VND → triệu
const fmtDM = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : iso }
const fmtDMY = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso }

const VERDICT_UI = {
  ahead:      { label: '🚀 Nhanh hơn nhịp tháng', bg: '#e6faf2', color: '#065f46' },
  ontrack:    { label: '✅ Đúng nhịp',            bg: '#e6faf2', color: '#065f46' },
  behind:     { label: '⚠️ Chậm hơn nhịp tháng',  bg: '#fff0f0', color: '#b91c1c' },
  done:       { label: '🏁 Đã đạt mục tiêu',      bg: '#e6faf2', color: '#065f46' },
  missed:     { label: '🏁 Kết thúc — chưa đạt',  bg: '#fff0f0', color: '#b91c1c' },
  'no-target':{ label: 'Chưa có mục tiêu tháng',  bg: '#f1f3f9', color: '#5b6478' },
}

// Cột bảng Sức khỏe Unit (bật/tắt được, ghi nhớ theo máy)
const UNIT_COLS = [
  { key: 'leader',   label: 'Leader' },
  { key: 'tvvPe',    label: 'TVV (AG-PE)' },
  { key: 'active',   label: 'TVV có số (Daily)' },
  { key: 'fyp',      label: 'FYP tháng (Daily)' },
  { key: 'fyc',      label: 'FYC tháng (Daily)' },
  { key: 'ipNet',    label: 'IP Net (Daily)' },
  { key: 'caseNet',  label: 'Case Net (Daily)' },
  { key: 'hs',       label: 'Hồ sơ IF/PS/Khác' },
  { key: 'pctIF',    label: '% Phát hành' },
  { key: 'trend',    label: 'Xu hướng 7 ngày' },
  { key: 'target',   label: 'Mục tiêu ManMark' },
  { key: 'pctTarget',label: '% Mục tiêu (theo FYP Daily)' },
  { key: 'fycQuy',   label: 'FYC Quý (AG-PE)' },
  { key: 'peDat',    label: 'Đạt PE (AG-PE)' },
]
const UNIT_SORTERS = {
  fyp: (r) => r.fyp, fyc: (r) => r.fyc, ipNet: (r) => r.ipNet, caseNet: (r) => r.caseNet,
  pctIF: (r) => r.pctIF ?? -1, trend: (r) => r.trendPct ?? -9999,
  pctTarget: (r) => r.pctTarget ?? -1, fycQuy: (r) => r.fycQuy, active: (r) => r.tvvCoSo,
}

function SortTh({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey
  return (
    <th onClick={() => onSort(sortKey)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} title="Click để sắp xếp">
      {label} <span style={{ fontSize: 9, color: active ? '#4361ee' : '#c5cde8' }}>{active ? (sort.dir === 'desc' ? '▼' : '▲') : '↕'}</span>
    </th>
  )
}

export default function InsightsTab({ data, onNavigate }) {
  const now = new Date()
  const curMonth = now.getFullYear() === DATA_YEAR ? now.getMonth() + 1 : null
  const excelMonths = data?.availableMonths || []
  const monthOptions = useMemo(() => {
    const s = new Set(excelMonths)
    if (curMonth) s.add(curMonth)
    return [...s].sort((a, b) => a - b)
  }, [excelMonths, curMonth])
  const [month, setMonth] = useState(() => (curMonth && monthOptions.includes(curMonth))
    ? curMonth
    : (monthOptions[monthOptions.length - 1] || curMonth || 1))

  const monthlyKpis = data?.monthlyKpis || {}
  const agList = data?.agList || []
  const umList = data?.umList || []

  const { data: dailyTop } = useDailyTopDoc()
  const { data: reportsDoc, loading: reportsLoading } = useReportsDoc(DATA_YEAR, month)
  const { data: mmDoc } = useManMark(DATA_YEAR, month)

  // ── Daily Sales của tháng (các snapshot theo ngày) ──────────
  const [dailyDocs, setDailyDocs] = useState([])
  const [dailyLoading, setDailyLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setDailyLoading(true)
    listDailySalesInMonth(DATA_YEAR, month)
      .then((docs) => { if (alive) { setDailyDocs(docs); setDailyLoading(false) } })
      .catch(() => { if (alive) { setDailyDocs([]); setDailyLoading(false) } })
    return () => { alive = false }
  }, [month])
  const dailyAgg = useMemo(() => aggregateDailyMonth(dailyDocs), [dailyDocs])
  const dailyFc = useMemo(
    () => forecastFromDaily(dailyAgg, { year: DATA_YEAR, month, today: now }),
    [dailyAgg, month] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // ── Lịch sử Sales Report cả năm → tỷ lệ chuyển đổi theo Unit (kỹ thuật ManMark) ──
  const [yearlyPersons, setYearlyPersons] = useState(null) // { [month]: persons[] }
  useEffect(() => {
    let alive = true
    Promise.all(
      Array.from({ length: 12 }, (_, i) => i + 1).map(async (m) => {
        try {
          const rep = await getDocOnce('reports', `${DATA_YEAR}-${m}`)
          const raw = rep?.data
          const arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : []
          return [m, arr.map(normalizeAgent).filter((p) => p && p.daily)]
        } catch { return [m, []] }
      })
    ).then((rs) => { if (alive) setYearlyPersons(Object.fromEntries(rs)) })
    return () => { alive = false }
  }, [])
  const codeToUnit = useMemo(() => {
    const map = new Map()
    agList.forEach((a) => { if (a.msddl) map.set(String(a.msddl), a.unit || '') })
    return map
  }, [agList])
  const convIndex = useMemo(() => {
    if (!yearlyPersons) return null
    const past = []
    for (let m = 1; m < month; m++) past.push(yearlyPersons[m] || [])
    return buildConversionRates(past, (p) => codeToUnit.get(String(p.msdl || '')) || p.group || '')
  }, [yearlyPersons, month, codeToUnit])
  // ── 🏁 Thi đua T11 & Quý 4: tự nạp Daily T10/T11/T12 (độc lập tháng đang xem) ──
  const [raceDocs, setRaceDocs] = useState(null) // { 10: docs, 11: docs, 12: docs }
  useEffect(() => {
    let alive = true
    Promise.all([10, 11, 12].map(async (m) => {
      try { return [m, await listDailySalesInMonth(DATA_YEAR, m)] } catch { return [m, []] }
    })).then((rs) => { if (alive) setRaceDocs(Object.fromEntries(rs)) })
    return () => { alive = false }
  }, [])
  const race = useMemo(() => {
    if (!raceDocs) return null
    const novIssued = issuedIpByAgent(raceDocs[11] || [])
    const octQ = issuedIpByAgent(raceDocs[10] || [], { forQ4: true })
    const novQ = issuedIpByAgent(raceDocs[11] || [], { forQ4: true })
    const decQ = issuedIpByAgent(raceDocs[12] || [], { forQ4: true })
    const octMap = new Map(octQ.rows.map((r) => [r.msdl, r]))
    const novMap = new Map(novQ.rows.map((r) => [r.msdl, r]))
    const decMap = new Map(decQ.rows.map((r) => [r.msdl, r]))
    const codes = new Set([...octMap.keys(), ...novMap.keys(), ...decMap.keys()])
    const q4Rows = [...codes].map((code) => {
      const o = octMap.get(code), n = novMap.get(code), d = decMap.get(code)
      const bonusIp = q4BonusIp({ octIp: o?.ip || 0, novIp: n?.ip || 0, novIpTA9: n?.ipTA9 || 0, decIp: d?.ip || 0, decIpTA9: d?.ipTA9 || 0 })
      return {
        msdl: code, name: (n || o || d)?.name || '', unit: (n || o || d)?.unit || '',
        octIp: o?.ip || 0, novIp: n?.ip || 0, novIpTA9: n?.ipTA9 || 0, decIp: d?.ip || 0,
        bonusIp, ...q4GiftTier(bonusIp),
      }
    }).filter((r) => r.bonusIp > 0).sort((a, b) => b.bonusIp - a.bonusIp)
    // Ngày còn lại: T11 tính từ snapshot T11 mới nhất; Quý 4 tính tới 31/12
    const novLatestDay = novIssued.latestDate ? Number(novIssued.latestDate.slice(8, 10)) : null
    const daysLeftNov = novLatestDay ? Math.max(30 - novLatestDay, 0) : null
    const daysLeftQ4 = novLatestDay !== null
      ? (30 - novLatestDay) + 31
      : (octQ.latestDate ? 30 + 31 : null)
    const novRows = novIssued.rows.map((r) => ({ ...r, ...raceNovTier(r.ip) }))
    return {
      novRows, q4Rows, daysLeftNov, daysLeftQ4,
      hasOct: (raceDocs[10] || []).length > 0, hasNov: (raceDocs[11] || []).length > 0,
      novLatestDate: novIssued.latestDate,
      novReached: novRows.filter((r) => r.bonus > 0).length,
      novTotalBonus: novRows.reduce((s, r) => s + r.bonus, 0),
      q4Gifted: q4Rows.filter((r) => r.gift).length,
    }
  }, [raceDocs])

  // Kỳ vọng phát hành theo Unit: (PS IP + Pipeline APE đang chờ) × tỷ lệ chuyển đổi riêng
  const unitExpect = useMemo(() => {
    if (!dailyAgg || !convIndex) return []
    return dailyAgg.units
      .map((u) => {
        const waiting = (u.psIp || 0) + (u.pipeApe || 0)
        const conv = conversionRateFor(convIndex, u.unit)
        return { unit: u.unit, waiting, psIp: u.psIp || 0, pipeApe: u.pipeApe || 0, ...conv, expected: waiting * conv.rate }
      })
      .filter((x) => x.waiting > 0)
      .sort((a, b) => b.expected - a.expected)
  }, [dailyAgg, convIndex])

  const persons = useMemo(() => {
    const raw = reportsDoc?.data
    const arr = Array.isArray(raw) ? raw : raw ? Object.values(raw) : []
    return arr.filter((p) => p && typeof p === 'object' && p.daily)
  }, [reportsDoc])

  // ── Pace tháng ──────────────────────────────────────────────
  const daily = dailyTop?.[`${DATA_YEAR}-${month}`] || null
  const actual = dailyAgg?.totals?.fyp ?? monthlyKpis[month]?.fypThang ?? daily?.totals?.fypThang ?? null
  const actualSrc = dailyAgg ? `Daily Sales tới ${fmtDM(dailyAgg.latestDate)}` : monthlyKpis[month] ? 'file Compensation tháng' : daily ? 'Daily Sales' : null
  const mmTargetTrieu = useMemo(() => {
    const commits = mmDoc?.commits || {}
    const sum = Object.values(commits).reduce((s, c) => s + (Number(c?.monthTarget) || 0), 0)
    return sum > 0 ? sum / 1000 : 0 // ManMark lưu nghìn đồng → triệu
  }, [mmDoc])
  const gaPlan = Number(data?.gaData?.fyp2026?.[month - 1]?.plan) || 0
  const target = mmTargetTrieu > 0 ? mmTargetTrieu : gaPlan
  const targetSrc = mmTargetTrieu > 0 ? 'cam kết ManMark' : gaPlan > 0 ? 'kế hoạch GA' : null
  const pace = monthPace({ actual: actual ?? 0, target, year: DATA_YEAR, month, today: now })
  const vUi = VERDICT_UI[pace.verdict]
  const pctOfTarget = (v) => (v && target > 0) ? ` ≈ ${((v / target) * 100).toFixed(0)}% mục tiêu` : ''

  // ── Cảnh báo ────────────────────────────────────────────────
  const isCur = pace.phase === 'current'
  const openCases = useMemo(
    () => collectOpenCases(
      persons, DATA_YEAR, month, null,
      isCur ? Date.now() : new Date(DATA_YEAR, month, 0, 23, 59, 59).getTime()
    ),
    [persons, month, isCur]
  )
  const staleCases = isCur ? openCases.filter((c) => c.ageDays >= 5) : openCases
  const mocThieu = useMemo(
    () => umList.map((u) => ({ um: u, info: mocActInfo(u) }))
      .filter((x) => x.info.need !== null && x.info.need > 0)
      .sort((a, b) => b.info.need - a.info.need),
    [umList]
  )
  const nearPE = useMemo(() => nearPEList(agList, 2, 8), [agList])
  const zeroFyc = useMemo(() => zeroFycAgents(agList, 6), [agList])

  // ── Phễu + Vinh danh ────────────────────────────────────────
  const funnel = useMemo(() => funnelStats(persons), [persons])
  const topFycQuy = useMemo(() => topBy(agList, 'fyc', 5), [agList])
  const topFycL12m = useMemo(() => topBy(agList, 'fyc12m', 5), [agList])
  const funnelRows = [
    { label: 'CF — Có phí / chưa phí', n: funnel.cf.n, fee: funnel.cf.fee, color: '#f72585' },
    { label: 'CP — Pending (đã đóng phí)', n: funnel.cp.n, fee: funnel.cp.fee, color: '#fb8500' },
    { label: 'PH — Phát hành', n: funnel.ph.n, fee: funnel.ph.fee, color: '#06d6a0' },
  ]
  const funnelMax = Math.max(1, ...funnelRows.map((r) => r.n))

  // ── Bảng Unit: Daily + AG-PE + mục tiêu ManMark ────────────
  const [unitSearch, setUnitSearch] = useState('')
  const [showEmptyUnits, setShowEmptyUnits] = useState(() => {
    try { return localStorage.getItem('d07-insights-show-empty-units') === '1' } catch { return false }
  })
  const toggleShowEmptyUnits = (v) => {
    setShowEmptyUnits(v)
    try { localStorage.setItem('d07-insights-show-empty-units', v ? '1' : '0') } catch { /* bỏ qua */ }
  }
  const [unitSort, setUnitSort] = useState({ key: 'fyp', dir: 'desc' })
  const [unitVisible, setUnitVisible, showU] = useVisibleColumns('d07-insights-unit-cols', UNIT_COLS)
  const unitTargets = useMemo(() => {
    const map = new Map()
    const codeToUnit = new Map(agList.map((a) => [String(a.msddl || ''), a.unit || '']))
    Object.entries(mmDoc?.commits || {}).forEach(([code, c]) => {
      const unit = String(c?.unit || codeToUnit.get(String(code)) || '').trim() || '—'
      map.set(unit, (map.get(unit) || 0) + (Number(c?.monthTarget) || 0) / 1000)
    })
    return map
  }, [mmDoc, agList])
  const unitRowsAll = useMemo(() => {
    const peMap = new Map(unitStats(agList).map((u) => [u.unit, u]))
    const dailyMap = new Map((dailyAgg?.units || []).map((u) => [u.unit, u]))
    const keys = new Set([...peMap.keys(), ...dailyMap.keys(), ...unitTargets.keys()])
    const rows = [...keys].map((unit) => {
      const d = dailyMap.get(unit) || {}
      const pe = peMap.get(unit) || {}
      const tgt = unitTargets.get(unit) || 0
      const fyp = d.fyp || 0
      return {
        unit,
        leaderName: d.leaderName || '',
        tvvPe: pe.tvv || 0,
        tvvCoSo: d.tvvCoSo || 0,
        fyp, fyc: d.fyc || 0,
        ipNet: d.ipNet || 0, caseNet: d.caseNet || 0,
        cIF: d.cIF || 0, cPS: d.cPS || 0, cOther: d.cOther || 0,
        pctIF: d.pctIF ?? null, trendPct: d.trendPct ?? null, delta7: d.delta7 || 0,
        target: tgt, pctTarget: tgt > 0 ? (fyp / tgt) * 100 : null,
        fycQuy: pe.fycQuy || 0, fycL12m: pe.fycL12m || 0,
        peDat: pe.peDat || 0, peKC: pe.peKC || 0, peBK: pe.peBK || 0, peV: pe.peV || 0,
      }
    })
    const q = unitSearch.trim().toLowerCase()
    const filtered = q
      ? rows.filter((r) => r.unit.toLowerCase().includes(q) || r.leaderName.toLowerCase().includes(q))
      : rows
    const getter = UNIT_SORTERS[unitSort.key] || ((r) => r.fyp)
    return [...filtered].sort((a, b) => {
      const diff = getter(a) - getter(b)
      return unitSort.dir === 'desc' ? -diff : diff
    })
  }, [agList, dailyAgg, unitTargets, unitSearch, unitSort])
  // Mặc định ẩn Unit chưa có số liệu (mọi chỉ số đều 0) cho bảng đỡ rối; bật toggle để xem tất cả
  const unitRows = useMemo(
    () => (showEmptyUnits ? unitRowsAll : unitRowsAll.filter(unitRowHasData)),
    [unitRowsAll, showEmptyUnits]
  )
  const emptyUnitsHidden = unitRowsAll.length - unitRows.length
  const onUnitSort = (key) => setUnitSort((s) => s.key === key
    ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
    : { key, dir: 'desc' })
  const unitColSpan = 1 + unitVisible.length
  const incMax = Math.max(1, ...(dailyAgg?.increments || []).map((x) => x.fyp))

  const alertTile = (emoji, count, label, sub, color, tab) => (
    <div
      onClick={() => onNavigate && onNavigate(tab)}
      style={{
        background: 'white', border: '1px solid #e8ecf4', borderLeft: `4px solid ${color}`,
        borderRadius: 12, padding: '12px 14px', cursor: onNavigate ? 'pointer' : 'default',
        boxShadow: '0 1px 6px rgba(67,97,238,0.05)',
      }}
      title={onNavigate ? 'Bấm để mở tab liên quan' : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 20 }}>{emoji}</span>
        <span style={{ fontSize: 26, fontWeight: 800, color }}>{count}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#1a1f36' }}>{label}</span>
      </div>
      <div style={{ fontSize: 11, color: '#8896aa', marginTop: 4, lineHeight: 1.5 }}>{sub}</div>
    </div>
  )

  return (
    <div className="page-content">
      <div className="page-head">
        <div className="page-title">🎯 Trung Tâm Điều Hành — GA D07</div>
        <div className="page-sub">
          Cập nhật theo Daily Sales &amp; Proposal nạp hằng ngày ở tab TVV Hàng Ngày, kết hợp Compensation, Sales Report, ManMark &amp; AG-PE.
          Bấm vào thẻ cảnh báo để mở tab liên quan.
        </div>
      </div>

      {/* Chọn tháng */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#4a5568' }}>📅 Tháng:</span>
        {monthOptions.map((m) => (
          <button key={m} onClick={() => setMonth(m)}
            style={{
              padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 700,
              background: month === m ? 'linear-gradient(135deg,#4361ee,#7209b7)' : '#f0f4ff',
              color: month === m ? 'white' : '#4361ee',
            }}>
            {VN_MONTHS[m]}/{DATA_YEAR}{m === curMonth ? ' ●' : ''}
          </button>
        ))}
        {dailyAgg && <span style={{ fontSize: 11.5, color: '#065f46', background: '#e6faf2', padding: '4px 10px', borderRadius: 12, fontWeight: 600 }}>
          📡 Daily Sales: {dailyAgg.docCount} ngày đã nạp · mới nhất {fmtDM(dailyAgg.latestDate)}
        </span>}
      </div>

      {/* ── 1. Nhịp độ tháng + Dự toán ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-header">
          <div className="section-icon">⏱️</div>
          NHỊP ĐỘ THÁNG {month}/{DATA_YEAR}
          <span style={{ marginLeft: 'auto', background: vUi.bg, color: vUi.color, padding: '4px 12px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
            {vUi.label}
          </span>
        </div>
        {actual === null && target <= 0 ? (
          <div className="empty-state">Chưa có số liệu FYP và mục tiêu cho tháng này.</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 12.5, color: '#4a5568' }}>
                FYP đã đạt: <strong style={{ color: '#1a1f36', fontSize: 14 }}>{formatNum(pace.actual)}</strong>
                {target > 0 && <> / {formatNum(target)} triệu ({targetSrc})</>}
                {actualSrc && <span style={{ color: '#8896aa', fontSize: 11 }}> · nguồn: {actualSrc}</span>}
              </span>
              <span style={{ fontSize: 12, color: '#8896aa' }}>
                {pace.phase === 'current' && <>Hôm nay ngày {pace.dayIdx}/{pace.daysInMonth} — đã qua <strong>{pace.elapsedPct.toFixed(0)}%</strong> tháng</>}
                {pace.phase === 'past' && <>Tháng đã kết thúc</>}
                {pace.phase === 'future' && <>Tháng chưa bắt đầu</>}
                {pace.donePct !== null && <> · Đạt <strong style={{ color: '#1a1f36' }}>{pace.donePct.toFixed(1)}%</strong> mục tiêu</>}
              </span>
            </div>
            <div style={{ position: 'relative', height: 22, background: '#f0f4ff', borderRadius: 11, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${Math.min(pace.donePct ?? 0, 100)}%`,
                background: 'linear-gradient(90deg,#4361ee,#7209b7)', borderRadius: 11, transition: 'width .5s ease',
              }} />
              <div title={`Nhịp thời gian: ${pace.elapsedPct.toFixed(0)}%`}
                style={{ position: 'absolute', left: `${Math.min(pace.elapsedPct, 100)}%`, top: 0, bottom: 0, width: 2, background: '#1a1f36', opacity: 0.55 }} />
            </div>
            <div style={{ fontSize: 10.5, color: '#8896aa', marginTop: 4 }}>Vạch đen = nhịp thời gian đã trôi qua. Thanh màu dài hơn vạch = đang nhanh hơn nhịp.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 12 }}>
              <div className="info-block"><div className="info-block-label">Còn thiếu</div><div className="info-block-value" style={{ color: '#ef476f' }}>{target > 0 ? `${formatNum(pace.remaining)} tr` : '—'}</div></div>
              <div className="info-block"><div className="info-block-label">Ngày còn lại</div><div className="info-block-value">{pace.phase === 'current' ? pace.daysLeft : '—'}</div></div>
              <div className="info-block"><div className="info-block-label">Cần đạt / ngày còn lại</div><div className="info-block-value" style={{ color: '#fb8500' }}>{pace.perDayNeeded ? `${formatNum2(pace.perDayNeeded)} tr` : '—'}</div></div>
              <div className="info-block"><div className="info-block-label">FYC lũy kế (Daily)</div><div className="info-block-value" style={{ color: '#7209b7' }}>{dailyAgg ? `${formatNum(dailyAgg.totals.fyc)} tr` : '—'}</div><div className="info-block-sub">{dailyAgg ? `IP Net ${formatNum(dailyAgg.totals.ipNet)} tr · ${formatNum(dailyAgg.totals.caseNet)} case` : 'chưa có Daily tháng này'}</div></div>
            </div>

            {/* Dự toán cuối tháng */}
            <div className="section-divider">🔮 DỰ TOÁN CUỐI THÁNG {month} — ƯỚC TÍNH THEO DỮ LIỆU DAILY</div>
            {!dailyFc ? (
              <div className="empty-state">{dailyLoading ? 'Đang tải Daily Sales…' : 'Chưa có Daily Sales trong tháng này nên chưa dự toán được. Nạp file ở tab TVV Hàng Ngày để kích hoạt.'}</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
                  <div className="info-block">
                    <div className="info-block-label">Theo nhịp từ đầu tháng</div>
                    <div className="info-block-value" style={{ color: '#4361ee' }}>{formatNum(dailyFc.theoNhip)} tr</div>
                    <div className="info-block-sub">Lũy kế ÷ {dailyFc.latestDay} ngày × {dailyFc.daysInMonth}{pctOfTarget(dailyFc.theoNhip)}</div>
                  </div>
                  <div className="info-block">
                    <div className="info-block-label">Theo tốc độ 7 ngày gần nhất</div>
                    <div className="info-block-value" style={{ color: '#7209b7' }}>{formatNum(dailyFc.theoMA7)} tr</div>
                    <div className="info-block-sub">Đang chạy {formatNum2(dailyFc.avg7)} tr/ngày × {dailyFc.daysLeft} ngày còn lại{pctOfTarget(dailyFc.theoMA7)}</div>
                  </div>
                  <div className="info-block">
                    <div className="info-block-label">Kỳ vọng phát hành thêm (PS + Pipeline)</div>
                    <div className="info-block-value" style={{ color: '#065f46' }}>+{formatNum(dailyFc.kyVongPhatHanhThem)} tr</div>
                    <div className="info-block-sub">Đang chờ {formatNum(dailyFc.choPhatHanh)} tr IP/APE × tỷ lệ chuyển đổi tháng này {dailyFc.convValue.toFixed(0)}%</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#8896aa', marginTop: 8 }}>
                  Hồ sơ đang chờ: PS {dailyAgg.proposals.psN} hồ sơ ({formatNum(dailyAgg.proposals.psIp)} tr IP) · Pipeline {dailyAgg.pipeline.n} hồ sơ ({formatNum(dailyAgg.pipeline.ape)} tr APE) ·
                  Tỷ lệ phát hành theo giá trị tháng này: {dailyAgg.proposals.convValue.toFixed(0)}% · theo số hồ sơ: {dailyAgg.proposals.convCount.toFixed(0)}%.
                  Các con số dự toán chỉ là ước tính theo nhịp hiện tại để điều hành, không phải cam kết.
                </div>
                {target > 0 && (() => {
                  const sc = finishScenarios({
                    cum: dailyFc.cum, avg7: dailyFc.avg7, daysLeft: dailyFc.daysLeft,
                    target, latestDateISO: dailyAgg.latestDate, year: DATA_YEAR, month,
                  })
                  return (
                    <div style={{ marginTop: 10, background: '#f8f9ff', border: '1px solid #e8ecf4', borderRadius: 10, padding: '10px 12px' }}>
                      <div style={{ fontSize: 12.5, color: '#1a1f36' }}>
                        🎯 <strong>Về đích:</strong> còn thiếu <strong style={{ color: '#ef476f' }}>{formatNum(sc.remaining)} tr</strong>
                        {sc.perDayNeeded !== null && <> — cần <strong>{formatNum2(sc.perDayNeeded)} tr/ngày</strong></>}
                        {sc.upliftPct !== null && sc.remaining > 0 && (
                          sc.upliftPct <= 0
                            ? <span style={{ color: '#065f46', fontWeight: 700 }}> (nhịp 7 ngày hiện tại đã đủ, đang thừa nhịp {Math.abs(sc.upliftPct).toFixed(0)}%)</span>
                            : <span style={{ color: '#b91c1c', fontWeight: 700 }}> (cần tăng tốc +{sc.upliftPct.toFixed(0)}% so với nhịp 7 ngày)</span>
                        )}
                        {sc.remaining <= 0 && <span style={{ color: '#065f46', fontWeight: 700 }}> — đã đạt mục tiêu! 🎉</span>}
                        {sc.remaining > 0 && (sc.finishDate
                          ? <> · Giữ nhịp 7 ngày sẽ chạm mục tiêu khoảng <strong>{sc.finishDate}</strong></>
                          : <> · Giữ nhịp 7 ngày thì <strong>không kịp trong tháng</strong> (cuối tháng đạt ~{formatNum(sc.scenarios[0].value)} tr)</>)}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        {sc.scenarios.map((s) => (
                          <span key={s.label} style={{
                            padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700,
                            background: s.pct >= 100 ? '#e6faf2' : s.pct >= 80 ? '#fff7e0' : '#fff0f0',
                            color: s.pct >= 100 ? '#065f46' : s.pct >= 80 ? '#92400e' : '#b91c1c',
                          }}>
                            {s.label}: {formatNum(s.value)} tr ({s.pct !== null ? `${s.pct.toFixed(0)}%` : '—'})
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </>
            )}
          </>
        )}
      </div>

      {/* ── 2. Cảnh báo cần xử lý ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12, marginBottom: 16 }}>
        {alertTile('🧾', staleCases.length,
          isCur ? 'hồ sơ tồn ≥ 5 ngày' : 'hồ sơ chưa phát hành cuối tháng',
          staleCases.length
            ? staleCases.slice(0, 3).map((c) => `${c.person?.name || c.person?.msdl || ''} · HS ngày ${c.d} · ${isCur ? `${c.ageDays} ngày` : ''}`).join('  |  ') + (staleCases.length > 3 ? `  |  +${staleCases.length - 3} nữa` : '')
            : 'Không có hồ sơ tồn. Tốt!',
          '#ef476f', 'sales')}
        {alertTile('👤', mocThieu.length, 'UM còn thiếu lượt Act MOC',
          mocThieu.length
            ? mocThieu.slice(0, 3).map((x) => `${x.um.leaderName} (thiếu ${formatNum(x.info.need)})`).join('  |  ') + (mocThieu.length > 3 ? `  |  +${mocThieu.length - 3} nữa` : '')
            : 'Tất cả UM đã đủ lượt Act MOC.',
          '#fb8500', 'um')}
        {alertTile('⭐', nearPE.length, 'TVV sắp đạt PE (thiếu ≤ 2tr FYC)',
          nearPE.length
            ? nearPE.slice(0, 3).map((x) => `${x.name} (thiếu ${formatNum2(x.gap)}tr)`).join('  |  ') + (nearPE.length > 3 ? `  |  +${nearPE.length - 3} nữa` : '')
            : 'Không có TVV nào ở ngưỡng sắp đạt.',
          '#e6a800', 'tvv')}
        {alertTile('📉', (dailyAgg?.units || []).filter((u) => u.trendPct !== null && u.trendPct <= -30).length, 'Unit tụt nhịp ≥ 30%',
          (() => {
            const falling = (dailyAgg?.units || []).filter((u) => u.trendPct !== null && u.trendPct <= -30)
            return falling.length
              ? falling.slice(0, 3).map((u) => `${u.unit} (${u.trendPct.toFixed(0)}%)`).join('  |  ') + (falling.length > 3 ? `  |  +${falling.length - 3} nữa` : '') + ' — FYP tăng thêm 7 ngày gần nhất giảm mạnh so với 7 ngày trước'
              : 'Không có Unit nào tụt nhịp mạnh trong 7 ngày qua.'
          })(),
          '#b91c1c', 'tvvdaily')}
        {alertTile('💤', zeroFyc.count, 'TVV chưa có FYC trong quý',
          zeroFyc.count
            ? zeroFyc.names.filter(Boolean).join(', ') + (zeroFyc.count > zeroFyc.names.length ? ` … +${zeroFyc.count - zeroFyc.names.length} nữa` : '')
            : 'Mọi TVV đều đã phát sinh FYC.',
          '#7209b7', 'tvv')}
      </div>

      {/* ── 2b. 🏁 Dự báo thi đua T11 (Memo 00211) & Quý 4 (Memo 00210) ── */}
      <div className="card" style={{ marginBottom: 16, border: '2px solid #ffd16655' }}>
        <div className="section-header">
          <div className="section-icon">🏁</div>
          DỰ BÁO THI ĐUA THÁNG 11 &amp; QUÝ 4 — THEO IP PHÁT HÀNH
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#8896aa', fontWeight: 500 }}>
            Memo 00211 (T11) · Memo 00210 (Q4)
          </span>
        </div>
        {!race ? <div className="empty-state">Đang tải Daily T10–T12…</div> : !race.hasNov && !race.hasOct ? (
          <div className="empty-state">Chưa có Daily Sales tháng 10/11 đã lưu nên chưa tính được thi đua. Lan nạp Daily ở tab TVV Hàng Ngày rồi quay lại đây nhé.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ background: '#fff7e0', color: '#92400e', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                T11: {race.novReached} TVV đã chạm mốc thưởng · tổng thưởng dự kiến {formatNum(race.novTotalBonus)} tr
              </span>
              <span style={{ background: '#eef2ff', color: '#4361ee', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                Q4: {race.q4Gifted} TVV đang ở mốc có quà iPhone
              </span>
              {race.daysLeftNov !== null && (
                <span style={{ background: '#f1f3f9', color: '#5b6478', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                  T11 còn {race.daysLeftNov} ngày (từ snapshot {race.novLatestDate ? fmtDMY(race.novLatestDate) : '—'})
                </span>
              )}
              {!race.hasOct && (
                <span style={{ background: '#fff0f0', color: '#b91c1c', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                  Chưa có Daily tháng 10 đã lưu — phần Quý 4 tạm tính riêng từ tháng 11
                </span>
              )}
            </div>

            <div style={{ fontSize: 12, fontWeight: 800, color: '#1a1f36', margin: '4px 0 6px' }}>Tháng 11 — Memo 00211 (IP phát hành, chưa nhân hệ số)</div>
            {race.novRows.length === 0 ? <div className="empty-state">Chưa có TVV nào có IP phát hành trong tháng 11.</div> : (
              <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto', marginBottom: 14 }}>
                <table className="data-table">
                  <thead><tr><th>TVV</th><th>Unit</th><th>IP phát hành T11</th><th>Bậc hiện tại</th><th>Thưởng dự kiến</th><th>Còn thiếu tới mốc kế</th><th>Cần / ngày</th></tr></thead>
                  <tbody>
                    {race.novRows.map((r) => (
                      <tr key={r.msdl}>
                        <td><strong>{r.name || r.msdl}</strong><div style={{ fontSize: 10, color: '#8896aa' }}>{r.msdl}</div></td>
                        <td>{r.unit || '—'}</td>
                        <td style={{ fontWeight: 700 }}>{formatNum(r.ip)} tr</td>
                        <td style={{ fontSize: 11.5 }}>{r.tierLabel}</td>
                        <td style={{ fontWeight: 800, color: r.bonus > 0 ? '#065f46' : '#8896aa' }}>{r.bonus > 0 ? `${formatNum2(r.bonus)} tr` : '—'}</td>
                        <td>{r.nextMin !== null ? <>{formatNum2(r.gap)} tr <span style={{ fontSize: 10.5, color: '#8896aa' }}>({r.nextLabel})</span></> : 'Đã ở bậc cao nhất'}</td>
                        <td>{r.nextMin !== null && race.daysLeftNov > 0 ? `${formatNum2(r.gap / race.daysLeftNov)} tr` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 800, color: '#1a1f36', margin: '4px 0 6px' }}>Quý 4 — Memo 00210 (IP tính thưởng đã nhân hệ số: T10 ×2 · T11 ×1,5, TA9 ×2 · T12 TA9 ×2)</div>
            {race.q4Rows.length === 0 ? <div className="empty-state">Chưa có dữ liệu IP phát hành trong Quý 4.</div> : (
              <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead><tr><th>TVV</th><th>Unit</th><th>IP T10 (×2)</th><th>IP T11 (trong đó TA9)</th><th>IP tính thưởng Q4</th><th>Quà dự kiến</th><th>Còn thiếu tới mốc kế</th><th>Cần / ngày tới 31/12</th></tr></thead>
                  <tbody>
                    {race.q4Rows.map((r) => (
                      <tr key={r.msdl}>
                        <td><strong>{r.name || r.msdl}</strong><div style={{ fontSize: 10, color: '#8896aa' }}>{r.msdl}</div></td>
                        <td>{r.unit || '—'}</td>
                        <td>{formatNum(r.octIp)} tr</td>
                        <td>{formatNum(r.novIp)} tr <span style={{ fontSize: 10.5, color: '#8896aa' }}>(TA9 {formatNum(r.novIpTA9)})</span></td>
                        <td style={{ fontWeight: 800, color: '#7209b7' }}>{formatNum(r.bonusIp)} tr</td>
                        <td style={{ fontWeight: 700, color: r.gift ? '#065f46' : '#8896aa' }}>{r.gift || 'Chưa đạt 600tr'}</td>
                        <td>{r.nextMin !== null ? `${formatNum2(r.gap)} tr (mốc ${r.nextMin}tr)` : 'Đã ở mốc cao nhất'}</td>
                        <td>{r.nextMin !== null && race.daysLeftQ4 > 0 ? `${formatNum2(r.gap / race.daysLeftQ4)} tr` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 11, color: '#8896aa' }}>
              Căn cứ: IP phát hành = hồ sơ trạng thái IF trong Proposal của snapshot Daily mới nhất từng tháng. Chưa tính: thưởng +1tr tuần 01–07/11 (theo yêu cầu bỏ qua),
              hệ số ×2 thưởng chính khi IP bán cùng ≥40% (Daily chưa có dữ liệu tỷ lệ bán cùng). Hồ sơ Pru-Đầu Tư Vững Tiến dưới 20tr IP không tính vào Quý 4 theo memo.
              Quà Quý 4 là hiện vật theo memo, không quy đổi tiền. Đây là dự báo để điều hành, không phải kết quả chốt chính thức.
            </div>
          </>
        )}
      </div>

      {/* ── 3. Sức khỏe Unit (Daily + AG-PE + ManMark) ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-header">
          <div className="section-icon">🏢</div>
          SỨC KHỎE THEO UNIT — THÁNG {month}/{DATA_YEAR}
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#8896aa', fontWeight: 500 }}>
            {dailyAgg ? `Daily tới ${fmtDM(dailyAgg.latestDate)} · AG-PE mới nhất · Mục tiêu ManMark` : 'Chưa có Daily tháng này — chỉ hiện AG-PE'}
          </span>
        </div>

        {dailyAgg && dailyAgg.increments.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 6 }}>FYP TĂNG THÊM THEO NGÀY NẠP DAILY (triệu)</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 74 }}>
              {dailyAgg.increments.map((x, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 0 }} title={`Ngày ${fmtDM(x.date)}: +${formatNum(x.fyp)} tr FYP`}>
                  <div style={{ fontSize: 9, color: '#4a5568', fontWeight: 600 }}>{formatNum(x.fyp)}</div>
                  <div style={{ width: '100%', maxWidth: 34, height: Math.max(3, (x.fyp / incMax) * 44), background: 'linear-gradient(180deg,#4361ee,#7209b7)', borderRadius: '4px 4px 0 0' }} />
                  <div style={{ fontSize: 9, color: '#8896aa' }}>{fmtDM(x.date)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="search-input"
            style={{ flex: 1, minWidth: 180 }}
            value={unitSearch}
            onChange={(e) => setUnitSearch(e.target.value)}
            placeholder="🔍 Lọc theo Unit hoặc tên Leader..."
          />
          <ColumnToggle columns={UNIT_COLS} visible={unitVisible} onChange={setUnitVisible} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#5b6478', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={showEmptyUnits} onChange={(e) => toggleShowEmptyUnits(e.target.checked)} />
            Hiện Unit chưa có số liệu
            {emptyUnitsHidden > 0 && <span style={{ color: '#b91c1c', fontWeight: 700 }}>(đang ẩn {emptyUnitsHidden})</span>}
          </label>
          <div style={{ fontSize: 12, color: '#8896aa' }}>{unitRows.length} Unit</div>
        </div>

        {unitRows.length === 0 ? (
          <div className="empty-state">
            {unitRowsAll.length > 0
              ? 'Tất cả Unit khớp bộ lọc đều chưa có số liệu — bật “Hiện Unit chưa có số liệu” ở trên để xem.'
              : 'Không có dữ liệu Unit cho tháng này.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Unit</th>
                  {showU('leader') && <th>Leader</th>}
                  {showU('tvvPe') && <th>TVV (AG-PE)</th>}
                  {showU('active') && <SortTh label="TVV có số" sortKey="active" sort={unitSort} onSort={onUnitSort} />}
                  {showU('fyp') && <SortTh label="FYP tháng" sortKey="fyp" sort={unitSort} onSort={onUnitSort} />}
                  {showU('fyc') && <SortTh label="FYC tháng" sortKey="fyc" sort={unitSort} onSort={onUnitSort} />}
                  {showU('ipNet') && <SortTh label="IP Net" sortKey="ipNet" sort={unitSort} onSort={onUnitSort} />}
                  {showU('caseNet') && <SortTh label="Case Net" sortKey="caseNet" sort={unitSort} onSort={onUnitSort} />}
                  {showU('hs') && <th>Hồ sơ IF/PS/Khác</th>}
                  {showU('pctIF') && <SortTh label="% Phát hành" sortKey="pctIF" sort={unitSort} onSort={onUnitSort} />}
                  {showU('trend') && <SortTh label="Xu hướng 7 ngày" sortKey="trend" sort={unitSort} onSort={onUnitSort} />}
                  {showU('target') && <th>Mục tiêu ManMark</th>}
                  {showU('pctTarget') && <SortTh label="% Mục tiêu" sortKey="pctTarget" sort={unitSort} onSort={onUnitSort} />}
                  {showU('fycQuy') && <SortTh label="FYC Quý" sortKey="fycQuy" sort={unitSort} onSort={onUnitSort} />}
                  {showU('peDat') && <th>Đạt PE</th>}
                </tr>
              </thead>
              <tbody>
                {unitRows.map((r) => (
                  <tr key={r.unit}>
                    <td><span style={{ background: '#eef2ff', color: '#4361ee', padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 }}>{r.unit}</span></td>
                    {showU('leader') && <td style={{ fontSize: 11.5 }}>{r.leaderName || '—'}</td>}
                    {showU('tvvPe') && <td>{r.tvvPe || '—'}</td>}
                    {showU('active') && <td>{r.tvvCoSo || '—'}</td>}
                    {showU('fyp') && <td className="val-fyp">{formatNum(r.fyp)}</td>}
                    {showU('fyc') && <td className="val-fyc">{formatNum(r.fyc)}</td>}
                    {showU('ipNet') && <td>{formatNum(r.ipNet)}</td>}
                    {showU('caseNet') && <td>{formatNum(r.caseNet)}</td>}
                    {showU('hs') && <td style={{ fontSize: 11.5 }}>{r.cIF} / {r.cPS} / {r.cOther}</td>}
                    {showU('pctIF') && <td style={{ fontWeight: 700, color: r.pctIF === null ? '#8896aa' : r.pctIF >= 50 ? '#065f46' : '#b45309' }}>{r.pctIF === null ? '—' : `${r.pctIF.toFixed(0)}%`}</td>}
                    {showU('trend') && <td style={{ fontWeight: 700, color: r.trendPct === null ? '#8896aa' : r.trendPct >= 0 ? '#065f46' : '#b91c1c' }}>
                      {r.trendPct === null ? '—' : <>{r.trendPct >= 0 ? '▲' : '▼'} {Math.abs(r.trendPct).toFixed(0)}% <span style={{ color: '#8896aa', fontWeight: 500, fontSize: 10.5 }}>(+{formatNum(r.delta7)}tr/7n)</span></>}
                    </td>}
                    {showU('target') && <td>{r.target > 0 ? formatNum(r.target) : '—'}</td>}
                    {showU('pctTarget') && <td style={{ fontWeight: 700, color: r.pctTarget === null ? '#8896aa' : r.pctTarget >= 100 ? '#065f46' : r.pctTarget >= 50 ? '#b45309' : '#b91c1c' }}>{r.pctTarget === null ? '—' : `${r.pctTarget.toFixed(0)}%`}</td>}
                    {showU('fycQuy') && <td className="val-fyc">{formatNum(r.fycQuy)}</td>}
                    {showU('peDat') && <td style={{ fontSize: 11.5 }}>{r.peDat} <span style={{ color: '#8896aa' }}>(💎{r.peKC} · 🥇{r.peBK} · 🥉{r.peV})</span></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: '#8896aa' }}>
          Xu hướng 7 ngày = FYP tăng thêm 7 ngày gần nhất so với 7 ngày trước đó (theo các ngày đã nạp Daily). % Mục tiêu = FYP Daily lũy kế ÷ mục tiêu ManMark của Unit.
        </div>
      </div>

      {/* ── 3b. Kỳ vọng phát hành theo Unit (tỷ lệ chuyển đổi lịch sử kiểu ManMark) ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-header">
          <div className="section-icon">🔁</div>
          KỲ VỌNG PHÁT HÀNH THEO UNIT — THÁNG {month}
          <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#8896aa', fontWeight: 500 }}>
            Tỷ lệ chuyển đổi tính từ Sales Report các tháng đã qua trong năm
          </span>
        </div>
        {!dailyAgg ? <div className="empty-state">{dailyLoading ? 'Đang tải Daily Sales…' : 'Chưa có Daily Sales tháng này.'}</div>
          : unitExpect.length === 0 ? <div className="empty-state">Không có Unit nào đang có hồ sơ chờ (PS/Pipeline).</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>Unit</th><th>PS đang chờ (IP)</th><th>Pipeline (APE)</th><th>Tổng chờ</th><th>Tỷ lệ chuyển đổi</th><th>Nguồn tỷ lệ</th><th>Kỳ vọng phát hành thêm</th></tr></thead>
              <tbody>
                {unitExpect.map((x) => (
                  <tr key={x.unit}>
                    <td><span style={{ background: '#eef2ff', color: '#4361ee', padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 }}>{x.unit}</span></td>
                    <td>{formatNum(x.psIp)} tr</td>
                    <td>{formatNum(x.pipeApe)} tr</td>
                    <td style={{ fontWeight: 700 }}>{formatNum(x.waiting)} tr</td>
                    <td style={{ fontWeight: 700, color: '#7209b7' }}>{(x.rate * 100).toFixed(0)}%</td>
                    <td style={{ fontSize: 11, color: '#8896aa' }}>{x.source === 'unit' ? `Riêng Unit (${x.sample} HS lịch sử)` : x.source === 'ga' ? `Toàn GA (${x.sample} HS)` : 'Mặc định (chưa đủ lịch sử)'}</td>
                    <td style={{ fontWeight: 800, color: '#065f46' }}>+{formatNum(x.expected)} tr</td>
                  </tr>
                ))}
                <tr style={{ background: '#f8f9ff' }}>
                  <td style={{ fontWeight: 800 }}>TỔNG</td>
                  <td style={{ fontWeight: 700 }}>{formatNum(unitExpect.reduce((s, x) => s + x.psIp, 0))} tr</td>
                  <td style={{ fontWeight: 700 }}>{formatNum(unitExpect.reduce((s, x) => s + x.pipeApe, 0))} tr</td>
                  <td style={{ fontWeight: 800 }}>{formatNum(unitExpect.reduce((s, x) => s + x.waiting, 0))} tr</td>
                  <td></td><td></td>
                  <td style={{ fontWeight: 800, color: '#065f46' }}>+{formatNum(unitExpect.reduce((s, x) => s + x.expected, 0))} tr</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: '#8896aa' }}>
          Cách tính (giống ManMark): tỷ lệ = phí đã phát hành ÷ tổng phí trong Sales Report các tháng trước của năm {DATA_YEAR};
          Unit có ≥ 15 hồ sơ lịch sử thì dùng tỷ lệ riêng, ít hơn thì dùng tỷ lệ toàn GA, chưa có lịch sử thì mặc định 50%.
        </div>
      </div>

      {/* ── 4. Phễu hồ sơ ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-header"><div className="section-icon">🔻</div>PHỄU HỒ SƠ THÁNG {month} <span style={{ fontSize: 10.5, color: '#8896aa', fontWeight: 500 }}>(Sales Report)</span></div>
        {reportsLoading ? <div className="empty-state">Đang tải Sales Report…</div>
          : funnel.total === 0 ? <div className="empty-state">Chưa có hồ sơ nào trong Sales Report tháng này.</div> : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 14 }}>
              {funnelRows.map((r) => (
                <div key={r.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: '#1a1f36' }}>{r.label}</span>
                    <span style={{ color: '#4a5568' }}><strong>{r.n}</strong> HS · {tr(r.fee)} tr</span>
                  </div>
                  <div style={{ height: 14, background: '#f0f4ff', borderRadius: 7, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(r.n / funnelMax) * 100}%`, background: r.color, borderRadius: 7, transition: 'width .4s ease' }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <span style={{ background: '#e6faf2', color: '#065f46', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                Tỷ lệ phát hành: {funnel.convIssued.toFixed(0)}% số hồ sơ
              </span>
              <span style={{ background: '#eef2ff', color: '#4361ee', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                {funnel.feeIssuedShare.toFixed(0)}% phí đã phát hành
              </span>
              <span style={{ background: '#f1f3f9', color: '#5b6478', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 700 }}>
                Tổng: {funnel.total} HS · {tr(funnel.totalFee)} tr
              </span>
            </div>
            {openCases.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#8896aa', marginBottom: 6 }}>
                  TUỔI HỒ SƠ ĐANG CHỜ ({openCases.length} HS · {isCur ? 'tính tới hôm nay' : 'tính tới cuối tháng'}) — tồn càng lâu càng khó phát hành
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>
                  {ageBuckets(openCases).map((b, i) => (
                    <div key={b.key} style={{
                      background: i === 3 ? '#fff0f0' : i === 2 ? '#fff7e0' : '#f8f9ff',
                      border: '1px solid #e8ecf4', borderRadius: 10, padding: '8px 10px', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 10.5, color: '#8896aa', fontWeight: 700 }}>{b.label}</div>
                      <div style={{ fontSize: 17, fontWeight: 800, color: i === 3 ? '#b91c1c' : i === 2 ? '#92400e' : '#1a1f36' }}>{b.n} HS</div>
                      <div style={{ fontSize: 10.5, color: '#8896aa' }}>{tr(b.fee)} tr phí</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 5. Vinh danh & Cần hỗ trợ ── */}
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="section-header"><div className="section-icon">🏆</div>VINH DANH <span style={{ fontSize: 10.5, color: '#8896aa', fontWeight: 500 }}>(theo AG-PE)</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8896aa', marginBottom: 8 }}>TOP FYC QUÝ</div>
              {topFycQuy.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f0f4ff' }}>
                  <div className={`rank-num ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other'}`}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1f36', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.agentName}</div>
                    <div style={{ fontSize: 10.5, color: '#8896aa' }}>{a.unit || '—'}</div>
                  </div>
                  <div className="val-fyc">{formatNum(a.fyc)}</div>
                </div>
              ))}
              {topFycQuy.length === 0 && <div className="empty-state">Chưa có dữ liệu.</div>}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#8896aa', marginBottom: 8 }}>TOP FYC L12M</div>
              {topFycL12m.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid #f0f4ff' }}>
                  <div className={`rank-num ${i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-other'}`}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1f36', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.agentName}</div>
                    <div style={{ fontSize: 10.5, color: '#8896aa' }}>{a.unit || '—'}</div>
                  </div>
                  <div className="val-fyc">{formatNum(a.fyc12m)}</div>
                </div>
              ))}
              {topFycL12m.length === 0 && <div className="empty-state">Chưa có dữ liệu.</div>}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="section-header"><div className="section-icon">🎯</div>CẦN HỖ TRỢ NGAY</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8896aa', marginBottom: 6 }}>UM THIẾU LƯỢT ACT MOC NHIỀU NHẤT</div>
          {mocThieu.length === 0 ? <div className="empty-state">Không có UM nào thiếu lượt. 🎉</div> : (
            <table className="data-table" style={{ marginBottom: 14 }}>
              <tbody>
                {mocThieu.slice(0, 5).map((x, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{x.um.leaderName}</td>
                    <td style={{ color: '#8896aa', fontSize: 11 }}>{x.um.unit || ''}</td>
                    <td style={{ color: '#7209b7', fontWeight: 700 }}>đã có {x.info.have !== null ? formatNum(x.info.have) : '—'}</td>
                    <td style={{ color: '#ef476f', fontWeight: 800 }}>thiếu {formatNum(x.info.need)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8896aa', marginBottom: 6 }}>TVV CHỈ CÒN THIẾU ÍT FYC LÀ ĐẠT PE — ƯU TIÊN ĐẨY</div>
          {nearPE.length === 0 ? <div className="empty-state">Không có TVV ở ngưỡng sắp đạt.</div> : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {nearPE.map((x, i) => (
                <span key={i} style={{ background: '#fff7e0', color: '#92400e', padding: '4px 10px', borderRadius: 12, fontSize: 11.5, fontWeight: 600 }}>
                  {x.name} · {x.unit} · thiếu {formatNum2(x.gap)}tr
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: '#8896aa' }}>
        Nguồn: Daily Sales + Proposal nạp ở tab TVV Hàng Ngày (snapshot lũy kế theo ngày) · FYP/mục tiêu từ Compensation + cam kết ManMark ·
        Hồ sơ từ Sales Report tháng {month}/{DATA_YEAR} · Unit/PE/vinh danh từ AG-PE mới nhất. Dự toán là ước tính điều hành theo nhịp hiện tại.
      </div>
    </div>
  )
}
