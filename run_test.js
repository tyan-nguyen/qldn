const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

async function check() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_code'
  });

  const sql = `
    SELECT 
      v.id AS id_danh_muc_vat_tu,
      v.ma_vat_tu,
      v.ten_vat_tu,
      v.don_vi_tinh,
      lvt.ten_loai_vat_tu AS loai_vat_tu,
      COALESCE(SUM(c.so_luong), 0) AS tong_so_luong_xuat,
      COALESCE(SUM(c.thanh_tien) / NULLIF(SUM(c.so_luong), 0), COALESCE(AVG(NULLIF(c.don_gia, 0)), 0)) AS don_gia_trung_binh,
      COALESCE(SUM(c.thanh_tien), 0) AS tong_thanh_tien
    FROM (
      SELECT 
        pxct.id_danh_muc_vat_tu,
        COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) AS so_luong,
        COALESCE(pxct.don_gia, 0) AS don_gia,
        COALESCE(pxct.thanh_tien, (COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) * COALESCE(pxct.don_gia, 0))) AS thanh_tien
      FROM phieu_xuat_kho_chi_tiet pxct
      JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
      WHERE px.id_cong_trinh = 2
      UNION ALL
      SELECT 
        pmct.id_danh_muc_vat_tu,
        COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) AS so_luong,
        COALESCE(pmct.don_gia, 0) AS don_gia,
        COALESCE(pmct.thanh_tien, (COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) * COALESCE(pmct.don_gia, 0))) AS thanh_tien
      FROM phieu_mua_hang_chi_tiet pmct
      JOIN phieu_mua_hang pm ON pmct.id_phieu_mua_hang = pm.id
      WHERE pm.id_cong_trinh = 2
    ) c
    JOIN danh_muc_vat_tu v ON c.id_danh_muc_vat_tu = v.id
    LEFT JOIN danh_muc_loai_vat_tu lvt ON v.id_loai_vat_tu = lvt.id
    GROUP BY v.id, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh, lvt.ten_loai_vat_tu
    ORDER BY v.ten_vat_tu ASC
  `;

  const [rows] = await db.query(sql);
  console.log('Result for Project 2:', rows);
  await db.end();
}
check().catch(console.error);
