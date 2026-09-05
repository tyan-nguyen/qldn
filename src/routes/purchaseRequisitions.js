const express = require('express');
const router = express.Router();
const { pool: db } = require('../config/db');
const { generateSequenceNumber } = require('../services/sequenceService');

// GET /api/yeu-cau-mua-hang/thong-bao/count: Count Requisitions Pending Approval
router.get('/thong-bao/count', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT COUNT(*) AS count
      FROM yeu_cau_mua_hang
      WHERE trang_thai = 'Chờ duyệt'
    `);
    res.json({ count: rows[0]?.count || 0 });
  } catch (err) {
    console.error('Error getting requisition notification count:', err);
    res.status(500).json({ error: 'Lỗi lấy số lượng thông báo' });
  }
});

// GET /api/yeu-cau-mua-hang/thong-bao/list: List Requisitions Pending Approval
router.get('/thong-bao/list', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT y.*,
             c.ten_cong_trinh, c.ten_viet_tat
      FROM yeu_cau_mua_hang y
      LEFT JOIN cong_trinh c ON y.id_cong_trinh = c.id
      WHERE y.trang_thai = 'Chờ duyệt'
      ORDER BY y.id DESC
      LIMIT 15
    `);
    res.json(rows);
  } catch (err) {
    console.error('Error getting requisition notification list:', err);
    res.status(500).json({ error: 'Lỗi lấy danh sách thông báo' });
  }
});

// GET /api/yeu-cau-mua-hang/years: List distinct recording years
router.get('/years', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT COALESCE(nam, YEAR(ngay_yeu_cau)) as year 
       FROM yeu_cau_mua_hang 
       WHERE nam IS NOT NULL OR ngay_yeu_cau IS NOT NULL
       ORDER BY year DESC`
    );
    const currentYear = new Date().getFullYear();
    const dbYears = rows.map(r => parseInt(r.year, 10)).filter(y => !isNaN(y) && y >= 2025 && y <= currentYear);
    const uniqueYears = Array.from(new Set([currentYear, ...dbYears])).sort((a, b) => b - a);
    return res.json(uniqueYears);
  } catch (err) {
    console.error('Error fetching requisition years:', err);
    return res.status(500).json({ error: 'Lỗi lấy danh sách năm' });
  }
});

// GET /api/yeu-cau-mua-hang: List Purchase Requisitions
router.get('/', async (req, res) => {
  try {
    const { id_linh_vuc_kinh_doanh, loai_yeu_cau, id_cong_trinh, trang_thai, search, nam, year } = req.query;
    let query = `
      SELECT y.*,
             c.ten_cong_trinh, c.ten_viet_tat,
             lvkd.ten_lvkd, lvkd.ma_lvkd,
             ycv.ma_phieu AS ma_yeu_cau_vat_tu,
             (SELECT COUNT(*) FROM yeu_cau_mua_hang_chi_tiet WHERE id_yeu_cau_mua_hang = y.id) AS tong_so_mat_hang,
             (SELECT COALESCE(SUM(thanh_tien_du_kien), 0) FROM yeu_cau_mua_hang_chi_tiet WHERE id_yeu_cau_mua_hang = y.id) AS tong_gia_tri_du_kien
      FROM yeu_cau_mua_hang y
      LEFT JOIN cong_trinh c ON y.id_cong_trinh = c.id
      LEFT JOIN linh_vuc_kinh_doanh lvkd ON y.id_linh_vuc_kinh_doanh = lvkd.id
      LEFT JOIN yeu_cau_vat_tu ycv ON y.id_yeu_cau_vat_tu = ycv.id
      WHERE 1=1
    `;
    const params = [];

    const selectedYear = nam || year;
    if (selectedYear && selectedYear !== 'ALL' && selectedYear !== 'all') {
      query += ` AND (y.nam = ? OR (y.nam IS NULL AND YEAR(y.ngay_yeu_cau) = ?))`;
      params.push(selectedYear, selectedYear);
    }

    if (id_linh_vuc_kinh_doanh) {
      query += ` AND y.id_linh_vuc_kinh_doanh = ?`;
      params.push(id_linh_vuc_kinh_doanh);
    }
    if (loai_yeu_cau) {
      query += ` AND y.loai_yeu_cau = ?`;
      params.push(loai_yeu_cau);
    }
    if (id_cong_trinh) {
      query += ` AND y.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }
    if (trang_thai) {
      query += ` AND y.trang_thai = ?`;
      params.push(trang_thai);
    }
    if (search) {
      const term = `%${search}%`;
      query += ` AND (y.ma_yeu_cau LIKE ? OR y.nguoi_yeu_cau LIKE ? OR c.ten_cong_trinh LIKE ?)`;
      params.push(term, term, term);
    }

    query += ` ORDER BY y.id DESC`;

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching purchase requisitions:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy danh sách yêu cầu mua hàng' });
  }
});

// GET /api/yeu-cau-mua-hang/:id: Get Single Requisition Detail with Line Items
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT y.*,
             c.ten_cong_trinh, c.ten_viet_tat,
             lvkd.ten_lvkd, lvkd.ma_lvkd,
             ycv.ma_phieu AS ma_yeu_cau_vat_tu
      FROM yeu_cau_mua_hang y
      LEFT JOIN cong_trinh c ON y.id_cong_trinh = c.id
      LEFT JOIN linh_vuc_kinh_doanh lvkd ON y.id_linh_vuc_kinh_doanh = lvkd.id
      LEFT JOIN yeu_cau_vat_tu ycv ON y.id_yeu_cau_vat_tu = ycv.id
      WHERE y.id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy phiếu yêu cầu mua hàng' });
    }

    const requisition = rows[0];

    const [items] = await db.query(`
      SELECT d.*,
             vt.ma_vat_tu, vt.ten_vat_tu, lvt.ten_loai_vat_tu AS loai_vat_tu
      FROM yeu_cau_mua_hang_chi_tiet d
      LEFT JOIN danh_muc_vat_tu vt ON d.id_danh_muc_vat_tu = vt.id
      LEFT JOIN danh_muc_loai_vat_tu lvt ON vt.id_loai_vat_tu = lvt.id
      WHERE d.id_yeu_cau_mua_hang = ?
    `, [req.params.id]);

    requisition.items = items;
    res.json(requisition);
  } catch (err) {
    console.error('Error fetching requisition detail:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy chi tiết yêu cầu mua hàng' });
  }
});

// POST /api/yeu-cau-mua-hang: Create Purchase Requisition (with Strict Limit Validation)
router.post('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const {
      loai_yeu_cau,
      id_linh_vuc_kinh_doanh,
      id_cong_trinh,
      id_yeu_cau_vat_tu,
      ngay_yeu_cau,
      ngay_can_hang,
      nguoi_yeu_cau,
      bo_phan_yeu_cau,
      ly_do_yeu_cau,
      ghi_chu,
      items
    } = req.body;

    if (!loai_yeu_cau || !nguoi_yeu_cau || !ngay_yeu_cau || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ thông tin bắt buộc và danh sách vật tư' });
    }

    if (loai_yeu_cau === 'MUA_CHO_CONG_TRINH' && !id_cong_trinh) {
      await conn.rollback();
      return res.status(400).json({ error: 'Mua hàng cho công trình yêu cầu chọn công trình chỉ định' });
    }

    // Get LVKD code
    let maLvkd = 'XD';
    if (id_linh_vuc_kinh_doanh) {
      const [lvkdRows] = await conn.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [id_linh_vuc_kinh_doanh]);
      if (lvkdRows.length > 0) maLvkd = lvkdRows[0].ma_lvkd;
    }

    const nam = new Date(ngay_yeu_cau).getFullYear();
    const { ma_phieu: ma_yeu_cau, so_vao_so } = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: id_linh_vuc_kinh_doanh || 1,
      loai_chung_tu: 'YCMH',
      nam,
      ma_lvkd: maLvkd
    });

    // If linked to site material request, VALIDATE STRICT LIMITS
    if (id_yeu_cau_vat_tu) {
      for (const item of items) {
        if (item.id_chi_tiet_yeu_cau_vat_tu) {
          const [reqDetail] = await conn.query(`
            SELECT d.so_luong_yeu_cau,
                   (SELECT COALESCE(SUM(pxct.so_luong_xuat), 0)
                    FROM phieu_xuat_kho_chi_tiet pxct
                    JOIN phieu_xuat_kho px ON pxct.id_phieu_xuat_kho = px.id
                    WHERE pxct.id_chi_tiet_yeu_cau_vat_tu = d.id AND px.trang_thai_xuat != 'Đã hủy') AS da_xuat,
                   (SELECT COALESCE(SUM(ymct.so_luong_can_mua), 0)
                    FROM yeu_cau_mua_hang_chi_tiet ymct
                    JOIN yeu_cau_mua_hang ym ON ymct.id_yeu_cau_mua_hang = ym.id
                    WHERE ymct.id_chi_tiet_yeu_cau_vat_tu = d.id AND ym.trang_thai != 'Từ chối') AS da_de_xuat_mua
            FROM yeu_cau_vat_tu_chi_tiet d
            WHERE d.id = ?
          `, [item.id_chi_tiet_yeu_cau_vat_tu]);

          if (reqDetail.length > 0) {
            const { so_luong_yeu_cau, da_xuat, da_de_xuat_mua } = reqDetail[0];
            const maxCanMua = parseFloat(so_luong_yeu_cau) - parseFloat(da_xuat) - parseFloat(da_de_xuat_mua);
            const proposedQty = parseFloat(item.so_luong_can_mua) || 0;

            if (proposedQty > maxCanMua + 0.001) {
              await conn.rollback();
              return res.status(400).json({
                error: `Số lượng đề xuất mua (${proposedQty}) vượt quá hạn mức cho phép (${maxCanMua.toFixed(2)}) của vật tư ID ${item.id_danh_muc_vat_tu}`
              });
            }
          }
        }
      }
    }

    const [result] = await conn.query(`
      INSERT INTO yeu_cau_mua_hang (
        ma_yeu_cau, so_vao_so, nam, loai_yeu_cau, id_linh_vuc_kinh_doanh, id_cong_trinh, id_yeu_cau_vat_tu,
        ngay_yeu_cau, ngay_can_hang, nguoi_yeu_cau, bo_phan_yeu_cau, trang_thai, ly_do_yeu_cau, ghi_chu
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Dự thảo', ?, ?)
    `, [
      ma_yeu_cau, so_vao_so, nam, loai_yeu_cau, id_linh_vuc_kinh_doanh || null, id_cong_trinh || null, id_yeu_cau_vat_tu || null,
      ngay_yeu_cau, ngay_can_hang || null, nguoi_yeu_cau, bo_phan_yeu_cau || null, ly_do_yeu_cau || null, ghi_chu || null
    ]);

    const requisitionId = result.insertId;

    for (const item of items) {
      await conn.query(`
        INSERT INTO yeu_cau_mua_hang_chi_tiet (
          id_yeu_cau_mua_hang, id_chi_tiet_yeu_cau_vat_tu, id_danh_muc_vat_tu,
          don_vi_tinh, so_luong_can_mua, don_gia_du_kien, thanh_tien_du_kien, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        requisitionId,
        item.id_chi_tiet_yeu_cau_vat_tu || null,
        item.id_danh_muc_vat_tu,
        item.don_vi_tinh,
        item.so_luong_can_mua,
        item.don_gia_du_kien || 0,
        (parseFloat(item.so_luong_can_mua) || 0) * (parseFloat(item.don_gia_du_kien) || 0),
        item.ghi_chu || null
      ]);
    }

    await conn.commit();
    res.status(201).json({ message: 'Tạo phiếu đề xuất mua hàng thành công', id: requisitionId, ma_yeu_cau });
  } catch (err) {
    await conn.rollback();
    console.error('Error creating purchase requisition:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi tạo đề xuất mua hàng' });
  } finally {
    conn.release();
  }
});

// PUT /api/yeu-cau-mua-hang/:id: Update Draft Purchase Requisition
router.put('/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT trang_thai FROM yeu_cau_mua_hang WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Không tìm thấy phiếu yêu cầu mua hàng' });
    }

    if (rows[0].trang_thai !== 'Dự thảo') {
      await conn.rollback();
      return res.status(400).json({ error: 'Chỉ được phép chỉnh sửa phiếu đề xuất mua hàng ở trạng thái Dự thảo' });
    }

    const {
      loai_yeu_cau,
      id_linh_vuc_kinh_doanh,
      id_cong_trinh,
      id_yeu_cau_vat_tu,
      ngay_yeu_cau,
      ngay_can_hang,
      nguoi_yeu_cau,
      bo_phan_yeu_cau,
      ly_do_yeu_cau,
      ghi_chu,
      items
    } = req.body;

    await conn.query(`
      UPDATE yeu_cau_mua_hang
      SET loai_yeu_cau = ?,
          id_linh_vuc_kinh_doanh = ?,
          id_cong_trinh = ?,
          id_yeu_cau_vat_tu = ?,
          ngay_yeu_cau = ?,
          ngay_can_hang = ?,
          nguoi_yeu_cau = ?,
          bo_phan_yeu_cau = ?,
          ly_do_yeu_cau = ?,
          ghi_chu = ?
      WHERE id = ?
    `, [
      loai_yeu_cau,
      id_linh_vuc_kinh_doanh || null,
      id_cong_trinh || null,
      id_yeu_cau_vat_tu || null,
      ngay_yeu_cau,
      ngay_can_hang || null,
      nguoi_yeu_cau,
      bo_phan_yeu_cau || null,
      ly_do_yeu_cau || null,
      ghi_chu || null,
      req.params.id
    ]);

    await conn.query('DELETE FROM yeu_cau_mua_hang_chi_tiet WHERE id_yeu_cau_mua_hang = ?', [req.params.id]);

    for (const item of items) {
      await conn.query(`
        INSERT INTO yeu_cau_mua_hang_chi_tiet (
          id_yeu_cau_mua_hang, id_chi_tiet_yeu_cau_vat_tu, id_danh_muc_vat_tu,
          don_vi_tinh, so_luong_can_mua, don_gia_du_kien, thanh_tien_du_kien, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        req.params.id,
        item.id_chi_tiet_yeu_cau_vat_tu || null,
        item.id_danh_muc_vat_tu,
        item.don_vi_tinh,
        item.so_luong_can_mua,
        item.don_gia_du_kien || 0,
        (parseFloat(item.so_luong_can_mua) || 0) * (parseFloat(item.don_gia_du_kien) || 0),
        item.ghi_chu || null
      ]);
    }

    await conn.commit();
    res.json({ message: 'Cập nhật phiếu đề xuất mua hàng thành công' });
  } catch (err) {
    await conn.rollback();
    console.error('Error updating purchase requisition:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi cập nhật đề xuất mua hàng' });
  } finally {
    conn.release();
  }
});

// PATCH /api/yeu-cau-mua-hang/:id/gui-duyet: Submit Requisition for Approval
router.patch('/:id/gui-duyet', async (req, res) => {
  try {
    const { nguoi_gui } = req.body;
    const [rows] = await db.query('SELECT trang_thai FROM yeu_cau_mua_hang WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy phiếu' });

    await db.query(`
      UPDATE yeu_cau_mua_hang
      SET trang_thai = 'Chờ duyệt',
          nguoi_gui_yeu_cau_duyet = ?,
          thoi_gian_gui_yeu_cau_duyet = NOW()
      WHERE id = ?
    `, [nguoi_gui || 'Hệ thống', req.params.id]);

    const io = req.app ? req.app.get('io') : null;
    if (io) io.emit('purchase_requisition_updated', { id: req.params.id, trang_thai: 'Chờ duyệt' });

    res.json({ message: 'Đã gửi duyệt phiếu đề xuất mua hàng' });
  } catch (err) {
    console.error('Error submitting requisition for audit:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi gửi duyệt phiếu' });
  }
});

// PATCH /api/yeu-cau-mua-hang/:id/duyet: Approve / Reject Requisition
router.patch('/:id/duyet', async (req, res) => {
  try {
    const { trang_thai, nguoi_duyet, noi_dung_duyet } = req.body;

    if (!['Đã duyệt', 'Từ chối'].includes(trang_thai)) {
      return res.status(400).json({ error: 'Trạng thái phê duyệt không hợp lệ' });
    }

    await db.query(`
      UPDATE yeu_cau_mua_hang
      SET trang_thai = ?,
          nguoi_duyet = ?,
          thoi_gian_duyet = NOW(),
          noi_dung_duyet = ?
      WHERE id = ?
    `, [trang_thai, nguoi_duyet || 'Ban Giám Đốc', noi_dung_duyet || null, req.params.id]);

    const io = req.app ? req.app.get('io') : null;
    if (io) io.emit('purchase_requisition_updated', { id: req.params.id, trang_thai });

    res.json({ message: `Đã ${trang_thai.toLowerCase()} phiếu đề xuất mua hàng` });
  } catch (err) {
    console.error('Error approving requisition:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi phê duyệt phiếu' });
  }
});

module.exports = router;
