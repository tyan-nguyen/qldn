const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');
const { generateSequenceNumber } = require('../services/sequenceService');

const uploadsDir = path.join(__dirname, '../../public/uploads/contracts');
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
    cb(null, 'hd-' + uniqueSuffix + ext);
  }
});
const upload = multer({ storage });

// 1. Get Distinct Years of Contracts
router.get('/years', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT nam FROM hop_dong WHERE da_xoa = 0 ORDER BY nam DESC`
    );
    const currentYear = new Date().getFullYear();
    let years = rows.map(r => r.nam);
    if (!years.includes(currentYear)) {
      years.unshift(currentYear);
    }
    return res.json(years);
  } catch (err) {
    console.error('Error fetching contract years:', err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách năm hợp đồng.' });
  }
});

// 2. Get Contracts List with Filters & Pagination & Statistics
router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      nam,
      id_linh_vuc_kinh_doanh,
      id_khach_hang,
      id_cong_trinh,
      trang_thai,
      search,
      page = 1,
      limit = 10
    } = req.query;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const offset = (pageNum - 1) * limitNum;

    let whereClause = 'WHERE h.da_xoa = 0';
    const params = [];

    if (nam) {
      whereClause += ' AND h.nam = ?';
      params.push(parseInt(nam, 10));
    }

    if (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') {
      whereClause += ' AND h.id_linh_vuc_kinh_doanh = ?';
      params.push(parseInt(id_linh_vuc_kinh_doanh, 10));
    }

    if (id_khach_hang) {
      whereClause += ' AND h.id_khach_hang = ?';
      params.push(parseInt(id_khach_hang, 10));
    }

    if (id_cong_trinh) {
      whereClause += ' AND h.id_cong_trinh = ?';
      params.push(parseInt(id_cong_trinh, 10));
    }

    if (trang_thai && trang_thai !== 'all') {
      whereClause += ' AND h.trang_thai = ?';
      params.push(trang_thai);
    }

    if (search && search.trim()) {
      whereClause += ` AND (
        h.ma_hop_dong LIKE ? OR 
        h.ten_hop_dong LIKE ? OR 
        k.ten_khach_hang LIKE ? OR 
        c.ten_cong_trinh LIKE ?
      )`;
      const s = `%${search.trim()}%`;
      params.push(s, s, s, s);
    }

    // Query Stats
    const [statsRows] = await pool.query(
      `SELECT 
        COUNT(h.id) AS tong_so_hop_dong,
        COALESCE(SUM(h.gia_tri_hop_dong), 0) AS tong_gia_tri,
        COALESCE(SUM(h.da_thanh_toan), 0) AS tong_da_thanh_toan,
        COALESCE(SUM(h.con_lai), 0) AS tong_con_lai
       FROM hop_dong h
       LEFT JOIN khach_hang k ON h.id_khach_hang = k.id
       LEFT JOIN cong_trinh c ON h.id_cong_trinh = c.id
       ${whereClause}`,
      params
    );

    const total = statsRows[0]?.tong_so_hop_dong || 0;
    const totalPages = Math.ceil(total / limitNum) || 1;

    // Query paginated list
    const [rows] = await pool.query(
      `SELECT 
        h.*,
        k.ten_khach_hang,
        k.so_dien_thoai AS sdt_khach_hang,
        k.dia_chi AS dia_chi_khach_hang,
        c.ten_cong_trinh,
        c.ten_viet_tat AS ten_viet_tat_cong_trinh,
        l.ten_lvkd,
        l.ma_lvkd,
        (SELECT COUNT(*) FROM hop_dong_dot_thanh_toan d WHERE d.id_hop_dong = h.id) AS so_dot_thanh_toan,
        (SELECT COUNT(*) FROM hop_dong_file f WHERE f.id_hop_dong = h.id) AS so_luong_file
       FROM hop_dong h
       LEFT JOIN khach_hang k ON h.id_khach_hang = k.id
       LEFT JOIN cong_trinh c ON h.id_cong_trinh = c.id
       LEFT JOIN linh_vuc_kinh_doanh l ON h.id_linh_vuc_kinh_doanh = l.id
       ${whereClause}
       ORDER BY h.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.json({
      items: rows,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages,
      stats: {
        tong_so_hop_dong: total,
        tong_gia_tri: parseFloat(statsRows[0]?.tong_gia_tri || 0),
        tong_da_thanh_toan: parseFloat(statsRows[0]?.tong_da_thanh_toan || 0),
        tong_con_lai: parseFloat(statsRows[0]?.tong_con_lai || 0)
      }
    });
  } catch (err) {
    console.error('Error fetching contracts list:', err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách hợp đồng.' });
  }
});

// 3. Get Contracts by Project ID
router.get('/by-project/:id_cong_trinh', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        h.*,
        k.ten_khach_hang,
        l.ten_lvkd,
        (SELECT COUNT(*) FROM hop_dong_dot_thanh_toan d WHERE d.id_hop_dong = h.id) AS so_dot_thanh_toan
       FROM hop_dong h
       LEFT JOIN khach_hang k ON h.id_khach_hang = k.id
       LEFT JOIN linh_vuc_kinh_doanh l ON h.id_linh_vuc_kinh_doanh = l.id
       WHERE h.id_cong_trinh = ? AND h.da_xoa = 0
       ORDER BY h.id DESC`,
      [req.params.id_cong_trinh]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching contracts by project:', err);
    return res.status(500).json({ message: 'Lỗi truy vấn hợp đồng công trình.' });
  }
});

// 4. Get Contracts by Customer ID
router.get('/by-customer/:id_khach_hang', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        h.*,
        c.ten_cong_trinh,
        l.ten_lvkd
       FROM hop_dong h
       LEFT JOIN cong_trinh c ON h.id_cong_trinh = c.id
       LEFT JOIN linh_vuc_kinh_doanh l ON h.id_linh_vuc_kinh_doanh = l.id
       WHERE h.id_khach_hang = ? AND h.da_xoa = 0
       ORDER BY h.id DESC`,
      [req.params.id_khach_hang]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching contracts by customer:', err);
    return res.status(500).json({ message: 'Lỗi truy vấn hợp đồng khách hàng.' });
  }
});

// 5. Get Single Contract Detail (with Terms & Files)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        h.*,
        k.ten_khach_hang,
        k.so_dien_thoai AS sdt_khach_hang,
        k.dia_chi AS dia_chi_khach_hang,
        k.ma_so_thue AS mst_khach_hang,
        c.ten_cong_trinh,
        c.dia_chi AS dia_chi_cong_trinh,
        l.ten_lvkd,
        l.ma_lvkd
       FROM hop_dong h
       LEFT JOIN khach_hang k ON h.id_khach_hang = k.id
       LEFT JOIN cong_trinh c ON h.id_cong_trinh = c.id
       LEFT JOIN linh_vuc_kinh_doanh l ON h.id_linh_vuc_kinh_doanh = l.id
       WHERE h.id = ? AND h.da_xoa = 0`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy hợp đồng.' });
    }

    const contract = rows[0];

    // Fetch Payment Terms with receipt details
    const [terms] = await pool.query(
      `SELECT d.*, p.ma_phieu AS ma_phieu_thu, p.ngay_chung_tu, p.hinh_thuc_thanh_toan AS pt_hinh_thuc, q.ten_quy
       FROM hop_dong_dot_thanh_toan d
       LEFT JOIN phieu_thu_chi p ON d.id_phieu_thu = p.id
       LEFT JOIN quy_tien q ON p.id_quy_tien = q.id
       WHERE d.id_hop_dong = ? 
       ORDER BY d.id ASC`,
      [req.params.id]
    );

    // Fetch actual receipts (phiếu thu) from phieu_thu_chi
    const [payments] = await pool.query(
      `SELECT 
        p.id,
        p.ma_phieu,
        p.so_tien,
        p.ngay_chung_tu,
        p.hinh_thuc_thanh_toan,
        p.ly_do_thu_chi,
        p.nguoi_nop_nhan,
        p.trang_thai,
        p.thoi_gian_tao,
        p.nguoi_tao,
        q.ten_quy
       FROM phieu_thu_chi p
       LEFT JOIN quy_tien q ON p.id_quy_tien = q.id
       WHERE p.loai_phieu = 'Phieu_Thu' 
         AND ((p.loai_chung_tu_lien_ket = 'hop_dong' AND p.id_chung_tu = ?) OR p.ma_chung_tu = ?)
         AND p.da_xoa = 0
       ORDER BY p.ngay_chung_tu ASC, p.id ASC`,
      [req.params.id, contract.ma_hop_dong]
    );

    // Fetch Files
    const [files] = await pool.query(
      `SELECT * FROM hop_dong_file WHERE id_hop_dong = ? ORDER BY id DESC`,
      [req.params.id]
    );

    return res.json({
      ...contract,
      payment_terms: terms,
      payments,
      files
    });
  } catch (err) {
    console.error('Error fetching contract detail:', err);
    return res.status(500).json({ message: 'Lỗi truy vấn chi tiết hợp đồng.' });
  }
});

// 6. Create Contract (with terms & optional initial files)
router.post('/', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Ke_Toan', 'Admin']), upload.array('files', 10), async (req, res) => {
  const {
    ma_hop_dong,
    id_linh_vuc_kinh_doanh,
    id_khach_hang,
    id_cong_trinh,
    ten_hop_dong,
    loai_hop_dong = 'thi_cong_xay_dung',
    ngay_ky,
    ngay_hieu_luc,
    ngay_bat_dau,
    ngay_ket_thuc,
    gia_tri_truoc_thue = 0,
    thue_vat = 0,
    tien_thue_vat = 0,
    gia_tri_hop_dong,
    ti_le_chi_phi_quan_ly = 3.00,
    ti_le_thanh_tra_kiem_toan = 1.00,
    ti_le_thue_vat_tndn = 5.00,
    ti_le_chi_phi_tim_viec = 10.00,
    chi_phi_tim_viec_co_dinh = 0,
    loai_tinh_chi_phi_tim_viec = 'phan_tram',
    dieu_khoan_thanh_toan,
    dieu_khoan_giao_hang,
    dieu_khoan_bao_hanh,
    thoi_han_bao_hanh_thang = 12,
    gia_tri_tam_ung = 0,
    ngay_bao_lanh_tam_ung,
    ngay_het_han_bao_lanh_tam_ung,
    bao_lanh_thuc_hien = 0,
    ngay_bao_lanh_thuc_hien,
    ngay_het_han_bao_lanh_thuc_hien,
    bao_hanh_cong_trinh = 0,
    ngay_bao_hanh_cong_trinh,
    ngay_het_han_bao_hanh,
    trang_thai = 'Hieu_Luc',
    ghi_chu,
    payment_terms // JSON string or array of payment terms
  } = req.body;

  if (!ma_hop_dong || !ma_hop_dong.trim()) {
    return res.status(400).json({ message: 'Số / Mã hợp đồng là bắt buộc.' });
  }
  if (!ten_hop_dong || !ten_hop_dong.trim()) {
    return res.status(400).json({ message: 'Tên hợp đồng là bắt buộc.' });
  }
  if (!id_khach_hang) {
    return res.status(400).json({ message: 'Khách hàng / Chủ đầu tư là bắt buộc.' });
  }
  if (!ngay_ky) {
    return res.status(400).json({ message: 'Ngày ký hợp đồng là bắt buộc.' });
  }
  if (gia_tri_hop_dong === undefined || gia_tri_hop_dong === null || parseFloat(gia_tri_hop_dong) < 0) {
    return res.status(400).json({ message: 'Giá trị hợp đồng không hợp lệ.' });
  }

  const contractDate = new Date(ngay_ky);
  const currentYear = !isNaN(contractDate.getFullYear()) ? contractDate.getFullYear() : new Date().getFullYear();
  const effectiveLvkdId = (id_linh_vuc_kinh_doanh && id_linh_vuc_kinh_doanh !== 'all') ? parseInt(id_linh_vuc_kinh_doanh, 10) : 1;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Kiểm tra trùng lặp Mã Hợp Đồng
    const finalMaHopDong = ma_hop_dong.trim();
    let soVaoSo = 1;

    const [dup] = await connection.query('SELECT id FROM hop_dong WHERE ma_hop_dong = ? AND da_xoa = 0', [finalMaHopDong]);
    if (dup.length > 0) {
      connection.release();
      return res.status(400).json({ message: `Mã / Số hợp đồng "${finalMaHopDong}" đã tồn tại trong hệ thống.` });
    }

    const [maxSeq] = await connection.query(
      'SELECT COALESCE(MAX(so_vao_so), 0) AS max_so FROM hop_dong WHERE id_linh_vuc_kinh_doanh = ? AND nam = ?',
      [effectiveLvkdId, currentYear]
    );
    soVaoSo = (maxSeq[0]?.max_so || 0) + 1;

    const valHopDong = parseFloat(gia_tri_hop_dong) || 0;

    // 2. Insert into hop_dong
    const [result] = await connection.query(
      `INSERT INTO hop_dong (
        ma_hop_dong, so_vao_so, nam, id_linh_vuc_kinh_doanh, id_khach_hang, id_cong_trinh,
        ten_hop_dong, loai_hop_dong, ngay_ky, ngay_hieu_luc, ngay_bat_dau, ngay_ket_thuc,
        gia_tri_truoc_thue, thue_vat, tien_thue_vat, gia_tri_hop_dong, da_thanh_toan, con_lai,
        ti_le_chi_phi_quan_ly, ti_le_thanh_tra_kiem_toan, ti_le_thue_vat_tndn, ti_le_chi_phi_tim_viec,
        chi_phi_tim_viec_co_dinh, loai_tinh_chi_phi_tim_viec, dieu_khoan_thanh_toan, dieu_khoan_giao_hang,
        dieu_khoan_bao_hanh, thoi_han_bao_hanh_thang, gia_tri_tam_ung, ngay_bao_lanh_tam_ung,
        ngay_het_han_bao_lanh_tam_ung, bao_lanh_thuc_hien, ngay_bao_lanh_thuc_hien,
        ngay_het_han_bao_lanh_thuc_hien, bao_hanh_cong_trinh, ngay_bao_hanh_cong_trinh,
        ngay_het_han_bao_hanh, trang_thai, ghi_chu, nguoi_tao
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, 0, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?
      )`,
      [
        finalMaHopDong, soVaoSo, currentYear, effectiveLvkdId, id_khach_hang, id_cong_trinh || null,
        ten_hop_dong.trim(), loai_hop_dong, ngay_ky, ngay_hieu_luc || null, ngay_bat_dau || null, ngay_ket_thuc || null,
        parseFloat(gia_tri_truoc_thue) || 0, parseFloat(thue_vat) || 0, parseFloat(tien_thue_vat) || 0, valHopDong, valHopDong,
        parseFloat(ti_le_chi_phi_quan_ly) || 3.00, parseFloat(ti_le_thanh_tra_kiem_toan) || 1.00, parseFloat(ti_le_thue_vat_tndn) || 5.00, parseFloat(ti_le_chi_phi_tim_viec) || 10.00,
        parseFloat(chi_phi_tim_viec_co_dinh) || 0, loai_tinh_chi_phi_tim_viec || 'phan_tram', dieu_khoan_thanh_toan || null, dieu_khoan_giao_hang || null,
        dieu_khoan_bao_hanh || null, parseInt(thoi_han_bao_hanh_thang, 10) || 12, parseFloat(gia_tri_tam_ung) || 0, ngay_bao_lanh_tam_ung || null,
        ngay_het_han_bao_lanh_tam_ung || null, parseFloat(bao_lanh_thuc_hien) || 0, ngay_bao_lanh_thuc_hien || null,
        ngay_het_han_bao_lanh_thuc_hien || null, parseFloat(bao_hanh_cong_trinh) || 0, ngay_bao_hanh_cong_trinh || null,
        ngay_het_han_bao_hanh || null, trang_thai || 'Hieu_Luc', ghi_chu || null, req.user?.ten_dang_nhap || 'system'
      ]
    );

    const contractId = result.insertId;

    // 3. Insert Payment Terms if provided
    let termsList = [];
    if (payment_terms) {
      try {
        termsList = typeof payment_terms === 'string' ? JSON.parse(payment_terms) : payment_terms;
      } catch (e) {
        termsList = [];
      }
    }

    if (Array.isArray(termsList) && termsList.length > 0) {
      for (const term of termsList) {
        if (!term.ten_dot || !String(term.ten_dot).trim()) continue;
        const termAmount = parseFloat(term.so_tien) || 0;
        const termPercent = parseFloat(term.phan_tram) || (valHopDong > 0 ? (termAmount / valHopDong) * 100 : 0);
        const retentionPct = parseFloat(term.phan_tram_giu_lai) || 0;
        const retentionAmt = parseFloat(term.tien_giu_lai) || (termAmount * retentionPct / 100);
        const hanTT = (term.han_thanh_toan && String(term.han_thanh_toan).trim()) ? String(term.han_thanh_toan).trim() : null;

        await connection.query(
          `INSERT INTO hop_dong_dot_thanh_toan (
            id_hop_dong, loai_dot, ten_dot, hinh_thuc_thanh_toan, han_thanh_toan,
            phan_tram, so_tien, phan_tram_giu_lai, tien_giu_lai, da_thanh_toan, con_lai,
            trang_thai, mo_ta, nguoi_tao
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Chua_Thanh_Toan', ?, ?)`,
          [
            contractId,
            term.loai_dot || 'Dot_Thanh_Toan',
            String(term.ten_dot).trim(),
            term.hinh_thuc_thanh_toan || 'Chuyen_Khoan',
            hanTT,
            termPercent,
            termAmount,
            retentionPct,
            retentionAmt,
            termAmount,
            term.mo_ta || null,
            req.user?.ten_dang_nhap || 'system'
          ]
        );
      }
    }

    // 4. Save Uploaded Files if provided
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const f of req.files) {
        const filePath = `/uploads/contracts/${f.filename}`;
        await connection.query(
          `INSERT INTO hop_dong_file (id_hop_dong, ten_file, duong_dan, loai_file, kich_thuoc_bytes, nguoi_tao)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [contractId, f.originalname, filePath, f.mimetype, f.size, req.user?.ten_dang_nhap || 'system']
        );
      }
    }

    const [newRow] = await connection.query('SELECT * FROM hop_dong WHERE id = ?', [contractId]);
    await logChange(connection, 'hop_dong', contractId, 'THEM_MOI', null, newRow[0], req.user?.ten_dang_nhap || 'system');

    await connection.commit();
    return res.status(201).json({
      message: 'Tạo mới hợp đồng thành công.',
      id: contractId,
      ma_hop_dong: finalMaHopDong,
      data: newRow[0]
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating contract:', err);
    return res.status(500).json({ message: 'Lỗi khi tạo hợp đồng: ' + err.message });
  } finally {
    connection.release();
  }
});

// 7. Update Contract
router.put('/:id', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Ke_Toan', 'Admin']), upload.array('files', 10), async (req, res) => {
  const contractId = req.params.id;
  const {
    ma_hop_dong,
    id_linh_vuc_kinh_doanh,
    id_khach_hang,
    id_cong_trinh,
    ten_hop_dong,
    loai_hop_dong,
    ngay_ky,
    ngay_hieu_luc,
    ngay_bat_dau,
    ngay_ket_thuc,
    gia_tri_truoc_thue,
    thue_vat,
    tien_thue_vat,
    gia_tri_hop_dong,
    ti_le_chi_phi_quan_ly,
    ti_le_thanh_tra_kiem_toan,
    ti_le_thue_vat_tndn,
    ti_le_chi_phi_tim_viec,
    chi_phi_tim_viec_co_dinh,
    loai_tinh_chi_phi_tim_viec,
    dieu_khoan_thanh_toan,
    dieu_khoan_giao_hang,
    dieu_khoan_bao_hanh,
    thoi_han_bao_hanh_thang,
    gia_tri_tam_ung,
    ngay_bao_lanh_tam_ung,
    ngay_het_han_bao_lanh_tam_ung,
    bao_lanh_thuc_hien,
    ngay_bao_lanh_thuc_hien,
    ngay_het_han_bao_lanh_thuc_hien,
    bao_hanh_cong_trinh,
    ngay_bao_hanh_cong_trinh,
    ngay_het_han_bao_hanh,
    trang_thai,
    ghi_chu,
    payment_terms
  } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRows] = await connection.query('SELECT * FROM hop_dong WHERE id = ? AND da_xoa = 0', [contractId]);
    if (oldRows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy hợp đồng.' });
    }
    const oldData = oldRows[0];

    if (ma_hop_dong !== undefined && !ma_hop_dong.trim()) {
      connection.release();
      return res.status(400).json({ message: 'Số / Mã hợp đồng là bắt buộc.' });
    }

    if (ma_hop_dong && ma_hop_dong.trim() !== oldData.ma_hop_dong) {
      const [dup] = await connection.query('SELECT id FROM hop_dong WHERE ma_hop_dong = ? AND id != ? AND da_xoa = 0', [ma_hop_dong.trim(), contractId]);
      if (dup.length > 0) {
        connection.release();
        return res.status(400).json({ message: `Mã / Số hợp đồng "${ma_hop_dong.trim()}" đã tồn tại trong hệ thống.` });
      }
    }

    const valHopDong = gia_tri_hop_dong !== undefined ? parseFloat(gia_tri_hop_dong) : parseFloat(oldData.gia_tri_hop_dong);
    const daThanhToan = parseFloat(oldData.da_thanh_toan) || 0;
    const conLai = Math.max(0, valHopDong - daThanhToan);

    await connection.query(
      `UPDATE hop_dong SET
        ma_hop_dong = ?,
        id_linh_vuc_kinh_doanh = ?,
        id_khach_hang = ?,
        id_cong_trinh = ?,
        ten_hop_dong = ?,
        loai_hop_dong = ?,
        ngay_ky = ?,
        ngay_hieu_luc = ?,
        ngay_bat_dau = ?,
        ngay_ket_thuc = ?,
        gia_tri_truoc_thue = ?,
        thue_vat = ?,
        tien_thue_vat = ?,
        gia_tri_hop_dong = ?,
        con_lai = ?,
        ti_le_chi_phi_quan_ly = ?,
        ti_le_thanh_tra_kiem_toan = ?,
        ti_le_thue_vat_tndn = ?,
        ti_le_chi_phi_tim_viec = ?,
        chi_phi_tim_viec_co_dinh = ?,
        loai_tinh_chi_phi_tim_viec = ?,
        dieu_khoan_thanh_toan = ?,
        dieu_khoan_giao_hang = ?,
        dieu_khoan_bao_hanh = ?,
        thoi_han_bao_hanh_thang = ?,
        gia_tri_tam_ung = ?,
        ngay_bao_lanh_tam_ung = ?,
        ngay_het_han_bao_lanh_tam_ung = ?,
        bao_lanh_thuc_hien = ?,
        ngay_bao_lanh_thuc_hien = ?,
        ngay_het_han_bao_lanh_thuc_hien = ?,
        bao_hanh_cong_trinh = ?,
        ngay_bao_hanh_cong_trinh = ?,
        ngay_het_han_bao_hanh = ?,
        trang_thai = ?,
        ghi_chu = ?
       WHERE id = ?`,
      [
        ma_hop_dong ? ma_hop_dong.trim() : oldData.ma_hop_dong,
        id_linh_vuc_kinh_doanh || oldData.id_linh_vuc_kinh_doanh,
        id_khach_hang || oldData.id_khach_hang,
        id_cong_trinh !== undefined ? (id_cong_trinh || null) : oldData.id_cong_trinh,
        ten_hop_dong ? ten_hop_dong.trim() : oldData.ten_hop_dong,
        loai_hop_dong || oldData.loai_hop_dong,
        ngay_ky || oldData.ngay_ky,
        ngay_hieu_luc || oldData.ngay_hieu_luc,
        ngay_bat_dau || oldData.ngay_bat_dau,
        ngay_ket_thuc || oldData.ngay_ket_thuc,
        gia_tri_truoc_thue !== undefined ? parseFloat(gia_tri_truoc_thue) : oldData.gia_tri_truoc_thue,
        thue_vat !== undefined ? parseFloat(thue_vat) : oldData.thue_vat,
        tien_thue_vat !== undefined ? parseFloat(tien_thue_vat) : oldData.tien_thue_vat,
        valHopDong,
        conLai,
        ti_le_chi_phi_quan_ly !== undefined ? parseFloat(ti_le_chi_phi_quan_ly) : oldData.ti_le_chi_phi_quan_ly,
        ti_le_thanh_tra_kiem_toan !== undefined ? parseFloat(ti_le_thanh_tra_kiem_toan) : oldData.ti_le_thanh_tra_kiem_toan,
        ti_le_thue_vat_tndn !== undefined ? parseFloat(ti_le_thue_vat_tndn) : oldData.ti_le_thue_vat_tndn,
        ti_le_chi_phi_tim_viec !== undefined ? parseFloat(ti_le_chi_phi_tim_viec) : oldData.ti_le_chi_phi_tim_viec,
        chi_phi_tim_viec_co_dinh !== undefined ? parseFloat(chi_phi_tim_viec_co_dinh) : oldData.chi_phi_tim_viec_co_dinh,
        loai_tinh_chi_phi_tim_viec || oldData.loai_tinh_chi_phi_tim_viec,
        dieu_khoan_thanh_toan !== undefined ? dieu_khoan_thanh_toan : oldData.dieu_khoan_thanh_toan,
        dieu_khoan_giao_hang !== undefined ? dieu_khoan_giao_hang : oldData.dieu_khoan_giao_hang,
        dieu_khoan_bao_hanh !== undefined ? dieu_khoan_bao_hanh : oldData.dieu_khoan_bao_hanh,
        thoi_han_bao_hanh_thang !== undefined ? parseInt(thoi_han_bao_hanh_thang, 10) : oldData.thoi_han_bao_hanh_thang,
        gia_tri_tam_ung !== undefined ? parseFloat(gia_tri_tam_ung) : oldData.gia_tri_tam_ung,
        ngay_bao_lanh_tam_ung || oldData.ngay_bao_lanh_tam_ung,
        ngay_het_han_bao_lanh_tam_ung || oldData.ngay_het_han_bao_lanh_tam_ung,
        bao_lanh_thuc_hien !== undefined ? parseFloat(bao_lanh_thuc_hien) : oldData.bao_lanh_thuc_hien,
        ngay_bao_lanh_thuc_hien || oldData.ngay_bao_lanh_thuc_hien,
        ngay_het_han_bao_lanh_thuc_hien || oldData.ngay_het_han_bao_lanh_thuc_hien,
        bao_hanh_cong_trinh !== undefined ? parseFloat(bao_hanh_cong_trinh) : oldData.bao_hanh_cong_trinh,
        ngay_bao_hanh_cong_trinh || oldData.ngay_bao_hanh_cong_trinh,
        ngay_het_han_bao_hanh || oldData.ngay_het_han_bao_hanh,
        trang_thai || oldData.trang_thai,
        ghi_chu !== undefined ? ghi_chu : oldData.ghi_chu,
        contractId
      ]
    );

    // Update terms if explicitly sent
    let termsList = payment_terms;
    if (typeof payment_terms === 'string') {
      try {
        termsList = JSON.parse(payment_terms);
      } catch (e) {
        termsList = [];
      }
    }

    if (termsList && Array.isArray(termsList)) {
      // 1. Xóa các đợt chưa thanh toán để nạp lại danh sách mới
      await connection.query('DELETE FROM hop_dong_dot_thanh_toan WHERE id_hop_dong = ? AND da_thanh_toan = 0', [contractId]);

      // 2. Thêm mới hoặc cập nhật các đợt
      for (const term of termsList) {
        if (!term.ten_dot || !String(term.ten_dot).trim()) continue;
        const termAmount = parseFloat(term.so_tien) || 0;
        const termPercent = parseFloat(term.phan_tram) || (valHopDong > 0 ? (termAmount / valHopDong) * 100 : 0);
        const retentionPct = parseFloat(term.phan_tram_giu_lai) || 0;
        const retentionAmt = parseFloat(term.tien_giu_lai) || (termAmount * retentionPct / 100);
        const hanTT = (term.han_thanh_toan && String(term.han_thanh_toan).trim()) ? String(term.han_thanh_toan).trim() : null;

        let updatedExisting = false;
        if (term.id) {
          const [exist] = await connection.query(
            'SELECT id, da_thanh_toan FROM hop_dong_dot_thanh_toan WHERE id = ? AND id_hop_dong = ?',
            [term.id, contractId]
          );
          if (exist.length > 0) {
            const daTT = parseFloat(exist[0].da_thanh_toan) || 0;
            const conLai = Math.max(0, termAmount - daTT);
            const status = daTT >= termAmount && termAmount > 0 ? 'Da_Thanh_Toan' : daTT > 0 ? 'Thanh_Toan_Mot_Phan' : 'Chua_Thanh_Toan';

            await connection.query(
              `UPDATE hop_dong_dot_thanh_toan SET
                loai_dot = ?, ten_dot = ?, hinh_thuc_thanh_toan = ?, han_thanh_toan = ?,
                phan_tram = ?, so_tien = ?, phan_tram_giu_lai = ?, tien_giu_lai = ?, con_lai = ?, trang_thai = ?, mo_ta = ?
               WHERE id = ? AND id_hop_dong = ?`,
              [
                term.loai_dot || 'Dot_Thanh_Toan',
                String(term.ten_dot).trim(),
                term.hinh_thuc_thanh_toan || 'Chuyen_Khoan',
                hanTT,
                termPercent,
                termAmount,
                retentionPct,
                retentionAmt,
                conLai,
                status,
                term.mo_ta || null,
                term.id,
                contractId
              ]
            );
            updatedExisting = true;
          }
        }

        if (!updatedExisting) {
          await connection.query(
            `INSERT INTO hop_dong_dot_thanh_toan (
              id_hop_dong, loai_dot, ten_dot, hinh_thuc_thanh_toan, han_thanh_toan,
              phan_tram, so_tien, phan_tram_giu_lai, tien_giu_lai, da_thanh_toan, con_lai,
              trang_thai, mo_ta, nguoi_tao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'Chua_Thanh_Toan', ?, ?)`,
            [
              contractId,
              term.loai_dot || 'Dot_Thanh_Toan',
              String(term.ten_dot).trim(),
              term.hinh_thuc_thanh_toan || 'Chuyen_Khoan',
              hanTT,
              termPercent,
              termAmount,
              retentionPct,
              retentionAmt,
              termAmount,
              term.mo_ta || null,
              req.user?.ten_dang_nhap || 'system'
            ]
          );
        }
      }
    }

    // Save newly uploaded files if any
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const f of req.files) {
        const filePath = `/uploads/contracts/${f.filename}`;
        await connection.query(
          `INSERT INTO hop_dong_file (id_hop_dong, ten_file, duong_dan, loai_file, kich_thuoc_bytes, nguoi_tao)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [contractId, f.originalname, filePath, f.mimetype, f.size, req.user?.ten_dang_nhap || 'system']
        );
      }
    }

    const [newRow] = await connection.query('SELECT * FROM hop_dong WHERE id = ?', [contractId]);
    await logChange(connection, 'hop_dong', contractId, 'CAP_NHAT', oldData, newRow[0], req.user?.ten_dang_nhap || 'system');

    await connection.commit();
    return res.json({
      message: 'Cập nhật hợp đồng thành công.',
      data: newRow[0]
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error updating contract:', err);
    return res.status(500).json({ message: 'Lỗi khi cập nhật hợp đồng: ' + err.message });
  } finally {
    connection.release();
  }
});

// 8. Soft Delete Contract (Kiểm tra dữ liệu liên kết trước khi xóa)
router.delete('/:id', authMiddleware, authorize(['Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const contractId = req.params.id;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRows] = await connection.query('SELECT * FROM hop_dong WHERE id = ? AND da_xoa = 0', [contractId]);
    if (oldRows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy hợp đồng.' });
    }

    const contract = oldRows[0];

    // 1. Kiểm tra các đợt thanh toán có phát sinh tiền thu
    const [paidTerms] = await connection.query(
      'SELECT COUNT(*) as cnt, COALESCE(SUM(da_thanh_toan), 0) as total_paid FROM hop_dong_dot_thanh_toan WHERE id_hop_dong = ? AND da_thanh_toan > 0',
      [contractId]
    );

    // 2. Kiểm tra phiếu thu/chi tài chính liên quan
    const [linkedReceipts] = await connection.query(
      'SELECT COUNT(*) as cnt FROM phieu_thu_chi WHERE ((loai_chung_tu_lien_ket = \'hop_dong\' AND id_chung_tu = ?) OR ly_do_thu_chi LIKE ?) AND da_xoa = 0',
      [contractId, `%${contract.ma_hop_dong}%`]
    );

    // 3. Kiểm tra file đính kèm
    const [linkedFiles] = await connection.query(
      'SELECT COUNT(*) as cnt FROM hop_dong_file WHERE id_hop_dong = ?',
      [contractId]
    );

    // 4. Kiểm tra tổng số đợt thanh toán
    const [allTerms] = await connection.query(
      'SELECT COUNT(*) as cnt FROM hop_dong_dot_thanh_toan WHERE id_hop_dong = ?',
      [contractId]
    );

    const blockingReasons = [];
    if (paidTerms[0]?.cnt > 0) {
      const totalPaidFormatted = new Intl.NumberFormat('vi-VN').format(parseFloat(paidTerms[0].total_paid || 0));
      blockingReasons.push(`${paidTerms[0].cnt} đợt thanh toán đã thực thu (${totalPaidFormatted} đ)`);
    }
    if (linkedReceipts[0]?.cnt > 0) {
      blockingReasons.push(`${linkedReceipts[0].cnt} phiếu thu/chi tài chính liên quan`);
    }
    if (linkedFiles[0]?.cnt > 0) {
      blockingReasons.push(`${linkedFiles[0].cnt} tệp tin/hồ sơ scan đính kèm`);
    }
    if (allTerms[0]?.cnt > 0 && paidTerms[0]?.cnt === 0) {
      blockingReasons.push(`${allTerms[0].cnt} đợt thanh toán`);
    }

    if (blockingReasons.length > 0) {
      connection.release();
      return res.status(400).json({
        message: `Không thể xóa hợp đồng "${contract.ma_hop_dong} - ${contract.ten_hop_dong}" vì đang tồn tại dữ liệu liên kết: ${blockingReasons.join(', ')}. Vui lòng kiểm tra và hủy/xóa các dữ liệu liên quan trước.`
      });
    }

    await connection.query('UPDATE hop_dong SET da_xoa = 1 WHERE id = ?', [contractId]);
    await logChange(connection, 'hop_dong', contractId, 'XOA', contract, null, req.user?.ten_dang_nhap || 'system');

    await connection.commit();
    return res.json({ message: 'Xóa hợp đồng thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error('Error deleting contract:', err);
    return res.status(500).json({ message: 'Lỗi khi xóa hợp đồng: ' + (err.message || '') });
  } finally {
    connection.release();
  }
});

// 9. Payment Collection for a Payment Term (Sinh Phiếu Thu PT tự động)
router.post('/:id/thanh-toan-dot', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const contractId = req.params.id;
  const {
    id_dot,
    id_quy_tien,
    so_tien_thanh_toan,
    hinh_thuc_thanh_toan = 'Chuyen_Khoan',
    ngay_chung_tu,
    ly_do_thu_chi,
    kem_theo_chung_tu_goc
  } = req.body;

  if (!id_dot) {
    return res.status(400).json({ message: 'Đợt thanh toán là bắt buộc.' });
  }
  if (!id_quy_tien) {
    return res.status(400).json({ message: 'Quỹ tiền / Tài khoản nhận tiền là bắt buộc.' });
  }
  const amountToPay = parseFloat(so_tien_thanh_toan) || 0;
  if (amountToPay <= 0) {
    return res.status(400).json({ message: 'Số tiền thanh toán phải lớn hơn 0.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Fetch Contract & Customer info
    const [contractRows] = await connection.query(
      `SELECT h.*, k.ten_khach_hang, k.dia_chi, k.so_dien_thoai, l.ma_lvkd
       FROM hop_dong h
       LEFT JOIN khach_hang k ON h.id_khach_hang = k.id
       LEFT JOIN linh_vuc_kinh_doanh l ON h.id_linh_vuc_kinh_doanh = l.id
       WHERE h.id = ? AND h.da_xoa = 0`,
      [contractId]
    );

    if (contractRows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy hợp đồng.' });
    }
    const contract = contractRows[0];

    // Fetch Term info
    const [termRows] = await connection.query(
      'SELECT * FROM hop_dong_dot_thanh_toan WHERE id = ? AND id_hop_dong = ?',
      [id_dot, contractId]
    );
    if (termRows.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy đợt thanh toán của hợp đồng.' });
    }
    const term = termRows[0];

    // Generate Sequence Number for PT (Phiếu Thu)
    const docDate = ngay_chung_tu ? new Date(ngay_chung_tu) : new Date();
    const docYear = !isNaN(docDate.getFullYear()) ? docDate.getFullYear() : new Date().getFullYear();
    const seqPT = await generateSequenceNumber(connection, {
      id_linh_vuc_kinh_doanh: contract.id_linh_vuc_kinh_doanh || 1,
      loai_chung_tu: 'PT',
      nam: docYear,
      ma_lvkd: contract.ma_lvkd || 'HD'
    });

    const defaultReason = ly_do_thu_chi || `Thu tiền đợt [${term.ten_dot}] - Hợp đồng ${contract.ma_hop_dong}`;

    // 1. Insert into phieu_thu_chi
    const [ptResult] = await connection.query(
      `INSERT INTO phieu_thu_chi (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
        loai_chung_tu_lien_ket, id_chung_tu, ma_chung_tu, loai_doi_tuong, id_doi_tuong,
        ten_doi_tuong, dia_chi_doi_tuong, sdt_doi_tuong, id_quy_tien, hinh_thuc_thanh_toan,
        so_tien, ngay_chung_tu, nguoi_nop_nhan, ly_do_thu_chi, kem_theo_chung_tu_goc,
        trang_thai, nguoi_tao
      ) VALUES (
        ?, ?, ?, ?, 'Phieu_Thu', 'thu_tam_ung_hop_dong',
        'hop_dong', ?, ?, 'khach_hang', ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        'đã thanh toán', ?
      )`,
      [
        seqPT.ma_phieu,
        seqPT.so_vao_so,
        docYear,
        contract.id_linh_vuc_kinh_doanh || 1,
        contract.id,
        contract.ma_hop_dong,
        contract.id_khach_hang,
        contract.ten_khach_hang || 'Khách hàng',
        contract.dia_chi || null,
        contract.so_dien_thoai || null,
        id_quy_tien,
        hinh_thuc_thanh_toan,
        amountToPay,
        docDate,
        contract.ten_khach_hang || 'Khách hàng',
        defaultReason,
        kem_theo_chung_tu_goc || null,
        req.user?.ten_dang_nhap || 'system'
      ]
    );

    const ptId = ptResult.insertId;

    // 2. Update Term Payment progress
    const newTermDaThanhToan = (parseFloat(term.da_thanh_toan) || 0) + amountToPay;
    const newTermConLai = Math.max(0, (parseFloat(term.so_tien) || 0) - newTermDaThanhToan);
    const newTermStatus = newTermConLai <= 0 ? 'Da_Thanh_Toan' : 'Thanh_Toan_Mot_Phan';

    await connection.query(
      `UPDATE hop_dong_dot_thanh_toan SET
        da_thanh_toan = ?,
        con_lai = ?,
        trang_thai = ?,
        ngay_thanh_toan_thuc_te = NOW(),
        id_phieu_thu = ?
       WHERE id = ?`,
      [newTermDaThanhToan, newTermConLai, newTermStatus, ptId, id_dot]
    );

    // 4. Update Contract total progress
    const newContractDaThanhToan = (parseFloat(contract.da_thanh_toan) || 0) + amountToPay;
    const newContractConLai = Math.max(0, (parseFloat(contract.gia_tri_hop_dong) || 0) - newContractDaThanhToan);

    await connection.query(
      `UPDATE hop_dong SET
        da_thanh_toan = ?,
        con_lai = ?
       WHERE id = ?`,
      [newContractDaThanhToan, newContractConLai, contractId]
    );

    await connection.commit();
    return res.json({
      message: 'Thu tiền đợt thanh toán thành công và đã lập Phiếu Thu tự động.',
      ma_phieu_thu: seqPT.ma_phieu,
      id_phieu_thu: ptId,
      da_thanh_toan: newContractDaThanhToan,
      con_lai: newContractConLai
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error collecting contract payment:', err);
    return res.status(500).json({ message: 'Lỗi khi thu tiền đợt thanh toán: ' + err.message });
  } finally {
    connection.release();
  }
});

// 10. Upload files for an existing contract
router.post('/:id/files', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Ke_Toan', 'Admin']), upload.array('files', 10), async (req, res) => {
  const contractId = req.params.id;
  if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
    return res.status(400).json({ message: 'Vui lòng chọn file tải lên.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const savedFiles = [];
    for (const f of req.files) {
      const filePath = `/uploads/contracts/${f.filename}`;
      const [resInsert] = await connection.query(
        `INSERT INTO hop_dong_file (id_hop_dong, ten_file, duong_dan, loai_file, kich_thuoc_bytes, nguoi_tao)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [contractId, f.originalname, filePath, f.mimetype, f.size, req.user?.ten_dang_nhap || 'system']
      );
      savedFiles.push({
        id: resInsert.insertId,
        id_hop_dong: contractId,
        ten_file: f.originalname,
        duong_dan: filePath,
        loai_file: f.mimetype,
        kich_thuoc_bytes: f.size
      });
    }

    await connection.commit();
    return res.json({
      message: 'Tải lên file đính kèm thành công.',
      files: savedFiles
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error uploading contract files:', err);
    return res.status(500).json({ message: 'Lỗi khi tải file đính kèm: ' + err.message });
  } finally {
    connection.release();
  }
});

// 11. Delete a contract file
router.delete('/files/:fileId', authMiddleware, authorize(['Ke_Hoach', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM hop_dong_file WHERE id = ?', [req.params.fileId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy file.' });
    }
    const file = rows[0];

    // Try deleting physical file
    const physicalPath = path.join(__dirname, '../../public', file.duong_dan);
    if (fs.existsSync(physicalPath)) {
      try {
        fs.unlinkSync(physicalPath);
      } catch (e) {
        console.warn('Could not delete physical file:', e.message);
      }
    }

    await pool.query('DELETE FROM hop_dong_file WHERE id = ?', [req.params.fileId]);
    return res.json({ message: 'Xóa file đính kèm thành công.' });
  } catch (err) {
    console.error('Error deleting contract file:', err);
    return res.status(500).json({ message: 'Lỗi khi xóa file đính kèm.' });
  }
});

module.exports = router;
