import React, { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine, LabelList } from 'recharts'
import { formatNum } from '../utils/parseExcel'

const VN_MONTHS = {1:'T1',2:'T2',3:'T3',4:'T4',5:'T5',6:'T6',7:'T7',8:'T8',9:'T9',10:'T10',11:'T11',12:'T12'}

const METRICS = [
  { key: 'fycThang',    label: 'FYC',          color: '#4361ee' },
  { key: 'fypThang',    label: 'FYP',          color: '#06d6a0' },
  { key: 'apeNet',      label: 'APE Net',      color: '#7209b7' },
  { key: 'netManpower', label: 'Net Manpower', color: '#fb8500' },
  { key: 'caseNet',     label: 'Case Net',     color: '#ef476f' },
  { key: 'activeFyc',   label: 'Active FYC',   color: '#00b4d8' },
]

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div style={{ background:'white', padding:'10px 14px', borderRadius:10,
        boxShadow:'0 4px 16px rgba(0,0,0,.12)', fontSize:12 }}>
        <div style={{ fontWeight:700, marginBottom:6 }}>{label}/2026</div>
        {payload.map((p,i) => (
          <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:12, color:p.color, fontWeight:600 }}>
            <span>{p.name}</span><span>{formatNum(p.value)}</span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export default function TrendChart({ monthlyKpis, availableMonths }) {
  const [selected, setSelected] = useState(['fycThang', 'fypThang'])

  if (!availableMonths || availableMonths.length < 2) {
    return (
      <div className="card" style={{ textAlign:'center', padding:'30px 16px', color:'#8896aa' }}>
        <div style={{ fontSize:28, marginBottom:8 }}>📈</div>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>Cần ít nhất 2 tháng dữ liệu để xem xu hướng</div>
        <div style={{ fontSize:11.5 }}>Upload thêm các sheet Tháng khác trong file Excel để hiển thị biểu đồ tăng trưởng theo thời gian</div>
      </div>
    )
  }

  const chartData = availableMonths.map(m => {
    const d = monthlyKpis[m] || {}
    const row = { month: VN_MONTHS[m] || `T${m}` }
    METRICS.forEach(metric => { row[metric.label] = d[metric.key] ?? null })
    return row
  })

  const toggleMetric = (key) => {
    setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  return (
    <div className="card">
      <div className="section-header">
        <div className="section-icon">📈</div>
        XU HƯỚNG THEO THỜI GIAN
        <span style={{ marginLeft:'auto', fontSize:10.5, color:'#8896aa', fontWeight:500 }}>
          {availableMonths.length} tháng dữ liệu
        </span>
      </div>

      {/* Metric toggles */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
        {METRICS.map(m => (
          <button key={m.key}
            onClick={() => toggleMetric(m.key)}
            style={{
              padding:'4px 12px', borderRadius:16, border:'1.5px solid',
              borderColor: selected.includes(m.key) ? m.color : '#e8ecf4',
              background: selected.includes(m.key) ? m.color + '18' : 'white',
              color: selected.includes(m.key) ? m.color : '#8896aa',
              fontSize:11, fontWeight:600, cursor:'pointer', transition:'all .15s',
              display:'flex', alignItems:'center', gap:5,
            }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background: selected.includes(m.key) ? m.color : '#ddd' }} />
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ height:280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f4ff" />
            <XAxis dataKey="month" tick={{ fontSize:12, fontWeight:600 }} />
            <YAxis tick={{ fontSize:11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend iconSize={9} formatter={v => <span style={{ fontSize:11.5, fontWeight:500 }}>{v}</span>} />
            {METRICS.filter(m => selected.includes(m.key)).map(m => (
              <Line key={m.key} type="monotone" dataKey={m.label}
                stroke={m.color} strokeWidth={2.5}
                dot={{ r:4, fill:m.color, strokeWidth:0 }}
                activeDot={{ r:6 }}
                connectNulls
              >
                <LabelList
                  dataKey={m.label}
                  position="top"
                  offset={8}
                  fontSize={10}
                  fontWeight={700}
                  fill="#1a1f36"
                  formatter={(v) => v != null ? formatNum(v) : ''}
                />
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
