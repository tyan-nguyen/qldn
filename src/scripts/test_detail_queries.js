const mysql = require('mysql2/promise');
require('dotenv').config();

async function testAllTransferAndAuditQueries() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026',
    waitForConnections: true,
    connectionLimit: 5
  });

  console.log('--- TESTING ALL DETAIL & PRINT QUERIES ---');

  // Test 1: phieu_chuyen_kho detail item query
  const [transferItems] = await pool.query(
    `SELECT dt.*,
            v.ma_vat_tu, v.ten_vat_tu,
            lvt.ten_loai_vat_tu
     FROM phieu_chuyen_kho_chi_tiet dt
     LEFT JOIN danh_muc_vat_tu v ON dt.id_danh_muc_vat_tu = v.id
     LEFT JOIN danh_muc_loai_vat_tu lvt ON v.id_loai_vat_tu = lvt.id
     WHERE dt.id_phieu_chuyen = 1
     ORDER BY dt.id ASC`
  );
  console.log('Test 1 (phieu_chuyen_kho detail query): PASS! Rows =', transferItems.length);

  // Test 2: kiem_ke_kho detail item query
  const [auditItems] = await pool.query(
    `SELECT dt.*,
            v.ma_vat_tu, v.ten_vat_tu,
            lvt.ten_loai_vat_tu
     FROM kiem_ke_kho_chi_tiet dt
     LEFT JOIN danh_muc_vat_tu v ON dt.id_danh_muc_vat_tu = v.id
     LEFT JOIN danh_muc_loai_vat_tu lvt ON v.id_loai_vat_tu = lvt.id
     WHERE dt.id_kiem_ke_kho = 1
     ORDER BY dt.id ASC`
  );
  console.log('Test 2 (kiem_ke_kho detail query): PASS! Rows =', auditItems.length);

  // Test 3: phieu_chuyen_kho print query
  const [printTransfer] = await pool.query(
    `SELECT pc.*,
            kn.ten_kho AS ten_kho_nguon, kn.dia_diem AS dia_chi_kho_nguon,
            kd.ten_kho AS ten_kho_dich, kd.dia_diem AS dia_chi_kho_dich,
            l.ten_lvkd, l.ma_lvkd
     FROM phieu_chuyen_kho_noi_bo pc
     LEFT JOIN kho_hang kn ON pc.id_kho_nguon = kn.id
     LEFT JOIN kho_hang kd ON pc.id_kho_dich = kd.id
     LEFT JOIN linh_vuc_kinh_doanh l ON pc.id_linh_vuc_kinh_doanh = l.id
     WHERE pc.id = 1`
  );
  console.log('Test 3 (phieu_chuyen_kho print header query): PASS! Rows =', printTransfer.length);

  // Test 4: kiem_ke_kho print query
  const [printAudit] = await pool.query(
    `SELECT kk.*,
            k.ten_kho, k.dia_diem AS dia_chi_kho, k.loai_kho,
            l.ten_lvkd, l.ma_lvkd
     FROM kiem_ke_kho kk
     LEFT JOIN kho_hang k ON kk.id_kho_hang = k.id
     LEFT JOIN linh_vuc_kinh_doanh l ON kk.id_linh_vuc_kinh_doanh = l.id
     WHERE kk.id = 1`
  );
  console.log('Test 4 (kiem_ke_kho print header query): PASS! Rows =', printAudit.length);

  await pool.end();
  console.log('--- ALL QUERIES VERIFIED SUCCESSFULLY ---');
}

testAllTransferAndAuditQueries().catch(console.error);
