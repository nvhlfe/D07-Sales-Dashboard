# Data Layer dùng chung — D07 Sales Dashboard

Ngày: 09/10/2026 · Người thực hiện: Muse (theo yêu cầu của Lan)

## Đợt 1 — Data layer (đã xong, build pass)

**1. Mới: `src/lib/db.js` — data layer tập trung (single source of truth)**
- `initFirebase()` / `getFirebase()`: khởi tạo Firebase ĐÚNG 1 lần (singleton),
  thay cho việc mỗi nơi tự init riêng.
- `useAuth()`: auth tập trung — `{ user, isAdmin, login, logout }`.
- `useDashboardDoc()` + `publishDashboardData()`: đọc/ghi doc tổng quan Excel
  (giữ nguyên cơ chế chunked RTDB `ga_d07/dashboard` để không gián đoạn production).
- Hooks Firestore dùng chung cho các tab migrate sau này:
  `useReportsDoc`, `saveReportsDoc`, `useDailySalesDoc`, `saveDailySalesDoc`,
  `usePendingCases`, `savePendingCases`, `useManMark`, `saveManMark`,
  `logAudit`, `getDocOnce`.
- `normalizeAgent()`: chuẩn hóa `agCode` → `msdl` tập trung 1 chỗ.
- Key helpers: `yyyyMKey(y,m)` → `"2026-8"`, `dateKey()` → `"2026-08-15"`.

**2. Refactor `src/App.jsx` dùng `db.js`** — behavior giữ nguyên 100%:
- Xóa toàn bộ Firebase init / onValue / auth inline, thay bằng hooks.
- Giữ nguyên: upload Excel, chunked sync, toast, drag-drop, postMessage bridge
  cho iframe (tạm thời, gỡ khi migrate tab xong).

**3. Fix bug key `reports` lệch:**
- `useReportsDoc(y, m)` đọc `reports/{yyyy-m}` trước, fallback `reports/{m}` cũ
  nếu chưa có → ManMark thấy được số liệu Sales Report ngay, không cần migrate data.
- `saveReportsDoc()` luôn ghi key mới có năm → dữ liệu mới không bao giờ lệch nữa.

## Cố tình CHƯA làm (để Lan quyết)

- **Chưa chuyển doc tổng quan từ RTDB sang Firestore**: doc Excel ~800KB,
  gần giới hạn 1MB/doc của Firestore → rủi ro. Về mặt code đã thống nhất qua
  `db.js`, vị trí vật lý có thể chuyển sau khi đo chính xác dung lượng.
- **Chưa migrate 4 tabs iframe sang React** — đó là bước tiếp theo, mỗi tab sẽ
  chỉ việc gọi hooks trong `db.js`.

## Đợt 2 — Migrate tabs sang React all-in-one (đã xong, build pass)

**Migrated (3 tabs, 3 workers song song):**
- `src/components/SalesReportTab.jsx` (ghi đè wrapper iframe Vercel) — **bỏ hẳn URL
  `https://d07-sales-report.vercel.app/`, chạy local 100%**. Chức năng: chọn tháng/năm,
  3 tabs (Report / Overview / Tổng hợp), form nhập/sửa số liệu tháng (thêm TVV, sửa
  nhóm/MSDL/tên inline, modal thêm hồ sơ theo ngày, đổi trạng thái, xóa có confirm),
  autosave debounce 500ms + nút Lưu (chỉ admin), `logAudit` đủ 8 action gốc,
  export Excel 2 mẫu, xem lịch sử audit. Dùng `useReportsDoc` + `saveReportsDoc` + `logAudit`.
- `src/components/ManMarkTab.jsx` (ghi đè wrapper iframe) — chọn tháng/năm, bảng cam
  kết tuần (CK/TĐ FYP/HS, chênh lệch, pending, dự báo), inline edit debounce qua
  `saveManMark` (chỉ admin), thực đạt 2 nguồn (Sales Report nhập tay / TVV Daily),
  dự báo 3 kịch bản, modal chi tiết TVV (recharts), xuất Excel. Dùng `useManMark` +
  `useReportsDoc` + `usePendingCases` + `normalizeAgent`.
- `src/components/TvvDailyTab.jsx` (ghi đè wrapper iframe) — chọn ngày + so sánh
  baseline, upload Daily Sales Excel trong tab (port nguyên logic parse 5 sheets
  Proposal/Export, Agent, Leader, Pending, Pipeline bằng `xlsx` có sẵn) →
  `saveDailySalesDoc`, 5 bảng + 8 thẻ KPI + delta, xuất Excel, modal xu hướng
  (recharts). Dùng `useDailySalesDoc` + `saveDailySalesDoc` + `normalizeAgent`.

**Đã xóa (theo yêu cầu Lan — chỉ xóa tab Pending):**
- `src/components/PendingTab.jsx`, `public/pending-cases.html`
- File html cũ đã được thay thế: `public/sales-report.html`, `public/manmark.html`,
  `public/tvv-daily.html`, `public/check-tvv-keys.html` (không còn reference nào)
- Giữ lại `public/tvv-profile.html` (được link từ SalesReportTab/TvvDailyTab mới)

**App.jsx — gỡ toàn bộ hạ tầng iframe:**
- Xóa `IFRAME_TABS`, state `visited`, khối render iframe, effect broadcast
  postMessage `d07-auth`, listener `d07-login`.
- Render trực tiếp 7 tabs trong `ErrorBoundary` như các tab React khác.
- `NAV_ITEMS` cuối: Tổng quan, GA, UM, TVV, Sales Report, ManMark, TVV Hàng Ngày.

**Kiểm chứng:** `npm run build` ✅ pass (vite 11.4s). Không thêm dependency mới
(recharts/xlsx đã có sẵn được tái dùng thay Chart.js CDN).

## Đợt 3 — TOP 60 ở Tổng Quan lấy từ Daily Sales (12/10/2026)

- Khi admin bấm **Lưu** file Daily Sales ở tab *TVV Hàng Ngày*, ngoài doc Firestore `daily_sales_tvv/{ngày}`,
  hệ thống ghi thêm snapshot gọn vào RTDB `ga_d07/daily_top/{yyyy-m}` (đọc công khai, ghi cần đăng nhập —
  khớp `database.rules.json`, **không cần sửa rules**). Chỉ ghi nếu ngày nhập ≥ ngày snapshot đang có.
- `src/lib/db.js`: thêm `buildDailyTopSnapshot`, `publishDailyTop`, `useDailyTopDoc`.
- `TvvDailyTab.jsx`: parse thêm `level, apeNet, netMp, actFyc, actCase, fypYtd, fycYtd`; gọi `publishDailyTop` sau khi lưu.
- `DashboardTab.jsx`: TOP 60 dùng Daily Sales khi có (tháng mới nhất / tháng chưa có trong Excel tháng);
  nút chọn nguồn 📡 Daily ⇄ 📑 Excel tháng; tháng chỉ có Daily thì 8 thẻ KPI lấy tổng từ Daily (không hiện % so tháng trước).
