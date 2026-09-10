const http = require('http');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'bv_secret_key_2026_jwt_token_secure';
const BASE_URL = 'http://localhost:5000';

function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(body); } catch(e) { parsed = body; }
        resolve({ status: res.statusCode, data: parsed, headers: res.headers });
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runSecurityTests() {
  console.log('====================================================');
  console.log('🛡️  BẮT ĐẦU CHẠY BỘ KIỂM THỬ BẢO MẬT HỆ THỐNG ERP');
  console.log('====================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
    }
  }

  // TEST SUITE 1: Chặn truy cập không có Token xác thực (Unauthenticated Access)
  console.log('--- TEST SUITE 1: Chặn đứng truy cập không có mã xác thực (401) ---');
  
  const testEndpoints = [
    { method: 'GET', path: '/api/phieu-mua-hang/' },
    { method: 'POST', path: '/api/phieu-mua-hang/', data: { test: 1 } },
    { method: 'GET', path: '/api/yeu-cau-mua-hang/thong-bao/count' },
    { method: 'PATCH', path: '/api/yeu-cau-mua-hang/1/duyet', data: { trang_thai: 'Đã duyệt' } },
    { method: 'GET', path: '/api/vat-tu-cong-trinh/yeu-cau' },
    { method: 'PUT', path: '/api/vat-tu-cong-trinh/yeu-cau/1/duyet', data: { ket_qua_duyet: 'Đã duyệt' } },
    { method: 'POST', path: '/api/vat-tu-cong-trinh-dau-ra/su-dung', data: { test: 1 } },
    { method: 'GET', path: '/api/dieu-chuyen-vat-tu/' },
    { method: 'GET', path: '/api/logs/latest' },
    { method: 'PUT', path: '/api/kho/phieu-xuat-kho/1/huy', data: { ly_do_huy: 'test' } }
  ];

  for (const ep of testEndpoints) {
    const res = await makeRequest(ep.method, ep.path, ep.data);
    assert(res.status === 401, `${ep.method} ${ep.path} -> Chặn với mã ${res.status} (Kỳ vọng 401)`);
  }

  // TEST SUITE 2: Chống lỗ hổng đăng ký tài khoản tự do (/register)
  console.log('\n--- TEST SUITE 2: Chống lỗ hổng đăng ký tài khoản tự do (/register) ---');
  const regRes = await makeRequest('POST', '/api/auth/register', {
    ten_dang_nhap: 'fake_admin_' + Date.now(),
    mat_khau: '123456',
    ho_ten: 'Fake Admin',
    vai_tro: 'Admin'
  });
  assert(regRes.status === 401 || regRes.status === 403, `POST /api/auth/register không có token -> Bị chặn với mã ${regRes.status} (Kỳ vọng 401/403)`);

  // Tạo các Token kiểm thử phân quyền RBAC
  const adminToken = jwt.sign(
    { id: 1, ten_dang_nhap: 'admin', vai_tro: 'Admin', ho_ten: 'Quản trị viên' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  const driverToken = jwt.sign(
    { id: 999, ten_dang_nhap: 'driver_test', vai_tro: 'Doi_Xe', ho_ten: 'Lái xe thử nghiệm' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // TEST SUITE 3: Phân quyền vai trò RBAC (Tài khoản quyền thấp thử gọi API nhạy cảm)
  console.log('\n--- TEST SUITE 3: Phân quyền vai trò (RBAC) - Chặn tài khoản quyền thấp can thiệp ---');

  // Lái xe thử duyệt yêu cầu mua hàng -> Phải bị 403
  const forbiddenRes1 = await makeRequest('PATCH', '/api/yeu-cau-mua-hang/1/duyet', { trang_thai: 'Đã duyệt' }, driverToken);
  assert(forbiddenRes1.status === 403, `Lái xe thử duyệt Yêu cầu mua hàng -> Bị chặn với mã ${forbiddenRes1.status} (Kỳ vọng 403 Forbidden)`);

  // Lái xe thử hủy phiếu xuất kho -> Phải bị 403
  const forbiddenRes2 = await makeRequest('PUT', '/api/kho/phieu-xuat-kho/1/huy', { ly_do_huy: 'hủy trái phép' }, driverToken);
  assert(forbiddenRes2.status === 403, `Lái xe thử hủy Phiếu xuất kho -> Bị chặn với mã ${forbiddenRes2.status} (Kỳ vọng 403 Forbidden)`);

  // Lái xe thử xem nhật ký logs hệ thống -> Phải bị 403
  const forbiddenRes3 = await makeRequest('GET', '/api/logs/latest', null, driverToken);
  assert(forbiddenRes3.status === 403, `Lái xe thử xem Nhật ký logs hệ thống -> Bị chặn với mã ${forbiddenRes3.status} (Kỳ vọng 403 Forbidden)`);

  // Lái xe thử duyệt Giám đốc tài chính -> Phải bị 403
  const forbiddenRes4 = await makeRequest('PUT', '/api/de-nghi-thanh-toan/1/gdtc-duyet', { action: 'approve' }, driverToken);
  assert(forbiddenRes4.status === 403, `Lái xe thử duyệt Giám đốc tài chính -> Bị chặn với mã ${forbiddenRes4.status} (Kỳ vọng 403 Forbidden)`);

  // Admin truy cập nhật ký logs -> Phải thành công (200)
  const adminLogRes = await makeRequest('GET', '/api/logs/latest', null, adminToken);
  assert(adminLogRes.status === 200, `Admin truy cập Nhật ký logs -> Thành công (Mã ${adminLogRes.status})`);

  // TEST SUITE 4: Kiểm tra đăng nhập với tài khoản có sẵn
  console.log('\n--- TEST SUITE 4: Đăng nhập hợp lệ và xác thực người dùng ---');
  const loginRes = await makeRequest('POST', '/api/auth/login', {
    ten_dang_nhap: 'director',
    mat_khau: 'director123'
  });
  assert(loginRes.status === 200 && loginRes.data.token, `Đăng nhập tài khoản Ban Giám Đốc ('director') -> Thành công (Token nhận được)`);

  console.log('\n====================================================');
  console.log(`🎯 TỔNG KẾT KIỂM THỬ: ${passedTests}/${totalTests} BÀI TEST ĐÃ VƯỢT QUA`);
  console.log('====================================================');

  if (passedTests === totalTests) {
    console.log('🎉 TOÀN BỘ CÁC CHỈ TIÊU BẢO MẬT ĐỀU ĐẠT CHUẨN AN TOÀN TUYỆT ĐỐI!');
  } else {
    console.error('⚠️ Có bài kiểm thử chưa đạt, vui lòng rà soát lại.');
  }

  process.exit(passedTests === totalTests ? 0 : 1);
}

runSecurityTests().catch(err => {
  console.error('Lỗi khi chạy bộ kiểm thử:', err);
  process.exit(1);
});
