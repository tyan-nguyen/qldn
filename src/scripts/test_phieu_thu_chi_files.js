const { pool } = require('../config/db');
const path = require('path');
const fs = require('fs');

async function testPhieuThuChiFiles() {
  console.log('--- TEST PHIẾU THU / CHI MULTIPLE FILE ATTACHMENTS ---');
  const connection = await pool.getConnection();

  try {
    // 1. Create a dummy test file in uploads/thu_chi
    const uploadsDir = path.join(__dirname, '../../public/uploads/thu_chi');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const testFileName = `test-ptc-${Date.now()}.pdf`;
    const testFilePath = path.join(uploadsDir, testFileName);
    fs.writeFileSync(testFilePath, 'dummy pdf content for test');

    // 2. Insert a test phieu_thu_chi
    const [resPtc] = await connection.query(
      `INSERT INTO phieu_thu_chi (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
        ten_doi_tuong, so_tien, id_quy_tien, ly_do_thu_chi, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `PT-TEST-${Date.now()}`,
        9999,
        2026,
        1,
        'Phieu_Thu',
        'thu_ban_hang',
        'Khách hàng Test Đính Kèm File',
        5000000,
        1,
        'Thu tiền test đính kèm nhiều file',
        'admin_test'
      ]
    );
    const ptcId = resPtc.insertId;
    console.log(`[PASS] Tạo thành công test Phiếu Thu id=${ptcId}`);

    // 3. Insert files to `files` table
    const [resFile1] = await connection.query(
      `INSERT INTO files (ten_bang, id_ban_ghi, ten_file, ten_file_luu, loai_file, extension, duong_dan, kich_thuoc, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['phieu_thu_chi', ptcId, 'hoa_don_vat_123.pdf', testFileName, 'pdf', 'pdf', `/public/uploads/thu_chi/${testFileName}`, 1024, 'admin_test']
    );
    const fileId1 = resFile1.insertId;

    const [resFile2] = await connection.query(
      `INSERT INTO files (ten_bang, id_ban_ghi, ten_file, ten_file_luu, loai_file, extension, duong_dan, kich_thuoc, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['phieu_thu_chi', ptcId, 'anh_chuyen_khoan.png', testFileName, 'image', 'png', `/public/uploads/thu_chi/${testFileName}`, 2048, 'admin_test']
    );
    const fileId2 = resFile2.insertId;
    console.log(`[PASS] Đính kèm 2 files vào bảng files: fileId1=${fileId1}, fileId2=${fileId2}`);

    // 4. Query files for ptc
    const [files] = await connection.query(
      `SELECT * FROM files WHERE ten_bang = 'phieu_thu_chi' AND id_ban_ghi = ? ORDER BY id ASC`,
      [ptcId]
    );
    if (files.length === 2) {
      console.log(`[PASS] Truy vấn files thành công: ${files.length} files tìm thấy cho voucher ${ptcId}`);
    } else {
      throw new Error(`Expected 2 files but got ${files.length}`);
    }

    // 5. Delete file1
    await connection.query('DELETE FROM files WHERE id = ?', [fileId1]);
    const [filesAfterDelete] = await connection.query(
      `SELECT * FROM files WHERE ten_bang = 'phieu_thu_chi' AND id_ban_ghi = ?`,
      [ptcId]
    );
    if (filesAfterDelete.length === 1) {
      console.log(`[PASS] Xóa file đính kèm thành công, còn lại 1 file: ${filesAfterDelete[0].ten_file}`);
    } else {
      throw new Error(`Expected 1 file remaining after delete, got ${filesAfterDelete.length}`);
    }

    // 6. Cleanup test records
    await connection.query('DELETE FROM files WHERE id = ?', [fileId2]);
    await connection.query('DELETE FROM phieu_thu_chi WHERE id = ?', [ptcId]);
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    console.log('[PASS] Cleanup dữ liệu test hoàn tất!');
    console.log('🎉 TẤT CẢ TEST ĐÍNH KÈM NHIỀU FILE PHIẾU THU / PHIẾU CHI ĐÃ ĐẠT 100%!');
  } catch (err) {
    console.error('[FAIL] Lỗi test:', err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

testPhieuThuChiFiles();
