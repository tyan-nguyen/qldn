const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'file-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage });

const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');

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
    } else if (['zip', 'rar', '7z'].includes(ext)) {
      loaiFile = 'archive';
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

  return records.map(r => ({
    ...r,
    files: filesMap[r.id] || []
  }));
}

// 0. Get Vehicle Categories (danh_muc_loai_xe)
router.get('/danh-muc-loai-xe', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM danh_muc_loai_xe ORDER BY ten_loai_xe ASC');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh mục loại xe.' });
  }
});

// 0b. Create Vehicle Category
router.post('/danh-muc-loai-xe', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { ten_loai_xe, mo_ta } = req.body;
  if (!ten_loai_xe) {
    return res.status(400).json({ message: 'Tên loại xe không được để trống.' });
  }
  try {
    const [result] = await pool.query(
      'INSERT INTO danh_muc_loai_xe (ten_loai_xe, mo_ta, nguoi_tao) VALUES (?, ?, ?)',
      [ten_loai_xe, mo_ta || null, req.user.ten_dang_nhap]
    );
    const [newRow] = await pool.query('SELECT * FROM danh_muc_loai_xe WHERE id = ?', [result.insertId]);
    return res.status(201).json(newRow[0]);
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Tên loại xe này đã tồn tại.' });
    }
    return res.status(500).json({ message: 'Lỗi thêm danh mục loại xe.' });
  }
});

// 1. Get Vehicles (All roles can view)
const getVehicles = async (req, res) => {
  try {
    const [vehiclesRaw] = await pool.query('SELECT * FROM phuong_tien ORDER BY id DESC');
    const [categories] = await pool.query('SELECT * FROM danh_muc_loai_xe ORDER BY ten_loai_xe ASC');
    const vehicles = await attachFilesToRecords(pool, 'phuong_tien', vehiclesRaw);
    return res.json({ vehicles, categories });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách phương tiện.' });
  }
};
router.get('/phuong-tien', authMiddleware, getVehicles);
router.get('/danh-sach-xe', authMiddleware, getVehicles);

// 1b. Get Drivers (All roles can view)
const getDrivers = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM nhan_cong ORDER BY ho_ten ASC');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách tài xế.' });
  }
};
router.get('/danh-sach-tai-xe', authMiddleware, getDrivers);

// 2. Create Vehicle (Kinh_Doanh, Ban_Giam_Doc, Admin)
const createVehicle = async (req, res) => {
  const body = req.body || {};
  const { bien_so_xe, loai_xe, dinh_muc_nhien_lieu, dinh_muc_tieu_hao, ghi_chu } = body;
  const norm = dinh_muc_nhien_lieu || dinh_muc_tieu_hao;
  if (!bien_so_xe || !loai_xe) {
    return res.status(400).json({ message: 'Biển số xe và loại xe là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      'INSERT INTO phuong_tien (bien_so_xe, loai_xe, dinh_muc_tieu_hao, ghi_chu, nguoi_tao) VALUES (?, ?, ?, ?, ?)',
      [bien_so_xe, loai_xe, norm || 0.35, ghi_chu || null, req.user.ten_dang_nhap]
    );

    // Save multi-file attachments into files table
    await saveUploadedFiles(connection, 'phuong_tien', result.insertId, req.files, req.user.ten_dang_nhap);

    const [newRows] = await connection.query('SELECT * FROM phuong_tien WHERE id = ?', [result.insertId]);
    const [vehicleWithFiles] = await attachFilesToRecords(connection, 'phuong_tien', newRows);

    await logChange(connection, 'phuong_tien', result.insertId, 'THEM_MOI', null, vehicleWithFiles, req.user.ten_dang_nhap);
    await connection.commit();
    return res.status(201).json(vehicleWithFiles);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi thêm phương tiện.' });
  } finally {
    connection.release();
  }
};
router.post('/phuong-tien', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), upload.any(), createVehicle);
router.post('/danh-sach-xe', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), upload.any(), createVehicle);

// 2b. Update Vehicle
const updateVehicle = async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const { bien_so_xe, loai_xe, dinh_muc_nhien_lieu, dinh_muc_tieu_hao, ghi_chu } = body;
  const norm = dinh_muc_nhien_lieu || dinh_muc_tieu_hao;
  if (!bien_so_xe || !loai_xe) {
    return res.status(400).json({ message: 'Biển số xe và loại xe là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM phuong_tien WHERE id = ?', [id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phương tiện.' });
    }

    await connection.query(
      `UPDATE phuong_tien 
       SET bien_so_xe = ?, loai_xe = ?, dinh_muc_tieu_hao = ?, ghi_chu = ?
       WHERE id = ?`,
      [bien_so_xe, loai_xe, norm || 0.35, ghi_chu || null, id]
    );

    // Save multi-file attachments into files table
    await saveUploadedFiles(connection, 'phuong_tien', id, req.files, req.user.ten_dang_nhap);

    const [newRows] = await connection.query('SELECT * FROM phuong_tien WHERE id = ?', [id]);
    const [vehicleWithFiles] = await attachFilesToRecords(connection, 'phuong_tien', newRows);

    await logChange(connection, 'phuong_tien', id, 'CAP_NHAT', oldRow[0], vehicleWithFiles, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json(vehicleWithFiles);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật phương tiện.' });
  } finally {
    connection.release();
  }
};
router.put('/phuong-tien/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), upload.any(), updateVehicle);
router.put('/danh-sach-xe/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), upload.any(), updateVehicle);

// 2c. Delete Vehicle
const deleteVehicle = async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM phuong_tien WHERE id = ?', [id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phương tiện.' });
    }

    const [linked] = await connection.query('SELECT id FROM nhat_ky_nhien_lieu WHERE id_phuong_tien = ? LIMIT 1', [id]);
    if (linked.length > 0) {
      connection.release();
      return res.status(400).json({ message: 'Không thể xóa xe này vì đang có nhật trình vận chuyển/tiêu thụ xăng dầu liên kết.' });
    }

    await connection.query('DELETE FROM phuong_tien WHERE id = ?', [id]);
    await logChange(connection, 'phuong_tien', id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);
    
    await connection.commit();
    return res.json({ message: 'Xóa phương tiện xe thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa phương tiện.' });
  } finally {
    connection.release();
  }
};
router.delete('/phuong-tien/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), deleteVehicle);
router.delete('/danh-sach-xe/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), deleteVehicle);

// 3. Get Fuel Logs list
const getFuelLogs = async (req, res) => {
  try {
    const [rowsRaw] = await pool.query(
      `SELECT n.*, n.id_phuong_tien as id_phuong_tien_xe, n.id_nhan_cong as id_tai_xe, DATE_FORMAT(n.ngay_ghi_nhan, '%Y-%m-%d') as ngay_ghi_nhan, p.bien_so_xe, p.loai_xe, p.dinh_muc_tieu_hao, nc.ho_ten as tai_xe_ten, c.ten_cong_trinh
       FROM nhat_ky_nhien_lieu n
       JOIN phuong_tien p ON n.id_phuong_tien = p.id
       JOIN nhan_cong nc ON n.id_nhan_cong = nc.id
       LEFT JOIN cong_trinh c ON n.id_cong_trinh = c.id
       ORDER BY n.id DESC`
    );
    const rows = await attachFilesToRecords(pool, 'nhat_ky_nhien_lieu', rowsRaw);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn nhật ký nhiên liệu.' });
  }
};
router.get('/nhat-ky-nhien-lieu', authMiddleware, getFuelLogs);
router.get('/nhat-ky-xang-dau', authMiddleware, getFuelLogs);

// 4. Create Fuel Log Entry
const createFuelLog = async (req, res) => {
  const body = req.body || {};
  const {
    id_phuong_tien, id_phuong_tien_xe,
    id_nhan_cong, id_tai_xe,
    id_cong_trinh,
    ngay_ghi_nhan,
    so_lit_bom,
    cu_ly_van_chuyen, cu_ly_mot_chuyen,
    so_chuyen_chay,
    so_lit_tieu_hao,
    don_gia_chuyen,
    so_km_odometer,
    ghi_chu
  } = body;

  const vehId = id_phuong_tien_xe || id_phuong_tien;
  const driverId = id_tai_xe || id_nhan_cong;
  const lit = parseFloat(so_lit_bom) || 0;
  const dateVal = ngay_ghi_nhan || new Date().toISOString().slice(0, 10);

  if (!vehId || !driverId || lit <= 0) {
    return res.status(400).json({ message: 'Phương tiện xe, tài xế và số lít bơm là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [vehicle] = await connection.query('SELECT dinh_muc_tieu_hao FROM phuong_tien WHERE id = ?', [vehId]);
    if (vehicle.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phương tiện.' });
    }

    const norm = parseFloat(vehicle[0].dinh_muc_tieu_hao) || 0.35;
    const distance = parseFloat(cu_ly_van_chuyen || cu_ly_mot_chuyen) || 0;
    const calculatedTieuHao = so_lit_tieu_hao ? parseFloat(so_lit_tieu_hao) : (distance * norm);
    const rawOdo = parseFloat(so_km_odometer);
    const odoVal = isNaN(rawOdo) ? null : rawOdo;

    const [result] = await connection.query(
      `INSERT INTO nhat_ky_nhien_lieu (
        id_phuong_tien, id_nhan_cong, id_cong_trinh, ngay_ghi_nhan,
        so_lit_bom, cu_ly_van_chuyen, so_chuyen_chay, so_lit_tieu_hao, don_gia_chuyen, so_km_odometer, ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vehId,
        driverId,
        id_cong_trinh || null,
        dateVal,
        lit,
        distance,
        parseInt(so_chuyen_chay) || 1,
        calculatedTieuHao,
        parseFloat(don_gia_chuyen) || 0,
        odoVal,
        ghi_chu || null,
        req.user.ten_dang_nhap
      ]
    );

    // Save multi-file attachments into files table
    await saveUploadedFiles(connection, 'nhat_ky_nhien_lieu', result.insertId, req.files, req.user.ten_dang_nhap);

    const [newRows] = await connection.query('SELECT * FROM nhat_ky_nhien_lieu WHERE id = ?', [result.insertId]);
    const [fuelWithFiles] = await attachFilesToRecords(connection, 'nhat_ky_nhien_lieu', newRows);

    await logChange(connection, 'nhat_ky_nhien_lieu', result.insertId, 'THEM_MOI', null, fuelWithFiles, req.user.ten_dang_nhap);
    await connection.commit();
    return res.status(201).json(fuelWithFiles);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi ghi nhận nhật ký nhiên liệu.' });
  } finally {
    connection.release();
  }
};
router.post('/nhat-ky-nhien-lieu', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), upload.any(), createFuelLog);
router.post('/nhat-ky-xang-dau', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), upload.any(), createFuelLog);

// 4b. Update Fuel Log
const updateFuelLog = async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const {
    id_phuong_tien, id_phuong_tien_xe,
    id_nhan_cong, id_tai_xe,
    id_cong_trinh,
    ngay_ghi_nhan,
    so_lit_bom,
    cu_ly_van_chuyen, cu_ly_mot_chuyen,
    so_chuyen_chay,
    so_lit_tieu_hao,
    don_gia_chuyen,
    so_km_odometer,
    ghi_chu
  } = body;

  const vehId = id_phuong_tien_xe || id_phuong_tien;
  const driverId = id_tai_xe || id_nhan_cong;
  const lit = parseFloat(so_lit_bom) || 0;

  if (!vehId || !driverId) {
    return res.status(400).json({ message: 'Phương tiện xe và tài xế là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM nhat_ky_nhien_lieu WHERE id = ?', [id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy nhật ký nhiên liệu.' });
    }

    const distance = parseFloat(cu_ly_van_chuyen || cu_ly_mot_chuyen) || 0;
    const rawOdo = parseFloat(so_km_odometer);
    const odoVal = isNaN(rawOdo) ? null : rawOdo;

    await connection.query(
      `UPDATE nhat_ky_nhien_lieu 
       SET id_phuong_tien = ?, id_nhan_cong = ?, id_cong_trinh = ?,
           so_lit_bom = ?, cu_ly_van_chuyen = ?, so_chuyen_chay = ?,
           don_gia_chuyen = ?, so_km_odometer = ?, ghi_chu = ?
       WHERE id = ?`,
      [
        vehId,
        driverId,
        id_cong_trinh || null,
        lit,
        distance,
        parseInt(so_chuyen_chay) || 1,
        parseFloat(don_gia_chuyen) || 0,
        odoVal,
        ghi_chu || null,
        id
      ]
    );

    // Save multi-file attachments into files table
    await saveUploadedFiles(connection, 'nhat_ky_nhien_lieu', id, req.files, req.user.ten_dang_nhap);

    const [newRows] = await connection.query('SELECT * FROM nhat_ky_nhien_lieu WHERE id = ?', [id]);
    const [fuelWithFiles] = await attachFilesToRecords(connection, 'nhat_ky_nhien_lieu', newRows);

    await logChange(connection, 'nhat_ky_nhien_lieu', id, 'CAP_NHAT', oldRow[0], fuelWithFiles, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json(fuelWithFiles);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật nhật ký nhiên liệu.' });
  } finally {
    connection.release();
  }
};
router.put('/nhat-ky-nhien-lieu/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), upload.any(), updateFuelLog);
router.put('/nhat-ky-xang-dau/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), upload.any(), updateFuelLog);

// 4c. Delete Fuel Log Entry
const deleteFuelLog = async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM nhat_ky_nhien_lieu WHERE id = ?', [id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy nhật ký nhiên liệu.' });
    }

    // Delete associated files from files table and disk
    const [attachedFiles] = await connection.query('SELECT * FROM files WHERE ten_bang = "nhat_ky_nhien_lieu" AND id_ban_ghi = ?', [id]);
    for (const f of attachedFiles) {
      const filePath = path.join(__dirname, '../../', f.duong_dan);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }
    await connection.query('DELETE FROM files WHERE ten_bang = "nhat_ky_nhien_lieu" AND id_ban_ghi = ?', [id]);

    await connection.query('DELETE FROM nhat_ky_nhien_lieu WHERE id = ?', [id]);
    await logChange(connection, 'nhat_ky_nhien_lieu', id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: 'Xóa nhật ký nhiên liệu thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa nhật ký nhiên liệu.' });
  } finally {
    connection.release();
  }
};
router.delete('/nhat-ky-nhien-lieu/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), deleteFuelLog);
router.delete('/nhat-ky-xang-dau/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu', 'Ke_Toan']), deleteFuelLog);

// 5. Fuel Report
const getFuelReport = async (req, res) => {
  const { id_phuong_tien_xe, tu_ngay, den_ngay } = req.query;
  try {
    let sql = `
      SELECT n.*, DATE_FORMAT(n.ngay_ghi_nhan, '%Y-%m-%d') as ngay_ghi_nhan, p.bien_so_xe, p.loai_xe, nc.ho_ten as tai_xe_ten, c.ten_cong_trinh
      FROM nhat_ky_nhien_lieu n
      JOIN phuong_tien p ON n.id_phuong_tien = p.id
      JOIN nhan_cong nc ON n.id_nhan_cong = nc.id
      LEFT JOIN cong_trinh c ON n.id_cong_trinh = c.id
      WHERE 1=1
    `;
    const params = [];
    if (id_phuong_tien_xe && id_phuong_tien_xe !== 'all') {
      sql += ' AND n.id_phuong_tien = ?';
      params.push(id_phuong_tien_xe);
    }
    if (tu_ngay) {
      sql += ' AND n.ngay_ghi_nhan >= ?';
      params.push(tu_ngay);
    }
    if (den_ngay) {
      sql += ' AND n.ngay_ghi_nhan <= ?';
      params.push(den_ngay);
    }
    sql += ' ORDER BY n.ngay_ghi_nhan ASC';

    const [logsRaw] = await pool.query(sql, params);
    const logs = await attachFilesToRecords(pool, 'nhat_ky_nhien_lieu', logsRaw);
    return res.json({ tu_ngay, den_ngay, logs });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi lập báo cáo xăng dầu.' });
  }
};
router.get('/bao-cao-xang-dau', authMiddleware, getFuelReport);

// 6. Generic File Removal Endpoint
router.delete('/files/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query('SELECT * FROM files WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy tập tin.' });
    }
    const fileRecord = rows[0];
    
    // Delete file from disk if exists
    const filePath = path.join(__dirname, '../../', fileRecord.duong_dan);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) {}
    }

    await pool.query('DELETE FROM files WHERE id = ?', [id]);
    return res.json({ message: 'Xóa tập tin thành công.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xóa tập tin.' });
  }
});

module.exports = router;
