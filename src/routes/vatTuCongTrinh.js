const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generateSequenceNumber } = require('../services/sequenceService');
const { parseMaterialRequestFile } = require('../services/aiOcrService');
const { logChange } = require('../utils/logger');

// Multer storage for AI OCR uploads and request attachments
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'site-mat-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

const { pool } = require('../config/db');
// Helper DB pool accessor
const getDb = (req) => (req && req.app && req.app.get('db')) || (req && req.db) || pool;

// ==========================================
// 1. PHIẾU YÊU CẦU VẬT TƯ (MATERIAL REQUESTS)
// ==========================================

// GET List of Material Requests
router.get('/yeu-cau', async (req, res) => {
  try {
    const db = getDb(req);
    const { id_cong_trinh, trang_thai, loai_phieu, search, id_linh_vuc_kinh_doanh, id_lvkd, nam, year } = req.query;
    const lvkdId = id_linh_vuc_kinh_doanh || id_lvkd || req.headers['x-lvkd-id'];

    let query = `
      SELECT y.*,
             c.ten_cong_trinh,
             l.ten_lvkd AS ten_linh_vuc_kinh_doanh,
             u_tao.ten_dang_nhap AS nguoi_tao_ten,
             u_gui.ten_dang_nhap AS nguoi_gui_ten,
             u_duyet.ten_dang_nhap AS nguoi_duyet_ten,
             (SELECT COUNT(*) FROM yeu_cau_vat_tu_chi_tiet ct WHERE ct.id_yeu_cau_vat_tu = y.id) AS tong_so_mat_hang,
             (SELECT COALESCE(SUM(ct.so_luong_yeu_cau), 0) FROM yeu_cau_vat_tu_chi_tiet ct WHERE ct.id_yeu_cau_vat_tu = y.id) AS tong_so_luong_yeu_cau,
             (SELECT COALESCE(SUM(ct.thanh_tien), 0) FROM yeu_cau_vat_tu_chi_tiet ct WHERE ct.id_yeu_cau_vat_tu = y.id) AS tong_gia_tri,
             COALESCE((
               SELECT SUM(COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0))
               FROM phieu_xuat_kho_chi_tiet pxct
               JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
               WHERE px.id_yeu_cau_vat_tu = y.id
                 AND (px.trang_thai_xuat IS NULL OR px.trang_thai_xuat = 'Đã xuất hàng' OR px.trang_thai_xuat = 'Đã xuất')
             ), 0) AS tong_so_luong_da_xuat
      FROM yeu_cau_vat_tu y
      LEFT JOIN cong_trinh c ON y.id_cong_trinh = c.id
      LEFT JOIN linh_vuc_kinh_doanh l ON y.id_linh_vuc_kinh_doanh = l.id
      LEFT JOIN nguoi_dung u_tao ON y.id_nguoi_tao = u_tao.id
      LEFT JOIN nguoi_dung u_gui ON y.id_nguoi_gui = u_gui.id
      LEFT JOIN nguoi_dung u_duyet ON y.id_nguoi_duyet = u_duyet.id
      WHERE 1=1
    `;
    const params = [];

    const selectedYear = nam || year;
    if (selectedYear && selectedYear !== 'ALL' && selectedYear !== 'all') {
      query += ` AND (y.nam = ? OR YEAR(y.ngay_tao) = ? OR YEAR(y.thoi_gian_gui) = ?)`;
      params.push(selectedYear, selectedYear, selectedYear);
    }

    if (lvkdId && lvkdId !== 'all') {
      query += ` AND y.id_linh_vuc_kinh_doanh = ?`;
      params.push(lvkdId);
    }
    if (id_cong_trinh) {
      query += ` AND y.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }
    if (trang_thai) {
      query += ` AND y.trang_thai = ?`;
      params.push(trang_thai);
    }
    if (loai_phieu) {
      query += ` AND y.loai_phieu = ?`;
      params.push(loai_phieu);
    }
    if (search) {
      query += ` AND (y.ma_phieu LIKE ? OR y.nguoi_yeu_cau LIKE ? OR y.noi_dung_yeu_cau LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    query += ` ORDER BY y.id DESC`;
    const [rows] = await db.query(query, params);

    const formattedRows = rows.map(r => {
      const reqQty = parseFloat(r.tong_so_luong_yeu_cau) || 0;
      const exportedQty = parseFloat(r.tong_so_luong_da_xuat) || 0;

      let trang_thai_xuat_kho = 'Chưa xuất hàng';
      if (exportedQty > 0) {
        if (exportedQty >= reqQty && reqQty > 0) {
          trang_thai_xuat_kho = 'Đã xuất 100%';
        } else {
          trang_thai_xuat_kho = 'Đã xuất một phần';
        }
      }

      return {
        ...r,
        trang_thai_xuat_kho
      };
    });

    res.json(formattedRows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi máy chủ khi lấy danh sách phiếu yêu cầu.' });
  }
});

// GET Detail of Material Request
router.get('/yeu-cau/:id', async (req, res) => {
  try {
    const db = getDb(req);
    const [requests] = await db.query(`
      SELECT y.*,
             c.ten_cong_trinh,
             l.ten_lvkd AS ten_linh_vuc_kinh_doanh, l.ma_lvkd AS ma_linh_vuc_kinh_doanh,
             u_tao.ho_ten AS ten_nguoi_tao,
             u_gui.ho_ten AS ten_nguoi_gui,
             u_duyet.ho_ten AS ten_nguoi_duyet
      FROM yeu_cau_vat_tu y
      LEFT JOIN cong_trinh c ON y.id_cong_trinh = c.id
      LEFT JOIN linh_vuc_kinh_doanh l ON y.id_linh_vuc_kinh_doanh = l.id
      LEFT JOIN nguoi_dung u_tao ON y.id_nguoi_tao = u_tao.id
      LEFT JOIN nguoi_dung u_gui ON y.id_nguoi_gui = u_gui.id
      LEFT JOIN nguoi_dung u_duyet ON y.id_nguoi_duyet = u_duyet.id
      WHERE y.id = ?
    `, [req.params.id]);

    if (requests.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu yêu cầu vật tư.' });
    }

    const [items] = await db.query(`
      SELECT d.*, v.ma_vat_tu, v.ten_vat_tu,
             COALESCE((
               SELECT SUM(COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0))
               FROM phieu_xuat_kho_chi_tiet pxct
               JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
               WHERE px.id_yeu_cau_vat_tu = d.id_yeu_cau_vat_tu
                 AND pxct.id_chi_tiet_yeu_cau_vat_tu = d.id
                 AND (px.trang_thai_xuat IS NULL OR px.trang_thai_xuat = 'Đã xuất hàng')
             ), 0) AS so_luong_da_xuat
      FROM yeu_cau_vat_tu_chi_tiet d
      JOIN danh_muc_vat_tu v ON d.id_danh_muc_vat_tu = v.id
      WHERE d.id_yeu_cau_vat_tu = ?
    `, [req.params.id]);

    // Attach attachments
    const [files] = await db.query(`
      SELECT * FROM files WHERE ten_bang = 'yeu_cau_vat_tu' AND id_ban_ghi = ?
    `, [req.params.id]);

    res.json({
      request: requests[0],
      items,
      files
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tải chi tiết phiếu yêu cầu.' });
  }
});

// POST Create Material Request (Online or Paper)
router.post('/yeu-cau', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const {
      id_cong_trinh,
      id_linh_vuc_kinh_doanh,
      dia_diem_cap_vat_tu,
      nguoi_yeu_cau,
      loai_phieu = 'online',
      noi_dung_yeu_cau,
      ghi_chu,
      items = []
    } = req.body;

    const currentYear = new Date().getFullYear();
    const userId = req.user?.id || 1;

    const [lvkdRows] = await conn.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [id_linh_vuc_kinh_doanh || 1]);
    const maLvkd = lvkdRows[0]?.ma_lvkd || 'BT';

    const seq = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: id_linh_vuc_kinh_doanh || 1,
      loai_chung_tu: 'CT',
      nam: currentYear,
      ma_lvkd: maLvkd
    });
    const soVaoSo = seq.so_vao_so;
    const maPhieu = seq.ma_phieu;
    const trangThai = loai_phieu === 'giay' ? 'Đã duyệt' : 'Nháp';

    const [result] = await conn.query(`
      INSERT INTO yeu_cau_vat_tu (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, id_cong_trinh,
        dia_diem_cap_vat_tu, nguoi_yeu_cau, loai_phieu, noi_dung_yeu_cau,
        ngay_tao, id_nguoi_tao, trang_thai, ghi_chu
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)
    `, [
      maPhieu, soVaoSo, currentYear, id_linh_vuc_kinh_doanh || 1, id_cong_trinh,
      dia_diem_cap_vat_tu || '', nguoi_yeu_cau || '', loai_phieu, noi_dung_yeu_cau || '',
      userId, trangThai, ghi_chu || ''
    ]);

    const requestId = result.insertId;

    // Insert items
    for (const item of items) {
      const qty = parseFloat(item.so_luong_yeu_cau) || 0;
      const price = parseFloat(item.don_gia) || 0;
      const discount = parseFloat(item.chiet_khau) || 0;
      const total = (qty * price) - discount;

      await conn.query(`
        INSERT INTO yeu_cau_vat_tu_chi_tiet (
          id_yeu_cau_vat_tu, id_danh_muc_vat_tu, don_vi_tinh,
          so_luong_yeu_cau, don_gia, chiet_khau, thanh_tien, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        requestId, item.id_danh_muc_vat_tu, item.don_vi_tinh || '',
        qty, price, discount, total, item.ghi_chu || ''
      ]);
    }

    await conn.commit();
    conn.release();

    const io = req.app.get('io');
    if (io) {
      io.emit('material_request_updated', { action: 'create', id: requestId });
    }

    res.json({
      message: loai_phieu === 'giay' ? 'Tạo phiếu giấy đã duyệt thành công!' : 'Tạo phiếu yêu cầu nháp thành công!',
      id: requestId,
      ma_phieu: maPhieu
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi tạo phiếu yêu cầu vật tư.' });
  }
});

// PUT Update Material Request (Draft only)
router.put('/yeu-cau/:id', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT trang_thai FROM yeu_cau_vat_tu WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu yêu cầu.' });
    }

    if (rows[0].trang_thai !== 'Nháp') {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'Chỉ có thể cập nhật thông tin cho phiếu ở trạng thái Nháp!' });
    }

    const {
      id_cong_trinh,
      id_linh_vuc_kinh_doanh,
      dia_diem_cap_vat_tu,
      nguoi_yeu_cau,
      loai_phieu = 'online',
      noi_dung_yeu_cau,
      ghi_chu,
      items = []
    } = req.body;

    await conn.query(`
      UPDATE yeu_cau_vat_tu
      SET id_cong_trinh = ?,
          id_linh_vuc_kinh_doanh = ?,
          dia_diem_cap_vat_tu = ?,
          nguoi_yeu_cau = ?,
          loai_phieu = ?,
          noi_dung_yeu_cau = ?,
          ghi_chu = ?
      WHERE id = ?
    `, [
      id_cong_trinh, id_linh_vuc_kinh_doanh || 1,
      dia_diem_cap_vat_tu || '', nguoi_yeu_cau || '',
      loai_phieu, noi_dung_yeu_cau || '', ghi_chu || '',
      req.params.id
    ]);

    // Delete old items and re-insert updated items
    await conn.query('DELETE FROM yeu_cau_vat_tu_chi_tiet WHERE id_yeu_cau_vat_tu = ?', [req.params.id]);

    for (const item of items) {
      const qty = parseFloat(item.so_luong_yeu_cau) || 0;
      const price = parseFloat(item.don_gia) || 0;
      const discount = parseFloat(item.chiet_khau) || 0;
      const total = (qty * price) - discount;

      await conn.query(`
        INSERT INTO yeu_cau_vat_tu_chi_tiet (
          id_yeu_cau_vat_tu, id_danh_muc_vat_tu, don_vi_tinh,
          so_luong_yeu_cau, don_gia, chiet_khau, thanh_tien, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        req.params.id, item.id_danh_muc_vat_tu, item.don_vi_tinh || '',
        qty, price, discount, total, item.ghi_chu || ''
      ]);
    }

    await conn.commit();
    conn.release();

    const io = req.app.get('io');
    if (io) {
      io.emit('material_request_updated', { action: 'update', id: req.params.id });
    }

    res.json({ message: 'Cập nhật phiếu yêu cầu vật tư thành công!' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi cập nhật phiếu yêu cầu vật tư.' });
  }
});

// PUT Send Online Request (Nháp -> Chờ duyệt)
router.put('/yeu-cau/:id/gui', async (req, res) => {
  try {
    const db = getDb(req);
    const userId = req.user?.id || 1;

    const [rows] = await db.query('SELECT trang_thai FROM yeu_cau_vat_tu WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Không tìm thấy phiếu.' });
    if (rows[0].trang_thai !== 'Nháp') {
      return res.status(400).json({ message: 'Phiếu này không ở trạng thái Nháp.' });
    }

    await db.query(`
      UPDATE yeu_cau_vat_tu
      SET trang_thai = 'Chờ duyệt',
          id_nguoi_gui = ?,
          thoi_gian_gui = NOW()
      WHERE id = ?
    `, [userId, req.params.id]);

    const io = req.app.get('io');
    if (io) {
      io.emit('material_request_updated', { action: 'gui', id: req.params.id });
    }

    res.json({ message: 'Đã gửi phiếu yêu cầu vật tư chờ phê duyệt!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi gửi phiếu yêu cầu.' });
  }
});

// PUT Approve / Reject Online Request (Chờ duyệt -> Đã duyệt / Từ chối)
router.put('/yeu-cau/:id/duyet', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { ket_qua_duyet, noi_dung_duyet } = req.body; // 'Đã duyệt' or 'Từ chối'
    const userId = req.user?.id || 1;

    const [rows] = await conn.query('SELECT * FROM yeu_cau_vat_tu WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu yêu cầu.' });
    }

    const reqData = rows[0];
    if (reqData.trang_thai !== 'Chờ duyệt') {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'Phiếu này không ở trạng thái Chờ duyệt.' });
    }

    const io = req.app.get('io');

    if (ket_qua_duyet === 'Đã duyệt' || ket_qua_duyet === 'Đồng ý') {
      const currentYear = new Date().getFullYear();
      let maPhieu = reqData.ma_phieu;
      let soVaoSo = reqData.so_vao_so;

      if (!maPhieu) {
        const [lvkdRows] = await conn.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [reqData.id_linh_vuc_kinh_doanh || 1]);
        const maLvkd = lvkdRows[0]?.ma_lvkd || 'BT';

        const seq = await generateSequenceNumber(conn, {
          id_linh_vuc_kinh_doanh: reqData.id_linh_vuc_kinh_doanh || 1,
          loai_chung_tu: 'CT',
          nam: currentYear,
          ma_lvkd: maLvkd
        });
        maPhieu = seq.ma_phieu;
        soVaoSo = seq.so_vao_so;
      }

      await conn.query(`
        UPDATE yeu_cau_vat_tu
        SET trang_thai = 'Đã duyệt',
            ket_qua_duyet = 'Đã duyệt',
            ma_phieu = ?,
            so_vao_so = ?,
            nam = ?,
            id_nguoi_duyet = ?,
            thoi_gian_duyet = NOW(),
            noi_dung_duyet = ?
        WHERE id = ?
      `, [maPhieu, soVaoSo, currentYear, userId, noi_dung_duyet || '', req.params.id]);

      await conn.commit();
      conn.release();

      if (io) {
        io.emit('material_request_updated', { action: 'duyet', result: 'Đã duyệt', id: req.params.id });
      }

      return res.json({
        message: 'Duyệt phiếu yêu cầu vật tư thành công!',
        ma_phieu: maPhieu
      });
    } else {
      await conn.query(`
        UPDATE yeu_cau_vat_tu
        SET trang_thai = 'Từ chối',
            ket_qua_duyet = 'Từ chối',
            id_nguoi_duyet = ?,
            thoi_gian_duyet = NOW(),
            noi_dung_duyet = ?
        WHERE id = ?
      `, [userId, noi_dung_duyet || '', req.params.id]);

      await conn.commit();
      conn.release();

      if (io) {
        io.emit('material_request_updated', { action: 'duyet', result: 'Từ chối', id: req.params.id });
      }

      return res.json({ message: 'Đã từ chối phiếu yêu cầu vật tư!' });
    }
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: 'Lỗi xử lý duyệt phiếu yêu cầu.' });
  }
});

// DELETE Draft Request
router.delete('/yeu-cau/:id', async (req, res) => {
  try {
    const db = getDb(req);
    const [rows] = await db.query('SELECT trang_thai FROM yeu_cau_vat_tu WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Không tìm thấy phiếu.' });
    if (rows[0].trang_thai !== 'Nháp') {
      return res.status(400).json({ message: 'Chỉ có thể xóa phiếu ở trạng thái Nháp.' });
    }

    await db.query('DELETE FROM yeu_cau_vat_tu_chi_tiet WHERE id_yeu_cau_vat_tu = ?', [req.params.id]);
    await db.query('DELETE FROM yeu_cau_vat_tu WHERE id = ?', [req.params.id]);

    const io = req.app.get('io');
    if (io) {
      io.emit('material_request_updated', { action: 'delete', id: req.params.id });
    }
    await db.query('DELETE FROM yeu_cau_vat_tu WHERE id = ?', [req.params.id]);

    res.json({ message: 'Xóa phiếu yêu cầu vật tư nháp thành công!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi xóa phiếu yêu cầu.' });
  }
});

// ==========================================
// 2. AI OCR SCAN PARSING
// ==========================================

router.post('/ai-ocr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Vui lòng upload hình ảnh hoặc file PDF scan.' });
    }
    const result = await parseMaterialRequestFile(req.file.path, req.file.mimetype);

    if (!result || result.length === 0) {
      return res.status(422).json({
        message: 'Không thể kết nối dịch vụ AI OCR (Chưa cấu hình API Key OpenAI/Gemini hoặc Key hết hạn/lỗi mạng). Vui lòng bấm "+ Thêm dòng mới" để nhập thủ công.',
        extractedItems: []
      });
    }

    res.json({
      filePath: req.file.path,
      fileName: req.file.originalname,
      extractedItems: result
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Không thể kết nối AI OCR. Vui lòng bấm "+ Thêm dòng mới" để nhập thủ công.' });
  }
});

// ==========================================
// 3. THÔNG BÁO REAL-TIME
// ==========================================

router.get('/thong-bao/count', async (req, res) => {
  try {
    const db = getDb(req);
    const [rows] = await db.query("SELECT COUNT(*) AS count FROM yeu_cau_vat_tu WHERE trang_thai = 'Chờ duyệt'");
    res.json({ count: rows[0]?.count || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ count: 0 });
  }
});

router.get('/thong-bao/list', async (req, res) => {
  try {
    const db = getDb(req);
    const [rows] = await db.query(`
      SELECT y.id, y.ma_phieu, y.nguoi_yeu_cau, y.thoi_gian_gui, c.ten_cong_trinh
      FROM yeu_cau_vat_tu y
      LEFT JOIN cong_trinh c ON y.id_cong_trinh = c.id
      WHERE y.trang_thai = 'Chờ duyệt'
      ORDER BY y.thoi_gian_gui DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

// ==========================================
// 4. PHIẾU XUẤT KHO CÔNG TRÌNH
// ==========================================

// GET List of Site Export Vouchers
router.get('/phieu-xuat', async (req, res) => {
  try {
    const db = getDb(req);
    const { id_cong_trinh, id_yeu_cau_vat_tu, trang_thai_xuat, search, id_linh_vuc_kinh_doanh, id_lvkd, nam, year } = req.query;
    const lvkdId = id_linh_vuc_kinh_doanh || id_lvkd;

    let query = `
      SELECT px.*,
             c.ten_cong_trinh,
             k_nguon.ten_kho AS ten_kho_nguon,
             k_tam.ten_kho AS ten_kho_tam,
             yc.ma_phieu AS ma_phieu_yeu_cau,
             l.ten_lvkd AS ten_linh_vuc_kinh_doanh
      FROM phieu_xuat_kho px
      LEFT JOIN cong_trinh c ON px.id_cong_trinh = c.id
      LEFT JOIN kho_hang k_nguon ON px.id_kho_hang = k_nguon.id
      LEFT JOIN kho_hang k_tam ON px.id_kho_tam_nhan = k_tam.id
      LEFT JOIN yeu_cau_vat_tu yc ON px.id_yeu_cau_vat_tu = yc.id
      LEFT JOIN linh_vuc_kinh_doanh l ON px.id_linh_vuc_kinh_doanh = l.id
      WHERE px.loai_xuat_kho = 'cong_trinh'
    `;
    const params = [];

    const selectedYear = nam || year;
    if (selectedYear && selectedYear !== 'ALL' && selectedYear !== 'all') {
      query += ` AND (px.nam = ? OR YEAR(px.thoi_gian_xuat) = ? OR YEAR(px.thoi_gian_tao) = ?)`;
      params.push(selectedYear, selectedYear, selectedYear);
    }

    if (lvkdId && lvkdId !== 'all') {
      query += ` AND px.id_linh_vuc_kinh_doanh = ?`;
      params.push(lvkdId);
    }

    if (id_cong_trinh) {
      query += ` AND px.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }
    if (id_yeu_cau_vat_tu) {
      query += ` AND px.id_yeu_cau_vat_tu = ?`;
      params.push(id_yeu_cau_vat_tu);
    }
    if (trang_thai_xuat) {
      query += ` AND px.trang_thai_xuat = ?`;
      params.push(trang_thai_xuat);
    }
    if (search) {
      query += ` AND (px.ma_phieu LIKE ? OR yc.ma_phieu LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term);
    }

    query += ` ORDER BY px.id DESC`;
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tải danh sách phiếu xuất kho công trình.' });
  }
});

// POST Create Site Export Voucher from Approved Request
router.post('/phieu-xuat', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const {
      id_yeu_cau_vat_tu,
      id_kho_nguon,
      ghi_chu,
      items = []
    } = req.body;

    const [reqRows] = await conn.query('SELECT * FROM yeu_cau_vat_tu WHERE id = ?', [id_yeu_cau_vat_tu]);
    if (reqRows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu yêu cầu gốc.' });
    }
    const reqData = reqRows[0];
    if (reqData.trang_thai !== 'Đã duyệt') {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'Chỉ được xuất kho từ Phiếu yêu cầu đã duyệt.' });
    }

    // Check if there are any active draft or pending export slips for this material request
    const [existingDraftExport] = await conn.query(`
      SELECT id, ma_phieu, trang_thai_xuat
      FROM phieu_xuat_kho
      WHERE id_yeu_cau_vat_tu = ?
        AND (trang_thai_xuat = 'Nháp' OR trang_thai_xuat = 'Chờ xuất hàng' OR trang_thai_xuat IS NULL)
      LIMIT 1
    `, [id_yeu_cau_vat_tu]);

    if (existingDraftExport.length > 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({
        message: `Phiếu yêu cầu vật tư này hiện đang có 1 phiếu xuất kho (${existingDraftExport[0].ma_phieu || '#' + existingDraftExport[0].id}) ở trạng thái "${existingDraftExport[0].trang_thai_xuat || 'Nháp'}" chưa hoàn tất. Vui lòng xử lý xuất hàng trước khi tạo phiếu mới.`
      });
    }

    // Get Site Temp Warehouse for this project
    const [khoTamRows] = await conn.query('SELECT id FROM kho_hang WHERE id_cong_trinh = ? AND la_kho_tam_cong_trinh = 1', [reqData.id_cong_trinh]);
    if (khoTamRows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'Chưa khởi tạo Kho tạm công trình cho dự án này.' });
    }
    const idKhoTamNhan = khoTamRows[0].id;

    // Validate quantities: Previous Exported + Current Export <= Approved Qty
    for (const item of items) {
      const [approvedItem] = await conn.query(`
        SELECT so_luong_yeu_cau
        FROM yeu_cau_vat_tu_chi_tiet
        WHERE id = ? AND id_yeu_cau_vat_tu = ?
      `, [item.id_chi_tiet_yeu_cau_vat_tu, id_yeu_cau_vat_tu]);

      if (approvedItem.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ message: `Vật tư ID ${item.id_danh_muc_vat_tu} không thuộc phiếu yêu cầu đã duyệt.` });
      }

      const [prevExport] = await conn.query(`
        SELECT COALESCE(SUM(COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0)), 0) AS total_prev
        FROM phieu_xuat_kho_chi_tiet pxct
        JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
        WHERE px.id_yeu_cau_vat_tu = ?
          AND pxct.id_chi_tiet_yeu_cau_vat_tu = ?
          AND (px.trang_thai_xuat IS NULL OR px.trang_thai_xuat = 'Đã xuất hàng')
      `, [id_yeu_cau_vat_tu, item.id_chi_tiet_yeu_cau_vat_tu]);

      const approvedQty = parseFloat(approvedItem[0].so_luong_yeu_cau) || 0;
      const prevQty = parseFloat(prevExport[0].total_prev) || 0;
      const currentQty = parseFloat(item.so_luong_xuat) || 0;

      if (prevQty + currentQty > approvedQty) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({
          message: `Số lượng xuất (${prevQty + currentQty}) vượt quá số lượng được duyệt (${approvedQty}) cho vật tư ID ${item.id_danh_muc_vat_tu}.`
        });
      }
    }

    // Generate Export Sequence (BTXK000001/26)
    const currentYear = new Date().getFullYear();
    const [lvkdRows] = await conn.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [reqData.id_linh_vuc_kinh_doanh || 1]);
    const maLvkd = lvkdRows[0]?.ma_lvkd || 'BT';

    const seq = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: reqData.id_linh_vuc_kinh_doanh || 1,
      loai_chung_tu: 'XK',
      nam: currentYear,
      ma_lvkd: maLvkd
    });

    let tongTien = 0;
    items.forEach(i => {
      const q = parseFloat(i.so_luong_xuat) || 0;
      const p = parseFloat(i.don_gia) || 0;
      const d = parseFloat(i.chiet_khau) || 0;
      tongTien += (q * p) - d;
    });

    const [exportResult] = await conn.query(`
      INSERT INTO phieu_xuat_kho (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, id_yeu_cau_vat_tu,
        id_cong_trinh, id_kho_hang, id_kho_tam_nhan, loai_xuat_kho,
        thoi_gian_xuat, nguoi_xuat, tong_tien, trang_thai_xuat, ghi_chu
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cong_trinh', NOW(), ?, ?, 'Nháp', ?)
    `, [
      seq.ma_phieu, seq.so_vao_so, currentYear, reqData.id_linh_vuc_kinh_doanh || 1, id_yeu_cau_vat_tu,
      reqData.id_cong_trinh, id_kho_nguon, idKhoTamNhan, req.user?.ho_ten || 'Thủ kho', tongTien, ghi_chu || ''
    ]);

    const exportId = exportResult.insertId;

    for (const item of items) {
      const qty = parseFloat(item.so_luong_xuat) || 0;
      const price = parseFloat(item.don_gia) || 0;
      const discount = parseFloat(item.chiet_khau) || 0;
      const total = (qty * price) - discount;

      await conn.query(`
        INSERT INTO phieu_xuat_kho_chi_tiet (
          id_phieu_xuat_kho, id_chi_tiet_yeu_cau_vat_tu, id_danh_muc_vat_tu,
          don_vi_tinh, so_luong, so_luong_xuat, don_gia, chiet_khau, thanh_tien
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        exportId, item.id_chi_tiet_yeu_cau_vat_tu, item.id_danh_muc_vat_tu,
        item.don_vi_tinh || '', qty, qty, price, discount, total
      ]);
    }

    await conn.commit();
    conn.release();

    res.json({
      message: 'Tạo phiếu xuất kho công trình nháp thành công!',
      id: exportId,
      ma_phieu: seq.ma_phieu
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: 'Lỗi tạo phiếu xuất kho công trình.' });
  }
});

// GET Single Export Voucher Detail
router.get('/phieu-xuat/:id', async (req, res) => {
  try {
    const db = getDb(req);
    const [pxRows] = await db.query(`
      SELECT px.*,
             c.ten_cong_trinh,
             k_nguon.ten_kho AS ten_kho_nguon,
             k_tam.ten_kho AS ten_kho_tam,
             yc.ma_phieu AS ma_phieu_yeu_cau,
             yc.nguoi_yeu_cau,
             yc.dia_diem_cap_vat_tu,
             yc.noi_dung_yeu_cau,
             l.ten_lvkd AS ten_linh_vuc_kinh_doanh
      FROM phieu_xuat_kho px
      LEFT JOIN cong_trinh c ON px.id_cong_trinh = c.id
      LEFT JOIN kho_hang k_nguon ON px.id_kho_hang = k_nguon.id
      LEFT JOIN kho_hang k_tam ON px.id_kho_tam_nhan = k_tam.id
      LEFT JOIN yeu_cau_vat_tu yc ON px.id_yeu_cau_vat_tu = yc.id
      LEFT JOIN linh_vuc_kinh_doanh l ON px.id_linh_vuc_kinh_doanh = l.id
      WHERE px.id = ?
    `, [req.params.id]);

    if (pxRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu xuất kho.' });
    }

    const exportVoucher = pxRows[0];

    const [items] = await db.query(`
      SELECT pxct.*, v.ma_vat_tu, v.ten_vat_tu
      FROM phieu_xuat_kho_chi_tiet pxct
      LEFT JOIN danh_muc_vat_tu v ON pxct.id_danh_muc_vat_tu = v.id
      WHERE pxct.id_phieu_xuat_kho = ?
    `, [req.params.id]);

    let requestItems = [];
    if (exportVoucher.id_yeu_cau_vat_tu) {
      const [reqItemsRows] = await db.query(`
        SELECT ycct.*, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh
        FROM yeu_cau_vat_tu_chi_tiet ycct
        LEFT JOIN danh_muc_vat_tu v ON ycct.id_danh_muc_vat_tu = v.id
        WHERE ycct.id_yeu_cau_vat_tu = ?
      `, [exportVoucher.id_yeu_cau_vat_tu]);

      for (const rItem of reqItemsRows) {
        const [prevExport] = await db.query(`
          SELECT COALESCE(SUM(COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0)), 0) AS total_other
          FROM phieu_xuat_kho_chi_tiet pxct
          JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
          WHERE px.id_yeu_cau_vat_tu = ?
            AND pxct.id_chi_tiet_yeu_cau_vat_tu = ?
            AND px.id <> ?
            AND (px.trang_thai_xuat IS NULL OR px.trang_thai_xuat = 'Đã xuất hàng' OR px.trang_thai_xuat = 'Nháp' OR px.trang_thai_xuat = 'Chờ xuất hàng')
        `, [exportVoucher.id_yeu_cau_vat_tu, rItem.id, req.params.id]);

        const approvedQty = parseFloat(rItem.so_luong_yeu_cau) || 0;
        const otherQty = parseFloat(prevExport[0].total_other) || 0;
        const maxExportable = Math.max(0, approvedQty - otherQty);

        requestItems.push({
          id_chi_tiet_yeu_cau_vat_tu: rItem.id,
          id_danh_muc_vat_tu: rItem.id_danh_muc_vat_tu,
          ma_vat_tu: rItem.ma_vat_tu,
          ten_vat_tu: rItem.ten_vat_tu,
          don_vi_tinh: rItem.don_vi_tinh,
          so_luong_duyet: approvedQty,
          so_luong_da_xuat_khac: otherQty,
          max_exportable: maxExportable,
          don_gia: parseFloat(rItem.don_gia || 0)
        });
      }
    }

    res.json({
      exportVoucher,
      items,
      requestItems
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tải chi tiết phiếu xuất kho.' });
  }
});

// PUT Update Draft Site Export Voucher
router.put('/phieu-xuat/:id', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [pxRows] = await conn.query('SELECT * FROM phieu_xuat_kho WHERE id = ? FOR UPDATE', [req.params.id]);
    if (pxRows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu xuất kho.' });
    }
    const px = pxRows[0];
    if (px.trang_thai_xuat === 'Đã xuất hàng') {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'Không thể chỉnh sửa phiếu xuất kho đã xuất hàng chính thức.' });
    }

    const { id_kho_nguon, ghi_chu, items = [] } = req.body;

    let tongTien = 0;
    items.forEach(i => {
      const q = parseFloat(i.so_luong_xuat || i.so_luong || 0) || 0;
      const p = parseFloat(i.don_gia) || 0;
      const d = parseFloat(i.chiet_khau) || 0;
      tongTien += (q * p) - d;
    });

    await conn.query(`
      UPDATE phieu_xuat_kho
      SET id_kho_hang = ?,
          ghi_chu = ?,
          tong_tien = ?
      WHERE id = ?
    `, [id_kho_nguon || px.id_kho_hang || 1, ghi_chu || '', tongTien, req.params.id]);

    await conn.query('DELETE FROM phieu_xuat_kho_chi_tiet WHERE id_phieu_xuat_kho = ?', [req.params.id]);

    for (const item of items) {
      const qty = parseFloat(item.so_luong_xuat || item.so_luong || 0) || 0;
      const price = parseFloat(item.don_gia) || 0;
      const discount = parseFloat(item.chiet_khau) || 0;
      const total = (qty * price) - discount;

      await conn.query(`
        INSERT INTO phieu_xuat_kho_chi_tiet (
          id_phieu_xuat_kho, id_chi_tiet_yeu_cau_vat_tu, id_danh_muc_vat_tu,
          don_vi_tinh, so_luong, so_luong_xuat, don_gia, chiet_khau, thanh_tien
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        req.params.id, item.id_chi_tiet_yeu_cau_vat_tu || null, item.id_danh_muc_vat_tu,
        item.don_vi_tinh || '', qty, qty, price, discount, total
      ]);
    }

    await conn.commit();
    conn.release();

    res.json({ message: 'Cập nhật phiếu xuất kho thành công!' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: 'Lỗi cập nhật phiếu xuất kho.' });
  }
});

// PUT Confirm Export (Xác nhận xuất hàng -> Giảm Kho nguồn, Tăng Kho tạm)
router.put('/phieu-xuat/:id/xac-nhan', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [pxRows] = await conn.query('SELECT * FROM phieu_xuat_kho WHERE id = ? FOR UPDATE', [req.params.id]);
    if (pxRows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu xuất kho.' });
    }
    const px = pxRows[0];
    if (px.trang_thai_xuat === 'Đã xuất hàng') {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'Phiếu xuất kho này đã được xác nhận trước đó.' });
    }

    const [items] = await conn.query(`
      SELECT pxct.*, v.ten_vat_tu, v.ma_vat_tu
      FROM phieu_xuat_kho_chi_tiet pxct
      LEFT JOIN danh_muc_vat_tu v ON pxct.id_danh_muc_vat_tu = v.id
      WHERE pxct.id_phieu_xuat_kho = ?
    `, [req.params.id]);

    const sourceWhId = px.id_kho_hang || px.id_kho;

    // Check source warehouse stock availability
    for (const item of items) {
      const [stock] = await conn.query(`
        SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ? FOR UPDATE
      `, [sourceWhId, item.id_danh_muc_vat_tu]);

      const currentStock = stock[0] ? parseFloat(stock[0].so_luong_ton) : 0;
      const needQty = parseFloat(item.so_luong_xuat || item.so_luong || 0);

      if (currentStock < needQty) {
        await conn.rollback();
        conn.release();
        const matName = item.ten_vat_tu ? `${item.ten_vat_tu} (${item.ma_vat_tu})` : `Vật tư ID ${item.id_danh_muc_vat_tu}`;
        return res.status(400).json({
          message: `Kho nguồn không đủ số lượng tồn cho ${matName} (Tồn kho hiện tại: ${currentStock} ${item.don_vi_tinh || ''}, Cần xuất: ${needQty} ${item.don_vi_tinh || ''}).`
        });
      }
    }

    // Process Stock Transfer: Source Warehouse (-qty) -> Site Temp Warehouse (+qty)
    for (const item of items) {
      const qty = parseFloat(item.so_luong_xuat || item.so_luong || 0);

      // 1. Decrease Source Warehouse Stock
      await conn.query(`
        UPDATE ton_kho
        SET so_luong_ton = so_luong_ton - ?
        WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
      `, [qty, sourceWhId, item.id_danh_muc_vat_tu]);

      const [sourceStock] = await conn.query(`
        SELECT id FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
      `, [sourceWhId, item.id_danh_muc_vat_tu]);
      const sourceTonKhoId = sourceStock.length > 0 ? sourceStock[0].id : null;

      await conn.query(`
        INSERT INTO ton_kho_lich_su (
          id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi,
          id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao, thoi_gian_tao
        ) VALUES (?, ?, ?, ?, ?, 'Phiếu xuất kho', ?, ?, NOW())
      `, [sourceTonKhoId, sourceWhId, item.id_danh_muc_vat_tu, -qty, px.id, `Xuất kho công trình theo ${px.ma_phieu}`, req.user?.ho_ten || req.user?.ten_dang_nhap || 'Thủ kho']);

      // 2. Increase Site Temp Warehouse Stock
      let destTonKhoId = null;
      const [destStock] = await conn.query(`
        SELECT id FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
      `, [px.id_kho_tam_nhan, item.id_danh_muc_vat_tu]);

      if (destStock.length > 0) {
        destTonKhoId = destStock[0].id;
        await conn.query(`
          UPDATE ton_kho
          SET so_luong_ton = so_luong_ton + ?
          WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
        `, [qty, px.id_kho_tam_nhan, item.id_danh_muc_vat_tu]);
      } else {
        const [insertDest] = await conn.query(`
          INSERT INTO ton_kho (id_kho_hang, id_danh_muc_vat_tu, so_luong_ton)
          VALUES (?, ?, ?)
        `, [px.id_kho_tam_nhan, item.id_danh_muc_vat_tu, qty]);
        destTonKhoId = insertDest.insertId;
      }

      await conn.query(`
        INSERT INTO ton_kho_lich_su (
          id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi,
          id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao, thoi_gian_tao
        ) VALUES (?, ?, ?, ?, ?, 'Nhập kho tạm', ?, ?, NOW())
      `, [destTonKhoId, px.id_kho_tam_nhan, item.id_danh_muc_vat_tu, qty, px.id, `Nhập kho tạm công trình theo ${px.ma_phieu}`, req.user?.ho_ten || req.user?.ten_dang_nhap || 'Thủ kho']);
    }

    await conn.query(`
      UPDATE phieu_xuat_kho
      SET trang_thai_xuat = 'Đã xuất hàng',
          thoi_gian_xuat = NOW()
      WHERE id = ?
    `, [req.params.id]);

    await conn.commit();
    conn.release();

    res.json({ message: 'Xác nhận xuất hàng thành công! Đã điều chuyển tồn kho sang Kho tạm công trình.' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi xác nhận xuất kho.' });
  }
});

// ==========================================
// 5. TỒN KHO TẠM CÔNG TRÌNH
// ==========================================

router.get('/ton-kho-tam', async (req, res) => {
  try {
    const db = getDb(req);
    const { id_cong_trinh } = req.query;

    let query = `
      SELECT tk.*, k.ten_kho, k.id_cong_trinh, c.ten_cong_trinh,
             v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh, v.don_gia_tieu_chuan
      FROM ton_kho tk
      JOIN kho_hang k ON tk.id_kho_hang = k.id
      JOIN cong_trinh c ON k.id_cong_trinh = c.id
      JOIN danh_muc_vat_tu v ON tk.id_danh_muc_vat_tu = v.id
      WHERE k.la_kho_tam_cong_trinh = 1 AND tk.so_luong_ton > 0
    `;
    const params = [];

    if (id_cong_trinh) {
      query += ` AND k.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tải tồn kho tạm công trình.' });
  }
});

// ==========================================
// 6. NGHIỆM THU SỬ DỤNG VẬT TƯ
// ==========================================

router.get('/nghiem-thu', async (req, res) => {
  try {
    const db = getDb(req);
    const { id_cong_trinh, nam, year } = req.query;

    let query = `
      SELECT nt.*, c.ten_cong_trinh, k.ten_kho AS ten_kho_tam,
             (SELECT COUNT(*) FROM nghiem_thu_vat_tu_chi_tiet WHERE id_nghiem_thu = nt.id) AS tong_mat_hang,
             (SELECT COALESCE(SUM(thanh_tien), 0) FROM nghiem_thu_vat_tu_chi_tiet WHERE id_nghiem_thu = nt.id) AS tong_gia_tri_su_dung
      FROM nghiem_thu_vat_tu_cong_trinh nt
      LEFT JOIN cong_trinh c ON nt.id_cong_trinh = c.id
      LEFT JOIN kho_hang k ON nt.id_kho_tam = k.id
      WHERE 1=1
    `;
    const params = [];

    const selectedYear = nam || year;
    if (selectedYear && selectedYear !== 'ALL' && selectedYear !== 'all') {
      query += ` AND YEAR(nt.ngay_nghiem_thu) = ?`;
      params.push(selectedYear);
    }

    if (id_cong_trinh) {
      query += ` AND nt.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }

    query += ` ORDER BY nt.id DESC`;
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tải danh sách nghiệm thu vật tư.' });
  }
});

router.post('/nghiem-thu', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { id_cong_trinh, nguoi_nghiem_thu, ghi_chu, items = [] } = req.body;

    const [khoTamRows] = await conn.query('SELECT id FROM kho_hang WHERE id_cong_trinh = ? AND la_kho_tam_cong_trinh = 1', [id_cong_trinh]);
    if (khoTamRows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'Không tìm thấy kho tạm công trình.' });
    }
    const idKhoTam = khoTamRows[0].id;
    const maPhieuNT = 'NT_' + Date.now();

    const [result] = await conn.query(`
      INSERT INTO nghiem_thu_vat_tu_cong_trinh (
        ma_phieu_nghiem_thu, id_cong_trinh, id_kho_tam,
        ngay_nghiem_thu, nguoi_nghiem_thu, ghi_chu
      ) VALUES (?, ?, ?, NOW(), ?, ?)
    `, [maPhieuNT, id_cong_trinh, idKhoTam, nguoi_nghiem_thu || 'CBKT', ghi_chu || '']);

    const ntId = result.insertId;

    for (const item of items) {
      const usedQty = parseFloat(item.so_luong_thuc_te_su_dung) || 0;
      const price = parseFloat(item.don_gia) || 0;
      const total = usedQty * price;

      // Fetch current temp stock
      const [stock] = await conn.query(`
        SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ? FOR UPDATE
      `, [idKhoTam, item.id_danh_muc_vat_tu]);

      const currentStock = stock[0] ? parseFloat(stock[0].so_luong_ton) : 0;
      const remainingStock = Math.max(0, currentStock - usedQty);

      await conn.query(`
        INSERT INTO nghiem_thu_vat_tu_chi_tiet (
          id_nghiem_thu, id_danh_muc_vat_tu, so_luong_da_giao,
          so_luong_thuc_te_su_dung, so_luong_con_lai, don_gia, thanh_tien, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [ntId, item.id_danh_muc_vat_tu, currentStock, usedQty, remainingStock, price, total, item.ghi_chu || '']);

      // Deduct used quantity from Site Temp Warehouse
      await conn.query(`
        UPDATE ton_kho
        SET so_luong_ton = so_luong_ton - ?
        WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
      `, [usedQty, idKhoTam, item.id_danh_muc_vat_tu]);

      await conn.query(`
        INSERT INTO ton_kho_lich_su (
          id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi,
          id_chung_tu, loai_chung_tu, ghi_chu, thoi_gian_tao
        ) VALUES (?, ?, ?, ?, 'Nghiem_thu_cong_trinh', ?, NOW())
      `, [idKhoTam, item.id_danh_muc_vat_tu, -usedQty, ntId, `Nghiệm thu tiêu hao theo ${maPhieuNT}`]);
    }

    await conn.commit();
    conn.release();

    res.json({ message: 'Lập phiếu nghiệm thu tiêu hao vật tư thành công!' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi lập phiếu nghiệm thu.' });
  }
});

// ==========================================
// 7. LUÂN CHUYỂN KHO NỘI BỘ & TRẢ VẬT TƯ DƯ
// ==========================================

router.get('/luan-chuyen', async (req, res) => {
  try {
    const db = getDb(req);
    const [rows] = await db.query(`
      SELECT pc.*,
             k_nguon.ten_kho AS ten_kho_nguon,
             k_dich.ten_kho AS ten_kho_dich,
             c.ten_cong_trinh
      FROM phieu_chuyen_kho_noi_bo pc
      LEFT JOIN kho_hang k_nguon ON pc.id_kho_nguon = k_nguon.id
      LEFT JOIN kho_hang k_dich ON pc.id_kho_dich = k_dich.id
      LEFT JOIN cong_trinh c ON pc.id_cong_trinh = c.id
      ORDER BY pc.id DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tải phiếu luân chuyển.' });
  }
});

router.post('/luan-chuyen', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { id_kho_nguon, id_kho_dich, id_cong_trinh, nguoi_thuc_hien, ghi_chu, items = [] } = req.body;

    const currentYear = new Date().getFullYear();
    const seq = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: 1,
      loai_chung_tu: 'CK',
      nam: currentYear,
      ma_lvkd: 'BT'
    });

    const [result] = await conn.query(`
      INSERT INTO phieu_chuyen_kho_noi_bo (
        ma_phieu_chuyen, so_vao_so, nam, id_linh_vuc_kinh_doanh,
        id_kho_nguon, id_kho_dich, id_cong_trinh, ngay_chuyen, nguoi_thuc_hien, trang_thai, ghi_chu
      ) VALUES (?, ?, ?, 1, ?, ?, ?, NOW(), ?, 'Đã chuyển', ?)
    `, [seq.ma_phieu, seq.so_vao_so, currentYear, id_kho_nguon, id_kho_dich, id_cong_trinh || null, nguoi_thuc_hien || 'Nhân viên', ghi_chu || '']);

    const transferId = result.insertId;

    for (const item of items) {
      const qty = parseFloat(item.so_luong_chuyen) || 0;

      await conn.query(`
        INSERT INTO phieu_chuyen_kho_chi_tiet (id_phieu_chuyen, id_danh_muc_vat_tu, don_vi_tinh, so_luong_chuyen, ghi_chu)
        VALUES (?, ?, ?, ?, ?)
      `, [transferId, item.id_danh_muc_vat_tu, item.don_vi_tinh || '', qty, item.ghi_chu || '']);

      // Deduct from source warehouse
      await conn.query(`
        UPDATE ton_kho SET so_luong_ton = so_luong_ton - ? WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
      `, [qty, id_kho_nguon, item.id_danh_muc_vat_tu]);

      await conn.query(`
        INSERT INTO ton_kho_lich_su (id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, ghi_chu, thoi_gian_tao)
        VALUES (?, ?, ?, ?, 'Chuyen_kho_noi_bo', ?, NOW())
      `, [id_kho_nguon, item.id_danh_muc_vat_tu, -qty, transferId, `Luân chuyển xuất kho theo ${seq.ma_phieu}`]);

      // Add to destination warehouse
      const [destStock] = await conn.query('SELECT id FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?', [id_kho_dich, item.id_danh_muc_vat_tu]);
      if (destStock.length > 0) {
        await conn.query('UPDATE ton_kho SET so_luong_ton = so_luong_ton + ? WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?', [qty, id_kho_dich, item.id_danh_muc_vat_tu]);
      } else {
        await conn.query('INSERT INTO ton_kho (id_kho_hang, id_danh_muc_vat_tu, so_luong_ton) VALUES (?, ?, ?)', [id_kho_dich, item.id_danh_muc_vat_tu, qty]);
      }

      await conn.query(`
        INSERT INTO ton_kho_lich_su (id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, ghi_chu, thoi_gian_tao)
        VALUES (?, ?, ?, ?, 'Chuyen_kho_noi_bo', ?, NOW())
      `, [id_kho_dich, item.id_danh_muc_vat_tu, qty, transferId, `Luân chuyển nhập kho theo ${seq.ma_phieu}`]);
    }

    await conn.commit();
    conn.release();

    res.json({ message: 'Luân chuyển kho thành công!', ma_phieu: seq.ma_phieu });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi luân chuyển kho.' });
  }
});

// ==========================================
// 8. BÁO CÁO CHI PHÍ VẬT TƯ CÔNG TRÌNH
// ==========================================

router.get('/bao-cao-chi-phi', async (req, res) => {
  try {
    const db = getDb(req);

    // Total Exported
    const [exportedRows] = await db.query(`
      SELECT px.id_cong_trinh, c.ten_cong_trinh, COALESCE(SUM(pxct.thanh_tien), 0) AS tong_xuat
      FROM phieu_xuat_kho_chi_tiet pxct
      JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
      JOIN cong_trinh c ON px.id_cong_trinh = c.id
      WHERE px.trang_thai_xuat = 'Đã xuất hàng' AND px.loai_xuat_kho = 'cong_trinh'
      GROUP BY px.id_cong_trinh, c.ten_cong_trinh
    `);

    // Site Temp Stock Cost
    const [tempStockRows] = await db.query(`
      SELECT k.id_cong_trinh, c.ten_cong_trinh,
             COALESCE(SUM(tk.so_luong_ton * v.don_gia_tieu_chuan), 0) AS tong_kho_tam
      FROM ton_kho tk
      JOIN kho_hang k ON tk.id_kho_hang = k.id
      JOIN cong_trinh c ON k.id_cong_trinh = c.id
      JOIN danh_muc_vat_tu v ON tk.id_danh_muc_vat_tu = v.id
      WHERE k.la_kho_tam_cong_trinh = 1
      GROUP BY k.id_cong_trinh, c.ten_cong_trinh
    `);

    // Actually Accepted Cost
    const [acceptedRows] = await db.query(`
      SELECT nt.id_cong_trinh, c.ten_cong_trinh, COALESCE(SUM(ntct.thanh_tien), 0) AS tong_nghiem_thu
      FROM nghiem_thu_vat_tu_chi_tiet ntct
      JOIN nghiem_thu_vat_tu_cong_trinh nt ON ntct.id_nghiem_thu = nt.id
      JOIN cong_trinh c ON nt.id_cong_trinh = c.id
      GROUP BY nt.id_cong_trinh, c.ten_cong_trinh
    `);

    res.json({
      exported: exportedRows,
      tempStock: tempStockRows,
      accepted: acceptedRows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tải báo cáo chi phí vật tư công trình.' });
  }
});

// GET Summarized Exported Materials for a Project (Total Exported from both site exports and site PO deliveries)
router.get('/tong-hop-xuat', async (req, res) => {
  try {
    const db = getDb(req);
    const { id_cong_trinh, search, loai_vat_tu, nguon_cap } = req.query;

    if (!id_cong_trinh) {
      return res.json([]);
    }

    const unionQueries = [];
    const unionParams = [];

    // Source 1: Phiếu xuất kho từ Kho Tổng
    if (!nguon_cap || nguon_cap === 'ALL' || nguon_cap === 'PHIEU_XUAT' || nguon_cap === 'KHO_TONG') {
      unionQueries.push(`
        SELECT 
          pxct.id_danh_muc_vat_tu,
          COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) AS so_luong,
          COALESCE(pxct.don_gia, 0) AS don_gia,
          COALESCE(pxct.thanh_tien, (COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) * COALESCE(pxct.don_gia, 0))) AS thanh_tien
        FROM phieu_xuat_kho_chi_tiet pxct
        JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
        WHERE px.id_cong_trinh = ?
          AND (px.trang_thai_xuat = 'Đã xuất hàng' OR px.trang_thai_xuat IS NULL OR px.trang_thai_xuat = 'Nháp' OR px.trang_thai_xuat = 'Đã xuất')
      `);
      unionParams.push(id_cong_trinh);
    }

    // Source 2: Phiếu mua hàng giao thẳng cho công trình (PO) đã giao
    if (!nguon_cap || nguon_cap === 'ALL' || nguon_cap === 'PHIEU_GIAO' || nguon_cap === 'MUA_TRUC_TIEP') {
      unionQueries.push(`
        SELECT 
          pmct.id_danh_muc_vat_tu,
          COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) AS so_luong,
          COALESCE(pmct.don_gia, 0) AS don_gia,
          COALESCE(pmct.thanh_tien, (COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) * COALESCE(pmct.don_gia, 0))) AS thanh_tien
        FROM phieu_mua_hang_chi_tiet pmct
        JOIN phieu_mua_hang pm ON pmct.id_phieu_mua_hang = pm.id
        WHERE pm.id_cong_trinh = ?
          AND (
            pm.trang_thai_giao_hang = 'Đã giao'
            OR pm.trang_thai_giao_hang IS NULL
            OR pm.trang_thai_giao_hang <> 'Đã hủy'
          )
      `);
      unionParams.push(id_cong_trinh);
    }

    if (unionQueries.length === 0) {
      return res.json([]);
    }

    const unionSql = unionQueries.join(' UNION ALL ');

    let mainQuery = `
      SELECT 
        v.id AS id_danh_muc_vat_tu,
        v.ma_vat_tu,
        v.ten_vat_tu,
        v.don_vi_tinh,
        lvt.ten_loai_vat_tu AS loai_vat_tu,
        COALESCE(SUM(c.so_luong), 0) AS tong_so_luong_xuat,
        COALESCE(SUM(c.thanh_tien) / NULLIF(SUM(c.so_luong), 0), COALESCE(AVG(NULLIF(c.don_gia, 0)), 0)) AS don_gia_trung_binh,
        COALESCE(SUM(c.thanh_tien), 0) AS tong_thanh_tien
      FROM (${unionSql}) c
      JOIN danh_muc_vat_tu v ON c.id_danh_muc_vat_tu = v.id
      LEFT JOIN danh_muc_loai_vat_tu lvt ON v.id_loai_vat_tu = lvt.id
      WHERE 1=1
    `;
    const params = [...unionParams];

    if (loai_vat_tu && loai_vat_tu.trim() !== '') {
      mainQuery += ` AND (lvt.ten_loai_vat_tu LIKE ?)`;
      params.push(`%${loai_vat_tu.trim()}%`);
    }

    if (search && search.trim() !== '') {
      mainQuery += ` AND (v.ma_vat_tu LIKE ? OR v.ten_vat_tu LIKE ? OR lvt.ten_loai_vat_tu LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    mainQuery += ` GROUP BY v.id, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh, lvt.ten_loai_vat_tu ORDER BY v.ten_vat_tu ASC`;

    const [rows] = await db.query(mainQuery, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tải tổng hợp vật tư đã cấp cho công trình.' });
  }
});

// GET Detailed Material Deliveries Grouped by Date & Supplier for Print / Analysis
router.get('/bao-cao-theo-ncc', async (req, res) => {
  try {
    const db = getDb(req);
    const { id_cong_trinh, tu_ngay, den_ngay, search } = req.query;

    if (!id_cong_trinh) {
      return res.json([]);
    }

    const unionQueries = [];
    const unionParams = [];

    // 1. Từ Phiếu xuất kho công trình (load toàn bộ các phiếu đã xuất cho công trình)
    unionQueries.push(`
      SELECT 
        px.id AS id_phieu,
        px.ma_phieu,
        DATE(COALESCE(px.thoi_gian_xuat, px.thoi_gian_tao)) AS ngay_giao,
        COALESCE(kx.ten_kho, 'Kho Tổng / Công ty') AS nha_cung_cap,
        'Kho Tổng / Công ty' AS loai_nguon,
        v.id AS id_danh_muc_vat_tu,
        v.ma_vat_tu,
        v.ten_vat_tu,
        COALESCE(pxct.don_vi_tinh, v.don_vi_tinh) AS don_vi_tinh,
        COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) AS so_luong,
        COALESCE(pxct.don_gia, 0) AS don_gia,
        COALESCE(pxct.thanh_tien, (COALESCE(pxct.so_luong_xuat, pxct.so_luong, 0) * COALESCE(pxct.don_gia, 0))) AS thanh_tien,
        pxct.ghi_chu
      FROM phieu_xuat_kho_chi_tiet pxct
      JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
      LEFT JOIN kho_hang kx ON px.id_kho_hang = kx.id
      JOIN danh_muc_vat_tu v ON pxct.id_danh_muc_vat_tu = v.id
      WHERE px.id_cong_trinh = ?
        AND (px.trang_thai_xuat <> 'Đã hủy' OR px.trang_thai_xuat IS NULL)
    `);
    unionParams.push(id_cong_trinh);

    // 2. Từ Phiếu mua hàng giao thẳng cho công trình (load toàn bộ các phiếu mua cho công trình)
    unionQueries.push(`
      SELECT 
        pm.id AS id_phieu,
        pm.ma_phieu_mua AS ma_phieu,
        DATE(COALESCE(pm.ngay_giao_thuc_te, pm.ngay_du_kien_giao, pm.ngay_mua, pm.created_at)) AS ngay_giao,
        COALESCE(ncc.ten_nha_cung_cap, pm.ten_nha_cung_cap, 'Nhà cung cấp ngoài') AS nha_cung_cap,
        'Mua hàng giao thẳng' AS loai_nguon,
        v.id AS id_danh_muc_vat_tu,
        v.ma_vat_tu,
        v.ten_vat_tu,
        COALESCE(pmct.don_vi_tinh, v.don_vi_tinh) AS don_vi_tinh,
        COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) AS so_luong,
        COALESCE(pmct.don_gia, 0) AS don_gia,
        COALESCE(pmct.thanh_tien, (COALESCE(pmct.so_luong_nhan_thuc_te, pmct.so_luong_mua, 0) * COALESCE(pmct.don_gia, 0))) AS thanh_tien,
        pmct.ghi_chu
      FROM phieu_mua_hang_chi_tiet pmct
      JOIN phieu_mua_hang pm ON pmct.id_phieu_mua_hang = pm.id
      LEFT JOIN nha_cung_cap ncc ON pm.id_nha_cung_cap = ncc.id
      JOIN danh_muc_vat_tu v ON pmct.id_danh_muc_vat_tu = v.id
      WHERE pm.id_cong_trinh = ?
        AND (pm.trang_thai_giao_hang <> 'Đã hủy' OR pm.trang_thai_giao_hang IS NULL)
    `);
    unionParams.push(id_cong_trinh);

    const unionSql = unionQueries.join(' UNION ALL ');

    let mainQuery = `
      SELECT * FROM (${unionSql}) t
      WHERE 1=1
    `;
    const params = [...unionParams];

    if (tu_ngay) {
      mainQuery += ` AND t.ngay_giao >= ?`;
      params.push(tu_ngay);
    }
    if (den_ngay) {
      mainQuery += ` AND t.ngay_giao <= ?`;
      params.push(den_ngay);
    }
    if (search && search.trim() !== '') {
      mainQuery += ` AND (t.ma_phieu LIKE ? OR t.nha_cung_cap LIKE ? OR t.ten_vat_tu LIKE ? OR t.ma_vat_tu LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term);
    }

    mainQuery += ` ORDER BY t.ngay_giao DESC, t.nha_cung_cap ASC, t.ma_phieu ASC, t.ten_vat_tu ASC`;

    const [rows] = await db.query(mainQuery, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi tải chi tiết vật tư theo nhà cung cấp: ' + err.message });
  }
});

// DELETE /api/vat-tu-cong-trinh/yeu-cau/:id
router.delete('/yeu-cau/:id', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id, trang_thai FROM yeu_cau_vat_tu WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Không tìm thấy phiếu yêu cầu vật tư.' });
    }
    if (existing[0].trang_thai === 'Đã duyệt') {
      await conn.rollback();
      return res.status(400).json({ message: 'Không thể xóa phiếu yêu cầu đã được duyệt.' });
    }
    await conn.query('DELETE FROM yeu_cau_vat_tu_chi_tiet WHERE id_yeu_cau_vat_tu = ?', [req.params.id]);
    await conn.query('DELETE FROM yeu_cau_vat_tu WHERE id = ?', [req.params.id]);
    await conn.commit();
    res.json({ message: 'Đã xóa phiếu yêu cầu vật tư thành công.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi xóa phiếu yêu cầu: ' + err.message });
  } finally {
    conn.release();
  }
});

// DELETE /api/vat-tu-cong-trinh/phieu-xuat/:id
router.delete('/phieu-xuat/:id', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query('SELECT id, trang_thai_xuat FROM phieu_xuat_kho WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'Không tìm thấy phiếu xuất kho.' });
    }
    if (existing[0].trang_thai_xuat === 'Đã xuất hàng') {
      await conn.rollback();
      return res.status(400).json({ message: 'Không thể xóa phiếu xuất kho đã xác nhận xuất hàng.' });
    }
    await conn.query('DELETE FROM phieu_xuat_kho_chi_tiet WHERE id_phieu_xuat_kho = ?', [req.params.id]);
    await conn.query('DELETE FROM phieu_xuat_kho WHERE id = ?', [req.params.id]);
    await conn.commit();
    res.json({ message: 'Đã xóa phiếu xuất kho thành công.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: 'Lỗi khi xóa phiếu xuất kho: ' + err.message });
  } finally {
    conn.release();
  }
});

// PUT /api/vat-tu-cong-trinh/phieu-xuat/:id/huy - Hủy phiếu xuất kho & Hoàn tồn kho (Revert Stock)
router.put('/phieu-xuat/:id/huy', async (req, res) => {
  const db = getDb(req);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { ly_do_huy } = req.body;
    if (!ly_do_huy || !ly_do_huy.trim()) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'Vui lòng cung cấp lý do hủy phiếu xuất kho.' });
    }

    const [pxRows] = await conn.query('SELECT * FROM phieu_xuat_kho WHERE id = ? FOR UPDATE', [req.params.id]);
    if (pxRows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu xuất kho.' });
    }

    const px = pxRows[0];
    if (px.trang_thai_xuat === 'Đã hủy') {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ message: 'Phiếu xuất kho này đã được hủy trước đó.' });
    }

    const [items] = await conn.query(`
      SELECT pxct.*, v.ten_vat_tu, v.ma_vat_tu
      FROM phieu_xuat_kho_chi_tiet pxct
      LEFT JOIN danh_muc_vat_tu v ON pxct.id_danh_muc_vat_tu = v.id
      WHERE pxct.id_phieu_xuat_kho = ?
    `, [req.params.id]);

    const sourceWhId = px.id_kho_hang || px.id_kho;
    const destWhId = px.id_kho_tam_nhan;

    // Nếu phiếu đã ở trạng thái "Đã xuất hàng", cần hoàn kho và kiểm tra tồn kho tạm
    if (px.trang_thai_xuat === 'Đã xuất hàng') {
      // 1. Kiểm tra tồn kho tại Kho tạm công trình xem có đủ số lượng để thu hồi không
      for (const item of items) {
        const needQty = parseFloat(item.so_luong_xuat || item.so_luong || 0);
        if (needQty <= 0) continue;

        if (destWhId) {
          const [destStock] = await conn.query(`
            SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ? FOR UPDATE
          `, [destWhId, item.id_danh_muc_vat_tu]);

          const currentDestStock = destStock[0] ? parseFloat(destStock[0].so_luong_ton) : 0;

          if (currentDestStock < needQty) {
            await conn.rollback();
            conn.release();
            const matName = item.ten_vat_tu ? `${item.ten_vat_tu} (${item.ma_vat_tu})` : `Vật tư ID ${item.id_danh_muc_vat_tu}`;
            return res.status(400).json({
              message: `Kho tạm công trình không đủ tồn kho để thu hồi cho ${matName} (Tồn hiện tại: ${currentDestStock} ${item.don_vi_tinh || ''}, Cần thu hồi: ${needQty} ${item.don_vi_tinh || ''}). Vật tư có thể đã được nghiệm thu hoặc xuất sử dụng.`
            });
          }
        }
      }

      // 2. Thực hiện hoàn kho 2 đầu: Trừ kho tạm công trình (-qty) và Cộng lại kho nguồn (+qty)
      for (const item of items) {
        const qty = parseFloat(item.so_luong_xuat || item.so_luong || 0);
        if (qty <= 0) continue;

        // 2a. Trừ kho tạm công trình (nếu có kho tạm)
        if (destWhId) {
          const [destStock] = await conn.query(`
            SELECT id FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
          `, [destWhId, item.id_danh_muc_vat_tu]);
          const destTonKhoId = destStock.length > 0 ? destStock[0].id : null;

          await conn.query(`
            UPDATE ton_kho
            SET so_luong_ton = so_luong_ton - ?
            WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
          `, [qty, destWhId, item.id_danh_muc_vat_tu]);

          await conn.query(`
            INSERT INTO ton_kho_lich_su (
              id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi,
              id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao, thoi_gian_tao
            ) VALUES (?, ?, ?, ?, ?, 'Thu hồi kho tạm', ?, ?, NOW())
          `, [destTonKhoId, destWhId, item.id_danh_muc_vat_tu, -qty, px.id, `Thu hồi kho tạm do hủy phiếu xuất ${px.ma_phieu}`, nguoiHuy]);
        }

        // 2b. Cộng trả lại kho nguồn
        if (sourceWhId) {
          let sourceTonKhoId = null;
          const [sourceStock] = await conn.query(`
            SELECT id FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
          `, [sourceWhId, item.id_danh_muc_vat_tu]);

          if (sourceStock.length > 0) {
            sourceTonKhoId = sourceStock[0].id;
            await conn.query(`
              UPDATE ton_kho
              SET so_luong_ton = so_luong_ton + ?
              WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
            `, [qty, sourceWhId, item.id_danh_muc_vat_tu]);
          } else {
            const [insertSource] = await conn.query(`
              INSERT INTO ton_kho (id_kho_hang, id_danh_muc_vat_tu, so_luong_ton)
              VALUES (?, ?, ?)
            `, [sourceWhId, item.id_danh_muc_vat_tu, qty]);
            sourceTonKhoId = insertSource.insertId;
          }

          await conn.query(`
            INSERT INTO ton_kho_lich_su (
              id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi,
              id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao, thoi_gian_tao
            ) VALUES (?, ?, ?, ?, ?, 'Hoàn trả xuất kho', ?, ?, NOW())
          `, [sourceTonKhoId, sourceWhId, item.id_danh_muc_vat_tu, qty, px.id, `Hoàn trả tồn kho từ phiếu xuất hủy ${px.ma_phieu}`, nguoiHuy]);
        }
      }
    }

    const nguoiHuy = req.user?.ho_ten || req.user?.ten_dang_nhap || 'Hệ thống';

    // 3. Cập nhật trạng thái phiếu xuất sang 'Đã hủy'
    await conn.query(`
      UPDATE phieu_xuat_kho
      SET trang_thai_xuat = 'Đã hủy',
          ly_do_huy = ?,
          thoi_gian_huy = NOW(),
          nguoi_huy = ?
      WHERE id = ?
    `, [ly_do_huy.trim(), nguoiHuy, req.params.id]);

    // Ghi nhật ký thao tác
    const [updatedRows] = await conn.query('SELECT * FROM phieu_xuat_kho WHERE id = ?', [req.params.id]);
    await logChange(conn, 'phieu_xuat_kho', px.id, 'HUY_PHIEU', px, updatedRows[0], req.user?.ten_dang_nhap);

    await conn.commit();
    conn.release();

    res.json({
      message: 'Hủy phiếu xuất kho và hoàn tồn kho thành công!',
      id: px.id,
      ma_phieu: px.ma_phieu
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Lỗi khi hủy phiếu xuất kho:', err);
    res.status(500).json({ message: 'Lỗi khi hủy phiếu xuất kho: ' + err.message });
  }
});

module.exports = router;
