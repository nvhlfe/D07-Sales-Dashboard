import React, { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { formatNum, formatNum2 } from '../utils/parseExcel'
import TargetProgress from './TargetProgress'
import TrendChart from './TrendChart'
import YoYComparison from './YoYComparison'

const KpiCard = ({ label, value, unit, badge, icon, colorClass = 'c1' }) => (
  <div className={`kpi-card ${colorClass}`}>
    <div className="kpi-header">
      <div className="kpi-icon" style={{ background: 'var(--primary-light)' }}>{icon}</div>
      <div className="kpi-label">{label}</div>
    </div>
    <div className="kpi-value">{value ?? '-'}</div>
    {unit && <div className="kpi-unit">{unit}</div>}
    {badge && (
      <div className={`kpi-badge ${badge.type}`}>
        {badge.type === 'up' ? '↑' : badge.type === 'down' ? '↓' : '—'} {badge.text}
      </div>
    )}
  </div>
)

const CustomTooltip = ({ active, payload }) => {
  if (active && payload?.length) {
    return (
      <div style={{ background:'white', padding:'8px 12px', borderRadius:8,
        boxShadow:'0 4px 16px rgba(0,0,0,0.1)', fontSize:12 }}>
        <strong>{payload[0]?.payload?.name}</strong>: {formatNum(payload[0]?.value)}
      </div>
    )
  }
  return null
}

const VN_MONTHS = {1:'T1',2:'T2',3:'T3',4:'T4',5:'T5',6:'T6',7:'T7',8:'T8',9:'T9',10:'T10',11:'T11',12:'T12'}

// Calculate real MoM (month-over-month) change for a given metric
function calcMoM(monthlyKpis, availableMonths, activeMonth, key) {
  if (!availableMonths || availableMonths.length < 2) return null
  const idx = availableMonths.indexOf(activeMonth)
  if (idx <= 0) return null // no previous month available
  const prevMonth = availableMonths[idx - 1]
  const curVal = monthlyKpis[activeMonth]?.[key]
  const prevVal = monthlyKpis[prevMonth]?.[key]
  if (curVal == null || prevVal == null || prevVal === 0) return null
  const pct = ((curVal - prevVal) / Math.abs(prevVal)) * 100
  return { pct, prevMonth, prevVal, curVal }
}

function momBadge(mom) {
  if (!mom) return null
  const type = mom.pct > 0.5 ? 'up' : mom.pct < -0.5 ? 'down' : 'flat'
  const text = `${Math.abs(mom.pct).toFixed(1)}% so T${mom.prevMonth}`
  return { type, text }
}

export default function DashboardTab({ data, onNavigate }) {
  const availableMonths = data?.availableMonths || []
  const monthlyKpis     = data?.monthlyKpis     || {}
  const latestMonth     = availableMonths[availableMonths.length - 1]

  const [selectedMonth, setSelectedMonth] = useState(null)

  const activeMonth = selectedMonth ?? latestMonth
  const k = (activeMonth && monthlyKpis[activeMonth]) ? monthlyKpis[activeMonth] : (data?.kpis || {})
  const top     = k.topAgents    || data?.topAgents    || []
  const offData = k.officeData   || data?.officeData   || []

  const kpis = [
    { key:'netManpower', label:'NET MANPOWER', value:formatNum(k.netManpower), unit:'đại lý tuyển mới', icon:'👥', colorClass:'c1' },
    { key:'fypThang',    label:'FYP THÁNG',    value:formatNum(k.fypThang),   unit:'triệu VND',         icon:'📋', colorClass:'c2' },
    { key:'apeNet',      label:'APE NET',      value:formatNum(k.apeNet),     unit:'triệu VND',         icon:'💰', colorClass:'c3' },
    { key:'caseNet',     label:'CASE NET',     value:formatNum(k.caseNet),    unit:'case',              icon:'✅', colorClass:'c4' },
    { key:'activeFyc',   label:'ACTIVE (FYC)', value:formatNum(k.activeFyc),  unit:'đại lý active',     icon:'⚡', colorClass:'c5' },
    { key:'activeCase',  label:'ACTIVE (CASE)',value:formatNum(k.activeCase), unit:'đại lý active',     icon:'🔥', colorClass:'c6' },
    { key:'fycYtd',      label:'FYC YTD',      value:formatNum(k.fycYtd),     unit:'lũy kế năm',        icon:'📈', colorClass:'c7' },
    { key:'fypYtd',      label:'FYP YTD',      value:formatNum(k.fypYtd),     unit:'lũy kế năm',        icon:'📊', colorClass:'c8' },
  ].map(kpi => ({ ...kpi, badge: momBadge(calcMoM(monthlyKpis, availableMonths, activeMonth, kpi.key)) }))

  return (
    <div className="page-content">

      {/* ── Month selector ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
        <div style={{ fontSize:12, fontWeight:600, color:'#4a5568' }}>📅 Chọn tháng:</div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {availableMonths.length > 0 ? availableMonths.map(m => (
            <button key={m}
              onClick={() => setSelectedMonth(m)}
              style={{
                padding:'5px 14px', borderRadius:20, border:'none', cursor:'pointer',
                fontSize:12, fontWeight:700, transition:'all .15s',
                background: activeMonth === m
                  ? 'linear-gradient(135deg,#4361ee,#7209b7)'
                  : '#f0f4ff',
                color: activeMonth === m ? 'white' : '#4361ee',
                boxShadow: activeMonth === m ? '0 3px 10px rgba(67,97,238,.3)' : 'none',
              }}>
              {VN_MONTHS[m]}/2026
              {m === latestMonth && <span style={{ marginLeft:4, fontSize:9, opacity:.8 }}>●</span>}
            </button>
          )) : (
            <span style={{ fontSize:11, color:'#8896aa' }}>Upload file Excel để xem dữ liệu</span>
          )}
        </div>
        {activeMonth && (
          <div style={{
            marginLeft:'auto', background:'#e6faf2', color:'#065f46',
            padding:'4px 12px', borderRadius:8, fontSize:11, fontWeight:600,
          }}>
            ✓ Đang xem Tháng {activeMonth}/2026
          </div>
        )}
      </div>

      {/* ── 8 KPI cards (with real MoM badges) ── */}
      <div className="kpi-grid" style={{ marginBottom:16 }}>
        {kpis.map((kpi, i) => <KpiCard key={i} {...kpi} />)}
      </div>

      {/* ── Target progress ── */}
      <TargetProgress gaData={data?.gaData} availableMonths={availableMonths} />

      {/* ── YoY comparison (2025 vs 2026) ── */}
      <YoYComparison yoy={data?.gaData} />

      {/* ── Trend chart (multi-month) ── */}
      <div style={{ marginBottom:16 }}>
        <TrendChart monthlyKpis={monthlyKpis} availableMonths={availableMonths} />
      </div>

      {/* ── Top agents (full width, Top 20) ── */}
      <div className="card" style={{ marginBottom:16 }}>
        <div className="section-header">
          <div className="section-icon">🏆</div>
          TOP 20 ĐẠI LÝ THEO FYP
          {activeMonth && <span style={{ marginLeft:'auto', fontSize:10, color:'#8896aa', fontWeight:500 }}>
            T{activeMonth}/2026
          </span>}
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Tên đại lý</th>
              <th>Mã</th>
              <th>Cấp</th>
              <th>FYP</th>
              <th>FYC</th>
              <th>FYC cần thêm</th>
              <th>IP NET</th>
            </tr>
          </thead>
          <tbody>
            {top.map((ag, i) => {
              // FYC cần thêm = 5 - FYC tháng. Nếu FYC ≥ 5, không thiếu nữa → hiện "-"
              const fycGap = ag.fyc != null ? Math.round((5 - ag.fyc) * 100) / 100 : null
              return (
                <tr key={i}>
                  <td>
                    <div className={`rank-num ${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':'rank-other'}`}>{i+1}</div>
                  </td>
                  <td style={{ color:'#4361ee', fontWeight:600, fontSize:11.5 }}>{ag.name}</td>
                  <td style={{ color:'#8896aa', fontSize:11 }}>{ag.code}</td>
                  <td><span className={`level-badge level-${ag.level}`}>{ag.level}</span></td>
                  <td className="val-fyp">{formatNum(ag.fyp)}</td>
                  <td className="val-fyc">{formatNum2(ag.fyc)}</td>
                  <td style={{ color: fycGap != null && fycGap > 0 ? '#ef4444' : '#8896aa', fontWeight: fycGap != null && fycGap > 0 ? 700 : 400 }}>
                    {fycGap != null && fycGap > 0 ? formatNum2(fycGap) : '-'}
                  </td>
                  <td style={{ color:'#fb8500', fontWeight:600 }}>{formatNum(ag.ipNet)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ marginTop:10, fontSize:11.5, color:'#8896aa' }}>
          Top 20 theo FYP · {top.length} đại lý · "FYC cần thêm" = 5 − FYC tháng (đơn vị triệu VND, ngưỡng PE Vàng)
        </div>
      </div>

      {/* ── Bottom table ── */}
      <div className="card">
        <div className="section-header">
          <div className="section-icon">📋</div>
          NET MANPOWER & FYC MỖI VĂN PHÒNG
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Văn phòng</th>
              <th>Net MP</th>
              <th>FYC (Triệu VND)</th>
              <th>APE Net (Triệu VND)</th>
              <th>Case Net</th>
            </tr>
          </thead>
          <tbody>
            {(offData.length>0
              ? offData
              : [{ vanPhong:'GA710 - Quận 7', netMp:k.netManpower, fyc:k.fycThang, apeNet:k.apeNet, caseNet:k.caseNet }]
            ).map((o, i) => (
              <tr key={i}>
                <td style={{ fontWeight:600 }}>{o.vanPhong}</td>
                <td className="val-green">{formatNum(o.netMp)}</td>
                <td className="val-fyc">{formatNum(o.fyc)}</td>
                <td className="val-ape">{formatNum(o.apeNet)}</td>
                <td className="val-green">{formatNum(o.caseNet)}</td>
              </tr>
            ))}
            <tr style={{ background:'#f8f9ff', fontWeight:700 }}>
              <td>Tổng cộng</td>
              <td className="val-green">{formatNum(k.netManpower)}</td>
              <td className="val-fyc">{formatNum(k.fycThang)}</td>
              <td className="val-ape">{formatNum(k.apeNet)}</td>
              <td className="val-green">{formatNum(k.caseNet)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
