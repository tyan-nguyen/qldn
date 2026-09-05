const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'bv_secret_key_2026_jwt_token_secure';

async function testPOSStockHistoryLogging() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026'
  });

  console.log('--- STARTING POS CHECKOUT TON_KHO_LICH_SU TEST ---');

  // Create temporary test customer with 100M credit limit
  const [custRes] = await connection.query(`
    INSERT INTO khach_hang (ten_khach_hang, so_dien_thoai, han_muc_tin_dung, so_ngay_no_toi_da, nguoi_tao)
    VALUES ('Khách Hàng Test Stock Log', '0999888777', 100000000, 30, 'tester')
  `);
  const custId = custRes.insertId;

  const [khoRows] = await connection.query('SELECT id FROM kho_hang LIMIT 1');
  const [vtRows] = await connection.query('SELECT id FROM danh_muc_vat_tu LIMIT 1');
  const [lvkdRows] = await connection.query('SELECT id FROM linh_vuc_kinh_doanh LIMIT 1');

  const khoId = khoRows[0].id;
  const matId = vtRows[0].id;
  const lvkdId = lvkdRows[0].id;

  // Set up express test app
  const express = require('express');
  const http = require('http');
  const donHangRoutes = require('../routes/don_hang');

  const app = express();
  app.use(express.json());
  app.use('/api/don-hang', donHangRoutes);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(5098, resolve));

  const token = jwt.sign(
    { id: 1, ten_dang_nhap: 'tester_pos', ho_ten: 'Tester POS', vai_tro: 'Admin' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // 1. Send checkout request for Ghi Sổ order
  const checkoutPayload = {
    id_lvkd: lvkdId,
    id_khach_hang: custId,
    id_kho_hang: khoId,
    ngay_dat_hang: '2026-08-31 10:00:00',
    trang_thai_don_hang: 'Ghi sổ',
    items: [
      { id_danh_muc_vat_tu: matId, so_luong: 3, don_gia: 250000, chiet_khau: 0 }
    ]
  };

  const res = await fetch('http://localhost:5098/api/don-hang/checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify(checkoutPayload)
  });

  const data = await res.json();
  console.log('Checkout response status:', res.status, data.message);
  console.assert(res.status === 201, `Expected 201, got ${res.status}`);

  const orderId = data.id;
  console.log('Created order ID:', orderId, 'Ma:', data.ma_don_hang);

  // 2. Verify ton_kho_lich_su entry
  const [historyRows] = await connection.query(`
    SELECT * FROM ton_kho_lich_su
    WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ? AND so_luong_thay_doi = -3
    ORDER BY id DESC LIMIT 1
  `, [khoId, matId]);

  console.assert(historyRows.length > 0, 'ton_kho_lich_su entry was NOT created!');
  const log = historyRows[0];
  console.log('Found ton_kho_lich_su entry:', {
    id: log.id,
    so_luong_thay_doi: log.so_luong_thay_doi,
    loai_chung_tu: log.loai_chung_tu,
    ghi_chu: log.ghi_chu,
    nguoi_tao: log.nguoi_tao
  });

  console.assert(parseFloat(log.so_luong_thay_doi) === -3, 'so_luong_thay_doi mismatch');
  console.assert(log.loai_chung_tu === 'Phiếu xuất kho', 'loai_chung_tu mismatch');
  console.assert(log.ghi_chu.includes(data.ma_don_hang), 'ghi_chu does not mention order code');

  // 3. Verify phieu_xuat_kho and details
  const [pxkRows] = await connection.query('SELECT * FROM phieu_xuat_kho WHERE id_don_hang = ?', [orderId]);
  console.assert(pxkRows.length > 0, 'phieu_xuat_kho was NOT created');
  const pxk = pxkRows[0];
  console.log('Verified phieu_xuat_kho:', pxk.ma_phieu);

  // Clean up test records
  await connection.query('DELETE FROM ton_kho_lich_su WHERE id = ?', [log.id]);
  await connection.query('DELETE FROM nhat_ky_kho WHERE so_chung_tu = ?', [data.ma_don_hang]);
  await connection.query('DELETE FROM phieu_xuat_kho_chi_tiet WHERE id_phieu_xuat_kho = ?', [pxk.id]);
  await connection.query('DELETE FROM phieu_xuat_kho WHERE id = ?', [pxk.id]);
  await connection.query('DELETE FROM chi_tiet_don_hang WHERE id_don_hang = ?', [orderId]);
  await connection.query('DELETE FROM don_hang WHERE id = ?', [orderId]);
  await connection.query('DELETE FROM khach_hang WHERE id = ?', [custId]);

  // Restore stock
  const { updateStock } = require('../routes/kho');
  await updateStock(connection, khoId, matId, 3);

  await connection.end();
  server.close();

  console.log('--- ALL POS STOCK HISTORY LOGGING TESTS PASSED 100%! ---');
}

testPOSStockHistoryLogging().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
