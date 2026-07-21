import React, { useState } from 'react'
import { formatNum } from '../utils/parseExcel'
import TVVModal from './TVVModal'

function PEBadge({ val }) {
  if (!val) return <span style={{ color: '#ccc' }}>—</span>
  const v = String(val).toUpperCase()
  let bg, color
  if (v.includes('KIM CƯƠNG')) { bg = '#e3f2fd'; color = '#1e88e5' }
  else if (v.includes('BẠCH KIM')) { bg = '#e8f5e9'; color = '#43a047' }
  else if (v.includes('VÀNG') || v.includes('VANG')) { bg = '#fff3cd'; color = '#7a5c00' }
  else { bg = '#f0f4ff'; color = '#4361ee' }
  return <span style={{ background: bg, color, padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 }}>{val}</span>
}

function ActMark({ val }) {
  if (!val || val === 'NaN' || val === null) return <span style={{ color: '#ddd' }}>—</span>
  if (String(val).includes('ü') || String(val) === 'true') return <span style={{ color: '#06d6a0', fontWeight: 700 }}>✓</span>
  return <span style={{ color: '#ddd' }}>—</span>
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—'
  const n = parseFloat(val)
  if (isNaN(n)) return '—'
  return (n * 100).toFixed(2) + '%'
}

export default function TVVTab({ data }) {
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')
  const [filterPE, setFilterPE] = useState('all')
  const [filterUnit, setFilterUnit] = useState('all')

  const agList = data?.agList || []
  const peOptions = ['all', ...new Set(agList.map(a => a.peHienTai).filter(Boolean))]
  const unitOptions = ['all', ...new Set(agList.map(a => a.unit).filter(Boolean))]
    .sort((a, b) => a === 'all' ? -1 : b === 'all' ? 1 : a.localeCompare(b))

  const filtered = agList.filter(ag => {
    const matchSearch = !search || ag.agentName?.toLowerCase().includes(search.toLowerCase()) || String(ag.msddl).includes(search)
    const matchPE = filterPE === 'all' || ag.peHienTai === filterPE
    const matchUnit = filterUnit === 'all' || ag.unit === filterUnit
    return matchSearch && matchPE && matchUnit
  })

  const bachKim = agList.filter(a => String(a.peHienTai || '').includes('BẠCH KIM')).length
  const vang = agList.filter(a => String(a.peHienTai || '').toUpperCase().includes('VÀNG')).length
  const totalFyc = agList.reduce((s, a) => s + (parseFloat(a.fyc) || 0), 0)

  return (
    <div className="page-content">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1a1f36', marginBottom: 4 }}>Danh Sách TVV (AG-PE)</h2>
        <p style={{ fontSize: 12, color: '#8896aa' }}>Click vào dòng để xem chi tiết · {agList.length} TVV</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>TỔNG TVV</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#4361ee' }}>{agList.length}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>BẠCH KIM</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#43a047' }}>{bachKim}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>VÀNG</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#e6a800' }}>{vang}</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>FYC THÁNG</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#f72585' }}>{formatNum(totalFyc)}</div>
          <div style={{ fontSize: 10, color: '#8896aa' }}>triệu VND</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#8896aa', fontWeight: 600, marginBottom: 4 }}>FYC L12M</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#7209b7' }}>
            {formatNum(agList.reduce((s, a) => s + (parseFloat(a.fyc12m) || 0), 0))}
          </div>
          <div style={{ fontSize: 10, color: '#8896aa' }}>triệu VND</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Tìm tên hoặc mã..."
            style={{ flex: 1, minWidth: 200, padding: '8px 14px', border: '1.5px solid #e8ecf4', borderRadius: 9, fontSize: 13, outline: 'none', fontFamily: 'Inter, sans-serif' }}
            onFocus={e => e.target.style.borderColor = '#4361ee'}
            onBlur={e => e.target.style.borderColor = '#e8ecf4'}
          />
          <select value={filterUnit} onChange={e => setFilterUnit(e.target.value)}
            style={{ padding: '8px 12px', border: '1.5px solid #e8ecf4', borderRadius: 9, fontSize: 12, outline: 'none', fontFamily: 'Inter, sans-serif', background: 'white', cursor: 'pointer' }}>
            <option value="all">Tất cả Unit</option>
            {unitOptions.filter(u => u !== 'all').map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={filterPE} onChange={e => setFilterPE(e.target.value)}
            style={{ padding: '8px 12px', border: '1.5px solid #e8ecf4', borderRadius: 9, fontSize: 12, outline: 'none', fontFamily: 'Inter, sans-serif', background: 'white', cursor: 'pointer' }}>
            <option value="all">Tất cả PE</option>
            {peOptions.filter(p => p !== 'all').map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <div style={{ fontSize: 12, color: '#8896aa' }}>{filtered.length}/{agList.length} TVV</div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Tên TVV</th>
                <th>Mã ĐL</th>
                <th>BM/Unit</th>
                <th>PE Hiện tại</th>
                <th>PE Tạm đạt</th>
                <th>FYC L12M</th>
                <th>Act T1</th>
                <th>Act T2</th>
                <th>Act T3</th>
                <th>TLDTPTT</th>
                <th>FYC Quý</th>
                <th>Mức HT (%)</th>
                <th>FYC Cần thêm</th>
                <th>Vé Star Club</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((ag, i) => (
                <tr key={i} onClick={() => setSelected(ag)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: '#8896aa' }}>{ag.no}</td>
                  <td><span className="agent-name-link">{ag.agentName}</span></td>
                  <td style={{ fontSize: 11, color: '#8896aa' }}>{ag.msddl}</td>
                  <td style={{ fontSize: 11 }}>{ag.ban}/{ag.unit}</td>
                  <td><PEBadge val={ag.peHienTai} /></td>
                  <td><PEBadge val={ag.ketQuaTamTinh} /></td>
                  <td className="val-fyc">{formatNum(ag.fyc12m)}</td>
                  <td><ActMark val={ag.act1} /></td>
                  <td><ActMark val={ag.act2} /></td>
                  <td><ActMark val={ag.act3} /></td>
                  <td style={{ fontSize: 11, color: '#7209b7', fontWeight: 600 }}>{ag.tldtptt != null && !isNaN(ag.tldtptt) ? Number(ag.tldtptt).toFixed(1)+'%' : '—'}</td>
                  <td className="val-fyc">{formatNum(ag.fyc)}</td>
                  <td style={{color:"#fb8500",fontWeight:600}}>{ag.mucHoTro != null && !isNaN(Number(ag.mucHoTro)) ? Number(ag.mucHoTro).toFixed(1)+'%' : '—'}</td>
                  <td className="val-red">{formatNum(ag.fycCanThem)}</td>
                  <td style={{ fontSize: 11, color: '#fb8500', fontWeight: 600 }}>{ag.sc_ve || '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={15} style={{ textAlign: 'center', padding: 24, color: '#8896aa' }}>Không tìm thấy</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#8896aa' }}>
          <em>Click vào dòng để xem chi tiết: KQ Kinh Doanh, MDRT, PRU ELITE, Thưởng Quý, Star Club</em>
        </div>
      </div>

      {selected && <TVVModal tvv={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
