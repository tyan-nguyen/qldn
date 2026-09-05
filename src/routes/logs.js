const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

// Safe JSON parser to prevent crashes on non-JSON strings
const safeJsonParse = (val) => {
  if (!val) return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch (e) {
    return { raw: val };
  }
};

// Get the latest history logs globally with pagination
router.get('/latest', authMiddleware, async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const offset = (page - 1) * limit;

    const [countResult] = await pool.query('SELECT COUNT(*) as total FROM nhat_ky_thao_tac');
    const total = countResult[0]?.total || 0;

    const [rows] = await pool.query(
      `SELECT 
         l.*,
         u.ho_ten,
         u.ten_dang_nhap
       FROM nhat_ky_thao_tac l
       LEFT JOIN nguoi_dung u ON (l.nguoi_tao = u.ten_dang_nhap OR l.nguoi_tao = u.ho_ten)
       ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const parsedLogs = rows.map(r => ({
      id: r.id,
      ten_bang: r.ten_bang,
      id_ban_ghi: r.id_ban_ghi,
      hanh_dong: r.hanh_dong,
      du_lieu_cu: safeJsonParse(r.du_lieu_cu),
      du_lieu_moi: safeJsonParse(r.du_lieu_moi),
      nguoi_tao: r.nguoi_tao,
      ho_ten: r.ho_ten,
      ten_dang_nhap: r.ten_dang_nhap,
      thoi_gian_tao: r.thoi_gian_tao
    }));

    return res.json({
      data: parsedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Error fetching latest logs:', err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách log mới nhất.' });
  }
});

// Search history logs
router.get('/search', authMiddleware, async (req, res) => {
  const { ten_bang, id_ban_ghi, hanh_dong, search, fromDate, toDate } = req.query;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const offset = (page - 1) * limit;

  try {
    const whereClauses = [];
    const params = [];

    if (id_ban_ghi && String(id_ban_ghi).trim() !== '') {
      whereClauses.push('l.id_ban_ghi = ?');
      params.push(parseInt(id_ban_ghi, 10) || id_ban_ghi);
    }

    if (ten_bang && ten_bang !== 'all') {
      whereClauses.push('l.ten_bang = ?');
      params.push(ten_bang);
    }

    if (hanh_dong && hanh_dong !== 'all') {
      whereClauses.push('l.hanh_dong = ?');
      params.push(hanh_dong);
    }

    if (search && search.trim() !== '') {
      whereClauses.push('(l.nguoi_tao LIKE ? OR u.ho_ten LIKE ? OR l.ten_bang LIKE ?)');
      const searchParam = `%${search.trim()}%`;
      params.push(searchParam, searchParam, searchParam);
    }

    if (fromDate && fromDate.trim() !== '') {
      whereClauses.push('l.thoi_gian_tao >= ?');
      params.push(`${fromDate.trim()} 00:00:00`);
    }

    if (toDate && toDate.trim() !== '') {
      whereClauses.push('l.thoi_gian_tao <= ?');
      params.push(`${toDate.trim()} 23:59:59`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM nhat_ky_thao_tac l
      LEFT JOIN nguoi_dung u ON (l.nguoi_tao = u.ten_dang_nhap OR l.nguoi_tao = u.ho_ten)
      ${whereSql}
    `;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0]?.total || 0;

    const dataQuery = `
      SELECT 
        l.*,
        u.ho_ten,
        u.ten_dang_nhap
      FROM nhat_ky_thao_tac l
      LEFT JOIN nguoi_dung u ON (l.nguoi_tao = u.ten_dang_nhap OR l.nguoi_tao = u.ho_ten)
      ${whereSql}
      ORDER BY l.id DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(dataQuery, [...params, limit, offset]);

    const parsedLogs = rows.map(r => ({
      id: r.id,
      ten_bang: r.ten_bang,
      id_ban_ghi: r.id_ban_ghi,
      hanh_dong: r.hanh_dong,
      du_lieu_cu: safeJsonParse(r.du_lieu_cu),
      du_lieu_moi: safeJsonParse(r.du_lieu_moi),
      nguoi_tao: r.nguoi_tao,
      ho_ten: r.ho_ten,
      ten_dang_nhap: r.ten_dang_nhap,
      thoi_gian_tao: r.thoi_gian_tao
    }));

    return res.json({
      data: parsedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('Error searching logs:', err);
    return res.status(500).json({ message: 'Lỗi truy vấn lịch sử thao tác.' });
  }
});

// Get history logs for a specific record ID in a table
router.get('/:ten_bang/:id_ban_ghi', authMiddleware, async (req, res) => {
  const { ten_bang, id_ban_ghi } = req.params;

  try {
    const [rows] = await pool.query(
      `SELECT 
         l.*,
         u.ho_ten,
         u.ten_dang_nhap
       FROM nhat_ky_thao_tac l
       LEFT JOIN nguoi_dung u ON (l.nguoi_tao = u.ten_dang_nhap OR l.nguoi_tao = u.ho_ten)
       WHERE l.ten_bang = ? AND l.id_ban_ghi = ? 
       ORDER BY l.id DESC`,
      [ten_bang, id_ban_ghi]
    );

    const parsedLogs = rows.map(r => ({
      id: r.id,
      ten_bang: r.ten_bang,
      id_ban_ghi: r.id_ban_ghi,
      hanh_dong: r.hanh_dong,
      du_lieu_cu: safeJsonParse(r.du_lieu_cu),
      du_lieu_moi: safeJsonParse(r.du_lieu_moi),
      nguoi_tao: r.nguoi_tao,
      ho_ten: r.ho_ten,
      ten_dang_nhap: r.ten_dang_nhap,
      thoi_gian_tao: r.thoi_gian_tao
    }));

    return res.json(parsedLogs);
  } catch (err) {
    console.error('Error fetching record logs:', err);
    return res.status(500).json({ message: 'Lỗi truy vấn lịch sử thao tác.' });
  }
});

module.exports = router;
