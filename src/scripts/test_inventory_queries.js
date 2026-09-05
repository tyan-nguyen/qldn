const mysql = require('mysql2/promise');
require('dotenv').config();

async function testKiemKeQueries() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026',
    waitForConnections: true,
    connectionLimit: 5
  });

  console.log('--- TESTING QUERIES ---');

  // Test 1: kiem-ke list query
  const [list] = await pool.query(`
    SELECT kk.*,
           k.ten_kho, k.loai_kho,
           l.ten_lvkd, l.ma_lvkd,
           COALESCE((
             SELECT COUNT(*) FROM kiem_ke_kho_chi_tiet WHERE id_kiem_ke_kho = kk.id
           ), 0) AS tong_so_mat_hang,
           COALESCE((
             SELECT COUNT(*) FROM kiem_ke_kho_chi_tiet WHERE id_kiem_ke_kho = kk.id AND ABS(so_luong_chenh_lech) > 0.0001
           ), 0) AS so_mat_hang_lech
    FROM kiem_ke_kho kk
    LEFT JOIN kho_hang k ON kk.id_kho_hang = k.id
    LEFT JOIN linh_vuc_kinh_doanh l ON kk.id_linh_vuc_kinh_doanh = l.id
    WHERE COALESCE(kk.da_xoa, 0) = 0
    ORDER BY kk.id DESC
  `);
  console.log('Test 1 (kiem_ke_kho query): SUCCESS! Count =', list.length);

  // Test 2: snapshot stock query
  const [snapshot] = await pool.query(`
    SELECT v.id AS id_danh_muc_vat_tu,
            v.ma_vat_tu,
            v.ten_vat_tu,
            v.don_vi_tinh,
            v.don_gia_tieu_chuan,
            lvt.ten_loai_vat_tu,
            COALESCE(tk.so_luong_ton, 0) AS so_luong_so_sach
     FROM danh_muc_vat_tu v
     LEFT JOIN danh_muc_loai_vat_tu lvt ON v.id_loai_vat_tu = lvt.id
     LEFT JOIN ton_kho tk ON tk.id_danh_muc_vat_tu = v.id AND tk.id_kho_hang = 1
     WHERE COALESCE(v.da_xoa, 0) = 0
     ORDER BY v.ten_vat_tu ASC
     LIMIT 5
  `);
  console.log('Test 2 (snapshot query): SUCCESS! Sample items =', snapshot.length);

  // Test 3: phieu_chuyen_kho_noi_bo query
  const [transfers] = await pool.query(`
    SELECT pc.*,
           kn.ten_kho AS ten_kho_nguon,
           kd.ten_kho AS ten_kho_dich,
           l.ten_lvkd, l.ma_lvkd,
           COALESCE((
             SELECT COUNT(*) FROM phieu_chuyen_kho_chi_tiet WHERE id_phieu_chuyen = pc.id
           ), 0) AS tong_so_mat_hang,
           COALESCE((
             SELECT SUM(so_luong_chuyen) FROM phieu_chuyen_kho_chi_tiet WHERE id_phieu_chuyen = pc.id
           ), 0) AS tong_so_luong_chuyen
    FROM phieu_chuyen_kho_noi_bo pc
    LEFT JOIN kho_hang kn ON pc.id_kho_nguon = kn.id
    LEFT JOIN kho_hang kd ON pc.id_kho_dich = kd.id
    LEFT JOIN linh_vuc_kinh_doanh l ON pc.id_linh_vuc_kinh_doanh = l.id
    WHERE COALESCE(pc.da_xoa, 0) = 0
    ORDER BY pc.id DESC
  `);
  console.log('Test 3 (phieu_chuyen_kho query): SUCCESS! Count =', transfers.length);

  await pool.end();
}

testKiemKeQueries().catch(console.error);
