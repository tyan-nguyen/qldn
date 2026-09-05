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
  if (!ho_ten || !so_cccd) {
    return res.status(400).json({ message: 'Họ tên và số CCCD là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO nhan_cong (ho_ten, so_dien_thoai, so_cccd, don_gia_luong_ngay, ten_to_doi, hinh_anh, ghi_chu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ho_ten, so_dien_thoai || null, so_cccd, don_gia_luong_ngay || 0, ten_to_doi || null, hinh_anh || null, ghi_chu || null, req.user.ten_dang_nhap]
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
