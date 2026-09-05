const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');

const upload = multer({ storage: multer.memoryStorage() });

// 1. Projects List (All roles can view)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*, k.ten_khach_hang 
       FROM cong_trinh c
       LEFT JOIN khach_hang k ON c.id_khach_hang = k.id
       ORDER BY c.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách công trình.' });
  }
});

// 2. Create Project (Ke_Hoach, Ban_Giam_Doc)
router.post('/', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc']), async (req, res) => {
  const { ten_cong_trinh, ten_viet_tat, dia_chi, id_khach_hang, tong_ngan_sach, ngay_bat_dau, ngay_ket_thuc } = req.body;
  if (!ten_cong_trinh) {
    return res.status(400).json({ message: 'Tên công trình là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO cong_trinh (ten_cong_trinh, ten_viet_tat, dia_chi, id_khach_hang, tong_ngan_sach, ngay_bat_dau, ngay_ket_thuc, trang_thai, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Dang_Thi_Cong', ?)`,
      [ten_cong_trinh.trim(), ten_viet_tat ? ten_viet_tat.trim() : null, dia_chi || null, id_khach_hang || null, tong_ngan_sach || 0, ngay_bat_dau || null, ngay_ket_thuc || null, req.user.ten_dang_nhap]
    );

    const insertedId = result.insertId;
    const [newRow] = await connection.query('SELECT * FROM cong_trinh WHERE id = ?', [insertedId]);

    await logChange(connection, 'cong_trinh', insertedId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi tạo mới công trình.' });
  } finally {
    connection.release();
  }
});

// Update Project (Ke_Hoach, Ban_Giam_Doc, Admin)
router.put('/:id', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { ten_cong_trinh, ten_viet_tat, dia_chi, id_khach_hang, tong_ngan_sach, ngay_bat_dau, ngay_ket_thuc, trang_thai } = req.body;
  if (!ten_cong_trinh || !ten_cong_trinh.trim()) {
    return res.status(400).json({ message: 'Tên công trình là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM cong_trinh WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy công trình.' });
    }

    await connection.query(
      `UPDATE cong_trinh 
       SET ten_cong_trinh = ?, ten_viet_tat = ?, dia_chi = ?, id_khach_hang = ?, tong_ngan_sach = ?, ngay_bat_dau = ?, ngay_ket_thuc = ?, trang_thai = ?
       WHERE id = ?`,
      [
        ten_cong_trinh.trim(),
        ten_viet_tat ? ten_viet_tat.trim() : null,
        dia_chi || null,
        id_khach_hang || null,
        tong_ngan_sach || 0,
        ngay_bat_dau || null,
        ngay_ket_thuc || null,
        trang_thai || oldRow[0].trang_thai,
        req.params.id
      ]
    );

    const [newRow] = await connection.query('SELECT * FROM cong_trinh WHERE id = ?', [req.params.id]);
    await logChange(connection, 'cong_trinh', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi cập nhật công trình.' });
  } finally {
    connection.release();
  }
});

// Delete Project (Ban_Giam_Doc, Admin - Kiểm tra toàn bộ dữ liệu liên kết)
router.delete('/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const projId = req.params.id;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM cong_trinh WHERE id = ?', [projId]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy công trình.' });
    }

    const proj = oldRow[0];

    // Kiểm tra tất cả các phân hệ dữ liệu liên kết với công trình này
    const [contracts] = await connection.query('SELECT COUNT(*) as cnt FROM hop_dong WHERE id_cong_trinh = ? AND da_xoa = 0', [projId]);
    const [boqItems] = await connection.query('SELECT COUNT(*) as cnt FROM du_toan_boq WHERE id_cong_trinh = ?', [projId]);
    const [exports] = await connection.query('SELECT COUNT(*) as cnt FROM phieu_xuat_kho WHERE id_cong_trinh = ?', [projId]);
    const [requisitions] = await connection.query('SELECT COUNT(*) as cnt FROM yeu_cau_vat_tu WHERE id_cong_trinh = ?', [projId]);
    const [pos] = await connection.query('SELECT COUNT(*) as cnt FROM phieu_mua_hang WHERE id_cong_trinh = ?', [projId]);
    const [finances] = await connection.query(
      'SELECT COUNT(*) as cnt FROM phieu_thu_chi WHERE ((loai_chung_tu_lien_ket = \'cong_trinh\' AND id_chung_tu = ?) OR ly_do_thu_chi LIKE ?) AND da_xoa = 0',
      [projId, `%${proj.ten_cong_trinh}%`]
    );
    const [subcontractors] = await connection.query('SELECT COUNT(*) as cnt FROM nha_thau_phu WHERE id_cong_trinh = ?', [projId]);
    const [machineries] = await connection.query('SELECT COUNT(*) as cnt FROM ca_may_thue WHERE id_cong_trinh = ?', [projId]);
    const [laborContracts] = await connection.query('SELECT COUNT(*) as cnt FROM hop_dong_nhan_cong WHERE id_cong_trinh = ?', [projId]);
    const [otherCosts] = await connection.query('SELECT COUNT(*) as cnt FROM ctr_chi_phi_khac WHERE id_cong_trinh = ?', [projId]);

    const linkedReasons = [];
    if (contracts[0]?.cnt > 0) linkedReasons.push(`${contracts[0].cnt} hợp đồng kinh tế`);
    if (boqItems[0]?.cnt > 0) linkedReasons.push(`${boqItems[0].cnt} hạng mục dự toán BOQ`);
    if (exports[0]?.cnt > 0) linkedReasons.push(`${exports[0].cnt} phiếu xuất kho vật tư`);
    if (requisitions[0]?.cnt > 0) linkedReasons.push(`${requisitions[0].cnt} phiếu yêu cầu vật tư`);
    if (pos[0]?.cnt > 0) linkedReasons.push(`${pos[0].cnt} phiếu mua hàng công trình`);
    if (finances[0]?.cnt > 0) linkedReasons.push(`${finances[0].cnt} phiếu thu/chi tài chính`);
    if (subcontractors[0]?.cnt > 0) linkedReasons.push(`${subcontractors[0].cnt} hợp đồng nhà thầu phụ`);
    if (machineries[0]?.cnt > 0) linkedReasons.push(`${machineries[0].cnt} ca máy thi công`);
    if (laborContracts[0]?.cnt > 0) linkedReasons.push(`${laborContracts[0].cnt} hợp đồng nhân công`);
    if (otherCosts[0]?.cnt > 0) linkedReasons.push(`${otherCosts[0].cnt} khoản chi phí khác`);

    if (linkedReasons.length > 0) {
      connection.release();
      return res.status(400).json({
        message: `Không thể xóa công trình "${proj.ten_cong_trinh}" vì đang tồn tại dữ liệu liên kết: ${linkedReasons.join(', ')}. Vui lòng xóa các dữ liệu liên quan trước khi xóa công trình.`
      });
    }

    await connection.query('DELETE FROM cong_trinh WHERE id = ?', [projId]);
    await logChange(connection, 'cong_trinh', projId, 'XOA', proj, null, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: 'Xóa công trình thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting project:', err);
    return res.status(500).json({ message: 'Lỗi khi xóa công trình: ' + (err.message || '') });
  } finally {
    connection.release();
  }
});

// 3. Contract & Guarantee setup / details for a Project
router.get('/:id/hop-dong', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM hop_dong WHERE id_cong_trinh = ?', [req.params.id]);
    return res.json(rows[0] || null);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn hợp đồng công trình.' });
  }
});

router.post('/:id/hop-dong', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc']), async (req, res) => {
  const id_cong_trinh = req.params.id;
  const {
    gia_tri_hop_dong, ngay_ky, ngay_hieu_luc, ngay_het_han,
    gia_tri_tam_ung, ngay_bao_lanh_tam_ung, ngay_het_han_bao_lanh_tam_ung,
    bao_lanh_thuc_hien, ngay_bao_lanh_thuc_hien, ngay_het_han_bao_lanh_thuc_hien,
    bao_hanh_cong_trinh, ngay_bao_hanh_cong_trinh, ngay_het_han_bao_hanh
  } = req.body;

  if (!gia_tri_hop_dong) {
    return res.status(400).json({ message: 'Giá trị hợp đồng là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check if exists
    const [existing] = await connection.query('SELECT id FROM hop_dong WHERE id_cong_trinh = ?', [id_cong_trinh]);

    let id_hop_dong;
    let oldData = null;
    let newData = null;

    if (existing.length > 0) {
      id_hop_dong = existing[0].id;
      const [oldRow] = await connection.query('SELECT * FROM hop_dong WHERE id = ?', [id_hop_dong]);
      oldData = oldRow[0];

      await connection.query(
        `UPDATE hop_dong SET 
          gia_tri_hop_dong = ?, ngay_ky = ?, ngay_hieu_luc = ?, ngay_het_han = ?,
          gia_tri_tam_ung = ?, ngay_bao_lanh_tam_ung = ?, ngay_het_han_bao_lanh_tam_ung = ?,
          bao_lanh_thuc_hien = ?, ngay_bao_lanh_thuc_hien = ?, ngay_het_han_bao_lanh_thuc_hien = ?,
          bao_hanh_cong_trinh = ?, ngay_bao_hanh_cong_trinh = ?, ngay_het_han_bao_hanh = ?
         WHERE id = ?`,
        [
          gia_tri_hop_dong, ngay_ky || null, ngay_hieu_luc || null, ngay_het_han || null,
          gia_tri_tam_ung || 0, ngay_bao_lanh_tam_ung || null, ngay_het_han_bao_lanh_tam_ung || null,
          bao_lanh_thuc_hien || 0, ngay_bao_lanh_thuc_hien || null, ngay_het_han_bao_lanh_thuc_hien || null,
          bao_hanh_cong_trinh || 0, ngay_bao_hanh_cong_trinh || null, ngay_het_han_bao_hanh || null,
          id_hop_dong
        ]
      );
      const [newRow] = await connection.query('SELECT * FROM hop_dong WHERE id = ?', [id_hop_dong]);
      newData = newRow[0];
      await logChange(connection, 'hop_dong', id_hop_dong, 'CAP_NHAT', oldData, newData, req.user.ten_dang_nhap);
    } else {
      const [result] = await connection.query(
        `INSERT INTO hop_dong (
          id_cong_trinh, gia_tri_hop_dong, ngay_ky, ngay_hieu_luc, ngay_het_han,
          gia_tri_tam_ung, ngay_bao_lanh_tam_ung, ngay_het_han_bao_lanh_tam_ung,
          bao_lanh_thuc_hien, ngay_bao_lanh_thuc_hien, ngay_het_han_bao_lanh_thuc_hien,
          bao_hanh_cong_trinh, ngay_bao_hanh_cong_trinh, ngay_het_han_bao_hanh, nguoi_tao
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id_cong_trinh, gia_tri_hop_dong, ngay_ky || null, ngay_hieu_luc || null, ngay_het_han || null,
          gia_tri_tam_ung || 0, ngay_bao_lanh_tam_ung || null, ngay_het_han_bao_lanh_tam_ung || null,
          bao_lanh_thuc_hien || 0, ngay_bao_lanh_thuc_hien || null, ngay_het_han_bao_lanh_thuc_hien || null,
          bao_hanh_cong_trinh || 0, ngay_bao_hanh_cong_trinh || null, ngay_het_han_bao_hanh || null,
          req.user.ten_dang_nhap
        ]
      );
      id_hop_dong = result.insertId;
      const [newRow] = await connection.query('SELECT * FROM hop_dong WHERE id = ?', [id_hop_dong]);
      newData = newRow[0];
      await logChange(connection, 'hop_dong', id_hop_dong, 'THEM_MOI', null, newData, req.user.ten_dang_nhap);
    }

    await connection.commit();
    return res.json(newData);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi cập nhật hợp đồng.' });
  } finally {
    connection.release();
  }
});

// 4. Guarantees alerts warning (15 days check)
router.get('/canh-bao/bao-lanh', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT h.*, c.ten_cong_trinh,
              DATEDIFF(h.ngay_het_han_bao_lanh_tam_ung, NOW()) as ngay_con_lai_tam_ung,
              DATEDIFF(h.ngay_het_han_bao_lanh_thuc_hien, NOW()) as ngay_con_lai_thuc_hien,
              DATEDIFF(h.ngay_het_han_bao_hanh, NOW()) as ngay_con_lai_bao_hanh,
              DATEDIFF(h.ngay_het_han, NOW()) as ngay_con_lai_hop_dong
       FROM hop_dong h
       JOIN cong_trinh c ON h.id_cong_trinh = c.id
       WHERE 
         (h.ngay_het_han_bao_lanh_tam_ung IS NOT NULL AND DATEDIFF(h.ngay_het_han_bao_lanh_tam_ung, NOW()) <= 15 AND DATEDIFF(h.ngay_het_han_bao_lanh_tam_ung, NOW()) >= 0) OR
         (h.ngay_het_han_bao_lanh_thuc_hien IS NOT NULL AND DATEDIFF(h.ngay_het_han_bao_lanh_thuc_hien, NOW()) <= 15 AND DATEDIFF(h.ngay_het_han_bao_lanh_thuc_hien, NOW()) >= 0) OR
         (h.ngay_het_han_bao_hanh IS NOT NULL AND DATEDIFF(h.ngay_het_han_bao_hanh, NOW()) <= 15 AND DATEDIFF(h.ngay_het_han_bao_hanh, NOW()) >= 0) OR
         (h.ngay_het_han IS NOT NULL AND DATEDIFF(h.ngay_het_han, NOW()) <= 15 AND DATEDIFF(h.ngay_het_han, NOW()) >= 0)`
    );

    const alerts = [];
    for (const r of rows) {
      if (r.ngay_con_lai_tam_ung >= 0 && r.ngay_con_lai_tam_ung <= 15) {
        alerts.push({ type: 'Bảo lãnh Tạm ứng', cong_trinh: r.ten_cong_trinh, ngay_het_han: r.ngay_het_han_bao_lanh_tam_ung, ngay_con_lai: r.ngay_con_lai_tam_ung });
      }
      if (r.ngay_con_lai_thuc_hien >= 0 && r.ngay_con_lai_thuc_hien <= 15) {
        alerts.push({ type: 'Bảo lãnh Thực hiện', cong_trinh: r.ten_cong_trinh, ngay_het_han: r.ngay_het_han_bao_lanh_thuc_hien, ngay_con_lai: r.ngay_con_lai_thuc_hien });
      }
      if (r.ngay_con_lai_bao_hanh >= 0 && r.ngay_con_lai_bao_hanh <= 15) {
        alerts.push({ type: 'Bảo hành Công trình', cong_trinh: r.ten_cong_trinh, ngay_het_han: r.ngay_het_han_bao_hanh, ngay_con_lai: r.ngay_con_lai_bao_hanh });
      }
      if (r.ngay_con_lai_hop_dong >= 0 && r.ngay_con_lai_hop_dong <= 15) {
        alerts.push({ type: 'Hợp đồng liên kết', cong_trinh: r.ten_cong_trinh, ngay_het_han: r.ngay_het_han, ngay_con_lai: r.ngay_con_lai_hop_dong });
      }
    }

    return res.json(alerts);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi quét cảnh báo bảo lãnh.' });
  }
});

// 5. BOQ Items for a Project
router.get('/:id/boq', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*, 
              d.ten_chi_phi as ten_chi_phi_khac,
              v.ma_vat_tu as vat_tu_ma,
              v.ten_vat_tu as vat_tu_ten,
              v.don_vi_tinh as vat_tu_dvt,
              v.don_gia_tieu_chuan as vat_tu_don_gia_tieu_chuan
       FROM du_toan_boq b
       LEFT JOIN danh_muc_chi_phi_khac d ON b.id_danh_muc_chi_phi_khac = d.id
       LEFT JOIN danh_muc_vat_tu v ON b.id_danh_muc_vat_tu = v.id
       WHERE b.id_cong_trinh = ?
       ORDER BY b.id ASC`,
      [req.params.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi truy vấn BOQ.' });
  }
});

// 5.1. Add Single BOQ Item
router.post('/:id/boq', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const id_cong_trinh = req.params.id;
  const {
    id_danh_muc_vat_tu,
    ma_hang_muc,
    ten_hang_muc,
    don_vi_tinh,
    so_luong_du_toan,
    don_gia_du_toan,
    phan_loai = 'Vat_Tu',
    id_danh_muc_chi_phi_khac
  } = req.body;

  let finalIdDanhMucVatTu = id_danh_muc_vat_tu ? parseInt(id_danh_muc_vat_tu) : null;
  let finalMaHangMuc = ma_hang_muc && ma_hang_muc.trim() ? ma_hang_muc.trim() : null;
  let finalTenHangMuc = ten_hang_muc && ten_hang_muc.trim() ? ten_hang_muc.trim() : '';
  let finalDvt = don_vi_tinh ? don_vi_tinh.trim() : null;
  let finalDonGia = parseFloat(don_gia_du_toan) || 0;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (finalIdDanhMucVatTu) {
      const [matRows] = await connection.query('SELECT * FROM danh_muc_vat_tu WHERE id = ?', [finalIdDanhMucVatTu]);
      if (matRows.length > 0) {
        const mat = matRows[0];
        if (!finalMaHangMuc) finalMaHangMuc = mat.ma_vat_tu;
        if (!finalTenHangMuc) finalTenHangMuc = mat.ten_vat_tu;
        if (!finalDvt) finalDvt = mat.don_vi_tinh;
        if (!finalDonGia && mat.don_gia_tieu_chuan) finalDonGia = parseFloat(mat.don_gia_tieu_chuan) || 0;
      }
    }

    if (!finalTenHangMuc) {
      connection.release();
      return res.status(400).json({ message: 'Vui lòng nhập tên hạng mục hoặc chọn vật tư từ danh mục.' });
    }

    if (!finalMaHangMuc) {
      const [countRows] = await connection.query(
        'SELECT COUNT(*) as cnt FROM du_toan_boq WHERE id_cong_trinh = ?',
        [id_cong_trinh]
      );
      const nextNum = (countRows[0]?.cnt || 0) + 1;
      finalMaHangMuc = `HM-${String(nextNum).padStart(3, '0')}`;
    }

    const [ins] = await connection.query(
      `INSERT INTO du_toan_boq (
        id_cong_trinh, id_danh_muc_vat_tu, ma_hang_muc, ten_hang_muc, don_vi_tinh,
        so_luong_du_toan, don_gia_du_toan, phan_loai, id_danh_muc_chi_phi_khac,
        trang_thai_khoa, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        id_cong_trinh,
        finalIdDanhMucVatTu,
        finalMaHangMuc,
        finalTenHangMuc,
        finalDvt,
        parseFloat(so_luong_du_toan) || 0,
        finalDonGia,
        phan_loai || 'Vat_Tu',
        id_danh_muc_chi_phi_khac || null,
        req.user?.ten_dang_nhap || 'system'
      ]
    );

    const insertedId = ins.insertId;
    const [newRow] = await connection.query(
      `SELECT b.*, 
              d.ten_chi_phi as ten_chi_phi_khac,
              v.ma_vat_tu as vat_tu_ma,
              v.ten_vat_tu as vat_tu_ten,
              v.don_vi_tinh as vat_tu_dvt,
              v.don_gia_tieu_chuan as vat_tu_don_gia_tieu_chuan
       FROM du_toan_boq b
       LEFT JOIN danh_muc_chi_phi_khac d ON b.id_danh_muc_chi_phi_khac = d.id
       LEFT JOIN danh_muc_vat_tu v ON b.id_danh_muc_vat_tu = v.id
       WHERE b.id = ?`,
      [insertedId]
    );

    await logChange(connection, 'du_toan_boq', insertedId, 'THEM_MOI', null, newRow[0], req.user?.ten_dang_nhap || 'system');
    await connection.commit();
    return res.status(201).json({
      message: 'Thêm hạng mục dự toán thành công.',
      data: newRow[0]
    });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi thêm hạng mục dự toán: ' + err.message });
  } finally {
    connection.release();
  }
});

// 5.2. Delete Single BOQ Item (Kiểm tra dữ liệu liên kết & trạng thái khóa Baseline)
router.delete('/:id/boq/:boq_id', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const projId = req.params.id;
  const boqId = req.params.boq_id;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [boqRow] = await connection.query('SELECT * FROM du_toan_boq WHERE id = ? AND id_cong_trinh = ?', [boqId, projId]);
    if (boqRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy hạng mục BOQ.' });
    }

    const boq = boqRow[0];

    // 1. Kiểm tra trạng thái khóa Baseline
    if (boq.trang_thai_khoa === 1) {
      connection.release();
      return res.status(400).json({
        message: `Không thể xóa hạng mục dự toán "${boq.ten_hang_muc}" vì đã được chốt Baseline. Vui lòng mở khóa Baseline trước khi thực hiện xóa.`
      });
    }

    // 2. Kiểm tra phát sinh thực tế liên kết
    const linkedCosts = [];
    if (boq.phan_loai === 'Chi_Phi_Khac' && boq.id_danh_muc_chi_phi_khac) {
      const [otherRows] = await connection.query(
        'SELECT COUNT(*) as cnt FROM ctr_chi_phi_khac WHERE id_cong_trinh = ? AND id_danh_muc_chi_phi_khac = ?',
        [projId, boq.id_danh_muc_chi_phi_khac]
      );
      if (otherRows[0]?.cnt > 0) {
        linkedCosts.push(`${otherRows[0].cnt} khoản chi phí khác thực tế`);
      }
    } else if (boq.phan_loai === 'Vat_Tu') {
      const [matRows] = await connection.query(
        `SELECT COUNT(*) as cnt FROM phieu_xuat_kho_chi_tiet pxkc 
         JOIN phieu_xuat_kho pxk ON pxkc.id_phieu_xuat_kho = pxk.id 
         LEFT JOIN danh_muc_vat_tu dmv ON pxkc.id_danh_muc_vat_tu = dmv.id 
         WHERE pxk.id_cong_trinh = ? AND (pxkc.id_danh_muc_vat_tu = ? OR dmv.ma_vat_tu = ? OR dmv.ten_vat_tu = ?)`,
        [projId, boq.id_danh_muc_vat_tu || 0, boq.ma_hang_muc, boq.ten_hang_muc]
      );
      if (matRows[0]?.cnt > 0) {
        linkedCosts.push(`${matRows[0].cnt} phiếu xuất kho vật tư`);
      }
    }

    if (linkedCosts.length > 0) {
      connection.release();
      return res.status(400).json({
        message: `Không thể xóa hạng mục "${boq.ten_hang_muc}" vì đã phát sinh ${linkedCosts.join(', ')} tại công trình. Vui lòng kiểm tra và hủy các dữ liệu liên quan trước.`
      });
    }

    await connection.query('DELETE FROM du_toan_boq WHERE id = ?', [boqId]);
    await logChange(connection, 'du_toan_boq', boqId, 'XOA', boq, null, req.user?.ten_dang_nhap || 'system');

    await connection.commit();
    return res.json({ message: 'Xóa hạng mục dự toán thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting BOQ item:', err);
    return res.status(500).json({ message: 'Lỗi khi xóa hạng mục dự toán: ' + err.message });
  } finally {
    connection.release();
  }
});

// 6. Direct Edit BOQ (Logs, and check lock state)
router.put('/:id/boq/:boq_id', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_danh_muc_vat_tu, ma_hang_muc, ten_hang_muc, don_vi_tinh, so_luong_du_toan, don_gia_du_toan, phan_loai, id_danh_muc_chi_phi_khac } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [boqRow] = await connection.query('SELECT * FROM du_toan_boq WHERE id = ?', [req.params.boq_id]);
    if (boqRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy hạng mục BOQ.' });
    }

    const boq = boqRow[0];

    // Lock check: if locked, only Ban_Giam_Doc or Admin can edit
    const userRoles = req.user.vai_tro ? req.user.vai_tro.split(',') : [];
    if (boq.trang_thai_khoa === 1 && !userRoles.includes('Ban_Giam_Doc') && !userRoles.includes('Admin')) {
      connection.release();
      return res.status(403).json({
        message: 'Dự toán đã khóa làm Baseline. Chỉ Giám đốc mới có quyền điều chỉnh số liệu này.'
      });
    }

    await connection.query(
      `UPDATE du_toan_boq 
       SET id_danh_muc_vat_tu = ?, ma_hang_muc = ?, ten_hang_muc = ?, don_vi_tinh = ?, so_luong_du_toan = ?, don_gia_du_toan = ?, phan_loai = ?, id_danh_muc_chi_phi_khac = ?
       WHERE id = ?`,
      [
        id_danh_muc_vat_tu !== undefined ? (id_danh_muc_vat_tu ? parseInt(id_danh_muc_vat_tu) : null) : boq.id_danh_muc_vat_tu,
        ma_hang_muc !== undefined ? (ma_hang_muc ? ma_hang_muc.trim() : boq.ma_hang_muc) : boq.ma_hang_muc,
        ten_hang_muc ? ten_hang_muc.trim() : boq.ten_hang_muc,
        don_vi_tinh !== undefined ? (don_vi_tinh ? don_vi_tinh.trim() : null) : boq.don_vi_tinh,
        so_luong_du_toan !== undefined ? parseFloat(so_luong_du_toan) : boq.so_luong_du_toan,
        don_gia_du_toan !== undefined ? parseFloat(don_gia_du_toan) : boq.don_gia_du_toan,
        phan_loai || boq.phan_loai || 'Vat_Tu',
        id_danh_muc_chi_phi_khac !== undefined ? (id_danh_muc_chi_phi_khac || null) : boq.id_danh_muc_chi_phi_khac,
        req.params.boq_id
      ]
    );

    const [newRow] = await connection.query(
      `SELECT b.*, 
              d.ten_chi_phi as ten_chi_phi_khac,
              v.ma_vat_tu as vat_tu_ma,
              v.ten_vat_tu as vat_tu_ten,
              v.don_vi_tinh as vat_tu_dvt,
              v.don_gia_tieu_chuan as vat_tu_don_gia_tieu_chuan
       FROM du_toan_boq b
       LEFT JOIN danh_muc_chi_phi_khac d ON b.id_danh_muc_chi_phi_khac = d.id
       LEFT JOIN danh_muc_vat_tu v ON b.id_danh_muc_vat_tu = v.id
       WHERE b.id = ?`,
      [req.params.boq_id]
    );

    await logChange(connection, 'du_toan_boq', req.params.boq_id, 'CAP_NHAT', boq, newRow[0], req.user?.ten_dang_nhap || 'system');
    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi cập nhật hạng mục dự toán: ' + err.message });
  } finally {
    connection.release();
  }
});

// 7. Lock BOQ Baseline (Director / Admin only)
router.post('/:id/boq/lock', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  try {
    await pool.query('UPDATE du_toan_boq SET trang_thai_khoa = 1 WHERE id_cong_trinh = ?', [req.params.id]);
    return res.json({ message: 'Đã khóa Dự toán làm hạn mức đối chiếu Baseline.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi khóa dự toán.' });
  }
});

// 8. Unlock BOQ Baseline (Director / Admin only)
router.post('/:id/boq/unlock', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  try {
    await pool.query('UPDATE du_toan_boq SET trang_thai_khoa = 0 WHERE id_cong_trinh = ?', [req.params.id]);
    return res.json({ message: 'Đã mở khóa dự toán.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi mở khóa dự toán.' });
  }
});

// 8.1. Báo cáo Phân tích So sánh Dự toán & Thực tế Thi công
router.get('/:id/boq/variance-report', authMiddleware, async (req, res) => {
  const projId = req.params.id;
  try {
    // 1. Project info
    const [projRows] = await pool.query(
      `SELECT c.*, k.ten_khach_hang, k.so_dien_thoai AS sdt_khach_hang, k.dia_chi AS dia_chi_khach_hang
       FROM cong_trinh c
       LEFT JOIN khach_hang k ON c.id_khach_hang = k.id
       WHERE c.id = ?`,
      [projId]
    );
    if (projRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy công trình.' });
    }
    const project = projRows[0];

    // 2. Contract info
    const [contractRows] = await pool.query(
      `SELECT * FROM hop_dong WHERE id_cong_trinh = ? AND da_xoa = 0 ORDER BY id DESC LIMIT 1`,
      [projId]
    );
    const contract = contractRows[0] || null;
    const giaTriHopDong = contract ? parseFloat(contract.gia_tri_hop_dong) : parseFloat(project.tong_ngan_sach || 0);

    // 3. BOQ Items
    const [boqRows] = await pool.query(
      `SELECT b.*, 
              d.ten_chi_phi as ten_chi_phi_khac,
              v.ma_vat_tu as vat_tu_ma,
              v.ten_vat_tu as vat_tu_ten,
              v.don_vi_tinh as vat_tu_dvt,
              v.don_gia_tieu_chuan as vat_tu_don_gia_tieu_chuan
       FROM du_toan_boq b
       LEFT JOIN danh_muc_chi_phi_khac d ON b.id_danh_muc_chi_phi_khac = d.id
       LEFT JOIN danh_muc_vat_tu v ON b.id_danh_muc_vat_tu = v.id
       WHERE b.id_cong_trinh = ?
       ORDER BY b.id ASC`,
      [projId]
    );

    // 4. Actual Costs per Category:
    // 4.1. Material Costs (phieu_xuat_kho + phieu_mua_hang giao thang)
    const [matExportRows] = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(ct.thanh_tien, ct.so_luong * ct.don_gia, 0)), 0) AS total_xuat
       FROM phieu_xuat_kho_chi_tiet ct
       JOIN phieu_xuat_kho px ON ct.id_phieu_xuat_kho = px.id
       WHERE px.id_cong_trinh = ?`,
      [projId]
    );
    const [matPORows] = await pool.query(
      `SELECT COALESCE(SUM(pmh.tong_tien), 0) AS total_po
       FROM phieu_mua_hang pmh
       WHERE pmh.id_cong_trinh = ?`,
      [projId]
    );
    const actualMaterialCost = (parseFloat(matExportRows[0]?.total_xuat) || 0) + (parseFloat(matPORows[0]?.total_po) || 0);

    // Query exact actual material consumption grouped by id_danh_muc_vat_tu
    const [actualMatSummaryRows] = await pool.query(
      `SELECT 
         c.id_danh_muc_vat_tu,
         COALESCE(SUM(c.so_luong), 0) AS total_actual_qty,
         COALESCE(SUM(c.thanh_tien) / NULLIF(SUM(c.so_luong), 0), 0) AS avg_actual_price,
         COALESCE(SUM(c.thanh_tien), 0) AS total_actual_cost
       FROM (
         SELECT 
           pxct.id_danh_muc_vat_tu,
           COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) AS so_luong,
           COALESCE(pxct.don_gia, 0) AS don_gia,
           COALESCE(pxct.thanh_tien, (COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) * COALESCE(pxct.don_gia, 0))) AS thanh_tien
         FROM phieu_xuat_kho_chi_tiet pxct
         JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
         WHERE px.id_cong_trinh = ?
         UNION ALL
         SELECT 
           pmct.id_danh_muc_vat_tu,
           COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) AS so_luong,
           COALESCE(pmct.don_gia, 0) AS don_gia,
           COALESCE(pmct.thanh_tien, (COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) * COALESCE(pmct.don_gia, 0))) AS thanh_tien
         FROM phieu_mua_hang_chi_tiet pmct
         JOIN phieu_mua_hang pm ON pmct.id_phieu_mua_hang = pm.id
         WHERE pm.id_cong_trinh = ?
           AND (pm.trang_thai_giao_hang <> 'Đã hủy' OR pm.trang_thai_giao_hang IS NULL)
       ) c
       WHERE c.id_danh_muc_vat_tu IS NOT NULL
       GROUP BY c.id_danh_muc_vat_tu`,
      [projId, projId]
    );

    const actualMatMap = {};
    actualMatSummaryRows.forEach(r => {
      actualMatMap[r.id_danh_muc_vat_tu] = {
        qty: parseFloat(r.total_actual_qty) || 0,
        price: parseFloat(r.avg_actual_price) || 0,
        cost: parseFloat(r.total_actual_cost) || 0
      };
    });

    // 4.2. Labor Costs
    const [laborRows] = await pool.query(
      `SELECT COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_labor
       FROM thanh_toan_nhan_cong t
       JOIN hop_dong_nhan_cong hd ON t.id_hop_dong_nhan_cong = hd.id
       WHERE hd.id_cong_trinh = ?`,
      [projId]
    );
    const actualLaborCost = parseFloat(laborRows[0]?.total_labor) || 0;

    // 4.3. Subcontractor Costs
    const [subRows] = await pool.query(
      `SELECT COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_sub
       FROM thanh_toan_thau_phu t
       JOIN nha_thau_phu ntp ON t.id_nha_thau_phu = ntp.id
       WHERE ntp.id_cong_trinh = ?`,
      [projId]
    );
    const actualSubCost = parseFloat(subRows[0]?.total_sub) || 0;

    // 4.4. Machinery Costs
    const [macRows] = await pool.query(
      `SELECT COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_mac
       FROM thanh_toan_ca_may t
       JOIN ca_may_thue cm ON t.id_ca_may_thue = cm.id
       WHERE cm.id_cong_trinh = ?`,
      [projId]
    );
    const actualMachineryCost = parseFloat(macRows[0]?.total_mac) || 0;

    // 4.5. Other Project Expenses
    const [otherRows] = await pool.query(
      `SELECT COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_other
       FROM ctr_chi_phi_khac_thanh_toan t
       JOIN ctr_chi_phi_khac c ON t.id_ctr_chi_phi_khac = c.id
       WHERE c.id_cong_trinh = ?`,
      [projId]
    );
    const actualOtherCost = parseFloat(otherRows[0]?.total_other) || 0;

    // 5. Individual Item breakdown & Actual matching
    const categoryCounts = {
      Vat_Tu: 0,
      Nhan_Cong: 0,
      Thau_Phu: 0,
      Ca_May: 0,
      Chi_Phi_Khac: 0
    };
    const categoryEstimatedTotals = {
      Vat_Tu: 0,
      Nhan_Cong: 0,
      Thau_Phu: 0,
      Ca_May: 0,
      Chi_Phi_Khac: 0
    };

    boqRows.forEach(b => {
      const pl = b.phan_loai || 'Vat_Tu';
      const tt = (parseFloat(b.so_luong_du_toan) || 0) * (parseFloat(b.don_gia_du_toan) || 0);
      if (categoryCounts[pl] !== undefined) categoryCounts[pl]++;
      if (categoryEstimatedTotals[pl] !== undefined) categoryEstimatedTotals[pl] += tt;
    });

    const items = boqRows.map((b, index) => {
      const sl_dt = parseFloat(b.so_luong_du_toan) || 0;
      const dg_dt = parseFloat(b.don_gia_du_toan) || 0;
      const tt_dt = sl_dt * dg_dt;

      let sl_tt = 0;
      let dg_tt = dg_dt;
      let tt_tt = 0;

      if (b.phan_loai === 'Vat_Tu') {
        if (b.id_danh_muc_vat_tu && actualMatMap[b.id_danh_muc_vat_tu]) {
          // Direct 1-to-1 matching with actual warehouse/PO usage for this material
          sl_tt = actualMatMap[b.id_danh_muc_vat_tu].qty;
          tt_tt = actualMatMap[b.id_danh_muc_vat_tu].cost;
          dg_tt = sl_tt > 0 ? (tt_tt / sl_tt) : (actualMatMap[b.id_danh_muc_vat_tu].price || dg_dt);
        } else if (categoryEstimatedTotals.Vat_Tu > 0 && actualMaterialCost > 0) {
          const weight = tt_dt / categoryEstimatedTotals.Vat_Tu;
          tt_tt = Math.round(actualMaterialCost * weight);
          sl_tt = dg_dt > 0 ? parseFloat((tt_tt / dg_dt).toFixed(2)) : sl_dt;
          dg_tt = dg_dt;
        }
      } else if (b.phan_loai === 'Nhan_Cong') {
        if (categoryEstimatedTotals.Nhan_Cong > 0 && actualLaborCost > 0) {
          const weight = tt_dt / categoryEstimatedTotals.Nhan_Cong;
          tt_tt = Math.round(actualLaborCost * weight);
          sl_tt = dg_dt > 0 ? parseFloat((tt_tt / dg_dt).toFixed(2)) : sl_dt;
          dg_tt = dg_dt;
        }
      } else if (b.phan_loai === 'Thau_Phu') {
        if (categoryEstimatedTotals.Thau_Phu > 0 && actualSubCost > 0) {
          const weight = tt_dt / categoryEstimatedTotals.Thau_Phu;
          tt_tt = Math.round(actualSubCost * weight);
          sl_tt = dg_dt > 0 ? parseFloat((tt_tt / dg_dt).toFixed(2)) : sl_dt;
          dg_tt = dg_dt;
        }
      } else if (b.phan_loai === 'Ca_May') {
        if (categoryEstimatedTotals.Ca_May > 0 && actualMachineryCost > 0) {
          const weight = tt_dt / categoryEstimatedTotals.Ca_May;
          tt_tt = Math.round(actualMachineryCost * weight);
          sl_tt = dg_dt > 0 ? parseFloat((tt_tt / dg_dt).toFixed(2)) : sl_dt;
          dg_tt = dg_dt;
        }
      } else if (b.phan_loai === 'Chi_Phi_Khac') {
        if (categoryEstimatedTotals.Chi_Phi_Khac > 0 && actualOtherCost > 0) {
          const weight = tt_dt / categoryEstimatedTotals.Chi_Phi_Khac;
          tt_tt = Math.round(actualOtherCost * weight);
          sl_tt = dg_dt > 0 ? parseFloat((tt_tt / dg_dt).toFixed(2)) : sl_dt;
          dg_tt = dg_dt;
        }
      }

      const chenh_lech_tien = tt_dt - tt_tt; // positive = savings, negative = over budget
      const ti_le_su_dung = tt_dt > 0 ? (tt_tt / tt_dt) * 100 : 0;
      let trang_thai = 'Xanh';
      if (ti_le_su_dung > 100) {
        trang_thai = 'Do';
      } else if (ti_le_su_dung >= 90) {
        trang_thai = 'Vang';
      }

      return {
        stt: index + 1,
        id: b.id,
        id_danh_muc_vat_tu: b.id_danh_muc_vat_tu,
        ma_hang_muc: b.ma_hang_muc,
        ten_hang_muc: b.ten_hang_muc,
        don_vi_tinh: b.don_vi_tinh,
        phan_loai: b.phan_loai,
        trang_thai_khoa: b.trang_thai_khoa,
        so_luong_du_toan: sl_dt,
        don_gia_du_toan: dg_dt,
        thanh_tien_du_toan: tt_dt,
        so_luong_thuc_te: sl_tt,
        don_gia_thuc_te: dg_tt,
        thanh_tien_thuc_te: tt_tt,
        chenh_lech_tien,
        ti_le_su_dung,
        trang_thai
      };
    });

    // 5.1. Unbudgeted actual items (Phát sinh ngoài dự toán)
    const unbudgeted_items = [];

    // A. Unbudgeted Materials:
    const budgetedMaterialIds = new Set(
      boqRows.filter(b => b.phan_loai === 'Vat_Tu' && b.id_danh_muc_vat_tu).map(b => b.id_danh_muc_vat_tu)
    );
    const budgetedMaterialCodes = new Set(
      boqRows.filter(b => b.phan_loai === 'Vat_Tu' && b.ma_hang_muc).map(b => (b.ma_hang_muc || '').toLowerCase().trim())
    );

    const [allActualMaterials] = await pool.query(
      `SELECT 
         c.id_danh_muc_vat_tu,
         v.ma_vat_tu,
         v.ten_vat_tu,
         COALESCE(v.don_vi_tinh, c.don_vi_tinh) AS don_vi_tinh,
         COALESCE(SUM(c.so_luong), 0) AS total_actual_qty,
         COALESCE(SUM(c.thanh_tien) / NULLIF(SUM(c.so_luong), 0), 0) AS avg_actual_price,
         COALESCE(SUM(c.thanh_tien), 0) AS total_actual_cost
       FROM (
         SELECT 
           pxct.id_danh_muc_vat_tu,
           COALESCE(pxct.don_vi_tinh, '') AS don_vi_tinh,
           COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) AS so_luong,
           COALESCE(pxct.don_gia, 0) AS don_gia,
           COALESCE(pxct.thanh_tien, (COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) * COALESCE(pxct.don_gia, 0))) AS thanh_tien
         FROM phieu_xuat_kho_chi_tiet pxct
         JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
         WHERE px.id_cong_trinh = ?
           AND (px.trang_thai_xuat <> 'Đã hủy' OR px.trang_thai_xuat IS NULL)
         UNION ALL
         SELECT 
           pmct.id_danh_muc_vat_tu,
           COALESCE(pmct.don_vi_tinh, '') AS don_vi_tinh,
           COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) AS so_luong,
           COALESCE(pmct.don_gia, 0) AS don_gia,
           COALESCE(pmct.thanh_tien, (COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) * COALESCE(pmct.don_gia, 0))) AS thanh_tien
         FROM phieu_mua_hang_chi_tiet pmct
         JOIN phieu_mua_hang pm ON pmct.id_phieu_mua_hang = pm.id
         WHERE pm.id_cong_trinh = ?
           AND (pm.trang_thai_giao_hang <> 'Đã hủy' OR pm.trang_thai_giao_hang IS NULL)
       ) c
       JOIN danh_muc_vat_tu v ON c.id_danh_muc_vat_tu = v.id
       WHERE c.id_danh_muc_vat_tu IS NOT NULL
       GROUP BY c.id_danh_muc_vat_tu, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh`,
      [projId, projId]
    );

    allActualMaterials.forEach(m => {
      const isBudgeted = budgetedMaterialIds.has(m.id_danh_muc_vat_tu) ||
                         (m.ma_vat_tu && budgetedMaterialCodes.has(m.ma_vat_tu.toLowerCase().trim()));
      if (!isBudgeted) {
        const qty = parseFloat(m.total_actual_qty) || 0;
        const cost = parseFloat(m.total_actual_cost) || 0;
        const price = qty > 0 ? (cost / qty) : (parseFloat(m.avg_actual_price) || 0);

        unbudgeted_items.push({
          stt: unbudgeted_items.length + 1,
          id: `unbudgeted-vt-${m.id_danh_muc_vat_tu}`,
          id_danh_muc_vat_tu: m.id_danh_muc_vat_tu,
          ma_hang_muc: m.ma_vat_tu || `VT-${m.id_danh_muc_vat_tu}`,
          ten_hang_muc: m.ten_vat_tu || 'Vật tư chưa đặt tên',
          don_vi_tinh: m.don_vi_tinh || 'Đơn vị',
          phan_loai: 'Vat_Tu',
          phan_loai_ten: 'Vật tư',
          so_luong_du_toan: 0,
          don_gia_du_toan: 0,
          thanh_tien_du_toan: 0,
          so_luong_thuc_te: qty,
          don_gia_thuc_te: price,
          thanh_tien_thuc_te: cost,
          chenh_lech_tien: -cost,
          ti_le_su_dung: 100,
          trang_thai: 'PhatSinh',
          is_unbudgeted: true,
          ghi_chu: 'Vật tư phát sinh ngoài dự toán BOQ'
        });
      }
    });

    // B. Unbudgeted Other Expenses:
    const budgetedOtherIds = new Set(
      boqRows.filter(b => b.phan_loai === 'Chi_Phi_Khac' && b.id_danh_muc_chi_phi_khac).map(b => b.id_danh_muc_chi_phi_khac)
    );
    const [actualOtherDetails] = await pool.query(
      `SELECT 
         c.id,
         c.id_danh_muc_chi_phi_khac,
         COALESCE(d.ma_chi_phi, CONCAT('CPK-', c.id)) AS ma_hang_muc,
         COALESCE(c.ten_chi_phi_khac_theo_ctr, d.ten_chi_phi, 'Chi phí khác') AS ten_hang_muc,
         COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_paid
       FROM ctr_chi_phi_khac c
       LEFT JOIN danh_muc_chi_phi_khac d ON c.id_danh_muc_chi_phi_khac = d.id
       LEFT JOIN ctr_chi_phi_khac_thanh_toan t ON c.id = t.id_ctr_chi_phi_khac
       WHERE c.id_cong_trinh = ?
       GROUP BY c.id, c.id_danh_muc_chi_phi_khac, d.ma_chi_phi, d.ten_chi_phi, c.ten_chi_phi_khac_theo_ctr`,
      [projId]
    );

    actualOtherDetails.forEach(o => {
      const paid = parseFloat(o.total_paid) || 0;
      if (paid > 0) {
        const isBudgeted = o.id_danh_muc_chi_phi_khac && budgetedOtherIds.has(o.id_danh_muc_chi_phi_khac);
        if (!isBudgeted) {
          unbudgeted_items.push({
            stt: unbudgeted_items.length + 1,
            id: `unbudgeted-cpk-${o.id}`,
            id_danh_muc_chi_phi_khac: o.id_danh_muc_chi_phi_khac,
            ma_hang_muc: o.ma_hang_muc,
            ten_hang_muc: o.ten_hang_muc,
            don_vi_tinh: 'Gói',
            phan_loai: 'Chi_Phi_Khac',
            phan_loai_ten: 'Chi phí khác',
            so_luong_du_toan: 0,
            don_gia_du_toan: 0,
            thanh_tien_du_toan: 0,
            so_luong_thuc_te: 1,
            don_gia_thuc_te: paid,
            thanh_tien_thuc_te: paid,
            chenh_lech_tien: -paid,
            ti_le_su_dung: 100,
            trang_thai: 'PhatSinh',
            is_unbudgeted: true,
            ghi_chu: 'Chi phí khác phát sinh ngoài dự toán BOQ'
          });
        }
      }
    });

    // C. Unbudgeted Labor, Subcontractor, Machinery (if 0 budget items exist for that category)
    if (categoryEstimatedTotals.Nhan_Cong === 0 && actualLaborCost > 0) {
      const [laborContracts] = await pool.query(
        `SELECT hd.id, COALESCE(nc.ho_ten, 'Nhân công khoán') AS ho_ten, COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_paid
         FROM hop_dong_nhan_cong hd
         LEFT JOIN nhan_cong nc ON hd.id_nhan_cong = nc.id
         LEFT JOIN thanh_toan_nhan_cong t ON hd.id = t.id_hop_dong_nhan_cong
         WHERE hd.id_cong_trinh = ?
         GROUP BY hd.id, nc.ho_ten`,
        [projId]
      );
      laborContracts.forEach(lc => {
        const paid = parseFloat(lc.total_paid) || 0;
        if (paid > 0) {
          unbudgeted_items.push({
            stt: unbudgeted_items.length + 1,
            id: `unbudgeted-nc-${lc.id}`,
            ma_hang_muc: `HDNC-${lc.id}`,
            ten_hang_muc: `Nhân công: ${lc.ho_ten}`,
            don_vi_tinh: 'HĐ',
            phan_loai: 'Nhan_Cong',
            phan_loai_ten: 'Nhân công',
            so_luong_du_toan: 0,
            don_gia_du_toan: 0,
            thanh_tien_du_toan: 0,
            so_luong_thuc_te: 1,
            don_gia_thuc_te: paid,
            thanh_tien_thuc_te: paid,
            chenh_lech_tien: -paid,
            ti_le_su_dung: 100,
            trang_thai: 'PhatSinh',
            is_unbudgeted: true,
            ghi_chu: 'Hợp đồng nhân công phát sinh ngoài dự toán'
          });
        }
      });
    }

    if (categoryEstimatedTotals.Thau_Phu === 0 && actualSubCost > 0) {
      const [subContracts] = await pool.query(
        `SELECT ntp.id, ntp.ten_nha_thau, ntp.noi_dung_khoan, COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_paid
         FROM nha_thau_phu ntp
         LEFT JOIN thanh_toan_thau_phu t ON ntp.id = t.id_nha_thau_phu
         WHERE ntp.id_cong_trinh = ?
         GROUP BY ntp.id, ntp.ten_nha_thau, ntp.noi_dung_khoan`,
        [projId]
      );
      subContracts.forEach(sc => {
        const paid = parseFloat(sc.total_paid) || 0;
        if (paid > 0) {
          unbudgeted_items.push({
            stt: unbudgeted_items.length + 1,
            id: `unbudgeted-tp-${sc.id}`,
            ma_hang_muc: `HDTP-${sc.id}`,
            ten_hang_muc: `Thầu phụ: ${sc.ten_nha_thau}${sc.noi_dung_khoan ? ' - ' + sc.noi_dung_khoan : ''}`,
            don_vi_tinh: 'Gói',
            phan_loai: 'Thau_Phu',
            phan_loai_ten: 'Thầu phụ',
            so_luong_du_toan: 0,
            don_gia_du_toan: 0,
            thanh_tien_du_toan: 0,
            so_luong_thuc_te: 1,
            don_gia_thuc_te: paid,
            thanh_tien_thuc_te: paid,
            chenh_lech_tien: -paid,
            ti_le_su_dung: 100,
            trang_thai: 'PhatSinh',
            is_unbudgeted: true,
            ghi_chu: 'Giao khoán thầu phụ phát sinh ngoài dự toán'
          });
        }
      });
    }

    if (categoryEstimatedTotals.Ca_May === 0 && actualMachineryCost > 0) {
      const [machineryRentals] = await pool.query(
        `SELECT cm.id, cm.ten_may, cm.nha_cung_cap, COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_paid
         FROM ca_may_thue cm
         LEFT JOIN thanh_toan_ca_may t ON cm.id = t.id_ca_may_thue
         WHERE cm.id_cong_trinh = ?
         GROUP BY cm.id, cm.ten_may, cm.nha_cung_cap`,
        [projId]
      );
      machineryRentals.forEach(cm => {
        const paid = parseFloat(cm.total_paid) || 0;
        if (paid > 0) {
          unbudgeted_items.push({
            stt: unbudgeted_items.length + 1,
            id: `unbudgeted-cm-${cm.id}`,
            ma_hang_muc: `MAY-${cm.id}`,
            ten_hang_muc: `Ca máy: ${cm.ten_may}${cm.nha_cung_cap ? ' (' + cm.nha_cung_cap + ')' : ''}`,
            don_vi_tinh: 'Ca/Tháng',
            phan_loai: 'Ca_May',
            phan_loai_ten: 'Ca máy',
            so_luong_du_toan: 0,
            don_gia_du_toan: 0,
            thanh_tien_du_toan: 0,
            so_luong_thuc_te: 1,
            don_gia_thuc_te: paid,
            thanh_tien_thuc_te: paid,
            chenh_lech_tien: -paid,
            ti_le_su_dung: 100,
            trang_thai: 'PhatSinh',
            is_unbudgeted: true,
            ghi_chu: 'Chi phí ca máy phát sinh ngoài dự toán'
          });
        }
      });
    }

    const tongTienPhatSinh = unbudgeted_items.reduce((sum, u) => sum + u.thanh_tien_thuc_te, 0);

    // 6. Category group comparison
    const groupComparison = [
      {
        nhom: '1. Chi phí Vật tư thi công',
        phan_loai: 'Vat_Tu',
        du_toan: categoryEstimatedTotals.Vat_Tu,
        thuc_te: actualMaterialCost,
        chenh_lech: categoryEstimatedTotals.Vat_Tu - actualMaterialCost,
        ti_le: categoryEstimatedTotals.Vat_Tu > 0 ? (actualMaterialCost / categoryEstimatedTotals.Vat_Tu) * 100 : 0
      },
      {
        nhom: '2. Chi phí Nhân công trực tiếp',
        phan_loai: 'Nhan_Cong',
        du_toan: categoryEstimatedTotals.Nhan_Cong,
        thuc_te: actualLaborCost,
        chenh_lech: categoryEstimatedTotals.Nhan_Cong - actualLaborCost,
        ti_le: categoryEstimatedTotals.Nhan_Cong > 0 ? (actualLaborCost / categoryEstimatedTotals.Nhan_Cong) * 100 : 0
      },
      {
        nhom: '3. Chi phí Giao khoán thầu phụ',
        phan_loai: 'Thau_Phu',
        du_toan: categoryEstimatedTotals.Thau_Phu,
        thuc_te: actualSubCost,
        chenh_lech: categoryEstimatedTotals.Thau_Phu - actualSubCost,
        ti_le: categoryEstimatedTotals.Thau_Phu > 0 ? (actualSubCost / categoryEstimatedTotals.Thau_Phu) * 100 : 0
      },
      {
        nhom: '4. Chi phí Ca máy & Thiết bị',
        phan_loai: 'Ca_May',
        du_toan: categoryEstimatedTotals.Ca_May,
        thuc_te: actualMachineryCost,
        chenh_lech: categoryEstimatedTotals.Ca_May - actualMachineryCost,
        ti_le: categoryEstimatedTotals.Ca_May > 0 ? (actualMachineryCost / categoryEstimatedTotals.Ca_May) * 100 : 0
      },
      {
        nhom: '5. Chi phí Khác công trường',
        phan_loai: 'Chi_Phi_Khac',
        du_toan: categoryEstimatedTotals.Chi_Phi_Khac,
        thuc_te: actualOtherCost,
        chenh_lech: categoryEstimatedTotals.Chi_Phi_Khac - actualOtherCost,
        ti_le: categoryEstimatedTotals.Chi_Phi_Khac > 0 ? (actualOtherCost / categoryEstimatedTotals.Chi_Phi_Khac) * 100 : 0
      }
    ];

    const tongDuToan = groupComparison.reduce((sum, g) => sum + g.du_toan, 0);
    const tongThucTe = actualMaterialCost + actualLaborCost + actualSubCost + actualMachineryCost + actualOtherCost;
    const chenhLechTong = tongDuToan - tongThucTe;
    const tiLeThucHienTong = tongDuToan > 0 ? (tongThucTe / tongDuToan) * 100 : 0;
    const loiNhuanDuToan = giaTriHopDong - tongDuToan;
    const loiNhuanThucTe = giaTriHopDong - tongThucTe;
    const soHangMucVuotDinhMuc = items.filter(i => i.trang_thai === 'Do').length;

    return res.json({
      project: {
        id: project.id,
        ten_cong_trinh: project.ten_cong_trinh,
        dia_chi: project.dia_chi,
        ten_khach_hang: project.ten_khach_hang,
        sdt_khach_hang: project.sdt_khach_hang,
        dia_chi_khach_hang: project.dia_chi_khach_hang
      },
      contract: contract ? {
        id: contract.id,
        ma_hop_dong: contract.ma_hop_dong,
        ten_hop_dong: contract.ten_hop_dong,
        ngay_ky: contract.ngay_ky,
        gia_tri_hop_dong: parseFloat(contract.gia_tri_hop_dong)
      } : null,
      summary: {
        gia_tri_hop_dong: giaTriHopDong,
        tong_du_toan: tongDuToan,
        tong_thuc_te: tongThucTe,
        chenh_lech_tong: chenhLechTong,
        ti_le_thuc_hien_tong: tiLeThucHienTong,
        loi_nhuan_du_toan: loiNhuanDuToan,
        loi_nhuan_thuc_te: loiNhuanThucTe,
        so_hang_muc_vuot_dinh_muc: soHangMucVuotDinhMuc,
        so_hang_muc_tong: items.length,
        so_hang_muc_phat_sinh: unbudgeted_items.length,
        tong_tien_phat_sinh: tongTienPhatSinh
      },
      group_comparison: groupComparison,
      items,
      unbudgeted_items
    });
  } catch (err) {
    console.error('Error generating BOQ variance report:', err);
    return res.status(500).json({ message: 'Lỗi trích xuất báo cáo phân tích dự toán: ' + err.message });
  }
});

// 9. Excel BOQ Importer
router.post('/:id/boq/import', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc']), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Vui lòng cung cấp file Excel.' });
  }

  const id_cong_trinh = req.params.id;
  const connection = await pool.getConnection();
  try {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet);

    await connection.beginTransaction();

    for (const r of rows) {
      // Map columns:
      // STT | Mã Hạng Mục | Tên Hạng Mục / Vật Tư | Đơn Vị Tính | Số Lượng Dự Toán | Đơn Giá Dự Toán | Phân Loại | Mã Chi Phí Khác (nếu có)
      const ma_hang_muc = r['Mã Hạng Mục'] || r['ma_hang_muc'];
      const ten_hang_muc = r['Tên Hạng Mục / Vật Tư'] || r['ten_hang_muc'];
      const don_vi_tinh = r['Đơn Vị Tính'] || r['don_vi_tinh'];
      const so_luong_du_toan = parseFloat(r['Số Lượng Dự Toán'] || r['so_luong_du_toan'] || 0);
      const don_gia_du_toan = parseFloat(r['Đơn Giá Dự Toán'] || r['don_gia_du_toan'] || 0);
      const phan_loai = r['Phân Loại'] || r['phan_loai']; // 'Vat_Tu', 'Nhan_Cong', 'Ca_May', 'Chi_Phi_Khac'
      const ma_chi_phi_khac = r['Mã Chi Phí Khác (nếu có)'] || r['ma_chi_phi_khac'];

      if (!ma_hang_muc || !ten_hang_muc || !phan_loai) {
        continue; // skip invalid rows
      }

      let id_danh_muc_chi_phi_khac = null;
      if (phan_loai === 'Chi_Phi_Khac' && ma_chi_phi_khac) {
        // Query category ID
        const [cat] = await connection.query('SELECT id FROM danh_muc_chi_phi_khac WHERE ma_chi_phi = ?', [ma_chi_phi_khac]);
        if (cat.length > 0) {
          id_danh_muc_chi_phi_khac = cat[0].id;
        } else {
          // Auto-insert if missing
          const [insCat] = await connection.query(
            'INSERT INTO danh_muc_chi_phi_khac (ma_chi_phi, ten_chi_phi, nguoi_tao) VALUES (?, ?, ?)',
            [ma_chi_phi_khac, ma_chi_phi_khac, req.user.ten_dang_nhap]
          );
          id_danh_muc_chi_phi_khac = insCat.insertId;
        }
      }

      // Check if duplicate in project BOQ
      const [dup] = await connection.query(
        'SELECT id FROM du_toan_boq WHERE id_cong_trinh = ? AND ma_hang_muc = ?',
        [id_cong_trinh, ma_hang_muc]
      );

      if (dup.length > 0) {
        // Update existing row
        const insertedId = dup[0].id;
        const [oldRow] = await connection.query('SELECT * FROM du_toan_boq WHERE id = ?', [insertedId]);
        await connection.query(
          `UPDATE du_toan_boq SET 
            ten_hang_muc = ?, don_vi_tinh = ?, so_luong_du_toan = ?, don_gia_du_toan = ?, phan_loai = ?, id_danh_muc_chi_phi_khac = ?
           WHERE id = ?`,
          [ten_hang_muc, don_vi_tinh, so_luong_du_toan, don_gia_du_toan, phan_loai, id_danh_muc_chi_phi_khac, insertedId]
        );
        const [newRow] = await connection.query('SELECT * FROM du_toan_boq WHERE id = ?', [insertedId]);
        await logChange(connection, 'du_toan_boq', insertedId, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);
      } else {
        // Insert new row
        const [ins] = await connection.query(
          `INSERT INTO du_toan_boq (id_cong_trinh, ma_hang_muc, ten_hang_muc, don_vi_tinh, so_luong_du_toan, don_gia_du_toan, phan_loai, id_danh_muc_chi_phi_khac, nguoi_tao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id_cong_trinh, ma_hang_muc, ten_hang_muc, don_vi_tinh, so_luong_du_toan, don_gia_du_toan, phan_loai, id_danh_muc_chi_phi_khac, req.user.ten_dang_nhap]
        );
        const insertedId = ins.insertId;
        const [newRow] = await connection.query('SELECT * FROM du_toan_boq WHERE id = ?', [insertedId]);
        await logChange(connection, 'du_toan_boq', insertedId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);
      }
    }

    await connection.commit();
    return res.status(200).json({ message: 'Import dự toán BOQ thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi import file Excel.' });
  } finally {
    connection.release();
  }
});

// 9.1. Export Excel Template for BOQ
router.get('/:id/boq/export-template', authMiddleware, async (req, res) => {
  try {
    const templateData = [
      {
        'STT': 1,
        'Mã Hạng Mục': 'HM-001',
        'Tên Hạng Mục / Vật Tư': 'Xi măng PCB40 Hoàng Thạch',
        'Đơn Vị Tính': 'Bao',
        'Số Lượng Dự Toán': 500,
        'Đơn Giá Dự Toán': 95000,
        'Phân Loại': 'Vat_Tu'
      },
      {
        'STT': 2,
        'Mã Hạng Mục': 'HM-002',
        'Tên Hạng Mục / Vật Tư': 'Nhân công ép cọc & đổ bê tông móng',
        'Đơn Vị Tính': 'Công',
        'Số Lượng Dự Toán': 120,
        'Đơn Giá Dự Toán': 350000,
        'Phân Loại': 'Nhan_Cong'
      },
      {
        'STT': 3,
        'Mã Hạng Mục': 'HM-003',
        'Tên Hạng Mục / Vật Tư': 'Giao khoán ốp lát gạch granite',
        'Đơn Vị Tính': 'm2',
        'Số Lượng Dự Toán': 250,
        'Đơn Giá Dự Toán': 180000,
        'Phân Loại': 'Thau_Phu'
      },
      {
        'STT': 4,
        'Mã Hạng Mục': 'HM-004',
        'Tên Hạng Mục / Vật Tư': 'Thuê máy xúc bánh xích 0.5m3',
        'Đơn Vị Tính': 'Ca',
        'Số Lượng Dự Toán': 15,
        'Đơn Giá Dự Toán': 3200000,
        'Phân Loại': 'Ca_May'
      },
      {
        'STT': 5,
        'Mã Hạng Mục': 'HM-005',
        'Tên Hạng Mục / Vật Tư': 'Lắp đặt điện nước tạm & bảo vệ công trường',
        'Đơn Vị Tính': 'Gói',
        'Số Lượng Dự Toán': 1,
        'Đơn Giá Dự Toán': 15000000,
        'Phân Loại': 'Chi_Phi_Khac'
      }
    ];

    const ws = xlsx.utils.json_to_sheet(templateData);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Mau_Du_Toan_BOQ');

    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Du_Toan_BOQ.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  } catch (err) {
    console.error('Error generating BOQ template:', err);
    return res.status(500).json({ message: 'Lỗi khi tạo file mẫu dự toán: ' + err.message });
  }
});

// 10. Báo cáo Tổng hợp Chi phí & Hiệu quả Công trình theo Hợp đồng
router.get('/:id/bao-cao-hieu-qua', authMiddleware, async (req, res) => {
  const projId = req.params.id;
  try {
    // 1. Get project info
    const [projRows] = await pool.query(
      `SELECT c.*, k.ten_khach_hang, k.so_dien_thoai AS sdt_khach_hang, k.dia_chi AS dia_chi_khach_hang
       FROM cong_trinh c
       LEFT JOIN khach_hang k ON c.id_khach_hang = k.id
       WHERE c.id = ?`,
      [projId]
    );
    if (projRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy công trình.' });
    }
    const project = projRows[0];

    // 2. Get contract info
    const [contractRows] = await pool.query(
      `SELECT * FROM hop_dong WHERE id_cong_trinh = ? AND da_xoa = 0 ORDER BY id DESC LIMIT 1`,
      [projId]
    );
    const contract = contractRows[0] || null;

    // Percentages & Contract Value
    let giaTriHopDong = contract ? parseFloat(contract.gia_tri_hop_dong) : parseFloat(project.tong_ngan_sach || 0);
    let tiLeQuanLy = contract ? parseFloat(contract.ti_le_chi_phi_quan_ly || 3.00) : 3.00;
    let tiLeKiemToan = contract ? parseFloat(contract.ti_le_thanh_tra_kiem_toan || 1.00) : 1.00;
    let tiLeThue = contract ? parseFloat(contract.ti_le_thue_vat_tndn || 5.00) : 5.00;
    let tiLeTimViec = contract ? parseFloat(contract.ti_le_chi_phi_tim_viec || 10.00) : 10.00;
    let chiPhiTimViecCoDinh = contract ? parseFloat(contract.chi_phi_tim_viec_co_dinh || 0) : 0;
    let loaiTinhTimViec = contract ? (contract.loai_tinh_chi_phi_tim_viec || 'phan_tram') : 'phan_tram';

    // Allow query overrides for simulation
    if (req.query.gia_tri_hop_dong !== undefined) giaTriHopDong = parseFloat(req.query.gia_tri_hop_dong) || 0;
    if (req.query.ti_le_quan_ly !== undefined) tiLeQuanLy = parseFloat(req.query.ti_le_quan_ly) || 0;
    if (req.query.ti_le_kiem_toan !== undefined) tiLeKiemToan = parseFloat(req.query.ti_le_kiem_toan) || 0;
    if (req.query.ti_le_thue !== undefined) tiLeThue = parseFloat(req.query.ti_le_thue) || 0;
    if (req.query.ti_le_tim_viec !== undefined) tiLeTimViec = parseFloat(req.query.ti_le_tim_viec) || 0;
    if (req.query.chi_phi_tim_viec_co_dinh !== undefined) chiPhiTimViecCoDinh = parseFloat(req.query.chi_phi_tim_viec_co_dinh) || 0;
    if (req.query.loai_tinh_tim_viec !== undefined) loaiTinhTimViec = req.query.loai_tinh_tim_viec;

    // 3. Query Actual Material Costs (phieu_xuat_kho + phieu_mua_hang giao thang)
    const [matExportRows] = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(ct.thanh_tien, ct.so_luong * ct.don_gia, 0)), 0) AS total_xuat
       FROM phieu_xuat_kho_chi_tiet ct
       JOIN phieu_xuat_kho px ON ct.id_phieu_xuat_kho = px.id
       WHERE px.id_cong_trinh = ?`,
      [projId]
    );
    const [matPORows] = await pool.query(
      `SELECT COALESCE(SUM(pmh.tong_tien), 0) AS total_po
       FROM phieu_mua_hang pmh
       WHERE pmh.id_cong_trinh = ?`,
      [projId]
    );
    const chiPhiVatTu = (parseFloat(matExportRows[0]?.total_xuat) || 0) + (parseFloat(matPORows[0]?.total_po) || 0);

    // 4. Query Actual Labor Costs
    const [laborRows] = await pool.query(
      `SELECT COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_labor
       FROM thanh_toan_nhan_cong t
       JOIN hop_dong_nhan_cong hd ON t.id_hop_dong_nhan_cong = hd.id
       WHERE hd.id_cong_trinh = ?`,
      [projId]
    );
    const chiPhiNhanCong = parseFloat(laborRows[0]?.total_labor) || 0;

    // 5. Query Actual Subcontractor Costs
    const [subRows] = await pool.query(
      `SELECT COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_sub
       FROM thanh_toan_thau_phu t
       JOIN nha_thau_phu ntp ON t.id_nha_thau_phu = ntp.id
       WHERE ntp.id_cong_trinh = ?`,
      [projId]
    );
    const chiPhiThauPhu = parseFloat(subRows[0]?.total_sub) || 0;

    // 6. Query Actual Machinery Costs
    const [macRows] = await pool.query(
      `SELECT COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_mac
       FROM thanh_toan_ca_may t
       JOIN ca_may_thue cm ON t.id_ca_may_thue = cm.id
       WHERE cm.id_cong_trinh = ?`,
      [projId]
    );
    const chiPhiCaMay = parseFloat(macRows[0]?.total_mac) || 0;

    // 7. Query Actual Other Project Expenses
    const [otherRows] = await pool.query(
      `SELECT COALESCE(SUM(t.so_tien_thanh_toan), 0) AS total_other
       FROM ctr_chi_phi_khac_thanh_toan t
       JOIN ctr_chi_phi_khac c ON t.id_ctr_chi_phi_khac = c.id
       WHERE c.id_cong_trinh = ?`,
      [projId]
    );
    const chiPhiKhacTrucTiep = parseFloat(otherRows[0]?.total_other) || 0;

    // Chi phí khác = Thầu phụ + Ca máy + Chi phí khác công trường
    const chiPhiKhac = chiPhiThauPhu + chiPhiCaMay + chiPhiKhacTrucTiep;

    // Tổng chi thực tế (1+2+3)
    const tongChiThucTe = chiPhiVatTu + chiPhiNhanCong + chiPhiKhac;

    // Chi phí gián tiếp
    const chiPhiQuanLy = Math.round(giaTriHopDong * (tiLeQuanLy / 100));
    const chiPhiThanhTraKiemToan = Math.round(giaTriHopDong * (tiLeKiemToan / 100));
    const thueVatTNDN = Math.round(giaTriHopDong * (tiLeThue / 100));
    let chiPhiTimViec = 0;
    if (loaiTinhTimViec === 'so_tien_co_dinh') {
      chiPhiTimViec = chiPhiTimViecCoDinh;
    } else {
      chiPhiTimViec = Math.round(giaTriHopDong * (tiLeTimViec / 100));
    }

    // Tổng cộng chi phí toàn diện
    const tongCong = tongChiThucTe + chiPhiQuanLy + chiPhiThanhTraKiemToan + thueVatTNDN + chiPhiTimViec;

    // Còn lại (Lợi nhuận ròng)
    const conLai = giaTriHopDong - tongCong;

    return res.json({
      project: {
        id: project.id,
        ten_cong_trinh: project.ten_cong_trinh,
        dia_chi: project.dia_chi,
        ten_khach_hang: project.ten_khach_hang,
        sdt_khach_hang: project.sdt_khach_hang,
        dia_chi_khach_hang: project.dia_chi_khach_hang
      },
      contract: contract ? {
        id: contract.id,
        ma_hop_dong: contract.ma_hop_dong,
        ten_hop_dong: contract.ten_hop_dong,
        ngay_ky: contract.ngay_ky,
        gia_tri_hop_dong: parseFloat(contract.gia_tri_hop_dong)
      } : null,
      parameters: {
        gia_tri_hop_dong: giaTriHopDong,
        ti_le_chi_phi_quan_ly: tiLeQuanLy,
        ti_le_thanh_tra_kiem_toan: tiLeKiemToan,
        ti_le_thue_vat_tndn: tiLeThue,
        ti_le_chi_phi_tim_viec: tiLeTimViec,
        chi_phi_tim_viec_co_dinh: chiPhiTimViecCoDinh,
        loai_tinh_chi_phi_tim_viec: loaiTinhTimViec
      },
      actual_costs: {
        chi_phi_vat_tu: chiPhiVatTu,
        chi_phi_nhan_cong: chiPhiNhanCong,
        chi_phi_khac: chiPhiKhac,
        chi_tiet_khac: {
          thau_phu: chiPhiThauPhu,
          ca_may: chiPhiCaMay,
          chi_phi_khac_truc_tiep: chiPhiKhacTrucTiep
        },
        tong_chi_thuc_te: tongChiThucTe
      },
      indirect_costs: {
        chi_phi_quan_ly: chiPhiQuanLy,
        chi_phi_thanh_tra_kiem_toan: chiPhiThanhTraKiemToan,
        thue_vat_tndn: thueVatTNDN,
        chi_phi_tim_viec: chiPhiTimViec
      },
      summary: {
        gia_tri_hop_dong: giaTriHopDong,
        tong_chi_thuc_te: tongChiThucTe,
        tong_cong: tongCong,
        con_lai: conLai
      }
    });
  } catch (err) {
    console.error('Error calculating project profitability report:', err);
    return res.status(500).json({ message: 'Lỗi tính toán báo cáo hiệu quả công trình.' });
  }
});

// 11. Lưu cấu hình tỷ lệ % báo cáo hiệu quả cho Hợp đồng / Công trình
router.put('/:id/cau-hinh-hieu-qua', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Ke_Toan', 'Admin']), async (req, res) => {
  const projId = req.params.id;
  const {
    gia_tri_hop_dong,
    ti_le_chi_phi_quan_ly,
    ti_le_thanh_tra_kiem_toan,
    ti_le_thue_vat_tndn,
    ti_le_chi_phi_tim_viec,
    chi_phi_tim_viec_co_dinh,
    loai_tinh_chi_phi_tim_viec
  } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [contractRows] = await connection.query(
      `SELECT id FROM hop_dong WHERE id_cong_trinh = ? AND da_xoa = 0 ORDER BY id DESC LIMIT 1`,
      [projId]
    );

    if (contractRows.length > 0) {
      const contractId = contractRows[0].id;
      await connection.query(
        `UPDATE hop_dong SET
          ti_le_chi_phi_quan_ly = ?,
          ti_le_thanh_tra_kiem_toan = ?,
          ti_le_thue_vat_tndn = ?,
          ti_le_chi_phi_tim_viec = ?,
          chi_phi_tim_viec_co_dinh = ?,
          loai_tinh_chi_phi_tim_viec = ?
         WHERE id = ?`,
        [
          ti_le_chi_phi_quan_ly !== undefined ? parseFloat(ti_le_chi_phi_quan_ly) : 3.00,
          ti_le_thanh_tra_kiem_toan !== undefined ? parseFloat(ti_le_thanh_tra_kiem_toan) : 1.00,
          ti_le_thue_vat_tndn !== undefined ? parseFloat(ti_le_thue_vat_tndn) : 5.00,
          ti_le_chi_phi_tim_viec !== undefined ? parseFloat(ti_le_chi_phi_tim_viec) : 10.00,
          chi_phi_tim_viec_co_dinh !== undefined ? parseFloat(chi_phi_tim_viec_co_dinh) : 0,
          loai_tinh_chi_phi_tim_viec || 'phan_tram',
          contractId
        ]
      );
    } else {
      // If project has no contract yet, update project tong_ngan_sach if provided
      if (gia_tri_hop_dong !== undefined) {
        await connection.query(
          `UPDATE cong_trinh SET tong_ngan_sach = ? WHERE id = ?`,
          [parseFloat(gia_tri_hop_dong) || 0, projId]
        );
      }
    }

    await connection.commit();
    return res.json({ message: 'Đã lưu cấu hình tham số báo cáo hiệu quả thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error saving profitability settings:', err);
    return res.status(500).json({ message: 'Lỗi khi lưu cấu hình tham số: ' + err.message });
  } finally {
    connection.release();
  }
});

// 12. Báo cáo Tổng hợp Phòng Kế hoạch & Cung ứng Vật tư (Tất cả chi phí thuộc công trình)
router.get('/:id/bao-cao-tong-hop-vat-tu-chi-phi', authMiddleware, async (req, res) => {
  const projId = req.params.id;
  try {
    const [projRows] = await pool.query(
      `SELECT c.*, k.ten_khach_hang 
       FROM cong_trinh c 
       LEFT JOIN khach_hang k ON c.id_khach_hang = k.id 
       WHERE c.id = ?`,
      [projId]
    );
    if (projRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy công trình.' });
    }
    const project = projRows[0];

    const items = [];

    // 1. Lấy Vật tư thực tế
    const [matRows] = await pool.query(
      `SELECT 
         c.id_danh_muc_vat_tu,
         v.ma_vat_tu,
         COALESCE(v.ten_vat_tu, 'Vật tư thi công') AS ten_vat_tu,
         COALESCE(v.don_vi_tinh, c.don_vi_tinh, '') AS don_vi_tinh,
         SUM(c.so_luong) AS so_luong,
         SUM(c.thanh_tien) AS thanh_tien
       FROM (
         SELECT 
           pxct.id_danh_muc_vat_tu,
           COALESCE(pxct.don_vi_tinh, '') AS don_vi_tinh,
           COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) AS so_luong,
           COALESCE(pxct.thanh_tien, (COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) * COALESCE(pxct.don_gia, 0))) AS thanh_tien
         FROM phieu_xuat_kho_chi_tiet pxct
         JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
         WHERE px.id_cong_trinh = ?
           AND (px.trang_thai_xuat <> 'Đã hủy' OR px.trang_thai_xuat IS NULL)
         UNION ALL
         SELECT 
           pmct.id_danh_muc_vat_tu,
           COALESCE(pmct.don_vi_tinh, '') AS don_vi_tinh,
           COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) AS so_luong,
           COALESCE(pmct.thanh_tien, (COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) * COALESCE(pmct.don_gia, 0))) AS thanh_tien
         FROM phieu_mua_hang_chi_tiet pmct
         JOIN phieu_mua_hang pm ON pmct.id_phieu_mua_hang = pm.id
         WHERE pm.id_cong_trinh = ?
           AND (pm.trang_thai_giao_hang <> 'Đã hủy' OR pm.trang_thai_giao_hang IS NULL)
       ) c
       LEFT JOIN danh_muc_vat_tu v ON c.id_danh_muc_vat_tu = v.id
       GROUP BY c.id_danh_muc_vat_tu, v.ma_vat_tu, v.ten_vat_tu, COALESCE(v.don_vi_tinh, c.don_vi_tinh, '')
       HAVING SUM(c.so_luong) > 0 OR SUM(c.thanh_tien) > 0
       ORDER BY v.ten_vat_tu ASC`,
      [projId, projId]
    );

    if (matRows.length > 0) {
      matRows.forEach(m => {
        items.push({
          ten_vat_tu: m.ten_vat_tu || 'Vật tư công trình',
          don_vi_tinh: m.don_vi_tinh || '',
          so_luong: parseFloat(m.so_luong) || 0,
          thanh_tien: parseFloat(m.thanh_tien) || 0,
          ghi_chu: '',
          is_vat_tu: true
        });
      });
    } else {
      // Fallback lấy danh mục BOQ Vật tư nếu chưa xuất kho
      const [boqMatRows] = await pool.query(
        `SELECT b.*, v.ten_vat_tu 
         FROM du_toan_boq b 
         LEFT JOIN danh_muc_vat_tu v ON b.id_danh_muc_vat_tu = v.id 
         WHERE b.id_cong_trinh = ? AND b.phan_loai = 'Vat_Tu' 
         ORDER BY b.id ASC`,
        [projId]
      );
      boqMatRows.forEach(b => {
        const sl = parseFloat(b.so_luong_du_toan) || 0;
        const dg = parseFloat(b.don_gia_du_toan) || 0;
        items.push({
          ten_vat_tu: b.ten_vat_tu || b.ten_hang_muc || 'Vật tư',
          don_vi_tinh: b.don_vi_tinh || '',
          so_luong: sl,
          thanh_tien: sl * dg,
          ghi_chu: '',
          is_vat_tu: true
        });
      });
    }

    // 2. Nhân công
    const [labRows] = await pool.query(
      `SELECT 
         hd.id,
         CONCAT('Nhân công: ', COALESCE(nc.ho_ten, nc.ten_to_doi, CONCAT('HĐ khoán #', hd.id))) AS ten_chi_phi,
         COALESCE(SUM(t.so_tien_thanh_toan), hd.gia_tri_hop_dong, 0) AS thanh_tien,
         GROUP_CONCAT(DISTINCT t.ghi_chu SEPARATOR '; ') AS ghi_chu
       FROM hop_dong_nhan_cong hd
       LEFT JOIN nhan_cong nc ON hd.id_nhan_cong = nc.id
       LEFT JOIN thanh_toan_nhan_cong t ON hd.id = t.id_hop_dong_nhan_cong
       WHERE hd.id_cong_trinh = ?
       GROUP BY hd.id, nc.ho_ten, nc.ten_to_doi, hd.gia_tri_hop_dong`,
      [projId]
    );
    if (labRows.length > 0) {
      labRows.forEach(l => {
        if (parseFloat(l.thanh_tien) > 0) {
          items.push({
            ten_vat_tu: l.ten_chi_phi,
            don_vi_tinh: '',
            so_luong: null,
            thanh_tien: parseFloat(l.thanh_tien) || 0,
            ghi_chu: l.ghi_chu || '',
            is_vat_tu: false
          });
        }
      });
    } else {
      const [boqLabRows] = await pool.query(
        `SELECT * FROM du_toan_boq WHERE id_cong_trinh = ? AND phan_loai = 'Nhan_Cong'`,
        [projId]
      );
      boqLabRows.forEach(b => {
        const tt = (parseFloat(b.so_luong_du_toan) || 0) * (parseFloat(b.don_gia_du_toan) || 0);
        if (tt > 0) {
          items.push({
            ten_vat_tu: b.ten_hang_muc,
            don_vi_tinh: '',
            so_luong: null,
            thanh_tien: tt,
            ghi_chu: '',
            is_vat_tu: false
          });
        }
      });
    }

    // 3. Thầu phụ
    const [subRows] = await pool.query(
      `SELECT 
         ntp.id,
         CONCAT('Thầu phụ: ', COALESCE(ntp.ten_nha_thau, ntp.noi_dung_khoan, 'Giao khoán')) AS ten_chi_phi,
         COALESCE(SUM(t.so_tien_thanh_toan), ntp.gia_tri_hop_dong, 0) AS thanh_tien,
         GROUP_CONCAT(DISTINCT t.ghi_chu SEPARATOR '; ') AS ghi_chu
       FROM nha_thau_phu ntp
       LEFT JOIN thanh_toan_thau_phu t ON ntp.id = t.id_nha_thau_phu
       WHERE ntp.id_cong_trinh = ?
       GROUP BY ntp.id, ntp.ten_nha_thau, ntp.noi_dung_khoan, ntp.gia_tri_hop_dong`,
      [projId]
    );
    if (subRows.length > 0) {
      subRows.forEach(s => {
        if (parseFloat(s.thanh_tien) > 0) {
          items.push({
            ten_vat_tu: s.ten_chi_phi,
            don_vi_tinh: '',
            so_luong: null,
            thanh_tien: parseFloat(s.thanh_tien) || 0,
            ghi_chu: s.ghi_chu || '',
            is_vat_tu: false
          });
        }
      });
    } else {
      const [boqSubRows] = await pool.query(
        `SELECT * FROM du_toan_boq WHERE id_cong_trinh = ? AND phan_loai = 'Thau_Phu'`,
        [projId]
      );
      boqSubRows.forEach(b => {
        const tt = (parseFloat(b.so_luong_du_toan) || 0) * (parseFloat(b.don_gia_du_toan) || 0);
        if (tt > 0) {
          items.push({
            ten_vat_tu: b.ten_hang_muc,
            don_vi_tinh: '',
            so_luong: null,
            thanh_tien: tt,
            ghi_chu: '',
            is_vat_tu: false
          });
        }
      });
    }

    // 4. Ca máy & Thiết bị
    const [macRows] = await pool.query(
      `SELECT 
         cm.id,
         CONCAT('Ca máy: ', COALESCE(cm.ten_may, 'Thuê ca máy')) AS ten_chi_phi,
         COALESCE(SUM(t.so_tien_thanh_toan), cm.tong_tien, 0) AS thanh_tien,
         GROUP_CONCAT(DISTINCT t.ghi_chu SEPARATOR '; ') AS ghi_chu
       FROM ca_may_thue cm
       LEFT JOIN thanh_toan_ca_may t ON cm.id = t.id_ca_may_thue
       WHERE cm.id_cong_trinh = ?
       GROUP BY cm.id, cm.ten_may, cm.tong_tien`,
      [projId]
    );
    if (macRows.length > 0) {
      macRows.forEach(m => {
        if (parseFloat(m.thanh_tien) > 0) {
          items.push({
            ten_vat_tu: m.ten_chi_phi,
            don_vi_tinh: '',
            so_luong: null,
            thanh_tien: parseFloat(m.thanh_tien) || 0,
            ghi_chu: m.ghi_chu || '',
            is_vat_tu: false
          });
        }
      });
    } else {
      const [boqMacRows] = await pool.query(
        `SELECT * FROM du_toan_boq WHERE id_cong_trinh = ? AND phan_loai = 'Ca_May'`,
        [projId]
      );
      boqMacRows.forEach(b => {
        const tt = (parseFloat(b.so_luong_du_toan) || 0) * (parseFloat(b.don_gia_du_toan) || 0);
        if (tt > 0) {
          items.push({
            ten_vat_tu: b.ten_hang_muc,
            don_vi_tinh: '',
            so_luong: null,
            thanh_tien: tt,
            ghi_chu: '',
            is_vat_tu: false
          });
        }
      });
    }

    // 5. Chi phí khác công trường
    const [otherRows] = await pool.query(
      `SELECT 
         c.id,
         COALESCE(c.ten_chi_phi_khac_theo_ctr, d.ten_chi_phi, 'Chi phí khác công trường') AS ten_chi_phi,
         COALESCE(SUM(t.so_tien_thanh_toan), c.tong_tien, 0) AS thanh_tien,
         COALESCE(c.ghi_chu, '') AS ghi_chu
       FROM ctr_chi_phi_khac c
       LEFT JOIN danh_muc_chi_phi_khac d ON c.id_danh_muc_chi_phi_khac = d.id
       LEFT JOIN ctr_chi_phi_khac_thanh_toan t ON c.id = t.id_ctr_chi_phi_khac
       WHERE c.id_cong_trinh = ?
       GROUP BY c.id, c.ten_chi_phi_khac_theo_ctr, d.ten_chi_phi, c.tong_tien, c.ghi_chu`,
      [projId]
    );
    if (otherRows.length > 0) {
      otherRows.forEach(o => {
        if (parseFloat(o.thanh_tien) > 0) {
          items.push({
            ten_vat_tu: o.ten_chi_phi,
            don_vi_tinh: '',
            so_luong: null,
            thanh_tien: parseFloat(o.thanh_tien) || 0,
            ghi_chu: o.ghi_chu || '',
            is_vat_tu: false
          });
        }
      });
    } else {
      const [boqOtherRows] = await pool.query(
        `SELECT * FROM du_toan_boq WHERE id_cong_trinh = ? AND phan_loai = 'Chi_Phi_Khac'`,
        [projId]
      );
      boqOtherRows.forEach(b => {
        const tt = (parseFloat(b.so_luong_du_toan) || 0) * (parseFloat(b.don_gia_du_toan) || 0);
        if (tt > 0) {
          items.push({
            ten_vat_tu: b.ten_hang_muc,
            don_vi_tinh: '',
            so_luong: null,
            thanh_tien: tt,
            ghi_chu: '',
            is_vat_tu: false
          });
        }
      });
    }

    const tong_cong = items.reduce((sum, it) => sum + (parseFloat(it.thanh_tien) || 0), 0);

    return res.json({
      project: {
        id: project.id,
        ten_cong_trinh: project.ten_cong_trinh,
        dia_chi: project.dia_chi,
        ten_khach_hang: project.ten_khach_hang
      },
      items,
      tong_cong
    });
  } catch (err) {
    console.error('Error fetching material & cost summary report:', err);
    return res.status(500).json({ message: 'Lỗi trích xuất bảng tổng hợp chi phí: ' + err.message });
  }
});

module.exports = router;


