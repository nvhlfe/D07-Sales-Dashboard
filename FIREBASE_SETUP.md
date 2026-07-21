# Hướng Dẫn Cài Firebase Realtime Database

## Bước 1 — Tạo Firebase Project
1. Vào https://console.firebase.google.com
2. Click **"Add project"** → đặt tên (vd: `d07-sale-dashboard`) → Continue → Create project

## Bước 2 — Bật Realtime Database
1. Sidebar trái → **Build → Realtime Database**
2. Click **"Create Database"**
3. Chọn region: **asia-southeast1 (Singapore)**
4. Chọn **"Start in test mode"** (cho phép đọc/ghi tự do 30 ngày) → Enable

## Bước 3 — Lấy Firebase Config
1. Project Settings (⚙️ góc trái) → **General**
2. Cuộn xuống **"Your apps"** → Click **"</>"** (Web app)
3. Đặt tên app → Register app
4. Copy đoạn config như sau:
```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "d07-sale-dashboard.firebaseapp.com",
  databaseURL: "https://d07-sale-dashboard-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "d07-sale-dashboard",
  storageBucket: "d07-sale-dashboard.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123:web:abc"
};
```

## Bước 4 — Điền config vào App.jsx
Mở file `src/App.jsx`, tìm đoạn `FIREBASE_CONFIG` ở đầu file và thay thế:
```js
const FIREBASE_CONFIG = {
  apiKey: "AIza...",          // ← điền vào đây
  authDomain: "...",
  databaseURL: "https://...", // ← quan trọng: phải có databaseURL
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
}
```

## Bước 5 — Build lại & Deploy
```bash
npm run build
```
Sau đó deploy lên Vercel như bình thường.

## Cách hoạt động Realtime
- **Upload Excel** → dữ liệu được đẩy lên Firebase
- **Tất cả browser** đang mở dashboard sẽ **tự động cập nhật** ngay lập tức
- Dot xanh 🟢 ở sidebar = đang kết nối Firebase thành công
- Hiển thị thời gian cập nhật gần nhất

## Security Rules (production mode)
Realtime Database → Rules → dán nội dung file `database.rules.json` (đã có sẵn trong repo):
```json
{
  "rules": {
    "ga_d07": {
      ".read": true,
      ".write": "auth != null"
    },
    "$other": {
      ".read": false,
      ".write": false
    }
  }
}
```
Firestore (dùng cho Sales Report) → Rules → dán nội dung file `firestore.rules` (đã có sẵn trong repo), hoặc deploy trực tiếp bằng CLI:
```bash
firebase deploy --only firestore:rules,database
```
Rule ở trên yêu cầu đăng nhập (Firebase Auth) mới được ghi dữ liệu; ai cũng đọc được KPI công khai nhưng chỉ `admin@d07.com` (được tạo trong Authentication → Users) mới đăng nhập và upload/sửa dữ liệu.

## Deploy Vercel
1. Push code lên GitHub
2. vercel.com → Import repo → Deploy
3. Mỗi lần upload Excel mới → tất cả user thấy ngay
