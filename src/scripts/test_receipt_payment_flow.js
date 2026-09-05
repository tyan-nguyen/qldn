const { pool } = require('../config/db');
const { generateSequenceNumber } = require('../services/sequenceService');

async function testReceiptPaymentFlow() {
  console.log('--- Testing Receipt (PT) & Payment (PC) Voucher Flow ---');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Generate PT Sequence
    const seqPT = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: 1,
      loai_chung_tu: 'PT',
      nam: 2026,
      ma_lvkd: 'VLXD'
    });
    console.log('Generated Sequence for PT:', seqPT);

    // 2. Generate PC Sequence
    const seqPC = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: 1,
      loai_chung_tu: 'PC',
      nam: 2026,
      ma_lvkd: 'VLXD'
    });
    console.log('Generated Sequence for PC:', seqPC);

    // 3. Insert a Receipt Voucher (PT)
    const [ptRes] = await conn.query(
      `INSERT INTO phieu_thu_chi (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
        ten_doi_tuong, id_quy_tien, hinh_thuc_thanh_toan, so_tien, ngay_chung_tu,
        ly_do_thu_chi, nguoi_tao
      ) VALUES (?, ?, 2026, 1, 'Phieu_Thu', 'thu_ban_hang', 'Khách hàng Test A', 1, 'Tien_Mat', 5000000, NOW(), 'Thu tiền bán hàng test', 'admin')`,
      [seqPT.ma_phieu, seqPT.so_vao_so]
    );
    console.log('Inserted PT ID:', ptRes.insertId);

    // 4. Insert a Payment Voucher (PC)
    const [pcRes] = await conn.query(
      `INSERT INTO phieu_thu_chi (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
        ten_doi_tuong, id_quy_tien, hinh_thuc_thanh_toan, so_tien, ngay_chung_tu,
        ly_do_thu_chi, nguoi_tao
      ) VALUES (?, ?, 2026, 1, 'Phieu_Chi', 'chi_mua_hang', 'Nhà cung cấp Test B', 1, 'Tien_Mat', 2000000, NOW(), 'Chi tiền mua vật tư test', 'admin')`,
      [seqPC.ma_phieu, seqPC.so_vao_so]
    );
    console.log('Inserted PC ID:', pcRes.insertId);

    // 5. Test summary query
    const [summaryRows] = await conn.query(`
      SELECT
        COALESCE(SUM(CASE WHEN loai_phieu = 'Phieu_Thu' THEN so_tien ELSE 0 END), 0) AS tong_thu,
        COALESCE(SUM(CASE WHEN loai_phieu = 'Phieu_Chi' THEN so_tien ELSE 0 END), 0) AS tong_chi
      FROM phieu_thu_chi
      WHERE da_xoa = 0
    `);
    console.log('Summary check:', summaryRows[0]);

    // Rollback test transaction
    await conn.rollback();
    console.log('Test completed and rolled back successfully!');
  } catch (err) {
    await conn.rollback();
    console.error('Test error:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

testReceiptPaymentFlow();
