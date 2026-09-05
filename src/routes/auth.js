const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'bv_secret_key_2026_jwt_token_secure';

// Login route
router.post('/login', async (req, res) => {
  const { ten_dang_nhap, mat_khau } = req.body;

  if (!ten_dang_nhap || !mat_khau) {
    return res.status(400).json({ message: 'Vui lòng điền tên đăng nhập và mật khẩu.' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT * FROM nguoi_dung WHERE ten_dang_nhap = ? AND trang_thai = "Hoat_Dong"',
      [ten_dang_nhap]
    );

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Tài khoản không tồn tại hoặc đã bị khóa.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(mat_khau, user.mat_khau);

    if (!isMatch) {
      return res.status(401).json({ message: 'Mật khẩu không chính xác.' });
    }

    // Record login event in nguoi_dung_lich_su
    try {
      await pool.query(
        'INSERT INTO nguoi_dung_lich_su (id_nguoi_dung, ten_dang_nhap, ho_ten, hanh_dong) VALUES (?, ?, ?, ?)',
        [user.id, user.ten_dang_nhap, user.ho_ten, 'Dang_Nhap']
      );
    } catch (logErr) {
      console.warn('Could not insert login log into nguoi_dung_lich_su:', logErr.message);
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, ten_dang_nhap: user.ten_dang_nhap, vai_tro: user.vai_tro, ho_ten: user.ho_ten },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        ten_dang_nhap: user.ten_dang_nhap,
        ho_ten: user.ho_ten,
        vai_tro: user.vai_tro
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

// Logout route to record logout event
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO nguoi_dung_lich_su (id_nguoi_dung, ten_dang_nhap, ho_ten, hanh_dong) VALUES (?, ?, ?, ?)',
      [req.user.id, req.user.ten_dang_nhap, req.user.ho_ten || '', 'Dang_Xuat']
    );
    return res.json({ message: 'Đăng xuất thành công.' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ message: 'Lỗi ghi nhận lịch sử đăng xuất.' });
  }
});

// Admin: Get user login/logout history
router.get('/login-history', authMiddleware, authorize(['Admin']), async (req, res) => {
  try {
    const { search, from_date, to_date } = req.query;
    let query = 'SELECT * FROM nguoi_dung_lich_su WHERE 1=1';
    const params = [];

    if (search && search.trim()) {
      query += ' AND (ten_dang_nhap LIKE ? OR ho_ten LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }
    if (from_date) {
      query += ' AND DATE(thoi_gian) >= ?';
      params.push(from_date);
    }
    if (to_date) {
      query += ' AND DATE(thoi_gian) <= ?';
      params.push(to_date);
    }

    query += ' ORDER BY id DESC';

    const [rows] = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error('Get login history error:', err);
    return res.status(500).json({ message: 'Lỗi tải lịch sử đăng nhập.' });
  }
});

// Register new user (For admin creation or initial setups)
router.post('/register', async (req, res) => {
  const { ten_dang_nhap, mat_khau, ho_ten, ho_ten_ngan, vai_tro } = req.body;

  if (!ten_dang_nhap || !mat_khau || !ho_ten || !vai_tro) {
    return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ thông tin.' });
  }

  try {
    // Check if user exists
    const [existing] = await pool.query('SELECT id FROM nguoi_dung WHERE ten_dang_nhap = ?', [
      ten_dang_nhap
    ]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(mat_khau, salt);

    // Insert user
    const [result] = await pool.query(
      `INSERT INTO nguoi_dung (ten_dang_nhap, mat_khau, ho_ten, ho_ten_ngan, vai_tro, nguoi_tao) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ten_dang_nhap, hashedPassword, ho_ten, ho_ten_ngan || null, vai_tro, 'Hệ thống']
    );

    return res.status(201).json({
      message: 'Đăng ký tài khoản thành công.',
      id: result.insertId
    });
  } catch (err) {
    console.error('Registration error:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

// Get self info
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, ten_dang_nhap, ho_ten, vai_tro, trang_thai, thoi_gian_tao FROM nguoi_dung WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy thông tin người dùng.' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ.' });
  }
});

// User: Self change password with strict security validations
router.put('/change-password', authMiddleware, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ message: 'Mật khẩu mới phải có độ dài tối thiểu 6 ký tự.' });
  }

  if (confirm_password !== undefined && new_password !== confirm_password) {
    return res.status(400).json({ message: 'Mật khẩu xác nhận không khớp với mật khẩu mới.' });
  }

  if (current_password === new_password) {
    return res.status(400).json({ message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM nguoi_dung WHERE id = ?', [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy thông tin tài khoản người dùng.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(current_password, user.mat_khau);
    if (!isMatch) {
      return res.status(400).json({ message: 'Mật khẩu hiện tại không chính xác.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    await pool.query('UPDATE nguoi_dung SET mat_khau = ? WHERE id = ?', [hashedPassword, req.user.id]);

    // Record password change event in nguoi_dung_lich_su
    try {
      await pool.query(
        'INSERT INTO nguoi_dung_lich_su (id_nguoi_dung, ten_dang_nhap, ho_ten, hanh_dong) VALUES (?, ?, ?, ?)',
        [user.id, user.ten_dang_nhap, user.ho_ten, 'Doi_Mat_Khau']
      );
    } catch (logErr) {
      console.warn('Could not insert change password log:', logErr.message);
    }

    return res.json({ message: 'Đổi mật khẩu thành công! Vui lòng ghi nhớ và bảo mật thông tin tài khoản.' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ message: 'Lỗi máy chủ khi đổi mật khẩu.' });
  }
});

// Admin: Get all users
router.get('/users', authMiddleware, authorize(['Admin']), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, ten_dang_nhap, ho_ten, ho_ten_ngan, vai_tro, trang_thai, nguoi_tao, thoi_gian_tao FROM nguoi_dung ORDER BY id DESC');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi tải danh sách người dùng.' });
  }
});

// Admin: Create user with multiple roles
router.post('/users', authMiddleware, authorize(['Admin']), async (req, res) => {
  const { ten_dang_nhap, mat_khau, ho_ten, ho_ten_ngan, vai_tro } = req.body;
  if (!ten_dang_nhap || !mat_khau || !ho_ten || !vai_tro) {
    return res.status(400).json({ message: 'Vui lòng cung cấp đầy đủ thông tin.' });
  }
  
  const rolesString = Array.isArray(vai_tro) ? vai_tro.join(',') : vai_tro;

  try {
    const [existing] = await pool.query('SELECT id FROM nguoi_dung WHERE ten_dang_nhap = ?', [ten_dang_nhap]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(mat_khau, salt);

    const [result] = await pool.query(
      `INSERT INTO nguoi_dung (ten_dang_nhap, mat_khau, ho_ten, ho_ten_ngan, vai_tro, nguoi_tao) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ten_dang_nhap, hashedPassword, ho_ten, ho_ten_ngan || null, rolesString, req.user.ten_dang_nhap]
    );

    return res.status(201).json({
      id: result.insertId,
      ten_dang_nhap,
      ho_ten,
      ho_ten_ngan: ho_ten_ngan || null,
      vai_tro: rolesString,
      trang_thai: 'Hoat_Dong'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi tạo tài khoản.' });
  }
});

// Admin: Update user details / change roles / password reset
router.put('/users/:id', authMiddleware, authorize(['Admin']), async (req, res) => {
  const { ho_ten, ho_ten_ngan, vai_tro, trang_thai, mat_khau } = req.body;
  const rolesString = Array.isArray(vai_tro) ? vai_tro.join(',') : vai_tro;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT * FROM nguoi_dung WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }

    const updateKeys = [];
    const updateValues = [];

    if (ho_ten !== undefined) {
      updateKeys.push('ho_ten = ?');
      updateValues.push(ho_ten);
    }
    if (ho_ten_ngan !== undefined) {
      updateKeys.push('ho_ten_ngan = ?');
      updateValues.push(ho_ten_ngan || null);
    }
    if (rolesString !== undefined) {
      updateKeys.push('vai_tro = ?');
      updateValues.push(rolesString);
    }
    if (trang_thai !== undefined) {
      updateKeys.push('trang_thai = ?');
      updateValues.push(trang_thai);
    }
    if (mat_khau) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(mat_khau, salt);
      updateKeys.push('mat_khau = ?');
      updateValues.push(hashedPassword);
    }

    if (updateKeys.length > 0) {
      updateValues.push(req.params.id);
      await connection.query(
        `UPDATE nguoi_dung SET ${updateKeys.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    const [updatedUser] = await connection.query(
      'SELECT id, ten_dang_nhap, ho_ten, ho_ten_ngan, vai_tro, trang_thai FROM nguoi_dung WHERE id = ?',
      [req.params.id]
    );

    await logChange(connection, 'nguoi_dung', req.params.id, 'CAP_NHAT', existing[0], updatedUser[0], req.user.ten_dang_nhap);
    await connection.commit();
    return res.json(updatedUser[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi cập nhật tài khoản.' });
  } finally {
    connection.release();
  }
});

// Admin: Delete user (Only allowed if no linked records in any table)
router.delete('/users/:id', authMiddleware, authorize(['Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query('SELECT * FROM nguoi_dung WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy người dùng.' });
    }

    const user = existing[0];
    if (user.ten_dang_nhap === 'admin') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Không thể xóa tài khoản Admin mặc định hệ thống.' });
    }

    // Check if the user is trying to delete their own currently logged-in account
    if (req.user?.id === user.id) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Bạn không thể tự xóa tài khoản đang đăng nhập của chính mình.' });
    }

    const username = user.ten_dang_nhap;
    const constraints = [];

    // Helper to check counts safely in each table
    const checkTable = async (tableName, condition, params, label) => {
      try {
        const [rows] = await connection.query(`SELECT COUNT(*) as cnt FROM ${tableName} WHERE ${condition}`, params);
        if (rows[0]?.cnt > 0) {
          constraints.push(`${rows[0].cnt} ${label}`);
        }
      } catch (e) {
        // Table or column might not exist in database, skip
      }
    };

    // 1. Đơn hàng bán (POS / Bán hàng)
    await checkTable('don_hang', 'nguoi_tao = ? OR nhan_vien_ban_hang = ?', [username, username], 'Đơn hàng bán');

    // 2. Phiếu thu chi & Sổ quỹ
    await checkTable('phieu_thu_chi', 'nguoi_tao = ?', [username], 'Phiếu thu/chi');

    // 3. Đề nghị thanh toán
    await checkTable('de_nghi_thanh_toan', 'nguoi_tao = ? OR nguoi_de_nghi = ? OR tbp_nguoi_duyet = ? OR gdtc_nguoi_duyet = ?', [username, username, username, username], 'Đề nghị thanh toán');

    // 4. Quản lý kho (Nhập kho, Xuất kho)
    await checkTable('phieu_nhap_kho', 'nguoi_tao = ?', [username], 'Phiếu nhập kho');
    await checkTable('phieu_xuat_kho', 'nguoi_tao = ?', [username], 'Phiếu xuất kho');

    // 5. Mua hàng & Yêu cầu mua sắm
    await checkTable('phieu_mua_hang', 'nguoi_tao = ?', [username], 'Phiếu mua hàng');
    await checkTable('yeu_cau_mua_hang', 'nguoi_tao = ? OR nguoi_yeu_cau = ?', [username, username], 'Yêu cầu mua hàng');

    // 6. Quản lý công trình & Vật tư công trình
    await checkTable('cong_trinh', 'nguoi_tao = ?', [username], 'Công trình/Dự án');
    await checkTable('dieu_chuyen_vat_tu', 'nguoi_tao = ?', [username], 'Điều chuyển vật tư');
    await checkTable('vat_tu_cong_trinh_dau_ra', 'nguoi_tao = ?', [username], 'Phiếu xuất công trình đầu ra');
    await checkTable('thanh_toan_nhan_cong', 'nguoi_tao = ?', [username], 'Thanh toán nhân công');
    await checkTable('thanh_toan_thau_phu', 'nguoi_tao = ?', [username], 'Thanh toán thầu phụ');
    await checkTable('thanh_toan_ca_may', 'nguoi_tao = ?', [username], 'Thanh toán ca máy');
    await checkTable('ctr_chi_phi_khac_thanh_toan', 'nguoi_tao = ?', [username], 'Thanh toán chi phí khác');

    // 7. Hợp đồng kinh tế
    await checkTable('hop_dong', 'nguoi_tao = ?', [username], 'Hợp đồng kinh tế');

    // 8. Khách hàng & Nhà cung cấp
    await checkTable('khach_hang', 'nguoi_tao = ?', [username], 'Khách hàng');
    await checkTable('nha_cung_cap', 'nguoi_tao = ?', [username], 'Nhà cung cấp');
    await checkTable('chi_tiet_gach_no_khach_hang', 'nguoi_tao = ?', [username], 'Gạch nợ khách hàng');
    await checkTable('chi_tiet_gach_no_ncc', 'nguoi_tao = ?', [username], 'Gạch nợ nhà cung cấp');
    await checkTable('cong_no_khac_ncc', 'nguoi_tao = ?', [username], 'Công nợ dịch vụ NCC');

    // 9. Nhật ký thao tác hệ thống
    await checkTable('nhat_ky_thao_tac', 'nguoi_thuc_hien = ? OR nguoi_dung = ?', [username, username], 'Nhật ký thao tác nghiệp vụ');

    if (constraints.length > 0) {
      await connection.rollback();
      connection.release();
      const detailStr = constraints.slice(0, 4).join(', ') + (constraints.length > 4 ? ` và ${constraints.length - 4} danh mục khác` : '');
      return res.status(400).json({
        message: `Không thể xóa tài khoản "${user.ho_ten || user.ten_dang_nhap}" (${user.ten_dang_nhap}) vì đã phát sinh dữ liệu liên kết trên hệ thống (${detailStr}). Vui lòng chuyển trạng thái tài khoản sang "Đã khóa" thay vì xóa!`
      });
    }

    // If completely clean, delete any history record and the user itself
    try {
      await connection.query('DELETE FROM nguoi_dung_lich_su WHERE id_nguoi_dung = ? OR ten_dang_nhap = ?', [user.id, username]);
    } catch (e) {}

    await connection.query('DELETE FROM nguoi_dung WHERE id = ?', [req.params.id]);
    await logChange(connection, 'nguoi_dung', req.params.id, 'XOA', user, null, req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({ message: `Đã xóa tài khoản "${user.ho_ten || user.ten_dang_nhap}" thành công.` });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting user:', err);
    return res.status(500).json({ message: 'Lỗi khi xóa người dùng: ' + err.message });
  } finally {
    connection.release();
  }
});

// Admin: GET AI Settings
router.get('/ai-settings', authMiddleware, authorize(['Admin']), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT `key`, `value` FROM setting');
    const settingsMap = {};
    rows.forEach(r => {
      settingsMap[r.key] = r.value;
    });

    const openAiVal = settingsMap.openai_api_key || process.env.OPENAI_API_KEY || '';
    const geminiVal = settingsMap.gemini_api_key || process.env.GEMINI_API_KEY || '';
    const customKeyVal = settingsMap.ai_custom_key || process.env.CUSTOM_LLM_KEY || '';

    res.json({
      ai_openai: settingsMap.ai_openai || '0',
      ai_gemini: settingsMap.ai_gemini || '0',
      ai_custom: settingsMap.ai_custom || '1',
      ai_custom_url: settingsMap.ai_custom_url || process.env.CUSTOM_LLM_URL || 'http://localhost:20128/v1',
      ai_custom_model: settingsMap.ai_custom_model || process.env.CUSTOM_LLM_MODEL || 'ag/gemini-3.7-flash-medium',
      // Do NOT send raw API keys to client for security
      ai_custom_key: '',
      openai_api_key: '',
      gemini_api_key: '',
      has_openai_key: !!(openAiVal && openAiVal.trim()),
      has_gemini_key: !!(geminiVal && geminiVal.trim()),
      has_custom_key: !!(customKeyVal && customKeyVal.trim())
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi nạp cấu hình AI.' });
  }
});

// Admin: PUT & POST AI Settings
const saveAiSettingsHandler = async (req, res) => {
  const {
    selected_provider, // 'ai_openai', 'ai_gemini', or 'ai_custom'
    ai_custom_url,
    ai_custom_model,
    ai_custom_key,
    openai_api_key,
    gemini_api_key
  } = req.body;

  if (!['ai_openai', 'ai_gemini', 'ai_custom'].includes(selected_provider)) {
    return res.status(400).json({ message: 'Vui lòng chọn 1 mô hình AI hợp lệ (ai_openai, ai_gemini, ai_custom)!' });
  }

  try {
    const ai_openai_val = selected_provider === 'ai_openai' ? '1' : '0';
    const ai_gemini_val = selected_provider === 'ai_gemini' ? '1' : '0';
    const ai_custom_val = selected_provider === 'ai_custom' ? '1' : '0';

    const updates = [
      ['ai_openai', ai_openai_val, 'Sử dụng OpenAI Vision API (0: Disable, 1: Enable)'],
      ['ai_gemini', ai_gemini_val, 'Sử dụng Google Gemini Vision API (0: Disable, 1: Enable)'],
      ['ai_custom', ai_custom_val, 'Sử dụng Custom Local LLM Gateway (0: Disable, 1: Enable)'],
      ['ai_custom_url', ai_custom_url || 'http://localhost:20128/v1', 'URL Custom LLM Gateway'],
      ['ai_custom_model', ai_custom_model || 'ag/gemini-3.7-flash-medium', 'Tên Model trên Custom LLM Gateway']
    ];

    // Only update API keys in DB if user typed a non-empty new key
    if (typeof ai_custom_key === 'string' && ai_custom_key.trim() !== '') {
      updates.push(['ai_custom_key', ai_custom_key.trim(), 'API Key trên Custom LLM Gateway']);
    }
    if (typeof openai_api_key === 'string' && openai_api_key.trim() !== '') {
      updates.push(['openai_api_key', openai_api_key.trim(), 'API Key OpenAI GPT-4o']);
    }
    if (typeof gemini_api_key === 'string' && gemini_api_key.trim() !== '') {
      updates.push(['gemini_api_key', gemini_api_key.trim(), 'API Key Google Gemini']);
    }

    for (const [k, v, note] of updates) {
      await pool.query(
        `INSERT INTO setting (\`key\`, \`value\`, \`ghi_chu\`) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), \`ghi_chu\` = VALUES(\`ghi_chu\`)`,
        [k, v, note]
      );
    }

    res.json({
      message: 'Cập nhật cấu hình mô hình AI thành công!',
      selected_provider,
      ai_openai: ai_openai_val,
      ai_gemini: ai_gemini_val,
      ai_custom: ai_custom_val
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lỗi cập nhật cấu hình AI.' });
  }
};

// ==========================================
// QUẢN LÝ DANH MỤC MÃ LOẠI PHIẾU / CHỨNG TỪ
// ==========================================

// GET: Lấy danh sách tất cả các loại chứng từ
router.get('/voucher-types', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM danh_muc_loai_phieu ORDER BY thu_tu ASC, id ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching voucher types:', err);
    res.status(500).json({ message: 'Lỗi nạp danh mục loại chứng từ.' });
  }
});

// PUT: Cập nhật mã loại phiếu (Yêu cầu Admin / Ban Giám Đốc)
router.put('/voucher-types/:id', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc']), async (req, res) => {
  const { id } = req.params;
  const { ma_loai_phieu, ten_loai_phieu, do_dai_chuoi_so, theo_nam, mo_ta } = req.body;

  const cleanPrefix = (ma_loai_phieu || '').trim().toUpperCase();

  // Validate format if not empty: only letters, numbers, and dashes
  if (cleanPrefix && !/^[A-Z0-9_-]+$/.test(cleanPrefix)) {
    return res.status(400).json({ message: 'Tiền tố mã chỉ được chứa chữ cái in hoa, số và dấu gạch nối (không chứa dấu cách hoặc dấu gạch chéo /).' });
  }

  let numDigits = parseInt(do_dai_chuoi_so, 10);
  if (isNaN(numDigits) || numDigits < 1 || numDigits > 10) {
    numDigits = 5;
  }

  try {
    const [existing] = await pool.query('SELECT * FROM danh_muc_loai_phieu WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy loại chứng từ.' });
    }

    const oldData = existing[0];
    const isYearly = theo_nam === undefined || theo_nam === null
      ? (oldData.theo_nam !== undefined && oldData.theo_nam !== null ? oldData.theo_nam : 1)
      : (Boolean(theo_nam) && theo_nam !== 0 && String(theo_nam) !== '0' ? 1 : 0);

    if (!cleanPrefix) {
      // Check if another document type already has an empty prefix
      const [emptyExisting] = await pool.query(
        'SELECT * FROM danh_muc_loai_phieu WHERE id != ? AND (ma_loai_phieu = "" OR ma_loai_phieu IS NULL)',
        [id]
      );
      if (emptyExisting.length > 0) {
        return res.status(400).json({
          message: `Loại chứng từ "${emptyExisting[0].ten_loai_phieu}" (${emptyExisting[0].ma_he_thong}) đang để trống tiền tố. Hệ thống chỉ cho phép tối đa 1 loại chứng từ được để trống tiền tố mã.`
        });
      }
    } else {
      // Check if this non-empty prefix is already used by another document type (Unique Check)
      const [duplicate] = await pool.query(
        'SELECT * FROM danh_muc_loai_phieu WHERE id != ? AND UPPER(TRIM(ma_loai_phieu)) = ?',
        [id, cleanPrefix]
      );
      if (duplicate.length > 0) {
        return res.status(400).json({
          message: `Tiền tố mã "${cleanPrefix}" đã được sử dụng cho loại chứng từ "${duplicate[0].ten_loai_phieu}" (${duplicate[0].ma_he_thong}). Vui lòng nhập tiền tố duy nhất.`
        });
      }
    }

    await pool.query(
      `UPDATE danh_muc_loai_phieu 
       SET ma_loai_phieu = ?, ten_loai_phieu = ?, do_dai_chuoi_so = ?, theo_nam = ?, mo_ta = ?
       WHERE id = ?`,
      [cleanPrefix, ten_loai_phieu?.trim() || oldData.ten_loai_phieu, numDigits, isYearly, mo_ta !== undefined ? mo_ta : oldData.mo_ta, id]
    );

    const [updated] = await pool.query('SELECT * FROM danh_muc_loai_phieu WHERE id = ?', [id]);
    res.json({
      message: cleanPrefix
        ? `Cập nhật tiền tố mã loại phiếu "${updated[0].ten_loai_phieu}" thành "${cleanPrefix}" (độ dài chuỗi số: ${numDigits}, ${isYearly ? 'đánh số theo năm' : 'tăng liên tục'}) thành công!`
        : `Cập nhật loại phiếu "${updated[0].ten_loai_phieu}" (độ dài chuỗi số: ${numDigits}, ${isYearly ? 'đánh số theo năm' : 'tăng liên tục'}) thành công!`,
      voucher_type: updated[0]
    });
  } catch (err) {
    console.error('Error updating voucher type:', err);
    res.status(500).json({ message: 'Lỗi cập nhật mã loại chứng từ.' });
  }
});

// POST: Khôi phục mã loại phiếu về mặc định ban đầu
router.post('/voucher-types/reset-defaults', authMiddleware, authorize(['Admin', 'Ban_Giam_Doc']), async (req, res) => {
  try {
    await pool.query('UPDATE danh_muc_loai_phieu SET ma_loai_phieu = ma_he_thong, do_dai_chuoi_so = 5, theo_nam = 1');
    const [rows] = await pool.query('SELECT * FROM danh_muc_loai_phieu ORDER BY thu_tu ASC, id ASC');
    res.json({
      message: 'Đã khôi phục toàn bộ tiền tố mã, độ dài chuỗi số (5 chữ số) và tùy chọn theo năm về mặc định chuẩn hệ thống!',
      voucher_types: rows
    });
  } catch (err) {
    console.error('Error resetting voucher types:', err);
    res.status(500).json({ message: 'Lỗi khôi phục danh mục loại chứng từ.' });
  }
});

module.exports = router;
