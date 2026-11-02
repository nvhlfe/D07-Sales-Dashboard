import React, { useState } from 'react'
import { formatNum, mocActInfo } from '../utils/parseExcel'
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

// Xếp hạng bậc PC (dùng để sort các cột kiểu badge)
function pcRank(val) {
  const v = String(val || '').toUpperCase()
  if (v.includes('KIM CƯƠNG')) return 3
  if (v.includes('BẠCH KIM')) return 2
  if (v.includes('VÀNG') || v.includes('VANG')) return 1
  return 0
}

function mocRank(val) {
  const s = String(val || '')
  return (s.includes('ü') || s.toLowerCase() === 'true') ? 1 : 0
}

// Các cột UM hỗ trợ sắp xếp cao→thấp / thấp→cao
const UM_SORTERS = {
  fycPhongTT: um => parseFloat(um.fycPhongTT) || 0,
  pcTamDat:   um => pcRank(um.pcTamDat),
  tongTvvAct: um => parseFloat(um.tongTvvAct) || 0,
  mucHoTro:   um => parseFloat(um.mucHoTro) || 0,
  moc_tamDat: um => mocRank(um.moc_tamDat),
  moc_tongLuot: um => mocActInfo(um).have ?? -1,
  moc_luotCanThem: um => mocActInfo(um).need ?? -1,
}

function SortableTh({ field, label, sortField, sortDir, onSort }) {
  const active = sortField === field
  return (
    <th
      onClick={() => onSort(field)}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      title="Click để sắp xếp"
    >
      {label} <span style={{ fontSize: 9, color: active ? '#4361ee' : '#c5cde8' }}>
        {active ? (sortDir === 'desc' ? '▼' : '▲') : '↕'}
      </span>
    </th>
  )
}

export default function UMTab({ data }) {
  const [selectedUM, setSelectedUM] = useState(null)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState(null)
  const [sortDir, setSortDir] = useState('desc')
  const umList = data?.umList || []

  const filtered = umList.filter(um =>
    !search || um.leaderName?.toLowerCase().includes(search.toLowerCase()) ||
    String(um.leaderCode).includes(search)
  )

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sorted = React.useMemo(() => {
    if (!sortField) return filtered
    const getter = UM_SORTERS[sortField]
    const arr = [...filtered].sort((a, b) => getter(a) - getter(b))
    return sortDir === 'desc' ? arr.reverse() : arr
  }, [filtered, sortField, sortDir])

  const totalFyc = umList.reduce((s, u) => s + (parseFloat(u.fycPhongTT) || 0), 0)
  const totalThuong = umList.reduce((s, u) => s + (parseFloat(u.tienThuong) || 0), 0)

  return (
    <div className="page-content">
      <div className="page-head">
        <div className="page-title">Danh Sách UM — Văn Phòng D07</div>
        <div className="page-sub">Click vào dòng để xem chi tiết đầy đủ · {umList.length} UM</div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card summary-card">
          <div className="summary-label">TỔNG UM</div>
          <div className="summary-value" style={{ color: '#4361ee' }}>{umList.length}</div>
        </div>
        <div className="card summary-card">
          <div className="summary-label">TỔNG FYC PHÒNG TT</div>
          <div className="summary-value sm" style={{ color: '#f72585' }}>{formatNum(totalFyc)}</div>
          <div className="summary-sub">triệu VND</div>
        </div>
        <div className="card summary-card">
          <div className="summary-label">TIỀN THƯỞNG TẠM ĐẠT</div>
          <div className="summary-value sm" style={{ color: '#06d6a0' }}>{formatNum(totalThuong)}</div>
          <div className="summary-sub">triệu VND</div>
        </div>
        <div className="card summary-card">
          <div className="summary-label">ĐẠT DUY TRÌ (MOC)</div>
          <div className="summary-value" style={{ color: '#7209b7' }}>
            {umList.filter(u => u.moc_tamDat && String(u.moc_tamDat).includes('ü')).length}
          </div>
          <div className="summary-sub">/ {umList.length} UM</div>
          {(() => {
            const thieu = umList.filter(u => { const i = mocActInfo(u); return i.need !== null && i.need > 0 }).length
            return thieu > 0
              ? <div style={{ fontSize: 10, color: '#ef476f', fontWeight: 600, marginTop: 2 }}>{thieu} UM còn thiếu lượt Act</div>
              : null
          })()}
        </div>
      </div>

      <div className="card">
        <div style={{ marginBottom: 12 }}>
          <input
            className="search-input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Tìm theo tên hoặc mã đại lý..."
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
                <SortableTh field="fycPhongTT" label="FYC Phòng TT" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th>TLDTPTT</th>
                 <SortableTh field="pcTamDat" label="PC Tạm đạt" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                 <SortableTh field="tongTvvAct" label="Tổng TVV HĐ" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                 <th>Lượt ACT cần (Thưởng quý)</th>
                 <th>TVV CL cần thêm</th>
                <SortableTh field="mucHoTro" label="Mức hỗ trợ" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableTh field="moc_tongLuot" label="Lượt Act MOC (đã có)" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableTh field="moc_luotCanThem" label="Act cần thêm (MOC)" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableTh field="moc_tamDat" label="Duy trì (MOC)" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((um, i) => (
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
                  {(() => {
                    const info = mocActInfo(um)
                    return (
                      <>
                        <td style={{ color: '#7209b7', fontWeight: 700 }}>
                          {info.have !== null ? formatNum(info.have) : '—'}
                          {um.moc_luotTvvAct != null && um.moc_tvvMoiCl != null && (
                            <div style={{ fontSize: 9.5, color: '#8896aa', fontWeight: 500 }}>
                              {formatNum(um.moc_luotTvvAct)} HĐ + {formatNum(um.moc_tvvMoiCl)} mới CL×2
                            </div>
                          )}
                        </td>
                        <td>
                          {info.need === null
                            ? (info.passed
                              ? <span style={{ color: '#06d6a0', fontWeight: 700 }}>✓ Đủ</span>
                              : <span style={{ color: '#8896aa' }}>—</span>)
                            : info.need <= 0
                              ? <span style={{ color: '#06d6a0', fontWeight: 700 }}>✓ Đủ</span>
                              : <span style={{ color: '#ef476f', fontWeight: 800, fontSize: 14 }}>{formatNum(info.need)}</span>}
                        </td>
                      </>
                    )
                  })()}
                  <td><MocBadge val={um.moc_tamDat} /></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={15} style={{ textAlign: 'center', padding: 24, color: '#8896aa' }}>Không tìm thấy</td></tr>
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
