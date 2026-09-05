const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env' });

async function testQuery() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_code'
  });

  const [projects] = await db.query('SELECT id, ten_cong_trinh FROM cong_trinh');

  for (const p of projects) {
    const [pos] = await db.query(`
      SELECT pmct.*, pm.ma_phieu_mua, pm.trang_thai_giao_hang, v.ma_vat_tu, v.ten_vat_tu, lvt.ten_loai_vat_tu
      FROM phieu_mua_hang_chi_tiet pmct
      JOIN phieu_mua_hang pm ON pmct.id_phieu_mua_hang = pm.id
      LEFT JOIN danh_muc_vat_tu v ON pmct.id_danh_muc_vat_tu = v.id
      LEFT JOIN danh_muc_loai_vat_tu lvt ON v.id_loai_vat_tu = lvt.id
      WHERE pm.id_cong_trinh = ?
    `, [p.id]);
    console.log(`Project ${p.id} (${p.ten_cong_trinh}) Site PO Items (${pos.length}):`, pos);
  }

  await db.end();
}
testQuery().catch(console.error);
