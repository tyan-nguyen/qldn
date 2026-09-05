const express = require('express');
const http = require('http');
const mysql = require('mysql2/promise');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const donHangRoutes = require('../routes/don_hang');

async function testCancelOrderRoute() {
  const app = express();
  app.use(express.json());
  app.use('/api/don-hang', donHangRoutes);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(5099, resolve));

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026'
  });

  console.log('--- TESTING CANCEL ORDER EXPRESS ROUTE ---');

  const secret = process.env.JWT_SECRET || 'secret';
  const token = jwt.sign(
    { id: 1, ten_dang_nhap: 'admin', ho_ten: 'Quản Trị Viên', vai_tro: 'Admin' },
    secret,
    { expiresIn: '1h' }
  );

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // Test 1: Empty reason
  const res1 = await fetch('http://localhost:5099/api/don-hang/999999/cancel', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ly_do_huy: '' })
  });
  const data1 = await res1.json();
  console.log('Test 1 (Empty reason):', res1.status, data1.message);
  console.assert(res1.status === 400, 'Expected 400');

  // Test 2: Non-existent order
  const res2 = await fetch('http://localhost:5099/api/don-hang/999999/cancel', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ly_do_huy: 'Lý do test' })
  });
  const data2 = await res2.json();
  console.log('Test 2 (Non-existent order):', res2.status, data2.message);
  console.assert(res2.status === 404, 'Expected 404');

  // Test 3: Order with active return slip
  const [khRows] = await connection.query('SELECT id FROM khach_hang LIMIT 1');
  const [lvkdRows] = await connection.query('SELECT id FROM linh_vuc_kinh_doanh LIMIT 1');
  const custId = khRows[0].id;
  const lvkdId = lvkdRows[0].id;

  const [dhRes] = await connection.query(
    `INSERT INTO don_hang (id_lvkd, ma_don_hang, id_khach_hang, trang_thai_don_hang, tong_tien, so_tien_da_thanh_toan, so_tien_con_lai, nguoi_tao)
     VALUES (?, 'TEST_RET_DH', ?, 'Ghi sổ', 200000, 200000, 0, 'admin')`,
    [lvkdId, custId]
  );
  const testOrderId = dhRes.insertId;

  // Insert active return slip
  const [retRes] = await connection.query(
    `INSERT INTO phieu_nhap_kho (ma_phieu, id_linh_vuc_kinh_doanh, loai_nhap_kho, id_don_hang, id_khach_hang, tong_tien, trang_thai_nhap, da_xoa, nguoi_tao)
     VALUES ('TEST_NK_RET_01', ?, 'tra_hang_ban', ?, ?, 50000, 'Đã nhập', 0, 'admin')`,
    [lvkdId, testOrderId, custId]
  );
  const testPnkId = retRes.insertId;

  const res3 = await fetch(`http://localhost:5099/api/don-hang/${testOrderId}/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ly_do_huy: 'Muốn hủy đơn' })
  });
  const data3 = await res3.json();
  console.log('Test 3 (Blocked by return slip):', res3.status, data3.message);
  console.assert(res3.status === 400, 'Expected 400');
  console.assert(data3.message.includes('TEST_NK_RET_01'), 'Should mention return slip code');

  // Delete return slip
  await connection.query('DELETE FROM phieu_nhap_kho WHERE id = ?', [testPnkId]);

  // Test 4: Successful cancel
  const res4 = await fetch(`http://localhost:5099/api/don-hang/${testOrderId}/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ly_do_huy: 'Khách hàng yêu cầu hủy đơn do thay đổi kế hoạch' })
  });
  const data4 = await res4.json();
  console.log('Test 4 (Successful cancel):', res4.status, data4.message);
  console.assert(res4.status === 200, 'Expected 200');

  // Test 5: Re-cancelling already cancelled order
  const res5 = await fetch(`http://localhost:5099/api/don-hang/${testOrderId}/cancel`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ly_do_huy: 'Hủy lại lần 2' })
  });
  const data5 = await res5.json();
  console.log('Test 5 (Re-cancelling error):', res5.status, data5.message);
  console.assert(res5.status === 400, 'Expected 400');

  // Clean up
  await connection.query('DELETE FROM don_hang WHERE id = ?', [testOrderId]);
  await connection.end();
  server.close();

  console.log('--- ALL EXPRESS ROUTE TESTS PASSED 100%! ---');
}

testCancelOrderRoute().catch(err => {
  console.error('Route Test Error:', err);
  process.exit(1);
});
