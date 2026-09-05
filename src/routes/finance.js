const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');
const { generateSequenceNumber } = require('../services/sequenceService');

const uploadsDir = path.join(__dirname, '../../public/uploads/thu_chi');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'ptc-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage });

const logoUploadsDir = path.join(__dirname, '../../public/uploads/logos');
if (!fs.existsSync(logoUploadsDir)) {
  fs.mkdirSync(logoUploadsDir, { recursive: true });
}

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, logoUploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, 'logo-' + uniqueSuffix + ext);
  }
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Helper to save files to `files` table
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

    const duongDan = `/public/uploads/thu_chi/${savedName}`;
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

  const [files] = await poolOrConn.query(
    `SELECT * FROM files WHERE ten_bang = ? AND id_ban_ghi IN (?) ORDER BY id ASC`,
    [ten_bang, ids]
  );

  const filesByRecordId = {};
  for (const f of files) {
    if (!filesByRecordId[f.id_ban_ghi]) {
      filesByRecordId[f.id_ban_ghi] = [];
    }
    filesByRecordId[f.id_ban_ghi].push(f);
  }

  for (const r of records) {
    r.files = filesByRecordId[r.id] || [];
  }
  return records;
}

// Recalculate subcontractor paid total
async function recalculateSubcontractorPaid(connection, id_nha_thau_phu) {
  const [sumRow] = await connection.query(
    'SELECT SUM(so_tien_thanh_toan) as total_paid FROM thanh_toan_thau_phu WHERE id_nha_thau_phu = ?',
    [id_nha_thau_phu]
  );
  const totalPaid = parseFloat(sumRow[0].total_paid) || 0;

  const [parent] = await connection.query('SELECT gia_tri_hop_dong FROM nha_thau_phu WHERE id = ?', [
    id_nha_thau_phu
  ]);
  if (parent.length > 0) {
    const contractVal = parseFloat(parent[0].gia_tri_hop_dong) || 0;
    const remaining = contractVal - totalPaid;

    await connection.query(
      'UPDATE nha_thau_phu SET da_thanh_toan = ?, cong_no_con_lai = ? WHERE id = ?',
      [totalPaid, remaining, id_nha_thau_phu]
    );
  }
}

// Recalculate machinery paid total
async function recalculateMachineryPaid(connection, id_ca_may_thue) {
  const [sumRow] = await connection.query(
    'SELECT SUM(so_tien_thanh_toan) as total_paid FROM thanh_toan_ca_may WHERE id_ca_may_thue = ?',
    [id_ca_may_thue]
  );
  const totalPaid = parseFloat(sumRow[0].total_paid) || 0;

  const [parent] = await connection.query('SELECT tong_tien FROM ca_may_thue WHERE id = ?', [
    id_ca_may_thue
  ]);
  if (parent.length > 0) {
    const totalCost = parseFloat(parent[0].tong_tien) || 0;
    const remaining = totalCost - totalPaid;

    await connection.query(
      'UPDATE ca_may_thue SET da_thanh_toan = ?, cong_no_con_lai = ? WHERE id = ?',
      [totalPaid, remaining, id_ca_may_thue]
    );
  }
}

// Recalculate machinery shifts total and update main machinery cost
async function recalculateMachineryShifts(connection, id_ca_may_thue) {
  const [sumRow] = await connection.query(
    'SELECT SUM(so_ca) as total_shifts FROM ca_may_thue_lich_su WHERE id_ca_may_thue = ?',
    [id_ca_may_thue]
  );
  const totalShifts = parseFloat(sumRow[0].total_shifts) || 0;

  const [parent] = await connection.query('SELECT don_gia_ca_may, da_thanh_toan FROM ca_may_thue WHERE id = ?', [
    id_ca_may_thue
  ]);
  if (parent.length > 0) {
    const unitPrice = parseFloat(parent[0].don_gia_ca_may) || 0;
    const paid = parseFloat(parent[0].da_thanh_toan) || 0;
    const totalCost = totalShifts * unitPrice;
    const remaining = totalCost - paid;

    await connection.query(
      'UPDATE ca_may_thue SET so_ca_lam_viec = ?, tong_tien = ?, cong_no_con_lai = ? WHERE id = ?',
      [totalShifts, totalCost, remaining, id_ca_may_thue]
    );
  }
}

// Recalculate project other cost paid total
async function recalculateOtherCostPaid(connection, id_ctr_chi_phi_khac) {
  const [sumRow] = await connection.query(
    'SELECT SUM(so_tien_thanh_toan) as total_paid FROM ctr_chi_phi_khac_thanh_toan WHERE id_ctr_chi_phi_khac = ?',
    [id_ctr_chi_phi_khac]
  );
  const totalPaid = parseFloat(sumRow[0].total_paid) || 0;

  const [parent] = await connection.query('SELECT tong_tien FROM ctr_chi_phi_khac WHERE id = ?', [
    id_ctr_chi_phi_khac
  ]);
  if (parent.length > 0) {
    const totalCost = parseFloat(parent[0].tong_tien) || 0;
    let remaining = 0;
    if (totalCost > 0) {
      remaining = Math.max(0, totalCost - totalPaid);
    }

    await connection.query(
      'UPDATE ctr_chi_phi_khac SET da_thanh_toan = ?, cong_no_con_lai = ? WHERE id = ?',
      [totalPaid, remaining, id_ctr_chi_phi_khac]
    );
  }
}

// Helper function for Phieu Thu Chi Sequence
async function getNextPhieuThuChiSequence(connection, id_linh_vuc_kinh_doanh, loai_phieu, nam) {
  const docType = loai_phieu === 'Phieu_Thu' ? 'PT' : 'PC';
  return await generateSequenceNumber(connection, {
    id_linh_vuc_kinh_doanh,
    loai_chung_tu: docType,
    nam
  });
}

// ==========================================
// Helper functions for Order Recalculation
// ==========================================
async function recalculateOrderPayment(connection, id_don_hang) {
  if (!id_don_hang) return;
  // Get sum of cleared payments from phieu_thu_chi
  const [payResult] = await connection.query(
    `SELECT COALESCE(SUM(so_tien), 0) AS total_paid 
     FROM phieu_thu_chi 
     WHERE id_chung_tu = ? AND loai_chung_tu_lien_ket = 'don_hang' AND loai_phieu = 'Phieu_Thu' AND COALESCE(da_xoa, 0) = 0`,
    [id_don_hang]
  );
  const totalPaid = parseFloat(payResult[0].total_paid) || 0;

  // Get order total price
  const [orderResult] = await connection.query(
    'SELECT tong_tien FROM don_hang WHERE id = ?',
    [id_don_hang]
  );
  if (orderResult.length === 0) return;
  const totalPrice = parseFloat(orderResult[0].tong_tien) || 0;

  const remaining = Math.max(0, totalPrice - totalPaid);
  const paymentStatus = totalPaid >= totalPrice ? 'đã thanh toán' : (totalPaid > 0 ? 'thanh toán một phần' : 'chưa thanh toán');

  await connection.query(
    `UPDATE don_hang 
     SET so_tien_da_thanh_toan = ?, so_tien_con_lai = ?, trang_thai_thanh_toan = ? 
     WHERE id = ?`,
    [totalPaid, remaining, paymentStatus, id_don_hang]
  );
  console.log(`Recalculated order ${id_don_hang} payment: paid=${totalPaid}, remaining=${remaining}, status=${paymentStatus}`);
}

// ==========================================
// 1. PHIẾU THU / PHIẾU CHI & SỔ QUỸ ENDPOINTS
// ==========================================

// Get distinct recording years for phieu_thu_chi
router.get('/phieu-thu-chi/years', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT COALESCE(nam, YEAR(ngay_chung_tu), YEAR(thoi_gian_tao)) AS year
       FROM phieu_thu_chi
       WHERE COALESCE(da_xoa, 0) = 0 AND (nam IS NOT NULL OR ngay_chung_tu IS NOT NULL OR thoi_gian_tao IS NOT NULL)
       ORDER BY year DESC`
    );
    const currentYear = new Date().getFullYear();
    const dbYears = rows.map(r => parseInt(r.year, 10)).filter(y => !isNaN(y) && y > 1900);
    const uniqueYears = Array.from(new Set([currentYear, currentYear - 1, ...dbYears])).sort((a, b) => b - a);
    return res.json(uniqueYears);
  } catch (err) {
    console.error('Error fetching phieu_thu_chi years:', err);
    return res.status(500).json({ message: 'Lỗi lấy danh sách năm vào sổ thu chi.' });
  }
});

// Get pending purchase orders for payment (POs with unpaid balance)
router.get('/pending-purchase-orders', authMiddleware, async (req, res) => {
  try {
    const { id_linh_vuc_kinh_doanh } = req.query;
    let sql = `
      SELECT p.id, p.ma_phieu_mua, p.id_linh_vuc_kinh_doanh, p.id_nha_cung_cap, p.ten_nha_cung_cap,
             p.ngay_mua, p.tong_tien,
             COALESCE(p.da_thanh_toan, 0) AS da_thanh_toan,
             (p.tong_tien - COALESCE(p.da_thanh_toan, 0)) AS con_lai,
             p.trang_thai_thanh_toan,
             ncc.ten_nha_cung_cap AS ncc_ten, ncc.so_dien_thoai AS ncc_sdt, ncc.dia_chi AS ncc_dia_chi,
             l.ten_lvkd, l.ma_lvkd
      FROM phieu_mua_hang p
      LEFT JOIN nha_cung_cap ncc ON p.id_nha_cung_cap = ncc.id
      LEFT JOIN linh_vuc_kinh_doanh l ON p.id_linh_vuc_kinh_doanh = l.id
      WHERE (p.da_thanh_toan < p.tong_tien OR p.da_thanh_toan IS NULL)
    `;
    const params = [];
    if (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') {
      sql += ' AND p.id_linh_vuc_kinh_doanh = ?';
      params.push(id_linh_vuc_kinh_doanh);
    }
    sql += ' ORDER BY p.id DESC LIMIT 100';
    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching pending POs for payment:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách phiếu mua hàng chờ thanh toán.' });
  }
});

// Get pending sales orders for receipt (Orders with unpaid balance)
router.get('/pending-sales-orders', authMiddleware, async (req, res) => {
  try {
    const { id_linh_vuc_kinh_doanh } = req.query;
    let sql = `
      SELECT d.id, d.ma_don_hang, d.id_lvkd, d.id_khach_hang,
             COALESCE(kh.ten_khach_hang, 'Khách lẻ') AS ten_khach_hang,
             d.thoi_gian_tao, d.tong_tien,
             COALESCE(d.so_tien_da_thanh_toan, 0) AS da_thanh_toan,
             COALESCE(d.so_tien_con_lai, d.tong_tien - COALESCE(d.so_tien_da_thanh_toan, 0)) AS con_lai,
             d.trang_thai_thanh_toan,
             kh.ten_khach_hang AS kh_ten, kh.so_dien_thoai AS kh_sdt, kh.dia_chi AS kh_dia_chi,
             l.ten_lvkd, l.ma_lvkd
      FROM don_hang d
      LEFT JOIN khach_hang kh ON d.id_khach_hang = kh.id
      LEFT JOIN linh_vuc_kinh_doanh l ON d.id_lvkd = l.id
      WHERE (d.so_tien_con_lai > 0 OR d.so_tien_da_thanh_toan < d.tong_tien OR d.so_tien_da_thanh_toan IS NULL)
        AND d.trang_thai_don_hang = 'da_ghi_so'
    `;
    const params = [];
    if (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') {
      sql += ' AND d.id_lvkd = ?';
      params.push(id_linh_vuc_kinh_doanh);
    }
    sql += ' ORDER BY d.id DESC LIMIT 100';
    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching pending sales orders for receipt:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách đơn bán hàng chờ thu tiền.' });
  }
});

// Helper endpoint to get pending Contracts for receipt collection
router.get('/pending-contracts', authMiddleware, async (req, res) => {
  try {
    const { id_linh_vuc_kinh_doanh } = req.query;
    let sql = `
      SELECT h.id, h.ma_hop_dong, h.ten_hop_dong, h.id_linh_vuc_kinh_doanh, h.id_khach_hang, h.id_cong_trinh,
             h.ngay_ky, h.gia_tri_hop_dong,
             COALESCE(h.da_thanh_toan, 0) AS da_thanh_toan,
             COALESCE(h.con_lai, h.gia_tri_hop_dong - COALESCE(h.da_thanh_toan, 0)) AS con_lai,
             h.trang_thai,
             kh.ten_khach_hang AS kh_ten, kh.so_dien_thoai AS kh_sdt, kh.dia_chi AS kh_dia_chi,
             c.ten_cong_trinh,
             l.ten_lvkd, l.ma_lvkd
      FROM hop_dong h
      LEFT JOIN khach_hang kh ON h.id_khach_hang = kh.id
      LEFT JOIN cong_trinh c ON h.id_cong_trinh = c.id
      LEFT JOIN linh_vuc_kinh_doanh l ON h.id_linh_vuc_kinh_doanh = l.id
      WHERE (h.con_lai > 0 OR h.da_thanh_toan < h.gia_tri_hop_dong OR h.da_thanh_toan IS NULL)
        AND h.da_xoa = 0
    `;
    const params = [];
    if (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') {
      sql += ' AND h.id_linh_vuc_kinh_doanh = ?';
      params.push(id_linh_vuc_kinh_doanh);
    }
    sql += ' ORDER BY h.id DESC LIMIT 100';
    const [rows] = await pool.query(sql, params);

    // Also attach payment terms for each contract
    for (const r of rows) {
      const [terms] = await pool.query(
        'SELECT * FROM hop_dong_dot_thanh_toan WHERE id_hop_dong = ? ORDER BY id ASC',
        [r.id]
      );
      r.payment_terms = terms;
    }

    return res.json(rows);
  } catch (err) {
    console.error('Error fetching pending contracts for receipt:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách hợp đồng chờ thu tiền.' });
  }
});

// Get paginated and filtered phieu_thu_chi list
router.get('/phieu-thu-chi', authMiddleware, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      nam,
      loai_phieu,
      loai_thu_chi,
      id_quy_tien,
      id_linh_vuc_kinh_doanh,
      loai_chung_tu_lien_ket,
      search
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE COALESCE(ptc.da_xoa, 0) = 0';
    const params = [];

    if (nam) {
      whereClause += ' AND (ptc.nam = ? OR (ptc.nam IS NULL AND YEAR(ptc.ngay_chung_tu) = ?))';
      params.push(nam, nam);
    }

    if (loai_phieu && loai_phieu !== 'all') {
      whereClause += ' AND ptc.loai_phieu = ?';
      params.push(loai_phieu);
    }

    if (loai_thu_chi && loai_thu_chi !== 'all') {
      whereClause += ' AND ptc.loai_thu_chi = ?';
      params.push(loai_thu_chi);
    }

    if (id_quy_tien && id_quy_tien !== 'all') {
      whereClause += ' AND ptc.id_quy_tien = ?';
      params.push(id_quy_tien);
    }

    if (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') {
      whereClause += ' AND ptc.id_linh_vuc_kinh_doanh = ?';
      params.push(id_linh_vuc_kinh_doanh);
    }

    if (loai_chung_tu_lien_ket && loai_chung_tu_lien_ket !== 'all') {
      whereClause += ' AND ptc.loai_chung_tu_lien_ket = ?';
      params.push(loai_chung_tu_lien_ket);
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      whereClause += ` AND (
        ptc.ma_phieu LIKE ? OR
        ptc.ten_doi_tuong LIKE ? OR
        ptc.ma_chung_tu LIKE ? OR
        ptc.nguoi_nop_nhan LIKE ? OR
        ptc.ly_do_thu_chi LIKE ? OR
        ptc.kem_theo_chung_tu_goc LIKE ? OR
        q.ten_quy LIKE ?
      )`;
      params.push(term, term, term, term, term, term, term);
    }

    // Summary calculation (Tong thu, Tong chi, Ton quy)
    const summarySql = `
      SELECT
        COALESCE(SUM(CASE WHEN ptc.loai_phieu = 'Phieu_Thu' THEN ptc.so_tien ELSE 0 END), 0) AS tong_thu,
        COALESCE(SUM(CASE WHEN ptc.loai_phieu = 'Phieu_Chi' THEN ptc.so_tien ELSE 0 END), 0) AS tong_chi
      FROM phieu_thu_chi ptc
      LEFT JOIN quy_tien q ON ptc.id_quy_tien = q.id
      LEFT JOIN linh_vuc_kinh_doanh l ON ptc.id_linh_vuc_kinh_doanh = l.id
      ${whereClause}
    `;
    const [summaryRows] = await pool.query(summarySql, params);
    const tongThu = parseFloat(summaryRows[0]?.tong_thu || 0);
    const tongChi = parseFloat(summaryRows[0]?.tong_chi || 0);
    const tonQuy = tongThu - tongChi;

    // Count total query
    const countSql = `
      SELECT COUNT(*) AS total
      FROM phieu_thu_chi ptc
      LEFT JOIN quy_tien q ON ptc.id_quy_tien = q.id
      LEFT JOIN linh_vuc_kinh_doanh l ON ptc.id_linh_vuc_kinh_doanh = l.id
      ${whereClause}
    `;
    const [countResult] = await pool.query(countSql, params);
    const total = countResult[0]?.total || 0;

    // Data query with joins
    const dataSql = `
      SELECT ptc.*,
             q.ten_quy, q.ma_quy, q.loai_quy,
             l.ten_lvkd, l.ma_lvkd, l.ten_cong_ty, l.dia_chi AS dia_chi_cong_ty, l.dien_thoai AS sdt_cong_ty, l.logo_url AS logo_lvkd, l.ma_so_thue AS mst_cong_ty
      FROM phieu_thu_chi ptc
      LEFT JOIN quy_tien q ON ptc.id_quy_tien = q.id
      LEFT JOIN linh_vuc_kinh_doanh l ON ptc.id_linh_vuc_kinh_doanh = l.id
      ${whereClause}
      ORDER BY ptc.id DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(dataSql, [...params, limitNum, offset]);
    await attachFilesToRecords(pool, 'phieu_thu_chi', rows);

    return res.json({
      data: rows,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      summary: {
        tong_thu: tongThu,
        tong_chi: tongChi,
        ton_quy: tonQuy
      }
    });
  } catch (err) {
    console.error('Error fetching phieu_thu_chi list:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách phiếu thu chi.' });
  }
});

// GET Statistics / Summary of phieu_thu_chi
router.get('/phieu-thu-chi/summary', authMiddleware, async (req, res) => {
  try {
    const { year, id_lvkd, id_quy_tien } = req.query;
    let sql = `
      SELECT 
        COALESCE(SUM(CASE WHEN loai_phieu = 'Phieu_Thu' THEN so_tien ELSE 0 END), 0) AS total_thu,
        COALESCE(SUM(CASE WHEN loai_phieu = 'Phieu_Chi' THEN so_tien ELSE 0 END), 0) AS total_chi,
        COUNT(CASE WHEN loai_phieu = 'Phieu_Thu' THEN 1 END) AS count_thu,
        COUNT(CASE WHEN loai_phieu = 'Phieu_Chi' THEN 1 END) AS count_chi
      FROM phieu_thu_chi
      WHERE COALESCE(da_xoa, 0) = 0
    `;
    const params = [];

    if (year && year !== 'all') {
      sql += ` AND (nam = ? OR YEAR(ngay_chung_tu) = ?)`;
      params.push(year, year);
    }

    if (id_lvkd && id_lvkd !== 'all') {
      sql += ` AND id_linh_vuc_kinh_doanh = ?`;
      params.push(id_lvkd);
    }

    if (id_quy_tien && id_quy_tien !== 'all') {
      sql += ` AND id_quy_tien = ?`;
      params.push(id_quy_tien);
    }

    const [rows] = await pool.query(sql, params);
    const summary = rows[0];
    summary.balance = parseFloat(summary.total_thu) - parseFloat(summary.total_chi);

    return res.json(summary);
  } catch (err) {
    console.error('Error fetching phieu_thu_chi summary:', err);
    return res.status(500).json({ message: 'Lỗi khi tính toán tổng quan sổ quỹ.' });
  }
});

// GET Next available so_vao_so and ma_phieu preview
router.get('/phieu-thu-chi/next-code', authMiddleware, async (req, res) => {
  try {
    const { id_lvkd, loai_phieu, year } = req.query;
    if (!id_lvkd || !loai_phieu) {
      return res.status(400).json({ message: 'Thiếu id_lvkd hoặc loai_phieu.' });
    }
    const currentYear = year ? parseInt(year) : new Date().getFullYear();
    const conn = await pool.getConnection();
    try {
      const seq = await getNextPhieuThuChiSequence(conn, id_lvkd, loai_phieu, currentYear);
      return res.json(seq);
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('Error generating next code:', err);
    return res.status(500).json({ message: 'Lỗi khi tạo mã phiếu thu chi.' });
  }
});

// GET Single phieu_thu_chi by ID with attached files
router.get('/phieu-thu-chi/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ptc.*, 
              l.ten_lvkd, l.ma_lvkd, l.ten_cong_ty, l.dia_chi as dia_chi_cong_ty, l.dien_thoai as sdt_cong_ty, l.ma_so_thue as mst_cong_ty, l.logo_url as logo_lvkd,
              q.ten_quy, q.ma_quy, q.loai_quy
       FROM phieu_thu_chi ptc
       LEFT JOIN linh_vuc_kinh_doanh l ON ptc.id_linh_vuc_kinh_doanh = l.id
       LEFT JOIN quy_tien q ON ptc.id_quy_tien = q.id
       WHERE ptc.id = ? AND COALESCE(ptc.da_xoa, 0) = 0`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu thu chi.' });
    }

    const voucher = rows[0];
    const [files] = await pool.query(
      `SELECT id, duong_dan_tap_tin, ten_tap_tin, loai_tap_tin, dung_luong, thoi_gian_tai_len
       FROM files
       WHERE ten_bang = 'phieu_thu_chi' AND id_ban_ghi = ?
       ORDER BY id ASC`,
      [voucher.id]
    );
    voucher.files = files;

    return res.json(voucher);
  } catch (err) {
    console.error('Error fetching phieu_thu_chi details:', err);
    return res.status(500).json({ message: 'Lỗi khi lấy chi tiết phiếu thu chi.' });
  }
});

// POST Create new phieu_thu_chi
router.post('/phieu-thu-chi', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc', 'Admin', 'Kinh_Doanh', 'Vat_Tu']), upload.array('files'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      id_linh_vuc_kinh_doanh,
      loai_phieu, // 'Phieu_Thu' | 'Phieu_Chi'
      loai_thu_chi,
      loai_chung_tu_lien_ket = 'khac',
      id_chung_tu = null,
      ma_chung_tu = null,
      loai_doi_tuong = 'khac',
      id_doi_tuong = null,
      ten_doi_tuong,
      dia_chi_doi_tuong = null,
      sdt_doi_tuong = null,
      id_quy_tien,
      hinh_thuc_thanh_toan = 'Tien_Mat',
      so_tien,
      ngay_chung_tu,
      nguoi_nop_nhan = null,
      ly_do_thu_chi,
      kem_theo_chung_tu_goc = null,
      trang_thai = 'đã thanh toán',
      ghi_chu = null
    } = req.body;

    if (!id_linh_vuc_kinh_doanh || !loai_phieu || !ten_doi_tuong || !id_quy_tien || !so_tien || !ly_do_thu_chi) {
      connection.release();
      return res.status(400).json({ message: 'Vui lòng điền đầy đủ các thông tin bắt buộc (*).' });
    }

    const amount = parseFloat(so_tien);
    if (isNaN(amount) || amount <= 0) {
      connection.release();
      return res.status(400).json({ message: 'Số tiền phải lớn hơn 0.' });
    }

    const voucherYear = ngay_chung_tu ? new Date(ngay_chung_tu).getFullYear() : new Date().getFullYear();
    const seq = await getNextPhieuThuChiSequence(connection, id_linh_vuc_kinh_doanh, loai_phieu, voucherYear);

    const [ptcResult] = await connection.query(
      `INSERT INTO phieu_thu_chi (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
        loai_chung_tu_lien_ket, id_chung_tu, ma_chung_tu,
        loai_doi_tuong, id_doi_tuong, ten_doi_tuong, dia_chi_doi_tuong, sdt_doi_tuong,
        id_quy_tien, hinh_thuc_thanh_toan, so_tien, ngay_chung_tu, nguoi_nop_nhan,
        ly_do_thu_chi, kem_theo_chung_tu_goc, trang_thai, ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seq.ma_phieu,
        seq.so_vao_so,
        voucherYear,
        id_linh_vuc_kinh_doanh,
        loai_phieu,
        loai_thu_chi || (loai_phieu === 'Phieu_Thu' ? 'thu_khac' : 'chi_khac'),
        loai_chung_tu_lien_ket,
        id_chung_tu ? parseInt(id_chung_tu) : null,
        ma_chung_tu || null,
        loai_doi_tuong,
        id_doi_tuong ? parseInt(id_doi_tuong) : null,
        ten_doi_tuong,
        dia_chi_doi_tuong || null,
        sdt_doi_tuong || null,
        id_quy_tien,
        hinh_thuc_thanh_toan,
        amount,
        ngay_chung_tu || new Date(),
        nguoi_nop_nhan || null,
        ly_do_thu_chi,
        kem_theo_chung_tu_goc || null,
        trang_thai,
        ghi_chu || null,
        req.user?.ten_dang_nhap || 'system'
      ]
    );

    const ptcId = ptcResult.insertId;

    // Lưu các file đính kèm vào bảng `files` (ten_bang = 'phieu_thu_chi')
    const savedFiles = await saveUploadedFiles(connection, 'phieu_thu_chi', ptcId, req.files, req.user?.ten_dang_nhap || 'system');

    // If linked to PO (phieu_mua_hang), update PO paid amount
    if (loai_chung_tu_lien_ket === 'phieu_mua_hang' && id_chung_tu) {
      const [poRows] = await connection.query('SELECT tong_tien, da_thanh_toan FROM phieu_mua_hang WHERE id = ?', [id_chung_tu]);
      if (poRows.length > 0) {
        const totalPO = parseFloat(poRows[0].tong_tien) || 0;
        const currentPaid = parseFloat(poRows[0].da_thanh_toan) || 0;
        const newPaid = currentPaid + amount;
        const remaining = Math.max(0, totalPO - newPaid);
        const payStatus = newPaid >= totalPO ? 'Đã thanh toán' : (newPaid > 0 ? 'Thanh toán một phần' : 'Chưa thanh toán');

        await connection.query(
          `UPDATE phieu_mua_hang SET da_thanh_toan = ?, con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?`,
          [newPaid, remaining, payStatus, id_chung_tu]
        );
      }
    }

    // If linked to Sales Order (don_hang), update Order paid amount
    if (loai_chung_tu_lien_ket === 'don_hang' && id_chung_tu) {
        await recalculateOrderPayment(connection, id_chung_tu);
    }

    const [newRow] = await connection.query('SELECT * FROM phieu_thu_chi WHERE id = ?', [ptcId]);
    await logChange(connection, 'phieu_thu_chi', ptcId, 'THEM_MOI', null, newRow[0], req.user?.ten_dang_nhap || 'system');

    await connection.commit();
    return res.status(201).json({
      message: `Tạo ${loai_phieu === 'Phieu_Thu' ? 'Phiếu Thu' : 'Phiếu Chi'} thành công!`,
      id: ptcId,
      ma_phieu: seq.ma_phieu,
      so_vao_so: seq.so_vao_so,
      files: savedFiles
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating phieu_thu_chi:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi tạo phiếu thu chi.' });
  } finally {
    connection.release();
  }
});

// POST Attach additional files to an existing phieu_thu_chi
router.post('/phieu-thu-chi/:id/files', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc', 'Admin', 'Kinh_Doanh', 'Vat_Tu']), upload.array('files'), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const voucherId = req.params.id;
    const [rows] = await connection.query('SELECT id, ma_phieu FROM phieu_thu_chi WHERE id = ? AND COALESCE(da_xoa, 0) = 0', [voucherId]);
    if (rows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu thu chi.' });
    }

    const savedFiles = await saveUploadedFiles(connection, 'phieu_thu_chi', voucherId, req.files, req.user?.ten_dang_nhap || 'system');
    await connection.commit();
    return res.status(201).json({
      message: 'Đã đính kèm file thành công!',
      files: savedFiles
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error attaching files to phieu_thu_chi:', err);
    return res.status(500).json({ message: 'Lỗi khi tải file đính kèm: ' + err.message });
  } finally {
    connection.release();
  }
});

// DELETE Attached file from phieu_thu_chi
router.delete('/phieu-thu-chi/:id/files/:fileId', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { id, fileId } = req.params;
    const [files] = await connection.query(
      'SELECT * FROM files WHERE id = ? AND ten_bang = ? AND id_ban_ghi = ?',
      [fileId, 'phieu_thu_chi', id]
    );
    if (files.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy file đính kèm.' });
    }

    const f = files[0];
    await connection.query('DELETE FROM files WHERE id = ?', [fileId]);

    if (f.ten_file_luu) {
      const filePath = path.join(uploadsDir, f.ten_file_luu);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { console.error('Failed to unlink file:', e); }
      }
    }

    await connection.commit();
    return res.json({ message: 'Đã xóa file đính kèm thành công!' });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting file for phieu_thu_chi:', err);
    return res.status(500).json({ message: 'Lỗi khi xóa file đính kèm: ' + err.message });
  } finally {
    connection.release();
  }
});

// DELETE (Soft delete) phieu_thu_chi
router.delete('/phieu-thu-chi/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.query('SELECT * FROM phieu_thu_chi WHERE id = ? AND COALESCE(da_xoa, 0) = 0 FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy phiếu thu chi cần xóa.' });
    }

    const ptc = rows[0];
    const amount = parseFloat(ptc.so_tien) || 0;

    // 1. Kiểm tra liên kết với Đề nghị thanh toán (ĐNTT)
    try {
      const [linkedDntt] = await connection.query(
        'SELECT id, ma_phieu FROM de_nghi_thanh_toan WHERE (id_phieu_thu_chi = ? OR (id_chung_tu_goc = ? AND loai_chung_tu_goc = "phieu_thu_chi")) AND COALESCE(da_xoa, 0) = 0',
        [ptc.id, ptc.id]
      );
      if (linkedDntt.length > 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          message: `Không thể xóa phiếu chi "${ptc.ma_phieu}" vì được tạo tự động từ Đề nghị thanh toán (${linkedDntt.map(d => d.ma_phieu).join(', ')}). Vui lòng hủy/xử lý từ phân hệ Đề nghị thanh toán!`
        });
      }
    } catch (e) {}

    // 2. Kiểm tra liên kết với cấn trừ/gạch nợ khách hàng
    try {
      const [gachKh] = await connection.query(
        'SELECT COUNT(*) as cnt FROM chi_tiet_gach_no_khach_hang WHERE id_phieu_thu_chi = ?',
        [ptc.id]
      );
      if (gachKh[0]?.cnt > 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          message: `Không thể xóa phiếu thu "${ptc.ma_phieu}" vì đã cấn trừ/gạch nợ cho ${gachKh[0].cnt} đơn hàng của khách hàng. Vui lòng kiểm tra lại công nợ!`
        });
      }
    } catch (e) {}

    // 3. Kiểm tra liên kết với cấn trừ/gạch nợ nhà cung cấp
    try {
      const [gachNcc] = await connection.query(
        'SELECT COUNT(*) as cnt FROM chi_tiet_gach_no_ncc WHERE id_phieu_thu_chi = ?',
        [ptc.id]
      );
      if (gachNcc[0]?.cnt > 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          message: `Không thể xóa phiếu chi "${ptc.ma_phieu}" vì đã cấn trừ/gạch nợ cho ${gachNcc[0].cnt} đơn mua hàng của NCC. Vui lòng kiểm tra lại công nợ!`
        });
      }
    } catch (e) {}

    // 4. Kiểm tra liên kết với đợt thanh toán hợp đồng
    try {
      const [dotHd] = await connection.query(
        'SELECT id, ten_dot FROM hop_dong_dot_thanh_toan WHERE id_phieu_thu_chi = ?',
        [ptc.id]
      );
      if (dotHd.length > 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          message: `Không thể xóa phiếu thu "${ptc.ma_phieu}" vì đã liên kết với đợt thanh toán hợp đồng (${dotHd.map(d => d.ten_dot).join(', ')}). Vui lòng hủy thanh toán đợt hợp đồng trước!`
        });
      }
    } catch (e) {}

    // Rollback linked PO paid amount if any
    if (ptc.loai_chung_tu_lien_ket === 'phieu_mua_hang' && ptc.id_chung_tu) {
      const [poRows] = await connection.query('SELECT tong_tien, da_thanh_toan FROM phieu_mua_hang WHERE id = ?', [ptc.id_chung_tu]);
      if (poRows.length > 0) {
        const totalPO = parseFloat(poRows[0].tong_tien) || 0;
        const currentPaid = parseFloat(poRows[0].da_thanh_toan) || 0;
        const newPaid = Math.max(0, currentPaid - amount);
        const remaining = Math.max(0, totalPO - newPaid);
        const payStatus = newPaid >= totalPO ? 'Đã thanh toán' : (newPaid > 0 ? 'Thanh toán một phần' : 'Chưa thanh toán');

        await connection.query(
          `UPDATE phieu_mua_hang SET da_thanh_toan = ?, con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?`,
          [newPaid, remaining, payStatus, ptc.id_chung_tu]
        );
      }
    }

    // Rollback linked Order paid amount if any
    if (ptc.loai_chung_tu_lien_ket === 'don_hang' && ptc.id_chung_tu) {
      await recalculateOrderPayment(connection, ptc.id_chung_tu);
    }

    // Soft delete
    await connection.query('UPDATE phieu_thu_chi SET da_xoa = 1, trang_thai = "đã hủy" WHERE id = ?', [ptc.id]);
    await logChange(connection, 'phieu_thu_chi', ptc.id, 'XOA', ptc, { da_xoa: 1 }, req.user?.ten_dang_nhap || 'system');

    await connection.commit();
    return res.json({ message: `Đã xóa phiếu thu/chi "${ptc.ma_phieu}" thành công.` });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting phieu_thu_chi:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi xóa phiếu thu chi.' });
  } finally {
    connection.release();
  }
});

// Sổ quỹ endpoints (Querying from phieu_thu_chi)
router.get('/so-quy', authMiddleware, async (req, res) => {
  try {
    const { id_lvkd, limit } = req.query;
    let sql = `SELECT ptc.id, ptc.ma_phieu as ma_giao_dich, 
                      CASE WHEN ptc.loai_phieu = 'Phieu_Thu' THEN 'Thu' ELSE 'Chi' END as loai_giao_dich,
                      ptc.so_tien, ptc.ngay_chung_tu as ngay_giao_dich, ptc.hinh_thuc_thanh_toan,
                      ptc.loai_thu_chi as danh_muc_thu_chi, ptc.id_quy_tien, ptc.trang_thai, ptc.ly_do_thu_chi as mo_ta,
                      ptc.ten_doi_tuong, ptc.nguoi_tao, ptc.thoi_gian_tao,
                      q.ten_quy as quy_ten, q.ten_quy,
                      l.ten_lvkd, l.ma_lvkd
               FROM phieu_thu_chi ptc
               LEFT JOIN quy_tien q ON ptc.id_quy_tien = q.id
               LEFT JOIN linh_vuc_kinh_doanh l ON ptc.id_linh_vuc_kinh_doanh = l.id
               WHERE COALESCE(ptc.da_xoa, 0) = 0`;
    const params = [];

    if (id_lvkd && id_lvkd !== 'all') {
      sql += ` AND ptc.id_linh_vuc_kinh_doanh = ?`;
      params.push(id_lvkd);
    }

    sql += ` ORDER BY ptc.id DESC`;
    if (limit) {
      sql += ` LIMIT ?`;
      params.push(parseInt(limit, 10) || 10);
    }

    const [rows] = await pool.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn sổ quỹ.' });
  }
});

// Lĩnh vực kinh doanh CRUD Endpoints
router.get('/linh-vuc-kinh-doanh', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM linh_vuc_kinh_doanh WHERE COALESCE(da_xoa, 0) = 0 ORDER BY id DESC');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn lĩnh vực kinh doanh.' });
  }
});

// Upload logo cho lĩnh vực kinh doanh
router.post('/linh-vuc-kinh-doanh/upload-logo', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Vui lòng chọn file ảnh logo.' });
    }
    const logoUrl = `/public/uploads/logos/${req.file.filename}`;
    return res.json({ success: true, url: logoUrl, message: 'Upload ảnh logo thành công!' });
  } catch (err) {
    console.error('Error uploading logo:', err);
    return res.status(500).json({ success: false, message: 'Lỗi tải lên logo.' });
  }
});

router.post('/linh-vuc-kinh-doanh', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const { ma_lvkd, ten_lvkd, ten_cong_ty, dia_chi, dien_thoai, ma_so_thue, nguoi_dai_dien, chuc_vu, logo_url } = req.body;
  if (!ma_lvkd || !ten_lvkd) {
    return res.status(400).json({ message: 'Vui lòng cung cấp mã và tên lĩnh vực kinh doanh.' });
  }
  try {
    const cleanMa = ma_lvkd.trim().toUpperCase();
    const cleanTen = ten_lvkd.trim();

    // Check duplicate code among active records
    const [existing] = await pool.query(
      'SELECT id FROM linh_vuc_kinh_doanh WHERE ma_lvkd = ? AND COALESCE(da_xoa, 0) = 0',
      [cleanMa]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: `Mã lĩnh vực kinh doanh "${cleanMa}" đã tồn tại trên hệ thống.` });
    }

    const [result] = await pool.query(
      `INSERT INTO linh_vuc_kinh_doanh (
        ma_lvkd, ten_lvkd, ten_cong_ty, dia_chi, dien_thoai, ma_so_thue, nguoi_dai_dien, chuc_vu, logo_url, nguoi_tao, da_xoa
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        cleanMa,
        cleanTen,
        ten_cong_ty ? ten_cong_ty.trim() : null,
        dia_chi ? dia_chi.trim() : null,
        dien_thoai ? dien_thoai.trim() : null,
        ma_so_thue ? ma_so_thue.trim() : null,
        nguoi_dai_dien ? nguoi_dai_dien.trim() : null,
        chuc_vu ? chuc_vu.trim() : null,
        logo_url ? logo_url.trim() : null,
        req.user.ten_dang_nhap
      ]
    );
    return res.status(201).json({
      id: result.insertId,
      ma_lvkd: cleanMa,
      ten_lvkd: cleanTen,
      ten_cong_ty: ten_cong_ty || null,
      dia_chi: dia_chi || null,
      dien_thoai: dien_thoai || null,
      ma_so_thue: ma_so_thue || null,
      nguoi_dai_dien: nguoi_dai_dien || null,
      chuc_vu: chuc_vu || null,
      logo_url: logo_url || null
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi tạo lĩnh vực kinh doanh.' });
  }
});

router.put('/linh-vuc-kinh-doanh/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const { id } = req.params;
  const { ma_lvkd, ten_lvkd, ten_cong_ty, dia_chi, dien_thoai, ma_so_thue, nguoi_dai_dien, chuc_vu, logo_url } = req.body;
  if (!ma_lvkd || !ten_lvkd) {
    return res.status(400).json({ message: 'Vui lòng cung cấp mã và tên lĩnh vực kinh doanh.' });
  }
  try {
    const cleanMa = ma_lvkd.trim().toUpperCase();
    const cleanTen = ten_lvkd.trim();

    // Check duplicate code on other active records
    const [existing] = await pool.query(
      'SELECT id FROM linh_vuc_kinh_doanh WHERE ma_lvkd = ? AND id != ? AND COALESCE(da_xoa, 0) = 0',
      [cleanMa, id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: `Mã lĩnh vực kinh doanh "${cleanMa}" đã được sử dụng bởi đơn vị khác.` });
    }

    await pool.query(
      `UPDATE linh_vuc_kinh_doanh SET 
        ma_lvkd = ?, ten_lvkd = ?,
        ten_cong_ty = ?, dia_chi = ?, dien_thoai = ?, ma_so_thue = ?, nguoi_dai_dien = ?, chuc_vu = ?, logo_url = ?
      WHERE id = ?`,
      [
        cleanMa,
        cleanTen,
        ten_cong_ty ? ten_cong_ty.trim() : null,
        dia_chi ? dia_chi.trim() : null,
        dien_thoai ? dien_thoai.trim() : null,
        ma_so_thue ? ma_so_thue.trim() : null,
        nguoi_dai_dien ? nguoi_dai_dien.trim() : null,
        chuc_vu ? chuc_vu.trim() : null,
        logo_url ? logo_url.trim() : null,
        id
      ]
    );
    return res.json({
      message: 'Cập nhật lĩnh vực kinh doanh thành công!',
      id,
      ma_lvkd: cleanMa,
      ten_lvkd: cleanTen,
      ten_cong_ty: ten_cong_ty || null,
      dia_chi: dia_chi || null,
      dien_thoai: dien_thoai || null,
      ma_so_thue: ma_so_thue || null,
      nguoi_dai_dien: nguoi_dai_dien || null,
      chuc_vu: chuc_vu || null,
      logo_url: logo_url || null
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật lĩnh vực kinh doanh.' });
  }
});

router.delete('/linh-vuc-kinh-doanh/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc']), async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [lvkdRows] = await connection.query('SELECT * FROM linh_vuc_kinh_doanh WHERE id = ? AND COALESCE(da_xoa, 0) = 0', [id]);
    if (lvkdRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy lĩnh vực kinh doanh cần xóa.' });
    }
    const lvkd = lvkdRows[0];

    // Check all related tables
    const constraints = [];

    // 1. Quỹ tiền & tài khoản
    try {
      const [quy] = await connection.query('SELECT COUNT(*) as cnt FROM quy_tien WHERE id_lvkd = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (quy[0]?.cnt > 0) constraints.push(`${quy[0].cnt} Quỹ tiền / Tài khoản thanh toán`);
    } catch (e) {}

    // 2. Công trình
    try {
      const [ctr] = await connection.query('SELECT COUNT(*) as cnt FROM cong_trinh WHERE id_linh_vuc_kinh_doanh = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (ctr[0]?.cnt > 0) constraints.push(`${ctr[0].cnt} Công trình / Dự án`);
    } catch (e) {}

    // 3. Hợp đồng kinh tế
    try {
      const [hd] = await connection.query('SELECT COUNT(*) as cnt FROM hop_dong WHERE id_linh_vuc_kinh_doanh = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (hd[0]?.cnt > 0) constraints.push(`${hd[0].cnt} Hợp đồng kinh tế`);
    } catch (e) {}

    // 4. Đơn hàng bán
    try {
      const [dh] = await connection.query('SELECT COUNT(*) as cnt FROM don_hang WHERE id_linh_vuc_kinh_doanh = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (dh[0]?.cnt > 0) constraints.push(`${dh[0].cnt} Đơn hàng bán`);
    } catch (e) {}

    // 5. Phiếu thu chi
    try {
      const [ptc] = await connection.query('SELECT COUNT(*) as cnt FROM phieu_thu_chi WHERE id_linh_vuc_kinh_doanh = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (ptc[0]?.cnt > 0) constraints.push(`${ptc[0].cnt} Phiếu thu / chi sổ quỹ`);
    } catch (e) {}

    // 6. Đề nghị thanh toán
    try {
      const [dntt] = await connection.query('SELECT COUNT(*) as cnt FROM de_nghi_thanh_toan WHERE id_linh_vuc_kinh_doanh = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (dntt[0]?.cnt > 0) constraints.push(`${dntt[0].cnt} Đề nghị thanh toán`);
    } catch (e) {}

    // 7. Phiếu xuất kho
    try {
      const [pxk] = await connection.query('SELECT COUNT(*) as cnt FROM phieu_xuat_kho WHERE id_linh_vuc_kinh_doanh = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (pxk[0]?.cnt > 0) constraints.push(`${pxk[0].cnt} Phiếu xuất kho`);
    } catch (e) {}

    // 8. Phiếu nhập kho
    try {
      const [pnk] = await connection.query('SELECT COUNT(*) as cnt FROM phieu_nhap_kho WHERE id_linh_vuc_kinh_doanh = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (pnk[0]?.cnt > 0) constraints.push(`${pnk[0].cnt} Phiếu nhập kho`);
    } catch (e) {}

    // 9. Phiếu mua hàng
    try {
      const [pmh] = await connection.query('SELECT COUNT(*) as cnt FROM phieu_mua_hang WHERE id_linh_vuc_kinh_doanh = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (pmh[0]?.cnt > 0) constraints.push(`${pmh[0].cnt} Phiếu mua hàng`);
    } catch (e) {}

    if (constraints.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        message: `Không thể xóa Lĩnh vực kinh doanh "${lvkd.ten_lvkd}" (${lvkd.ma_lvkd}) vì đang có dữ liệu liên kết: ${constraints.join(', ')}. Vui lòng kiểm tra hoặc chuyển dữ liệu trước khi xóa!`
      });
    }

    // Soft delete
    await connection.query('UPDATE linh_vuc_kinh_doanh SET da_xoa = 1 WHERE id = ?', [id]);
    await logChange(connection, 'linh_vuc_kinh_doanh', id, 'XOA', lvkd, { da_xoa: 1 }, req.user?.ten_dang_nhap || 'system');

    await connection.commit();
    return res.json({ message: `Đã xóa lĩnh vực kinh doanh "${lvkd.ten_lvkd}" thành công.` });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xóa lĩnh vực kinh doanh: ' + err.message });
  } finally {
    connection.release();
  }
});

// Quỹ tiền / Tài khoản thanh toán CRUD Endpoints
router.get('/quy-tien', authMiddleware, async (req, res) => {
  try {
    const { id_lvkd } = req.query;
    let sql = `SELECT q.id, q.id_lvkd, q.ma_quy, q.ten_quy, q.loai_quy, q.hinh_thuc_thanh_toan,
                      CASE 
                        WHEN q.trang_thai IN ('tam_khoa', 'Tam_Khoa', 'Tạm khóa') THEN 'tam_khoa' 
                        ELSE 'kich_hoat' 
                      END AS trang_thai,
                      q.da_xoa, q.nguoi_tao, q.thoi_gian_tao,
                      l.ten_lvkd, l.ma_lvkd,
                      COALESCE(pt.tong_thu, 0) AS tong_thu,
                      COALESCE(pc.tong_chi, 0) AS tong_chi,
                      (COALESCE(pt.tong_thu, 0) - COALESCE(pc.tong_chi, 0)) AS so_du
               FROM quy_tien q
               LEFT JOIN linh_vuc_kinh_doanh l ON q.id_lvkd = l.id
               LEFT JOIN (
                 SELECT id_quy_tien, SUM(so_tien) AS tong_thu 
                 FROM phieu_thu_chi 
                 WHERE loai_phieu = 'Phieu_Thu' AND COALESCE(da_xoa, 0) = 0 
                 GROUP BY id_quy_tien
               ) pt ON q.id = pt.id_quy_tien
               LEFT JOIN (
                 SELECT id_quy_tien, SUM(so_tien) AS tong_chi 
                 FROM phieu_thu_chi 
                 WHERE loai_phieu = 'Phieu_Chi' AND COALESCE(da_xoa, 0) = 0 
                 GROUP BY id_quy_tien
               ) pc ON q.id = pc.id_quy_tien
               WHERE COALESCE(q.da_xoa, 0) = 0`;
    const params = [];

    if (id_lvkd && id_lvkd !== 'all') {
      sql += ` AND q.id_lvkd = ?`;
      params.push(id_lvkd);
    }

    sql += ` ORDER BY q.id DESC`;

    const [rows] = await pool.query(sql, params);
    const processed = rows.map(r => ({
      ...r,
      tong_thu: parseFloat(r.tong_thu) || 0,
      tong_chi: parseFloat(r.tong_chi) || 0,
      so_du: parseFloat(r.so_du) || 0
    }));
    return res.json(processed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh mục quỹ tiền.' });
  }
});

// GET /api/finance/quy-tien/:id/so-quy (Báo cáo sổ chi tiết phát sinh thu hoặc chi của quỹ)
router.get('/quy-tien/:id/so-quy', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { loai_phieu = 'Phieu_Thu', tu_ngay, den_ngay } = req.query;

    // 1. Get Fund and LVKD info
    const [quyRows] = await pool.query(
      `SELECT q.*, l.ten_lvkd, l.ma_lvkd, l.ten_cong_ty, l.dia_chi AS dia_chi_cong_ty,
              l.dien_thoai AS sdt_cong_ty, l.ma_so_thue AS mst_cong_ty, l.logo_url AS logo_lvkd
       FROM quy_tien q
       LEFT JOIN linh_vuc_kinh_doanh l ON q.id_lvkd = l.id
       WHERE q.id = ? AND COALESCE(q.da_xoa, 0) = 0`,
      [id]
    );

    if (quyRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy quỹ tiền.' });
    }
    const quyInfo = quyRows[0];

    // 2. Compute opening balance before tu_ngay (if tu_ngay provided)
    let soDuDauKy = 0;
    if (tu_ngay) {
      const [dauKyThu] = await pool.query(
        `SELECT SUM(so_tien) as total FROM phieu_thu_chi
         WHERE id_quy_tien = ? AND loai_phieu = 'Phieu_Thu' AND COALESCE(da_xoa, 0) = 0 AND ngay_chung_tu < ?`,
        [id, tu_ngay]
      );
      const [dauKyChi] = await pool.query(
        `SELECT SUM(so_tien) as total FROM phieu_thu_chi
         WHERE id_quy_tien = ? AND loai_phieu = 'Phieu_Chi' AND COALESCE(da_xoa, 0) = 0 AND ngay_chung_tu < ?`,
        [id, tu_ngay]
      );
      soDuDauKy = (parseFloat(dauKyThu[0]?.total) || 0) - (parseFloat(dauKyChi[0]?.total) || 0);
    }

    // 3. Query records in date range
    let sql = `SELECT p.*, l.ten_lvkd
               FROM phieu_thu_chi p
               LEFT JOIN linh_vuc_kinh_doanh l ON p.id_linh_vuc_kinh_doanh = l.id
               WHERE p.id_quy_tien = ? AND p.loai_phieu = ? AND COALESCE(p.da_xoa, 0) = 0`;
    const params = [id, loai_phieu];

    if (tu_ngay) {
      sql += ` AND p.ngay_chung_tu >= ?`;
      params.push(tu_ngay);
    }
    if (den_ngay) {
      sql += ` AND p.ngay_chung_tu <= ?`;
      params.push(den_ngay);
    }

    sql += ` ORDER BY p.ngay_chung_tu ASC, p.id ASC`;

    const [records] = await pool.query(sql, params);
    const tongPhatSinh = records.reduce((sum, r) => sum + (parseFloat(r.so_tien) || 0), 0);

    // Compute closing balance up to den_ngay (or all time if no den_ngay)
    let soDuCuoiKy = 0;
    let cuoiKyParamsThu = [id];
    let cuoiKyParamsChi = [id];
    let cuoiKySqlThu = `SELECT SUM(so_tien) as total FROM phieu_thu_chi WHERE id_quy_tien = ? AND loai_phieu = 'Phieu_Thu' AND COALESCE(da_xoa, 0) = 0`;
    let cuoiKySqlChi = `SELECT SUM(so_tien) as total FROM phieu_thu_chi WHERE id_quy_tien = ? AND loai_phieu = 'Phieu_Chi' AND COALESCE(da_xoa, 0) = 0`;

    if (den_ngay) {
      cuoiKySqlThu += ` AND ngay_chung_tu <= ?`;
      cuoiKyParamsThu.push(den_ngay);
      cuoiKySqlChi += ` AND ngay_chung_tu <= ?`;
      cuoiKyParamsChi.push(den_ngay);
    }

    const [cuoiKyThu] = await pool.query(cuoiKySqlThu, cuoiKyParamsThu);
    const [cuoiKyChi] = await pool.query(cuoiKySqlChi, cuoiKyParamsChi);
    soDuCuoiKy = (parseFloat(cuoiKyThu[0]?.total) || 0) - (parseFloat(cuoiKyChi[0]?.total) || 0);

    return res.json({
      quy_info: quyInfo,
      loai_phieu,
      tu_ngay: tu_ngay || null,
      den_ngay: den_ngay || null,
      so_du_dau_ky: soDuDauKy,
      danh_sach: records,
      tong_phat_sinh: tongPhatSinh,
      so_du_cuoi_ky: soDuCuoiKy
    });
  } catch (err) {
    console.error('Error fetching so-quy report:', err);
    return res.status(500).json({ message: 'Lỗi tải báo cáo sổ phát sinh quỹ tiền: ' + err.message });
  }
});

router.post('/quy-tien', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const { id_lvkd, ma_quy, ten_quy, loai_quy, hinh_thuc_thanh_toan, trang_thai } = req.body;
  if (!id_lvkd || !ma_quy || !ten_quy || !loai_quy) {
    return res.status(400).json({ message: 'Thiếu thông tin khai báo quỹ tiền.' });
  }
  try {
    const cleanMa = ma_quy.trim().toUpperCase();
    const cleanTen = ten_quy.trim();
    const cleanStatus = (trang_thai === 'tam_khoa' || trang_thai === 'Tam_Khoa' || trang_thai === 'Tạm khóa') ? 'tam_khoa' : 'kich_hoat';
    const cleanHinhThuc = (hinh_thuc_thanh_toan || (String(loai_quy).toLowerCase().includes('tiền mặt') ? 'TM' : 'CK')).trim().toUpperCase();

    // Check duplicate code among active records
    const [existing] = await pool.query(
      'SELECT id FROM quy_tien WHERE ma_quy = ? AND COALESCE(da_xoa, 0) = 0',
      [cleanMa]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: `Mã quỹ/tài khoản "${cleanMa}" đã tồn tại trên hệ thống.` });
    }

    const [result] = await pool.query(
      'INSERT INTO quy_tien (id_lvkd, ma_quy, ten_quy, loai_quy, hinh_thuc_thanh_toan, trang_thai, nguoi_tao, da_xoa) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [id_lvkd, cleanMa, cleanTen, loai_quy, cleanHinhThuc, cleanStatus, req.user.ten_dang_nhap]
    );
    return res.status(201).json({ id: result.insertId, id_lvkd, ma_quy: cleanMa, ten_quy: cleanTen, loai_quy, hinh_thuc_thanh_toan: cleanHinhThuc, trang_thai: cleanStatus });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi tạo tài khoản quỹ tiền.' });
  }
});

router.put('/quy-tien/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const { id } = req.params;
  const { id_lvkd, ma_quy, ten_quy, loai_quy, hinh_thuc_thanh_toan, trang_thai } = req.body;
  if (!id_lvkd || !ma_quy || !ten_quy || !loai_quy) {
    return res.status(400).json({ message: 'Thiếu thông tin khai báo quỹ tiền.' });
  }
  try {
    const cleanMa = ma_quy.trim().toUpperCase();
    const cleanTen = ten_quy.trim();
    const cleanStatus = (trang_thai === 'tam_khoa' || trang_thai === 'Tam_Khoa' || trang_thai === 'Tạm khóa') ? 'tam_khoa' : 'kich_hoat';
    const cleanHinhThuc = (hinh_thuc_thanh_toan || (String(loai_quy).toLowerCase().includes('tiền mặt') ? 'TM' : 'CK')).trim().toUpperCase();

    // Check duplicate code on other active records
    const [existing] = await pool.query(
      'SELECT id FROM quy_tien WHERE ma_quy = ? AND id != ? AND COALESCE(da_xoa, 0) = 0',
      [cleanMa, id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: `Mã quỹ/tài khoản "${cleanMa}" đã được sử dụng bởi quỹ khác.` });
    }

    await pool.query(
      'UPDATE quy_tien SET id_lvkd = ?, ma_quy = ?, ten_quy = ?, loai_quy = ?, hinh_thuc_thanh_toan = ?, trang_thai = ? WHERE id = ?',
      [id_lvkd, cleanMa, cleanTen, loai_quy, cleanHinhThuc, cleanStatus, id]
    );
    return res.json({ message: 'Cập nhật tài khoản quỹ tiền thành công!', id, id_lvkd, ma_quy: cleanMa, ten_quy: cleanTen, loai_quy, hinh_thuc_thanh_toan: cleanHinhThuc, trang_thai: cleanStatus });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật tài khoản quỹ tiền.' });
  }
});

router.delete('/quy-tien/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc']), async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [quyRows] = await connection.query('SELECT * FROM quy_tien WHERE id = ? AND COALESCE(da_xoa, 0) = 0', [id]);
    if (quyRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy quỹ tiền / tài khoản cần xóa.' });
    }
    const quy = quyRows[0];

    const constraints = [];

    // 1. Phiếu thu chi
    try {
      const [ptc] = await connection.query('SELECT COUNT(*) as cnt FROM phieu_thu_chi WHERE id_quy_tien = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (ptc[0]?.cnt > 0) constraints.push(`${ptc[0].cnt} Phiếu thu / chi sổ quỹ`);
    } catch (e) {}

    // 2. Đề nghị thanh toán
    try {
      const [dntt] = await connection.query('SELECT COUNT(*) as cnt FROM de_nghi_thanh_toan WHERE id_quy_tien = ? AND COALESCE(da_xoa, 0) = 0', [id]);
      if (dntt[0]?.cnt > 0) constraints.push(`${dntt[0].cnt} Đề nghị thanh toán`);
    } catch (e) {}

    // 3. Đợt thanh toán hợp đồng
    try {
      const [dotHd] = await connection.query('SELECT COUNT(*) as cnt FROM hop_dong_dot_thanh_toan WHERE id_quy_tien = ?', [id]);
      if (dotHd[0]?.cnt > 0) constraints.push(`${dotHd[0].cnt} Đợt thanh toán hợp đồng`);
    } catch (e) {}

    if (constraints.length > 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        message: `Không thể xóa Quỹ tiền / Tài khoản "${quy.ten_quy}" (${quy.ma_quy}) vì đã phát sinh giao dịch: ${constraints.join(', ')}. Vui lòng kiểm tra lại!`
      });
    }

    // Soft delete
    await connection.query('UPDATE quy_tien SET da_xoa = 1 WHERE id = ?', [id]);
    await logChange(connection, 'quy_tien', id, 'XOA', quy, { da_xoa: 1 }, req.user?.ten_dang_nhap || 'system');

    await connection.commit();
    return res.json({ message: `Đã xóa tài khoản / quỹ tiền "${quy.ten_quy}" thành công.` });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xóa quỹ tiền: ' + err.message });
  } finally {
    connection.release();
  }
});

// ==========================================
// 2. SUBCONTRACTOR ENDPOINTS
// ==========================================

router.get('/nha-thau-phu', authMiddleware, async (req, res) => {
  try {
    const { id_cong_trinh } = req.query;
    let query = `SELECT n.*, c.ten_cong_trinh 
                 FROM nha_thau_phu n
                 JOIN cong_trinh c ON n.id_cong_trinh = c.id`;
    const params = [];
    if (id_cong_trinh) {
      query += ` WHERE n.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }
    query += ` ORDER BY n.id DESC`;

    const [rows] = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn nhà thầu phụ.' });
  }
});

router.post('/nha-thau-phu', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_cong_trinh, ten_nha_thau, noi_dung_khoan, gia_tri_hop_dong } = req.body;
  if (!id_cong_trinh || !ten_nha_thau || !noi_dung_khoan) {
    return res.status(400).json({ message: 'Thiếu thông tin nhà thầu phụ.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO nha_thau_phu (id_cong_trinh, ten_nha_thau, noi_dung_khoan, gia_tri_hop_dong, da_thanh_toan, cong_no_con_lai, nguoi_tao)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [id_cong_trinh, ten_nha_thau, noi_dung_khoan, gia_tri_hop_dong || 0, gia_tri_hop_dong || 0, req.user.ten_dang_nhap]
    );

    const [newRow] = await connection.query('SELECT * FROM nha_thau_phu WHERE id = ?', [result.insertId]);
    await logChange(connection, 'nha_thau_phu', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi thêm hợp đồng thầu phụ.' });
  } finally {
    connection.release();
  }
});

router.put('/nha-thau-phu/:id', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { ten_nha_thau, noi_dung_khoan, gia_tri_hop_dong } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM nha_thau_phu WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy nhà thầu phụ.' });
    }

    const gtr = gia_tri_hop_dong !== undefined ? parseFloat(gia_tri_hop_dong) : parseFloat(oldRow[0].gia_tri_hop_dong);
    const daTT = parseFloat(oldRow[0].da_thanh_toan) || 0;
    const conLai = gtr - daTT;

    await connection.query(
      `UPDATE nha_thau_phu SET ten_nha_thau = ?, noi_dung_khoan = ?, gia_tri_hop_dong = ?, cong_no_con_lai = ? WHERE id = ?`,
      [ten_nha_thau || oldRow[0].ten_nha_thau, noi_dung_khoan || oldRow[0].noi_dung_khoan, gtr, conLai, req.params.id]
    );

    const [newRow] = await connection.query('SELECT * FROM nha_thau_phu WHERE id = ?', [req.params.id]);
    await logChange(connection, 'nha_thau_phu', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật nhà thầu phụ.' });
  } finally {
    connection.release();
  }
});

router.delete('/nha-thau-phu/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM nha_thau_phu WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy nhà thầu phụ.' });
    }

    await connection.query('DELETE FROM thanh_toan_thau_phu WHERE id_nha_thau_phu = ?', [req.params.id]);
    await connection.query('DELETE FROM nha_thau_phu WHERE id = ?', [req.params.id]);

    await logChange(connection, 'nha_thau_phu', req.params.id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: 'Đã xóa nhà thầu phụ.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa nhà thầu phụ.' });
  } finally {
    connection.release();
  }
});

router.get('/nha-thau-phu/thanh-toan', authMiddleware, async (req, res) => {
  try {
    const { id_cong_trinh, id_nha_thau_phu } = req.query;
    let query = `SELECT t.*, n.ten_nha_thau, n.id_cong_trinh, c.ten_cong_trinh
                 FROM thanh_toan_thau_phu t
                 JOIN nha_thau_phu n ON t.id_nha_thau_phu = n.id
                 JOIN cong_trinh c ON n.id_cong_trinh = c.id`;
    const params = [];
    const conditions = [];

    if (id_cong_trinh) {
      conditions.push(`n.id_cong_trinh = ?`);
      params.push(id_cong_trinh);
    }
    if (id_nha_thau_phu) {
      conditions.push(`t.id_nha_thau_phu = ?`);
      params.push(id_nha_thau_phu);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY t.id DESC`;

    const [rows] = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn thanh toán thầu phụ.' });
  }
});

router.post('/nha-thau-phu/thanh-toan', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_nha_thau_phu, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu } = req.body;
  if (!id_nha_thau_phu || !so_tien_thanh_toan || !ngay_thanh_toan) {
    return res.status(400).json({ message: 'Thiếu thông tin thanh toán thầu phụ.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO thanh_toan_thau_phu (id_nha_thau_phu, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?)`,
      [id_nha_thau_phu, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu || null, req.user.ten_dang_nhap]
    );

    await recalculateSubcontractorPaid(connection, id_nha_thau_phu);

    const [newRow] = await connection.query('SELECT * FROM thanh_toan_thau_phu WHERE id = ?', [result.insertId]);
    await logChange(connection, 'thanh_toan_thau_phu', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi thanh toán thầu phụ.' });
  } finally {
    connection.release();
  }
});

router.put('/nha-thau-phu/thanh-toan/:id', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_nha_thau_phu, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM thanh_toan_thau_phu WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy chi tiết thanh toán.' });
    }

    const parentId = id_nha_thau_phu || oldRow[0].id_nha_thau_phu;

    await connection.query(
      `UPDATE thanh_toan_thau_phu SET id_nha_thau_phu = ?, so_tien_thanh_toan = ?, ngay_thanh_toan = ?, ghi_chu = ? WHERE id = ?`,
      [parentId, so_tien_thanh_toan || oldRow[0].so_tien_thanh_toan, ngay_thanh_toan || oldRow[0].ngay_thanh_toan, ghi_chu !== undefined ? ghi_chu : oldRow[0].ghi_chu, req.params.id]
    );

    await recalculateSubcontractorPaid(connection, parentId);
    if (oldRow[0].id_nha_thau_phu !== parentId) {
      await recalculateSubcontractorPaid(connection, oldRow[0].id_nha_thau_phu);
    }

    const [newRow] = await connection.query('SELECT * FROM thanh_toan_thau_phu WHERE id = ?', [req.params.id]);
    await logChange(connection, 'thanh_toan_thau_phu', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật thanh toán thầu phụ.' });
  } finally {
    connection.release();
  }
});

router.delete('/nha-thau-phu/thanh-toan/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM thanh_toan_thau_phu WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy chi tiết thanh toán.' });
    }

    const parentId = oldRow[0].id_nha_thau_phu;
    await connection.query('DELETE FROM thanh_toan_thau_phu WHERE id = ?', [req.params.id]);
    await recalculateSubcontractorPaid(connection, parentId);

    await logChange(connection, 'thanh_toan_thau_phu', req.params.id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: 'Đã xóa chi tiết thanh toán thầu phụ.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa thanh toán thầu phụ.' });
  } finally {
    connection.release();
  }
});

// ==========================================
// 3. MACHINERY ENDPOINTS
// ==========================================

router.get('/ca-may', authMiddleware, async (req, res) => {
  try {
    const { id_cong_trinh } = req.query;
    let query = `SELECT m.*, c.ten_cong_trinh 
                 FROM ca_may_thue m
                 JOIN cong_trinh c ON m.id_cong_trinh = c.id`;
    const params = [];
    if (id_cong_trinh) {
      query += ` WHERE m.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }
    query += ` ORDER BY m.id DESC`;

    const [rows] = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn ca máy.' });
  }
});

router.post('/ca-may', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_cong_trinh, ten_may, nha_cung_cap, so_ca_lam_viec, don_gia_ca_may, ngay_thuc_hien } = req.body;
  if (!id_cong_trinh || !ten_may || !so_ca_lam_viec || !don_gia_ca_may || !ngay_thuc_hien) {
    return res.status(400).json({ message: 'Thiếu thông tin thuê ca máy.' });
  }

  const amount = parseFloat(so_ca_lam_viec) * parseFloat(don_gia_ca_may);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO ca_may_thue (id_cong_trinh, ten_may, nha_cung_cap, so_ca_lam_viec, don_gia_ca_may, tong_tien, da_thanh_toan, cong_no_con_lai, ngay_thuc_hien, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [id_cong_trinh, ten_may, nha_cung_cap || null, so_ca_lam_viec, don_gia_ca_may, amount, amount, ngay_thuc_hien, req.user.ten_dang_nhap]
    );

    const [newRow] = await connection.query('SELECT * FROM ca_may_thue WHERE id = ?', [result.insertId]);
    await logChange(connection, 'ca_may_thue', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi thêm ca máy.' });
  } finally {
    connection.release();
  }
});

router.put('/ca-may/:id', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { ten_may, nha_cung_cap, so_ca_lam_viec, don_gia_ca_may, ngay_thuc_hien } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM ca_may_thue WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy ca máy.' });
    }

    const sc = so_ca_lam_viec !== undefined ? parseFloat(so_ca_lam_viec) : parseFloat(oldRow[0].so_ca_lam_viec);
    const dg = don_gia_ca_may !== undefined ? parseFloat(don_gia_ca_may) : parseFloat(oldRow[0].don_gia_ca_may);
    const amount = sc * dg;
    const daTT = parseFloat(oldRow[0].da_thanh_toan) || 0;
    const conLai = amount - daTT;

    await connection.query(
      `UPDATE ca_may_thue SET ten_may = ?, nha_cung_cap = ?, so_ca_lam_viec = ?, don_gia_ca_may = ?, tong_tien = ?, cong_no_con_lai = ?, ngay_thuc_hien = ? WHERE id = ?`,
      [
        ten_may || oldRow[0].ten_may,
        nha_cung_cap !== undefined ? nha_cung_cap : oldRow[0].nha_cung_cap,
        sc,
        dg,
        amount,
        conLai,
        ngay_thuc_hien || oldRow[0].ngay_thuc_hien,
        req.params.id
      ]
    );

    const [newRow] = await connection.query('SELECT * FROM ca_may_thue WHERE id = ?', [req.params.id]);
    await logChange(connection, 'ca_may_thue', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật ca máy.' });
  } finally {
    connection.release();
  }
});

router.delete('/ca-may/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM ca_may_thue WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy ca máy.' });
    }

    await connection.query('DELETE FROM thanh_toan_ca_may WHERE id_ca_may_thue = ?', [req.params.id]);
    await connection.query('DELETE FROM ca_may_thue WHERE id = ?', [req.params.id]);

    await logChange(connection, 'ca_may_thue', req.params.id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: 'Đã xóa ca máy.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa ca máy.' });
  } finally {
    connection.release();
  }
});

router.get('/ca-may/lich-su', authMiddleware, async (req, res) => {
  try {
    const { id_cong_trinh, id_ca_may_thue } = req.query;
    let query = `SELECT h.*, m.ten_may, m.nha_cung_cap, m.id_cong_trinh, c.ten_cong_trinh
                 FROM ca_may_thue_lich_su h
                 JOIN ca_may_thue m ON h.id_ca_may_thue = m.id
                 JOIN cong_trinh c ON m.id_cong_trinh = c.id`;
    const params = [];
    const conditions = [];

    if (id_cong_trinh) {
      conditions.push(`m.id_cong_trinh = ?`);
      params.push(id_cong_trinh);
    }
    if (id_ca_may_thue) {
      conditions.push(`h.id_ca_may_thue = ?`);
      params.push(id_ca_may_thue);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY h.id DESC`;

    const [rows] = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn lịch sử ca máy.' });
  }
});

router.post('/ca-may/lich-su', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_ca_may_thue, so_ca, ngay_thuc_hien_tu, ngay_thuc_hien_den, ghi_chu } = req.body;
  if (!id_ca_may_thue || so_ca === undefined || !ngay_thuc_hien_tu || !ngay_thuc_hien_den) {
    return res.status(400).json({ message: 'Thiếu thông tin lịch sử ca máy.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO ca_may_thue_lich_su (id_ca_may_thue, so_ca, ngay_thuc_hien_tu, ngay_thuc_hien_den, ghi_chu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id_ca_may_thue, so_ca, ngay_thuc_hien_tu, ngay_thuc_hien_den, ghi_chu || null, req.user.ten_dang_nhap]
    );

    await recalculateMachineryShifts(connection, id_ca_may_thue);

    const [newRow] = await connection.query('SELECT * FROM ca_may_thue_lich_su WHERE id = ?', [result.insertId]);
    await logChange(connection, 'ca_may_thue_lich_su', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi thêm lịch sử ca máy.' });
  } finally {
    connection.release();
  }
});

router.put('/ca-may/lich-su/:id', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_ca_may_thue, so_ca, ngay_thuc_hien_tu, ngay_thuc_hien_den, ghi_chu } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM ca_may_thue_lich_su WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy lịch sử ca máy.' });
    }

    const parentId = id_ca_may_thue || oldRow[0].id_ca_may_thue;

    await connection.query(
      `UPDATE ca_may_thue_lich_su SET id_ca_may_thue = ?, so_ca = ?, ngay_thuc_hien_tu = ?, ngay_thuc_hien_den = ?, ghi_chu = ? WHERE id = ?`,
      [parentId, so_ca !== undefined ? so_ca : oldRow[0].so_ca, ngay_thuc_hien_tu || oldRow[0].ngay_thuc_hien_tu, ngay_thuc_hien_den || oldRow[0].ngay_thuc_hien_den, ghi_chu !== undefined ? ghi_chu : oldRow[0].ghi_chu, req.params.id]
    );

    await recalculateMachineryShifts(connection, parentId);
    if (oldRow[0].id_ca_may_thue !== parentId) {
      await recalculateMachineryShifts(connection, oldRow[0].id_ca_may_thue);
    }

    const [newRow] = await connection.query('SELECT * FROM ca_may_thue_lich_su WHERE id = ?', [req.params.id]);
    await logChange(connection, 'ca_may_thue_lich_su', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật lịch sử ca máy.' });
  } finally {
    connection.release();
  }
});

router.delete('/ca-may/lich-su/:id', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM ca_may_thue_lich_su WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy lịch sử ca máy.' });
    }

    const parentId = oldRow[0].id_ca_may_thue;

    await connection.query('DELETE FROM ca_may_thue_lich_su WHERE id = ?', [req.params.id]);

    await recalculateMachineryShifts(connection, parentId);

    await logChange(connection, 'ca_may_thue_lich_su', req.params.id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: 'Đã xóa lịch sử ca máy.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa lịch sử ca máy.' });
  } finally {
    connection.release();
  }
});

router.get('/ca-may/thanh-toan', authMiddleware, async (req, res) => {
  try {
    const { id_cong_trinh, id_ca_may_thue } = req.query;
    let query = `SELECT t.*, m.ten_may, m.nha_cung_cap, m.id_cong_trinh, c.ten_cong_trinh
                 FROM thanh_toan_ca_may t
                 JOIN ca_may_thue m ON t.id_ca_may_thue = m.id
                 JOIN cong_trinh c ON m.id_cong_trinh = c.id`;
    const params = [];
    const conditions = [];

    if (id_cong_trinh) {
      conditions.push(`m.id_cong_trinh = ?`);
      params.push(id_cong_trinh);
    }
    if (id_ca_may_thue) {
      conditions.push(`t.id_ca_may_thue = ?`);
      params.push(id_ca_may_thue);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY t.id DESC`;

    const [rows] = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn thanh toán ca máy.' });
  }
});

router.post('/ca-may/thanh-toan', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_ca_may_thue, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu } = req.body;
  if (!id_ca_may_thue || !so_tien_thanh_toan || !ngay_thanh_toan) {
    return res.status(400).json({ message: 'Thiếu thông tin thanh toán ca máy.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO thanh_toan_ca_may (id_ca_may_thue, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?)`,
      [id_ca_may_thue, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu || null, req.user.ten_dang_nhap]
    );

    await recalculateMachineryPaid(connection, id_ca_may_thue);

    const [newRow] = await connection.query('SELECT * FROM thanh_toan_ca_may WHERE id = ?', [result.insertId]);
    await logChange(connection, 'thanh_toan_ca_may', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi thanh toán ca máy.' });
  } finally {
    connection.release();
  }
});

router.put('/ca-may/thanh-toan/:id', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_ca_may_thue, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM thanh_toan_ca_may WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy chi tiết thanh toán.' });
    }

    const parentId = id_ca_may_thue || oldRow[0].id_ca_may_thue;

    await connection.query(
      `UPDATE thanh_toan_ca_may SET id_ca_may_thue = ?, so_tien_thanh_toan = ?, ngay_thanh_toan = ?, ghi_chu = ? WHERE id = ?`,
      [parentId, so_tien_thanh_toan || oldRow[0].so_tien_thanh_toan, ngay_thanh_toan || oldRow[0].ngay_thanh_toan, ghi_chu !== undefined ? ghi_chu : oldRow[0].ghi_chu, req.params.id]
    );

    await recalculateMachineryPaid(connection, parentId);
    if (oldRow[0].id_ca_may_thue !== parentId) {
      await recalculateMachineryPaid(connection, oldRow[0].id_ca_may_thue);
    }

    const [newRow] = await connection.query('SELECT * FROM thanh_toan_ca_may WHERE id = ?', [req.params.id]);
    await logChange(connection, 'thanh_toan_ca_may', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật thanh toán ca máy.' });
  } finally {
    connection.release();
  }
});

router.delete('/ca-may/thanh-toan/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM thanh_toan_ca_may WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy chi tiết thanh toán.' });
    }

    const parentId = oldRow[0].id_ca_may_thue;
    await connection.query('DELETE FROM thanh_toan_ca_may WHERE id = ?', [req.params.id]);
    await recalculateMachineryPaid(connection, parentId);

    await logChange(connection, 'thanh_toan_ca_may', req.params.id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: 'Đã xóa chi tiết thanh toán ca máy.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa thanh toán ca máy.' });
  } finally {
    connection.release();
  }
});

// ==========================================
// 4. PROJECT OTHER COSTS ENDPOINTS
// ==========================================

router.get('/danh-muc-chi-phi-khac', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM danh_muc_chi_phi_khac ORDER BY id ASC');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh mục chi phí khác.' });
  }
});

router.get('/ctr-chi-phi-khac', authMiddleware, async (req, res) => {
  try {
    const { id_cong_trinh } = req.query;
    let query = `SELECT k.*, d.ten_chi_phi, d.ma_chi_phi, c.ten_cong_trinh
                 FROM ctr_chi_phi_khac k
                 JOIN danh_muc_chi_phi_khac d ON k.id_danh_muc_chi_phi_khac = d.id
                 JOIN cong_trinh c ON k.id_cong_trinh = c.id`;
    const params = [];
    if (id_cong_trinh) {
      query += ` WHERE k.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }
    query += ` ORDER BY k.id DESC`;

    const [rows] = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn chi phí khác theo công trình.' });
  }
});

router.post('/ctr-chi-phi-khac', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_cong_trinh, id_danh_muc_chi_phi_khac, ten_chi_phi_khac_theo_ctr, ghi_chu, tong_tien } = req.body;
  if (!id_cong_trinh || !id_danh_muc_chi_phi_khac) {
    return res.status(400).json({ message: 'Thiếu thông tin danh mục chi phí khác.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [catRow] = await connection.query('SELECT ten_chi_phi FROM danh_muc_chi_phi_khac WHERE id = ?', [id_danh_muc_chi_phi_khac]);
    const catName = catRow.length > 0 ? catRow[0].ten_chi_phi : '';
    const nameCtr = ten_chi_phi_khac_theo_ctr && ten_chi_phi_khac_theo_ctr.trim() ? ten_chi_phi_khac_theo_ctr.trim() : catName;
    const tt = parseFloat(tong_tien) || 0;

    const [result] = await connection.query(
      `INSERT INTO ctr_chi_phi_khac (id_cong_trinh, id_danh_muc_chi_phi_khac, ten_chi_phi_khac_theo_ctr, ghi_chu, tong_tien, da_thanh_toan, cong_no_con_lai, nguoi_tao)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [id_cong_trinh, id_danh_muc_chi_phi_khac, nameCtr, ghi_chu || null, tt, tt, req.user.ten_dang_nhap]
    );

    const [newRow] = await connection.query('SELECT * FROM ctr_chi_phi_khac WHERE id = ?', [result.insertId]);
    await logChange(connection, 'ctr_chi_phi_khac', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi thêm chi phí khác theo công trình.' });
  } finally {
    connection.release();
  }
});

router.put('/ctr-chi-phi-khac/:id', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_danh_muc_chi_phi_khac, ten_chi_phi_khac_theo_ctr, ghi_chu, tong_tien } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM ctr_chi_phi_khac WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy bản ghi chi phí khác.' });
    }

    const catId = id_danh_muc_chi_phi_khac || oldRow[0].id_danh_muc_chi_phi_khac;
    let nameCtr = ten_chi_phi_khac_theo_ctr;
    if (!nameCtr || !nameCtr.trim()) {
      const [catRow] = await connection.query('SELECT ten_chi_phi FROM danh_muc_chi_phi_khac WHERE id = ?', [catId]);
      nameCtr = catRow.length > 0 ? catRow[0].ten_chi_phi : oldRow[0].ten_chi_phi_khac_theo_ctr;
    }

    const tt = tong_tien !== undefined ? parseFloat(tong_tien) : parseFloat(oldRow[0].tong_tien);
    const daTT = parseFloat(oldRow[0].da_thanh_toan) || 0;
    let conLai = 0;
    if (tt > 0) {
      conLai = Math.max(0, tt - daTT);
    }

    await connection.query(
      `UPDATE ctr_chi_phi_khac SET id_danh_muc_chi_phi_khac = ?, ten_chi_phi_khac_theo_ctr = ?, ghi_chu = ?, tong_tien = ?, cong_no_con_lai = ? WHERE id = ?`,
      [catId, nameCtr, ghi_chu !== undefined ? ghi_chu : oldRow[0].ghi_chu, tt, conLai, req.params.id]
    );

    const [newRow] = await connection.query('SELECT * FROM ctr_chi_phi_khac WHERE id = ?', [req.params.id]);
    await logChange(connection, 'ctr_chi_phi_khac', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật chi phí khác.' });
  } finally {
    connection.release();
  }
});

router.delete('/ctr-chi-phi-khac/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM ctr_chi_phi_khac WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy bản ghi chi phí khác.' });
    }

    await connection.query('DELETE FROM ctr_chi_phi_khac_thanh_toan WHERE id_ctr_chi_phi_khac = ?', [req.params.id]);
    await connection.query('DELETE FROM ctr_chi_phi_khac WHERE id = ?', [req.params.id]);

    await logChange(connection, 'ctr_chi_phi_khac', req.params.id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: 'Đã xóa chi phí khác.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa chi phí khác.' });
  } finally {
    connection.release();
  }
});

router.get('/ctr-chi-phi-khac/thanh-toan', authMiddleware, async (req, res) => {
  try {
    const { id_cong_trinh, id_ctr_chi_phi_khac } = req.query;
    let query = `SELECT t.*, k.ten_chi_phi_khac_theo_ctr, k.id_cong_trinh, d.ten_chi_phi, c.ten_cong_trinh
                 FROM ctr_chi_phi_khac_thanh_toan t
                 JOIN ctr_chi_phi_khac k ON t.id_ctr_chi_phi_khac = k.id
                 JOIN danh_muc_chi_phi_khac d ON k.id_danh_muc_chi_phi_khac = d.id
                 JOIN cong_trinh c ON k.id_cong_trinh = c.id`;
    const params = [];
    const conditions = [];

    if (id_cong_trinh) {
      conditions.push(`k.id_cong_trinh = ?`);
      params.push(id_cong_trinh);
    }
    if (id_ctr_chi_phi_khac) {
      conditions.push(`t.id_ctr_chi_phi_khac = ?`);
      params.push(id_ctr_chi_phi_khac);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY t.id DESC`;

    const [rows] = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn thanh toán chi phí khác.' });
  }
});

router.post('/ctr-chi-phi-khac/thanh-toan', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_ctr_chi_phi_khac, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu } = req.body;
  if (!id_ctr_chi_phi_khac || !so_tien_thanh_toan || !ngay_thanh_toan) {
    return res.status(400).json({ message: 'Thiếu thông tin thanh toán chi phí khác.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO ctr_chi_phi_khac_thanh_toan (id_ctr_chi_phi_khac, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?)`,
      [id_ctr_chi_phi_khac, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu || null, req.user.ten_dang_nhap]
    );

    await recalculateOtherCostPaid(connection, id_ctr_chi_phi_khac);

    const [newRow] = await connection.query('SELECT * FROM ctr_chi_phi_khac_thanh_toan WHERE id = ?', [result.insertId]);
    await logChange(connection, 'ctr_chi_phi_khac_thanh_toan', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi thanh toán chi phí khác.' });
  } finally {
    connection.release();
  }
});

router.put('/ctr-chi-phi-khac/thanh-toan/:id', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const { id_ctr_chi_phi_khac, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu } = req.body;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM ctr_chi_phi_khac_thanh_toan WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy chi tiết thanh toán.' });
    }

    const parentId = id_ctr_chi_phi_khac || oldRow[0].id_ctr_chi_phi_khac;

    await connection.query(
      `UPDATE ctr_chi_phi_khac_thanh_toan SET id_ctr_chi_phi_khac = ?, so_tien_thanh_toan = ?, ngay_thanh_toan = ?, ghi_chu = ? WHERE id = ?`,
      [parentId, so_tien_thanh_toan || oldRow[0].so_tien_thanh_toan, ngay_thanh_toan || oldRow[0].ngay_thanh_toan, ghi_chu !== undefined ? ghi_chu : oldRow[0].ghi_chu, req.params.id]
    );

    await recalculateOtherCostPaid(connection, parentId);
    if (oldRow[0].id_ctr_chi_phi_khac !== parentId) {
      await recalculateOtherCostPaid(connection, oldRow[0].id_ctr_chi_phi_khac);
    }

    const [newRow] = await connection.query('SELECT * FROM ctr_chi_phi_khac_thanh_toan WHERE id = ?', [req.params.id]);
    await logChange(connection, 'ctr_chi_phi_khac_thanh_toan', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật thanh toán chi phí khác.' });
  } finally {
    connection.release();
  }
});

router.delete('/ctr-chi-phi-khac/thanh-toan/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM ctr_chi_phi_khac_thanh_toan WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy chi tiết thanh toán.' });
    }

    const parentId = oldRow[0].id_ctr_chi_phi_khac;
    await connection.query('DELETE FROM ctr_chi_phi_khac_thanh_toan WHERE id = ?', [req.params.id]);
    await recalculateOtherCostPaid(connection, parentId);

    await logChange(connection, 'ctr_chi_phi_khac_thanh_toan', req.params.id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: 'Đã xóa chi tiết thanh toán chi phí khác.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa thanh toán chi phí khác.' });
  } finally {
    connection.release();
  }
});


// Recalculate labor contract paid total
async function recalculateLaborContractPaid(connection, id_hop_dong_nhan_cong) {
  const [sumRow] = await connection.query(
    'SELECT SUM(so_tien_thanh_toan) as total_paid FROM thanh_toan_nhan_cong WHERE id_hop_dong_nhan_cong = ?',
    [id_hop_dong_nhan_cong]
  );
  const totalPaid = parseFloat(sumRow[0].total_paid) || 0;

  const [parent] = await connection.query('SELECT gia_tri_hop_dong FROM hop_dong_nhan_cong WHERE id = ?', [
    id_hop_dong_nhan_cong
  ]);
  if (parent.length > 0) {
    const contractVal = parseFloat(parent[0].gia_tri_hop_dong) || 0;
    const remaining = contractVal - totalPaid;

    await connection.query(
      'UPDATE hop_dong_nhan_cong SET da_thanh_toan = ?, cong_no_con_lai = ? WHERE id = ?',
      [totalPaid, remaining, id_hop_dong_nhan_cong]
    );
  }
}

// 1. Get Labor Contracts list for a project
router.get('/hop-dong-nhan-cong', authMiddleware, async (req, res) => {
  const { id_cong_trinh } = req.query;
  if (!id_cong_trinh) {
    return res.status(400).json({ message: 'Thiếu ID công trình.' });
  }
  try {
    const [rows] = await pool.query(
      `SELECT h.*, nc.ho_ten AS ten_nhan_cong
       FROM hop_dong_nhan_cong h
       JOIN nhan_cong nc ON h.id_nhan_cong = nc.id
       WHERE h.id_cong_trinh = ?
       ORDER BY h.id DESC`,
      [id_cong_trinh]
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi lấy danh sách hợp đồng nhân công.' });
  }
});

// 2. Create Labor Contract
router.post('/hop-dong-nhan-cong', authMiddleware, authorize(['Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const { id_cong_trinh, id_nhan_cong, gia_tri_hop_dong } = req.body;
  if (!id_cong_trinh || !id_nhan_cong || gia_tri_hop_dong === undefined) {
    return res.status(400).json({ message: 'Thiếu thông tin bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const contractVal = parseFloat(gia_tri_hop_dong) || 0;
    const remaining = contractVal;

    const [result] = await connection.query(
      `INSERT INTO hop_dong_nhan_cong (id_cong_trinh, id_nhan_cong, gia_tri_hop_dong, da_thanh_toan, cong_no_con_lai, nguoi_tao)
       VALUES (?, ?, ?, 0, ?, ?)`,
      [id_cong_trinh, id_nhan_cong, contractVal, remaining, req.user.ten_dang_nhap]
    );

    const [newRow] = await connection.query(
      `SELECT h.*, nc.ho_ten AS ten_nhan_cong
       FROM hop_dong_nhan_cong h
       JOIN nhan_cong nc ON h.id_nhan_cong = nc.id
       WHERE h.id = ?`,
      [result.insertId]
    );

    await logChange(connection, 'hop_dong_nhan_cong', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi tạo hợp đồng nhân công.' });
  } finally {
    connection.release();
  }
});

// 3. Update Labor Contract
router.put('/hop-dong-nhan-cong/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const { id_nhan_cong, gia_tri_hop_dong } = req.body;
  if (!id_nhan_cong || gia_tri_hop_dong === undefined) {
    return res.status(400).json({ message: 'Thiếu thông tin bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [oldRow] = await connection.query('SELECT * FROM hop_dong_nhan_cong WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy hợp đồng nhân công.' });
    }

    const contractVal = parseFloat(gia_tri_hop_dong) || 0;
    const paid = parseFloat(oldRow[0].da_thanh_toan) || 0;
    const remaining = contractVal - paid;

    await connection.query(
      `UPDATE hop_dong_nhan_cong SET id_nhan_cong = ?, gia_tri_hop_dong = ?, cong_no_con_lai = ? WHERE id = ?`,
      [id_nhan_cong, contractVal, remaining, req.params.id]
    );

    const [newRow] = await connection.query(
      `SELECT h.*, nc.ho_ten AS ten_nhan_cong
       FROM hop_dong_nhan_cong h
       JOIN nhan_cong nc ON h.id_nhan_cong = nc.id
       WHERE h.id = ?`,
      [req.params.id]
    );

    await logChange(connection, 'hop_dong_nhan_cong', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật hợp đồng nhân công.' });
  } finally {
    connection.release();
  }
});

// 4. Delete Labor Contract
router.delete('/hop-dong-nhan-cong/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [oldRow] = await connection.query('SELECT * FROM hop_dong_nhan_cong WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy hợp đồng nhân công.' });
    }

    // Delete related payments first
    await connection.query('DELETE FROM thanh_toan_nhan_cong WHERE id_hop_dong_nhan_cong = ?', [req.params.id]);
    // Delete contract
    await connection.query('DELETE FROM hop_dong_nhan_cong WHERE id = ?', [req.params.id]);

    await logChange(connection, 'hop_dong_nhan_cong', req.params.id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: 'Đã xóa hợp đồng nhân công.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa hợp đồng nhân công.' });
  } finally {
    connection.release();
  }
});

// 5. Get Labor Contract Payments list
router.get('/thanh-toan-nhan-cong', authMiddleware, async (req, res) => {
  const { id_cong_trinh, id_hop_dong_nhan_cong } = req.query;
  if (!id_cong_trinh) {
    return res.status(400).json({ message: 'Thiếu ID công trình.' });
  }
  try {
    let query = `
      SELECT t.*, nc.ho_ten AS ten_nhan_cong, h.id_nhan_cong, h.gia_tri_hop_dong
      FROM thanh_toan_nhan_cong t
      JOIN hop_dong_nhan_cong h ON t.id_hop_dong_nhan_cong = h.id
      JOIN nhan_cong nc ON h.id_nhan_cong = nc.id
      WHERE h.id_cong_trinh = ?
    `;
    const params = [id_cong_trinh];

    if (id_hop_dong_nhan_cong) {
      query += ` AND t.id_hop_dong_nhan_cong = ?`;
      params.push(id_hop_dong_nhan_cong);
    }

    query += ` ORDER BY t.id DESC`;

    const [rows] = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi lấy danh sách thanh toán nhân công.' });
  }
});

// 6. Create Labor Contract Payment
router.post('/thanh-toan-nhan-cong', authMiddleware, authorize(['Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const { id_hop_dong_nhan_cong, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu } = req.body;
  if (!id_hop_dong_nhan_cong || !so_tien_thanh_toan || !ngay_thanh_toan) {
    return res.status(400).json({ message: 'Thiếu thông tin bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO thanh_toan_nhan_cong (id_hop_dong_nhan_cong, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu, nguoi_tao)
       VALUES (?, ?, ?, ?, ?)`,
      [id_hop_dong_nhan_cong, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu || null, req.user.ten_dang_nhap]
    );

    await recalculateLaborContractPaid(connection, id_hop_dong_nhan_cong);

    const [newRow] = await connection.query('SELECT * FROM thanh_toan_nhan_cong WHERE id = ?', [result.insertId]);
    await logChange(connection, 'thanh_toan_nhan_cong', result.insertId, 'THEM_MOI', null, newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi tạo thanh toán hợp đồng nhân công.' });
  } finally {
    connection.release();
  }
});

// 7. Update Labor Contract Payment
router.put('/thanh-toan-nhan-cong/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Ke_Toan']), async (req, res) => {
  const { id_hop_dong_nhan_cong, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu } = req.body;
  if (!id_hop_dong_nhan_cong || !so_tien_thanh_toan || !ngay_thanh_toan) {
    return res.status(400).json({ message: 'Thiếu thông tin bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM thanh_toan_nhan_cong WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy chi tiết thanh toán.' });
    }

    const parentId = id_hop_dong_nhan_cong || oldRow[0].id_hop_dong_nhan_cong;

    await connection.query(
      `UPDATE thanh_toan_nhan_cong SET id_hop_dong_nhan_cong = ?, so_tien_thanh_toan = ?, ngay_thanh_toan = ?, ghi_chu = ? WHERE id = ?`,
      [parentId, so_tien_thanh_toan, ngay_thanh_toan, ghi_chu !== undefined ? ghi_chu : oldRow[0].ghi_chu, req.params.id]
    );

    await recalculateLaborContractPaid(connection, parentId);
    if (oldRow[0].id_hop_dong_nhan_cong !== parentId) {
      await recalculateLaborContractPaid(connection, oldRow[0].id_hop_dong_nhan_cong);
    }

    const [newRow] = await connection.query('SELECT * FROM thanh_toan_nhan_cong WHERE id = ?', [req.params.id]);
    await logChange(connection, 'thanh_toan_nhan_cong', req.params.id, 'CAP_NHAT', oldRow[0], newRow[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật thanh toán hợp đồng nhân công.' });
  } finally {
    connection.release();
  }
});

// 8. Delete Labor Contract Payment
router.delete('/thanh-toan-nhan-cong/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM thanh_toan_nhan_cong WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy chi tiết thanh toán.' });
    }

    const parentId = oldRow[0].id_hop_dong_nhan_cong;
    await connection.query('DELETE FROM thanh_toan_nhan_cong WHERE id = ?', [req.params.id]);
    await recalculateLaborContractPaid(connection, parentId);

    await logChange(connection, 'thanh_toan_nhan_cong', req.params.id, 'XOA', oldRow[0], null, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: 'Đã xóa chi tiết thanh toán hợp đồng nhân công.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi xóa thanh toán hợp đồng nhân công.' });
  } finally {
    connection.release();
  }
});

module.exports = router;

