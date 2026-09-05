const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrateDanhMucLoaiPhieu() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026'
  });

  console.log('--- STARTING MIGRATION FOR danh_muc_loai_phieu ---');

  // 1. Check if do_dai_chuoi_so column exists
  const [cols] = await connection.query(`SHOW COLUMNS FROM danh_muc_loai_phieu LIKE 'do_dai_chuoi_so'`);
  if (cols.length === 0) {
    console.log('Adding column do_dai_chuoi_so to danh_muc_loai_phieu...');
    await connection.query(`
      ALTER TABLE danh_muc_loai_phieu 
      ADD COLUMN do_dai_chuoi_so INT NOT NULL DEFAULT 5 AFTER ma_loai_phieu
    `);
    console.log('Successfully added do_dai_chuoi_so column.');
  } else {
    console.log('Column do_dai_chuoi_so already exists.');
  }

  // 2. Ensure all standard voucher types exist
  const standardTypes = [
    ['DH', 'Đơn hàng bán (POS / Bán lẻ)', 'DH', 5, 'don_hang', 'Mã đơn hàng bán lẻ / POS', 1],
    ['XK', 'Phiếu xuất kho', 'XK', 5, 'phieu_xuat_kho', 'Phiếu xuất kho bán hàng / cấp công trình', 2],
    ['NK', 'Phiếu nhập kho', 'NK', 5, 'phieu_nhap_kho', 'Phiếu nhập kho mua hàng / trả lại', 3],
    ['PT', 'Phiếu thu tiền', 'PT', 5, 'phieu_thu_chi', 'Phiếu thu tiền sổ quỹ', 4],
    ['PC', 'Phiếu chi tiền', 'PC', 5, 'phieu_thu_chi', 'Phiếu chi tiền sổ quỹ', 5],
    ['MH', 'Phiếu mua hàng (PO)', 'MH', 5, 'phieu_mua_hang', 'Phiếu đặt mua hàng / vật tư', 6],
    ['TK', 'Phiếu trả lại kho', 'TK', 5, 'phieu_tra_lai_kho', 'Phiếu thu hồi / trả lại kho', 7],
    ['YCMH', 'Phiếu yêu cầu mua hàng', 'YCMH', 5, 'yeu_cau_mua_hang', 'Phiếu đề xuất mua sắm vật tư', 8],
    ['YCVT', 'Phiếu yêu cầu vật tư', 'YCVT', 5, 'yeu_cau_vat_tu', 'Phiếu yêu cầu cấp vật tư công trình', 9],
    ['CK', 'Phiếu chuyển kho nội bộ', 'CK', 5, 'phieu_chuyen_kho_noi_bo', 'Phiếu điều chuyển giữa 2 kho', 10],
    ['DC', 'Phiếu điều chuyển vật tư', 'DC', 5, 'phieu_dieu_chuyen_vat_tu', 'Phiếu điều chuyển vật tư công trình', 11],
    ['SD', 'Phiếu sử dụng vật tư', 'SD', 5, 'phieu_su_dung_vat_tu', 'Phiếu nghiệm thu vật tư đưa vào sử dụng', 12],
    ['HH', 'Phiếu hao hụt vật tư', 'HH', 5, 'phieu_hao_hut_vat_tu', 'Phiếu báo cáo hao hụt, hư hỏng', 13],
    ['DNTT', 'Phiếu đề nghị thanh toán', 'DNTT', 5, 'de_nghi_thanh_toan', 'Phiếu đề nghị thanh toán công nợ/chi phí', 14],
    ['HD', 'Hợp đồng kinh tế', 'HD', 5, 'hop_dong', 'Hợp đồng thi công / thương mại', 15],
    ['KK', 'Phiếu kiểm kê kho', 'KK', 5, 'kiem_ke_kho', 'Phiếu kiểm kê kho hàng định kỳ', 16]
  ];

  for (const [sysCode, name, prefix, digits, table, note, order] of standardTypes) {
    const [exist] = await connection.query(`SELECT id FROM danh_muc_loai_phieu WHERE ma_he_thong = ?`, [sysCode]);
    if (exist.length === 0) {
      await connection.query(
        `INSERT INTO danh_muc_loai_phieu (ma_he_thong, ten_loai_phieu, ma_loai_phieu, do_dai_chuoi_so, bang_du_lieu, mo_ta, thu_tu)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sysCode, name, prefix, digits, table, note, order]
      );
      console.log(`Inserted standard voucher type: ${sysCode} - ${name}`);
    } else {
      // If do_dai_chuoi_so is null or 0, update to default 5
      await connection.query(
        `UPDATE danh_muc_loai_phieu SET do_dai_chuoi_so = COALESCE(NULLIF(do_dai_chuoi_so, 0), 5) WHERE id = ?`,
        [exist[0].id]
      );
    }
  }

  const [all] = await connection.query(`SELECT id, ma_he_thong, ma_loai_phieu, do_dai_chuoi_so, ten_loai_phieu FROM danh_muc_loai_phieu ORDER BY thu_tu ASC`);
  console.log('Current danh_muc_loai_phieu rows:');
  console.table(all);

  await connection.end();
  console.log('--- MIGRATION COMPLETED SUCCESSFULLY ---');
}

migrateDanhMucLoaiPhieu().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
