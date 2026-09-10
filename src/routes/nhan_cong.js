const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');

// 1. Labor List (All roles can view)
const getLaborList = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM nhan_cong ORDER BY id DESC');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách nhân công.' });
  }
};
router.get('/', authMiddleware, getLaborList);
router.get('/ho-so', authMiddleware, getLaborList);

// 2. Create Labor (Kinh_Doanh, Ban_Giam_Doc) - sales handles loading crew
const createLabor = async (req, res) => {
  const { ho_ten, so_dien_thoai, so_cccd, don_gia_luong_ngay, ten_to_doi, hinh_anh, ghi_chu } = req.body;
  if (!ho_ten || !ho_ten.trim()) {
    return res.status(400).json({ message: 'Họ tên nhân công là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO nhan_cong (ho_ten, so_dien_thoai, so_cccd, don_gia_luong_ngay, ten_to_doi, hinh_anh, ghi_chu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ho_ten.trim(),
        so_dien_thoai ? so_dien_thoai.trim() : null,
        so_cccd && so_cccd.trim() ? so_cccd.trim() : null,
        don_gia_luong_ngay || 0,
        ten_to_doi ? ten_to_doi.trim() : null,
        hinh_anh || null,
        ghi_chu ? ghi_chu.trim() : null,
        req.user.ten_dang_nhap
      ]
    );

    const [newRow] = await connection.query('SELECT * FROM nhan_cong WHERE id = ?', [result.insertId]);
    await logChange(connection, 'nhan_cong', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi tạo hồ sơ nhân công.' });
  } finally {
    connection.release();
  }
};
router.post('/', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), createLabor);
router.post('/ho-so', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), createLabor);

// 2.1 Update Labor
const updateLabor = async (req, res) => {
  const { id } = req.params;
  const { ho_ten, so_dien_thoai, so_cccd, don_gia_luong_ngay, ten_to_doi, hinh_anh, ghi_chu } = req.body;

  if (!ho_ten || !ho_ten.trim()) {
    return res.status(400).json({ message: 'Họ tên nhân công là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT * FROM nhan_cong WHERE id = ?', [id]);
    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Không tìm thấy hồ sơ nhân công.' });
    }
    const oldRow = existing[0];

    await connection.query(
      `UPDATE nhan_cong 
       SET ho_ten = ?, so_dien_thoai = ?, so_cccd = ?, don_gia_luong_ngay = ?, ten_to_doi = ?, hinh_anh = ?, ghi_chu = ?
       WHERE id = ?`,
      [
        ho_ten.trim(),
        so_dien_thoai ? so_dien_thoai.trim() : null,
        so_cccd && so_cccd.trim() ? so_cccd.trim() : null,
        don_gia_luong_ngay !== undefined && don_gia_luong_ngay !== '' ? parseFloat(don_gia_luong_ngay) || 0 : 0,
        ten_to_doi ? ten_to_doi.trim() : null,
        hinh_anh || null,
        ghi_chu ? ghi_chu.trim() : null,
        id
      ]
    );

    const [newRow] = await connection.query('SELECT * FROM nhan_cong WHERE id = ?', [id]);
    await logChange(connection, 'nhan_cong', id, 'CAP_NHAT', oldRow, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({
      message: 'Cập nhật hồ sơ nhân công thành công.',
      data: newRow[0]
    });
  } catch (err) {
    await connection.rollback();
    console.error('Lỗi khi cập nhật hồ sơ nhân công:', err);
    return res.status(500).json({ message: 'Lỗi khi cập nhật hồ sơ nhân công.' });
  } finally {
    connection.release();
  }
};
router.put('/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), updateLabor);
router.put('/ho-so/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), updateLabor);

// 2.2 Delete Labor with relational constraint checks
const deleteLabor = async (req, res) => {
  const { id } = req.params;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT * FROM nhan_cong WHERE id = ?', [id]);
    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Không tìm thấy hồ sơ nhân công cần xóa.' });
    }
    const worker = existing[0];

    // Check related tables
    const relatedChecks = [];

    // 1. Chấm công hàng ngày
    try {
      const [[{ cnt: chamCongCnt }]] = await connection.query(
        'SELECT COUNT(*) as cnt FROM cham_cong_hang_ngay WHERE id_nhan_cong = ?', [id]
      );
      if (chamCongCnt > 0) relatedChecks.push(`${chamCongCnt} lượt chấm công hàng ngày`);
    } catch (e) {
      console.warn('Check cham_cong_hang_ngay error:', e.message);
    }

    // 2. Hợp đồng giao khoán công trình
    try {
      const [[{ cnt: hopDongCnt }]] = await connection.query(
        'SELECT COUNT(*) as cnt FROM hop_dong_nhan_cong WHERE id_nhan_cong = ?', [id]
      );
      if (hopDongCnt > 0) relatedChecks.push(`${hopDongCnt} hợp đồng giao khoán công trình`);
    } catch (e) {
      console.warn('Check hop_dong_nhan_cong error:', e.message);
    }

    // 3. Lương sản phẩm khoán
    try {
      const [[{ cnt: luongSpCnt }]] = await connection.query(
        'SELECT COUNT(*) as cnt FROM luong_san_pham WHERE id_nhan_cong = ?', [id]
      );
      if (luongSpCnt > 0) relatedChecks.push(`${luongSpCnt} bản ghi lương sản phẩm khoán`);
    } catch (e) {
      console.warn('Check luong_san_pham error:', e.message);
    }

    // 4. Tạm ứng nhân công
    try {
      const [[{ cnt: tamUngCnt }]] = await connection.query(
        'SELECT COUNT(*) as cnt FROM tam_ung_nhan_cong WHERE id_nhan_cong = ?', [id]
      );
      if (tamUngCnt > 0) relatedChecks.push(`${tamUngCnt} phiếu tạm ứng nhân công`);
    } catch (e) {
      console.warn('Check tam_ung_nhan_cong error:', e.message);
    }

    // 5. Phiếu chi lương
    try {
      const [[{ cnt: phieuLuongCnt }]] = await connection.query(
        'SELECT COUNT(*) as cnt FROM phieu_chi_luong WHERE id_nhan_cong = ?', [id]
      );
      if (phieuLuongCnt > 0) relatedChecks.push(`${phieuLuongCnt} phiếu chi lương kỳ`);
    } catch (e) {
      console.warn('Check phieu_chi_luong error:', e.message);
    }

    // 6. Nhật ký nhiên liệu xe (nếu làm tài xế)
    try {
      const [[{ cnt: nhienLieuCnt }]] = await connection.query(
        'SELECT COUNT(*) as cnt FROM nhat_ky_nhien_lieu WHERE id_nhan_cong = ?', [id]
      );
      if (nhienLieuCnt > 0) relatedChecks.push(`${nhienLieuCnt} nhật ký nhiên liệu lái xe`);
    } catch (e) {
      console.warn('Check nhat_ky_nhien_lieu error:', e.message);
    }

    // If any related data exists, abort deletion and return warning
    if (relatedChecks.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        message: `Không thể xóa nhân công "${worker.ho_ten}" do đã phát sinh dữ liệu liên quan:\n• ` + relatedChecks.join('\n• ') + '\n\nVui lòng kiểm tra và xử lý các dữ liệu liên quan trước khi xóa!',
        relatedDetails: relatedChecks
      });
    }

    // Proceed to delete
    await connection.query('DELETE FROM nhan_cong WHERE id = ?', [id]);
    await logChange(connection, 'nhan_cong', id, 'XOA', worker, null, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: `Đã xóa hồ sơ nhân công "${worker.ho_ten}" thành công.` });
  } catch (err) {
    await connection.rollback();
    console.error('Lỗi khi xóa nhân công:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ khi xóa hồ sơ nhân công.' });
  } finally {
    connection.release();
  }
};
router.delete('/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Ke_Toan']), deleteLabor);
router.delete('/ho-so/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Ke_Toan']), deleteLabor);



// 3. Daily Attendance logging (Ky_Thuat, Ban_Giam_Doc)
router.post('/cham-cong', authMiddleware, authorize(['Ky_Thuat', 'Ban_Giam_Doc']), async (req, res) => {
  const { id_nhan_cong, id_cong_trinh, ngay_cham_cong, so_cong, don_gia_ap_dung, ghi_chu } = req.body;
  if (!id_nhan_cong || !ngay_cham_cong) {
    return res.status(400).json({ message: 'Nhân công và ngày chấm công là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Fetch default wage if not provided
    let rate = don_gia_ap_dung;
    if (rate === undefined || rate === null) {
      const [worker] = await connection.query('SELECT don_gia_luong_ngay FROM nhan_cong WHERE id = ?', [id_nhan_cong]);
      rate = worker.length > 0 ? worker[0].don_gia_luong_ngay : 0;
    }

    const [result] = await connection.query(
      `INSERT INTO cham_cong_hang_ngay (id_nhan_cong, id_cong_trinh, ngay_cham_cong, so_cong, don_gia_ap_dung, ghi_chu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id_nhan_cong, id_cong_trinh || null, ngay_cham_cong, so_cong || 1.0, rate, ghi_chu || null, req.user.ten_dang_nhap]
    );

    const [newRow] = await connection.query('SELECT * FROM cham_cong_hang_ngay WHERE id = ?', [result.insertId]);
    await logChange(connection, 'cham_cong_hang_ngay', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi ghi nhận chấm công.' });
  } finally {
    connection.release();
  }
});

// 4. Register Piece-rate Wage (Kinh_Doanh, Ban_Giam_Doc) - loading wage
router.post('/luong-san-pham', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc']), async (req, res) => {
  const { id_nhan_cong, id_don_hang, id_nhat_ky_kho, id_danh_muc_vat_tu, ngay_thuc_hien, so_luong, don_gia_nhan_cong, ghi_chu } = req.body;
  if (!id_nhan_cong || !id_danh_muc_vat_tu || !so_luong || !don_gia_nhan_cong || !ngay_thuc_hien) {
    return res.status(400).json({ message: 'Thiếu thông tin tính lương sản phẩm.' });
  }

  const amount = parseFloat(so_luong) * parseFloat(don_gia_nhan_cong);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO luong_san_pham (id_nhan_cong, id_don_hang, id_nhat_ky_kho, id_danh_muc_vat_tu, ngay_thuc_hien, so_luong, don_gia_nhan_cong, thanh_tien, ghi_chu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id_nhan_cong, id_don_hang || null, id_nhat_ky_kho || null, id_danh_muc_vat_tu, ngay_thuc_hien, so_luong, don_gia_nhan_cong, amount, ghi_chu || null, req.user.ten_dang_nhap]
    );

    const [newRow] = await connection.query('SELECT * FROM luong_san_pham WHERE id = ?', [result.insertId]);
    await logChange(connection, 'luong_san_pham', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi ghi nhận lương sản phẩm.' });
  } finally {
    connection.release();
  }
});

// 5. Register Cash Advance (Ky_Thuat, Kinh_Doanh, Ban_Giam_Doc)
router.post('/tam-ung', authMiddleware, authorize(['Ky_Thuat', 'Kinh_Doanh', 'Ban_Giam_Doc']), async (req, res) => {
  const { id_nhan_cong, id_cong_trinh, so_tien_tam_ung, ngay_tam_ung } = req.body;
  if (!id_nhan_cong || !so_tien_tam_ung || !ngay_tam_ung) {
    return res.status(400).json({ message: 'Thiếu thông tin tạm ứng.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO tam_ung_nhan_cong (id_nhan_cong, id_cong_trinh, so_tien_tam_ung, ngay_tam_ung, trang_thai_can_tru, nguoi_tao)
       VALUES (?, ?, ?, ?, 'Chua_Can_Tru', ?)`,
      [id_nhan_cong, id_cong_trinh || null, so_tien_tam_ung, ngay_tam_ung, req.user.ten_dang_nhap]
    );

    const [newRow] = await connection.query('SELECT * FROM tam_ung_nhan_cong WHERE id = ?', [result.insertId]);
    await logChange(connection, 'tam_ung_nhan_cong', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi ghi nhận tạm ứng.' });
  } finally {
    connection.release();
  }
});

// 6. Compute Payroll for Worker(s) (Ke_Toan, Ban_Giam_Doc)
router.post('/tinh-luong', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc']), async (req, res) => {
  const { tu_ngay, den_ngay, id_nhan_cong } = req.body;
  if (!tu_ngay || !den_ngay) {
    return res.status(400).json({ message: 'Từ ngày và đến ngày là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Query target workers
    let workers = [];
    if (id_nhan_cong) {
      const [rows] = await connection.query('SELECT id, ho_ten FROM nhan_cong WHERE id = ?', [id_nhan_cong]);
      workers = rows;
    } else {
      const [rows] = await connection.query('SELECT id, ho_ten FROM nhan_cong');
      workers = rows;
    }

    const calculatedPayrolls = [];

    for (const w of workers) {
      // 1. Gross Daily Wage sum
      const [dailyRows] = await connection.query(
        `SELECT SUM(so_cong * don_gia_ap_dung) as daily_sum 
         FROM cham_cong_hang_ngay 
         WHERE id_nhan_cong = ? AND ngay_cham_cong BETWEEN ? AND ? AND id_phieu_chi_luong IS NULL`,
        [w.id, tu_ngay, den_ngay]
      );
      const grossDaily = parseFloat(dailyRows[0].daily_sum) || 0;

      // 2. Gross Piece-rate Wage sum
      const [pieceRows] = await connection.query(
        `SELECT SUM(thanh_tien) as piece_sum 
         FROM luong_san_pham 
         WHERE id_nhan_cong = ? AND ngay_thuc_hien BETWEEN ? AND ? AND id_phieu_chi_luong IS NULL`,
        [w.id, tu_ngay, den_ngay]
      );
      const grossPiece = parseFloat(pieceRows[0].piece_sum) || 0;

      const totalGross = grossDaily + grossPiece;

      // 3. Advances sum
      const [advRows] = await connection.query(
        `SELECT SUM(so_tien_tam_ung) as adv_sum 
         FROM tam_ung_nhan_cong 
         WHERE id_nhan_cong = ? AND ngay_tam_ung BETWEEN ? AND ? AND id_phieu_chi_luong IS NULL`,
        [w.id, tu_ngay, den_ngay]
      );
      const totalAdvances = parseFloat(advRows[0].adv_sum) || 0;

      // 4. Inherited debt from previous period
      // Look up last payroll where Net wage rolled over into no_ke_thua
      const [lastPayroll] = await connection.query(
        `SELECT no_ke_thua, luong_thuc_linh FROM phieu_chi_luong 
         WHERE id_nhan_cong = ? 
         ORDER BY id DESC LIMIT 1`,
        [w.id]
      );

      // If the last payroll rolled over negative balance, it is inherited debt.
      // E.g., if calculated net wage was negative, it saved as no_ke_thua for the next cycle
      const inheritedDebt = lastPayroll.length > 0 ? parseFloat(lastPayroll[0].no_ke_thua) : 0;

      // 5. Net wage calculations
      const netPay = totalGross - totalAdvances - inheritedDebt;

      let finalNetPay = 0;
      let nextInheritedDebt = 0;

      if (netPay < 0) {
        finalNetPay = 0;
        nextInheritedDebt = Math.abs(netPay);
      } else {
        finalNetPay = netPay;
        nextInheritedDebt = 0;
      }

      // Generate unique code: LUONG-YEAR-RAND
      const rand = Math.floor(10000 + Math.random() * 90000);
      const year = new Date(tu_ngay).getFullYear();
      const ma_phieu_luong = `L-${rand}/${year}`;

      // Insert payroll
      const [result] = await connection.query(
        `INSERT INTO phieu_chi_luong (ma_phieu_luong, id_nhan_cong, tu_ngay, den_ngay, tong_luong_gop, tong_tam_ung, luong_thuc_linh, no_ke_thua, trang_thai_thanh_toan, ngay_tao, nguoi_tao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Cho_Duyet', NOW(), ?)`,
        [ma_phieu_luong, w.id, tu_ngay, den_ngay, totalGross, totalAdvances, finalNetPay, nextInheritedDebt, req.user.ten_dang_nhap]
      );

      const payrollId = result.insertId;

      // Lock current records by linking payroll ID
      await connection.query(
        `UPDATE cham_cong_hang_ngay SET id_phieu_chi_luong = ? 
         WHERE id_nhan_cong = ? AND ngay_cham_cong BETWEEN ? AND ? AND id_phieu_chi_luong IS NULL`,
        [payrollId, w.id, tu_ngay, den_ngay]
      );

      await connection.query(
        `UPDATE luong_san_pham SET id_phieu_chi_luong = ? 
         WHERE id_nhan_cong = ? AND ngay_thuc_hien BETWEEN ? AND ? AND id_phieu_chi_luong IS NULL`,
        [payrollId, w.id, tu_ngay, den_ngay]
      );

      await connection.query(
        `UPDATE tam_ung_nhan_cong SET id_phieu_chi_luong = ?, trang_thai_can_tru = 'Da_Can_Tru' 
         WHERE id_nhan_cong = ? AND ngay_tam_ung BETWEEN ? AND ? AND id_phieu_chi_luong IS NULL`,
        [payrollId, w.id, tu_ngay, den_ngay]
      );

      const [newPayroll] = await connection.query('SELECT * FROM phieu_chi_luong WHERE id = ?', [payrollId]);
      await logChange(connection, 'phieu_chi_luong', payrollId, 'THEM_MOI', null, newPayroll[0], req.user.ten_dang_nhap);

      calculatedPayrolls.push({
        worker: w.ho_ten,
        payroll: newPayroll[0]
      });
    }

    await connection.commit();
    return res.json({
      message: 'Đã hoàn tất tính toán lương chu kỳ.',
      data: calculatedPayrolls
    });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi tính toán bảng lương.' });
  } finally {
    connection.release();
  }
});

module.exports = router;
