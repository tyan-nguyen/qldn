const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');
const { generateSequenceNumber } = require('../services/sequenceService');
const { VNDToWords } = require('../utils/numberToWords');

const uploadsDir = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'mat-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage });

// Helper to save uploaded files into the `files` table
async function saveUploadedFiles(connection, ten_bang, id_ban_ghi, reqFiles, nguoi_tao) {
  if (!reqFiles || !Array.isArray(reqFiles) || reqFiles.length === 0) return [];
  
  const savedRecords = [];
  for (const file of reqFiles) {
    const originalName = file.originalname || 'unnamed_file';
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

    const duongDan = `/public/uploads/${savedName}`;
    const kichThuoc = file.size || 0;

    const [res] = await connection.query(
      `INSERT INTO files (ten_bang, id_ban_ghi, ten_file, ten_file_luu, loai_file, extension, duong_dan, kich_thuoc, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ten_bang, id_ban_ghi, originalName, savedName, loaiFile, ext, duongDan, kichThuoc, nguoi_tao]
    );

    savedRecords.push({
      id: res.insertId,
      ten_bang,
      id_ban_ghi,
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

// Helper to attach files array to a list of records
async function attachFilesToRecords(poolOrConn, ten_bang, records) {
  if (!records || records.length === 0) return records;

  const ids = records.map(r => r.id).filter(Boolean);
  if (ids.length === 0) return records;

  const [fileRows] = await poolOrConn.query(
    `SELECT * FROM files WHERE ten_bang = ? AND id_ban_ghi IN (?) ORDER BY id ASC`,
    [ten_bang, ids]
  );

  const filesMap = {};
  fileRows.forEach(f => {
    if (!filesMap[f.id_ban_ghi]) {
      filesMap[f.id_ban_ghi] = [];
    }
    filesMap[f.id_ban_ghi].push(f);
  });

  records.forEach(r => {
    r.files = filesMap[r.id] || [];
    let avatarFile = null;
    if (r.id_anh_dai_dien) {
      avatarFile = r.files.find(f => f.id === r.id_anh_dai_dien);
    }
    if (!avatarFile && r.files.length > 0) {
      avatarFile = r.files[0];
    }
    r.anh_dai_dien = avatarFile ? avatarFile.duong_dan : null;
  });

  return records;
}

// Transactional Stock Update Helper
async function updateStock(connection, id_kho, id_vat_tu, change_qty) {
  const [existing] = await connection.query(
    'SELECT id, so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?',
    [id_kho, id_vat_tu]
  );

  if (existing.length > 0) {
    const newQty = parseFloat(existing[0].so_luong_ton) + change_qty;
    await connection.query('UPDATE ton_kho SET so_luong_ton = ? WHERE id = ?', [newQty, existing[0].id]);
    return existing[0].id;
  } else {
    const [ins] = await connection.query(
      'INSERT INTO ton_kho (id_kho_hang, id_danh_muc_vat_tu, so_luong_ton, nguoi_tao) VALUES (?, ?, ?, ?)',
      [id_kho, id_vat_tu, change_qty, 'Hệ thống']
    );
    return ins.insertId;
  }
}

// ========================================================
// 1. LOẠI VẬT TƯ (CATEGORIES)
// ========================================================
router.get('/loai-vat-tu', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM danh_muc_loai_vat_tu WHERE COALESCE(da_xoa, 0) = 0 ORDER BY id DESC');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn loại vật tư.' });
  }
});

router.post('/loai-vat-tu', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { ten_loai_vat_tu, ghi_chu } = req.body;
  if (!ten_loai_vat_tu || !ten_loai_vat_tu.trim()) {
    return res.status(400).json({ message: 'Tên loại vật tư là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      'INSERT INTO danh_muc_loai_vat_tu (ten_loai_vat_tu, ghi_chu, nguoi_tao) VALUES (?, ?, ?)',
      [ten_loai_vat_tu.trim(), ghi_chu || null, req.user.ten_dang_nhap]
    );

    const [newRow] = await connection.query('SELECT * FROM danh_muc_loai_vat_tu WHERE id = ?', [result.insertId]);
    await logChange(connection, 'danh_muc_loai_vat_tu', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi tạo loại vật tư.' });
  } finally {
    connection.release();
  }
});

router.put('/loai-vat-tu/:id', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { ten_loai_vat_tu, ghi_chu } = req.body;
  if (!ten_loai_vat_tu || !ten_loai_vat_tu.trim()) {
    return res.status(400).json({ message: 'Tên loại vật tư là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM danh_muc_loai_vat_tu WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy loại vật tư.' });
    }

    await connection.query(
      'UPDATE danh_muc_loai_vat_tu SET ten_loai_vat_tu = ?, ghi_chu = ? WHERE id = ?',
      [ten_loai_vat_tu.trim(), ghi_chu !== undefined ? (ghi_chu || null) : oldRow[0].ghi_chu, req.params.id]
    );

    const [newRow] = await connection.query('SELECT * FROM danh_muc_loai_vat_tu WHERE id = ?', [req.params.id]);
    await logChange(connection, 'danh_muc_loai_vat_tu', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi cập nhật loại vật tư.' });
  } finally {
    connection.release();
  }
});

router.delete('/loai-vat-tu/:id', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM danh_muc_loai_vat_tu WHERE id = ? AND COALESCE(da_xoa, 0) = 0', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy loại vật tư hoặc loại vật tư đã bị xóa.' });
    }

    // Kiểm tra ràng buộc với danh_muc_vat_tu
    const [matRows] = await connection.query(
      'SELECT ma_vat_tu, ten_vat_tu FROM danh_muc_vat_tu WHERE id_loai_vat_tu = ? AND COALESCE(da_xoa, 0) = 0',
      [req.params.id]
    );

    if (matRows.length > 0) {
      connection.release();
      const sampleMats = matRows.slice(0, 5).map(m => `"${m.ten_vat_tu}" (${m.ma_vat_tu})`).join(', ');
      const moreText = matRows.length > 5 ? ` và ${matRows.length - 5} vật tư khác` : '';
      return res.status(400).json({
        message: `Không thể xóa loại vật tư "${oldRow[0].ten_loai_vat_tu}" vì đang có ${matRows.length} vật tư trực thuộc: ${sampleMats}${moreText}. Vui lòng chuyển phân loại hoặc xóa các vật tư này trước.`
      });
    }

    // Thực hiện xóa mềm
    await connection.query('UPDATE danh_muc_loai_vat_tu SET da_xoa = 1 WHERE id = ?', [req.params.id]);

    await logChange(connection, 'danh_muc_loai_vat_tu', req.params.id, 'XOA', oldRow[0], { da_xoa: 1 }, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: `Đã xóa loại vật tư "${oldRow[0].ten_loai_vat_tu}" thành công.` });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xóa loại vật tư.' });
  } finally {
    connection.release();
  }
});

// ========================================================
// 2. KHO HÀNG (WAREHOUSES)
// ========================================================
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT k.*, c.ten_cong_trinh 
       FROM kho_hang k
       LEFT JOIN cong_trinh c ON k.id_cong_trinh = c.id
       WHERE COALESCE(k.da_xoa, 0) = 0
       ORDER BY k.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn kho hàng.' });
  }
});

router.get('/kho-hang', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT k.*, c.ten_cong_trinh 
       FROM kho_hang k
       LEFT JOIN cong_trinh c ON k.id_cong_trinh = c.id
       WHERE COALESCE(k.da_xoa, 0) = 0
       ORDER BY k.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn kho hàng.' });
  }
});

router.post('/kho-hang', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { ten_kho, loai_kho, id_cong_trinh, dia_diem, ghi_chu } = req.body;
  if (!ten_kho || !loai_kho) {
    return res.status(400).json({ message: 'Tên kho và loại kho là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      'INSERT INTO kho_hang (ten_kho, loai_kho, id_cong_trinh, dia_diem, ghi_chu, nguoi_tao) VALUES (?, ?, ?, ?, ?, ?)',
      [
        ten_kho.trim(),
        loai_kho,
        loai_kho === 'Kho công trình' ? (id_cong_trinh || null) : null,
        dia_diem || null,
        ghi_chu || null,
        req.user.ten_dang_nhap
      ]
    );

    const [newRow] = await connection.query(
      `SELECT k.*, c.ten_cong_trinh 
       FROM kho_hang k 
       LEFT JOIN cong_trinh c ON k.id_cong_trinh = c.id 
       WHERE k.id = ?`,
      [result.insertId]
    );

    await logChange(connection, 'kho_hang', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi tạo kho hàng.' });
  } finally {
    connection.release();
  }
});

router.put('/kho-hang/:id', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { ten_kho, loai_kho, id_cong_trinh, dia_diem, ghi_chu } = req.body;
  if (!ten_kho || !loai_kho) {
    return res.status(400).json({ message: 'Tên kho và loại kho là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM kho_hang WHERE id = ? AND COALESCE(da_xoa, 0) = 0', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy kho hàng.' });
    }

    await connection.query(
      'UPDATE kho_hang SET ten_kho = ?, loai_kho = ?, id_cong_trinh = ?, dia_diem = ?, ghi_chu = ? WHERE id = ?',
      [
        ten_kho.trim(),
        loai_kho,
        loai_kho === 'Kho công trình' ? (id_cong_trinh || null) : null,
        dia_diem !== undefined ? (dia_diem || null) : oldRow[0].dia_diem,
        ghi_chu !== undefined ? (ghi_chu || null) : oldRow[0].ghi_chu,
        req.params.id
      ]
    );

    const [newRow] = await connection.query(
      `SELECT k.*, c.ten_cong_trinh 
       FROM kho_hang k 
       LEFT JOIN cong_trinh c ON k.id_cong_trinh = c.id 
       WHERE k.id = ?`,
      [req.params.id]
    );

    await logChange(connection, 'kho_hang', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi cập nhật kho hàng.' });
  } finally {
    connection.release();
  }
});

router.delete('/kho-hang/:id', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM kho_hang WHERE id = ? AND COALESCE(da_xoa, 0) = 0', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy kho hàng hoặc kho hàng đã bị xóa.' });
    }

    const khoId = req.params.id;
    const reasons = [];

    // 1. Kiểm tra tồn kho thực tế
    const [stockRows] = await connection.query(
      'SELECT SUM(so_luong_ton) as total_stock, COUNT(*) as cnt FROM ton_kho WHERE id_kho_hang = ? AND so_luong_ton > 0',
      [khoId]
    );
    if (stockRows[0] && parseFloat(stockRows[0].total_stock || 0) > 0) {
      reasons.push(`Đang còn tồn ${parseFloat(stockRows[0].total_stock).toLocaleString('vi-VN')} số lượng hàng hóa/vật tư trong kho`);
    }

    // 2. Phiếu nhập kho
    const [pnkRows] = await connection.query(
      'SELECT COUNT(*) as cnt FROM phieu_nhap_kho WHERE (id_kho_hang = ? OR id_kho_tam_nguon = ?) AND COALESCE(da_xoa, 0) = 0',
      [khoId, khoId]
    );
    if (pnkRows[0]?.cnt > 0) {
      reasons.push(`Đang phát sinh trong ${pnkRows[0].cnt} phiếu nhập kho`);
    }

    // 3. Phiếu xuất kho
    const [pxkRows] = await connection.query(
      'SELECT COUNT(*) as cnt FROM phieu_xuat_kho WHERE (id_kho_hang = ? OR id_kho_tam_nhan = ?) AND COALESCE(da_xoa, 0) = 0',
      [khoId, khoId]
    );
    if (pxkRows[0]?.cnt > 0) {
      reasons.push(`Đang phát sinh trong ${pxkRows[0].cnt} phiếu xuất kho`);
    }

    // 4. Phiếu mua hàng
    try {
      const [pmhRows] = await connection.query(
        'SELECT COUNT(*) as cnt FROM phieu_mua_hang WHERE id_kho_nhap = ?',
        [khoId]
      );
      if (pmhRows[0]?.cnt > 0) {
        reasons.push(`Đang có ${pmhRows[0].cnt} phiếu mua hàng nhập về kho này`);
      }
    } catch (e) {}

    // 5. Phiếu chuyển kho nội bộ
    try {
      const [pckRows] = await connection.query(
        'SELECT COUNT(*) as cnt FROM phieu_chuyen_kho_noi_bo WHERE id_kho_nguon = ? OR id_kho_dich = ?',
        [khoId, khoId]
      );
      if (pckRows[0]?.cnt > 0) {
        reasons.push(`Đang liên kết với ${pckRows[0].cnt} phiếu chuyển kho nội bộ`);
      }
    } catch (e) {}

    // 6. Phiếu trả lại kho
    try {
      const [ptkRows] = await connection.query(
        'SELECT COUNT(*) as cnt FROM phieu_tra_lai_kho WHERE id_kho_nhan = ?',
        [khoId]
      );
      if (ptkRows[0]?.cnt > 0) {
        reasons.push(`Đang có ${ptkRows[0].cnt} phiếu trả lại kho`);
      }
    } catch (e) {}

    // 7. Kiểm kê kho
    try {
      const [pkkRows] = await connection.query(
        'SELECT COUNT(*) as cnt FROM kiem_ke_kho WHERE id_kho_hang = ?',
        [khoId]
      );
      if (pkkRows[0]?.cnt > 0) {
        reasons.push(`Đang có ${pkkRows[0].cnt} biên bản kiểm kê kho`);
      }
    } catch (e) {}

    // 8. Nghiệm thu vật tư công trình
    try {
      const [pntRows] = await connection.query(
        'SELECT COUNT(*) as cnt FROM nghiem_thu_vat_tu_cong_trinh WHERE id_kho_tam = ?',
        [khoId]
      );
      if (pntRows[0]?.cnt > 0) {
        reasons.push(`Đang là kho tạm của ${pntRows[0].cnt} biên bản nghiệm thu vật tư`);
      }
    } catch (e) {}

    if (reasons.length > 0) {
      connection.release();
      return res.status(400).json({
        message: `Không thể xóa kho hàng "${oldRow[0].ten_kho}" vì đã phát sinh dữ liệu liên kết:\n• ` + reasons.join('\n• ')
      });
    }

    // Thực hiện xóa mềm
    await connection.query('UPDATE kho_hang SET da_xoa = 1 WHERE id = ?', [khoId]);

    await logChange(connection, 'kho_hang', khoId, 'XOA', oldRow[0], { da_xoa: 1 }, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: `Đã xóa kho hàng "${oldRow[0].ten_kho}" thành công.` });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xóa kho hàng.' });
  } finally {
    connection.release();
  }
});

// ========================================================
// 3. DANH MỤC VẬT TƯ (MATERIALS)
// ========================================================
router.get('/vat-tu', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT v.*, l.ten_loai_vat_tu,
              COALESCE((SELECT SUM(so_luong_ton) FROM ton_kho WHERE id_danh_muc_vat_tu = v.id), 0) AS so_luong_ton 
       FROM danh_muc_vat_tu v
       LEFT JOIN danh_muc_loai_vat_tu l ON v.id_loai_vat_tu = l.id
       WHERE COALESCE(v.da_xoa, 0) = 0
       ORDER BY v.id DESC`
    );
    await attachFilesToRecords(pool, 'danh_muc_vat_tu', rows);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh mục vật tư.' });
  }
});

router.post('/vat-tu', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), upload.array('files'), async (req, res) => {
  const body = req.body || {};
  const { ma_vat_tu, ten_vat_tu, id_loai_vat_tu, don_vi_tinh, don_gia_tieu_chuan, ghi_chu, id_anh_dai_dien } = body;
  if (!ma_vat_tu || !ten_vat_tu) {
    return res.status(400).json({ message: 'Mã vật tư và tên vật tư là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [exist] = await connection.query('SELECT id FROM danh_muc_vat_tu WHERE ma_vat_tu = ? AND COALESCE(da_xoa, 0) = 0', [ma_vat_tu.trim()]);
    if (exist.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Mã vật tư này đã tồn tại trên hệ thống, vui lòng chọn mã khác.' });
    }

    const [result] = await connection.query(
      `INSERT INTO danh_muc_vat_tu (ma_vat_tu, ten_vat_tu, id_loai_vat_tu, don_vi_tinh, don_gia_tieu_chuan, ghi_chu, nguoi_tao) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        ma_vat_tu.trim(),
        ten_vat_tu.trim(),
        id_loai_vat_tu || null,
        don_vi_tinh || null,
        don_gia_tieu_chuan || 0,
        ghi_chu || null,
        req.user.ten_dang_nhap
      ]
    );
    const newId = result.insertId;

    // Save attached files
    const savedFiles = await saveUploadedFiles(connection, 'danh_muc_vat_tu', newId, req.files, req.user.ten_dang_nhap);

    let chosenAvatarId = parseInt(id_anh_dai_dien) || null;
    if (!chosenAvatarId && body.avatar_new_index !== undefined) {
      const idx = parseInt(body.avatar_new_index);
      if (!isNaN(idx) && savedFiles[idx]) {
        chosenAvatarId = savedFiles[idx].id;
      }
    }
    if (!chosenAvatarId && savedFiles.length > 0) {
      chosenAvatarId = savedFiles[0].id;
    }

    if (chosenAvatarId) {
      await connection.query('UPDATE danh_muc_vat_tu SET id_anh_dai_dien = ? WHERE id = ?', [chosenAvatarId, newId]);
    }

    const [newRow] = await connection.query(
      `SELECT v.*, l.ten_loai_vat_tu 
       FROM danh_muc_vat_tu v 
       LEFT JOIN danh_muc_loai_vat_tu l ON v.id_loai_vat_tu = l.id 
       WHERE v.id = ?`,
      [newId]
    );

    await attachFilesToRecords(connection, 'danh_muc_vat_tu', newRow);
    await logChange(connection, 'danh_muc_vat_tu', newId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi tạo danh mục vật tư.' });
  } finally {
    connection.release();
  }
});

router.put('/vat-tu/:id', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), upload.array('files'), async (req, res) => {
  const body = req.body || {};
  const { ma_vat_tu, ten_vat_tu, id_loai_vat_tu, don_vi_tinh, don_gia_tieu_chuan, ghi_chu, id_anh_dai_dien, delete_file_ids, avatar_new_index } = body;
  if (!ma_vat_tu || !ten_vat_tu) {
    return res.status(400).json({ message: 'Mã vật tư và tên vật tư là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM danh_muc_vat_tu WHERE id = ? AND COALESCE(da_xoa, 0) = 0', [req.params.id]);
    if (oldRow.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy vật tư.' });
    }

    const [exist] = await connection.query('SELECT id FROM danh_muc_vat_tu WHERE ma_vat_tu = ? AND id != ? AND COALESCE(da_xoa, 0) = 0', [ma_vat_tu.trim(), req.params.id]);
    if (exist.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Mã vật tư này đã được sử dụng bởi vật tư khác, vui lòng chọn mã khác.' });
    }

    // Save newly uploaded files
    const savedFiles = await saveUploadedFiles(connection, 'danh_muc_vat_tu', req.params.id, req.files, req.user.ten_dang_nhap);

    // Delete requested file IDs
    if (delete_file_ids) {
      let delIds = [];
      try {
        delIds = typeof delete_file_ids === 'string' ? JSON.parse(delete_file_ids) : delete_file_ids;
      } catch (e) {
        if (typeof delete_file_ids === 'string') delIds = delete_file_ids.split(',').map(n => parseInt(n)).filter(Boolean);
      }
      if (Array.isArray(delIds) && delIds.length > 0) {
        await connection.query('DELETE FROM files WHERE ten_bang = "danh_muc_vat_tu" AND id_ban_ghi = ? AND id IN (?)', [req.params.id, delIds]);
      }
    }

    // Determine avatar ID
    let chosenAvatarId = id_anh_dai_dien !== undefined && id_anh_dai_dien !== '' ? (parseInt(id_anh_dai_dien) || null) : oldRow[0].id_anh_dai_dien;
    if (!chosenAvatarId && avatar_new_index !== undefined) {
      const idx = parseInt(avatar_new_index);
      if (!isNaN(idx) && savedFiles[idx]) {
        chosenAvatarId = savedFiles[idx].id;
      }
    }
    
    // If no avatar ID is set or if avatar ID was deleted, fallback to the 1st remaining file
    const [allFiles] = await connection.query('SELECT id FROM files WHERE ten_bang = "danh_muc_vat_tu" AND id_ban_ghi = ? ORDER BY id ASC', [req.params.id]);
    const fileIds = allFiles.map(f => f.id);
    if (!chosenAvatarId || !fileIds.includes(chosenAvatarId)) {
      chosenAvatarId = fileIds.length > 0 ? fileIds[0] : null;
    }

    await connection.query(
      `UPDATE danh_muc_vat_tu 
       SET ma_vat_tu = ?, ten_vat_tu = ?, id_loai_vat_tu = ?, don_vi_tinh = ?, don_gia_tieu_chuan = ?, ghi_chu = ?, id_anh_dai_dien = ? 
       WHERE id = ?`,
      [
        ma_vat_tu.trim(),
        ten_vat_tu.trim(),
        id_loai_vat_tu || null,
        don_vi_tinh || null,
        don_gia_tieu_chuan || 0,
        ghi_chu !== undefined ? (ghi_chu || null) : oldRow[0].ghi_chu,
        chosenAvatarId,
        req.params.id
      ]
    );

    const [newRow] = await connection.query(
      `SELECT v.*, l.ten_loai_vat_tu 
       FROM danh_muc_vat_tu v 
       LEFT JOIN danh_muc_loai_vat_tu l ON v.id_loai_vat_tu = l.id 
       WHERE v.id = ?`,
      [req.params.id]
    );

    await attachFilesToRecords(connection, 'danh_muc_vat_tu', newRow);
    await logChange(connection, 'danh_muc_vat_tu', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi cập nhật vật tư.' });
  } finally {
    connection.release();
  }
});

// Set avatar file for material item
router.put('/vat-tu/:id/avatar/:fileId', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  try {
    const { id, fileId } = req.params;
    await pool.query('UPDATE danh_muc_vat_tu SET id_anh_dai_dien = ? WHERE id = ?', [fileId, id]);
    return res.json({ message: 'Đã cập nhật ảnh đại diện vật tư.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi đặt ảnh đại diện.' });
  }
});

// Delete file of material item
router.delete('/vat-tu/:id/files/:fileId', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  try {
    const { id, fileId } = req.params;
    await pool.query('DELETE FROM files WHERE ten_bang = "danh_muc_vat_tu" AND id_ban_ghi = ? AND id = ?', [id, fileId]);
    // Reset avatar if deleted
    const [row] = await pool.query('SELECT id_anh_dai_dien FROM danh_muc_vat_tu WHERE id = ?', [id]);
    if (row.length > 0 && String(row[0].id_anh_dai_dien) === String(fileId)) {
      const [rem] = await pool.query('SELECT id FROM files WHERE ten_bang = "danh_muc_vat_tu" AND id_ban_ghi = ? ORDER BY id ASC LIMIT 1', [id]);
      const nextAvatar = rem.length > 0 ? rem[0].id : null;
      await pool.query('UPDATE danh_muc_vat_tu SET id_anh_dai_dien = ? WHERE id = ?', [nextAvatar, id]);
    }
    return res.json({ message: 'Đã xóa hình ảnh vật tư thành công.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xóa hình ảnh.' });
  }
});

router.delete('/vat-tu/:id', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM danh_muc_vat_tu WHERE id = ? AND COALESCE(da_xoa, 0) = 0', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy vật tư hoặc vật tư đã bị xóa.' });
    }

    const matId = req.params.id;
    const reasons = [];

    // 1. Tồn kho
    const [stockRows] = await connection.query(
      'SELECT SUM(so_luong_ton) as total_stock FROM ton_kho WHERE id_danh_muc_vat_tu = ? AND so_luong_ton > 0',
      [matId]
    );
    if (stockRows[0] && parseFloat(stockRows[0].total_stock || 0) > 0) {
      reasons.push(`Đang còn tồn kho thực tế: ${parseFloat(stockRows[0].total_stock).toLocaleString('vi-VN')} ${oldRow[0].don_vi_tinh || ''}`);
    }

    // 2. Chi tiết đơn hàng
    try {
      const [dhRows] = await connection.query(
        'SELECT COUNT(*) as cnt FROM chi_tiet_don_hang WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (dhRows[0]?.cnt > 0) {
        reasons.push(`Đang phát sinh trong ${dhRows[0].cnt} đơn hàng bán`);
      }
    } catch (e) {}

    // 3. Phiếu nhập kho
    try {
      const [pnkRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_phieu_nhap_kho) as cnt FROM phieu_nhap_kho_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (pnkRows[0]?.cnt > 0) {
        reasons.push(`Đang phát sinh trong ${pnkRows[0].cnt} phiếu nhập kho`);
      }
    } catch (e) {}

    // 4. Phiếu xuất kho
    try {
      const [pxkRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_phieu_xuat_kho) as cnt FROM phieu_xuat_kho_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (pxkRows[0]?.cnt > 0) {
        reasons.push(`Đang phát sinh trong ${pxkRows[0].cnt} phiếu xuất kho`);
      }
    } catch (e) {}

    // 5. Phiếu mua hàng
    try {
      const [pmhRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_phieu_mua_hang) as cnt FROM phieu_mua_hang_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (pmhRows[0]?.cnt > 0) {
        reasons.push(`Đang có trong ${pmhRows[0].cnt} phiếu mua hàng (PO)`);
      }
    } catch (e) {}

    // 6. Yêu cầu mua hàng
    try {
      const [ycmhRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_yeu_cau_mua_hang) as cnt FROM yeu_cau_mua_hang_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (ycmhRows[0]?.cnt > 0) {
        reasons.push(`Đang có trong ${ycmhRows[0].cnt} phiếu đề xuất mua hàng`);
      }
    } catch (e) {}

    // 7. Yêu cầu vật tư công trình
    try {
      const [ycvtRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_yeu_cau_vat_tu) as cnt FROM yeu_cau_vat_tu_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (ycvtRows[0]?.cnt > 0) {
        reasons.push(`Đang có trong ${ycvtRows[0].cnt} phiếu yêu cầu cấp vật tư công trình`);
      }
    } catch (e) {}

    // 8. Phiếu điều chuyển vật tư
    try {
      const [pdcRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_phieu_dieu_chuyen) as cnt FROM phieu_dieu_chuyen_vat_tu_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (pdcRows[0]?.cnt > 0) {
        reasons.push(`Đang có trong ${pdcRows[0].cnt} phiếu điều chuyển vật tư`);
      }
    } catch (e) {}

    // 9. Chuyển kho nội bộ
    try {
      const [pckRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_phieu_chuyen_kho) as cnt FROM phieu_chuyen_kho_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (pckRows[0]?.cnt > 0) {
        reasons.push(`Đang có trong ${pckRows[0].cnt} phiếu chuyển kho nội bộ`);
      }
    } catch (e) {}

    // 10. Phiếu sử dụng vật tư
    try {
      const [psdRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_phieu_su_dung) as cnt FROM phieu_su_dung_vat_tu_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (psdRows[0]?.cnt > 0) {
        reasons.push(`Đang có trong ${psdRows[0].cnt} phiếu sử dụng vật tư`);
      }
    } catch (e) {}

    // 11. Phiếu trả lại kho
    try {
      const [ptkRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_phieu_tra_lai) as cnt FROM phieu_tra_lai_kho_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (ptkRows[0]?.cnt > 0) {
        reasons.push(`Đang có trong ${ptkRows[0].cnt} phiếu trả lại kho`);
      }
    } catch (e) {}

    // 12. Phiếu hao hụt vật tư
    try {
      const [phhRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_phieu_hao_hut) as cnt FROM phieu_hao_hut_vat_tu_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (phhRows[0]?.cnt > 0) {
        reasons.push(`Đang có trong ${phhRows[0].cnt} phiếu báo cáo hao hụt`);
      }
    } catch (e) {}

    // 13. Nghiệm thu vật tư
    try {
      const [pntRows] = await connection.query(
        'SELECT COUNT(DISTINCT id_nghiem_thu) as cnt FROM nghiem_thu_vat_tu_chi_tiet WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (pntRows[0]?.cnt > 0) {
        reasons.push(`Đang có trong ${pntRows[0].cnt} biên bản nghiệm thu công trình`);
      }
    } catch (e) {}

    // 14. Dự toán BOQ
    try {
      const [boqRows] = await connection.query(
        'SELECT COUNT(*) as cnt FROM du_toan_boq WHERE id_danh_muc_vat_tu = ?',
        [matId]
      );
      if (boqRows[0]?.cnt > 0) {
        reasons.push(`Đang nằm trong ${boqRows[0].cnt} hạng mục dự toán BOQ công trình`);
      }
    } catch (e) {}

    if (reasons.length > 0) {
      connection.release();
      return res.status(400).json({
        message: `Không thể xóa vật tư "${oldRow[0].ten_vat_tu} (${oldRow[0].ma_vat_tu})" vì đã phát sinh dữ liệu liên kết:\n• ` + reasons.join('\n• ')
      });
    }

    // Thực hiện xóa mềm
    await connection.query('UPDATE danh_muc_vat_tu SET da_xoa = 1 WHERE id = ?', [matId]);

    await logChange(connection, 'danh_muc_vat_tu', matId, 'XOA', oldRow[0], { da_xoa: 1 }, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: `Đã xóa vật tư "${oldRow[0].ten_vat_tu}" thành công.` });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xóa vật tư.' });
  } finally {
    connection.release();
  }
});

// ========================================================
// 4. TỒN KHO & LỊCH SỬ TỒN KHO (STOCK BALANCES & HISTORY)
// ========================================================
router.get('/ton-kho', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.*, k.ten_kho, k.loai_kho, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh, l.ten_loai_vat_tu
       FROM ton_kho t
       JOIN kho_hang k ON t.id_kho_hang = k.id
       JOIN danh_muc_vat_tu v ON t.id_danh_muc_vat_tu = v.id
       LEFT JOIN danh_muc_loai_vat_tu l ON v.id_loai_vat_tu = l.id
       WHERE COALESCE(v.da_xoa, 0) = 0 AND COALESCE(k.da_xoa, 0) = 0
       ORDER BY t.so_luong_ton DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn tồn kho.' });
  }
});

// Manual Stock Adjustment (Nhập / Xuất kho thủ công)
router.post('/ton-kho/nhap-xuat-thu-cong', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, ghi_chu } = req.body;

  if (!id_kho_hang || !id_danh_muc_vat_tu || so_luong_thay_doi === undefined || parseFloat(so_luong_thay_doi) === 0) {
    return res.status(400).json({ message: 'Kho hàng, vật tư và số lượng thay đổi (khác 0) là bắt buộc.' });
  }

  const changeQty = parseFloat(so_luong_thay_doi);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Update/Insert in ton_kho
    const id_ton_kho = await updateStock(connection, id_kho_hang, id_danh_muc_vat_tu, changeQty);

    // 2. Insert into ton_kho_lich_su
    const loaiChungTu = changeQty > 0 ? 'Nhập thủ công' : 'Xuất thủ công';
    await connection.query(
      `INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, loai_chung_tu, ghi_chu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id_ton_kho,
        id_kho_hang,
        id_danh_muc_vat_tu,
        changeQty,
        loaiChungTu,
        ghi_chu || null,
        req.user.ten_dang_nhap
      ]
    );

    const [updatedStock] = await connection.query(
      `SELECT t.*, k.ten_kho, k.loai_kho, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh, l.ten_loai_vat_tu
       FROM ton_kho t
       JOIN kho_hang k ON t.id_kho_hang = k.id
       JOIN danh_muc_vat_tu v ON t.id_danh_muc_vat_tu = v.id
       LEFT JOIN danh_muc_loai_vat_tu l ON v.id_loai_vat_tu = l.id
       WHERE t.id = ?`,
      [id_ton_kho]
    );

    await connection.commit();
    return res.status(200).json({ message: 'Đã cập nhật tồn kho thành công!', data: updatedStock[0] });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi nhập xuất kho thủ công.' });
  } finally {
    connection.release();
  }
});

// Get Stock History for specific stock item
router.get('/ton-kho/:id_ton_kho/lich-su', authMiddleware, async (req, res) => {
  try {
    const [tkRows] = await pool.query(
      'SELECT id, id_kho_hang, id_danh_muc_vat_tu FROM ton_kho WHERE id = ?',
      [req.params.id_ton_kho]
    );

    let rows = [];
    if (tkRows.length > 0) {
      const tk = tkRows[0];
      const [historyRows] = await pool.query(
        `SELECT ls.*, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh, k.ten_kho
         FROM ton_kho_lich_su ls
         LEFT JOIN danh_muc_vat_tu v ON ls.id_danh_muc_vat_tu = v.id
         LEFT JOIN kho_hang k ON ls.id_kho_hang = k.id
         WHERE ls.id_ton_kho = ?
            OR (ls.id_kho_hang = ? AND ls.id_danh_muc_vat_tu = ?)
         ORDER BY ls.id DESC`,
        [tk.id, tk.id_kho_hang, tk.id_danh_muc_vat_tu]
      );
      rows = historyRows;
    } else {
      const [historyRows] = await pool.query(
        `SELECT ls.*, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh, k.ten_kho
         FROM ton_kho_lich_su ls
         LEFT JOIN danh_muc_vat_tu v ON ls.id_danh_muc_vat_tu = v.id
         LEFT JOIN kho_hang k ON ls.id_kho_hang = k.id
         WHERE ls.id_ton_kho = ?
         ORDER BY ls.id DESC`,
        [req.params.id_ton_kho]
      );
      rows = historyRows;
    }

    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn lịch sử tồn kho.' });
  }
});

// ========================================================
// 5. NHẬT KÝ KHO & GIAO DỊCH KHO (EXISTING ROUTES)
// ========================================================
router.get('/nhat_ky_kho', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT n.*, 
              kn.ten_kho as kho_nguon_ten, 
              kd.ten_kho as kho_dich_ten,
              v.ten_vat_tu, v.ma_vat_tu, v.don_vi_tinh,
              ncc.ten_nha_cung_cap
       FROM nhat_ky_kho n
       LEFT JOIN kho_hang kn ON n.id_kho_hang_nguon = kn.id
       LEFT JOIN kho_hang kd ON n.id_kho_hang_dich = kd.id
       JOIN danh_muc_vat_tu v ON n.id_danh_muc_vat_tu = v.id
       LEFT JOIN nha_cung_cap ncc ON n.id_nha_cung_cap = ncc.id
       ORDER BY n.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn nhật ký kho.' });
  }
});

router.post('/giao-dich', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ky_Thuat', 'Ban_Giam_Doc']), async (req, res) => {
  const {
    id_kho_hang_nguon,
    id_kho_hang_dich,
    id_danh_muc_vat_tu,
    id_nha_cung_cap,
    so_luong,
    don_gia,
    loai_giao_dich,
    trang_thai,
    so_chung_tu
  } = req.body;

  if (!id_danh_muc_vat_tu || !so_luong || !loai_giao_dich) {
    return res.status(400).json({ message: 'Vật tư, số lượng và loại giao dịch là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    if (['Xuat_Kho_Cong_Trinh', 'POS_Ban_Le'].includes(loai_giao_dich)) {
      if (!id_kho_hang_nguon) {
        connection.release();
        return res.status(400).json({ message: 'Giao dịch xuất kho yêu cầu chỉ định kho nguồn.' });
      }

      const [stock] = await connection.query(
        'SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?',
        [id_kho_hang_nguon, id_danh_muc_vat_tu]
      );

      const available = stock.length > 0 ? parseFloat(stock[0].so_luong_ton) : 0;
      if (available < parseFloat(so_luong)) {
        connection.release();
        return res.status(400).json({
          message: `Số lượng tồn kho không đủ để xuất. Số lượng hiện tại: ${available}.`
        });
      }
    }

    const [result] = await connection.query(
      `INSERT INTO nhat_ky_kho (
        id_kho_hang_nguon, id_kho_hang_dich, id_danh_muc_vat_tu, id_nha_cung_cap,
        so_luong, don_gia, loai_giao_dich, trang_thai, ngay_thuc_hien, so_chung_tu, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)`,
      [
        id_kho_hang_nguon || null,
        id_kho_hang_dich || null,
        id_danh_muc_vat_tu,
        id_nha_cung_cap || null,
        so_luong,
        don_gia || 0,
        loai_giao_dich,
        trang_thai || 'Cho_Nghiem_Thu',
        so_chung_tu || null,
        req.user.ten_dang_nhap
      ]
    );

    const transactionId = result.insertId;

    if (trang_thai === 'Da_Nghiem_Thu') {
      if (id_kho_hang_nguon) {
        const tonKhoIdNguon = await updateStock(connection, id_kho_hang_nguon, id_danh_muc_vat_tu, -parseFloat(so_luong));
        await connection.query(
          `INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, nguoi_tao)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [tonKhoIdNguon, id_kho_hang_nguon, id_danh_muc_vat_tu, -parseFloat(so_luong), transactionId, 'Phiếu xuất kho', req.user.ten_dang_nhap]
        );
      }
      if (id_kho_hang_dich) {
        const tonKhoIdDich = await updateStock(connection, id_kho_hang_dich, id_danh_muc_vat_tu, parseFloat(so_luong));
        await connection.query(
          `INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, nguoi_tao)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [tonKhoIdDich, id_kho_hang_dich, id_danh_muc_vat_tu, parseFloat(so_luong), transactionId, 'Phiếu nhập kho', req.user.ten_dang_nhap]
        );
      }
    }

    const [newRow] = await connection.query('SELECT * FROM nhat_ky_kho WHERE id = ?', [transactionId]);
    await logChange(connection, 'nhat_ky_kho', transactionId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi ghi nhận giao dịch kho.' });
  } finally {
    connection.release();
  }
});

router.post('/giao-dich/:id/nghiem-thu', authMiddleware, authorize(['Ky_Thuat', 'Ban_Giam_Doc']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [trans] = await connection.query('SELECT * FROM nhat_ky_kho WHERE id = ?', [req.params.id]);
    if (trans.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy giao dịch kho.' });
    }

    const transaction = trans[0];
    if (transaction.trang_thai === 'Da_Nghiem_Thu') {
      connection.release();
      return res.status(400).json({ message: 'Giao dịch này đã được nghiệm thu trước đó.' });
    }

    await connection.query('UPDATE nhat_ky_kho SET trang_thai = "Da_Nghiem_Thu" WHERE id = ?', [req.params.id]);

    if (transaction.id_kho_hang_nguon) {
      const tonKhoIdNguon = await updateStock(connection, transaction.id_kho_hang_nguon, transaction.id_danh_muc_vat_tu, -parseFloat(transaction.so_luong));
      await connection.query(
        `INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, nguoi_tao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tonKhoIdNguon, transaction.id_kho_hang_nguon, transaction.id_danh_muc_vat_tu, -parseFloat(transaction.so_luong), transaction.id, 'Phiếu xuất kho', req.user.ten_dang_nhap]
      );
    }
    if (transaction.id_kho_hang_dich) {
      const tonKhoIdDich = await updateStock(connection, transaction.id_kho_hang_dich, transaction.id_danh_muc_vat_tu, parseFloat(transaction.so_luong));
      await connection.query(
        `INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, nguoi_tao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tonKhoIdDich, transaction.id_kho_hang_dich, transaction.id_danh_muc_vat_tu, parseFloat(transaction.so_luong), transaction.id, 'Phiếu nhập kho', req.user.ten_dang_nhap]
      );
    }

    const [newRow] = await connection.query('SELECT * FROM nhat_ky_kho WHERE id = ?', [req.params.id]);
    await logChange(connection, 'nhat_ky_kho', req.params.id, 'CAP_NHAT', transaction, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: 'Đã xác nhận nghiệm thu giao dịch kho thành công.', data: newRow[0] });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi nghiệm thu giao dịch.' });
  } finally {
    connection.release();
  }
});

// ==========================================
// WAREHOUSE MANAGEMENT: PHIẾU XUẤT KHO ENDPOINTS
// ==========================================

// 1. Get distinct recording years for phieu_xuat_kho
router.get('/phieu-xuat-kho/years', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT COALESCE(nam, YEAR(thoi_gian_xuat), YEAR(thoi_gian_tao)) AS year
       FROM phieu_xuat_kho
       WHERE nam IS NOT NULL OR thoi_gian_xuat IS NOT NULL OR thoi_gian_tao IS NOT NULL
       ORDER BY year DESC`
    );
    const currentYear = new Date().getFullYear();
    const dbYears = rows.map(r => parseInt(r.year, 10)).filter(y => !isNaN(y) && y > 1900);
    const uniqueYears = Array.from(new Set([currentYear, currentYear - 1, ...dbYears])).sort((a, b) => b - a);
    return res.json(uniqueYears);
  } catch (err) {
    console.error('Error fetching phieu_xuat_kho years:', err);
    return res.status(500).json({ message: 'Lỗi lấy danh sách năm vào sổ xuất kho.' });
  }
});

// 2. Get paginated and filtered phieu_xuat_kho list
router.get('/phieu-xuat-kho', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      nam,
      id_linh_vuc_kinh_doanh,
      id_kho_hang,
      loai_xuat_kho,
      trang_thai_xuat,
      search
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (nam && nam !== 'all' && nam !== 'ALL') {
      whereClause += ' AND (px.nam = ? OR (px.nam IS NULL AND YEAR(px.thoi_gian_xuat) = ?))';
      params.push(nam, nam);
    }

    if (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') {
      whereClause += ' AND px.id_linh_vuc_kinh_doanh = ?';
      params.push(id_linh_vuc_kinh_doanh);
    }

    if (id_kho_hang && id_kho_hang !== 'all') {
      whereClause += ' AND px.id_kho_hang = ?';
      params.push(id_kho_hang);
    }

    if (loai_xuat_kho && loai_xuat_kho !== 'all') {
      whereClause += ' AND px.loai_xuat_kho = ?';
      params.push(loai_xuat_kho);
    }

    if (trang_thai_xuat && trang_thai_xuat !== 'all') {
      whereClause += ' AND px.trang_thai_xuat = ?';
      params.push(trang_thai_xuat);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereClause += ` AND (
        px.ma_phieu LIKE ? OR
        dh.ma_don_hang LIKE ? OR
        kh.ten_khach_hang LIKE ? OR
        c.ten_cong_trinh LIKE ? OR
        yc.ma_phieu LIKE ? OR
        px.ghi_chu LIKE ? OR
        px.nguoi_xuat LIKE ?
      )`;
      params.push(term, term, term, term, term, term, term);
    }

    // Count total query
    const countSql = `
      SELECT COUNT(*) AS total
      FROM phieu_xuat_kho px
      LEFT JOIN linh_vuc_kinh_doanh l ON px.id_linh_vuc_kinh_doanh = l.id
      LEFT JOIN kho_hang k ON px.id_kho_hang = k.id
      LEFT JOIN cong_trinh c ON px.id_cong_trinh = c.id
      LEFT JOIN don_hang dh ON px.id_don_hang = dh.id
      LEFT JOIN khach_hang kh ON dh.id_khach_hang = kh.id
      LEFT JOIN yeu_cau_vat_tu yc ON px.id_yeu_cau_vat_tu = yc.id
      ${whereClause}
    `;
    const [countResult] = await pool.query(countSql, params);
    const total = countResult[0]?.total || 0;

    // Data query with joins
    const dataSql = `
      SELECT px.*,
             l.ten_lvkd, l.ma_lvkd,
             k.ten_kho AS ten_kho_hang,
             c.ten_cong_trinh,
             dh.ma_don_hang,
             kh.ten_khach_hang, kh.so_dien_thoai AS sdt_khach_hang, kh.dia_chi AS dia_chi_khach_hang,
             yc.ma_phieu AS ma_phieu_yeu_cau,
             (SELECT COUNT(*) FROM phieu_xuat_kho_chi_tiet WHERE id_phieu_xuat_kho = px.id) AS tong_so_mat_hang
      FROM phieu_xuat_kho px
      LEFT JOIN linh_vuc_kinh_doanh l ON px.id_linh_vuc_kinh_doanh = l.id
      LEFT JOIN kho_hang k ON px.id_kho_hang = k.id
      LEFT JOIN cong_trinh c ON px.id_cong_trinh = c.id
      LEFT JOIN don_hang dh ON px.id_don_hang = dh.id
      LEFT JOIN khach_hang kh ON dh.id_khach_hang = kh.id
      LEFT JOIN yeu_cau_vat_tu yc ON px.id_yeu_cau_vat_tu = yc.id
      ${whereClause}
      ORDER BY px.id DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(dataSql, [...params, limitNum, offset]);

    return res.json({
      data: rows,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1
    });
  } catch (err) {
    console.error('Error fetching phieu_xuat_kho list:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách phiếu xuất kho.' });
  }
});

// 3. Get single phieu_xuat_kho with items
router.get('/phieu-xuat-kho/:id', authMiddleware, async (req, res) => {
  try {
    const [pxRows] = await pool.query(
      `SELECT px.*,
              l.ten_lvkd, l.ma_lvkd, l.ten_cong_ty, l.dia_chi AS dia_chi_cong_ty, l.dien_thoai AS sdt_cong_ty, l.ma_so_thue AS mst_cong_ty, l.logo_url AS logo_lvkd,
              k.ten_kho AS ten_kho_hang, k.dia_diem AS dia_chi_kho,
              c.ten_cong_trinh, c.dia_chi AS dia_diem_cong_trinh,
              dh.ma_don_hang,
              kh.ten_khach_hang, kh.so_dien_thoai AS sdt_khach_hang, kh.dia_chi AS dia_chi_khach_hang,
              yc.ma_phieu AS ma_phieu_yeu_cau,
              COALESCE(u.ho_ten, px.nguoi_tao) AS ho_ten_nguoi_tao
       FROM phieu_xuat_kho px
       LEFT JOIN linh_vuc_kinh_doanh l ON px.id_linh_vuc_kinh_doanh = l.id
       LEFT JOIN kho_hang k ON px.id_kho_hang = k.id
       LEFT JOIN cong_trinh c ON px.id_cong_trinh = c.id
       LEFT JOIN don_hang dh ON px.id_don_hang = dh.id
       LEFT JOIN khach_hang kh ON dh.id_khach_hang = kh.id
       LEFT JOIN yeu_cau_vat_tu yc ON px.id_yeu_cau_vat_tu = yc.id
       LEFT JOIN nguoi_dung u ON (px.nguoi_tao = u.ten_dang_nhap OR CAST(px.nguoi_tao AS CHAR) = CAST(u.id AS CHAR) OR px.nguoi_tao = u.ho_ten)
       WHERE px.id = ?`,
      [req.params.id]
    );

    if (pxRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu xuất kho.' });
    }

    const [items] = await pool.query(
      `SELECT pxct.*,
              vt.ma_vat_tu, vt.ten_vat_tu, vt.don_vi_tinh AS dvt_chuan
       FROM phieu_xuat_kho_chi_tiet pxct
       LEFT JOIN danh_muc_vat_tu vt ON pxct.id_danh_muc_vat_tu = vt.id
       WHERE pxct.id_phieu_xuat_kho = ?
       ORDER BY pxct.id ASC`,
      [req.params.id]
    );

    const totalWords = VNDToWords(pxRows[0].tong_tien);

    return res.json({
      ...pxRows[0],
      items,
      tong_tien_bang_chu: totalWords
    });
  } catch (err) {
    console.error('Error fetching phieu_xuat_kho detail:', err);
    return res.status(500).json({ message: 'Lỗi tải chi tiết phiếu xuất kho.' });
  }
});

// 4. Cancel & Revert Export Voucher (Hủy phiếu xuất kho & hoàn tồn kho)
router.put('/phieu-xuat-kho/:id/huy', authMiddleware, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { ly_do_huy } = req.body;
    if (!ly_do_huy || !ly_do_huy.trim()) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Vui lòng cung cấp lý do hủy phiếu xuất kho.' });
    }

    const [pxRows] = await connection.query('SELECT * FROM phieu_xuat_kho WHERE id = ? FOR UPDATE', [req.params.id]);
    if (pxRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu xuất kho.' });
    }

    const px = pxRows[0];
    if (px.trang_thai_xuat === 'Đã hủy') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Phiếu xuất kho này đã được hủy trước đó.' });
    }

    const [items] = await connection.query(`
      SELECT pxct.*, vt.ten_vat_tu, vt.ma_vat_tu
      FROM phieu_xuat_kho_chi_tiet pxct
      LEFT JOIN danh_muc_vat_tu vt ON pxct.id_danh_muc_vat_tu = vt.id
      WHERE pxct.id_phieu_xuat_kho = ?
    `, [req.params.id]);

    const sourceWhId = px.id_kho_hang || px.id_kho;
    const destWhId = px.id_kho_tam_nhan;

    // Nếu phiếu đã xuất thực tế (Đã xuất hàng hoặc Đã xuất), thực hiện hoàn kho
    if (px.trang_thai_xuat === 'Đã xuất hàng' || px.trang_thai_xuat === 'Đã xuất') {
      // TRƯỜNG HỢP 1: Xuất kho công trình
      if (px.loai_xuat_kho === 'cong_trinh') {
        // Kiểm tra tồn kho tại Kho tạm công trình
        if (destWhId) {
          for (const item of items) {
            const needQty = parseFloat(item.so_luong_xuat || item.so_luong || 0);
            if (needQty <= 0) continue;

            const [destStock] = await connection.query(`
              SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ? FOR UPDATE
            `, [destWhId, item.id_danh_muc_vat_tu]);

            const currentDestStock = destStock[0] ? parseFloat(destStock[0].so_luong_ton) : 0;
            if (currentDestStock < needQty) {
              await connection.rollback();
              connection.release();
              const matName = item.ten_vat_tu ? `${item.ten_vat_tu} (${item.ma_vat_tu})` : `Vật tư ID ${item.id_danh_muc_vat_tu}`;
              return res.status(400).json({
                message: `Kho tạm công trình không đủ tồn kho để thu hồi cho ${matName} (Tồn hiện tại: ${currentDestStock} ${item.don_vi_tinh || ''}, Cần thu hồi: ${needQty} ${item.don_vi_tinh || ''}). Vật tư có thể đã được nghiệm thu hoặc xuất sử dụng.`
              });
            }
          }

          // Trừ kho tạm công trình
          for (const item of items) {
            const qty = parseFloat(item.so_luong_xuat || item.so_luong || 0);
            if (qty <= 0) continue;

            const [destStock] = await connection.query(`
              SELECT id FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
            `, [destWhId, item.id_danh_muc_vat_tu]);
            const destTonKhoId = destStock.length > 0 ? destStock[0].id : null;

            await connection.query(`
              UPDATE ton_kho
              SET so_luong_ton = so_luong_ton - ?
              WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
            `, [qty, destWhId, item.id_danh_muc_vat_tu]);

            await connection.query(`
              INSERT INTO ton_kho_lich_su (
                id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi,
                id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao, thoi_gian_tao
              ) VALUES (?, ?, ?, ?, ?, 'Thu hồi kho tạm', ?, ?, NOW())
            `, [destTonKhoId, destWhId, item.id_danh_muc_vat_tu, -qty, px.id, `Thu hồi kho tạm do hủy phiếu xuất ${px.ma_phieu}`, nguoiHuy]);
          }
        }

        // Cộng trả lại kho nguồn
        if (sourceWhId) {
          for (const item of items) {
            const qty = parseFloat(item.so_luong_xuat || item.so_luong || 0);
            if (qty <= 0) continue;

            let sourceTonKhoId = null;
            const [sourceStock] = await connection.query(`
              SELECT id FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
            `, [sourceWhId, item.id_danh_muc_vat_tu]);

            if (sourceStock.length > 0) {
              sourceTonKhoId = sourceStock[0].id;
              await connection.query(`
                UPDATE ton_kho
                SET so_luong_ton = so_luong_ton + ?
                WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
              `, [qty, sourceWhId, item.id_danh_muc_vat_tu]);
            } else {
              const [insertSource] = await connection.query(`
                INSERT INTO ton_kho (id_kho_hang, id_danh_muc_vat_tu, so_luong_ton)
                VALUES (?, ?, ?)
              `, [sourceWhId, item.id_danh_muc_vat_tu, qty]);
              sourceTonKhoId = insertSource.insertId;
            }

            await connection.query(`
              INSERT INTO ton_kho_lich_su (
                id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi,
                id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao, thoi_gian_tao
              ) VALUES (?, ?, ?, ?, ?, 'Hoàn trả xuất kho', ?, ?, NOW())
            `, [sourceTonKhoId, sourceWhId, item.id_danh_muc_vat_tu, qty, px.id, `Hoàn trả tồn kho từ phiếu xuất hủy ${px.ma_phieu}`, nguoiHuy]);
          }
        }
      }

      // TRƯỜNG HỢP 2: Xuất kho bán hàng hoặc xuất khác
      else {
        if (sourceWhId) {
          for (const item of items) {
            const qty = parseFloat(item.so_luong_xuat || item.so_luong || 0);
            if (qty <= 0) continue;

            let sourceTonKhoId = null;
            const [sourceStock] = await connection.query(`
              SELECT id FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
            `, [sourceWhId, item.id_danh_muc_vat_tu]);

            if (sourceStock.length > 0) {
              sourceTonKhoId = sourceStock[0].id;
              await connection.query(`
                UPDATE ton_kho
                SET so_luong_ton = so_luong_ton + ?
                WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
              `, [qty, sourceWhId, item.id_danh_muc_vat_tu]);
            } else {
              const [insertSource] = await connection.query(`
                INSERT INTO ton_kho (id_kho_hang, id_danh_muc_vat_tu, so_luong_ton)
                VALUES (?, ?, ?)
              `, [sourceWhId, item.id_danh_muc_vat_tu, qty]);
              sourceTonKhoId = insertSource.insertId;
            }

            await connection.query(`
              INSERT INTO ton_kho_lich_su (
                id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi,
                id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao, thoi_gian_tao
              ) VALUES (?, ?, ?, ?, ?, 'Hoàn trả xuất bán hàng', ?, ?, NOW())
            `, [sourceTonKhoId, sourceWhId, item.id_danh_muc_vat_tu, qty, px.id, `Hoàn trả tồn kho từ phiếu xuất hủy ${px.ma_phieu}`, nguoiHuy]);
          }
        }

        // Nếu có liên kết đơn hàng POS, cập nhật trạng thái xuất kho đơn hàng
        if (px.id_don_hang) {
          await connection.query(`
            UPDATE don_hang
            SET trang_thai_xuat_kho = 'chua_xua_kho'
            WHERE id = ?
          `, [px.id_don_hang]);
        }
      }
    }

    const nguoiHuy = req.user?.ho_ten || req.user?.ten_dang_nhap || 'Thủ kho';

    // Cập nhật trạng thái phiếu xuất sang 'Đã hủy'
    await connection.query(`
      UPDATE phieu_xuat_kho
      SET trang_thai_xuat = 'Đã hủy',
          ly_do_huy = ?,
          thoi_gian_huy = NOW(),
          nguoi_huy = ?
      WHERE id = ?
    `, [ly_do_huy.trim(), nguoiHuy, req.params.id]);

    // Ghi nhật ký thao tác
    const [updatedRows] = await connection.query('SELECT * FROM phieu_xuat_kho WHERE id = ?', [req.params.id]);
    await logChange(connection, 'phieu_xuat_kho', px.id, 'HUY_PHIEU', px, updatedRows[0], req.user?.ten_dang_nhap);

    await connection.commit();
    return res.json({
      message: 'Hủy phiếu xuất kho và hoàn tồn kho thành công!',
      id: px.id,
      ma_phieu: px.ma_phieu
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error cancelling export voucher:', err);
    return res.status(500).json({ message: 'Lỗi khi hủy phiếu xuất kho: ' + err.message });
  } finally {
    connection.release();
  }
});

// ==========================================
// WAREHOUSE MANAGEMENT: PHIẾU NHẬP KHO ENDPOINTS
// ==========================================

// 1. Get distinct recording years for phieu_nhap_kho
router.get('/phieu-nhap-kho/years', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT COALESCE(nam, YEAR(thoi_gian_nhap), YEAR(thoi_gian_tao)) AS year
       FROM phieu_nhap_kho
       WHERE (nam IS NOT NULL OR thoi_gian_nhap IS NOT NULL OR thoi_gian_tao IS NOT NULL)
       ORDER BY year DESC`
    );
    const currentYear = new Date().getFullYear();
    const dbYears = rows.map(r => parseInt(r.year, 10)).filter(y => !isNaN(y) && y > 1900);
    const uniqueYears = Array.from(new Set([currentYear, currentYear - 1, ...dbYears])).sort((a, b) => b - a);
    return res.json(uniqueYears);
  } catch (err) {
    console.error('Error fetching phieu_nhap_kho years:', err);
    return res.status(500).json({ message: 'Lỗi lấy danh sách năm vào sổ nhập kho.' });
  }
});

// 2. Get list of POs pending goods receipt
router.get('/phieu-mua-hang/pending-import', authMiddleware, async (req, res) => {
  try {
    const { id_linh_vuc_kinh_doanh } = req.query;
    let sql = `
      SELECT p.*,
             c.ten_cong_trinh,
             k.ten_kho AS ten_kho_nhap,
             ncc.ten_nha_cung_cap AS ncc_ten, ncc.so_dien_thoai AS ncc_sdt, ncc.dia_chi AS ncc_dia_chi,
             l.ten_lvkd, l.ma_lvkd
      FROM phieu_mua_hang p
      LEFT JOIN cong_trinh c ON p.id_cong_trinh = c.id
      LEFT JOIN kho_hang k ON p.id_kho_nhap = k.id
      LEFT JOIN nha_cung_cap ncc ON p.id_nha_cung_cap = ncc.id
      LEFT JOIN linh_vuc_kinh_doanh l ON p.id_linh_vuc_kinh_doanh = l.id
      WHERE (p.trang_thai_giao_hang != 'Đã giao' OR p.trang_thai_giao_hang IS NULL)
    `;
    const params = [];
    if (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') {
      sql += ' AND p.id_linh_vuc_kinh_doanh = ?';
      params.push(id_linh_vuc_kinh_doanh);
    }
    sql += ' ORDER BY p.id DESC LIMIT 100';

    const [poRows] = await pool.query(sql, params);
    if (poRows.length === 0) {
      return res.json([]);
    }

    const poIds = poRows.map(p => p.id);
    const [detailRows] = await pool.query(
      `SELECT ct.*, vt.ma_vat_tu, vt.ten_vat_tu, vt.don_vi_tinh AS dvt_chuan
       FROM phieu_mua_hang_chi_tiet ct
       LEFT JOIN danh_muc_vat_tu vt ON ct.id_danh_muc_vat_tu = vt.id
       WHERE ct.id_phieu_mua_hang IN (?)`,
      [poIds]
    );

    const detailMap = {};
    detailRows.forEach(d => {
      if (!detailMap[d.id_phieu_mua_hang]) detailMap[d.id_phieu_mua_hang] = [];
      detailMap[d.id_phieu_mua_hang].push(d);
    });

    const result = poRows.map(p => ({
      ...p,
      items: detailMap[p.id] || []
    }));

    return res.json(result);
  } catch (err) {
    console.error('Error fetching pending POs for receipt:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách phiếu mua hàng chờ nhập kho.' });
  }
});

// 3. Get paginated and filtered phieu_nhap_kho list
router.get('/phieu-nhap-kho', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      nam,
      id_linh_vuc_kinh_doanh,
      id_kho_hang,
      id_nha_cung_cap,
      loai_nhap_kho,
      trang_thai_nhap,
      search
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (nam && nam !== 'all' && nam !== 'ALL') {
      whereClause += ' AND (pnk.nam = ? OR (pnk.nam IS NULL AND YEAR(pnk.thoi_gian_nhap) = ?))';
      params.push(nam, nam);
    }

    if (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') {
      whereClause += ' AND pnk.id_linh_vuc_kinh_doanh = ?';
      params.push(id_linh_vuc_kinh_doanh);
    }

    if (id_kho_hang && id_kho_hang !== 'all') {
      whereClause += ' AND pnk.id_kho_hang = ?';
      params.push(id_kho_hang);
    }

    if (id_nha_cung_cap && id_nha_cung_cap !== 'all') {
      whereClause += ' AND pnk.id_nha_cung_cap = ?';
      params.push(id_nha_cung_cap);
    }

    if (loai_nhap_kho && loai_nhap_kho !== 'all') {
      whereClause += ' AND pnk.loai_nhap_kho = ?';
      params.push(loai_nhap_kho);
    }

    if (trang_thai_nhap && trang_thai_nhap !== 'all') {
      whereClause += ' AND pnk.trang_thai_nhap = ?';
      params.push(trang_thai_nhap);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereClause += ` AND (
        pnk.ma_phieu LIKE ? OR
        pmh.ma_phieu_mua LIKE ? OR
        ncc.ten_nha_cung_cap LIKE ? OR
        c.ten_cong_trinh LIKE ? OR
        dh.ma_don_hang LIKE ? OR
        kh.ten_khach_hang LIKE ? OR
        pnk.so_hoa_don_ncc LIKE ? OR
        pnk.nguoi_giao_hang LIKE ? OR
        pnk.nguoi_nhap_kho LIKE ? OR
        pnk.ghi_chu LIKE ?
      )`;
      params.push(term, term, term, term, term, term, term, term, term, term);
    }

    // Count total query
    const countSql = `
      SELECT COUNT(*) AS total
      FROM phieu_nhap_kho pnk
      LEFT JOIN linh_vuc_kinh_doanh l ON pnk.id_linh_vuc_kinh_doanh = l.id
      LEFT JOIN kho_hang k ON pnk.id_kho_hang = k.id
      LEFT JOIN nha_cung_cap ncc ON pnk.id_nha_cung_cap = ncc.id
      LEFT JOIN phieu_mua_hang pmh ON pnk.id_phieu_mua_hang = pmh.id
      LEFT JOIN cong_trinh c ON pnk.id_cong_trinh = c.id
      LEFT JOIN don_hang dh ON pnk.id_don_hang = dh.id
      LEFT JOIN khach_hang kh ON COALESCE(pnk.id_khach_hang, dh.id_khach_hang) = kh.id
      ${whereClause}
    `;
    const [countResult] = await pool.query(countSql, params);
    const total = countResult[0]?.total || 0;

    // Data query with joins
    const dataSql = `
      SELECT pnk.*,
             l.ten_lvkd, l.ma_lvkd,
             k.ten_kho AS ten_kho_hang,
             ncc.ten_nha_cung_cap, ncc.so_dien_thoai AS sdt_ncc, ncc.dia_chi AS dia_chi_ncc,
             pmh.ma_phieu_mua,
             c.ten_cong_trinh,
             k_tam.ten_kho AS ten_kho_tam_nguon,
             dh.ma_don_hang,
             kh.ten_khach_hang,
             (SELECT COUNT(*) FROM phieu_nhap_kho_chi_tiet WHERE id_phieu_nhap_kho = pnk.id) AS tong_so_mat_hang
      FROM phieu_nhap_kho pnk
      LEFT JOIN linh_vuc_kinh_doanh l ON pnk.id_linh_vuc_kinh_doanh = l.id
      LEFT JOIN kho_hang k ON pnk.id_kho_hang = k.id
      LEFT JOIN nha_cung_cap ncc ON pnk.id_nha_cung_cap = ncc.id
      LEFT JOIN phieu_mua_hang pmh ON pnk.id_phieu_mua_hang = pmh.id
      LEFT JOIN cong_trinh c ON pnk.id_cong_trinh = c.id
      LEFT JOIN kho_hang k_tam ON pnk.id_kho_tam_nguon = k_tam.id
      LEFT JOIN don_hang dh ON pnk.id_don_hang = dh.id
      LEFT JOIN khach_hang kh ON COALESCE(pnk.id_khach_hang, dh.id_khach_hang) = kh.id
      ${whereClause}
      ORDER BY pnk.id DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(dataSql, [...params, limitNum, offset]);

    // Attach uploaded files
    const rowsWithFiles = await attachFilesToRecords(pool, 'phieu_nhap_kho', rows);

    return res.json({
      data: rowsWithFiles,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1
    });
  } catch (err) {
    console.error('Error fetching phieu_nhap_kho list:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách phiếu nhập kho.' });
  }
});

// 4. Get single phieu_nhap_kho with items and files
router.get('/phieu-nhap-kho/:id', authMiddleware, async (req, res) => {
  try {
    const [pnkRows] = await pool.query(
      `SELECT pnk.*,
              l.ten_lvkd, l.ma_lvkd, l.ten_cong_ty, l.dia_chi AS dia_chi_cong_ty, l.dien_thoai AS sdt_cong_ty, l.ma_so_thue AS mst_cong_ty, l.logo_url AS logo_lvkd,
              k.ten_kho AS ten_kho_hang, k.dia_diem AS dia_chi_kho,
              ncc.ten_nha_cung_cap, ncc.so_dien_thoai AS sdt_ncc, ncc.dia_chi AS dia_chi_ncc, ncc.ma_so_thue AS mst_ncc,
              pmh.ma_phieu_mua,
              c.ten_cong_trinh, c.dia_chi AS dia_diem_cong_trinh,
              k_tam.ten_kho AS ten_kho_tam_nguon,
              dh.ma_don_hang,
              kh.ten_khach_hang, kh.so_dien_thoai AS sdt_khach_hang, kh.dia_chi AS dia_chi_khach_hang,
              COALESCE(u.ho_ten, pnk.nguoi_tao) AS ho_ten_nguoi_tao
       FROM phieu_nhap_kho pnk
       LEFT JOIN linh_vuc_kinh_doanh l ON pnk.id_linh_vuc_kinh_doanh = l.id
       LEFT JOIN kho_hang k ON pnk.id_kho_hang = k.id
       LEFT JOIN nha_cung_cap ncc ON pnk.id_nha_cung_cap = ncc.id
       LEFT JOIN phieu_mua_hang pmh ON pnk.id_phieu_mua_hang = pmh.id
       LEFT JOIN cong_trinh c ON pnk.id_cong_trinh = c.id
       LEFT JOIN kho_hang k_tam ON pnk.id_kho_tam_nguon = k_tam.id
       LEFT JOIN don_hang dh ON pnk.id_don_hang = dh.id
       LEFT JOIN khach_hang kh ON COALESCE(pnk.id_khach_hang, dh.id_khach_hang) = kh.id
       LEFT JOIN nguoi_dung u ON (pnk.nguoi_tao = u.ten_dang_nhap OR CAST(pnk.nguoi_tao AS CHAR) = CAST(u.id AS CHAR) OR pnk.nguoi_tao = u.ho_ten)
       WHERE pnk.id = ?`,
      [req.params.id]
    );

    if (pnkRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu nhập kho.' });
    }

    const [items] = await pool.query(
      `SELECT pnkct.*,
              vt.ma_vat_tu, vt.ten_vat_tu, vt.don_vi_tinh AS dvt_chuan
       FROM phieu_nhap_kho_chi_tiet pnkct
       LEFT JOIN danh_muc_vat_tu vt ON pnkct.id_danh_muc_vat_tu = vt.id
       WHERE pnkct.id_phieu_nhap_kho = ?
       ORDER BY pnkct.id ASC`,
      [req.params.id]
    );

    const [files] = await pool.query(
      `SELECT * FROM files WHERE ten_bang = 'phieu_nhap_kho' AND id_ban_ghi = ? ORDER BY id ASC`,
      [req.params.id]
    );

    const totalWords = VNDToWords(pnkRows[0].tong_tien);

    return res.json({
      ...pnkRows[0],
      items,
      files,
      tong_tien_bang_chu: totalWords
    });
  } catch (err) {
    console.error('Error fetching phieu_nhap_kho detail:', err);
    return res.status(500).json({ message: 'Lỗi tải chi tiết phiếu nhập kho.' });
  }
});

// 5. POST Create phieu_nhap_kho (with optional file uploads)
router.post('/phieu-nhap-kho', authMiddleware, upload.array('files'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let bodyData = req.body;
    if (req.body.data && typeof req.body.data === 'string') {
      try {
        bodyData = JSON.parse(req.body.data);
      } catch (e) {
        bodyData = req.body;
      }
    }

    const {
      id_linh_vuc_kinh_doanh,
      loai_nhap_kho = 'mua_hang',
      id_phieu_mua_hang,
      id_nha_cung_cap,
      id_kho_hang,
      id_cong_trinh,
      id_kho_tam_nguon,
      id_don_hang,
      id_khach_hang,
      so_hoa_don_ncc,
      ngay_hoa_don_ncc,
      thoi_gian_nhap,
      nguoi_giao_hang,
      nguoi_nhap_kho,
      trang_thai_nhap = 'Đã nhập',
      ghi_chu,
      items = []
    } = bodyData;

    if (!id_kho_hang) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Vui lòng chọn Kho nhận hàng.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Vui lòng nhập ít nhất một mặt hàng vật tư.' });
    }

    const currentYear = thoi_gian_nhap ? new Date(thoi_gian_nhap).getFullYear() : new Date().getFullYear();
    const lvkdId = id_linh_vuc_kinh_doanh || 1;

    let maLvkd = 'VLXD';
    const [lvkdRows] = await connection.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [lvkdId]);
    if (lvkdRows.length > 0 && lvkdRows[0].ma_lvkd) {
      maLvkd = lvkdRows[0].ma_lvkd.trim().toUpperCase();
    }

    // Generate NK Sequence
    const seq = await generateSequenceNumber(connection, {
      id_linh_vuc_kinh_doanh: lvkdId,
      loai_chung_tu: 'NK',
      nam: currentYear,
      ma_lvkd: maLvkd
    });

    let tongTien = 0;
    items.forEach(it => {
      const q = parseFloat(it.so_luong_thuc_nhap || it.so_luong) || 0;
      const p = parseFloat(it.don_gia) || 0;
      const d = parseFloat(it.chiet_khau) || 0;
      tongTien += (q * p) - d;
    });

    const [result] = await connection.query(
      `INSERT INTO phieu_nhap_kho (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_nhap_kho,
        id_phieu_mua_hang, id_nha_cung_cap, id_kho_hang, id_cong_trinh, id_kho_tam_nguon,
        id_don_hang, id_khach_hang, so_hoa_don_ncc, ngay_hoa_don_ncc, thoi_gian_nhap,
        nguoi_giao_hang, nguoi_nhap_kho, tong_tien, trang_thai_nhap, ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seq.ma_phieu,
        seq.so_vao_so,
        currentYear,
        lvkdId,
        loai_nhap_kho,
        id_phieu_mua_hang || null,
        id_nha_cung_cap || null,
        id_kho_hang,
        id_cong_trinh || null,
        id_kho_tam_nguon || null,
        id_don_hang || null,
        id_khach_hang || null,
        so_hoa_don_ncc || null,
        ngay_hoa_don_ncc || null,
        thoi_gian_nhap || new Date(),
        nguoi_giao_hang || null,
        nguoi_nhap_kho || req.user?.ho_ten || req.user?.ten_dang_nhap || 'Thủ kho',
        tongTien,
        trang_thai_nhap,
        ghi_chu || null,
        req.user.ten_dang_nhap
      ]
    );

    const pnkId = result.insertId;

    // Insert line items & update inventory
    for (const it of items) {
      const qtyReq = parseFloat(it.so_luong_yeu_cau || it.so_luong_mua || it.so_luong) || 0;
      const qtyAct = parseFloat(it.so_luong_thuc_nhap || it.so_luong) || 0;
      const price = parseFloat(it.don_gia) || 0;
      const discount = parseFloat(it.chiet_khau) || 0;
      const lineTotal = (qtyAct * price) - discount;

      let dvt = it.don_vi_tinh || '';
      if (!dvt) {
        const [vtRows] = await connection.query('SELECT don_vi_tinh FROM danh_muc_vat_tu WHERE id = ?', [it.id_danh_muc_vat_tu]);
        dvt = vtRows[0]?.don_vi_tinh || '';
      }

      await connection.query(
        `INSERT INTO phieu_nhap_kho_chi_tiet (
          id_phieu_nhap_kho, id_chi_tiet_phieu_mua_hang, id_danh_muc_vat_tu,
          don_vi_tinh, so_luong_yeu_cau, so_luong_thuc_nhap, don_gia, chiet_khau, thanh_tien, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pnkId,
          it.id_chi_tiet_phieu_mua_hang || null,
          it.id_danh_muc_vat_tu,
          dvt,
          qtyReq,
          qtyAct,
          price,
          discount,
          lineTotal,
          it.ghi_chu || null
        ]
      );

      // If imported, update stock
      if (trang_thai_nhap === 'Đã nhập' && qtyAct > 0) {
        const tonKhoId = await updateStock(connection, id_kho_hang, it.id_danh_muc_vat_tu, qtyAct);
        await connection.query(
          `INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, nguoi_tao)
           VALUES (?, ?, ?, ?, ?, 'Phiếu nhập kho', ?)`,
          [tonKhoId, id_kho_hang, it.id_danh_muc_vat_tu, qtyAct, pnkId, req.user.ten_dang_nhap]
        );

        let loaiLog = 'Nhap_Kho_Mua_Hang';
        if (loai_nhap_kho === 'tra_lai_cong_trinh') loaiLog = 'Nhap_Kho_Hoan_Tra';
        else if (loai_nhap_kho === 'tra_hang_ban') loaiLog = 'Nhap_Kho_Tra_Hang';
        else if (loai_nhap_kho === 'nhap_thu_cong') loaiLog = 'Nhap_Kho_Thu_Cong';

        await connection.query(
          `INSERT INTO nhat_ky_kho (id_kho_hang_dich, id_danh_muc_vat_tu, so_luong, don_gia, loai_giao_dich, trang_thai, ngay_thuc_hien, so_chung_tu, nguoi_tao)
           VALUES (?, ?, ?, ?, ?, 'Da_Nghiem_Thu', NOW(), ?, ?)`,
          [id_kho_hang, it.id_danh_muc_vat_tu, qtyAct, price, loaiLog, seq.ma_phieu, req.user.ten_dang_nhap]
        );
      }
    }

    // If PO linked, update PO status
    if (id_phieu_mua_hang) {
      await connection.query(
        `UPDATE phieu_mua_hang
         SET trang_thai_giao_hang = 'Đã giao',
             ngay_giao_thuc_te = ?,
             nguoi_nhan_hang = ?
         WHERE id = ?`,
        [thoi_gian_nhap || new Date(), nguoi_nhap_kho || 'Thủ kho', id_phieu_mua_hang]
      );
    }

    // Save uploaded files if any
    if (req.files && req.files.length > 0) {
      await saveUploadedFiles(connection, 'phieu_nhap_kho', pnkId, req.files, req.user.ten_dang_nhap);
    }

    const [newRow] = await connection.query('SELECT * FROM phieu_nhap_kho WHERE id = ?', [pnkId]);
    await logChange(connection, 'phieu_nhap_kho', pnkId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json({
      message: 'Tạo phiếu nhập kho thành công!',
      id: pnkId,
      ma_phieu: seq.ma_phieu
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating phieu_nhap_kho:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi tạo phiếu nhập kho.' });
  } finally {
    connection.release();
  }
});

// 6. DELETE (Soft delete / Hủy) phieu_nhap_kho
router.delete('/phieu-nhap-kho/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan', 'Thu_Kho']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { ly_do_huy } = req.body || {};
    if (!ly_do_huy || !ly_do_huy.trim()) {
      connection.release();
      return res.status(400).json({ message: 'Vui lòng nhập lý do hủy phiếu nhập kho.' });
    }

    await connection.beginTransaction();

    const [rows] = await connection.query('SELECT * FROM phieu_nhap_kho WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu nhập kho cần xóa.' });
    }

    const pnk = rows[0];
    if (pnk.trang_thai_nhap === 'Đã hủy') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Phiếu nhập kho này đã được hủy trước đó.' });
    }

    const nguoiHuy = req.user?.ho_ten || req.user?.ten_dang_nhap || 'Thủ kho';

    // If already imported, validate stock availability and revert stock
    if (pnk.trang_thai_nhap === 'Đã nhập') {
      const [items] = await connection.query(`
        SELECT pnkct.*, v.ten_vat_tu, v.ma_vat_tu
        FROM phieu_nhap_kho_chi_tiet pnkct
        LEFT JOIN danh_muc_vat_tu v ON pnkct.id_danh_muc_vat_tu = v.id
        WHERE pnkct.id_phieu_nhap_kho = ?
      `, [pnk.id]);

      // Step 1: Check if current inventory has enough stock to deduct (Prevent negative stock)
      for (const it of items) {
        const qty = parseFloat(it.so_luong_thuc_nhap) || 0;
        if (qty <= 0) continue;

        const [stockRows] = await connection.query(
          'SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ? FOR UPDATE',
          [pnk.id_kho_hang, it.id_danh_muc_vat_tu]
        );
        const currentStock = stockRows[0] ? parseFloat(stockRows[0].so_luong_ton) : 0;
        if (currentStock < qty) {
          await connection.rollback();
          connection.release();
          const matName = it.ten_vat_tu ? `${it.ten_vat_tu} (${it.ma_vat_tu || ''})` : `Vật tư ID ${it.id_danh_muc_vat_tu}`;
          return res.status(400).json({
            message: `Kho hiện không đủ tồn kho để hoàn trừ cho ${matName} (Tồn hiện tại: ${currentStock} ${it.don_vi_tinh || ''}, Cần trừ: ${qty} ${it.don_vi_tinh || ''}). Vật tư này có thể đã được xuất sử dụng hoặc xuất bán.`
          });
        }
      }

      // Step 2: Deduct stock and log history
      for (const it of items) {
        const qty = parseFloat(it.so_luong_thuc_nhap) || 0;
        if (qty <= 0) continue;

        const tonKhoId = await updateStock(connection, pnk.id_kho_hang, it.id_danh_muc_vat_tu, -qty);
        await connection.query(
          `INSERT INTO ton_kho_lich_su (
            id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi,
            id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao, thoi_gian_tao
          ) VALUES (?, ?, ?, ?, ?, 'Hủy phiếu nhập kho', ?, ?, NOW())`,
          [tonKhoId, pnk.id_kho_hang, it.id_danh_muc_vat_tu, -qty, pnk.id, `Hoàn trừ tồn kho do hủy phiếu nhập ${pnk.ma_phieu}`, nguoiHuy]
        );
      }
    }

    // Step 3: If linked to a Purchase Order (PO), revert PO delivery status to 'Chưa giao'
    if (pnk.id_phieu_mua_hang) {
      await connection.query(
        `UPDATE phieu_mua_hang
         SET trang_thai_giao_hang = 'Chưa giao',
             ngay_giao_thuc_te = NULL,
             nguoi_nhan_hang = NULL
         WHERE id = ?`,
        [pnk.id_phieu_mua_hang]
      );
    }

    // Step 4: Soft delete and update cancellation audit fields (da_xoa = 0 to remain visible as Đã hủy)
    await connection.query(
      `UPDATE phieu_nhap_kho
       SET da_xoa = 0,
           trang_thai_nhap = 'Đã hủy',
           ly_do_huy = ?,
           thoi_gian_huy = NOW(),
           nguoi_huy = ?
       WHERE id = ?`,
      [ly_do_huy.trim(), nguoiHuy, pnk.id]
    );

    await logChange(connection, 'phieu_nhap_kho', pnk.id, 'HUY_PHIEU', pnk, { da_xoa: 0, trang_thai_nhap: 'Đã hủy', ly_do_huy: ly_do_huy.trim(), nguoi_huy: nguoiHuy }, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: 'Đã hủy phiếu nhập kho và hoàn trừ tồn kho thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting phieu_nhap_kho:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi xóa phiếu nhập kho.' });
  } finally {
    connection.release();
  }
});

// ========================================================
// 6. PHIẾU CHUYỂN KHO NỘI BỘ (WAREHOUSE TRANSFERS)
// ========================================================

// 6.0 Danh sách năm phát sinh chuyển kho
router.get('/phieu-chuyen-kho/years', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT COALESCE(nam, YEAR(ngay_chuyen)) as year 
       FROM phieu_chuyen_kho_noi_bo 
       WHERE (nam IS NOT NULL OR ngay_chuyen IS NOT NULL) AND COALESCE(da_xoa, 0) = 0
       ORDER BY year DESC`
    );
    const currentYear = new Date().getFullYear();
    const dbYears = rows.map(r => parseInt(r.year, 10)).filter(y => !isNaN(y) && y > 1900);
    const uniqueYears = Array.from(new Set([currentYear, currentYear - 1, ...dbYears])).sort((a, b) => b - a);
    return res.json(uniqueYears);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách năm chuyển kho.' });
  }
});

// 6.1 Danh sách phiếu chuyển kho
router.get('/phieu-chuyen-kho', authMiddleware, async (req, res) => {
  try {
    const { nam, id_kho_nguon, id_kho_dich, trang_thai, search, page = 1, limit = 25 } = req.query;

    let sql = `
      SELECT pc.*,
             kn.ten_kho AS ten_kho_nguon,
             kd.ten_kho AS ten_kho_dich,
             l.ten_lvkd, l.ma_lvkd,
             COALESCE((
               SELECT COUNT(*) FROM phieu_chuyen_kho_chi_tiet WHERE id_phieu_chuyen = pc.id
             ), 0) AS tong_so_mat_hang,
             COALESCE((
               SELECT SUM(so_luong_chuyen) FROM phieu_chuyen_kho_chi_tiet WHERE id_phieu_chuyen = pc.id
             ), 0) AS tong_so_luong_chuyen
      FROM phieu_chuyen_kho_noi_bo pc
      LEFT JOIN kho_hang kn ON pc.id_kho_nguon = kn.id
      LEFT JOIN kho_hang kd ON pc.id_kho_dich = kd.id
      LEFT JOIN linh_vuc_kinh_doanh l ON pc.id_linh_vuc_kinh_doanh = l.id
      WHERE COALESCE(pc.da_xoa, 0) = 0
    `;

    const params = [];

    if (nam && nam !== 'all' && nam !== 'ALL') {
      sql += ` AND (pc.nam = ? OR YEAR(pc.ngay_chuyen) = ?)`;
      params.push(parseInt(nam, 10), parseInt(nam, 10));
    }
    if (id_kho_nguon && id_kho_nguon !== 'all') {
      sql += ` AND pc.id_kho_nguon = ?`;
      params.push(parseInt(id_kho_nguon, 10));
    }
    if (id_kho_dich && id_kho_dich !== 'all') {
      sql += ` AND pc.id_kho_dich = ?`;
      params.push(parseInt(id_kho_dich, 10));
    }
    if (trang_thai && trang_thai !== 'all') {
      sql += ` AND pc.trang_thai = ?`;
      params.push(trang_thai);
    }
    if (search && search.trim()) {
      sql += ` AND (pc.ma_phieu_chuyen LIKE ? OR pc.nguoi_thuc_hien LIKE ? OR pc.nguoi_giao_hang LIKE ? OR pc.nguoi_nhan_hang LIKE ? OR pc.ghi_chu LIKE ?)`;
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s, s);
    }

    sql += ` ORDER BY pc.id DESC`;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 25;
    const offset = (pageNum - 1) * limitNum;

    const [totalRows] = await pool.query(`SELECT COUNT(*) as total FROM (${sql}) AS count_table`, params);
    const total = totalRows[0]?.total || 0;

    sql += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    const [rows] = await pool.query(sql, params);
    await attachFilesToRecords(pool, 'phieu_chuyen_kho_noi_bo', rows);

    return res.json({
      data: rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1
      }
    });
  } catch (err) {
    console.error('Error fetching phieu_chuyen_kho:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách phiếu chuyển kho.' });
  }
});

// 6.2 Chi tiết 1 phiếu chuyển kho
router.get('/phieu-chuyen-kho/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pc.*,
              kn.ten_kho AS ten_kho_nguon,
              kd.ten_kho AS ten_kho_dich,
              l.ten_lvkd, l.ma_lvkd
       FROM phieu_chuyen_kho_noi_bo pc
       LEFT JOIN kho_hang kn ON pc.id_kho_nguon = kn.id
       LEFT JOIN kho_hang kd ON pc.id_kho_dich = kd.id
       LEFT JOIN linh_vuc_kinh_doanh l ON pc.id_linh_vuc_kinh_doanh = l.id
       WHERE pc.id = ? AND COALESCE(pc.da_xoa, 0) = 0`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu chuyển kho.' });
    }

    const transfer = rows[0];

    const [items] = await pool.query(
      `SELECT dt.*,
              v.ma_vat_tu, v.ten_vat_tu,
              lvt.ten_loai_vat_tu
       FROM phieu_chuyen_kho_chi_tiet dt
       LEFT JOIN danh_muc_vat_tu v ON dt.id_danh_muc_vat_tu = v.id
       LEFT JOIN danh_muc_loai_vat_tu lvt ON v.id_loai_vat_tu = lvt.id
       WHERE dt.id_phieu_chuyen = ?
       ORDER BY dt.id ASC`,
      [req.params.id]
    );

    transfer.items = items;
    await attachFilesToRecords(pool, 'phieu_chuyen_kho_noi_bo', [transfer]);

    return res.json(transfer);
  } catch (err) {
    console.error('Error fetching transfer detail:', err);
    return res.status(500).json({ message: 'Lỗi tải chi tiết phiếu chuyển kho.' });
  }
});

// 6.3 Tạo phiếu chuyển kho mới (Xuất hàng khỏi kho nguồn)
router.post('/phieu-chuyen-kho', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), upload.array('files'), async (req, res) => {
  const body = req.body || {};
  const {
    id_kho_nguon,
    id_kho_dich,
    id_linh_vuc_kinh_doanh,
    ngay_chuyen,
    nguoi_thuc_hien,
    nguoi_giao_hang,
    ly_do_chuyen,
    ghi_chu
  } = body;

  let items = [];
  try {
    items = typeof body.items === 'string' ? JSON.parse(body.items) : (body.items || []);
  } catch (e) {
    return res.status(400).json({ message: 'Dữ liệu danh sách vật tư không hợp lệ.' });
  }

  if (!id_kho_nguon || !id_kho_dich) {
    return res.status(400).json({ message: 'Vui lòng chọn đầy đủ kho xuất và kho nhập.' });
  }

  if (String(id_kho_nguon) === String(id_kho_dich)) {
    return res.status(400).json({ message: 'Kho nguồn và kho đích không được trùng nhau.' });
  }

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'Vui lòng chọn ít nhất 1 vật tư để điều chuyển.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const dateVal = ngay_chuyen ? new Date(ngay_chuyen) : new Date();
    const currentYear = dateVal.getFullYear();

    // 1. Kiểm tra tồn kho tại kho nguồn
    for (const it of items) {
      const matId = it.id_danh_muc_vat_tu;
      const qty = parseFloat(it.so_luong_chuyen) || 0;
      if (!matId || qty <= 0) {
        await connection.rollback();
        return res.status(400).json({ message: 'Số lượng điều chuyển phải lớn hơn 0.' });
      }

      const [stockRows] = await connection.query(
        `SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ? FOR UPDATE`,
        [id_kho_nguon, matId]
      );
      const currentStock = stockRows.length > 0 ? parseFloat(stockRows[0].so_luong_ton) || 0 : 0;
      if (currentStock < qty) {
        const [matRow] = await connection.query(`SELECT ten_vat_tu, ma_vat_tu FROM danh_muc_vat_tu WHERE id = ?`, [matId]);
        const matName = matRow[0]?.ten_vat_tu || `#${matId}`;
        await connection.rollback();
        return res.status(400).json({
          message: `Không đủ tồn kho tại kho nguồn cho vật tư "${matName}"! Tồn hiện tại: ${currentStock.toLocaleString('vi-VN')}, Số lượng muốn chuyển: ${qty.toLocaleString('vi-VN')}`
        });
      }
    }

    // 2. Sinh mã phiếu CK
    const seq = await generateSequenceNumber(connection, {
      id_linh_vuc_kinh_doanh: id_linh_vuc_kinh_doanh || 1,
      loai_chung_tu: 'CK',
      nam: currentYear
    });

    // 3. Insert phiếu chuyển kho
    const [insRes] = await connection.query(
      `INSERT INTO phieu_chuyen_kho_noi_bo (
        ma_phieu_chuyen, so_vao_so, nam, id_linh_vuc_kinh_doanh,
        id_kho_nguon, id_kho_dich, ngay_chuyen, nguoi_thuc_hien,
        nguoi_giao_hang, trang_thai, ly_do_chuyen, ghi_chu, da_xoa
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Dang_Chuyen', ?, ?, 0)`,
      [
        seq.ma_phieu,
        seq.so_vao_so,
        currentYear,
        id_linh_vuc_kinh_doanh || null,
        id_kho_nguon,
        id_kho_dich,
        ngay_chuyen || new Date(),
        nguoi_thuc_hien || req.user.ho_ten || 'Thủ kho',
        nguoi_giao_hang || null,
        ly_do_chuyen || null,
        ghi_chu || null
      ]
    );

    const transferId = insRes.insertId;

    // 4. Insert chi tiết & Trừ tồn kho nguồn ngay lập tức
    for (const it of items) {
      const qty = parseFloat(it.so_luong_chuyen) || 0;
      await connection.query(
        `INSERT INTO phieu_chuyen_kho_chi_tiet (
          id_phieu_chuyen, id_danh_muc_vat_tu, don_vi_tinh, so_luong_chuyen, so_luong_nhan_thuc_te, ghi_chu
        ) VALUES (?, ?, ?, ?, 0, ?)`,
        [transferId, it.id_danh_muc_vat_tu, it.don_vi_tinh || '', qty, it.ghi_chu || null]
      );

      // Trừ tồn kho nguồn
      await updateStock(connection, id_kho_nguon, it.id_danh_muc_vat_tu, -qty);

      // Ghi lịch sử thẻ kho nguồn
      await connection.query(
        `INSERT INTO ton_kho_lich_su (
          id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, ghi_chu, thoi_gian_tao
        ) VALUES (?, ?, ?, ?, 'Chuyen_kho_xuat', ?, NOW())`,
        [id_kho_nguon, it.id_danh_muc_vat_tu, -qty, transferId, `Xuất chuyển kho nội bộ theo phiếu ${seq.ma_phieu}`]
      );
    }

    // 5. Lưu file đính kèm nếu có
    if (req.files && req.files.length > 0) {
      await saveUploadedFiles(connection, 'phieu_chuyen_kho_noi_bo', transferId, req.files, req.user.ten_dang_nhap);
    }

    await logChange(connection, 'phieu_chuyen_kho_noi_bo', transferId, 'THEM_MOI', null, { id: transferId, ma_phieu: seq.ma_phieu }, req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json({
      message: `Tạo phiếu điều chuyển ${seq.ma_phieu} thành công và đã xuất khỏi kho nguồn.`,
      id: transferId,
      ma_phieu: seq.ma_phieu
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating transfer:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi tạo phiếu điều chuyển kho.' });
  } finally {
    connection.release();
  }
});

// 6.4 Xác nhận đã nhận hàng tại kho đích
router.put('/phieu-chuyen-kho/:id/xac-nhan', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { nguoi_nhan_hang, items } = req.body || {};
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT * FROM phieu_chuyen_kho_noi_bo WHERE id = ? AND COALESCE(da_xoa, 0) = 0 FOR UPDATE`,
      [req.params.id]
    );

    if (rows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu chuyển kho.' });
    }

    const transfer = rows[0];
    if (transfer.trang_thai === 'Da_Nhan') {
      connection.release();
      return res.status(400).json({ message: 'Phiếu chuyển kho này đã được nhận trước đó.' });
    }

    if (transfer.trang_thai === 'Da_Huy') {
      connection.release();
      return res.status(400).json({ message: 'Phiếu chuyển kho này đã bị hủy, không thể nhận hàng.' });
    }

    // 1. Cập nhật số lượng thực nhận cho từng dòng
    const [detailRows] = await connection.query(
      `SELECT * FROM phieu_chuyen_kho_chi_tiet WHERE id_phieu_chuyen = ?`,
      [transfer.id]
    );

    for (const dt of detailRows) {
      const matchInput = (items || []).find(it => String(it.id) === String(dt.id) || String(it.id_danh_muc_vat_tu) === String(dt.id_danh_muc_vat_tu));
      const actualQty = matchInput && matchInput.so_luong_nhan_thuc_te !== undefined
        ? parseFloat(matchInput.so_luong_nhan_thuc_te) || 0
        : parseFloat(dt.so_luong_chuyen) || 0;

      await connection.query(
        `UPDATE phieu_chuyen_kho_chi_tiet SET so_luong_nhan_thuc_te = ? WHERE id = ?`,
        [actualQty, dt.id]
      );

      // Cộng tồn kho đích
      await updateStock(connection, transfer.id_kho_dich, dt.id_danh_muc_vat_tu, actualQty);

      // Ghi lịch sử thẻ kho đích
      await connection.query(
        `INSERT INTO ton_kho_lich_su (
          id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, ghi_chu, thoi_gian_tao
        ) VALUES (?, ?, ?, ?, 'Chuyen_kho_nhap', ?, NOW())`,
        [transfer.id_kho_dich, dt.id_danh_muc_vat_tu, actualQty, transfer.id, `Nhập kho từ phiếu chuyển ${transfer.ma_phieu_chuyen}`]
      );

      // Nếu số thực nhận < số chuyển, hoàn lại phần thừa cho kho nguồn
      const diff = parseFloat(dt.so_luong_chuyen) - actualQty;
      if (diff > 0.0001) {
        await updateStock(connection, transfer.id_kho_nguon, dt.id_danh_muc_vat_tu, diff);
        await connection.query(
          `INSERT INTO ton_kho_lich_su (
            id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, ghi_chu, thoi_gian_tao
          ) VALUES (?, ?, ?, ?, 'Chuyen_kho_hoan_lai', ?, NOW())`,
          [transfer.id_kho_nguon, dt.id_danh_muc_vat_tu, diff, transfer.id, `Hoàn lại lượng chênh lệch không nhận từ phiếu ${transfer.ma_phieu_chuyen}`]
        );
      }
    }

    // 2. Cập nhật header
    await connection.query(
      `UPDATE phieu_chuyen_kho_noi_bo 
       SET trang_thai = 'Da_Nhan',
           nguoi_nhan_hang = ?
       WHERE id = ?`,
      [nguoi_nhan_hang || req.user.ho_ten || 'Người nhận', transfer.id]
    );

    await logChange(connection, 'phieu_chuyen_kho_noi_bo', transfer.id, 'XAC_NHAN_NHAN', transfer, { trang_thai: 'Da_Nhan', nguoi_nhan_hang }, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: `Đã xác nhận nhận hàng cho phiếu điều chuyển ${transfer.ma_phieu_chuyen} và cập nhật tồn kho đích thành công!` });
  } catch (err) {
    await connection.rollback();
    console.error('Error confirming transfer:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi xác nhận nhận hàng chuyển kho.' });
  } finally {
    connection.release();
  }
});

// 6.5 Hủy phiếu chuyển kho (Hoàn trả tồn kho nguồn nếu chưa nhận)
router.delete('/phieu-chuyen-kho/:id', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { ly_do_huy } = req.body || {};
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT * FROM phieu_chuyen_kho_noi_bo WHERE id = ? AND COALESCE(da_xoa, 0) = 0 FOR UPDATE`,
      [req.params.id]
    );

    if (rows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu chuyển kho.' });
    }

    const transfer = rows[0];
    if (transfer.trang_thai === 'Da_Nhan') {
      connection.release();
      return res.status(400).json({ message: 'Phiếu đã được nhận hàng tại kho đích, không thể hủy phiếu!' });
    }

    // Hoàn trả lại tồn kho cho kho nguồn
    const [detailRows] = await connection.query(
      `SELECT * FROM phieu_chuyen_kho_chi_tiet WHERE id_phieu_chuyen = ?`,
      [transfer.id]
    );

    for (const dt of detailRows) {
      const qty = parseFloat(dt.so_luong_chuyen) || 0;
      if (qty > 0) {
        await updateStock(connection, transfer.id_kho_nguon, dt.id_danh_muc_vat_tu, qty);
        await connection.query(
          `INSERT INTO ton_kho_lich_su (
            id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, ghi_chu, thoi_gian_tao
          ) VALUES (?, ?, ?, ?, 'Huy_chuyen_kho', ?, NOW())`,
          [transfer.id_kho_nguon, dt.id_danh_muc_vat_tu, qty, transfer.id, `Hoàn trả tồn kho do hủy phiếu chuyển ${transfer.ma_phieu_chuyen}`]
        );
      }
    }

    // Đánh dấu hủy
    await connection.query(
      `UPDATE phieu_chuyen_kho_noi_bo
       SET da_xoa = 0,
           trang_thai = 'Da_Huy',
           ghi_chu = CONCAT(COALESCE(ghi_chu, ''), ' [HỦY PHIẾU: ', ?, ']')
       WHERE id = ?`,
      [ly_do_huy || 'Người dùng hủy', transfer.id]
    );

    await logChange(connection, 'phieu_chuyen_kho_noi_bo', transfer.id, 'HUY_PHIEU', transfer, { trang_thai: 'Da_Huy', ly_do_huy }, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: `Đã hủy phiếu chuyển kho ${transfer.ma_phieu_chuyen} và hoàn trả tồn kho cho kho nguồn thành công!` });
  } catch (err) {
    await connection.rollback();
    console.error('Error cancelling transfer:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi hủy phiếu chuyển kho.' });
  } finally {
    connection.release();
  }
});

// 6.6 In phiếu điều chuyển nội bộ
router.get('/phieu-chuyen-kho/:id/in', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pc.*,
              kn.ten_kho AS ten_kho_nguon, kn.dia_diem AS dia_chi_kho_nguon,
              kd.ten_kho AS ten_kho_dich, kd.dia_diem AS dia_chi_kho_dich,
              l.ten_lvkd, l.ma_lvkd
       FROM phieu_chuyen_kho_noi_bo pc
       LEFT JOIN kho_hang kn ON pc.id_kho_nguon = kn.id
       LEFT JOIN kho_hang kd ON pc.id_kho_dich = kd.id
       LEFT JOIN linh_vuc_kinh_doanh l ON pc.id_linh_vuc_kinh_doanh = l.id
       WHERE pc.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu chuyển kho.' });
    }

    const transfer = rows[0];

    const [items] = await pool.query(
      `SELECT dt.*,
              v.ma_vat_tu, v.ten_vat_tu, v.don_gia_tieu_chuan
       FROM phieu_chuyen_kho_chi_tiet dt
       LEFT JOIN danh_muc_vat_tu v ON dt.id_danh_muc_vat_tu = v.id
       WHERE dt.id_phieu_chuyen = ?
       ORDER BY dt.id ASC`,
      [req.params.id]
    );

    transfer.items = items;
    return res.json(transfer);
  } catch (err) {
    console.error('Error fetching transfer print:', err);
    return res.status(500).json({ message: 'Lỗi tải dữ liệu in phiếu điều chuyển.' });
  }
});

// ========================================================
// 7. KIỂM KÊ KHO ĐỊNH KỲ (WAREHOUSE INVENTORY AUDIT)
// ========================================================

// 7.0 Danh sách năm kiểm kê
router.get('/kiem-ke/years', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT COALESCE(nam, YEAR(ngay_kiem_ke)) as year 
       FROM kiem_ke_kho 
       WHERE (nam IS NOT NULL OR ngay_kiem_ke IS NOT NULL) AND COALESCE(da_xoa, 0) = 0
       ORDER BY year DESC`
    );
    const currentYear = new Date().getFullYear();
    const dbYears = rows.map(r => parseInt(r.year, 10)).filter(y => !isNaN(y) && y > 1900);
    const uniqueYears = Array.from(new Set([currentYear, currentYear - 1, ...dbYears])).sort((a, b) => b - a);
    return res.json(uniqueYears);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách năm kiểm kê.' });
  }
});

// 7.1 Lấy snapshot danh mục & tồn kho hiện tại của kho để chuẩn bị kiểm kê
router.get('/kiem-ke/snapshot-stock/:id_kho', authMiddleware, async (req, res) => {
  try {
    const khoId = parseInt(req.params.id_kho, 10);
    if (!khoId) {
      return res.status(400).json({ message: 'ID kho không hợp lệ.' });
    }

    const [rows] = await pool.query(
      `SELECT v.id AS id_danh_muc_vat_tu,
              v.ma_vat_tu,
              v.ten_vat_tu,
              v.don_vi_tinh,
              v.don_gia_tieu_chuan,
              lvt.ten_loai_vat_tu,
              COALESCE(tk.so_luong_ton, 0) AS so_luong_so_sach
       FROM danh_muc_vat_tu v
       LEFT JOIN danh_muc_loai_vat_tu lvt ON v.id_loai_vat_tu = lvt.id
       LEFT JOIN ton_kho tk ON tk.id_danh_muc_vat_tu = v.id AND tk.id_kho_hang = ?
       WHERE COALESCE(v.da_xoa, 0) = 0
       ORDER BY v.ten_vat_tu ASC`,
      [khoId]
    );

    return res.json(rows);
  } catch (err) {
    console.error('Error taking stock snapshot:', err);
    return res.status(500).json({ message: 'Lỗi tải danh mục tồn kho kiểm kê.' });
  }
});

// 7.2 Danh sách phiếu kiểm kê
router.get('/kiem-ke', authMiddleware, async (req, res) => {
  try {
    const { nam, id_kho_hang, trang_thai, search, page = 1, limit = 25 } = req.query;

    let sql = `
      SELECT kk.*,
             k.ten_kho, k.loai_kho,
             l.ten_lvkd, l.ma_lvkd,
             COALESCE((
               SELECT COUNT(*) FROM kiem_ke_kho_chi_tiet WHERE id_kiem_ke_kho = kk.id
             ), 0) AS tong_so_mat_hang,
             COALESCE((
               SELECT COUNT(*) FROM kiem_ke_kho_chi_tiet WHERE id_kiem_ke_kho = kk.id AND ABS(so_luong_chenh_lech) > 0.0001
             ), 0) AS so_mat_hang_lech
      FROM kiem_ke_kho kk
      LEFT JOIN kho_hang k ON kk.id_kho_hang = k.id
      LEFT JOIN linh_vuc_kinh_doanh l ON kk.id_linh_vuc_kinh_doanh = l.id
      WHERE COALESCE(kk.da_xoa, 0) = 0
    `;

    const params = [];

    if (nam && nam !== 'all' && nam !== 'ALL') {
      sql += ` AND (kk.nam = ? OR YEAR(kk.ngay_kiem_ke) = ?)`;
      params.push(parseInt(nam, 10), parseInt(nam, 10));
    }
    if (id_kho_hang && id_kho_hang !== 'all') {
      sql += ` AND kk.id_kho_hang = ?`;
      params.push(parseInt(id_kho_hang, 10));
    }
    if (trang_thai && trang_thai !== 'all') {
      sql += ` AND kk.trang_thai = ?`;
      params.push(trang_thai);
    }
    if (search && search.trim()) {
      sql += ` AND (kk.ma_phieu LIKE ? OR kk.nguoi_chu_tri LIKE ? OR kk.thanh_vien_kiem_ke LIKE ? OR kk.ghi_chu LIKE ?)`;
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }

    sql += ` ORDER BY kk.id DESC`;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 25;
    const offset = (pageNum - 1) * limitNum;

    const [totalRows] = await pool.query(`SELECT COUNT(*) as total FROM (${sql}) AS count_table`, params);
    const total = totalRows[0]?.total || 0;

    sql += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    const [rows] = await pool.query(sql, params);
    await attachFilesToRecords(pool, 'kiem_ke_kho', rows);

    return res.json({
      data: rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1
      }
    });
  } catch (err) {
    console.error('Error fetching kiem_ke_kho:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách phiếu kiểm kê.' });
  }
});

// 7.3 Chi tiết 1 phiếu kiểm kê
router.get('/kiem-ke/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT kk.*,
              k.ten_kho, k.loai_kho,
              l.ten_lvkd, l.ma_lvkd
       FROM kiem_ke_kho kk
       LEFT JOIN kho_hang k ON kk.id_kho_hang = k.id
       LEFT JOIN linh_vuc_kinh_doanh l ON kk.id_linh_vuc_kinh_doanh = l.id
       WHERE kk.id = ? AND COALESCE(kk.da_xoa, 0) = 0`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê.' });
    }

    const audit = rows[0];

    const [items] = await pool.query(
      `SELECT dt.*,
              v.ma_vat_tu, v.ten_vat_tu,
              lvt.ten_loai_vat_tu
       FROM kiem_ke_kho_chi_tiet dt
       LEFT JOIN danh_muc_vat_tu v ON dt.id_danh_muc_vat_tu = v.id
       LEFT JOIN danh_muc_loai_vat_tu lvt ON v.id_loai_vat_tu = lvt.id
       WHERE dt.id_kiem_ke_kho = ?
       ORDER BY dt.id ASC`,
      [req.params.id]
    );

    audit.items = items;
    await attachFilesToRecords(pool, 'kiem_ke_kho', [audit]);

    return res.json(audit);
  } catch (err) {
    console.error('Error fetching audit detail:', err);
    return res.status(500).json({ message: 'Lỗi tải chi tiết phiếu kiểm kê.' });
  }
});

// 7.4 Tạo phiếu kiểm kê mới
router.post('/kiem-ke', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), upload.array('files'), async (req, res) => {
  const body = req.body || {};
  const {
    id_kho_hang,
    id_linh_vuc_kinh_doanh,
    ngay_kiem_ke,
    nguoi_chu_tri,
    thanh_vien_kiem_ke,
    ghi_chu
  } = body;

  let items = [];
  try {
    items = typeof body.items === 'string' ? JSON.parse(body.items) : (body.items || []);
  } catch (e) {
    return res.status(400).json({ message: 'Dữ liệu danh sách vật tư không hợp lệ.' });
  }

  if (!id_kho_hang) {
    return res.status(400).json({ message: 'Vui lòng chọn kho hàng cần kiểm kê.' });
  }

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'Phiếu kiểm kê phải có ít nhất 1 mặt hàng.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const dateVal = ngay_kiem_ke ? new Date(ngay_kiem_ke) : new Date();
    const currentYear = dateVal.getFullYear();

    // Sinh mã phiếu KK
    const seq = await generateSequenceNumber(connection, {
      id_linh_vuc_kinh_doanh: id_linh_vuc_kinh_doanh || 1,
      loai_chung_tu: 'KK',
      nam: currentYear
    });

    let tongSoSach = 0;
    let tongThucTe = 0;
    let tongLechThua = 0;
    let tongLechThieu = 0;
    let tongGiaTriLech = 0;

    // Tính toán tổng số lượng & giá trị chênh lệch
    items.forEach(it => {
      const soSach = parseFloat(it.so_luong_so_sach) || 0;
      const thucTe = parseFloat(it.so_luong_thuc_te) || 0;
      const chenhLech = thucTe - soSach;
      const donGia = parseFloat(it.don_gia_von) || 0;

      tongSoSach += soSach;
      tongThucTe += thucTe;
      if (chenhLech > 0) {
        tongLechThua += chenhLech;
      } else if (chenhLech < 0) {
        tongLechThieu += Math.abs(chenhLech);
      }
      tongGiaTriLech += (chenhLech * donGia);
    });

    const [insRes] = await connection.query(
      `INSERT INTO kiem_ke_kho (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, id_kho_hang,
        ngay_kiem_ke, nguoi_chu_tri, thanh_vien_kiem_ke, trang_thai,
        tong_sl_so_sach, tong_sl_thuc_te, tong_sl_lech_thua, tong_sl_lech_thieu,
        tong_gia_tri_lech_vnd, ghi_chu, da_xoa
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Dang_Kiem_Ke', ?, ?, ?, ?, ?, ?, 0)`,
      [
        seq.ma_phieu,
        seq.so_vao_so,
        currentYear,
        id_linh_vuc_kinh_doanh || null,
        id_kho_hang,
        ngay_kiem_ke || new Date(),
        nguoi_chu_tri || req.user.ho_ten || 'Trưởng ban kiểm kê',
        thanh_vien_kiem_ke || null,
        tongSoSach,
        tongThucTe,
        tongLechThua,
        tongLechThieu,
        tongGiaTriLech,
        ghi_chu || null
      ]
    );

    const auditId = insRes.insertId;

    for (const it of items) {
      const soSach = parseFloat(it.so_luong_so_sach) || 0;
      const thucTe = parseFloat(it.so_luong_thuc_te) || 0;
      const chenhLech = thucTe - soSach;
      const donGia = parseFloat(it.don_gia_von) || 0;
      const thanhTienChenhLech = chenhLech * donGia;

      await connection.query(
        `INSERT INTO kiem_ke_kho_chi_tiet (
          id_kiem_ke_kho, id_danh_muc_vat_tu, don_vi_tinh, so_luong_so_sach,
          so_luong_thuc_te, so_luong_chenh_lech, don_gia_von, thanh_tien_chenh_lech,
          ly_do_chenh_lech, bien_phap_xu_ly, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          auditId,
          it.id_danh_muc_vat_tu,
          it.don_vi_tinh || '',
          soSach,
          thucTe,
          chenhLech,
          donGia,
          thanhTienChenhLech,
          it.ly_do_chenh_lech || null,
          it.bien_phap_xu_ly || null,
          it.ghi_chu || null
        ]
      );
    }

    if (req.files && req.files.length > 0) {
      await saveUploadedFiles(connection, 'kiem_ke_kho', auditId, req.files, req.user.ten_dang_nhap);
    }

    await logChange(connection, 'kiem_ke_kho', auditId, 'THEM_MOI', null, { id: auditId, ma_phieu: seq.ma_phieu }, req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json({
      message: `Tạo phiếu kiểm kê ${seq.ma_phieu} thành công!`,
      id: auditId,
      ma_phieu: seq.ma_phieu
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating audit:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi tạo phiếu kiểm kê.' });
  } finally {
    connection.release();
  }
});

// 7.5 Cập nhật số liệu kiểm kê
router.put('/kiem-ke/:id', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), upload.array('files'), async (req, res) => {
  const body = req.body || {};
  const {
    ngay_kiem_ke,
    nguoi_chu_tri,
    thanh_vien_kiem_ke,
    ghi_chu
  } = body;

  let items = [];
  try {
    items = typeof body.items === 'string' ? JSON.parse(body.items) : (body.items || []);
  } catch (e) {
    return res.status(400).json({ message: 'Dữ liệu danh sách vật tư không hợp lệ.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT * FROM kiem_ke_kho WHERE id = ? AND COALESCE(da_xoa, 0) = 0 FOR UPDATE`,
      [req.params.id]
    );

    if (rows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê.' });
    }

    const audit = rows[0];
    if (audit.trang_thai === 'Da_Can_Doi') {
      connection.release();
      return res.status(400).json({ message: 'Phiếu kiểm kê đã được duyệt cân đối tồn kho, không thể chỉnh sửa!' });
    }

    let tongSoSach = 0;
    let tongThucTe = 0;
    let tongLechThua = 0;
    let tongLechThieu = 0;
    let tongGiaTriLech = 0;

    // Xóa chi tiết cũ và ghi lại
    await connection.query(`DELETE FROM kiem_ke_kho_chi_tiet WHERE id_kiem_ke_kho = ?`, [audit.id]);

    for (const it of items) {
      const soSach = parseFloat(it.so_luong_so_sach) || 0;
      const thucTe = parseFloat(it.so_luong_thuc_te) || 0;
      const chenhLech = thucTe - soSach;
      const donGia = parseFloat(it.don_gia_von) || 0;
      const thanhTienChenhLech = chenhLech * donGia;

      tongSoSach += soSach;
      tongThucTe += thucTe;
      if (chenhLech > 0) {
        tongLechThua += chenhLech;
      } else if (chenhLech < 0) {
        tongLechThieu += Math.abs(chenhLech);
      }
      tongGiaTriLech += thanhTienChenhLech;

      await connection.query(
        `INSERT INTO kiem_ke_kho_chi_tiet (
          id_kiem_ke_kho, id_danh_muc_vat_tu, don_vi_tinh, so_luong_so_sach,
          so_luong_thuc_te, so_luong_chenh_lech, don_gia_von, thanh_tien_chenh_lech,
          ly_do_chenh_lech, bien_phap_xu_ly, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          audit.id,
          it.id_danh_muc_vat_tu,
          it.don_vi_tinh || '',
          soSach,
          thucTe,
          chenhLech,
          donGia,
          thanhTienChenhLech,
          it.ly_do_chenh_lech || null,
          it.bien_phap_xu_ly || null,
          it.ghi_chu || null
        ]
      );
    }

    await connection.query(
      `UPDATE kiem_ke_kho
       SET ngay_kiem_ke = ?,
           nguoi_chu_tri = ?,
           thanh_vien_kiem_ke = ?,
           tong_sl_so_sach = ?,
           tong_sl_thuc_te = ?,
           tong_sl_lech_thua = ?,
           tong_sl_lech_thieu = ?,
           tong_gia_tri_lech_vnd = ?,
           ghi_chu = ?
       WHERE id = ?`,
      [
        ngay_kiem_ke || audit.ngay_kiem_ke,
        nguoi_chu_tri || audit.nguoi_chu_tri,
        thanh_vien_kiem_ke || audit.thanh_vien_kiem_ke,
        tongSoSach,
        tongThucTe,
        tongLechThua,
        tongLechThieu,
        tongGiaTriLech,
        ghi_chu !== undefined ? ghi_chu : audit.ghi_chu,
        audit.id
      ]
    );

    if (req.files && req.files.length > 0) {
      await saveUploadedFiles(connection, 'kiem_ke_kho', audit.id, req.files, req.user.ten_dang_nhap);
    }

    await logChange(connection, 'kiem_ke_kho', audit.id, 'CAP_NHAT', audit, { id: audit.id, ma_phieu: audit.ma_phieu }, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: `Cập nhật phiếu kiểm kê ${audit.ma_phieu} thành công!` });
  } catch (err) {
    await connection.rollback();
    console.error('Error updating audit:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi cập nhật phiếu kiểm kê.' });
  } finally {
    connection.release();
  }
});

// 7.6 Duyệt & Cân đối tồn kho thực tế
router.post('/kiem-ke/:id/can-doi', authMiddleware, authorize(['Ban_Giam_Doc', 'Ke_Toan', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT * FROM kiem_ke_kho WHERE id = ? AND COALESCE(da_xoa, 0) = 0 FOR UPDATE`,
      [req.params.id]
    );

    if (rows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê.' });
    }

    const audit = rows[0];
    if (audit.trang_thai === 'Da_Can_Doi') {
      connection.release();
      return res.status(400).json({ message: 'Phiếu kiểm kê này đã được cân đối tồn kho trước đó.' });
    }

    const [detailRows] = await connection.query(
      `SELECT * FROM kiem_ke_kho_chi_tiet WHERE id_kiem_ke_kho = ?`,
      [audit.id]
    );

    for (const dt of detailRows) {
      const thucTe = parseFloat(dt.so_luong_thuc_te) || 0;
      const soSach = parseFloat(dt.so_luong_so_sach) || 0;
      const diff = thucTe - soSach;

      if (Math.abs(diff) > 0.0001) {
        // Cập nhật tồn kho đưa số tồn về đúng số lượng thực tế kiểm kê
        const [existStock] = await connection.query(
          `SELECT id, so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ? FOR UPDATE`,
          [audit.id_kho_hang, dt.id_danh_muc_vat_tu]
        );

        if (existStock.length > 0) {
          await connection.query(
            `UPDATE ton_kho SET so_luong_ton = ? WHERE id = ?`,
            [thucTe, existStock[0].id]
          );
        } else {
          await connection.query(
            `INSERT INTO ton_kho (id_kho_hang, id_danh_muc_vat_tu, so_luong_ton, nguoi_tao) VALUES (?, ?, ?, ?)`,
            [audit.id_kho_hang, dt.id_danh_muc_vat_tu, thucTe, req.user.ho_ten || 'Hệ thống']
          );
        }

        // Ghi nhật ký thẻ kho
        await connection.query(
          `INSERT INTO ton_kho_lich_su (
            id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, ghi_chu, thoi_gian_tao
          ) VALUES (?, ?, ?, ?, 'Kiem_ke_can_doi', ?, NOW())`,
          [
            audit.id_kho_hang,
            dt.id_danh_muc_vat_tu,
            diff,
            audit.id,
            `Cân đối chênh lệch kiểm kê theo biên bản ${audit.ma_phieu} (${diff > 0 ? '+' : ''}${diff.toLocaleString('vi-VN')})`
          ]
        );
      }
    }

    // Đánh dấu trạng thái phiếu là Đã cân đối
    await connection.query(
      `UPDATE kiem_ke_kho
       SET trang_thai = 'Da_Can_Doi',
           nguoi_duyet_can_doi = ?,
           ngay_duyet_can_doi = NOW()
       WHERE id = ?`,
      [req.user.ho_ten || 'Ban Giám Đốc', audit.id]
    );

    await logChange(connection, 'kiem_ke_kho', audit.id, 'CAN_DOI_TON_KHO', audit, { trang_thai: 'Da_Can_Doi' }, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({
      message: `Đã phê duyệt và cân đối tồn kho thực tế theo biên bản kiểm kê ${audit.ma_phieu} thành công!`
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error balancing stock audit:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi duyệt cân đối tồn kho.' });
  } finally {
    connection.release();
  }
});

// 7.7 Xóa phiếu kiểm kê (chỉ khi chưa cân đối)
router.delete('/kiem-ke/:id', authMiddleware, authorize(['Kinh_Doanh', 'Vat_Tu', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT * FROM kiem_ke_kho WHERE id = ? AND COALESCE(da_xoa, 0) = 0 FOR UPDATE`,
      [req.params.id]
    );

    if (rows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê.' });
    }

    const audit = rows[0];
    if (audit.trang_thai === 'Da_Can_Doi') {
      connection.release();
      return res.status(400).json({ message: 'Phiếu kiểm kê đã cân đối tồn kho, không thể xóa!' });
    }

    await connection.query(`UPDATE kiem_ke_kho SET da_xoa = 1 WHERE id = ?`, [audit.id]);
    await logChange(connection, 'kiem_ke_kho', audit.id, 'XOA', audit, { da_xoa: 1 }, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: `Đã xóa phiếu kiểm kê ${audit.ma_phieu} thành công.` });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting audit:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi xóa phiếu kiểm kê.' });
  } finally {
    connection.release();
  }
});

// 7.8 In biên bản kiểm kê kho
router.get('/kiem-ke/:id/in', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT kk.*,
              k.ten_kho, k.dia_diem AS dia_chi_kho, k.loai_kho,
              l.ten_lvkd, l.ma_lvkd
       FROM kiem_ke_kho kk
       LEFT JOIN kho_hang k ON kk.id_kho_hang = k.id
       LEFT JOIN linh_vuc_kinh_doanh l ON kk.id_linh_vuc_kinh_doanh = l.id
       WHERE kk.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu kiểm kê.' });
    }

    const audit = rows[0];

    const [items] = await pool.query(
      `SELECT dt.*,
              v.ma_vat_tu, v.ten_vat_tu, lvt.ten_loai_vat_tu
       FROM kiem_ke_kho_chi_tiet dt
       LEFT JOIN danh_muc_vat_tu v ON dt.id_danh_muc_vat_tu = v.id
       LEFT JOIN danh_muc_loai_vat_tu lvt ON v.id_loai_vat_tu = lvt.id
       WHERE dt.id_kiem_ke_kho = ?
       ORDER BY dt.id ASC`,
      [req.params.id]
    );

    audit.items = items;
    return res.json(audit);
  } catch (err) {
    console.error('Error fetching audit print:', err);
    return res.status(500).json({ message: 'Lỗi tải dữ liệu in biên bản kiểm kê.' });
  }
});

module.exports = {
  router,
  updateStock
};

