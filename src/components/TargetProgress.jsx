import React from 'react'
import { formatNum } from '../utils/parseExcel'

const VN_MONTHS = {1:'T1',2:'T2',3:'T3',4:'T4',5:'T5',6:'T6',7:'T7',8:'T8',9:'T9',10:'T10',11:'T11',12:'T12'}

export default function TargetProgress({ gaData, availableMonths }) {
  const totalPlan = gaData?.totalFypPlan
  const totalYtd  = gaData?.totalFypYtd

  if (totalPlan == null || totalYtd == null || totalPlan <= 0) return null

  const pctDone = (totalYtd / totalPlan) * 100
  const latestMonth = availableMonths?.[availableMonths.length - 1] || 0
  const monthsElapsed = latestMonth
  const monthsRemaining = Math.max(12 - monthsElapsed, 0)
  const remaining = Math.max(totalPlan - totalYtd, 0)
  const requiredPerMonth = monthsRemaining > 0 ? remaining / monthsRemaining : 0

  // Expected pace: if on-track, % done should ≈ monthsElapsed/12
  const expectedPct = (monthsElapsed / 12) * 100
  const isOnTrack = pctDone >= expectedPct * 0.95 // 5% tolerance

  const barColor = pctDone >= expectedPct ? '#06d6a0' : pctDone >= expectedPct * 0.8 ? '#ffd166' : '#ef476f'

  return (
    <div className="card" style={{ marginBottom:16 }}>
      <div className="section-header">
        <div className="section-icon">🎯</div>
        TIẾN ĐỘ KẾ HOẠCH FYP NĂM 2026
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr', gap:20 }}>
        {/* Progress bar */}
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
            <span style={{ fontSize:12, color:'#8896aa', fontWeight:600 }}>
              Đã đạt: <strong style={{ color:'#1a1f36' }}>{formatNum(totalYtd)}</strong> / {formatNum(totalPlan)} triệu VND
            </span>
            <span style={{ fontSize:16, fontWeight:800, color: barColor }}>{pctDone.toFixed(1)}%</span>
          </div>

          <div style={{ position:'relative', height:22, background:'#f0f4ff', borderRadius:11, overflow:'hidden' }}>
            {/* Expected pace marker */}
            <div style={{
              position:'absolute', left:`${Math.min(expectedPct,100)}%`, top:0, bottom:0,
              width:2, background:'#8896aa', zIndex:2,
            }} />
            <div style={{
              height:'100%', width:`${Math.min(pctDone,100)}%`,
              background: `linear-gradient(90deg, ${barColor}cc, ${barColor})`,
              borderRadius:11, transition:'width .5s ease',
              display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:8,
            }}>
              {pctDone > 12 && <span style={{ fontSize:10, color:'white', fontWeight:700 }}>{pctDone.toFixed(0)}%</span>}
            </div>
          </div>

          <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, fontSize:10, color:'#8896aa' }}>
            <span>Đầu năm</span>
            <span>Mốc kỳ vọng (T{monthsElapsed}/12): {expectedPct.toFixed(0)}%</span>
            <span>Cuối năm</span>
          </div>

          <div style={{
            marginTop:12, padding:'8px 12px', borderRadius:8,
            background: isOnTrack ? '#e6faf2' : '#fff1f2',
            display:'flex', alignItems:'center', gap:8,
          }}>
            <span style={{ fontSize:15 }}>{isOnTrack ? '✅' : '⚠️'}</span>
            <span style={{ fontSize:11.5, fontWeight:600, color: isOnTrack ? '#065f46' : '#991b1b' }}>
              {isOnTrack
                ? `Đang đúng tiến độ (kỳ vọng ${expectedPct.toFixed(0)}%, thực tế ${pctDone.toFixed(1)}%)`
                : `Đang chậm tiến độ ${(expectedPct - pctDone).toFixed(1)} điểm % so với kỳ vọng`}
            </span>
          </div>
        </div>

        {/* Required pace */}
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ background:'#f8f9ff', borderRadius:10, padding:'12px 14px', flex:1 }}>
            <div style={{ fontSize:10.5, color:'#8896aa', fontWeight:600, textTransform:'uppercase' }}>Còn lại cần đạt</div>
            <div style={{ fontSize:20, fontWeight:800, color:'#ef476f' }}>{formatNum(remaining)}</div>
            <div style={{ fontSize:10.5, color:'#8896aa' }}>triệu VND · {monthsRemaining} tháng còn lại</div>
          </div>
          <div style={{ background:'#f8f9ff', borderRadius:10, padding:'12px 14px', flex:1 }}>
            <div style={{ fontSize:10.5, color:'#8896aa', fontWeight:600, textTransform:'uppercase' }}>Cần đạt mỗi tháng</div>
            <div style={{ fontSize:20, fontWeight:800, color:'#4361ee' }}>
              {monthsRemaining > 0 ? formatNum(requiredPerMonth) : '—'}
            </div>
            <div style={{ fontSize:10.5, color:'#8896aa' }}>triệu VND/tháng để về đích</div>
          </div>
        </div>
      </div>
    </div>
  )
}
