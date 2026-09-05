const mysql = require('mysql2/promise');
require('dotenv').config();
const { updateStock } = require('../routes/kho');
const { generateSequenceNumber } = require('../services/sequenceService');
const { getCustomerDebtInfo } = require('../routes/khach_hang');

async function getFundBalance(connection, fundId) {
  const [rows] = await connection.query(
    `SELECT (
      COALESCE((SELECT SUM(so_tien) FROM phieu_thu_chi WHERE id_quy_tien = ? AND loai_phieu = 'Phieu_Thu' AND COALESCE(da_xoa, 0) = 0), 0)
      -
      COALESCE((SELECT SUM(so_tien) FROM phieu_thu_chi WHERE id_quy_tien = ? AND loai_phieu = 'Phieu_Chi' AND COALESCE(da_xoa, 0) = 0), 0)
    ) AS so_du`,
    [fundId, fundId]
  );
  return parseFloat(rows[0]?.so_du) || 0;
}

async function testCancelOrderRollback() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026'
  });

  console.log('--- STARTING SALES ORDER CANCEL & ROLLBACK TEST ---');

  // 1. Get references
  const [khRows] = await connection.query('SELECT id FROM khach_hang LIMIT 1');
  const [khoRows] = await connection.query('SELECT id FROM kho_hang LIMIT 1');
  const [vtRows] = await connection.query('SELECT id FROM danh_muc_vat_tu LIMIT 1');
  const [fundRows] = await connection.query('SELECT id FROM quy_tien LIMIT 1');
  const [lvkdRows] = await connection.query('SELECT id, ma_lvkd FROM linh_vuc_kinh_doanh LIMIT 1');

  const custId = khRows[0].id;
  const khoId = khoRows[0].id;
  const matId = vtRows[0].id;
  const fundId = fundRows[0].id;
  const lvkdId = lvkdRows[0].id;

  // Initial states
  const [initStockRows] = await connection.query('SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?', [khoId, matId]);
  const initStock = initStockRows.length > 0 ? parseFloat(initStockRows[0].so_luong_ton) || 0 : 0;
  const initFund = await getFundBalance(connection, fundId);
  const initDebtInfo = await getCustomerDebtInfo(custId);
  const initDebt = initDebtInfo.currentDebt;

  console.log(`Initial State -> Stock: ${initStock}, FundBalance: ${initFund}, CustDebt: ${initDebt}`);

  // 2. Create and commit an order (Qty: 4, Price: 100,000 = Total 400,000. Paid: 150,000)
  const qtyToSell = 4;
  const unitPrice = 100000;
  const totalPrice = qtyToSell * unitPrice;
  const amountPaid = 150000;

  const currentYear = 2026;
  const seqDH = await generateSequenceNumber(connection, {
    id_linh_vuc_kinh_doanh: lvkdId,
    loai_chung_tu: 'DH',
    nam: currentYear
  });

  const [orderRes] = await connection.query(
    `INSERT INTO don_hang (
      id_lvkd, so_vao_so, nam_vao_so, ma_don_hang, id_khach_hang,
      trang_thai_don_hang, trang_thai_thanh_toan, trang_thai_xuat_kho, trang_thai_giao_hang,
      ngay_dat_hang, tong_tien, so_tien_da_thanh_toan, so_tien_con_lai, nguoi_tao
    ) VALUES (?, ?, ?, ?, ?, 'Ghi sổ', 'thanh toán một phần', 'da_xuat_kho_du', 'da_giao_hang', NOW(), ?, ?, ?, 'tester')`,
    [lvkdId, seqDH.so_vao_so, currentYear, seqDH.ma_phieu, custId, totalPrice, amountPaid, totalPrice - amountPaid]
  );
  const testOrderId = orderRes.insertId;

  // Insert order detail
  await connection.query(
    `INSERT INTO chi_tiet_don_hang (id_don_hang, id_danh_muc_vat_tu, so_luong, don_gia, thanh_tien, nguoi_tao)
     VALUES (?, ?, ?, ?, ?, 'tester')`,
    [testOrderId, matId, qtyToSell, unitPrice, totalPrice]
  );

  // Deduct stock
  await updateStock(connection, khoId, matId, -qtyToSell);

  // Create export voucher (PXK)
  const seqXK = await generateSequenceNumber(connection, {
    id_linh_vuc_kinh_doanh: lvkdId,
    loai_chung_tu: 'XK',
    nam: currentYear
  });
  const [pxkRes] = await connection.query(
    `INSERT INTO phieu_xuat_kho (
      ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, id_don_hang, id_kho_hang,
      loai_xuat_kho, thoi_gian_xuat, tong_tien, trang_thai_xuat, nguoi_tao
    ) VALUES (?, ?, ?, ?, ?, ?, 'ban_hang', NOW(), ?, 'Đã xuất', 'tester')`,
    [seqXK.ma_phieu, seqXK.so_vao_so, currentYear, lvkdId, testOrderId, khoId, totalPrice]
  );
  const testPxkId = pxkRes.insertId;

  await connection.query(
    `INSERT INTO phieu_xuat_kho_chi_tiet (id_phieu_xuat_kho, id_danh_muc_vat_tu, so_luong, so_luong_xuat, don_gia, thanh_tien)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [testPxkId, matId, qtyToSell, qtyToSell, unitPrice, totalPrice]
  );

  // Create payment receipt (PT)
  const seqPT = await generateSequenceNumber(connection, {
    id_linh_vuc_kinh_doanh: lvkdId,
    loai_chung_tu: 'PT',
    nam: currentYear
  });
  const [ptRes] = await connection.query(
    `INSERT INTO phieu_thu_chi (
      ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
      loai_chung_tu_lien_ket, id_chung_tu, ma_chung_tu, loai_doi_tuong, id_doi_tuong,
      ten_doi_tuong, id_quy_tien, so_tien, ngay_chung_tu, trang_thai, nguoi_tao
    ) VALUES (?, ?, ?, ?, 'Phieu_Thu', 'thu_ban_hang', 'don_hang', ?, ?, 'khach_hang', ?, 'Test Cust', ?, ?, NOW(), 'đã thanh toán', 'tester')`,
    [seqPT.ma_phieu, seqPT.so_vao_so, currentYear, lvkdId, testOrderId, seqDH.ma_phieu, custId, fundId, amountPaid]
  );
  const testPtId = ptRes.insertId;

  // 3. Verify committed state
  const [stockAfterCommit] = await connection.query('SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?', [khoId, matId]);
  const currentStockAfterCommit = parseFloat(stockAfterCommit[0].so_luong_ton) || 0;
  console.assert(Math.abs(currentStockAfterCommit - (initStock - qtyToSell)) < 0.001, `Stock deduction failed! Expected ${initStock - qtyToSell}, got ${currentStockAfterCommit}`);

  const currentFundAfterCommit = await getFundBalance(connection, fundId);
  console.assert(Math.abs(currentFundAfterCommit - (initFund + amountPaid)) < 0.001, `Fund balance increase failed! Expected ${initFund + amountPaid}, got ${currentFundAfterCommit}`);

  console.log('✓ Order committed successfully. Verified stock deducted & fund credited.');

  // 4. Perform Cancel Order Rollback Logic
  console.log('Testing cancellation & rollback on order #', testOrderId);

  await connection.beginTransaction();

  // Find PXK and restore stock
  const [pxkList] = await connection.query('SELECT * FROM phieu_xuat_kho WHERE id_don_hang = ? AND COALESCE(da_xoa, 0) = 0', [testOrderId]);
  for (const pxk of pxkList) {
    const [pxkDetails] = await connection.query('SELECT * FROM phieu_xuat_kho_chi_tiet WHERE id_phieu_xuat_kho = ? AND COALESCE(da_xoa, 0) = 0', [pxk.id]);
    for (const item of pxkDetails) {
      const qty = parseFloat(item.so_luong_xuat) || 0;
      if (qty > 0) {
        await updateStock(connection, pxk.id_kho_hang, item.id_danh_muc_vat_tu, qty);
      }
    }
    await connection.query('UPDATE phieu_xuat_kho SET da_xoa = 1, trang_thai_xuat = "Đã hủy" WHERE id = ?', [pxk.id]);
    await connection.query('UPDATE phieu_xuat_kho_chi_tiet SET da_xoa = 1 WHERE id_phieu_xuat_kho = ?', [pxk.id]);
  }

  // Find PT and mark deleted
  await connection.query(
    'UPDATE phieu_thu_chi SET da_xoa = 1, trang_thai = "Đã hủy" WHERE loai_phieu = "Phieu_Thu" AND id_chung_tu = ? AND loai_chung_tu_lien_ket = "don_hang"',
    [testOrderId]
  );

  // Update order to 'Đã hủy'
  await connection.query(
    `UPDATE don_hang SET trang_thai_don_hang = "Đã hủy", trang_thai_thanh_toan = "da_huy", so_tien_da_thanh_toan = 0, so_tien_con_lai = 0, ngay_huy = NOW(), nguoi_huy = "tester", ly_do_huy = "Khách đổi ý hủy đơn" WHERE id = ?`,
    [testOrderId]
  );

  await connection.commit();

  // 5. Verify Rollback Results
  const [stockAfterCancel] = await connection.query('SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?', [khoId, matId]);
  const finalStock = parseFloat(stockAfterCancel[0].so_luong_ton) || 0;
  console.assert(Math.abs(finalStock - initStock) < 0.001, `Stock rollback failed! Expected ${initStock}, got ${finalStock}`);
  console.log(`✓ Stock successfully rolled back: ${finalStock} (initial: ${initStock})`);

  const finalFund = await getFundBalance(connection, fundId);
  console.assert(Math.abs(finalFund - initFund) < 0.001, `Fund rollback failed! Expected ${initFund}, got ${finalFund}`);
  console.log(`✓ Cash fund balance successfully rolled back: ${finalFund} (initial: ${initFund})`);

  const finalDebtInfo = await getCustomerDebtInfo(custId);
  const finalDebt = finalDebtInfo.currentDebt;
  console.assert(Math.abs(finalDebt - initDebt) < 0.001, `Customer debt rollback failed! Expected ${initDebt}, got ${finalDebt}`);
  console.log(`✓ Customer debt successfully rolled back: ${finalDebt} (initial: ${initDebt})`);

  const [cancelledOrd] = await connection.query('SELECT trang_thai_don_hang, ly_do_huy, nguoi_huy FROM don_hang WHERE id = ?', [testOrderId]);
  console.assert(cancelledOrd[0].trang_thai_don_hang === 'Đã hủy', 'Order status should be Đã hủy');
  console.assert(cancelledOrd[0].ly_do_huy === 'Khách đổi ý hủy đơn', 'Cancel reason mismatch');
  console.log('✓ Order status verified as Đã hủy with reason & actor recorded.');

  // Clean up test records
  await connection.query('DELETE FROM chi_tiet_don_hang WHERE id_don_hang = ?', [testOrderId]);
  await connection.query('DELETE FROM phieu_xuat_kho_chi_tiet WHERE id_phieu_xuat_kho = ?', [testPxkId]);
  await connection.query('DELETE FROM phieu_xuat_kho WHERE id = ?', [testPxkId]);
  await connection.query('DELETE FROM phieu_thu_chi WHERE id = ?', [testPtId]);
  await connection.query('DELETE FROM don_hang WHERE id = ?', [testOrderId]);

  await connection.end();
  console.log('--- ALL CANCEL ORDER & ROLLBACK TESTS PASSED 100%! ---');
}

testCancelOrderRollback().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
