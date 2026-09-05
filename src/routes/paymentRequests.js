const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');
const { generateSequenceNumber } = require('../services/sequenceService');

const uploadsDir = path.join(__dirname, '../../public/uploads/dntt');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Helper to fix UTF-8 filenames improperly decoded as latin1 by multer
function fixUtf8FileName(str) {
  if (!str || typeof str !== 'string') return '';
  try {
    if ([...str].some(c => c.charCodeAt(0) > 255)) {
      return str;
    }
    const decoded = Buffer.from(str, 'latin1').toString('utf8');
    if (decoded && !decoded.includes('\uFFFD') && decoded !== str) {
      return decoded;
    }
    return str;
  } catch (e) {
    return str;
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const originalName = fixUtf8FileName(file.originalname);
    const ext = path.extname(originalName) || path.extname(file.originalname);
    cb(null, 'dntt-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage });

// Helper to create DNTT progress notification for requester
async function createDnttNotification(connOrPool, id_dntt, ma_phieu, nguoi_nhan, loai_thong_bao, tieu_de, noi_dung) {
  if (!nguoi_nhan) return;
  try {
    await connOrPool.query(`
      INSERT INTO thong_bao_de_nghi_thanh_toan (
        id_de_nghi_thanh_toan, ma_phieu, nguoi_nhan, loai_thong_bao, tieu_de, noi_dung, da_xem
      ) VALUES (?, ?, ?, ?, ?, ?, 0)
    `, [id_dntt, ma_phieu, nguoi_nhan, loai_thong_bao, tieu_de, noi_dung || '']);
  } catch (err) {
    console.warn('Error creating DNTT notification:', err.message);
  }
}

// Helper to notify multiple recipients without duplicates
async function notifyRecipients(connOrPool, id_dntt, ma_phieu, recipients, loai_thong_bao, tieu_de, noi_dung) {
  if (!Array.isArray(recipients)) return;
  const uniqueRecipients = [...new Set(recipients.filter(r => r && typeof r === 'string' && r.trim() !== ''))];
  for (const r of uniqueRecipients) {
    await createDnttNotification(connOrPool, id_dntt, ma_phieu, r.trim(), loai_thong_bao, tieu_de, noi_dung);
  }
}

function getUserRoles(user) {
  if (!user || !user.vai_tro) return [];
  return Array.isArray(user.vai_tro) ? user.vai_tro : user.vai_tro.split(',').map(r => r.trim());
}

function hasAnyRole(userRoles, targetRoles) {
  if (userRoles.includes('Admin')) return true;
  return targetRoles.some(r => userRoles.includes(r));
}

// =========================================================================
// 0. NOTIFICATIONS REALTIME & COUNT (THÔNG BÁO TIẾN ĐỘ & CHỜ DUYỆT)
// =========================================================================

// GET /api/de-nghi-thanh-toan/thong-bao/count
router.get('/thong-bao/count', authMiddleware, async (req, res) => {
  try {
    const username = req.user?.ten_dang_nhap || '';
    const userRoles = getUserRoles(req.user);

    const canApproveTbp = hasAnyRole(userRoles, ['Admin', 'Ban_Giam_Doc', 'Quan_Ly', 'Truong_Phong', 'Truong_Bo_Phan', 'Ban_Quan_Ly', 'Ke_Hoach', 'Ky_Thuat', 'Vat_Tu', 'Kinh_Doanh']);
    const canApproveKt = hasAnyRole(userRoles, ['Admin', 'Ban_Giam_Doc', 'Ke_Toan']);
    const canApproveGdtc = hasAnyRole(userRoles, ['Admin', 'Ban_Giam_Doc', 'Giam_Doc_Tai_Chinh', 'Giam_Doc']);

    let tbp_count = 0;
    let kt_count = 0;
    let gdtc_count = 0;

    if (canApproveTbp) {
      const [tbpRows] = await pool.query(`SELECT COUNT(*) AS count FROM de_nghi_thanh_toan WHERE trang_thai = 'Cho_TBP_Duyet' AND COALESCE(da_xoa, 0) = 0`);
      tbp_count = tbpRows[0]?.count || 0;
    }

    if (canApproveKt) {
      const [ktRows] = await pool.query(`SELECT COUNT(*) AS count FROM de_nghi_thanh_toan WHERE trang_thai = 'Cho_Ke_Toan_Kiem_Tra' AND COALESCE(da_xoa, 0) = 0`);
      kt_count = ktRows[0]?.count || 0;
    }

    if (canApproveGdtc) {
      const [gdtcRows] = await pool.query(`SELECT COUNT(*) AS count FROM de_nghi_thanh_toan WHERE trang_thai = 'Cho_GDTC_Duyet' AND COALESCE(da_xoa, 0) = 0`);
      gdtc_count = gdtcRows[0]?.count || 0;
    }

    // Requester unread notifications count
    let my_notifications_unread_count = 0;
    if (username) {
      const [unreadRows] = await pool.query(`
        SELECT COUNT(*) AS count 
        FROM thong_bao_de_nghi_thanh_toan 
        WHERE nguoi_nhan = ? AND COALESCE(da_xem, 0) = 0
      `, [username]);
      my_notifications_unread_count = unreadRows[0]?.count || 0;
    }

    const total_count = tbp_count + kt_count + gdtc_count + my_notifications_unread_count;
    const has_approval_permission = canApproveTbp || canApproveKt || canApproveGdtc;

    res.json({
      total_count,
      tbp_count,
      kt_count,
      gdtc_count,
      my_notifications_unread_count,
      has_approval_permission,
      canApproveTbp,
      canApproveKt,
      canApproveGdtc
    });
  } catch (err) {
    console.error('Error in DNTT notification count:', err);
    res.status(500).json({ message: 'Lỗi lấy số lượng thông báo: ' + err.message });
  }
});

// GET /api/de-nghi-thanh-toan/thong-bao/list
router.get('/thong-bao/list', authMiddleware, async (req, res) => {
  try {
    const username = req.user?.ten_dang_nhap || '';
    const userRoles = getUserRoles(req.user);

    const canApproveTbp = hasAnyRole(userRoles, ['Admin', 'Ban_Giam_Doc', 'Quan_Ly', 'Truong_Phong', 'Truong_Bo_Phan', 'Ban_Quan_Ly', 'Ke_Hoach', 'Ky_Thuat', 'Vat_Tu', 'Kinh_Doanh']);
    const canApproveKt = hasAnyRole(userRoles, ['Admin', 'Ban_Giam_Doc', 'Ke_Toan']);
    const canApproveGdtc = hasAnyRole(userRoles, ['Admin', 'Ban_Giam_Doc', 'Giam_Doc_Tai_Chinh', 'Giam_Doc']);

    let tbp_list = [];
    let kt_list = [];
    let gdtc_list = [];

    if (canApproveTbp) {
      const [rows] = await pool.query(`
        SELECT d.id, d.ma_phieu, d.nguoi_de_nghi, d.so_tien, d.noi_dung_thanh_toan, d.ngay_de_nghi, d.ten_nguoi_thu_huong, d.trang_thai, d.nguoi_tao,
               l.ten_lvkd, c.ten_cong_trinh
        FROM de_nghi_thanh_toan d
        LEFT JOIN linh_vuc_kinh_doanh l ON d.id_linh_vuc_kinh_doanh = l.id
        LEFT JOIN cong_trinh c ON d.id_cong_trinh = c.id
        WHERE d.trang_thai = 'Cho_TBP_Duyet' AND COALESCE(d.da_xoa, 0) = 0
        ORDER BY d.id DESC
        LIMIT 20
      `);
      tbp_list = rows;
    }

    if (canApproveKt) {
      const [rows] = await pool.query(`
        SELECT d.id, d.ma_phieu, d.nguoi_de_nghi, d.so_tien, d.noi_dung_thanh_toan, d.ngay_de_nghi, d.ten_nguoi_thu_huong, d.trang_thai, d.tbp_nguoi_duyet, d.tbp_ngay_duyet, d.nguoi_tao,
               l.ten_lvkd, c.ten_cong_trinh
        FROM de_nghi_thanh_toan d
        LEFT JOIN linh_vuc_kinh_doanh l ON d.id_linh_vuc_kinh_doanh = l.id
        LEFT JOIN cong_trinh c ON d.id_cong_trinh = c.id
        WHERE d.trang_thai = 'Cho_Ke_Toan_Kiem_Tra' AND COALESCE(d.da_xoa, 0) = 0
        ORDER BY d.id DESC
        LIMIT 20
      `);
      kt_list = rows;
    }

    if (canApproveGdtc) {
      const [rows] = await pool.query(`
        SELECT d.id, d.ma_phieu, d.nguoi_de_nghi, d.so_tien, d.noi_dung_thanh_toan, d.ngay_de_nghi, d.ten_nguoi_thu_huong, d.trang_thai, d.kt_nguoi_kiem_tra, d.kt_ngay_kiem_tra, d.nguoi_tao,
               l.ten_lvkd, c.ten_cong_trinh
        FROM de_nghi_thanh_toan d
        LEFT JOIN linh_vuc_kinh_doanh l ON d.id_linh_vuc_kinh_doanh = l.id
        LEFT JOIN cong_trinh c ON d.id_cong_trinh = c.id
        WHERE d.trang_thai = 'Cho_GDTC_Duyet' AND COALESCE(d.da_xoa, 0) = 0
        ORDER BY d.id DESC
        LIMIT 20
      `);
      gdtc_list = rows;
    }

    // Fetch notifications for requester
    let my_notifications = [];
    if (username) {
      const [rows] = await pool.query(`
        SELECT tb.*, d.so_tien, d.ten_nguoi_thu_huong, d.trang_thai AS dntt_trang_thai
        FROM thong_bao_de_nghi_thanh_toan tb
        LEFT JOIN de_nghi_thanh_toan d ON tb.id_de_nghi_thanh_toan = d.id
        WHERE tb.nguoi_nhan = ?
        ORDER BY tb.id DESC
        LIMIT 30
      `, [username]);
      my_notifications = rows;
    }

    res.json({
      tbp_list,
      kt_list,
      gdtc_list,
      my_notifications
    });
  } catch (err) {
    console.error('Error in DNTT notification list:', err);
    res.status(500).json({ message: 'Lỗi lấy danh sách thông báo: ' + err.message });
  }
});

// PUT /api/de-nghi-thanh-toan/thong-bao/:id/read
router.put('/thong-bao/:id/read', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE thong_bao_de_nghi_thanh_toan SET da_xem = 1 WHERE id = ? AND nguoi_nhan = ?', [req.params.id, req.user?.ten_dang_nhap || '']);
    res.json({ message: 'Đã đánh dấu xem thông báo.' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi: ' + err.message });
  }
});

// PUT /api/de-nghi-thanh-toan/thong-bao/read-all
router.put('/thong-bao/read-all', authMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE thong_bao_de_nghi_thanh_toan SET da_xem = 1 WHERE nguoi_nhan = ?', [req.user?.ten_dang_nhap || '']);
    res.json({ message: 'Đã đánh dấu xem tất cả thông báo.' });
  } catch (err) {
    res.status(500).json({ message: 'Lỗi: ' + err.message });
  }
});

// =========================================================================
// 1. MASTER DATA: DANH MỤC LOẠI CHỨNG TỪ & LOẠI CHI PHÍ ĐNTT
// =========================================================================

// GET /api/de-nghi-thanh-toan/danh-muc/loai-chung-tu
router.get('/danh-muc/loai-chung-tu', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM danh_muc_loai_chung_tu_dntt WHERE trang_thai = 'hoat_dong' ORDER BY thu_tu ASC, id ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching doc types:', err);
    res.status(500).json({ message: 'Lỗi tải danh mục loại chứng từ: ' + err.message });
  }
});

// POST /api/de-nghi-thanh-toan/danh-muc/loai-chung-tu
router.post('/danh-muc/loai-chung-tu', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  try {
    const { ma_loai, ten_loai, mo_ta, thu_tu } = req.body;
    if (!ma_loai || !ten_loai) {
      return res.status(400).json({ message: 'Mã loại và Tên loại chứng từ là bắt buộc.' });
    }

    const [existing] = await pool.query('SELECT id FROM danh_muc_loai_chung_tu_dntt WHERE ma_loai = ?', [ma_loai.trim()]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Mã loại chứng từ này đã tồn tại.' });
    }

    const [result] = await pool.query(
      `INSERT INTO danh_muc_loai_chung_tu_dntt (ma_loai, ten_loai, mo_ta, thu_tu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?)`,
      [ma_loai.trim(), ten_loai.trim(), mo_ta || '', parseInt(thu_tu, 10) || 0, req.user?.ten_dang_nhap || 'system']
    );

    const [newRow] = await pool.query('SELECT * FROM danh_muc_loai_chung_tu_dntt WHERE id = ?', [result.insertId]);
    res.status(201).json(newRow[0]);
  } catch (err) {
    console.error('Error creating doc type:', err);
    res.status(500).json({ message: 'Lỗi tạo loại chứng từ: ' + err.message });
  }
});

// PUT /api/de-nghi-thanh-toan/danh-muc/loai-chung-tu/:id
router.put('/danh-muc/loai-chung-tu/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  try {
    const { ten_loai, mo_ta, thu_tu, trang_thai } = req.body;
    await pool.query(
      `UPDATE danh_muc_loai_chung_tu_dntt
       SET ten_loai = ?, mo_ta = ?, thu_tu = ?, trang_thai = ?
       WHERE id = ?`,
      [ten_loai, mo_ta || '', parseInt(thu_tu, 10) || 0, trang_thai || 'hoat_dong', req.params.id]
    );
    const [updated] = await pool.query('SELECT * FROM danh_muc_loai_chung_tu_dntt WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (err) {
    console.error('Error updating doc type:', err);
    res.status(500).json({ message: 'Lỗi cập nhật loại chứng từ: ' + err.message });
  }
});

// DELETE /api/de-nghi-thanh-toan/danh-muc/loai-chung-tu/:id
router.delete('/danh-muc/loai-chung-tu/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT * FROM danh_muc_loai_chung_tu_dntt WHERE id = ?', [id]);
    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Không tìm thấy loại chứng từ.' });
    }

    // Check if used in cau_hinh_chi_phi_chung_tu
    const [cfgRows] = await connection.query('SELECT COUNT(*) as cnt FROM cau_hinh_chi_phi_chung_tu WHERE id_loai_chung_tu = ?', [id]);
    if (cfgRows[0]?.cnt > 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'Không thể xóa loại chứng từ này vì đang được cấu hình trong các loại chi phí.' });
    }

    // Check if used in files
    const [fileRows] = await connection.query('SELECT COUNT(*) as cnt FROM files WHERE id_loai_chung_tu = ?', [id]);
    if (fileRows[0]?.cnt > 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'Không thể xóa loại chứng từ này vì đã có file đính kèm ĐNTT liên kết.' });
    }

    await connection.query('DELETE FROM danh_muc_loai_chung_tu_dntt WHERE id = ?', [id]);
    await connection.commit();
    res.json({ message: 'Đã xóa loại chứng từ thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting doc type:', err);
    res.status(500).json({ message: 'Lỗi xóa loại chứng từ: ' + err.message });
  } finally {
    connection.release();
  }
});

// GET /api/de-nghi-thanh-toan/danh-muc/loai-chi-phi (with required docs)
router.get('/danh-muc/loai-chi-phi', authMiddleware, async (req, res) => {
  try {
    const [costTypes] = await pool.query(
      `SELECT * FROM danh_muc_loai_chi_phi_dntt WHERE trang_thai = 'hoat_dong' ORDER BY thu_tu ASC, id ASC`
    );

    const [configs] = await pool.query(`
      SELECT c.*, dt.ma_loai, dt.ten_loai
      FROM cau_hinh_chi_phi_chung_tu c
      JOIN danh_muc_loai_chung_tu_dntt dt ON c.id_loai_chung_tu = dt.id
      WHERE dt.trang_thai = 'hoat_dong'
      ORDER BY dt.thu_tu ASC, dt.id ASC
    `);

    const result = costTypes.map(ct => {
      const docs = configs
        .filter(cfg => cfg.id_loai_chi_phi === ct.id)
        .map(cfg => ({
          id_loai_chung_tu: cfg.id_loai_chung_tu,
          ma_loai: cfg.ma_loai,
          ten_loai: cfg.ten_loai,
          bat_buoc: !!cfg.bat_buoc,
          ghi_chu: cfg.ghi_chu
        }));
      return {
        ...ct,
        requiredDocs: docs
      };
    });

    res.json(result);
  } catch (err) {
    console.error('Error fetching cost types:', err);
    res.status(500).json({ message: 'Lỗi tải danh mục loại chi phí: ' + err.message });
  }
});

// POST /api/de-nghi-thanh-toan/danh-muc/loai-chi-phi
router.post('/danh-muc/loai-chi-phi', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { ma_loai_chi_phi, ten_loai_chi_phi, mo_ta, thu_tu, required_docs } = req.body;

    if (!ma_loai_chi_phi || !ten_loai_chi_phi) {
      await connection.rollback();
      return res.status(400).json({ message: 'Mã loại và Tên loại chi phí là bắt buộc.' });
    }

    const [existing] = await connection.query('SELECT id FROM danh_muc_loai_chi_phi_dntt WHERE ma_loai_chi_phi = ?', [ma_loai_chi_phi.trim()]);
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'Mã loại chi phí này đã tồn tại.' });
    }

    const [insertResult] = await connection.query(
      `INSERT INTO danh_muc_loai_chi_phi_dntt (ma_loai_chi_phi, ten_loai_chi_phi, mo_ta, thu_tu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?)`,
      [ma_loai_chi_phi.trim(), ten_loai_chi_phi.trim(), mo_ta || '', parseInt(thu_tu, 10) || 0, req.user?.ten_dang_nhap || 'system']
    );

    const costTypeId = insertResult.insertId;

    if (Array.isArray(required_docs)) {
      for (const doc of required_docs) {
        if (doc.id_loai_chung_tu) {
          await connection.query(
            `INSERT INTO cau_hinh_chi_phi_chung_tu (id_loai_chi_phi, id_loai_chung_tu, bat_buoc, ghi_chu)
             VALUES (?, ?, ?, ?)`,
            [costTypeId, doc.id_loai_chung_tu, doc.bat_buoc ? 1 : 0, doc.ghi_chu || '']
          );
        }
      }
    }

    await connection.commit();
    res.status(201).json({ id: costTypeId, ma_loai_chi_phi, ten_loai_chi_phi });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating cost type:', err);
    res.status(500).json({ message: 'Lỗi tạo loại chi phí: ' + err.message });
  } finally {
    connection.release();
  }
});

// PUT /api/de-nghi-thanh-toan/danh-muc/loai-chi-phi/:id
router.put('/danh-muc/loai-chi-phi/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { ten_loai_chi_phi, mo_ta, thu_tu, trang_thai, required_docs } = req.body;
    const costTypeId = req.params.id;

    await connection.query(
      `UPDATE danh_muc_loai_chi_phi_dntt
       SET ten_loai_chi_phi = ?, mo_ta = ?, thu_tu = ?, trang_thai = ?
       WHERE id = ?`,
      [ten_loai_chi_phi, mo_ta || '', parseInt(thu_tu, 10) || 0, trang_thai || 'hoat_dong', costTypeId]
    );

    if (Array.isArray(required_docs)) {
      await connection.query('DELETE FROM cau_hinh_chi_phi_chung_tu WHERE id_loai_chi_phi = ?', [costTypeId]);
      for (const doc of required_docs) {
        if (doc.id_loai_chung_tu) {
          await connection.query(
            `INSERT INTO cau_hinh_chi_phi_chung_tu (id_loai_chi_phi, id_loai_chung_tu, bat_buoc, ghi_chu)
             VALUES (?, ?, ?, ?)`,
            [costTypeId, doc.id_loai_chung_tu, doc.bat_buoc ? 1 : 0, doc.ghi_chu || '']
          );
        }
      }
    }

    await connection.commit();
    res.json({ message: 'Cập nhật loại chi phí và cấu hình chứng từ thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error updating cost type:', err);
    res.status(500).json({ message: 'Lỗi cập nhật loại chi phí: ' + err.message });
  } finally {
    connection.release();
  }
});

// DELETE /api/de-nghi-thanh-toan/danh-muc/loai-chi-phi/:id
router.delete('/danh-muc/loai-chi-phi/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT * FROM danh_muc_loai_chi_phi_dntt WHERE id = ?', [id]);
    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Không tìm thấy loại chi phí.' });
    }

    // Check if used in de_nghi_thanh_toan
    const [dnttRows] = await connection.query('SELECT COUNT(*) as cnt FROM de_nghi_thanh_toan WHERE id_loai_chi_phi = ? AND COALESCE(da_xoa, 0) = 0', [id]);
    if (dnttRows[0]?.cnt > 0) {
      await connection.rollback();
      return res.status(400).json({ message: `Không thể xóa loại chi phí này vì đang có ${dnttRows[0].cnt} Đề nghị thanh toán liên kết.` });
    }

    await connection.query('DELETE FROM cau_hinh_chi_phi_chung_tu WHERE id_loai_chi_phi = ?', [id]);
    await connection.query('DELETE FROM danh_muc_loai_chi_phi_dntt WHERE id = ?', [id]);
    await connection.commit();
    res.json({ message: 'Đã xóa loại chi phí thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting cost type:', err);
    res.status(500).json({ message: 'Lỗi xóa loại chi phí: ' + err.message });
  } finally {
    connection.release();
  }
});

// =========================================================================
// 2. EXACT MATCH LOOKUP CHO KẾ TOÁN (Gõ đúng 100% mã chứng từ gốc)
// =========================================================================
// GET /api/de-nghi-thanh-toan/check-exact-doc?code=...
router.get('/check-exact-doc', authMiddleware, async (req, res) => {
  try {
    const rawCode = req.query.code ? req.query.code.trim() : '';
    if (!rawCode) {
      return res.status(400).json({ found: false, message: 'Vui lòng nhập mã chứng từ.' });
    }

    // 1. Check in phieu_mua_hang (PO)
    const [poRows] = await pool.query(
      `SELECT p.id, p.ma_phieu_mua AS ma, p.tong_tien, COALESCE(p.da_thanh_toan, 0) AS da_thanh_toan,
              (p.tong_tien - COALESCE(p.da_thanh_toan, 0)) AS con_lai, p.ngay_mua AS ngay,
              ncc.ten_nha_cung_cap AS ten_doi_tuong, ncc.so_tai_khoan, ncc.ten_ngan_hang,
              p.ghi_chu
       FROM phieu_mua_hang p
       LEFT JOIN nha_cung_cap ncc ON p.id_nha_cung_cap = ncc.id
       WHERE p.ma_phieu_mua = ?`,
      [rawCode]
    );
    if (poRows.length > 0) {
      const row = poRows[0];
      return res.json({
        found: true,
        type: 'phieu_mua_hang',
        typeLabel: 'Phiếu Mua Hàng (PO)',
        id: row.id,
        ma: row.ma,
        ten_doi_tuong: row.ten_doi_tuong,
        so_tai_khoan: row.so_tai_khoan,
        ten_ngan_hang: row.ten_ngan_hang,
        tong_tien: parseFloat(row.tong_tien) || 0,
        da_thanh_toan: parseFloat(row.da_thanh_toan) || 0,
        con_lai: parseFloat(row.con_lai) || 0,
        ngay: row.ngay,
        ghi_chu: row.ghi_chu
      });
    }

    // 2. Check in cong_no_khac_ncc (Dịch vụ ngoài PO)
    const [nonPoRows] = await pool.query(
      `SELECT k.id, k.ma_chung_tu AS ma, k.so_tien AS tong_tien, COALESCE(k.da_thanh_toan, 0) AS da_thanh_toan,
              (k.so_tien - COALESCE(k.da_thanh_toan, 0)) AS con_lai, k.ngay_phat_sinh AS ngay,
              ncc.ten_nha_cung_cap AS ten_doi_tuong, ncc.so_tai_khoan, ncc.ten_ngan_hang,
              k.dien_giai AS ghi_chu
       FROM cong_no_khac_ncc k
       LEFT JOIN nha_cung_cap ncc ON k.id_nha_cung_cap = ncc.id
       WHERE k.ma_chung_tu = ?`,
      [rawCode]
    );
    if (nonPoRows.length > 0) {
      const row = nonPoRows[0];
      return res.json({
        found: true,
        type: 'cong_no_khac_ncc',
        typeLabel: 'Khoản Nợ Dịch Vụ Ngoài PO',
        id: row.id,
        ma: row.ma,
        ten_doi_tuong: row.ten_doi_tuong,
        so_tai_khoan: row.so_tai_khoan,
        ten_ngan_hang: row.ten_ngan_hang,
        tong_tien: parseFloat(row.tong_tien) || 0,
        da_thanh_toan: parseFloat(row.da_thanh_toan) || 0,
        con_lai: parseFloat(row.con_lai) || 0,
        ngay: row.ngay,
        ghi_chu: row.ghi_chu
      });
    }

    // 3. Check in hop_dong
    const [hdRows] = await pool.query(
      `SELECT h.id, h.ma_hop_dong AS ma, h.gia_tri_hop_dong AS tong_tien, h.da_thanh_toan, h.con_lai, h.ngay_ky AS ngay,
              COALESCE(kh.ten_khach_hang, h.ten_hop_dong) AS ten_doi_tuong,
              h.ghi_chu
       FROM hop_dong h
       LEFT JOIN khach_hang kh ON h.id_khach_hang = kh.id
       WHERE h.ma_hop_dong = ? AND h.da_xoa = 0`,
      [rawCode]
    );
    if (hdRows.length > 0) {
      const row = hdRows[0];
      return res.json({
        found: true,
        type: 'hop_dong',
        typeLabel: 'Hợp Đồng Kinh Tế',
        id: row.id,
        ma: row.ma,
        ten_doi_tuong: row.ten_doi_tuong,
        tong_tien: parseFloat(row.tong_tien) || 0,
        da_thanh_toan: parseFloat(row.da_thanh_toan) || 0,
        con_lai: parseFloat(row.con_lai) || 0,
        ngay: row.ngay,
        ghi_chu: row.ghi_chu
      });
    }

    // 4. Check in don_hang (Bán hàng)
    const [dhRows] = await pool.query(
      `SELECT d.id, d.ma_don_hang AS ma, d.tong_tien, d.so_tien_da_thanh_toan AS da_thanh_toan,
              d.so_tien_con_lai AS con_lai, d.ngay_dat_hang AS ngay,
              kh.ten_khach_hang AS ten_doi_tuong
       FROM don_hang d
       LEFT JOIN khach_hang kh ON d.id_khach_hang = kh.id
       WHERE d.ma_don_hang = ? AND d.trang_thai_don_hang != 'Đã hủy'`,
      [rawCode]
    );
    if (dhRows.length > 0) {
      const row = dhRows[0];
      return res.json({
        found: true,
        type: 'don_hang',
        typeLabel: 'Đơn Hàng Bán',
        id: row.id,
        ma: row.ma,
        ten_doi_tuong: row.ten_doi_tuong,
        tong_tien: parseFloat(row.tong_tien) || 0,
        da_thanh_toan: parseFloat(row.da_thanh_toan) || 0,
        con_lai: parseFloat(row.con_lai) || 0,
        ngay: row.ngay,
        ghi_chu: ''
      });
    }

    return res.json({ found: false, message: 'Không tìm thấy chứng từ nào khớp chính xác với mã đã nhập.' });
  } catch (err) {
    console.error('Error checking exact doc:', err);
    res.status(500).json({ message: 'Lỗi tra cứu chứng từ gốc: ' + err.message });
  }
});

// =========================================================================
// 3. ĐỀ NGHỊ THANH TOÁN (CRUD & FILTERS & KPI)
// =========================================================================

// GET /api/de-nghi-thanh-toan: List with Filters, Pagination, and KPI
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      id_linh_vuc_kinh_doanh,
      id_cong_trinh,
      trang_thai,
      id_loai_chi_phi,
      search,
      tu_ngay,
      den_ngay,
      page = 1,
      limit = 10
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE d.da_xoa = 0';
    const params = [];

    if (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') {
      whereClause += ' AND d.id_linh_vuc_kinh_doanh = ?';
      params.push(id_linh_vuc_kinh_doanh);
    }
    if (id_cong_trinh && id_cong_trinh !== 'all') {
      whereClause += ' AND d.id_cong_trinh = ?';
      params.push(id_cong_trinh);
    }
    if (id_loai_chi_phi && id_loai_chi_phi !== 'all') {
      whereClause += ' AND d.id_loai_chi_phi = ?';
      params.push(id_loai_chi_phi);
    }
    if (trang_thai && trang_thai !== 'all') {
      whereClause += ' AND d.trang_thai = ?';
      params.push(trang_thai);
    }
    if (tu_ngay) {
      whereClause += ' AND d.ngay_de_nghi >= ?';
      params.push(tu_ngay);
    }
    if (den_ngay) {
      whereClause += ' AND d.ngay_de_nghi <= ?';
      params.push(den_ngay);
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereClause += ' AND (d.ma_phieu LIKE ? OR d.ten_nguoi_thu_huong LIKE ? OR d.noi_dung_thanh_toan LIKE ? OR d.nguoi_de_nghi LIKE ?)';
      params.push(term, term, term, term);
    }

    // 1. Total matching count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM de_nghi_thanh_toan d ${whereClause}`,
      params
    );
    const total = countResult[0]?.total || 0;

    // 2. Fetch paginated list
    const [rows] = await pool.query(`
      SELECT d.*,
             lvkd.ten_lvkd, lvkd.ma_lvkd,
             ctr.ten_cong_trinh,
             (SELECT COUNT(*) FROM de_nghi_thanh_toan_file WHERE id_de_nghi_thanh_toan = d.id) AS file_count,
             (SELECT COUNT(*) FROM de_nghi_thanh_toan_file WHERE id_de_nghi_thanh_toan = d.id AND trang_thai_kiem_tra = 'Dat') AS file_dat_count,
             (SELECT COUNT(*) FROM de_nghi_thanh_toan_file WHERE id_de_nghi_thanh_toan = d.id AND trang_thai_kiem_tra = 'Khong_Dat') AS file_khong_dat_count
      FROM de_nghi_thanh_toan d
      LEFT JOIN linh_vuc_kinh_doanh lvkd ON d.id_linh_vuc_kinh_doanh = lvkd.id
      LEFT JOIN cong_trinh ctr ON d.id_cong_trinh = ctr.id
      ${whereClause}
      ORDER BY d.id DESC
      LIMIT ? OFFSET ?
    `, [...params, limitNum, offset]);

    // 3. KPI Calculations
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    let kpiWhere = 'WHERE da_xoa = 0';
    const kpiParams = [];
    if (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') {
      kpiWhere += ' AND id_linh_vuc_kinh_doanh = ?';
      kpiParams.push(id_linh_vuc_kinh_doanh);
    }

    const [kpiRows] = await pool.query(`
      SELECT
        COUNT(CASE WHEN trang_thai IN ('Cho_TBP_Duyet', 'Cho_Ke_Toan_Kiem_Tra', 'Cho_GDTC_Duyet') THEN 1 END) AS cho_duyet_count,
        COALESCE(SUM(CASE WHEN trang_thai IN ('Cho_TBP_Duyet', 'Cho_Ke_Toan_Kiem_Tra', 'Cho_GDTC_Duyet') THEN so_tien ELSE 0 END), 0) AS cho_duyet_amount,
        COUNT(CASE WHEN trang_thai = 'Da_Duyet_Cho_Chi' THEN 1 END) AS da_duyet_cho_chi_count,
        COALESCE(SUM(CASE WHEN trang_thai = 'Da_Duyet_Cho_Chi' THEN so_tien ELSE 0 END), 0) AS da_duyet_cho_chi_amount,
        COUNT(CASE WHEN trang_thai = 'Da_Thanh_Toan' AND DATE_FORMAT(ngay_de_nghi, '%Y-%m') = ? THEN 1 END) AS da_chi_thang_count,
        COALESCE(SUM(CASE WHEN trang_thai = 'Da_Thanh_Toan' AND DATE_FORMAT(ngay_de_nghi, '%Y-%m') = ? THEN so_tien ELSE 0 END), 0) AS da_chi_thang_amount,
        COUNT(CASE WHEN trang_thai = 'Tu_Choi' THEN 1 END) AS tu_choi_count
      FROM de_nghi_thanh_toan
      ${kpiWhere}
    `, [currentMonth, currentMonth, ...kpiParams]);

    res.json({
      list: rows,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      summary: kpiRows[0] || {}
    });
  } catch (err) {
    console.error('Error fetching payment requests:', err);
    res.status(500).json({ message: 'Lỗi tải danh sách đề nghị thanh toán: ' + err.message });
  }
});

// Helper to save files to `files` table for phieu_thu_chi
async function savePtcUploadedFiles(connection, id_phieu_thu_chi, reqFiles, nguoi_tao) {
  if (!reqFiles || !Array.isArray(reqFiles) || reqFiles.length === 0) return [];
  
  const savedRecords = [];
  for (const file of reqFiles) {
    const originalName = fixUtf8FileName(file.originalname) || 'unnamed_file';
    const savedName = file.filename;
    const ext = path.extname(originalName).replace('.', '').toLowerCase() || 'bin';
    
    let loaiFile = 'other';
    const mime = file.mimetype || '';
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      loaiFile = 'image';
    } else if (ext === 'pdf') {
      loaiFile = 'pdf';
    } else if (['doc', 'docx'].includes(ext)) {
      loaiFile = 'word';
    } else if (['xls', 'xlsx', 'csv'].includes(ext)) {
      loaiFile = 'excel';
    }

    const duongDan = `/public/uploads/dntt/${savedName}`;
    const kichThuoc = file.size || 0;

    const [res] = await connection.query(
      `INSERT INTO files (ten_bang, id_ban_ghi, ten_file, ten_file_luu, loai_file, extension, duong_dan, kich_thuoc, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['phieu_thu_chi', id_phieu_thu_chi, originalName, savedName, loaiFile, ext, duongDan, kichThuoc, nguoi_tao]
    );

    savedRecords.push({
      id: res.insertId,
      ten_bang: 'phieu_thu_chi',
      id_ban_ghi: id_phieu_thu_chi,
      ten_file: originalName,
      ten_file_luu: savedName,
      loai_file: loaiFile,
      extension: ext,
      duong_dan: duongDan,
      kich_thuoc: kichThuoc,
      nguoi_tao
    });
  }
  return savedRecords;
}

// GET /api/de-nghi-thanh-toan/:id: Detail of single ĐNTT with files
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.*,
             lvkd.ten_lvkd, lvkd.ma_lvkd,
             lvkd.ten_cong_ty, lvkd.dia_chi AS dia_chi_lvkd, lvkd.dien_thoai AS dien_thoai_lvkd,
             lvkd.ma_so_thue AS mst_lvkd, lvkd.logo_url AS logo_lvkd,
             ctr.ten_cong_trinh,
             ptc.ma_phieu AS ptc_ma_phieu, ptc.hinh_thuc_thanh_toan AS ptc_hinh_thuc, ptc.id_quy_tien AS ptc_id_quy,
             q.ten_quy AS ptc_ten_quy
      FROM de_nghi_thanh_toan d
      LEFT JOIN linh_vuc_kinh_doanh lvkd ON d.id_linh_vuc_kinh_doanh = lvkd.id
      LEFT JOIN cong_trinh ctr ON d.id_cong_trinh = ctr.id
      LEFT JOIN phieu_thu_chi ptc ON d.id_phieu_thu_chi = ptc.id
      LEFT JOIN quy_tien q ON ptc.id_quy_tien = q.id
      WHERE d.id = ? AND d.da_xoa = 0
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đề nghị thanh toán.' });
    }

    const dntt = rows[0];

    // Fetch files attached to DNTT
    const [files] = await pool.query(`
      SELECT f.*, dt.ma_loai AS doc_ma_loai
      FROM de_nghi_thanh_toan_file f
      LEFT JOIN danh_muc_loai_chung_tu_dntt dt ON f.id_loai_chung_tu = dt.id
      WHERE f.id_de_nghi_thanh_toan = ?
      ORDER BY dt.thu_tu ASC, f.id ASC
    `, [req.params.id]);

    dntt.files = (files || []).map(f => ({
      ...f,
      ten_file: fixUtf8FileName(f.ten_file)
    }));

    // Fetch files attached to linked Phiếu Chi (from `files` table where `ten_bang = 'phieu_thu_chi'`)
    if (dntt.id_phieu_thu_chi) {
      const [ptcFiles] = await pool.query(`
        SELECT * FROM files
        WHERE ten_bang = 'phieu_thu_chi' AND id_ban_ghi = ?
        ORDER BY id ASC
      `, [dntt.id_phieu_thu_chi]);
      dntt.phieu_chi_files = (ptcFiles || []).map(f => ({
        ...f,
        ten_file: fixUtf8FileName(f.ten_file)
      }));
    } else {
      dntt.phieu_chi_files = [];
    }

    res.json(dntt);
  } catch (err) {
    console.error('Error fetching payment request detail:', err);
    res.status(500).json({ message: 'Lỗi tải chi tiết đề nghị thanh toán: ' + err.message });
  }
});

// POST /api/de-nghi-thanh-toan: Create Payment Request with Files
router.post('/', authMiddleware, upload.any(), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      ngay_de_nghi,
      han_thanh_toan,
      id_linh_vuc_kinh_doanh,
      id_cong_trinh,
      id_loai_chi_phi,
      ten_loai_chi_phi,
      nguoi_de_nghi,
      bo_phan_de_nghi,
      ten_nguoi_thu_huong,
      so_tai_khoan,
      ten_ngan_hang,
      chi_nhanh_ngan_hang,
      so_tien,
      so_tien_bang_chu,
      hinh_thuc_de_xuat,
      noi_dung_thanh_toan,
      lan_thanh_toan_so,
      ghi_chu,
      files_metadata // JSON string array of { fileIndex, id_loai_chung_tu, ten_loai_chung_tu }
    } = req.body;

    const amount = parseFloat(so_tien);
    if (isNaN(amount) || amount <= 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'Số tiền thanh toán phải lớn hơn 0.' });
    }
    if (!id_loai_chi_phi || !ten_nguoi_thu_huong || !noi_dung_thanh_toan) {
      await connection.rollback();
      return res.status(400).json({ message: 'Vui lòng điền đầy đủ Loại chi phí, Đơn vị thụ hưởng và Nội dung thanh toán.' });
    }

    const reqDate = ngay_de_nghi || new Date().toISOString().split('T')[0];
    const nam = new Date(reqDate).getFullYear();

    // Get LVKD Code
    const [lvkdRows] = await connection.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [id_linh_vuc_kinh_doanh || 1]);
    const ma_lvkd = lvkdRows[0]?.ma_lvkd || 'LVKD';

    // Sequence Generator for DNTT
    const seq = await generateSequenceNumber(connection, {
      id_linh_vuc_kinh_doanh: id_linh_vuc_kinh_doanh || 1,
      loai_chung_tu: 'DNTT',
      nam,
      ma_lvkd
    });

    const [dnttResult] = await connection.query(`
      INSERT INTO de_nghi_thanh_toan (
        ma_phieu, so_vao_so, nam, ngay_de_nghi, han_thanh_toan,
        id_linh_vuc_kinh_doanh, id_cong_trinh, id_loai_chi_phi, ten_loai_chi_phi,
        nguoi_de_nghi, bo_phan_de_nghi, ten_nguoi_thu_huong, so_tai_khoan, ten_ngan_hang, chi_nhanh_ngan_hang,
        so_tien, so_tien_bang_chu, hinh_thuc_de_xuat, noi_dung_thanh_toan, lan_thanh_toan_so, ghi_chu,
        trang_thai, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Cho_TBP_Duyet', ?)
    `, [
      seq.ma_phieu,
      seq.so_vao_so,
      nam,
      reqDate,
      han_thanh_toan || null,
      id_linh_vuc_kinh_doanh || 1,
      id_cong_trinh || null,
      id_loai_chi_phi,
      ten_loai_chi_phi || '',
      nguoi_de_nghi || req.user?.ten_dang_nhap || 'N/A',
      bo_phan_de_nghi || '',
      ten_nguoi_thu_huong,
      so_tai_khoan || '',
      ten_ngan_hang || '',
      chi_nhanh_ngan_hang || '',
      amount,
      so_tien_bang_chu || '',
      hinh_thuc_de_xuat || 'Chuyen_Khoan',
      noi_dung_thanh_toan,
      parseInt(lan_thanh_toan_so, 10) || 1,
      ghi_chu || '',
      req.user?.ten_dang_nhap || 'system'
    ]);

    const dnttId = dnttResult.insertId;

    // Handle files uploaded
    let metaList = [];
    if (files_metadata) {
      try {
        metaList = typeof files_metadata === 'string' ? JSON.parse(files_metadata) : files_metadata;
      } catch (e) {
        console.warn('Error parsing files_metadata:', e);
      }
    }

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const meta = metaList[i] || {};
        const id_loai_chung_tu = meta.id_loai_chung_tu || 1;
        const ten_loai_chung_tu = meta.ten_loai_chung_tu || 'Chứng từ';

        const fileUrl = `/public/uploads/dntt/${file.filename}`;
        await connection.query(`
          INSERT INTO de_nghi_thanh_toan_file (
            id_de_nghi_thanh_toan, id_loai_chung_tu, ten_loai_chung_tu, ten_file, duong_dan, dung_luong, nguoi_tai_len
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          dnttId,
          id_loai_chung_tu,
          ten_loai_chung_tu,
          fixUtf8FileName(file.originalname),
          fileUrl,
          file.size,
          req.user?.ten_dang_nhap || 'system'
        ]);
      }
    }

    await logChange(connection, 'de_nghi_thanh_toan', dnttId, 'THEM_MOI', null, { id: dnttId, ma_phieu: seq.ma_phieu, so_tien: amount }, req.user?.ten_dang_nhap || 'system');

    await connection.commit();

    try {
      const io = req.app.get('io');
      if (io) io.emit('payment_request_updated', { action: 'create', id: dnttId, ma_phieu: seq.ma_phieu, trang_thai: 'Cho_TBP_Duyet' });
    } catch (e) {}

    res.status(201).json({
      message: `Tạo đề nghị thanh toán ${seq.ma_phieu} thành công!`,
      id: dnttId,
      ma_phieu: seq.ma_phieu
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating payment request:', err);
    res.status(500).json({ message: 'Lỗi tạo đề nghị thanh toán: ' + err.message });
  } finally {
    connection.release();
  }
});

// DELETE /api/de-nghi-thanh-toan/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query('SELECT * FROM de_nghi_thanh_toan WHERE id = ? AND COALESCE(da_xoa, 0) = 0 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy đề nghị thanh toán cần xóa.' });
    }

    const dntt = rows[0];

    // Check if already paid or has generated phieu_chi
    if (dntt.trang_thai === 'Da_Thanh_Toan' || dntt.id_phieu_thu_chi) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        message: `Không thể xóa Đề nghị thanh toán "${dntt.ma_phieu}" vì đã được chi tiền hoàn tất (Phiếu chi: ${dntt.ma_phieu_chi || '#' + dntt.id_phieu_thu_chi}).`
      });
    }

    // Check if linked with active phieu_thu_chi
    const [linkedPtc] = await connection.query(
      'SELECT id, ma_phieu FROM phieu_thu_chi WHERE (id_chung_tu = ? AND loai_chung_tu_lien_ket = "de_nghi_thanh_toan") AND COALESCE(da_xoa, 0) = 0',
      [dntt.id]
    );
    if (linkedPtc.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        message: `Không thể xóa Đề nghị thanh toán "${dntt.ma_phieu}" vì đang liên kết với Phiếu Chi ${linkedPtc.map(p => p.ma_phieu).join(', ')}. Vui lòng hủy phiếu chi trước!`
      });
    }

    // Soft delete: da_xoa = 1
    await connection.query('UPDATE de_nghi_thanh_toan SET da_xoa = 1 WHERE id = ?', [dntt.id]);
    await logChange(connection, 'de_nghi_thanh_toan', dntt.id, 'XOA', dntt, { da_xoa: 1 }, req.user?.ten_dang_nhap || 'system');

    await connection.commit();

    try {
      const io = req.app.get('io');
      if (io) io.emit('payment_request_updated', { action: 'delete', id: req.params.id });
    } catch (e) {}

    return res.json({ message: `Đã xóa đề nghị thanh toán "${dntt.ma_phieu}" thành công.` });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting payment request:', err);
    return res.status(500).json({ message: 'Lỗi khi xóa đề nghị thanh toán: ' + err.message });
  } finally {
    connection.release();
  }
});

// =========================================================================
// 4. PHÊ DUYỆT ĐA CẤP & KIỂM TRA CHỨNG TỪ (BƯỚC 2, BƯỚC 3, BƯỚC 5)
// =========================================================================

// PUT /api/de-nghi-thanh-toan/:id/tbp-duyet: Bước 2 - Trưởng bộ phận duyệt
router.put('/:id/tbp-duyet', authMiddleware, async (req, res) => {
  try {
    const { action, y_kien } = req.body; // action: 'approve' | 'reject' | 'skip'
    const id = req.params.id;

    const [dnttRows] = await pool.query('SELECT * FROM de_nghi_thanh_toan WHERE id = ? AND da_xoa = 0', [id]);
    if (dnttRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đề nghị thanh toán.' });
    }

    const dntt = dnttRows[0];
    let newStatus = 'Cho_Ke_Toan_Kiem_Tra';
    let lyDo = null;

    if (action === 'reject') {
      newStatus = 'Tu_Choi';
      lyDo = y_kien || 'Trưởng bộ phận từ chối duyệt';
    }

    await pool.query(`
      UPDATE de_nghi_thanh_toan
      SET trang_thai = ?,
          tbp_nguoi_duyet = ?,
          tbp_ngay_duyet = NOW(),
          tbp_y_kien = ?,
          ly_do_tu_choi = ?
      WHERE id = ?
    `, [newStatus, req.user?.ten_dang_nhap || 'system', y_kien || '', lyDo, id]);

    // Create notification
    if (action === 'reject') {
      await notifyRecipients(
        pool,
        id,
        dntt.ma_phieu,
        [dntt.nguoi_tao],
        'TBP_TU_CHOI',
        `Trưởng bộ phận từ chối duyệt ${dntt.ma_phieu}`,
        `Đề nghị thanh toán ${dntt.ma_phieu} đã bị từ chối duyệt. Lý do: ${lyDo}`
      );
    } else {
      await notifyRecipients(
        pool,
        id,
        dntt.ma_phieu,
        [dntt.nguoi_tao],
        'TBP_DUYET',
        `Trưởng bộ phận đã duyệt ${dntt.ma_phieu}`,
        `Đề nghị thanh toán ${dntt.ma_phieu} đã được duyệt và chuyển sang Kế toán kiểm tra hồ sơ.`
      );
    }

    try {
      const io = req.app.get('io');
      if (io) io.emit('payment_request_updated', { action: 'tbp_duyet', id, trang_thai: newStatus });
    } catch (e) {}

    res.json({
      message: action === 'reject' ? 'Đã từ chối đề nghị thanh toán.' : 'Trưởng bộ phận đã duyệt thành công, chuyển Kế toán kiểm tra.',
      trang_thai: newStatus
    });
  } catch (err) {
    console.error('Error in TBP approval:', err);
    res.status(500).json({ message: 'Lỗi phê duyệt trưởng bộ phận: ' + err.message });
  }
});

// PUT /api/de-nghi-thanh-toan/:id/kt-kiem-tra: Bước 3 - Kế toán chi phí kiểm tra từng file & Gắn mã gốc exact
router.put('/:id/kt-kiem-tra', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const id = req.params.id;
    const {
      action, // 'submit_gdtc' | 'return_to_requester'
      y_kien,
      evaluations, // array of { file_id, trang_thai_kiem_tra: 'Dat'|'Khong_Dat', ghi_chu_kiem_tra }
      ma_chung_tu_goc,
      loai_chung_tu_goc,
      id_chung_tu_goc,
      id_loai_chung_tu_goc
    } = req.body;

    const [dnttRows] = await connection.query('SELECT * FROM de_nghi_thanh_toan WHERE id = ? AND da_xoa = 0', [id]);
    if (dnttRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Không tìm thấy đề nghị thanh toán.' });
    }

    const dntt = dnttRows[0];

    // Update evaluation for each file
    if (Array.isArray(evaluations)) {
      for (const ev of evaluations) {
        if (ev.file_id) {
          await connection.query(`
            UPDATE de_nghi_thanh_toan_file
            SET trang_thai_kiem_tra = ?,
                nguoi_kiem_tra = ?,
                thoi_gian_kiem_tra = NOW(),
                ghi_chu_kiem_tra = ?
            WHERE id = ? AND id_de_nghi_thanh_toan = ?
          `, [ev.trang_thai_kiem_tra || 'Chua_Kiem_Tra', req.user?.ten_dang_nhap || 'system', ev.ghi_chu_kiem_tra || '', ev.file_id, id]);
        }
      }
    }

    let newStatus = 'Cho_GDTC_Duyet';
    let lyDo = null;

    if (action === 'return_to_requester') {
      newStatus = 'Tu_Choi';
      lyDo = y_kien || 'Kế toán yêu cầu bổ sung chứng từ';
    }

    await connection.query(`
      UPDATE de_nghi_thanh_toan
      SET trang_thai = ?,
          ma_chung_tu_goc = ?,
          loai_chung_tu_goc = ?,
          id_chung_tu_goc = ?,
          id_loai_chung_tu_goc = ?,
          kt_nguoi_kiem_tra = ?,
          kt_ngay_kiem_tra = NOW(),
          kt_y_kien = ?,
          ly_do_tu_choi = ?
      WHERE id = ?
    `, [
      newStatus,
      ma_chung_tu_goc || null,
      loai_chung_tu_goc || null,
      id_chung_tu_goc || null,
      id_loai_chung_tu_goc || null,
      req.user?.ten_dang_nhap || 'system',
      y_kien || '',
      lyDo,
      id
    ]);

    // Create notification for creator & TBP approver if returned
    if (action === 'return_to_requester') {
      await notifyRecipients(
        connection,
        id,
        dntt.ma_phieu,
        [dntt.nguoi_tao, dntt.tbp_nguoi_duyet],
        'KT_TRA_VE',
        `Kế toán yêu cầu bổ sung chứng từ ${dntt.ma_phieu}`,
        `Kế toán trả hồ sơ yêu cầu bổ sung chứng từ cho phiếu ${dntt.ma_phieu}. Lý do: ${lyDo}`
      );
    } else {
      await notifyRecipients(
        connection,
        id,
        dntt.ma_phieu,
        [dntt.nguoi_tao],
        'KT_DUYET',
        `Kế toán đã kiểm tra đạt ${dntt.ma_phieu}`,
        `Kế toán đã kiểm tra đạt toàn bộ hồ sơ chứng từ và trình Giám đốc tài chính phê duyệt.`
      );
    }

    await connection.commit();

    try {
      const io = req.app.get('io');
      if (io) io.emit('payment_request_updated', { action: 'kt_kiem_tra', id, trang_thai: newStatus });
    } catch (e) {}

    res.json({
      message: action === 'return_to_requester'
        ? 'Đã trả hồ sơ về cho người lập yêu cầu bổ sung.'
        : 'Kế toán đã kiểm tra đạt toàn bộ chứng từ và chuyển trình GĐTC phê duyệt.',
      trang_thai: newStatus
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error in KT check:', err);
    res.status(500).json({ message: 'Lỗi kiểm tra hồ sơ kế toán: ' + err.message });
  } finally {
    connection.release();
  }
});

// PUT /api/de-nghi-thanh-toan/:id/gdtc-duyet: Bước 5 - GĐTC / CFO / Ban Giám Đốc duyệt
router.put('/:id/gdtc-duyet', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc']), async (req, res) => {
  try {
    const { action, y_kien } = req.body; // action: 'approve' | 'reject'
    const id = req.params.id;

    const [dnttRows] = await pool.query('SELECT * FROM de_nghi_thanh_toan WHERE id = ? AND da_xoa = 0', [id]);
    if (dnttRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đề nghị thanh toán.' });
    }

    const dntt = dnttRows[0];
    let newStatus = 'Da_Duyet_Cho_Chi';
    let lyDo = null;

    if (action === 'reject') {
      newStatus = 'Tu_Choi';
      lyDo = y_kien || 'Giám đốc tài chính từ chối duyệt';
    }

    await pool.query(`
      UPDATE de_nghi_thanh_toan
      SET trang_thai = ?,
          gdtc_nguoi_duyet = ?,
          gdtc_ngay_duyet = NOW(),
          gdtc_y_kien = ?,
          ly_do_tu_choi = ?
      WHERE id = ?
    `, [newStatus, req.user?.ten_dang_nhap || 'system', y_kien || '', lyDo, id]);

    // Create notification
    if (action === 'reject') {
      // Notify creator, TBP approver, and KT checker
      await notifyRecipients(
        pool,
        id,
        dntt.ma_phieu,
        [dntt.nguoi_tao, dntt.tbp_nguoi_duyet, dntt.kt_nguoi_kiem_tra],
        'GDTC_TU_CHOI',
        `GĐTC từ chối duyệt ${dntt.ma_phieu}`,
        `Ban Giám Đốc / GĐTC từ chối phê duyệt đề nghị thanh toán ${dntt.ma_phieu}. Lý do: ${lyDo}`
      );
    } else {
      // 1. Notify creator
      await notifyRecipients(
        pool,
        id,
        dntt.ma_phieu,
        [dntt.nguoi_tao],
        'GDTC_DUYET',
        `GĐTC đã duyệt chi cho ${dntt.ma_phieu}`,
        `Đề nghị thanh toán ${dntt.ma_phieu} (${Number(dntt.so_tien).toLocaleString('vi-VN')} đ) đã được Ban Giám Đốc / GĐTC phê duyệt thành công. Chờ Thủ quỹ lập phiếu chi.`
      );

      // 2. Notify Accountants that request is approved and ready for payment voucher creation
      try {
        const [accountantRows] = await pool.query(
          "SELECT ten_dang_nhap FROM nguoi_dung WHERE (vai_tro LIKE '%Ke_Toan%' OR vai_tro LIKE '%Admin%') AND trang_thai = 'Hoat_Dong'"
        );
        const accountantUsernames = accountantRows.map(u => u.ten_dang_nhap);
        if (dntt.kt_nguoi_kiem_tra) accountantUsernames.push(dntt.kt_nguoi_kiem_tra);
        await notifyRecipients(
          pool,
          id,
          dntt.ma_phieu,
          accountantUsernames,
          'SAN_SANG_CHI_TIEN',
          `Đề nghị ${dntt.ma_phieu} đã được GĐTC duyệt - Sẵn sàng lập phiếu chi`,
          `Đề nghị thanh toán ${dntt.ma_phieu} (Số tiền: ${Number(dntt.so_tien).toLocaleString('vi-VN')} đ - Đối tác: ${dntt.ten_nguoi_thu_huong || ''}) đã được GĐTC phê duyệt chi. Sẵn sàng lập phiếu chi.`
        );
      } catch (accErr) {
        console.warn('Could not notify accountants on GDTC approval:', accErr.message);
      }
    }

    try {
      const io = req.app.get('io');
      if (io) io.emit('payment_request_updated', { action: 'gdtc_duyet', id, trang_thai: newStatus });
    } catch (e) {}

    res.json({
      message: action === 'reject' ? 'Đã từ chối đề nghị thanh toán.' : 'GĐTC đã phê duyệt chi thành công! Kế toán có thể thực hiện lập phiếu chi.',
      trang_thai: newStatus
    });
  } catch (err) {
    console.error('Error in GDTC approval:', err);
    res.status(500).json({ message: 'Lỗi phê duyệt GĐTC: ' + err.message });
  }
});

// =========================================================================
// 5. BƯỚC 6: KẾ TOÁN LẬP PHIẾU CHI & CẤN TRỪ CÔNG NỢ TỰ ĐỘNG
// =========================================================================

// POST /api/de-nghi-thanh-toan/:id/lap-phieu-chi
router.post('/:id/lap-phieu-chi', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), upload.any(), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const id = req.params.id;
    const {
      id_quy_tien,
      hinh_thuc_thanh_toan, // 'Tien_Mat' | 'Chuyen_Khoan'
      so_tien_chi,
      ngay_chi,
      so_chung_tu_ngan_hang,
      ghi_chu
    } = req.body;

    const [dnttRows] = await connection.query('SELECT * FROM de_nghi_thanh_toan WHERE id = ? AND da_xoa = 0', [id]);
    if (dnttRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Không tìm thấy đề nghị thanh toán.' });
    }

    const dntt = dnttRows[0];
    if (dntt.trang_thai === 'Da_Thanh_Toan') {
      await connection.rollback();
      return res.status(400).json({ message: 'Đề nghị thanh toán này đã được lập phiếu chi rồi.' });
    }

    const payAmount = parseFloat(so_tien_chi) || parseFloat(dntt.so_tien);
    if (payAmount <= 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'Số tiền chi trả phải lớn hơn 0.' });
    }

    const payDate = ngay_chi || new Date().toISOString().split('T')[0];
    const nam = new Date(payDate).getFullYear();

    // 1. Get LVKD
    const [lvkdRows] = await connection.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [dntt.id_linh_vuc_kinh_doanh]);
    const ma_lvkd = lvkdRows[0]?.ma_lvkd || 'LVKD';

    // 2. Generate Sequence Number for PC
    const seq = await generateSequenceNumber(connection, {
      id_linh_vuc_kinh_doanh: dntt.id_linh_vuc_kinh_doanh,
      loai_chung_tu: 'PC',
      nam,
      ma_lvkd
    });

    // 3. Create phieu_thu_chi (Payment Voucher)
    const [ptcResult] = await connection.query(`
      INSERT INTO phieu_thu_chi (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh,
        loai_phieu, loai_thu_chi, loai_chung_tu_lien_ket, id_chung_tu, ma_chung_tu,
        loai_doi_tuong, id_doi_tuong, ten_doi_tuong,
        id_quy_tien, hinh_thuc_thanh_toan, so_tien, ngay_chung_tu,
        nguoi_nop_nhan, ly_do_thu_chi, kem_theo_chung_tu_goc, trang_thai,
        ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, 'Phieu_Chi', 'chi_mua_hang', 'de_nghi_thanh_toan', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'đã thanh toán', ?, ?)
    `, [
      seq.ma_phieu,
      seq.so_vao_so,
      nam,
      dntt.id_linh_vuc_kinh_doanh,
      dntt.id,
      dntt.ma_phieu,
      dntt.loai_doi_tuong || 'Nha_Cung_Cap',
      dntt.id_doi_tuong || null,
      dntt.ten_nguoi_thu_huong,
      id_quy_tien || 1,
      hinh_thuc_thanh_toan || dntt.hinh_thuc_de_xuat || 'Chuyen_Khoan',
      payAmount,
      payDate,
      dntt.ten_nguoi_thu_huong,
      dntt.noi_dung_thanh_toan,
      so_chung_tu_ngan_hang || '',
      ghi_chu || '',
      req.user?.ten_dang_nhap || 'system'
    ]);

    const id_phieu_thu_chi = ptcResult.insertId;

    // Lưu các file đính kèm phiếu chi (nếu có) vào bảng `files` (ten_bang = 'phieu_thu_chi')
    if (req.files && req.files.length > 0) {
      await savePtcUploadedFiles(connection, id_phieu_thu_chi, req.files, req.user?.ten_dang_nhap || 'system');
    }

    // 4. If linked to an exact source document (e.g. PO or non-PO debt), auto-deduct debt
    if (dntt.loai_chung_tu_goc === 'phieu_mua_hang' && dntt.id_chung_tu_goc) {
      const [po] = await connection.query('SELECT tong_tien, COALESCE(da_thanh_toan, 0) as da_thanh_toan FROM phieu_mua_hang WHERE id = ?', [dntt.id_chung_tu_goc]);
      if (po.length > 0) {
        const total = parseFloat(po[0].tong_tien) || 0;
        const currentPaid = parseFloat(po[0].da_thanh_toan) || 0;
        const newPaid = currentPaid + payAmount;
        const remaining = Math.max(0, total - newPaid);
        const status = newPaid >= total ? 'Đã thanh toán' : 'Thanh toán một phần';

        await connection.query(
          'UPDATE phieu_mua_hang SET da_thanh_toan = ?, con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?',
          [newPaid, remaining, status, dntt.id_chung_tu_goc]
        );

        await connection.query(`
          INSERT INTO chi_tiet_gach_no_ncc (id_phieu_thu_chi, loai_chung_tu_no, id_chung_tu_no, so_tien_khau_tru, nguoi_tao)
          VALUES (?, 'phieu_mua_hang', ?, ?, ?)
        `, [id_phieu_thu_chi, dntt.id_chung_tu_goc, payAmount, req.user?.ten_dang_nhap || 'system']);
      }
    } else if (dntt.loai_chung_tu_goc === 'cong_no_khac_ncc' && dntt.id_chung_tu_goc) {
      const [nonPo] = await connection.query('SELECT so_tien, COALESCE(da_thanh_toan, 0) as da_thanh_toan FROM cong_no_khac_ncc WHERE id = ?', [dntt.id_chung_tu_goc]);
      if (nonPo.length > 0) {
        const total = parseFloat(nonPo[0].so_tien) || 0;
        const currentPaid = parseFloat(nonPo[0].da_thanh_toan) || 0;
        const newPaid = currentPaid + payAmount;
        const remaining = Math.max(0, total - newPaid);
        const status = newPaid >= total ? 'Đã thanh toán' : 'Thanh toán một phần';

        await connection.query(
          'UPDATE cong_no_khac_ncc SET da_thanh_toan = ?, con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?',
          [newPaid, remaining, status, dntt.id_chung_tu_goc]
        );

        await connection.query(`
          INSERT INTO chi_tiet_gach_no_ncc (id_phieu_thu_chi, loai_chung_tu_no, id_chung_tu_no, so_tien_khau_tru, nguoi_tao)
          VALUES (?, 'cong_no_khac_ncc', ?, ?, ?)
        `, [id_phieu_thu_chi, dntt.id_chung_tu_goc, payAmount, req.user?.ten_dang_nhap || 'system']);
      }
    }

    // 5. Update de_nghi_thanh_toan status to 'Da_Thanh_Toan'
    await connection.query(`
      UPDATE de_nghi_thanh_toan
      SET trang_thai = 'Da_Thanh_Toan',
          id_phieu_thu_chi = ?,
          ma_phieu_chi = ?,
          ngay_chi_tien = ?,
          so_tien_da_chi = ?
      WHERE id = ?
    `, [id_phieu_thu_chi, seq.ma_phieu, payDate, payAmount, id]);

    await logChange(connection, 'phieu_thu_chi', id_phieu_thu_chi, 'THEM_MOI', null, { id: id_phieu_thu_chi, ma_phieu: seq.ma_phieu, id_dntt: id }, req.user?.ten_dang_nhap || 'system');

    // Create notification for creator
    await createDnttNotification(
      connection,
      id,
      dntt.ma_phieu,
      dntt.nguoi_tao,
      'DA_CHI_TIEN',
      `Đã hoàn tất chi tiền cho ${dntt.ma_phieu}`,
      `Thủ quỹ đã lập phiếu chi ${seq.ma_phieu} và hoàn tất thanh toán số tiền ${Number(payAmount).toLocaleString('vi-VN')} đ.`
    );

    await connection.commit();

    try {
      const io = req.app.get('io');
      if (io) io.emit('payment_request_updated', { action: 'lap_phieu_chi', id, ma_phieu_chi: seq.ma_phieu });
    } catch (e) {}

    res.status(201).json({
      message: `Đã lập Phiếu Chi ${seq.ma_phieu} thành công và hoàn tất thanh toán ĐNTT!`,
      ma_phieu_chi: seq.ma_phieu,
      id_phieu_thu_chi
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error generating payment voucher from DNTT:', err);
    res.status(500).json({ message: 'Lỗi lập phiếu chi: ' + err.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
