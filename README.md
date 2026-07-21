# GA D07 Dashboard

## Deploy trên Vercel
1. Push code lên GitHub
2. Vào vercel.com → Import Project → chọn repo
3. Framework: Vite → Deploy

## Deploy trên Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # chọn dist/
npm run build
firebase deploy
```

## Cập nhật số liệu
- Click nút **"Cập nhật Excel"** ở topbar, hoặc kéo thả file vào màn hình
- Chọn file Data_Compensation_GA_D07.xlsx mới
- Dashboard tự động cập nhật tất cả tabs

## Cấu trúc Tabs
- **Tổng quan**: Dashboard chính với KPI, top đại lý, biểu đồ
- **GA**: Tổng hợp số liệu GA theo tháng, biểu đồ FYP/ACT/TLDTPTT
- **UM**: Danh sách UM-OFF, click dòng → popup chi tiết SUM
- **TVV**: Danh sách AG-PE, click dòng → popup chi tiết 121 AG
