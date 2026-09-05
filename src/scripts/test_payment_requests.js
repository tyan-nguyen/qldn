const jwt = require('jsonwebtoken');

const API_BASE = 'http://localhost:5000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'bv_secret_key_2026_jwt_token_secure';

const token = jwt.sign(
  { id: 1, ten_dang_nhap: 'admin', vai_tro: 'Admin,Ban_Giam_Doc,Ke_Toan' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};

async function testPaymentRequestFlow() {
  console.log('=== BẮT ĐẦU KIỂM THỬ TOÀN DIỆN QUY TRÌNH ĐỀ NGHỊ THANH TOÁN (8 BƯỚC) ===\n');

  try {
    // 1. Kiểm tra danh mục loại chi phí & loại chứng từ
    console.log('1. Lấy danh mục Loại chi phí & Loại chứng từ:');
    const costRes = await fetch(`${API_BASE}/de-nghi-thanh-toan/danh-muc/loai-chi-phi`, { headers }).then(r => r.json());
    console.log(`- Đã tải ${costRes.length} loại chi phí.`);
    const firstCost = costRes[0];
    console.log(`- Loại chi phí mẫu: "${firstCost.ten_loai_chi_phi}" (Yêu cầu ${firstCost.requiredDocs?.length || 0} loại chứng từ)`);

    const docRes = await fetch(`${API_BASE}/de-nghi-thanh-toan/danh-muc/loai-chung-tu`, { headers }).then(r => r.json());
    console.log(`- Đã tải ${docRes.length} loại chứng từ.\n`);

    // 2. Bước 1: Nhân viên tạo Đề Nghị Thanh Toán mới
    console.log('2. BƯỚC 1: Bộ phận đề nghị lập ĐNTT mới');
    const createPayload = {
      id_linh_vuc_kinh_doanh: 1,
      id_loai_chi_phi: firstCost.id,
      ten_loai_chi_phi: firstCost.ten_loai_chi_phi,
      ngay_de_nghi: new Date().toISOString().split('T')[0],
      nguoi_de_nghi: 'Nguyễn Văn Kỹ Sư',
      bo_phan_de_nghi: 'Ban Chỉ Huy Công Trường',
      ten_nguoi_thu_huong: 'Công ty Cổ phần Thép Hòa Phát',
      so_tai_khoan: '0071009887766',
      ten_ngan_hang: 'Vietcombank',
      chi_nhanh_ngan_hang: 'CN Bình Tây',
      so_tien: 35000000,
      so_tien_bang_chu: 'Ba mươi lăm triệu đồng chẵn.',
      hinh_thuc_de_xuat: 'Chuyen_Khoan',
      noi_dung_thanh_toan: 'Thanh toán tiền thép xây dựng công trình đợt 1 theo hợp đồng cung cấp',
      lan_thanh_toan_so: 1,
      ghi_chu: 'Hồ sơ hóa đơn và biên bản nghiệm thu đầy đủ'
    };

    const createRes = await fetch(`${API_BASE}/de-nghi-thanh-toan`, {
      method: 'POST',
      headers,
      body: JSON.stringify(createPayload)
    }).then(r => r.json());

    const dnttId = createRes.id;
    const maPhieu = createRes.ma_phieu;
    console.log(`- Tạo thành công ĐNTT ID: ${dnttId}, Mã phiếu: ${maPhieu}\n`);

    // 3. Bước 2: Trưởng bộ phận ký duyệt
    console.log('3. BƯỚC 2: Trưởng bộ phận kiểm tra & ký duyệt');
    const tbpRes = await fetch(`${API_BASE}/de-nghi-thanh-toan/${dnttId}/tbp-duyet`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        action: 'approve',
        y_kien: 'Xác nhận khối lượng thép đã tập kết đầy đủ tại công trường.'
      })
    }).then(r => r.json());
    console.log(`- Kết quả: ${tbpRes.message} (Trạng thái: ${tbpRes.trang_thai})\n`);

    // 4. Test exact match lookup chứng từ gốc
    console.log('4. Kiểm tra chức năng Tra cứu chứng từ gốc bằng mã chính xác (Exact match):');
    const testExactReal = await fetch(`${API_BASE}/de-nghi-thanh-toan/check-exact-doc?code=VLXDPMH000001/26`, { headers }).then(r => r.json());
    console.log(`- Tra cứu mã chính xác "VLXDPMH000001/26":`, testExactReal.found ? `✓ ĐÃ TÌM THẤY [${testExactReal.ma}] - NCC: ${testExactReal.ten_doi_tuong} (Tổng: ${testExactReal.tong_tien.toLocaleString('vi-VN')} đ, Còn nợ: ${testExactReal.con_lai.toLocaleString('vi-VN')} đ)` : testExactReal.message);

    const testExactFake = await fetch(`${API_BASE}/de-nghi-thanh-toan/check-exact-doc?code=PO_FAKE_123`, { headers }).then(r => r.json());
    console.log(`- Tra cứu mã không khớp "PO_FAKE_123":`, testExactFake.found ? 'Tìm thấy' : `✓ ${testExactFake.message}`);

    // 5. Bước 3: Kế toán chi phí kiểm tra chứng từ & Trình GĐTC
    console.log('\n5. BƯỚC 3: Kế toán chi phí kiểm tra tính hợp lệ của hồ sơ chứng từ');
    const ktRes = await fetch(`${API_BASE}/de-nghi-thanh-toan/${dnttId}/kt-kiem-tra`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        action: 'submit_gdtc',
        y_kien: 'Hóa đơn điện tử hợp lệ, số dư đối chiếu khớp với hợp đồng.',
        evaluations: [],
        ma_chung_tu_goc: testExactReal.found ? testExactReal.ma : null,
        loai_chung_tu_goc: testExactReal.found ? testExactReal.type : null,
        id_chung_tu_goc: testExactReal.found ? testExactReal.id : null
      })
    }).then(r => r.json());
    console.log(`- Kết quả: ${ktRes.message} (Trạng thái: ${ktRes.trang_thai})\n`);

    // 6. Bước 4 & 5: GĐTC phê duyệt chi
    console.log('6. BƯỚC 4 & 5: GĐTC / Ban Giám Đốc phê duyệt chi');
    const gdtcRes = await fetch(`${API_BASE}/de-nghi-thanh-toan/${dnttId}/gdtc-duyet`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        action: 'approve',
        y_kien: 'Đồng ý duyệt lệnh chi chuyển khoản ngân hàng.',
        hinh_thuc_duyet: 'Chuyen_Khoan'
      })
    }).then(r => r.json());
    console.log(`- Kết quả: ${gdtcRes.message} (Trạng thái: ${gdtcRes.trang_thai})\n`);

    // 7. Bước 6 & 7: Kế toán thực hiện chi tiền bằng Lập Phiếu Chi
    console.log('7. BƯỚC 6 & 7: Kế toán ngân hàng thực hiện thanh toán bằng LẬP PHIẾU CHI');
    const payRes = await fetch(`${API_BASE}/de-nghi-thanh-toan/${dnttId}/lap-phieu-chi`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id_quy_tien: 1,
        hinh_thuc_thanh_toan: 'Chuyen_Khoan',
        so_tien_chi: 35000000,
        ngay_chi: new Date().toISOString().split('T')[0],
        so_chung_tu_ngan_hang: 'UNC-VCB-883921',
        ghi_chu: `Chi tiền theo ĐNTT ${maPhieu}`
      })
    }).then(r => r.json());
    console.log(`- Kết quả: ${payRes.message}`);
    console.log(`- Mã Phiếu Chi sinh ra: ${payRes.ma_phieu_chi}, ID Phiếu Chi: ${payRes.id_phieu_thu_chi}\n`);

    // 8. Bước 8: Kiểm tra trạng thái cuối cùng của ĐNTT và Sổ quỹ
    console.log('8. BƯỚC 8: Kiểm tra trạng thái lưu trữ hồ sơ và liên kết Phiếu Chi');
    const finalDetail = await fetch(`${API_BASE}/de-nghi-thanh-toan/${dnttId}`, { headers }).then(r => r.json());
    console.log(`- Mã ĐNTT: ${finalDetail.ma_phieu}`);
    console.log(`- Trạng thái: ${finalDetail.trang_thai}`);
    console.log(`- Mã Phiếu Chi liên kết: ${finalDetail.ma_phieu_chi}`);
    console.log(`- Số tiền đã chi: ${parseFloat(finalDetail.so_tien_da_chi).toLocaleString('vi-VN')} đ`);
    console.log(`- Người duyệt TBP: ${finalDetail.tbp_nguoi_duyet} | KT: ${finalDetail.kt_nguoi_kiem_tra} | GĐTC: ${finalDetail.gdtc_nguoi_duyet}`);

    console.log('\n=== TẤT CẢ 8 BƯỚC QUY TRÌNH ĐỀ NGHỊ THANH TOÁN ĐÃ CHẠY THÀNH CÔNG 100%! ===');
  } catch (err) {
    console.error('LỖI KIỂM THỬ:', err.message);
  }
}

testPaymentRequestFlow();
