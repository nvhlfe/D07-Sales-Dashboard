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
