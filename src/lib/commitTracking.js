// ─────────────────────────────────────────────────────────────────
// 🎯 THEO DÕI CAM KẾT (ManMark) — logic thuần, test bằng node độc lập.
// Lan yêu cầu 17/11/2026: một màn hình riêng để theo dõi TVV nào CHƯA
// ĐẠT cam kết, TVV nào CẦN ĐẨY LÀ ĐẠT — thay vì chỉ có bảng tổng lớn.
//
// Chuẩn tính (ghi rõ trên UI):
//  - Cam kết tháng = monthTarget; nếu TVV chưa đặt cam kết tháng (0)
//    thì lấy tổng cam kết các tuần (Σ CK FYP tuần).
//  - ĐÃ ĐẠT: thực đạt tháng ≥ cam kết.
//  - CẦN ĐẨY LÀ ĐẠT: chưa đạt nhưng phần thiếu ≤ 25% cam kết, HOẶC
//    giá trị hồ sơ đang chờ (pending) đủ lấp phần thiếu.
//  - CHƯA ĐẠT: các trường hợp còn lại.
//  - CHƯA CÓ CAM KẾT: cam kết tháng và cam kết tuần đều 0.
//  - Nhịp cần/tuần = phần thiếu ÷ số tuần còn lại của tháng (tuần có
//    ngày kết thúc ≥ hôm nay); tháng đã qua → không tính nhịp.
// Đơn vị tiền: nghìn đồng (như ManMark).
// ─────────────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export const CAN_DAY_MAX_GAP_PCT = 25 // thiếu ≤ 25% cam kết → nhóm "cần đẩy là đạt"

/**
 * rows: mảng row từ buildRows của ManMarkTab
 *   { code, name, unit, monthTarget, monthActual, pending: {value, count},
 *     maxConsecutiveMiss, weeks: [{ckfyp}] }
 * weeks: [{start, end}] cấu hình tuần của tháng; todayDay: ngày hiện tại
 *   trong tháng đang xem (999 nếu là tháng đã qua, 1..31 nếu là tháng này).
 */
export function buildCommitTracking(rows, { weeks = [], todayDay = 999 } = {}) {
  const weeksLeft = (weeks || []).filter((w) => w.end >= todayDay).length
  const groups = { chuaDat: [], canDay: [], daDat: [], chuaCoCamKet: [] }

  ;(rows || []).forEach((r) => {
    const sumWeeklyCk = (r.weeks || []).reduce((s, w) => s + num(w?.ckfyp), 0)
    const camKet = num(r.monthTarget) > 0 ? num(r.monthTarget) : sumWeeklyCk
    const thucDat = num(r.monthActual)
    const pendingValue = num(r.pending?.value)
    const item = {
      code: r.code, name: r.name || '', unit: r.unit || '',
      camKet, thucDat,
      thieu: Math.max(0, camKet - thucDat),
      pctDat: camKet > 0 ? Math.round((thucDat / camKet) * 1000) / 10 : 0,
      pendingValue, pendingCount: num(r.pending?.count),
      maxConsecutiveMiss: num(r.maxConsecutiveMiss),
      forecast: num(r.forecast),
    }
    item.paceTuan = item.thieu > 0 && weeksLeft > 0 ? Math.round(item.thieu / weeksLeft) : null
    item.pendingDuLap = item.thieu > 0 && pendingValue >= item.thieu

    if (camKet <= 0) { groups.chuaCoCamKet.push(item); return }
    if (item.thieu <= 0) { groups.daDat.push(item); return }
    const gapPct = (item.thieu / camKet) * 100
    if (gapPct <= CAN_DAY_MAX_GAP_PCT || item.pendingDuLap) groups.canDay.push(item)
    else groups.chuaDat.push(item)
  })

  groups.canDay.sort((a, b) => a.thieu - b.thieu)
  groups.chuaDat.sort((a, b) => a.pctDat - b.pctDat || b.maxConsecutiveMiss - a.maxConsecutiveMiss)
  groups.daDat.sort((a, b) => b.pctDat - a.pctDat)
  groups.chuaCoCamKet.sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'))

  const sumThieu = (arr) => arr.reduce((s, x) => s + x.thieu, 0)
  return {
    ...groups,
    weeksLeft,
    stats: {
      total: (rows || []).length,
      chuaDat: groups.chuaDat.length, canDay: groups.canDay.length,
      daDat: groups.daDat.length, chuaCoCamKet: groups.chuaCoCamKet.length,
      thieuChuaDat: sumThieu(groups.chuaDat), thieuCanDay: sumThieu(groups.canDay),
    },
  }
}

// ─────────────────────────────────────────────────────────────────
// 📅 PHÂN TÍCH THEO TUẦN (Lan yêu cầu 17/11/2026: "phân tích hàng
// tuần cho chính xác") — chấm từng TVV theo CAM KẾT CỦA TUẦN được
// chọn, kèm lũy kế cam kết/thực đạt từ đầu tháng tới hết tuần đó để
// thấy ai đang bám cam kết, ai đang trễ lũy kế bao nhiêu.
//  - ĐẠT TUẦN: CK tuần > 0 và TĐ tuần ≥ CK tuần.
//  - CHƯA ĐẠT TUẦN: CK tuần > 0 và TĐ tuần < CK tuần.
//  - CHƯA CÓ CAM KẾT TUẦN: CK tuần = 0 (có thực đạt vẫn liệt kê riêng).
//  - weekState: 'qua' (đã kết thúc) | 'dang' (đang diễn ra) | 'toi'
//    (chưa tới), theo todayDay của tháng đang xem.
// ─────────────────────────────────────────────────────────────────
export function buildWeeklyTracking(rows, { weeks = [], weekIdx = 0, todayDay = 999 } = {}) {
  const w = (weeks || [])[weekIdx] || { start: 0, end: 0, label: '' }
  const weekState = todayDay > w.end ? 'qua' : todayDay >= w.start ? 'dang' : 'toi'
  const groups = { chuaDat: [], daDat: [], chuaCo: [] }

  ;(rows || []).forEach((r) => {
    const wks = r.weeks || []
    const ck = num(wks[weekIdx]?.ckfyp)
    const td = num(wks[weekIdx]?.tdfyp)
    let cumCk = 0, cumTd = 0
    for (let i = 0; i <= weekIdx && i < wks.length; i++) {
      cumCk += num(wks[i]?.ckfyp); cumTd += num(wks[i]?.tdfyp)
    }
    const item = {
      code: r.code, name: r.name || '', unit: r.unit || '',
      ckTuan: ck, tdTuan: td, lechTuan: td - ck,
      pctTuan: ck > 0 ? Math.round((td / ck) * 1000) / 10 : null,
      cumCk, cumTd, cumLech: cumTd - cumCk,
      maxConsecutiveMiss: num(r.maxConsecutiveMiss),
    }
    if (ck <= 0) { if (td > 0 || cumTd > 0) groups.chuaCo.push(item); return }
    if (td >= ck) groups.daDat.push(item)
    else groups.chuaDat.push(item)
  })

  groups.chuaDat.sort((a, b) => a.lechTuan - b.lechTuan)
  groups.daDat.sort((a, b) => (b.pctTuan || 0) - (a.pctTuan || 0))
  groups.chuaCo.sort((a, b) => b.tdTuan - a.tdTuan)

  return {
    ...groups, weekIdx, weekState, week: w,
    stats: {
      chuaDat: groups.chuaDat.length, daDat: groups.daDat.length, chuaCo: groups.chuaCo.length,
      tongHutTuan: groups.chuaDat.reduce((s, x) => s - x.lechTuan, 0),
    },
  }
}

/** Chỉ số tuần mặc định: tuần chứa hôm nay; tháng đã qua → tuần cuối. */
export function defaultWeekIdx(weeks, todayDay) {
  const ws = weeks || []
  if (!ws.length) return 0
  const i = ws.findIndex((w) => todayDay >= w.start && todayDay <= w.end)
  if (i >= 0) return i
  if (todayDay > ws[ws.length - 1].end) return ws.length - 1
  return 0
}

// ─────────────────────────────────────────────────────────────────
// 🔬 PHÂN TÍCH CAM KẾT (Lan yêu cầu 18/11/2026: các màn hình trước
// chỉ là danh sách số, "vẫn chưa phân tích được gì" và làm dashboard
// dài, khó xem). Hàm này rút ra KẾT LUẬN từ cùng dữ liệu ManMark:
//  1) Toàn GA: % đạt hiện tại + dự báo cuối tháng (theo dự báo sẵn
//     có của từng TVV) + số TVV dự báo trượt cam kết.
//  2) Phân rã nguyên nhân hụt của nhóm chưa đạt thành 3 kiểu, mỗi
//     kiểu một cách xử lý khác nhau:
//       - pendingDuLap: hồ sơ đang chờ đủ lấp phần thiếu → đẩy hồ sơ.
//       - dungYen: không pending và tuần qua không có thực đạt →
//         đang đứng yên, cần kích hoạt nộp mới.
//       - thieuNhip: còn lại → có hoạt động nhưng nhịp chưa đủ.
//     Kèm số người "khó về đích": tuần tốt nhất đã qua × số tuần còn
//     lại vẫn không lấp nổi phần thiếu.
//  3) Theo Unit: unit nào hụt nhiều nhất / đạt tốt nhất.
//  4) Tuần hiện tại so với tuần trước: số TVV đạt cam kết tuần và
//     tổng thực đạt tuần (tăng/giảm %).
//  5) Độ tập trung: 5 TVV hụt nhất chiếm bao nhiêu % tổng hụt.
// ─────────────────────────────────────────────────────────────────
export function analyzeCommitments(rows, { weeks = [], todayDay = 999 } = {}) {
  const ws = weeks || []
  const curIdx = defaultWeekIdx(ws, todayDay)
  const lastPassedIdx = (() => {
    let idx = -1
    ws.forEach((w, i) => { if (w.end < todayDay) idx = i })
    return idx >= 0 ? idx : curIdx
  })()
  const weeksLeft = ws.filter((w) => w.end >= todayDay).length

  let tongCamKet = 0, tongThucDat = 0, tongDuBao = 0, tongThieu = 0
  let soCoCamKet = 0, soDuBaoTruot = 0, soKhoVeDich = 0
  const buckets = {
    pendingDuLap: { count: 0, thieu: 0 },
    dungYen: { count: 0, thieu: 0 },
    thieuNhip: { count: 0, thieu: 0 },
  }
  const unitMap = new Map()
  const thieuList = []

  ;(rows || []).forEach((r) => {
    const wks = r.weeks || []
    const sumCk = wks.reduce((s, w) => s + num(w?.ckfyp), 0)
    const camKet = num(r.monthTarget) > 0 ? num(r.monthTarget) : sumCk
    const thucDat = num(r.monthActual)
    const duBao = num(r.forecast)
    const pendingValue = num(r.pending?.value)
    const unit = r.unit || '—'
    if (!unitMap.has(unit)) unitMap.set(unit, { unit, camKet: 0, thucDat: 0, thieu: 0, soTruot: 0, soNguoi: 0 })
    const u = unitMap.get(unit)
    u.soNguoi += 1
    if (camKet <= 0) return
    soCoCamKet += 1
    tongCamKet += camKet; tongThucDat += thucDat; tongDuBao += duBao
    u.camKet += camKet; u.thucDat += thucDat
    const thieu = Math.max(0, camKet - thucDat)
    if (thieu <= 0) return
    tongThieu += thieu
    u.thieu += thieu; u.soTruot += 1
    thieuList.push(thieu)
    if (duBao < camKet) soDuBaoTruot += 1
    // Phân rã nguyên nhân
    const tdLastPassed = num(wks[lastPassedIdx]?.tdfyp)
    if (pendingValue >= thieu) buckets.pendingDuLap.count += 1, buckets.pendingDuLap.thieu += thieu
    else if (pendingValue === 0 && tdLastPassed === 0) buckets.dungYen.count += 1, buckets.dungYen.thieu += thieu
    else buckets.thieuNhip.count += 1, buckets.thieuNhip.thieu += thieu
    // Khó về đích: nhịp tuần tốt nhất đã qua cũng không lấp nổi
    const passedTds = wks.slice(0, lastPassedIdx + 1).map((w) => num(w?.tdfyp))
    const bestWeek = passedTds.length ? Math.max(...passedTds) : 0
    if (weeksLeft > 0 && bestWeek * weeksLeft < thieu) soKhoVeDich += 1
  })

  const byUnit = [...unitMap.values()]
    .filter((u) => u.camKet > 0)
    .map((u) => ({ ...u, pctDat: u.camKet > 0 ? Math.round((u.thucDat / u.camKet) * 1000) / 10 : 0 }))
    .sort((a, b) => b.thieu - a.thieu)

  // Tuần hiện tại vs tuần trước
  const weekStat = (idx) => {
    let dat = 0, tongTd = 0
    ;(rows || []).forEach((r) => {
      const ck = num(r.weeks?.[idx]?.ckfyp), td = num(r.weeks?.[idx]?.tdfyp)
      tongTd += td
      if (ck > 0 && td >= ck) dat += 1
    })
    return { dat, tongTd }
  }
  const tuanNay = weekStat(curIdx)
  const tuanTruoc = curIdx > 0 ? weekStat(curIdx - 1) : null

  thieuList.sort((a, b) => b - a)
  const top5Thieu = thieuList.slice(0, 5).reduce((s, x) => s + x, 0)

  return {
    tongCamKet, tongThucDat, tongDuBao, tongThieu,
    pctDat: tongCamKet > 0 ? Math.round((tongThucDat / tongCamKet) * 1000) / 10 : 0,
    pctDuBao: tongCamKet > 0 ? Math.round((tongDuBao / tongCamKet) * 1000) / 10 : 0,
    soCoCamKet, soDuBaoTruot, soKhoVeDich, buckets, byUnit,
    tuanNay: { idx: curIdx, ...tuanNay },
    tuanTruoc: tuanTruoc ? { idx: curIdx - 1, ...tuanTruoc } : null,
    tapTrungTop5Pct: tongThieu > 0 ? Math.round((top5Thieu / tongThieu) * 1000) / 10 : 0,
    weeksLeft,
  }
}
