import React, { useState } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LabelList } from 'recharts'
import { formatNum } from '../utils/parseExcel'
import YoYComparison from './YoYComparison'

const MetricCard = ({ label, value, unit, color = '#4361ee', icon }) => (
  <div className="card" style={{ textAlign: 'center', padding: '16px 10px' }}>
    <div style={{ fontSize: 20, marginBottom: 5 }}>{icon}</div>
    <div style={{ fontSize: 10.5, color: '#8896aa', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 800, color }}>{value || '—'}</div>
    {unit && <div style={{ fontSize: 10, color: '#8896aa', marginTop: 2 }}>{unit}</div>}
  </div>
)

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div style={{ background: 'white', padding: '8px 12px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color }}>{p.name}: {formatNum(p.value)}</div>
        ))}
      </div>
    )
  }
  return null
}

// Format TLDTPTT — value already in % (e.g. 83.8)
function fmtPct(val) {
  if (val === null || val === undefined) return '—'
  const n = parseFloat(val)
  if (isNaN(n)) return '—'
  return n.toFixed(1) + '%'
}

function fmtVal(val, isRatio = false) {
  if (val === null || val === undefined) return '—'
  const n = parseFloat(val)
  if (isNaN(n)) return '—'
  if (isRatio) return (n * 100).toFixed(1) + '%'
  const r = Math.round(n * 10) / 10
  return r === Math.round(r) ? r.toFixed(0) : r.toFixed(1)
}

const MONTHS_ALL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Row definitions: { key, label, isRatio, color, bgColor }
const ROWS = [
  { key: 'planFyp',  label: 'PLANNING FYP', color: '#ef4444',  bg: '#fff1f2', bold: true },
  { key: 'fyp2026',  label: 'FYP',          color: '#b91c1c',  bg: '#fff7f7', achieved: true },
  { key: 'rec',      label: 'REC',           color: '#1a1f36',  bg: '#fafafa' },
  { key: 'act2026',  label: 'ACT',           color: '#1a1f36',  bg: '#f8f9ff' },
  { key: 'actRatio', label: 'ACT RATIO',     color: '#7209b7',  bg: '#fdf4ff', isPct: true },
  { key: 'caseAct',  label: 'CASE/ACT',      color: '#0369a1',  bg: '#f0f9ff' },
  { key: 'apeAct',   label: 'APE/ACT',       color: '#0369a1',  bg: '#f0f9ff' },
  { key: 'caseSize', label: 'CASE SIZE',      color: '#0369a1',  bg: '#f0f9ff' },
  { key: 'pc',       label: 'PC',            color: '#d97706',  bg: '#fffbeb' },
  { key: 'pe',       label: 'PE',            color: '#d97706',  bg: '#fffbeb' },
  { key: 'mp2026',   label: 'MP',            color: '#065f46',  bg: '#f0fdf4' },
  { key: 'tldtptt',  label: 'TLDTPTT',       color: '#be185d',  bg: '#fdf2f8', isPct: true },
]

const TOTAL_KEYS = {
  planFyp: 'totalFypPlan', fyp2026: 'totalFypYtd', rec: 'totalRec',
  act2026: 'totalAct', actRatio: 'totalActRatio', caseAct: 'totalCaseAct',
  apeAct: 'totalApeAct', caseSize: 'totalCaseSize', pc: 'totalPc',
  pe: 'totalPe', mp2026: 'totalMp', tldtptt: 'totalTldtptt',
}

export default function GATab({ data }) {
  const ga = data?.gaData || {}
  const k  = data?.kpis   || {}
  const [activeView, setActiveView] = useState('table') // 'table' | 'charts'

  // Build months that have any data
  const monthsWithData = MONTHS_ALL.filter(m => {
    const fyp = (ga.fyp2026 || []).find(d => d.month === m)
    return fyp && (fyp.achieved !== null || fyp.plan !== null)
  })
  const displayMonths = monthsWithData.length > 0 ? monthsWithData : MONTHS_ALL.slice(0, 6)

  // Determine quarters
  const Q = { 'Q1': ['Jan','Feb','Mar'], 'Q2': ['Apr','May','Jun'], 'Q3': ['Jul','Aug','Sep'], 'Q4': ['Oct','Nov','Dec'] }
  const activeQuarters = Object.entries(Q)
    .filter(([, ms]) => ms.some(m => displayMonths.includes(m)))
    .map(([q]) => q)

  // Get value for a row+month
  function getVal(rowKey, month) {
    const arr = ga[rowKey]
    if (!arr) return null
    const entry = arr.find(d => d.month === month)
    if (!entry) return null
    // fyp2026 has {achieved, plan} — use achieved for ACHIEVED row
    if (rowKey === 'fyp2026') return entry.achieved ?? entry.value ?? null
    return entry.value ?? null
  }

  function formatCell(rowKey, val) {
    if (val === null || val === undefined) return <span style={{ color: '#ccc' }}>—</span>
    const row = ROWS.find(r => r.key === rowKey)
    if (row?.isPct) return val != null ? parseFloat(val).toFixed(1) + '%' : '—'
    if (row?.isRatio) return fmtVal(val, true)
    return fmtVal(val)
  }

  // Summary cards
  const summaryCards = [
    { label: 'FYP Kế Hoạch', value: formatNum(ga.totalFypPlan), unit: 'triệu VND', color: '#ef4444', icon: '🎯' },
    { label: 'FYP Thực Hiện', value: formatNum(ga.totalFypYtd), unit: 'triệu VND', color: '#06d6a0', icon: '✅' },
    { label: 'APE Net YTD',   value: k.apeNetYtd >= 1000 ? (k.apeNetYtd/1000).toFixed(1)+'T' : formatNum(k.apeNetYtd), unit: 'triệu VND', color: '#7209b7', icon: '💰' },
    { label: 'Net Manpower',  value: formatNum(k.netManpower), unit: 'đại lý', color: '#00b4d8', icon: '👥' },
    { label: 'Active FYC',    value: formatNum(k.activeFyc), unit: 'đại lý', color: '#ef476f', icon: '🔥' },
    { label: 'Active Case',   value: formatNum(k.activeCase), unit: 'đại lý', color: '#fb8500', icon: '⚡' },
  ]

  // Chart data
  const chartFyp = displayMonths.map(m => {
    const entry = (ga.fyp2026||[]).find(d => d.month === m) || {}
    return { month: m, 'Kế hoạch': entry.plan, 'Thực hiện': entry.achieved }
  })
  const chartActMp = displayMonths.map(m => ({
    month: m,
    ACT: (ga.act2026||[]).find(d=>d.month===m)?.value,
    MP:  (ga.mp2026||[]).find(d=>d.month===m)?.value,
  }))
  const chartTldtptt = displayMonths.map(m => ({
    month: m,
    value: (ga.tldtptt||[]).find(d=>d.month===m)?.value,
  }))

  return (
    <div className="page-content">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:8 }}>
        <div>
          <h2 style={{ fontSize:15, fontWeight:700, color:'#1a1f36', marginBottom:2 }}>GA Tổng Hợp — D07 Quận 7</h2>
          <p style={{ fontSize:11, color:'#8896aa' }}>Dữ liệu Planning vs Achieved 2026</p>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          {['table','charts','yoy'].map(v => (
            <button key={v} onClick={() => setActiveView(v)} style={{
              padding:'5px 14px', borderRadius:8, border:'none', cursor:'pointer',
              fontSize:12, fontWeight:600, transition:'all .15s',
              background: activeView===v ? '#4361ee' : '#f0f4ff',
              color: activeView===v ? 'white' : '#4361ee',
            }}>
              {v === 'table' ? '📋 Bảng số liệu' : v === 'charts' ? '📊 Biểu đồ' : '📅 So sánh năm'}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:10, marginBottom:16 }}>
        {summaryCards.map((c, i) => <MetricCard key={i} {...c} />)}
      </div>

      {/* ── TABLE VIEW ── */}
      {activeView === 'table' && (
        <div className="card" style={{ padding:0, overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table style={{ borderCollapse:'collapse', width:'100%', fontSize:11.5 }}>
              <thead>
                {/* Quarter header */}
                <tr>
                  <th style={{ ...thStyle, minWidth:90, background:'#1a1f5e', color:'white', textAlign:'left', paddingLeft:12 }}>
                    PLANNING 2026
                  </th>
                  {activeQuarters.map(q => {
                    const cols = Q[q].filter(m => displayMonths.includes(m)).length
                    return (
                      <th key={q} colSpan={cols}
                        style={{ ...thStyle, background:'#b91c1c', color:'white', textAlign:'center' }}>
                        GROWTH {q}
                      </th>
                    )
                  })}
                  <th style={{ ...thStyle, background:'#1a1f5e', color:'white', textAlign:'center', minWidth:70 }}>
                    YEAR
                  </th>
                </tr>

                {/* Month header */}
                <tr>
                  <th style={{ ...thStyle, background:'#eef2ff', color:'#4361ee', textAlign:'left', paddingLeft:12 }}>
                    D07
                  </th>
                  {displayMonths.map(m => (
                    <th key={m} style={{ ...thStyle, background:'#eef2ff', color:'#4a5568', textAlign:'center', minWidth:58 }}>
                      {m}
                    </th>
                  ))}
                  <th style={{ ...thStyle, background:'#eef2ff', color:'#ef4444', textAlign:'center', fontWeight:800 }}>
                    TOTAL
                  </th>
                </tr>
              </thead>

              <tbody>
                {ROWS.map((row, ri) => {
                  // Special: PLANNING FYP uses planFyp array; FYP achieved uses fyp2026
                  const isPlanning = row.key === 'planFyp'
                  return (
                    <tr key={row.key}>
                      {/* Label */}
                      <td style={{
                        padding:'5px 8px 5px 12px',
                        background: row.bg,
                        fontStyle: 'italic',
                        fontWeight: row.bold ? 700 : 500,
                        color: row.color,
                        borderBottom:'1px solid #f0f0f0',
                        whiteSpace:'nowrap',
                        borderRight:'2px solid #e8ecf4',
                      }}>
                        {row.label}
                      </td>

                      {/* Month values */}
                      {displayMonths.map(m => {
                        const val = getVal(
                          isPlanning ? 'planFyp' : row.key,
                          m
                        )
                        // For planFyp, get from fyp2026[].plan
                        const displayVal = isPlanning
                          ? (() => {
                              const e = (ga.fyp2026||[]).find(d=>d.month===m)
                              return e ? e.plan : null
                            })()
                          : val
                        return (
                          <td key={m} style={{
                            padding:'5px 6px',
                            background: row.bg,
                            textAlign:'center',
                            color: row.color,
                            fontWeight: row.bold ? 700 : 500,
                            fontStyle: isPlanning ? 'italic' : 'normal',
                            borderBottom:'1px solid #f0f0f0',
                            borderRight:'1px solid #f4f5f9',
                          }}>
                            {formatCell(row.key, displayVal)}
                          </td>
                        )
                      })}

                      {/* TOTAL column */}
                      <td style={{
                        padding:'5px 8px',
                        background: '#fff7ed',
                        textAlign:'center',
                        color:'#ef4444',
                        fontWeight:800,
                        borderBottom:'1px solid #f0f0f0',
                        borderLeft:'2px solid #e8ecf4',
                      }}>
                        {(() => {
                          const tk = TOTAL_KEYS[row.key]
                          const tv = tk ? ga[tk] : null
                          if (tv === null || tv === undefined) return '—'
                          const row_ = ROWS.find(r => r.key === row.key)
                          if (row_?.isPct) return fmtPct(tv)
                          if (row_?.isRatio) return fmtVal(tv, true)
                          return fmtVal(tv)
                        })()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div style={{ padding:'10px 14px', background:'#f8f9ff', borderTop:'1px solid #e8ecf4',
            display:'flex', gap:16, flexWrap:'wrap', fontSize:10.5, color:'#8896aa' }}>
            <span>📌 REC = Tuyển mới</span>
            <span>📌 ACT = Đại lý hoạt động</span>
            <span>📌 ACT RATIO = Tỷ lệ hoạt động</span>
            <span>📌 CASE SIZE = APE/Case</span>
            <span>📌 PC = PRU CHAMPION</span>
            <span>📌 PE = PRU ELITE</span>
            <span>📌 MP = Manpower</span>
            <span>📌 TLDTPTT = Tỷ lệ duy trì phí</span>
          </div>
        </div>
      )}

      {/* ── CHART VIEW ── */}
      {activeView === 'charts' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {/* FYP chart */}
          <div className="card">
            <div className="section-header">
              <div className="section-icon">📈</div>
              FYP 2026 — Kế Hoạch vs Thực Hiện (triệu VND)
            </div>
            <div style={{ height:220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartFyp}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f4ff" />
                  <XAxis dataKey="month" tick={{ fontSize:11 }} />
                  <YAxis tick={{ fontSize:11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconSize={8} formatter={v => <span style={{ fontSize:11 }}>{v}</span>} />
                  <Bar dataKey="Kế hoạch" fill="#fca5a5" radius={[4,4,0,0]}>
                    <LabelList dataKey="Kế hoạch" position="top" fontSize={10} fontWeight={700} fill="#1a1f36"
                      formatter={(v) => v != null ? formatNum(v) : ''} />
                  </Bar>
                  <Bar dataKey="Thực hiện" fill="#ef4444" radius={[4,4,0,0]}>
                    <LabelList dataKey="Thực hiện" position="top" fontSize={10} fontWeight={700} fill="#1a1f36"
                      formatter={(v) => v != null ? formatNum(v) : ''} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            {/* ACT & MP */}
            <div className="card">
              <div className="section-header">
                <div className="section-icon">⚡</div>
                ACT & Manpower theo Tháng
              </div>
              <div style={{ height:200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartActMp}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f4ff" />
                    <XAxis dataKey="month" tick={{ fontSize:11 }} />
                    <YAxis tick={{ fontSize:11 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend iconSize={8} formatter={v => <span style={{ fontSize:11 }}>{v}</span>} />
                    <Line type="monotone" dataKey="ACT" stroke="#f72585" strokeWidth={2} dot={{ r:3 }}>
                      <LabelList dataKey="ACT" position="top" fontSize={10} fontWeight={700} fill="#1a1f36"
                        formatter={(v) => v != null ? formatNum(v) : ''} />
                    </Line>
                    <Line type="monotone" dataKey="MP"  stroke="#06d6a0" strokeWidth={2} dot={{ r:3 }}>
                      <LabelList dataKey="MP" position="bottom" fontSize={10} fontWeight={700} fill="#1a1f36"
                        formatter={(v) => v != null ? formatNum(v) : ''} />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* TLDTPTT */}
            <div className="card">
              <div className="section-header">
                <div className="section-icon">📊</div>
                TLDTPTT theo Tháng (%)
              </div>
              <div style={{ height:200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartTldtptt.filter(d => d.value !== null)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f4ff" />
                    <XAxis dataKey="month" tick={{ fontSize:11 }} />
                    <YAxis tick={{ fontSize:11 }} domain={[70,100]} tickFormatter={v => v+'%'} />
                    <Tooltip formatter={v => [v?.toFixed(1)+'%','TLDTPTT']} />
                    <Line type="monotone" dataKey="value" name="TLDTPTT" stroke="#7209b7" strokeWidth={2.5} dot={{ r:4, fill:'#7209b7' }}>
                      <LabelList dataKey="value" position="top" fontSize={10} fontWeight={700} fill="#1a1f36"
                        formatter={(v) => v != null ? v.toFixed(1) + '%' : ''} />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── YOY COMPARISON VIEW ── */}
      {activeView === 'yoy' && (
        <YoYComparison yoy={ga} />
      )}
    </div>
  )
}

const thStyle = {
  padding: '7px 6px',
  fontWeight: 700,
  fontSize: 11,
  borderBottom: '2px solid #e8ecf4',
  borderRight: '1px solid #e8ecf4',
  whiteSpace: 'nowrap',
}
