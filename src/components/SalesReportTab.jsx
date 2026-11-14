import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import * as XLSX from 'xlsx'
import {
  useAuth, useReportsDoc, saveReportPerson, deleteReportPerson, saveReportsDoc,
  useTvvDirectory, saveTvvDirectory, listDailySalesInMonth, logAuditEntry, useAuditLog,
} from '../lib/db'
import {
  TVV_SEED_DATA, genId, normalizeVi, STATUS_LBL, feeToTrieu, validateFee, fmtMoneyM,
  fmtVnd, daysInMonth, pad2, calcTotal, calcIssued, calcPersonStats, personArrayToMap,
  personMapToArray, createDefaultPerson, nextOrder, mergeReportDataFromSnapshot,
  collectOpenCases, ageChipClass, isAgingCase, mergeTvvDirectory, parseTvvRows,
  mapRawStatus, parseProposalPipelineExcel, normalizeProposalRow, computeReconcile,
  findOrCreatePerson, dayFromProposalDate, buildSummaryExportAoa,
  buildOverviewExportAoa, buildTonExportAoa,
} from '../lib/salesReportLogic'
import html2canvas from 'html2canvas'
import { analyzeSoSanLuong, groupPendingByReason, maskSensitive } from '../lib/soSanLuongLogic'
import { formatNum } from '../utils/parseExcel'

// ─────────────────────────────────────────────────────────────
// Sales Report — port React native từ bản standalone đang chạy
// production (d07-sales-report.vercel.app). Toàn bộ nghiệp vụ/logic
// thuần nằm ở src/lib/salesReportLogic.js; file này giữ state, lưu
// theo từng người (debounce 600ms qua saveReportPerson của db.js)
// và render 4 tab: Report / Overview / Tổng hợp / Chờ xử lý.
// Quy ước quyền của app: đã đăng nhập = sửa được; chưa đăng nhập = chỉ xem.
// ─────────────────────────────────────────────────────────────

const ACTION_ICON = {
  update_field: '✏️', add_person: '➕', delete_person: '🗑️',
  update_fee: '💰', update_status: '🔄', delete_case: '❌', add_case: '📝',
  update_note: '🗒️', import_proposal: '🔗', import_tvv_directory: '📥', export_ton: '⬇',
}

// Ô nhập phí trong thẻ hồ sơ: hiển thị theo triệu, commit khi blur/Enter
// (đúng hành vi onchange của bản gốc). resetNonce đổi → remount để revert
// khi nhập sai.
function FeeInput({ value, resetNonce, disabled, onCommit }) {
  const [draft, setDraft] = useState(null)
  const shown = draft !== null ? draft : (value === '' || value == null ? '' : String(value))
  return (
    <input
      type="number" step="0.001" placeholder="0"
      title="Đơn vị: triệu (vd 29.155 = 29.155.000đ)"
      className="sr-case-fee-input"
      value={shown}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => { if (draft !== null) { onCommit(draft); setDraft(null) } }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

// ⑭ Nhóm hồ sơ chờ theo lý do (từ sheet Pending của Daily mới nhất trong tháng).
// Một hồ sơ thiếu nhiều mục sẽ xuất hiện ở nhiều nhóm — đã ghi chú ngay trên thẻ.
function PendingReasonGroups({ year, month }) {
  const { isSuperAdmin } = useAuth()
  const [st, setSt] = useState({ loading: true, asOf: null, groups: [], distinct: 0, hasData: false })
  const [openReason, setOpenReason] = useState(null)
  useEffect(() => {
    let alive = true
    setSt((prev) => ({ ...prev, loading: true }))
    listDailySalesInMonth(year, month)
      .then((docs) => {
        if (!alive) return
        const analysis = analyzeSoSanLuong(docs, [], { year, month })
        const { groups, distinctCases } = groupPendingByReason(analysis.pendingAll)
        setSt({ loading: false, asOf: analysis.asOf, groups, distinct: distinctCases, hasData: analysis.hasData })
      })
      .catch(() => { if (alive) setSt({ loading: false, asOf: null, groups: [], distinct: 0, hasData: false }) })
    return () => { alive = false }
  }, [year, month])

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 800, fontSize: 13.5, color: '#1a1f5e', marginBottom: 2 }}>
        🧩 Hồ sơ chờ theo lý do
        {st.asOf ? <span style={{ fontWeight: 500, color: '#8896aa', fontSize: 11.5 }}> · theo Daily {st.asOf.slice(8, 10)}/{st.asOf.slice(5, 7)}</span> : null}
      </div>
      {st.loading ? (
        <div style={{ fontSize: 12, color: '#8896aa' }}>Đang tải dữ liệu Daily…</div>
      ) : !st.hasData ? (
        <div style={{ fontSize: 12, color: '#8896aa' }}>Chưa có dữ liệu Daily của tháng này nên chưa nhóm được lý do chờ.</div>
      ) : st.groups.length === 0 ? (
        <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>Không còn hồ sơ nào đang chờ. 🎉</div>
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: '#8896aa', marginBottom: 8 }}>
            Tổng {st.distinct} hồ sơ đang chờ. Một hồ sơ thiếu nhiều mục sẽ nằm ở nhiều nhóm. Bấm vào một lý do để xem các hồ sơ thuộc nhóm đó.
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Lý do chờ</th>
                <th style={{ textAlign: 'center' }}>Số HS</th>
                <th style={{ textAlign: 'center' }}>Tổng APE (tr)</th>
                <th style={{ textAlign: 'left' }}>Hồ sơ lâu nhất</th>
              </tr>
            </thead>
            <tbody>
              {st.groups.map((g) => (
                <React.Fragment key={g.reason}>
                  <tr onClick={() => setOpenReason(openReason === g.reason ? null : g.reason)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontWeight: 600 }}>{openReason === g.reason ? '▾' : '▸'} {g.reason}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{g.count}</td>
                    <td style={{ textAlign: 'center' }}>{formatNum(g.totalApe)}</td>
                    <td>{g.oldest ? `${g.oldest.name || g.oldest.msdl} · ${g.oldest.unit || '—'} · chờ ${g.oldest.ageDays ?? '—'} ngày` : '—'}</td>
                  </tr>
                  {openReason === g.reason && g.cases.map((c, ci) => (
                    <tr key={g.reason + '|' + (c.proposalNum || '') + '|' + c.msdl + '|' + ci} style={{ background: '#f8f9ff' }}>
                      <td colSpan={4} style={{ paddingLeft: 24, fontSize: 12 }}>
                        {c.name || c.msdl} · {c.unit || '—'} · HSYC {maskSensitive(c.proposalNum, isSuperAdmin)} · chờ {c.ageDays ?? '—'} ngày · APE {formatNum(c.ape ?? c.ipSub)}tr
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

export default function SalesReportTab() {
  const nowD = new Date()
  const [year, setYear] = useState(nowD.getFullYear())
  const [month, setMonth] = useState(nowD.getMonth() + 1)
  const { user, isAdmin } = useAuth()
  // ④ Xuất ảnh PNG bảng Tổng hợp để gửi Zalo
  const summaryCardRef = useRef(null)
  const [exportingImg, setExportingImg] = useState(false)
  const exportSummaryImage = async () => {
    if (!summaryCardRef.current || exportingImg) return
    setExportingImg(true)
    try {
      const canvas = await html2canvas(summaryCardRef.current, { scale: 2, backgroundColor: '#ffffff', logging: false })
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `TongHop-SalesReport-T${month}-${year}.png`
      a.click()
    } catch (e) {
      console.error('Xuất ảnh Tổng hợp lỗi:', e)
      alert('Không tạo được ảnh, Lan thử lại giúp tôi.')
    } finally { setExportingImg(false) }
  }
  const { data: repDoc, source: repSource, loading: repLoading } = useReportsDoc(year, month)
  const { items: tvvRemote } = useTvvDirectory()
  const { entries: auditEntries } = useAuditLog(`${year}-${month}`)

  const userRef = useRef(user)
  useEffect(() => { userRef.current = user }, [user])
  const monthRef = useRef({ year, month })
  monthRef.current = { year, month }

  // ── Dữ liệu tháng: mảng person trong ref (mutate tại chỗ như bản gốc),
  // version chỉ để kích render lại.
  const personsRef = useRef([])
  const personsKeyRef = useRef(null)
  const pendingRef = useRef(new Set())
  const timersRef = useRef(new Map())
  const migratedKeyRef = useRef(null)
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])
  const [saveState, setSaveState] = useState('idle') // idle|saving|saved|error
  const saveTimeoutRef = useRef(null)
  const [feeNonce, setFeeNonce] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // ── UI state ──
  const [tab, setTab] = useState('report')
  const [selectedDay, setSelectedDay] = useState('all')
  const [sortType, setSortType] = useState('default')
  const [summarySort, setSummarySort] = useState({ field: null, dir: 'desc' })
  const [pendingFilter, setPendingFilter] = useState('all')
  const [tonThreshold, setTonThreshold] = useState(5)

  const persons = personsRef.current
  const days = daysInMonth(year, month)
  const visibleDays = useMemo(
    () => Array.from({ length: days }, (_, i) => i + 1).filter((d) => selectedDay === 'all' || parseInt(selectedDay) === d),
    [days, selectedDay]
  )
  const tvvDirectory = useMemo(() => mergeTvvDirectory(TVV_SEED_DATA, tvvRemote), [tvvRemote])

  // ── Lưu theo từng người (debounce 600ms) ──
  const flushPersonSave = useCallback(async (ym, person) => {
    timersRef.current.delete(person._id)
    setSaveState('saving')
    try {
      await saveReportPerson(ym.year, ym.month, person, userRef.current?.email || 'unknown')
      setSaveState('saved')
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2500)
    } catch (e) {
      console.error('[SalesReport] save error:', e)
      setSaveState('error')
    } finally {
      pendingRef.current.delete(person._id)
    }
  }, [])

  const queuePersonSave = useCallback((person) => {
    if (!person?._id) return
    pendingRef.current.add(person._id)
    const ym = { ...monthRef.current }
    clearTimeout(timersRef.current.get(person._id))
    const t = setTimeout(() => { flushPersonSave(ym, person) }, 600)
    timersRef.current.set(person._id, t)
  }, [flushPersonSave])

  const flushAllPending = useCallback(async (ym) => {
    timersRef.current.forEach((t) => clearTimeout(t))
    timersRef.current.clear()
    const pending = [...pendingRef.current]
      .map((id) => personsRef.current.find((p) => p._id === id)).filter(Boolean)
    await Promise.all(pending.map((p) => flushPersonSave(ym, p)))
  }, [flushPersonSave])

  const audit = useCallback((action, detail) => {
    const ym = monthRef.current
    logAuditEntry({
      month: `${ym.year}-${ym.month}`, action, detail,
      user: userRef.current?.email || 'unknown',
    }).catch((e) => console.error('Audit log error:', e))
  }, [])

  // ── Đổi tháng/năm: reset local, chờ snapshot của tháng mới ──
  useEffect(() => {
    personsRef.current = []
    personsKeyRef.current = null
    bump()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  // ── Nhận snapshot Firestore ──
  useEffect(() => {
    const key = `${year}-${month}`
    if (repDoc != null) {
      // Bỏ qua doc "cũ" của tháng trước còn sót trong lúc hook đang resubscribe
      const expected = [`${year}-${month}`, `${month}`]
      if (repSource && !expected.includes(repSource)) return
      const raw = repDoc.data
      if (Array.isArray(raw)) {
        // Định dạng cũ (mảng) → migrate sang map theo _id 1 lần như bản gốc
        const map = personArrayToMap(raw)
        personsRef.current = personMapToArray(map)
        personsKeyRef.current = key
        bump()
        if (migratedKeyRef.current !== key) {
          migratedKeyRef.current = key
          saveReportsDoc(year, month, { data: map }, userRef.current?.email || 'unknown')
            .catch((e) => console.error('Lỗi chuyển đổi định dạng dữ liệu tháng:', e))
        }
        return
      }
      personsRef.current = mergeReportDataFromSnapshot(personsRef.current, raw || {}, pendingRef.current)
      personsKeyRef.current = key
      bump()
      return
    }
    if (!repLoading && personsKeyRef.current !== key) {
      // Doc chưa tồn tại ở cả 2 key → hiển thị dữ liệu mặc định như bản gốc
      // (chỉ ghi lên server khi người dùng bắt đầu sửa).
      personsRef.current = [createDefaultPerson()]
      personsKeyRef.current = key
      bump()
    }
  }, [repDoc, repSource, repLoading, year, month, bump])

  // Unmount / đóng trang khi còn thay đổi chưa lưu
  useEffect(() => {
    const onUnload = (e) => {
      if (pendingRef.current.size) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      flushAllPending(monthRef.current)
    }
  }, [flushAllPending])

  // Làm mới tuổi hồ sơ mỗi phút (bản gốc: 5 phút)
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const changeMonth = async (m) => {
    await flushAllPending(monthRef.current)
    setSelectedDay('all')
    setMonth(m)
  }
  const changeYear = async (y) => {
    await flushAllPending(monthRef.current)
    setSelectedDay('all')
    setYear(y)
  }

  const requireEdit = () => isAdmin
  const saveLabel = saveState === 'saving' ? '⏳ Đang lưu...'
    : saveState === 'saved' ? '✓ Đã lưu'
    : saveState === 'error' ? '⚠ Lỗi lưu — thử lại' : ''

  // ── Số liệu tổng hợp (KPI + summary) ──
  const kpis = useMemo(() => {
    let cases = 0, fee = 0, issued = 0, paid = 0, noFee = 0
    persons.forEach((p) => {
      const s = calcPersonStats(p)
      cases += s.cases; fee += s.fee; issued += s.issued; paid += s.paid; noFee += s.noFee
    })
    return { tvv: persons.length, cases, fee, issued, paid, noFee, pending: fee - issued - noFee }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, persons])

  const sortedPersons = useMemo(() => {
    const arr = [...persons]
    if (sortType === 'group') arr.sort((a, b) => String(a.group || '').localeCompare(String(b.group || '')))
    else if (sortType === 'highest') arr.sort((a, b) => calcTotal(b) - calcTotal(a))
    else if (sortType === 'issued') arr.sort((a, b) => calcIssued(b) - calcIssued(a))
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, sortType, persons])

  // ══════════ CRUD người / hồ sơ ══════════
  const updateField = (person, field, val) => {
    if (!requireEdit()) return
    const oldVal = person[field]
    if (String(oldVal ?? '') === String(val ?? '')) return
    person[field] = val
    queuePersonSave(person)
    audit('update_field', `${field}: "${oldVal}" → "${val}" (${person.name})`)
    bump()
  }

  const updateCaseFee = (person, d, ci, val) => {
    if (!requireEdit()) return
    const check = validateFee(val)
    if (!check.ok) {
      window.alert('⚠️ ' + check.msg)
      setFeeNonce((n) => n + 1) // remount ô phí → revert về giá trị đúng
      return
    }
    const item = person.daily[d]?.cases[ci]
    if (!item) return
    const oldFee = item.fee
    item.fee = check.value
    queuePersonSave(person)
    if (String(oldFee) !== String(check.value)) {
      audit('update_fee', `${person.name} ngày ${d}: ${oldFee || 0} → ${check.value || 0} VND`)
    }
    bump()
  }

  const updateCaseStatus = (person, d, ci, val) => {
    if (!requireEdit()) return
    const item = person.daily[d]?.cases[ci]
    if (!item) return
    const oldStatus = item.status
    item.status = val
    queuePersonSave(person)
    if (oldStatus !== val) audit('update_status', `${person.name} ngày ${d}: ${oldStatus} → ${val}`)
    bump()
  }

  const deleteCase = (person, d, ci) => {
    if (!requireEdit()) return
    const item = person.daily[d]?.cases[ci]
    if (!item) return
    const fee = Number(item.fee || 0)
    if (fee > 0 && !window.confirm(`Xóa hồ sơ phí ${fee.toLocaleString('vi-VN')} VND? Hành động này không thể hoàn tác.`)) return
    person.daily[d].cases.splice(ci, 1)
    // Giữ nguyên key ngày với {cases:[]} — xoá hẳn key sẽ khiến merge của
    // Firestore giữ lại dữ liệu cũ trên server (đúng lưu ý của bản gốc).
    queuePersonSave(person)
    audit('delete_case', `${person.name} ngày ${d}: xóa hồ sơ ${fee.toLocaleString('vi-VN')} VND (${item.status})`)
    bump()
  }

  const editCaseNote = (person, d, ci) => {
    if (!requireEdit()) return
    const item = person.daily[d]?.cases[ci]
    if (!item) return
    const val = window.prompt('Ghi chú / Số Proposal cho hồ sơ này (nhập đúng ProposalNum để "Đối chiếu Proposal" tự động cập nhật trạng thái):', item.note || '')
    if (val === null) return
    item.note = val.trim()
    queuePersonSave(person)
    audit('update_note', `${person.name} ngày ${d}: cập nhật ghi chú hồ sơ`)
    bump()
  }

  const deletePerson = (person) => {
    if (!requireEdit()) return
    const totalFee = calcTotal(person)
    const confirmMsg = totalFee > 0
      ? `⚠️ "${person.name}" có TỔNG PHÍ ${totalFee.toLocaleString('vi-VN')} VND.\n\nXóa dòng này sẽ mất toàn bộ dữ liệu hồ sơ. Bạn chắc chắn?`
      : `Xóa dòng "${person.name}"?`
    if (!window.confirm(confirmMsg)) return
    clearTimeout(timersRef.current.get(person._id))
    timersRef.current.delete(person._id)
    pendingRef.current.delete(person._id)
    personsRef.current = personsRef.current.filter((p) => p._id !== person._id)
    deleteReportPerson(year, month, person._id, userRef.current?.email || 'unknown')
      .catch((e) => { console.error('Delete error:', e); window.alert('⚠️ Xoá không thành công, thử lại: ' + e.message) })
    audit('delete_person', `Xóa "${person.name}" (MSDL ${person.msdl}, tổng phí ${totalFee.toLocaleString('vi-VN')})`)
    bump()
  }

  const addPersonManual = () => {
    if (!requireEdit()) return
    const person = { _id: genId(), _order: nextOrder(personsRef.current), group: 'GROUP', msdl: '000000', name: 'Nhân sự mới', daily: {} }
    personsRef.current.push(person)
    flushPersonSave(monthRef.current, person)
    audit('add_person', 'Thêm dòng mới thủ công')
    setPickerOpen(false)
    bump()
  }

  const addPersonFromDirectory = (item) => {
    if (!requireEdit()) return
    const dup = personsRef.current.some((p) => String(p.msdl) === String(item.msdl))
    if (dup && !window.confirm(`MSDL ${item.msdl} (${item.name}) đã có trong danh sách tháng này. Vẫn thêm thêm một dòng nữa?`)) return
    const person = { _id: genId(), _order: nextOrder(personsRef.current), group: item.unit || 'GROUP', msdl: String(item.msdl), name: item.name, daily: {} }
    personsRef.current.push(person)
    flushPersonSave(monthRef.current, person)
    audit('add_person', `Thêm "${item.name}" (MSDL ${item.msdl}) từ danh sách TVV đã nhập`)
    setPickerOpen(false)
    bump()
  }

  // ══════════ Modal hồ sơ (bấm vào ô ngày) ══════════
  const [caseModal, setCaseModal] = useState(null) // { person, day }
  const [cmFee, setCmFee] = useState('')
  const [cmStatus, setCmStatus] = useState('none')
  const [cmNote, setCmNote] = useState('')
  const openCaseModal = (person, d) => {
    if (!requireEdit()) return
    setCaseModal({ person, day: d })
    setCmFee(''); setCmStatus('none'); setCmNote('')
  }
  const saveModalCase = () => {
    if (!caseModal) return
    const check = validateFee(cmFee)
    if (!check.ok) { window.alert('⚠️ ' + check.msg); return }
    const { person, day } = caseModal
    if (!person.daily[day]) person.daily[day] = { cases: [] }
    person.daily[day].cases.push({ fee: check.value, status: cmStatus, note: cmNote.trim() })
    queuePersonSave(person)
    audit('add_case', `${person.name} ngày ${day}: thêm hồ sơ ${Number(check.value || 0).toLocaleString('vi-VN')} VND (${cmStatus})`)
    setCaseModal(null)
    bump()
  }

  // ══════════ Modal "+ HS" (thêm hồ sơ đầy đủ 1 bước) ══════════
  const [acOpen, setAcOpen] = useState(false)
  const [acDay, setAcDay] = useState(1)
  const [acSearch, setAcSearch] = useState('')
  const [acSelected, setAcSelected] = useState(null)
  const [acDrop, setAcDrop] = useState(false)
  const [acFee, setAcFee] = useState('')
  const [acStatus, setAcStatus] = useState('none')
  const [acNote, setAcNote] = useState('')
  const openAddCaseModal = () => {
    if (!requireEdit()) return
    let defaultDay = 1
    const today = new Date()
    if (selectedDay !== 'all') defaultDay = parseInt(selectedDay)
    else if (today.getFullYear() === year && today.getMonth() + 1 === month) defaultDay = today.getDate()
    setAcDay(Math.min(Math.max(defaultDay, 1), days))
    setAcSearch(''); setAcSelected(null); setAcDrop(false)
    setAcFee(''); setAcStatus('none'); setAcNote('')
    setAcOpen(true)
  }
  const acCombined = useMemo(() => {
    const merged = new Map(tvvDirectory.map((t) => [String(t.msdl), t]))
    persons.forEach((p) => {
      if (p.msdl && !merged.has(String(p.msdl))) merged.set(String(p.msdl), { msdl: String(p.msdl), name: p.name, unit: p.group })
    })
    return [...merged.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvvDirectory, version])
  const acFiltered = useMemo(() => {
    const q = normalizeVi(acSearch)
    if (!q) return []
    return acCombined.filter((t) => normalizeVi(t.msdl).includes(q) || normalizeVi(t.name).includes(q)).slice(0, 50)
  }, [acCombined, acSearch])
  const saveAddCaseModal = () => {
    if (!acSelected) { window.alert('⚠️ Chọn TVV từ danh sách, hoặc bấm "dùng tên vừa nhập" nếu chưa có trong danh sách'); return }
    const check = validateFee(acFee)
    if (!check.ok) { window.alert('⚠️ ' + check.msg); return }
    let person = acSelected.manual ? null : personsRef.current.find((p) => String(p.msdl) === String(acSelected.msdl))
    if (!person) {
      person = acSelected.manual
        ? { _id: genId(), _order: nextOrder(personsRef.current), group: 'GROUP', msdl: '000000', name: acSelected.name, daily: {} }
        : { _id: genId(), _order: nextOrder(personsRef.current), group: acSelected.unit || 'GROUP', msdl: String(acSelected.msdl), name: acSelected.name, daily: {} }
      personsRef.current.push(person)
      flushPersonSave(monthRef.current, person)
      audit('add_person', acSelected.manual
        ? `Thêm "${person.name}" (nhập thủ công qua ＋HS)`
        : `Thêm "${person.name}" (MSDL ${person.msdl}) từ danh sách TVV qua ＋HS`)
    }
    if (!person.daily[acDay]) person.daily[acDay] = { cases: [] }
    person.daily[acDay].cases.push({ fee: check.value, status: acStatus, note: acNote.trim() })
    queuePersonSave(person)
    audit('add_case', `${person.name} ngày ${acDay}: thêm hồ sơ ${Number(check.value || 0).toLocaleString('vi-VN')} VND (${acStatus}) qua ＋HS`)
    setAcOpen(false)
    bump()
  }

  // ══════════ TVV Picker ══════════
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerUnit, setPickerUnit] = useState('all')
  const [pickerSearch, setPickerSearch] = useState('')
  const pickerUnits = useMemo(
    () => [...new Set(tvvDirectory.map((t) => t.unit).filter(Boolean))].sort(),
    [tvvDirectory]
  )
  const pickerFiltered = useMemo(() => {
    const q = normalizeVi(pickerSearch)
    return tvvDirectory.filter((t) => {
      if (pickerUnit !== 'all' && t.unit !== pickerUnit) return false
      if (!q) return true
      return normalizeVi(t.msdl).includes(q) || normalizeVi(t.name).includes(q)
    }).slice(0, 200)
  }, [tvvDirectory, pickerUnit, pickerSearch])
  const openTvvPicker = () => {
    if (!requireEdit()) return
    setPickerUnit('all'); setPickerSearch('')
    setPickerOpen(true)
  }

  // ══════════ Nhập danh sách TVV từ Excel ══════════
  const [tvvImpOpen, setTvvImpOpen] = useState(false)
  const [tvvImpStaged, setTvvImpStaged] = useState(null)
  const [tvvImpStatus, setTvvImpStatus] = useState('')
  const [tvvImpStatusColor, setTvvImpStatusColor] = useState('#4a5568')
  const [tvvImpReplace, setTvvImpReplace] = useState(false)
  const [tvvImpSaving, setTvvImpSaving] = useState(false)
  const tvvFileRef = useRef(null)

  const handleTvvFileSelect = async (file) => {
    if (!file) return
    setTvvImpStatus('Đang đọc file...'); setTvvImpStatusColor('#4a5568')
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const { headerIdx, items } = parseTvvRows(rows)
      if (headerIdx === -1) {
        setTvvImpStatus('⚠️ Không tìm thấy dòng tiêu đề có cột Unit/MSDL/Tên TVV. Kiểm tra lại file.')
        setTvvImpStatusColor('#dc2626'); setTvvImpStaged(null); return
      }
      if (!items.length) {
        setTvvImpStatus('⚠️ Không đọc được dòng dữ liệu nào sau dòng tiêu đề.')
        setTvvImpStatusColor('#dc2626'); setTvvImpStaged(null); return
      }
      setTvvImpStaged(items)
      setTvvImpStatusColor('#065f46')
      setTvvImpStatus(`✓ Đọc được ${items.length} TVV (dòng tiêu đề: dòng ${headerIdx + 1})`)
    } catch (err) {
      console.error('Excel parse error:', err)
      setTvvImpStatusColor('#dc2626')
      setTvvImpStatus('⚠️ Lỗi đọc file Excel. Kiểm tra định dạng file (.xlsx/.xls).')
      setTvvImpStaged(null)
    }
  }

  const confirmTvvImport = async () => {
    if (!tvvImpStaged?.length) return
    if (tvvImpReplace) {
      const removedCount = tvvDirectory.filter((t) => !tvvImpStaged.some((s) => String(s.msdl) === String(t.msdl))).length
      const warn = removedCount > 0
        ? `⚠️ THAY THẾ TOÀN BỘ: sẽ XOÁ ${removedCount} MSDL cũ không có trong file này khỏi danh sách TVV dùng chung (Firestore), chỉ giữ lại đúng ${tvvImpStaged.length} người vừa nhập. Hành động này không thể hoàn tác. Tiếp tục?`
        : `Xác nhận thay thế toàn bộ danh sách TVV bằng ${tvvImpStaged.length} người trong file này?`
      if (!window.confirm(warn)) return
    }
    setTvvImpSaving(true)
    try {
      const finalList = tvvImpReplace
        ? [...new Map(tvvImpStaged.map((t) => [String(t.msdl), { ...t, msdl: String(t.msdl) }])).values()]
        : [...new Map([
          ...tvvDirectory.map((t) => [String(t.msdl), { ...t, msdl: String(t.msdl) }]),
          ...tvvImpStaged.filter((t) => t.msdl).map((t) => [String(t.msdl), { ...t, msdl: String(t.msdl) }]),
        ]).values()]
      // Timeout 15s như bản gốc — tránh treo vô hạn khi rules chưa deploy/mất mạng
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
      await Promise.race([saveTvvDirectory(finalList, userRef.current?.email || 'unknown'), timeout])
      audit('import_tvv_directory', tvvImpReplace
        ? `THAY THẾ TOÀN BỘ danh sách TVV bằng ${tvvImpStaged.length} dòng từ file (danh sách mới: ${finalList.length})`
        : `Nhập/cập nhật danh sách TVV: ${tvvImpStaged.length} dòng từ file (tổng danh sách: ${finalList.length})`)
      setTvvImpOpen(false)
    } catch (e) {
      console.error('TVV import save error:', e)
      const msg = e?.message === 'timeout'
        ? '⚠️ Lưu lên Firestore quá lâu (>15s) — có thể do Firestore Rules chưa cho phép ghi collection "tvv_directory", hoặc mất mạng. Danh sách vẫn đang dùng bản có sẵn (không mất dữ liệu), nhưng chưa đồng bộ lên Firestore. Kiểm tra lại Rules rồi thử lại.'
        : '⚠️ Lỗi lưu danh sách TVV: ' + (e?.code || e?.message || 'không rõ nguyên nhân') + '. Thử lại.'
      window.alert(msg)
    } finally {
      setTvvImpSaving(false)
    }
  }

  // ══════════ Đối chiếu Proposal ══════════
  const [propOpen, setPropOpen] = useState(false)
  const [propSource, setPropSource] = useState('daily')
  const [propDates, setPropDates] = useState([])
  const propDocsRef = useRef({}) // dateStr -> doc data (daily_sales_tvv)
  const [propSelDate, setPropSelDate] = useState('')
  const [propFileDate, setPropFileDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [propStatus, setPropStatus] = useState('')
  const [propStatusColor, setPropStatusColor] = useState('#4a5568')
  const [propResult, setPropResult] = useState(null)
  const [propFallback, setPropFallback] = useState(null)
  const [propApplying, setPropApplying] = useState(false)
  const propFileRef = useRef(null)

  const runReconcile = useCallback((proposalRows, pipelineRows, fallbackDateStr, successMsg) => {
    const result = computeReconcile(personsRef.current, proposalRows, pipelineRows, fallbackDateStr)
    setPropResult(result)
    setPropFallback(fallbackDateStr)
    setPropStatusColor('#065f46')
    setPropStatus('✓ ' + successMsg)
  }, [])

  const runDailyReconcile = useCallback((dateStr) => {
    const docData = propDocsRef.current[dateStr]
    if (!docData) { setPropStatus('⚠️ Không đọc được dữ liệu ngày này.'); setPropStatusColor('#dc2626'); return }
    const proposalRows = (docData.proposalRows || []).map(normalizeProposalRow)
    const pipelineRows = (docData.pipelineRows || []).map(normalizeProposalRow)
    if (!proposalRows.length && !pipelineRows.length) {
      setPropStatus('⚠️ Ngày này không có sheet Proposal/Pipeline (hoặc rỗng).')
      setPropStatusColor('#dc2626'); setPropResult(null); return
    }
    runReconcile(proposalRows, pipelineRows, dateStr,
      `Đối chiếu ${proposalRows.length} dòng Proposal + ${pipelineRows.length} dòng Pipeline ngày ${dateStr} (từ TVV Hàng Ngày).`)
  }, [runReconcile])

  const openProposalImportModal = async () => {
    if (!requireEdit()) return
    setPropResult(null); setPropStatus(''); setPropFallback(null)
    setPropSource('daily')
    setPropFileDate(new Date().toISOString().slice(0, 10))
    if (propFileRef.current) propFileRef.current.value = ''
    setPropOpen(true)
    setPropStatus('Đang tải danh sách ngày có dữ liệu...')
    setPropStatusColor('#4a5568')
    try {
      const list = await listDailySalesInMonth(year, month)
      const map = {}
      list.forEach(({ id, data }) => { map[id] = data })
      propDocsRef.current = map
      const dates = Object.keys(map).sort()
      setPropDates(dates)
      if (!dates.length) {
        setPropSelDate('')
        setPropStatus(`⚠️ Chưa có dữ liệu TVV Hàng Ngày (daily_sales_tvv) cho tháng ${pad2(month)}/${year}. Upload ở tab "TVV Hàng Ngày" trước.`)
        setPropStatusColor('#dc2626')
        return
      }
      const last = dates[dates.length - 1]
      setPropSelDate(last)
      setPropStatus('')
      runDailyReconcile(last)
    } catch (e) {
      console.error('Load daily_sales_tvv dates error:', e)
      setPropStatus('⚠️ Lỗi tải danh sách ngày: ' + (e?.code || e?.message || 'không rõ'))
      setPropStatusColor('#dc2626')
    }
  }

  const handleProposalFileSelect = async (file) => {
    if (!file) return
    setPropStatus('Đang đọc file...'); setPropStatusColor('#4a5568')
    try {
      const buf = await file.arrayBuffer()
      const { proposalRows, pipelineRows } = parseProposalPipelineExcel(buf)
      if (!proposalRows.length && !pipelineRows.length) {
        setPropStatus('⚠️ Không tìm thấy dòng Proposal/Pipeline hợp lệ trong file (kiểm tra tên sheet và cột Yearmonth/AGCode).')
        setPropStatusColor('#dc2626'); return
      }
      const dateStr = propFileDate || new Date().toISOString().slice(0, 10)
      runReconcile(proposalRows, pipelineRows, dateStr,
        `Đối chiếu ${proposalRows.length} dòng Proposal + ${pipelineRows.length} dòng Pipeline từ file (áp dụng ngày ${dateStr}).`)
    } catch (err) {
      console.error('Proposal file parse error:', err)
      setPropStatus('⚠️ Lỗi đọc file Excel. Kiểm tra định dạng file (.xlsx/.xls).')
      setPropStatusColor('#dc2626')
    }
  }

  const propTotalActions = propResult
    ? propResult.statusActions.length + propResult.addActions.length + propResult.fixActions.length
      + propResult.feeActions.length + propResult.pipelineActions.length
    : 0

  const confirmProposalImport = async () => {
    if (!propResult || !propTotalActions) return
    const { statusActions, addActions, fixActions, feeActions, pipelineActions } = propResult
    const parts = []
    if (statusActions.length) parts.push(`${statusActions.length} cập nhật trạng thái`)
    if (addActions.length) parts.push(`${addActions.length} thêm mới`)
    if (fixActions.length) parts.push(`${fixActions.length} chuyển đúng người`)
    if (feeActions.length) parts.push(`${feeActions.length} sửa phí`)
    if (pipelineActions.length) parts.push(`${pipelineActions.length} thêm Pipeline (CF)`)
    if (!window.confirm(`Áp dụng vào Sales Report tháng ${month}: ${parts.join(', ')} (không thể hoàn tác tự động, nhưng vẫn sửa tay lại từng ô được)?`)) return
    setPropApplying(true)
    try {
      const touched = new Map()
      const dateStr = propFallback
      statusActions.forEach((a) => {
        if (a.action === 'status') { a.item.status = a.after; if (a.policyNum) a.item.policyNum = a.policyNum }
        else if (a.action === 'policyNum') { a.item.policyNum = a.policyNum }
        else { a.item.fee = 0 }
        touched.set(a.person._id, a.person)
      })
      feeActions.forEach((a) => { a.item.fee = a.after; touched.set(a.person._id, a.person) })
      fixActions.forEach((a) => {
        const wrongCases = a.wrongPerson.daily[a.wrongD].cases
        wrongCases.splice(a.wrongCi, 1)
        touched.set(a.wrongPerson._id, a.wrongPerson)
        const person = findOrCreatePerson(personsRef.current, tvvDirectory, a.msdl, a.agName, a.unit)
        const d = a.wrongD // giữ nguyên ngày đã nhập tay, chỉ đổi người đứng tên
        if (!person.daily[d]) person.daily[d] = { cases: [] }
        person.daily[d].cases.push({ fee: a.fee, status: a.status, note: a.note, policyNum: a.policyNum || '' })
        touched.set(person._id, person)
      })
      addActions.forEach((a) => {
        const person = findOrCreatePerson(personsRef.current, tvvDirectory, a.msdl, a.agName, a.unit)
        const d = dayFromProposalDate(a.proposalDate, dateStr)
        if (!person.daily[d]) person.daily[d] = { cases: [] }
        person.daily[d].cases.push({ fee: a.fee, status: a.status, note: a.note, policyNum: a.policyNum || '' })
        touched.set(person._id, person)
      })
      pipelineActions.forEach((a) => {
        const person = findOrCreatePerson(personsRef.current, tvvDirectory, a.msdl, a.agName, a.unit)
        const d = dayFromProposalDate(a.proposalDate, dateStr)
        if (!person.daily[d]) person.daily[d] = { cases: [] }
        person.daily[d].cases.push({ fee: 0, status: 'none', note: a.note })
        touched.set(person._id, person)
      })
      await Promise.all([...touched.values()].map((p) => flushPersonSave(monthRef.current, p)))
      audit('import_proposal', `Đối chiếu Proposal (${dateStr}): ${statusActions.length} cập nhật trạng thái, ${addActions.length} thêm mới, ${fixActions.length} chuyển đúng người, ${feeActions.length} sửa phí, ${pipelineActions.length} thêm Pipeline (CF) — ${touched.size} TVV bị ảnh hưởng`)
      setPropOpen(false)
      bump()
    } catch (e) {
      console.error('Proposal reconcile save error:', e)
      window.alert('⚠️ Lỗi lưu thay đổi: ' + (e?.code || e?.message || 'không rõ nguyên nhân') + '. Thử lại.')
    } finally {
      setPropApplying(false)
    }
  }

  // ══════════ Tab Chờ xử lý ══════════
  const pendingRows = useMemo(
    () => collectOpenCases(persons, year, month, pendingFilter === 'all' ? null : pendingFilter, nowMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, year, month, pendingFilter, nowMs]
  )
  const markIssuedFromPending = (r) => {
    updateCaseStatus(r.person, r.d, r.ci, 'issued')
  }
  const deleteFromPending = (r) => {
    deleteCase(r.person, r.d, r.ci)
  }

  // ══════════ Tổng hợp: sắp xếp riêng ══════════
  const summaryRows = useMemo(() => {
    const rows = persons.map((person) => ({ person, ...calcPersonStats(person) }))
    if (summarySort.field) {
      const key = summarySort.field === 'nofee' ? 'noFee' : summarySort.field
      rows.sort((a, b) => (summarySort.dir === 'asc' ? a[key] - b[key] : b[key] - a[key]))
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, summarySort, persons])
  const toggleSummarySort = (field) => {
    setSummarySort((s) => (s.field === field
      ? { field, dir: s.dir === 'desc' ? 'asc' : 'desc' }
      : { field, dir: 'desc' }))
  }

  // ══════════ Xuất Excel ══════════
  const writeXlsx = (aoa, sheetName, filename, cols) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    if (cols) ws['!cols'] = cols
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
    XLSX.writeFile(wb, filename)
  }
  const exportExcel = () => {
    writeXlsx(buildSummaryExportAoa(persons), 'TONG_HOP', `D07_TONG_HOP_${year}.xlsx`)
  }
  const exportOverviewExcel = () => {
    const cols = [
      { wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 24 },
      ...visibleDays.map(() => ({ wch: 9 })),
      { wch: 11 }, { wch: 11 }, { wch: 13 }, { wch: 11 },
    ]
    const dayTag = selectedDay !== 'all' ? `_Ngay${selectedDay}` : ''
    writeXlsx(buildOverviewExportAoa(persons, visibleDays), 'OVERVIEW',
      `D07_OVERVIEW_T${pad2(month)}_${year}${dayTag}.xlsx`, cols)
  }
  const exportTonExcel = () => {
    const threshold = Math.max(0, parseInt(tonThreshold) || 0)
    const rows = collectOpenCases(persons, year, month, null, nowMs).filter((r) => r.ageDays >= threshold)
    if (!rows.length) { window.alert(`Không có hồ sơ nào tồn quá ${threshold} ngày.`); return }
    const cols = [{ wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 24 }, { wch: 11 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 24 }]
    const today = new Date().toISOString().slice(0, 10)
    writeXlsx(buildTonExportAoa(rows), 'HOSO_TON',
      `D07_HOSO_TON_T${pad2(month)}_${year}_tu${threshold}ngay_${today}.xlsx`, cols)
    audit('export_ton', `Xuất báo cáo "Hồ sơ tồn" (≥${threshold} ngày): ${rows.length} hồ sơ`)
  }

  // ══════════ Audit modal ══════════
  const [auditOpen, setAuditOpen] = useState(false)
  const auditShown = (auditEntries || []).slice(0, 20)
  const fmtAuditTime = (at) => {
    if (!at) return '—'
    if (typeof at.toDate === 'function') return at.toDate().toLocaleString('vi-VN')
    const d = new Date(at)
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('vi-VN')
  }

  // ══════════ RENDER ══════════
  const btnStyle = (bg, color) => ({
    padding: '6px 12px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600,
    cursor: 'pointer', background: bg, color, whiteSpace: 'nowrap',
  })
  const tabBtn = (t) => btnStyle(tab === t ? '#4361ee' : '#f0f4ff', tab === t ? '#fff' : '#4361ee')
  const saveColor = saveState === 'error' ? '#991b1b' : saveState === 'saved' ? '#065f46' : '#92400e'

  const dayTotals = visibleDays.map((d) => persons.reduce((s, p) => {
    const dd = p.daily[d]
    return s + (dd?.cases ? dd.cases.reduce((x, c) => x + Number(c.fee || 0), 0) : 0)
  }, 0))

  const summaryTotals = summaryRows.reduce((a, r) => ({
    cases: a.cases + r.cases, fee: a.fee + r.fee, issued: a.issued + r.issued,
    pending: a.pending + r.pending, noFee: a.noFee + r.noFee,
  }), { cases: 0, fee: 0, issued: 0, pending: 0, noFee: 0 })

  const renderCaseCard = (person, d, item, ci) => {
    const aging = isAgingCase(item, year, month, d, nowMs)
    return (
      <div key={ci}
        className={`sr-case-card ${item.status}${aging ? ' aging' : ''}`}
        title={aging ? `Hồ sơ Chưa phí (CF) đã quá 120 giờ — cần thúc` : undefined}>
        {item.note ? (
          <div className="sr-case-note-line" title={item.note}
            onClick={(e) => { e.stopPropagation(); editCaseNote(person, d, ci) }}>{item.note}</div>
        ) : (
          <div className="sr-case-note-mark" title="Bấm để thêm ghi chú"
            onClick={(e) => { e.stopPropagation(); editCaseNote(person, d, ci) }} />
        )}
        {(item.policyNum && (item.status === 'issued' || item.status === 'paid')) && (
          <div className="sr-case-policy-line" title={`Số hợp đồng: ${item.policyNum}`}>📄 {item.policyNum}</div>
        )}
        <div className="sr-case-card-top">
          <FeeInput
            value={feeToTrieu(item.fee)}
            resetNonce={feeNonce}
            disabled={!isAdmin}
            onCommit={(v) => updateCaseFee(person, d, ci, v)}
          />
          {isAdmin && (
            <button className="sr-case-pill-del"
              onClick={(e) => { e.stopPropagation(); deleteCase(person, d, ci) }}>×</button>
          )}
        </div>
        <div className="sr-status-btns">
          <button disabled={!isAdmin}
            className={`sr-status-btn s-none ${item.status === 'none' ? 'active' : ''}`} title="Chưa phí"
            onClick={(e) => { e.stopPropagation(); updateCaseStatus(person, d, ci, 'none') }}>CF</button>
          <button disabled={!isAdmin}
            className={`sr-status-btn s-paid ${item.status === 'paid' ? 'active' : ''}`} title="Có phí (chưa PH)"
            onClick={(e) => { e.stopPropagation(); updateCaseStatus(person, d, ci, 'paid') }}>CP</button>
          <button disabled={!isAdmin}
            className={`sr-status-btn s-issued ${item.status === 'issued' ? 'active' : ''}`} title="Phát hành"
            onClick={(e) => { e.stopPropagation(); updateCaseStatus(person, d, ci, 'issued') }}>PH</button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-content">
      <style>{SR_CSS}</style>

      {/* ── Toolbar ── */}
      <div className="card" style={{ marginBottom: 12, padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8896aa' }}>Tháng</span>
          <select value={month} onChange={(e) => changeMonth(+e.target.value)} style={btnStyle('#fff', '#1a1f36')}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>Tháng {m}</option>)}
          </select>
          <select value={year} onChange={(e) => changeYear(+e.target.value)} style={btnStyle('#fff', '#1a1f36')}>
            {[nowD.getFullYear() - 1, nowD.getFullYear(), nowD.getFullYear() + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8896aa' }}>Ngày</span>
          <select value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} style={btnStyle('#fff', '#1a1f36')}>
            <option value="all">Tất cả</option>
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Ngày {d}</option>)}
          </select>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8896aa' }}>Sắp xếp</span>
          <select value={sortType} onChange={(e) => setSortType(e.target.value)} style={btnStyle('#fff', '#1a1f36')}>
            <option value="default">Mặc định</option>
            <option value="group">Mã nhóm</option>
            <option value="highest">Phí cao nhất</option>
            <option value="issued">Phát hành nhiều nhất</option>
          </select>
          <span style={{ width: 1, height: 24, background: '#e8ecf4' }} />
          <button onClick={() => setTab('report')} style={tabBtn('report')}>📋 Report</button>
          <button onClick={() => setTab('overview')} style={tabBtn('overview')}>👁 Overview</button>
          <button onClick={() => setTab('summary')} style={tabBtn('summary')}>📊 Tổng hợp</button>
          <button onClick={() => setTab('pending')} style={tabBtn('pending')}>⏳ Chờ xử lý</button>
          <span style={{ width: 1, height: 24, background: '#e8ecf4' }} />
          <button onClick={exportExcel} style={btnStyle('#fef3c7', '#92400e')}>⬇ Excel</button>
          {isAdmin && (
            <>
              <button onClick={() => { setTvvImpStaged(null); setTvvImpStatus(''); setTvvImpReplace(false); if (tvvFileRef.current) tvvFileRef.current.value = ''; setTvvImpOpen(true) }} style={btnStyle('#e0f2fe', '#075985')}>📥 Nhập data</button>
              <button onClick={openProposalImportModal} style={btnStyle('#fef3c7', '#92400e')}>🔗 Đối chiếu Proposal</button>
              <button onClick={openTvvPicker} style={btnStyle('#f3e8ff', '#6d28d9')}>＋ TVV</button>
              <button onClick={openAddCaseModal} style={btnStyle('#e6faf2', '#065f46')}>＋ HS</button>
            </>
          )}
          <button onClick={() => setAuditOpen(true)} style={btnStyle('#f3e8ff', '#6d28d9')}>🕘 Lịch sử</button>
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: saveColor }}>{saveLabel}</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: '#4361ee', background: '#f0f4ff', padding: '4px 10px', borderRadius: 6, whiteSpace: 'nowrap' }}>
            {new Date(nowMs).toLocaleDateString('vi-VN')} {new Date(nowMs).toLocaleTimeString('vi-VN')}
          </span>
        </div>
        {!isAdmin && (
          <div style={{ fontSize: 11, color: '#8896aa', marginTop: 8 }}>
            👁 Chế độ xem — hãy đăng nhập (nút Đăng nhập ở thanh bên) để nhập/sửa dữ liệu. Mọi tài khoản được cấp đều sửa được.
          </div>
        )}
      </div>

      {/* ── KPI ── */}
      <div className="sr-kpi-bar">
        {[
          { lbl: 'Tổng TVV', val: kpis.tvv, color: '#4361ee' },
          { lbl: 'Tổng hồ sơ', val: kpis.cases, color: '#7209b7' },
          { lbl: 'Tổng phí', val: fmtMoneyM(kpis.fee), color: '#1d4ed8' },
          { lbl: 'Phát hành', val: fmtMoneyM(kpis.issued), color: '#15803d' },
          { lbl: 'Pending', val: fmtMoneyM(kpis.pending), color: '#a16207' },
          { lbl: 'Chưa phí', val: fmtMoneyM(kpis.noFee), color: '#be123c' },
        ].map((k) => (
          <div key={k.lbl} className="sr-kpi-chip">
            <div className="sr-kpi-lbl">{k.lbl}</div>
            <div className="sr-kpi-val" style={{ color: k.color }}>{k.val}</div>
          </div>
        ))}
      </div>

      <div className="sr-hint">💡 Click vào ô ngày để thêm hồ sơ · Hover hồ sơ để xóa · Chỉnh sửa trực tiếp trên ô</div>

      {repLoading && !persons.length ? (
        <div className="loading"><div className="spinner" /><div>Đang tải dữ liệu Sales Report…</div></div>
      ) : tab === 'report' ? (
        <div className="sr-table-wrap">
          <table className="sr-report-table">
            <thead>
              <tr>
                <th colSpan="4" className="sr-col-stt" style={{ position: 'sticky', left: 0, background: '#eef2ff', zIndex: 6, textAlign: 'left', padding: '5px 8px' }}>PHÍ NGÀY</th>
                {visibleDays.map((d, i) => (
                  <th key={d} style={{ textAlign: 'center', padding: '3px 2px', background: '#eef2ff' }}>
                    <div style={{ color: '#8896aa', fontSize: 9 }}>N{d}</div>
                    <div style={{ color: '#4361ee', fontWeight: 800 }}>
                      {dayTotals[i] ? (dayTotals[i] >= 1000000 ? (dayTotals[i] / 1000000).toFixed(1) + 'M' : dayTotals[i].toLocaleString('vi-VN')) : ''}
                    </div>
                  </th>
                ))}
                <th colSpan="4" style={{ background: '#eef2ff' }} />
              </tr>
              <tr>
                <th className="sr-col-stt">#</th>
                <th className="sr-col-grp">Nhóm</th>
                <th className="sr-col-msdl">MSDL</th>
                <th className="sr-col-name" style={{ textAlign: 'left', paddingLeft: 8 }}>Họ tên</th>
                {visibleDays.map((d) => {
                  const dow = new Date(year, month - 1, d).getDay()
                  const cls = dow === 0 ? 'sr-day-sun' : dow === 6 ? 'sr-day-sat' : ''
                  return <th key={d} className={cls} style={{ textAlign: 'center', minWidth: 68 }}>{d}</th>
                })}
                <th className="sr-col-total">Tổng phí</th>
                <th className="sr-col-nofee">Chưa phí</th>
                <th className="sr-col-issued">Phát hành</th>
                <th className="sr-col-paid">Có phí chưa PH</th>
              </tr>
            </thead>
            <tbody>
              {sortedPersons.map((person, pi) => {
                const s = calcPersonStats(person)
                return (
                  <tr key={person._id}>
                    <td className="sr-col-stt" style={{ textAlign: 'center', fontWeight: 700, color: '#8896aa' }}>{pi + 1}</td>
                    <td className="sr-col-grp">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        {isAdmin && (
                          <button onClick={() => deletePerson(person)} title="Xóa"
                            style={{ width: 13, height: 13, borderRadius: '50%', background: '#fca5a5', border: 'none', cursor: 'pointer', fontSize: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7f1d1d' }}>×</button>
                        )}
                        <input type="text" className="sr-editable-input" disabled={!isAdmin}
                          key={`g-${person._id}-${person.group}`}
                          defaultValue={person.group || ''}
                          onBlur={(e) => updateField(person, 'group', e.target.value)} />
                      </div>
                    </td>
                    <td className="sr-col-msdl">
                      <input type="text" className="sr-editable-input" disabled={!isAdmin}
                        key={`m-${person._id}-${person.msdl}`}
                        defaultValue={person.msdl || ''}
                        onBlur={(e) => updateField(person, 'msdl', e.target.value)} />
                    </td>
                    <td className="sr-col-name">
                      <input type="text" className="sr-editable-input" disabled={!isAdmin}
                        style={{ fontWeight: 600 }}
                        key={`n-${person._id}-${person.name}`}
                        defaultValue={person.name || ''}
                        onBlur={(e) => updateField(person, 'name', e.target.value)} />
                    </td>
                    {visibleDays.map((d) => (
                      <td key={d} className="sr-day-cell" onClick={() => openCaseModal(person, d)}>
                        {(person.daily[d]?.cases || []).map((item, ci) => renderCaseCard(person, d, item, ci))}
                      </td>
                    ))}
                    <td className="sr-col-total">{fmtVnd(s.fee)}</td>
                    <td className="sr-col-nofee">{fmtVnd(s.noFee)}</td>
                    <td className="sr-col-issued">{fmtVnd(s.issued)}</td>
                    <td className="sr-col-paid">{fmtVnd(s.paid)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : tab === 'overview' ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button onClick={exportOverviewExcel} style={btnStyle('#fef3c7', '#92400e')}>⬇ Xuất Excel (Overview)</button>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 32, textAlign: 'center' }}>#</th>
                  <th style={{ textAlign: 'left', minWidth: 160 }}>TVV</th>
                  {visibleDays.map((d) => {
                    const dow = new Date(year, month - 1, d).getDay()
                    const cls = dow === 0 ? 'sr-day-sun' : dow === 6 ? 'sr-day-sat' : ''
                    return <th key={d} className={cls} style={{ textAlign: 'center' }}>{d}</th>
                  })}
                  <th className="sr-col-total">Tổng</th>
                  <th className="sr-col-issued">PH</th>
                  <th className="sr-col-paid">CPF</th>
                  <th className="sr-col-nofee">CF</th>
                </tr>
              </thead>
              <tbody>
                {persons.map((person, i) => {
                  const s = calcPersonStats(person)
                  return (
                    <tr key={person._id}>
                      <td style={{ textAlign: 'center', color: '#8896aa', fontSize: 10.5 }}>{i + 1}</td>
                      <td>
                        <div style={{ fontSize: 9.5, color: '#8896aa' }}>{person.group} · {person.msdl}</div>
                        <div style={{ fontWeight: 700, fontSize: 11.5 }}>{person.name}</div>
                      </td>
                      {visibleDays.map((d) => {
                        const cases = person.daily[d]?.cases || []
                        let dayTot = 0, best = ''
                        cases.forEach((item) => {
                          dayTot += Number(item.fee || 0)
                          if (item.status === 'issued') best = 'issued'
                          else if (item.status === 'paid' && best !== 'issued') best = 'paid'
                          else if (item.status === 'none' && !best) best = 'none'
                        })
                        const color = best === 'issued' ? '#15803d' : best === 'paid' ? '#a16207' : best === 'none' ? '#be123c' : undefined
                        return (
                          <td key={d} style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 600, color }}>
                            {dayTot ? dayTot.toLocaleString('vi-VN') : ''}
                          </td>
                        )
                      })}
                      <td className="sr-col-total">{fmtVnd(s.fee)}</td>
                      <td className="sr-col-issued">{fmtVnd(s.issued)}</td>
                      <td className="sr-col-paid">{fmtVnd(s.paid)}</td>
                      <td className="sr-col-nofee">{fmtVnd(s.noFee)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'summary' ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <button onClick={exportSummaryImage} disabled={exportingImg} style={btnStyle('#e0f2fe', '#0369a1')}>
              {exportingImg ? '⏳ Đang tạo ảnh…' : '📸 Xuất ảnh (gửi Zalo)'}
            </button>
          </div>
          <div className="card" ref={summaryCardRef} style={{ padding: 0, overflow: 'auto', background: '#fff' }}>
            <div style={{ padding: '14px 16px 2px' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1f5e' }}>GA D07 — TỔNG HỢP SALES REPORT</div>
              <div style={{ fontSize: 11.5, color: '#8896aa' }}>Tháng {month}/{year} · {summaryRows.length} TVV · Tổng phí {fmtVnd(summaryTotals.fee)} · Phát hành {fmtVnd(summaryTotals.issued)}</div>
            </div>
            <table className="data-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'center' }}>STT</th>
                <th style={{ textAlign: 'center' }}>Mã nhóm</th>
                <th style={{ textAlign: 'center' }}>MSDL</th>
                <th style={{ textAlign: 'left', minWidth: 160 }}>Họ tên</th>
                <th style={{ textAlign: 'center' }}>Hồ sơ</th>
                <th style={{ textAlign: 'center' }}>Tổng phí</th>
                {[['issued', 'Phát hành'], ['pending', 'Pending'], ['nofee', 'Chưa phí']].map(([f, lbl]) => (
                  <th key={f} className={`sr-sort-th ${summarySort.field === f ? 'active' : ''}`}
                    style={{ textAlign: 'center' }} onClick={() => toggleSummarySort(f)}>
                    {lbl} <span className="sr-sort-arrow">{summarySort.field === f ? (summarySort.dir === 'desc' ? '▼' : '▲') : '⇅'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((r, i) => (
                <tr key={r.person._id}>
                  <td style={{ textAlign: 'center', color: '#8896aa' }}>{i + 1}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ background: '#f0f4ff', color: '#4361ee', padding: '2px 7px', borderRadius: 5, fontSize: 10.5, fontWeight: 700 }}>{r.person.group}</span>
                  </td>
                  <td style={{ textAlign: 'center', color: '#8896aa', fontSize: 10.5 }}>{r.person.msdl}</td>
                  <td style={{ fontWeight: 600 }}>{r.person.name}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{r.cases}</td>
                  <td style={{ textAlign: 'center', color: '#1d4ed8', fontWeight: 700 }}>{fmtVnd(r.fee)}</td>
                  <td style={{ textAlign: 'center', color: '#15803d', fontWeight: 700 }}>{fmtVnd(r.issued)}</td>
                  <td style={{ textAlign: 'center', color: '#a16207', fontWeight: 700 }}>{fmtVnd(r.pending)}</td>
                  <td style={{ textAlign: 'center', color: '#be123c', fontWeight: 700 }}>{fmtVnd(r.noFee)}</td>
                </tr>
              ))}
              <tr style={{ background: '#f0f4ff', fontWeight: 800 }}>
                <td colSpan="4" style={{ textAlign: 'right', paddingRight: 12, color: '#4361ee' }}>TỔNG</td>
                <td style={{ textAlign: 'center', color: '#7209b7' }}>{summaryTotals.cases}</td>
                <td style={{ textAlign: 'center', color: '#1d4ed8' }}>{fmtVnd(summaryTotals.fee)}</td>
                <td style={{ textAlign: 'center', color: '#15803d' }}>{fmtVnd(summaryTotals.issued)}</td>
                <td style={{ textAlign: 'center', color: '#a16207' }}>{fmtVnd(summaryTotals.pending)}</td>
                <td style={{ textAlign: 'center', color: '#be123c' }}>{fmtVnd(summaryTotals.noFee)}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      ) : null}

      {tab === 'pending' && !repLoading && (
        <div>
          <PendingReasonGroups year={year} month={month} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: '#5a6b87' }}>
              Tất cả hồ sơ <b>chưa phát hành</b> trong tháng, xếp theo tuổi hồ sơ lâu nhất trước. Bấm <b>🟢 PH</b> để đánh dấu đã phát hành ngay tại đây.
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              {[['all', 'Tất cả'], ['none', '🔴 Chưa phí (CF)'], ['paid', '🟡 Có phí, chưa PH (CP)']].map(([f, lbl]) => (
                <button key={f} onClick={() => setPendingFilter(f)}
                  className={`sr-pending-filter-btn ${pendingFilter === f ? 'active' : ''}`}>{lbl}</button>
              ))}
            </span>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>#</th>
                  <th style={{ textAlign: 'left', minWidth: 150 }}>TVV</th>
                  <th style={{ textAlign: 'center' }}>Nhóm</th>
                  <th style={{ textAlign: 'center' }}>MSDL</th>
                  <th style={{ textAlign: 'center' }}>Ngày nhập</th>
                  <th style={{ textAlign: 'center' }}>Phí (VND)</th>
                  <th style={{ textAlign: 'center' }}>Trạng thái</th>
                  <th style={{ textAlign: 'center' }}>Tuổi hồ sơ</th>
                  <th style={{ textAlign: 'left', minWidth: 140 }}>Số HĐ / Ghi chú</th>
                  <th style={{ textAlign: 'center' }}>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {pendingRows.map((r, i) => (
                  <tr key={`${r.person._id}-${r.d}-${r.ci}`}>
                    <td style={{ textAlign: 'center', color: '#8896aa', fontSize: 11 }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{r.person.name}</td>
                    <td style={{ textAlign: 'center' }}>{r.person.group}</td>
                    <td style={{ textAlign: 'center', color: '#8896aa', fontSize: 11 }}>{r.person.msdl}</td>
                    <td style={{ textAlign: 'center' }}>{r.d}/{month}/{year}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: r.item.fee > 0 ? '#1d4ed8' : '#be123c' }}>
                      {r.item.fee ? Number(r.item.fee).toLocaleString('vi-VN') : 'Chưa có phí'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`sr-status-pill ${r.item.status === 'paid' ? 'cp' : 'cf'}`}>
                        {r.item.status === 'paid' ? '🟡 CP' : '🔴 CF'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`sr-age-chip ${ageChipClass(r.ageDays)}`}>{r.ageDays} ngày</span>
                    </td>
                    <td>
                      {r.item.policyNum ? (
                        <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700 }}>📄 {r.item.policyNum}</span>
                      ) : r.item.note ? (
                        <span style={{ fontSize: 11, color: '#5a6b87' }}>{r.item.note}</span>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {isAdmin && (
                        <>
                          <button onClick={() => markIssuedFromPending(r)}
                            style={btnStyle('#06d6a0', '#fff')}>🟢 PH</button>{' '}
                          <button onClick={() => deleteFromPending(r)}
                            style={btnStyle('#fee2e2', '#991b1b')}>🗑 Xoá</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {!pendingRows.length && (
                  <tr><td colSpan="10" style={{ textAlign: 'center', padding: 28, color: '#8896aa' }}>
                    🎉 Không còn hồ sơ nào đang chờ xử lý theo bộ lọc này trong tháng {month}/{year}.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="card" style={{ marginTop: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 12.5 }}>📤 Xuất báo cáo Hồ sơ tồn</b>
            <span style={{ fontSize: 12, color: '#5a6b87' }}>Tồn từ</span>
            <input type="number" min="0" value={tonThreshold}
              onChange={(e) => setTonThreshold(e.target.value)}
              style={{ width: 64, padding: '5px 8px', border: '1px solid #d7dce8', borderRadius: 7, fontSize: 12 }} />
            <span style={{ fontSize: 12, color: '#5a6b87' }}>ngày trở lên</span>
            <button onClick={exportTonExcel} style={btnStyle('#fef3c7', '#92400e')}>⬇ Xuất Excel</button>
          </div>
        </div>
      )}

      {/* ── Modal: thêm hồ sơ (bấm ô ngày) ── */}
      {caseModal && (
        <div className="modal-overlay" onClick={() => setCaseModal(null)}>
          <div className="modal-box" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">➕ Thêm hồ sơ</div>
              <button className="modal-close" onClick={() => setCaseModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: '#5a6b87', marginBottom: 12 }}>
                <b>{caseModal.person.name}</b> — Ngày {caseModal.day}/{month}/{year}
              </div>
              <label className="sr-form-label">💰 Phí (triệu VND — để trống = chưa có phí)</label>
              <input type="text" inputMode="decimal" className="sr-form-input" placeholder="VD: 25.5 (triệu)"
                value={cmFee} onChange={(e) => setCmFee(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveModalCase() }} autoFocus />
              <label className="sr-form-label">📋 Trạng thái</label>
              <select className="sr-form-input" value={cmStatus} onChange={(e) => setCmStatus(e.target.value)}>
                <option value="none">🔴 CF — Chưa có phí</option>
                <option value="paid">🟡 CP — Có phí, chưa phát hành</option>
                <option value="issued">🟢 PH — Đã phát hành</option>
              </select>
              <label className="sr-form-label">📝 Ghi chú</label>
              <textarea className="sr-form-input" rows="2" placeholder="Ghi chú thêm (tùy chọn)"
                value={cmNote} onChange={(e) => setCmNote(e.target.value)} />
              <button className="sr-save-btn" onClick={saveModalCase}>💾 Lưu hồ sơ</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: ＋ HS ── */}
      {acOpen && (
        <div className="modal-overlay" onClick={() => setAcOpen(false)}>
          <div className="modal-box" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">➕ Thêm hồ sơ mới</div>
              <button className="modal-close" onClick={() => setAcOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <label className="sr-form-label">📅 Ngày</label>
              <select className="sr-form-input" value={acDay} onChange={(e) => setAcDay(+e.target.value)}>
                {Array.from({ length: days }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Ngày {d}/{month}/{year}</option>)}
              </select>
              <label className="sr-form-label">👤 TVV (gõ MSDL hoặc họ tên để tìm)</label>
              <div style={{ position: 'relative' }}>
                <input type="text" className="sr-form-input" placeholder="Tìm TVV..."
                  value={acSearch} autoFocus
                  onChange={(e) => { setAcSearch(e.target.value); setAcSelected(null); setAcDrop(true) }}
                  onFocus={() => setAcDrop(true)} />
                {acDrop && acSearch && !acSelected && (
                  <div className="sr-tvv-drop-list">
                    {acFiltered.map((t) => (
                      <div key={t.msdl} className="sr-tvv-drop-item"
                        onMouseDown={(e) => { e.preventDefault(); setAcSelected({ msdl: String(t.msdl), name: t.name, unit: t.unit }); setAcSearch(t.name); setAcDrop(false) }}>
                        <b>{t.name}</b> <span style={{ color: '#8896aa', fontSize: 11 }}>· {t.unit} · MSDL {t.msdl}</span>
                      </div>
                    ))}
                    {!acFiltered.length && <div className="sr-tvv-drop-empty">Không tìm thấy TVV nào khớp.</div>}
                    {acSearch.trim() && (
                      <div className="sr-tvv-drop-item"
                        onMouseDown={(e) => { e.preventDefault(); setAcSelected({ manual: true, name: acSearch.trim() }); setAcDrop(false) }}
                        style={{ color: '#7209b7', fontStyle: 'italic' }}>
                        ✎ Dùng tên vừa nhập: “{acSearch.trim()}” (tạo TVV mới)
                      </div>
                    )}
                  </div>
                )}
              </div>
              {acSelected && (
                <div className="sr-tvv-selected">
                  ✓ {acSelected.manual
                    ? <>Hồ sơ mới: <b>{acSelected.name}</b> <i>(TVV nhập thủ công)</i></>
                    : <><b>{acSelected.name}</b> · {acSelected.unit} · MSDL {acSelected.msdl}</>}
                </div>
              )}
              <div style={{ height: 10 }} />
              <label className="sr-form-label">💰 Phí (triệu VND — để trống = chưa có phí)</label>
              <input type="text" inputMode="decimal" className="sr-form-input" placeholder="VD: 25.5 (triệu)"
                value={acFee} onChange={(e) => setAcFee(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveAddCaseModal() }} />
              <label className="sr-form-label">📋 Trạng thái</label>
              <select className="sr-form-input" value={acStatus} onChange={(e) => setAcStatus(e.target.value)}>
                <option value="none">🔴 CF — Chưa có phí (mặc định)</option>
                <option value="paid">🟡 CP — Có phí, chưa phát hành</option>
                <option value="issued">🟢 PH — Đã phát hành</option>
              </select>
              <label className="sr-form-label">📝 Ghi chú</label>
              <textarea className="sr-form-input" rows="2" placeholder="Ghi chú thêm (tùy chọn)"
                value={acNote} onChange={(e) => setAcNote(e.target.value)} />
              <button className="sr-save-btn" onClick={saveAddCaseModal}>💾 Lưu hồ sơ</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: chọn TVV ── */}
      {pickerOpen && (
        <div className="modal-overlay" onClick={() => setPickerOpen(false)}>
          <div className="modal-box" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">👥 Chọn TVV vào tháng {month}/{year}</div>
              <button className="modal-close" onClick={() => setPickerOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <select className="sr-form-input" style={{ width: 130, flexShrink: 0 }} value={pickerUnit} onChange={(e) => setPickerUnit(e.target.value)}>
                  <option value="all">Tất cả đơn vị</option>
                  {pickerUnits.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <input type="text" className="sr-form-input" placeholder="🔍 Tìm theo MSDL hoặc họ tên..."
                  value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} autoFocus />
              </div>
              <div className="sr-tvv-picker-list">
                {pickerFiltered.map((t) => (
                  <div key={t.msdl} className="sr-tvv-drop-item" onClick={() => addPersonFromDirectory(t)}>
                    <b>{t.name}</b> <span style={{ color: '#8896aa', fontSize: 11 }}>· {t.unit} · MSDL {t.msdl}</span>
                  </div>
                ))}
                {!pickerFiltered.length && (
                  <div className="sr-tvv-drop-empty">
                    {tvvDirectory.length ? 'Không tìm thấy TVV nào khớp.' : 'Danh sách TVV đang trống — hãy "📥 Nhập data" trước (hoặc thêm dòng trống bên dưới).'}
                  </div>
                )}
              </div>
              {tvvDirectory.length > 200 && pickerFiltered.length === 200 && (
                <div style={{ fontSize: 11, color: '#8896aa', marginTop: 6 }}>Hiển thị 200 kết quả đầu tiên — gõ thêm để thu hẹp.</div>
              )}
              <div style={{ borderTop: '1px solid #eef0f7', marginTop: 12, paddingTop: 12 }}>
                <button onClick={addPersonManual}
                  style={{ width: '100%', padding: '10px', background: '#f6f8ff', color: '#4361ee', border: '1.5px dashed #4361ee', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  ➕ Thêm dòng trống (nhập tay MSDL/Họ tên sau)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: nhập danh sách TVV ── */}
      {tvvImpOpen && (
        <div className="modal-overlay" onClick={() => setTvvImpOpen(false)}>
          <div className="modal-box" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">📥 Nhập danh sách TVV từ Excel</div>
              <button className="modal-close" onClick={() => setTvvImpOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: '#5a6b87', lineHeight: 1.6 }}>
                File cần có cột: <b>Unit / Đơn vị</b>, <b>MSDL / Mã số đại lý</b>, <b>Tên TVV / Họ tên</b> (tên cột linh hoạt). Danh sách này được lưu <b>dùng chung</b> (database) cho mọi tháng, mọi lần mở — không mất khi re-import file tháng khác. Danh sách hiện tại: <b>{tvvDirectory.length} TVV</b>.
              </div>
              <label className="sr-form-label">📂 Chọn file Excel (.xlsx / .xls)</label>
              <input type="file" ref={tvvFileRef} accept=".xlsx,.xls" className="sr-form-input"
                onChange={(e) => { handleTvvFileSelect(e.target.files?.[0]); e.target.value = '' }} />
              {tvvImpStatus && <div style={{ fontSize: 12, marginTop: 8, color: tvvImpStatusColor }}>{tvvImpStatus}</div>}
              {tvvImpStaged && (
                <div className="sr-tvv-picker-list" style={{ maxHeight: 180, marginTop: 10 }}>
                  {tvvImpStaged.slice(0, 50).map((t) => (
                    <div key={t.msdl} className="sr-tvv-drop-item" style={{ cursor: 'default' }}>
                      <b>{t.name}</b> <span style={{ color: '#8896aa', fontSize: 11 }}>· {t.unit} · MSDL {t.msdl}</span>
                    </div>
                  ))}
                  {tvvImpStaged.length > 50 && (
                    <div className="sr-tvv-drop-empty">… và {tvvImpStaged.length - 50} TVV nữa (tổng {tvvImpStaged.length}).</div>
                  )}
                </div>
              )}
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: '#5a6b87', marginTop: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={tvvImpReplace} onChange={(e) => setTvvImpReplace(e.target.checked)} style={{ marginTop: 2 }} />
                <span><b>Thay thế toàn bộ</b> danh sách cũ (mặc định tắt = gộp theo MSDL, an toàn hơn). Bật khi muốn xoá hẳn những MSDL không còn trong file (TVV đã nghỉ).</span>
              </label>
              <button className="sr-save-btn" disabled={!tvvImpStaged || tvvImpSaving} onClick={confirmTvvImport}>
                {tvvImpSaving ? '⏳ Đang lưu...' : '💾 Xác nhận nhập danh sách TVV'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: đối chiếu Proposal ── */}
      {propOpen && (
        <div className="modal-overlay" onClick={() => setPropOpen(false)}>
          <div className="modal-box" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">🔗 Đối chiếu Proposal — Tháng {month}/{year}</div>
              <button className="modal-close" onClick={() => setPropOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {[['daily', '📊 Từ TVV Hàng Ngày'], ['file', '📂 Upload file Excel']].map(([s, lbl]) => (
                  <button key={s} onClick={() => { setPropSource(s); setPropResult(null); setPropStatus('') }}
                    style={{ flex: 1, padding: '8px', borderRadius: 9, border: '2px solid', fontWeight: 700, fontSize: 12.5, cursor: 'pointer',
                      borderColor: propSource === s ? '#4361ee' : '#e8ecf4',
                      background: propSource === s ? '#f0f4ff' : '#fff',
                      color: propSource === s ? '#4361ee' : '#5a6b87' }}>{lbl}</button>
                ))}
              </div>

              {propSource === 'daily' && (
                <div>
                  <label className="sr-form-label">📅 Chọn ngày có dữ liệu ({month}/{year})</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select className="sr-form-input" value={propSelDate}
                      onChange={(e) => { setPropSelDate(e.target.value); runDailyReconcile(e.target.value) }}>
                      {propDates.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <button style={btnStyle('#f0f4ff', '#4361ee')}
                      onClick={() => propSelDate && runDailyReconcile(propSelDate)}>Quét lại</button>
                  </div>
                  {!!propDates.length && (
                    <div style={{ fontSize: 11.5, color: '#8896aa', marginTop: 6 }}>
                      {propDates.length} ngày có dữ liệu trong tháng. Mặc định chọn ngày cuối cùng ({propDates[propDates.length - 1]}) vì dữ liệu tích lũy theo ngày càng đầy đủ hơn.
                    </div>
                  )}
                </div>
              )}

              {propSource === 'file' && (
                <div>
                  <div style={{ fontSize: 12, color: '#5a6b87', lineHeight: 1.6 }}>
                    File cần có sheet <b>Proposal</b> (hoặc Export) và/hoặc <b>Pipeline</b>, với cột AGCode, ProposalNum, Proposal Status, IP Sub (triệu), ProposalDate (YYYYMMDD).
                  </div>
                  <label className="sr-form-label">📂 Chọn file Excel (.xlsx / .xls)</label>
                  <input type="file" ref={propFileRef} accept=".xlsx,.xls" className="sr-form-input"
                    onChange={(e) => { handleProposalFileSelect(e.target.files?.[0]); if (propFileRef.current) propFileRef.current.value = '' }} />
                  <label className="sr-form-label">📅 Ngày áp dụng cho hồ sơ chưa có ProposalDate</label>
                  <input type="date" className="sr-form-input" value={propFileDate}
                    onChange={(e) => setPropFileDate(e.target.value)} />
                </div>
              )}

              {propStatus && <div style={{ fontSize: 12, marginTop: 10, color: propStatusColor }}>{propStatus}</div>}

              {propResult && (
                <div>
                  {!!propResult.statusActions.length && (
                    <div className="sr-recon-box" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
                      <div className="sr-recon-title" style={{ color: '#15803d' }}>✅ Cập nhật trạng thái ({propResult.statusActions.length})</div>
                      <div className="sr-recon-list" style={{ maxHeight: 100 }}>
                        {propResult.statusActions.slice(0, 80).map((a, i) => (
                          <div key={i}>
                            <b>{a.person.name}</b> <span style={{ color: '#8896aa' }}>· ngày {a.d}</span> · {a.note || '—'}
                            {a.policyNum && <> · số HĐ {a.policyNum}</>} →{' '}
                            <b>{a.action === 'fee' ? 'Phí → 0 (huỷ)' : a.action === 'policyNum' ? '+ Số HĐ' : a.after === 'issued' ? 'Phát hành (PH)' : 'Có phí chưa PH (CP)'}</b>
                          </div>
                        ))}
                        {propResult.statusActions.length > 80 && <div>… và {propResult.statusActions.length - 80} mục nữa</div>}
                      </div>
                    </div>
                  )}
                  {!!propResult.addActions.length && (
                    <div className="sr-recon-box" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
                      <div className="sr-recon-title" style={{ color: '#1d4ed8' }}>➕ Thêm mới vào Sales Report ({propResult.addActions.length})</div>
                      <div className="sr-recon-list" style={{ maxHeight: 100 }}>
                        {propResult.addActions.slice(0, 80).map((a, i) => (
                          <div key={i}>
                            <b>{a.agName}</b> <span style={{ color: '#8896aa' }}>({a.msdl})</span> · ngày {dayFromProposalDate(a.proposalDate, propFallback)} · {a.note || '—'} · {a.fee ? a.fee.toLocaleString('vi-VN') + ' đ' : '0 đ'} ·{' '}
                            <b>{a.status === 'issued' ? 'Phát hành (PH)' : a.status === 'paid' ? 'Có phí chưa PH (CP)' : 'CF'}</b>
                          </div>
                        ))}
                        {propResult.addActions.length > 80 && <div>… và {propResult.addActions.length - 80} mục nữa</div>}
                      </div>
                    </div>
                  )}
                  {!!propResult.fixActions.length && (
                    <div className="sr-recon-box" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
                      <div className="sr-recon-title" style={{ color: '#b45309' }}>🔀 Sai người → chuyển đúng người ({propResult.fixActions.length})</div>
                      <div className="sr-recon-list" style={{ maxHeight: 100 }}>
                        {propResult.fixActions.slice(0, 80).map((a, i) => (
                          <div key={i}>
                            <span style={{ textDecoration: 'line-through' }}>{a.wrongPerson.name} ({a.wrongPerson.msdl})</span> → <b>{a.agName} ({a.msdl})</b> · giữ ngày {a.wrongD} · {a.note || '—'} · {a.fee ? a.fee.toLocaleString('vi-VN') + ' đ' : '0 đ'}
                          </div>
                        ))}
                        {propResult.fixActions.length > 80 && <div>… và {propResult.fixActions.length - 80} mục nữa</div>}
                      </div>
                    </div>
                  )}
                  {!!propResult.feeActions.length && (
                    <div className="sr-recon-box" style={{ background: '#fdf4ff', borderColor: '#f0abfc' }}>
                      <div className="sr-recon-title" style={{ color: '#a21caf' }}>💰 Lệch phí — cập nhật theo IP Sub ({propResult.feeActions.length})</div>
                      <div className="sr-recon-list" style={{ maxHeight: 100 }}>
                        {propResult.feeActions.slice(0, 80).map((a, i) => (
                          <div key={i}>
                            <b>{a.person.name}</b> <span style={{ color: '#8896aa' }}>· ngày {a.d}{a.fromPipeline ? ' (Pipeline)' : ''}</span> · {a.note || '—'} · {a.before.toLocaleString('vi-VN')} đ → <b>{a.after.toLocaleString('vi-VN')} đ</b>
                          </div>
                        ))}
                        {propResult.feeActions.length > 80 && <div>… và {propResult.feeActions.length - 80} mục nữa</div>}
                      </div>
                    </div>
                  )}
                  {!!propResult.pipelineActions.length && (
                    <div className="sr-recon-box" style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
                      <div className="sr-recon-title" style={{ color: '#b91c1c' }}>🧲 Thêm từ Pipeline (CF) ({propResult.pipelineActions.length})</div>
                      <div className="sr-recon-list" style={{ maxHeight: 100 }}>
                        {propResult.pipelineActions.slice(0, 80).map((a, i) => (
                          <div key={i}>
                            <b>{a.agName}</b> <span style={{ color: '#8896aa' }}>({a.msdl})</span> · ngày {dayFromProposalDate(a.proposalDate, propFallback)} · {a.note || '—'} · CF
                          </div>
                        ))}
                        {propResult.pipelineActions.length > 80 && <div>… và {propResult.pipelineActions.length - 80} mục nữa</div>}
                      </div>
                    </div>
                  )}
                  {!!propResult.unmatched.length && (
                    <div className="sr-recon-box" style={{ background: '#fff7ed', borderColor: '#fed7aa' }}>
                      <div className="sr-recon-title" style={{ color: '#c2410c' }}>⚠️ Chưa phát hành, không có trong Proposal ({propResult.unmatched.length}) — chỉ cảnh báo</div>
                      <div className="sr-recon-list" style={{ maxHeight: 100 }}>
                        {propResult.unmatched.slice(0, 100).map((u, i) => (
                          <div key={i}>
                            <b>{u.person.name}</b> <span style={{ color: '#8896aa' }}>· ngày {u.d}</span> · {u.note} · {STATUS_LBL[u.status] || u.status}
                          </div>
                        ))}
                        {propResult.unmatched.length > 100 && <div>… và {propResult.unmatched.length - 100} mục nữa</div>}
                      </div>
                    </div>
                  )}
                  {!propTotalActions && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, fontSize: 12, color: '#15803d', marginTop: 10 }}>
                      ✓ Sales Report đã khớp hết với Proposal/Pipeline — không có thay đổi nào cần áp dụng.
                    </div>
                  )}
                  <button className="sr-save-btn" disabled={!propTotalActions || propApplying} onClick={confirmProposalImport}>
                    {propApplying ? '⏳ Đang áp dụng...' : `✅ Áp dụng ${propTotalActions} thay đổi`}
                  </button>
                  <div style={{ fontSize: 11, color: '#8896aa', marginTop: 8 }}>
                    Quy tắc đối chiếu: IF → Phát hành (PH); PS → Có phí chưa PH (CP); DC/WD/CF/PO → đưa phí về 0.
                    Proposal ở đúng người nhưng lệch IP Sub → cập nhật phí theo file. Proposal không có trong Sales Report → thêm mới.
                    Pipeline (chưa có ở đâu) → thêm dạng CF (Chưa phí). Sai người đứng tên → chuyển sang TVV đúng theo Proposal.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: lịch sử thao tác ── */}
      {auditOpen && (
        <div className="modal-overlay" onClick={() => setAuditOpen(false)}>
          <div className="modal-box" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">🕘 Lịch sử thao tác — Tháng {month}/{year}</div>
              <button className="modal-close" onClick={() => setAuditOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              {auditLoading && <div style={{ fontSize: 12, color: '#8896aa' }}>Đang tải...</div>}
              {!auditLoading && !!auditShown.length && auditShown.map((e, i) => (
                <div key={e._id || i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ fontSize: 16 }}>{ACTION_ICON[e.action] || '•'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5 }}>{e.detail || e.action}</div>
                    <div style={{ fontSize: 11, color: '#8896aa', marginTop: 1 }}>{e.user || ''} · {fmtAuditTime(e.at)}</div>
                  </div>
                </div>
              ))}
              {!auditLoading && !auditShown.length && (
                <div style={{ fontSize: 12, color: '#8896aa', padding: '12px 0' }}>
                  Chưa có thay đổi nào được ghi nhận trong tháng {month}/{year} (hoặc tài khoản Google chưa có quyền đọc collection audit_log).
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const SR_CSS = `
.sr-kpi-bar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.sr-kpi-chip{background:#fff;border-radius:10px;padding:8px 14px;min-width:110px;flex:1;box-shadow:0 2px 8px rgba(99,102,241,.10)}
.sr-kpi-lbl{font-size:10px;color:#8896aa;font-weight:600;text-transform:uppercase;letter-spacing:.4px}
.sr-kpi-val{font-size:19px;font-weight:800;line-height:1.2}
.sr-hint{font-size:11.5px;color:#8896aa;margin-bottom:10px}
.sr-table-wrap{overflow-x:auto;background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(99,102,241,.12)}
.sr-report-table{border-collapse:separate;border-spacing:0;font-size:11px;min-width:100%}
.sr-report-table th{background:#eef2ff;color:#5a6b87;font-size:9.5px;font-weight:700;padding:5px 3px;border-bottom:2px solid #e0e7ff;white-space:nowrap}
.sr-report-table td{padding:3px 2px;border-bottom:1px solid #f5f7ff;vertical-align:top}
.sr-report-table tbody tr:hover td:not(.sr-col-stt):not(.sr-col-grp):not(.sr-col-msdl):not(.sr-col-name){background:#fbfbff}
.sr-col-stt{position:sticky;left:0;z-index:5;background:#fff!important;width:32px;min-width:32px}
.sr-col-grp{position:sticky;left:32px;z-index:5;background:#fff!important;width:76px;min-width:76px}
.sr-col-msdl{position:sticky;left:108px;z-index:5;background:#fff!important;width:86px;min-width:86px}
.sr-col-name{position:sticky;left:194px;z-index:5;background:#fff!important;min-width:130px;box-shadow:2px 0 6px rgba(0,0,0,.05)}
.sr-col-total{background:#eff6ff!important;color:#1d4ed8;font-weight:800;text-align:center;white-space:nowrap}
.sr-col-nofee{background:#fff1f2!important;color:#be123c;font-weight:800;text-align:center;white-space:nowrap}
.sr-col-issued{background:#f0fdf4!important;color:#15803d;font-weight:800;text-align:center;white-space:nowrap}
.sr-col-paid{background:#fefce8!important;color:#a16207;font-weight:800;text-align:center;white-space:nowrap}
.sr-day-sun{background:#ffe4e6!important}
.sr-day-sat{background:#ffedd5!important}
.sr-editable-input{width:100%;border:none;background:transparent;font-size:11px;font-family:inherit;color:#1a1f36;padding:2px 3px;border-radius:4px}
.sr-editable-input:focus{outline:none;background:#f0f4ff;box-shadow:inset 0 0 0 1px #4361ee}
.sr-editable-input:disabled{color:inherit}
.sr-day-cell{min-width:70px;cursor:pointer}
.sr-case-card{border-radius:6px;padding:4px 4px 2px;margin-bottom:2px;position:relative;border:1.5px solid transparent}
.sr-case-card.none{background:#fee2e2}
.sr-case-card.paid{background:#fef9c3}
.sr-case-card.issued{background:#dcfce7}
.sr-case-card.aging{border:1.5px solid #fb923c}
.sr-case-card.aging::after{content:'⏰';position:absolute;top:1px;right:3px;font-size:9px;pointer-events:none}
.sr-case-card-top{display:flex;align-items:center;gap:2px}
.sr-case-fee-input{width:52px;border:none;background:transparent;font-weight:700;font-size:11px;text-align:right;padding:1px 2px;border-radius:3px;font-family:inherit}
.sr-case-fee-input:focus{outline:none;background:#fff;box-shadow:0 0 0 1px #4361ee}
.sr-case-fee-input:disabled{color:inherit}
.sr-case-pill-del{width:14px;height:14px;border:none;border-radius:4px;background:transparent;cursor:pointer;font-size:11px;line-height:1;display:none;align-items:center;justify-content:center;color:#b91c1c}
.sr-case-card:hover .sr-case-pill-del{display:inline-flex}
.sr-case-note-mark{position:absolute;top:0;left:0;width:0;height:0;border-top:8px solid #f59e0b;border-right:8px solid transparent;cursor:pointer;border-top-left-radius:5px}
.sr-case-note-line{font-size:8.5px;color:#92600a;background:#fef3c7;padding:1px 4px;border-radius:3px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:74px;cursor:pointer;text-align:left}
.sr-case-policy-line{font-size:8.5px;color:#15803d;background:#dcfce7;padding:1px 4px;border-radius:3px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:74px;text-align:left}
.sr-status-btns{display:flex;gap:2px;margin-top:2px}
.sr-status-btn{flex:1;padding:2px 0;font-size:9px;font-weight:700;border:none;border-radius:3px;cursor:pointer;color:#94a3b8;background:rgba(255,255,255,.55);font-family:inherit}
.sr-status-btn:disabled{cursor:default;opacity:.85}
.sr-status-btn.s-none.active{background:#ef4444;color:#fff}
.sr-status-btn.s-paid.active{background:#eab308;color:#fff}
.sr-status-btn.s-issued.active{background:#22c55e;color:#fff}
.sr-status-pill{padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;display:inline-block}
.sr-status-pill.cf{background:#fef2f2;color:#dc2626}
.sr-status-pill.cp{background:#fefce8;color:#a16207}
.sr-age-chip{padding:3px 8px;border-radius:20px;font-size:10.5px;font-weight:700;display:inline-block}
.sr-age-chip.ok{background:#f0fdf4;color:#16a34a}
.sr-age-chip.warn{background:#fef9c3;color:#a16207}
.sr-age-chip.hot{background:#fee2e2;color:#dc2626}
.sr-pending-filter-btn{padding:6px 12px;border-radius:20px;border:1.5px solid #e8ecf4;background:#fff;font-size:12px;font-weight:700;cursor:pointer;color:#5a6b87;font-family:inherit}
.sr-pending-filter-btn.active{background:#4361ee;color:#fff;border-color:#4361ee}
.sr-sort-th{cursor:pointer;user-select:none}
.sr-sort-th .sr-sort-arrow{font-size:10px;color:#94a3b8}
.sr-sort-th.active{color:#4361ee}
.sr-sort-th.active .sr-sort-arrow{color:#4361ee}
.sr-form-label{display:block;font-size:12px;font-weight:600;color:#5a6b87;margin:10px 0 5px}
.sr-form-input{width:100%;padding:9px 11px;border:1.5px solid #d7dce8;border-radius:9px;font-size:13px;background:#fff;color:#1a1f36;font-family:inherit}
.sr-form-input:focus{outline:none;border-color:#4361ee;box-shadow:0 0 0 3px rgba(67,97,238,.14)}
select.sr-form-input{padding:9px 11px}
.sr-save-btn{width:100%;padding:11px;background:#4361ee;color:#fff;border:none;border-radius:9px;font-size:13.5px;font-weight:700;cursor:pointer;margin-top:14px;font-family:inherit}
.sr-save-btn:disabled{background:#cbd5e1;cursor:not-allowed}
.sr-tvv-drop-list{position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1.5px solid #e8ecf4;border-radius:9px;box-shadow:0 10px 30px rgba(30,27,75,.15);z-index:30;max-height:220px;overflow-y:auto}
.sr-tvv-drop-item{padding:8px 10px;font-size:12.5px;cursor:pointer;border-bottom:1px solid #f5f7ff}
.sr-tvv-drop-item:hover{background:#f0f4ff}
.sr-tvv-drop-empty{padding:10px;font-size:12px;color:#8896aa}
.sr-tvv-selected{margin-top:8px;padding:8px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:12.5px;color:#065f46}
.sr-tvv-picker-list{max-height:300px;overflow-y:auto;border:1px solid #eef0f7;border-radius:9px}
.sr-recon-box{border:1px solid;border-radius:8px;padding:10px;margin-top:10px}
.sr-recon-title{font-weight:700;font-size:12.5px;margin-bottom:4px}
.sr-recon-list{font-size:11.5px;color:#334155;line-height:1.7;overflow-y:auto}
`
