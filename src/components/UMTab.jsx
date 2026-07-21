import React, { useState } from 'react'
import { formatNum } from '../utils/parseExcel'
import UMModal from './UMModal'

function PCBadge({ val }) {
  if (!val) return <span style={{ color: '#ccc' }}>—</span>
  const v = String(val).toUpperCase()
  let cls = ''
  if (v.includes('VÀNG') || v.includes('VANG')) cls = 'pc-VANG'
  else if (v.includes('KIM CƯƠNG')) cls = 'pc-KIM_CUONG'
  else if (v.includes('BẠCH KIM')) cls = 'pc-BACH_KIM'
  return <span className={`pc-badge ${cls}`}>{val}</span>
}

function MocBadge({ val }) {
  if (!val) return <span style={{ color: '#ddd', fontSize: 14 }}>—</span>
  const s = String(val)
  if (s.includes('ü') || s.toLowerCase() === 'true')
    return <span style={{ color: '#06d6a0', fontWeight: 700, fontSize: 14 }}>✓</span>
  if (s === '-') return <span style={{ color: '#8896aa' }}>—</span>
  return <span style={{ color: '#ef476f', fontSize: 13 }}>{s}</span>
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—'
  const n = parseFloat(val)
  if (isNaN(n)) return '—'
  return n.toFixed(2) + '%'  // already converted to % in parseExcel
}

export default function UMTab({ data }) {
  const [selectedUM, setSelectedUM] = useState(null)
  const [search, setSearch] = useState('')
  const umList = data?.umList || []

  const filtered = umList.filter(um =>
    !search || um.leaderName?.toLowerCase().includes(search.toLowerCase()) ||
    String(um.leaderCode).includes(search)
  )

  const totalFyc = umList.reduce((s, u) => s + (parseFloat(u.fycPhongTT) || 0), 0)
  const totalThuong = umList.reduce((s, u) => s + (parseFloat(u.tienThuong) || 0), 0)

  return (
    <div className="page-content">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1a1f36', marginBottom: 4 }}>Danh Sách UM — Văn Phòng D07</h2>
        <p style={{ fontSize: 12, color: '#8896aa' }}>Click vào dòng để xem chi tiết đầy đủ · {umList.length} UM</p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>TỔNG UM</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#4361ee' }}>{umList.length}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>TỔNG FYC PHÒNG TT</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f72585' }}>{formatNum(totalFyc)}</div>
          <div style={{ fontSize: 10, color: '#8896aa' }}>triệu VND</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>TIỀN THƯỞNG TẠM ĐẠT</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#06d6a0' }}>{formatNum(totalThuong)}</div>
          <div style={{ fontSize: 10, color: '#8896aa' }}>triệu VND</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>ĐẠT DUY TRÌ (MOC)</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#7209b7' }}>
            {umList.filter(u => u.moc_tamDat && String(u.moc_tamDat).includes('ü')).length}
          </div>
          <div style={{ fontSize: 10, color: '#8896aa' }}>/ {umList.length} UM</div>
        </div>
      </div>

      <div className="card">
        <div style={{ marginBottom: 12 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Tìm theo tên hoặc mã đại lý..."
            style={{
              width: '100%', padding: '9px 14px', border: '1.5px solid #e8ecf4',
              borderRadius: 9, fontSize: 13, outline: 'none', fontFamily: 'Inter, sans-serif',
            }}
            onFocus={e => e.target.style.borderColor = '#4361ee'}
            onBlur={e => e.target.style.borderColor = '#e8ecf4'}
          />
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>STT</th>
                <th>Tên UM</th>
                <th>Mã</th>
                <th>BM/Unit</th>
                <th>PC Hiện tại</th>
                <th>FYC Phòng TT</th>
                <th>TLDTPTT</th>
                 <th>PC Tạm đạt</th>
                 <th>Tổng TVV HĐ</th>
                 <th>Lượt ACT cần</th>
                 <th>TVV CL cần thêm</th>
                <th>Mức hỗ trợ</th>
                <th>Duy trì (MOC)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((um, i) => (
                <tr key={i} onClick={() => setSelectedUM(um)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: '#8896aa' }}>{um.stt}</td>
                  <td><span className="agent-name-link">{um.leaderName}</span></td>
                  <td style={{ color: '#8896aa', fontSize: 11 }}>{um.leaderCode}</td>
                  <td style={{ fontSize: 11 }}>{um.bm}/{um.unit}</td>
                  <td><PCBadge val={um.pcHienTai} /></td>
                  <td className="val-fyc">{formatNum(um.fycPhongTT)}</td>
                  <td style={{ color: '#7209b7', fontWeight: 600 }}>{um.tldtptt != null && !isNaN(Number(um.tldtptt)) ? Number(um.tldtptt).toFixed(1)+'%' : '—'}</td>
                  <td><PCBadge val={um.pcTamDat} /></td>
                  <td style={{ color:'#06d6a0', fontWeight:700 }}>{formatNum(um.tongTvvAct)}</td>
                  <td style={{ color:'#ef476f', fontWeight:700 }}>{formatNum(um.luotActCanThem)}</td>
                  <td style={{ color:'#7c3aed', fontWeight:700 }}>{formatNum(um.tvvMoiCl)}</td>
                  <td style={{ color:'#fb8500', fontWeight:700 }}>{um.mucHoTro != null && !isNaN(Number(um.mucHoTro)) ? Number(um.mucHoTro).toFixed(1)+'%' : '—'}</td>
                  <td><MocBadge val={um.moc_tamDat} /></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: 24, color: '#8896aa' }}>Không tìm thấy</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#8896aa' }}>
          Hiển thị {filtered.length}/{umList.length} UM · <em>Click vào dòng để xem chi tiết đầy đủ</em>
        </div>
      </div>

      {selectedUM && <UMModal um={selectedUM} onClose={() => setSelectedUM(null)} />}
    </div>
  )
}
