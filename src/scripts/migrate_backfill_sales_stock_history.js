const mysql = require('mysql2/promise');
require('dotenv').config();

async function backfillSalesStockHistory() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026'
  });

  console.log('--- STARTING BACKFILL FOR SALES ORDERS INTO TON_KHO_LICH_SU ---');

  // Find all active sales export vouchers (phieu_xuat_kho ban_hang)
  const [pxkRows] = await connection.query(`
    SELECT pxk.id, pxk.ma_phieu, pxk.id_don_hang, pxk.id_kho_hang, pxk.thoi_gian_xuat, pxk.nguoi_tao, dh.ma_don_hang
    FROM phieu_xuat_kho pxk
    LEFT JOIN don_hang dh ON pxk.id_don_hang = dh.id
    WHERE pxk.loai_xuat_kho = 'ban_hang' AND COALESCE(pxk.da_xoa, 0) = 0
  `);

  console.log(`Found ${pxkRows.length} active sales export vouchers.`);

  let insertedCount = 0;

  for (const pxk of pxkRows) {
    const [details] = await connection.query(`
      SELECT dt.id_danh_muc_vat_tu, dt.so_luong_xuat
      FROM phieu_xuat_kho_chi_tiet dt
      WHERE dt.id_phieu_xuat_kho = ? AND COALESCE(dt.da_xoa, 0) = 0
    `, [pxk.id]);

    for (const dt of details) {
      const qty = parseFloat(dt.so_luong_xuat) || 0;
      if (qty <= 0) continue;

      // Check if ton_kho_lich_su already exists for this pxk and material
      const [existing] = await connection.query(`
        SELECT id FROM ton_kho_lich_su
        WHERE id_chung_tu = ? AND id_kho_hang = ? AND id_danh_muc_vat_tu = ? AND loai_chung_tu = 'Phiếu xuất kho'
      `, [pxk.id, pxk.id_kho_hang, dt.id_danh_muc_vat_tu]);

      if (existing.length === 0) {
        // Find id_ton_kho
        const [tkRows] = await connection.query(`
          SELECT id FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
        `, [pxk.id_kho_hang, dt.id_danh_muc_vat_tu]);
        const idTonKho = tkRows.length > 0 ? tkRows[0].id : null;

        const note = `Xuất kho bán hàng theo đơn ${pxk.ma_don_hang || ''} (${pxk.ma_phieu || ''})`;
        await connection.query(`
          INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao, thoi_gian_tao)
          VALUES (?, ?, ?, ?, ?, 'Phiếu xuất kho', ?, ?, ?)
        `, [idTonKho, pxk.id_kho_hang, dt.id_danh_muc_vat_tu, -qty, pxk.id, note, pxk.nguoi_tao || 'system', pxk.thoi_gian_xuat || new Date()]);

        insertedCount++;
      }
    }
  }

  console.log(`✓ Backfill complete: inserted ${insertedCount} missing records into ton_kho_lich_su.`);
  await connection.end();
}

backfillSalesStockHistory().catch(err => {
  console.error('Backfill error:', err);
  process.exit(1);
});
