HABAO 公告滿版金色 + 跑馬燈｜覆蓋包
日期：2026-10-13

完成內容
- 一般公告改為滿版金色漸層。
- 後台「一般公告」新增「啟用跑馬燈」。
- 跑馬燈 ON：文字由右往左循環。
- 跑馬燈 OFF：維持靜態文字。
- 保留目前 admin-benefits 的 x-admin-session / admin_sessions / 權限驗證架構。

部署順序
1. Supabase SQL Editor 執行 01_add_announcement_marquee.sql
2. Supabase > Edge Functions > admin-benefits
   用 admin-benefits.index.ts 整檔覆蓋後 Deploy
3. GitHub main
   用 admin.html 覆蓋原 admin.html
   用 home-v2.html 覆蓋原 home-v2.html
4. 後台 > 公告管理
   開啟「啟用一般公告」
   視需要開啟「啟用跑馬燈」
   儲存設定
5. 前台重新整理測試

安全說明
- 我已先在獨立 GitHub 分支製作，沒有直接改 main。
- admin.html 與 home-v2.html 的內嵌 JavaScript 已完成語法檢查。
