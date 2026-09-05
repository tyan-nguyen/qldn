const express = require('express');
const router = express.Router();
const { pool: db } = require('../config/db');
const { generateSequenceNumber } = require('../services/sequenceService');

// GET /api/dieu-chuyen-vat-tu: List Transfers
router.get('/', async (req, res) => {
  try {
    const {
      id_linh_vuc_kinh_doanh, loai_dieu_chuyen,
      id_cong_trinh_nguon, id_cong_trinh_dich,
      trang_thai, search, nam, year
    } = req.query;

    let query = `
      SELECT dc.*,
             lvkd.ten_lvkd, lvkd.ma_lvkd,
             ctr_n.ten_cong_trinh AS ten_cong_trinh_nguon,
             k_n.ten_kho AS ten_kho_nguon,
             ctr_d.ten_cong_trinh AS ten_cong_trinh_dich,
             k_d.ten_kho AS ten_kho_dich,
             (SELECT COUNT(*) FROM phieu_dieu_chuyen_vat_tu_chi_tiet WHERE id_phieu_dieu_chuyen = dc.id) AS tong_so_mat_hang
      FROM phieu_dieu_chuyen_vat_tu dc
      LEFT JOIN linh_vuc_kinh_doanh lvkd ON dc.id_linh_vuc_kinh_doanh = lvkd.id
      LEFT JOIN cong_trinh ctr_n ON dc.loai_nguon = 'CONG_TRINH' AND dc.id_nguon = ctr_n.id
      LEFT JOIN kho_hang k_n ON dc.loai_nguon = 'KHO_HANG' AND dc.id_nguon = k_n.id
      LEFT JOIN cong_trinh ctr_d ON dc.loai_dich = 'CONG_TRINH' AND dc.id_dich = ctr_d.id
      LEFT JOIN kho_hang k_d ON dc.loai_dich = 'KHO_HANG' AND dc.id_dich = k_d.id
      WHERE 1=1
    `;
    const params = [];

    const selectedYear = nam || year;
    if (selectedYear && selectedYear !== 'ALL' && selectedYear !== 'all') {
      query += ` AND (dc.nam = ? OR YEAR(dc.ngay_dieu_chuyen) = ?)`;
      params.push(selectedYear, selectedYear);
    }

    if (id_linh_vuc_kinh_doanh) {
      query += ` AND dc.id_linh_vuc_kinh_doanh = ?`;
      params.push(id_linh_vuc_kinh_doanh);
    }
    if (loai_dieu_chuyen) {
      query += ` AND dc.loai_dieu_chuyen = ?`;
      params.push(loai_dieu_chuyen);
    }
    if (id_cong_trinh_nguon) {
      query += ` AND dc.loai_nguon = 'CONG_TRINH' AND dc.id_nguon = ?`;
      params.push(id_cong_trinh_nguon);
    }
    if (id_cong_trinh_dich) {
      query += ` AND dc.loai_dich = 'CONG_TRINH' AND dc.id_dich = ?`;
      params.push(id_cong_trinh_dich);
    }
    if (trang_thai) {
      query += ` AND dc.trang_thai = ?`;
      params.push(trang_thai);
    }
    if (search) {
      const term = `%${search}%`;
      query += ` AND (dc.ma_phieu_dieu_chuyen LIKE ? OR dc.nguoi_dieu_chuyen LIKE ?)`;
      params.push(term, term);
    }

    query += ` ORDER BY dc.id DESC`;

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching site transfers:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy danh sách điều chuyển vật tư' });
  }
});

// GET /api/dieu-chuyen-vat-tu/:id: Get Single Transfer Detail
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT dc.*,
             lvkd.ten_lvkd, lvkd.ma_lvkd,
             CASE WHEN dc.loai_nguon = 'CONG_TRINH' THEN ctr_n.ten_cong_trinh ELSE k_n.ten_kho END AS ten_nguon,
             CASE WHEN dc.loai_dich = 'CONG_TRINH' THEN ctr_d.ten_cong_trinh ELSE k_d.ten_kho END AS ten_dich
      FROM phieu_dieu_chuyen_vat_tu dc
      LEFT JOIN linh_vuc_kinh_doanh lvkd ON dc.id_linh_vuc_kinh_doanh = lvkd.id
      LEFT JOIN cong_trinh ctr_n ON dc.loai_nguon = 'CONG_TRINH' AND dc.id_nguon = ctr_n.id
      LEFT JOIN kho_hang k_n ON dc.loai_nguon = 'KHO_HANG' AND dc.id_nguon = k_n.id
      LEFT JOIN cong_trinh ctr_d ON dc.loai_dich = 'CONG_TRINH' AND dc.id_dich = ctr_d.id
      LEFT JOIN kho_hang k_d ON dc.loai_dich = 'KHO_HANG' AND dc.id_dich = k_d.id
      WHERE dc.id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy phiếu điều chuyển' });
    }

    const transfer = rows[0];

    const [items] = await db.query(`
      SELECT d.*,
             vt.ma_vat_tu, vt.ten_vat_tu, lvt.ten_loai_vat_tu AS loai_vat_tu
      FROM phieu_dieu_chuyen_vat_tu_chi_tiet d
      LEFT JOIN danh_muc_vat_tu vt ON d.id_danh_muc_vat_tu = vt.id
      LEFT JOIN danh_muc_loai_vat_tu lvt ON vt.id_loai_vat_tu = lvt.id
      WHERE d.id_phieu_dieu_chuyen = ?
    `, [req.params.id]);

    transfer.items = items;
    res.json(transfer);
  } catch (err) {
    console.error('Error fetching transfer detail:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy chi tiết phiếu điều chuyển' });
  }
});

// POST /api/dieu-chuyen-vat-tu: Create Transfer Order
router.post('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const {
      id_linh_vuc_kinh_doanh,
      id_yeu_cau_vat_tu,
      loai_dieu_chuyen,
      loai_nguon,
      id_nguon,
      loai_dich,
      id_dich,
      ngay_dieu_chuyen,
      nguoi_dieu_chuyen,
      nguoi_giao_hang,
      ly_do_dieu_chuyen,
      ghi_chu,
      items
    } = req.body;

    if (!loai_dieu_chuyen || !loai_nguon || !id_nguon || !loai_dich || !id_dich || !ngay_dieu_chuyen || !nguoi_dieu_chuyen || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin phiếu điều chuyển và danh sách vật tư' });
    }

    // Check available stock at Source if source is Site Virtual Warehouse
    if (loai_nguon === 'CONG_TRINH') {
      for (const item of items) {
        const [stockRows] = await conn.query(`
          SELECT so_luong_ton_hien_tai FROM vat_tu_cong_trinh WHERE id_cong_trinh = ? AND id_danh_muc_vat_tu = ?
        `, [id_nguon, item.id_danh_muc_vat_tu]);
        const avail = stockRows.length > 0 ? parseFloat(stockRows[0].so_luong_ton_hien_tai) || 0 : 0;
        const reqQty = parseFloat(item.so_luong_dieu_chuyen) || 0;
        if (reqQty > avail + 0.001) {
          await conn.rollback();
          return res.status(400).json({ error: `Số lượng điều chuyển (${reqQty}) vượt quá tồn kho ảo hiện tại tại công trình nguồn (${avail.toFixed(2)})` });
        }
      }
    }

    let maLvkd = 'XD';
    if (id_linh_vuc_kinh_doanh) {
      const [lvkdRows] = await conn.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [id_linh_vuc_kinh_doanh]);
      if (lvkdRows.length > 0) maLvkd = lvkdRows[0].ma_lvkd;
    }

    const nam = new Date(ngay_dieu_chuyen).getFullYear();
    const { ma_phieu: ma_phieu_dieu_chuyen, so_vao_so } = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: id_linh_vuc_kinh_doanh || 1,
      loai_chung_tu: 'DC',
      nam,
      ma_lvkd: maLvkd
    });

    const [result] = await conn.query(`
      INSERT INTO phieu_dieu_chuyen_vat_tu (
        ma_phieu_dieu_chuyen, so_vao_so, nam, id_linh_vuc_kinh_doanh, id_yeu_cau_vat_tu, loai_dieu_chuyen,
        loai_nguon, id_nguon, loai_dich, id_dich, ngay_dieu_chuyen, nguoi_dieu_chuyen, nguoi_giao_hang,
        trang_thai, ly_do_dieu_chuyen, ghi_chu
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Chờ giao', ?, ?)
    `, [
      ma_phieu_dieu_chuyen, so_vao_so, nam, id_linh_vuc_kinh_doanh || null, id_yeu_cau_vat_tu || null, loai_dieu_chuyen,
      loai_nguon, id_nguon, loai_dich, id_dich, ngay_dieu_chuyen, nguoi_dieu_chuyen, nguoi_giao_hang || null,
      ly_do_dieu_chuyen || null, ghi_chu || null
    ]);

    const transferId = result.insertId;

    for (const item of items) {
      await conn.query(`
        INSERT INTO phieu_dieu_chuyen_vat_tu_chi_tiet (
          id_phieu_dieu_chuyen, id_danh_muc_vat_tu, don_vi_tinh, so_luong_dieu_chuyen, so_luong_nhan_thuc_te, ghi_chu
        ) VALUES (?, ?, ?, ?, 0, ?)
      `, [
        transferId, item.id_danh_muc_vat_tu, item.don_vi_tinh, item.so_luong_dieu_chuyen, item.ghi_chu || null
      ]);
    }

    await conn.commit();
    res.status(201).json({ message: 'Tạo phiếu điều chuyển vật tư thành công', id: transferId, ma_phieu_dieu_chuyen });
  } catch (err) {
    await conn.rollback();
    console.error('Error creating transfer order:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi tạo phiếu điều chuyển' });
  } finally {
    conn.release();
  }
});

// PATCH /api/dieu-chuyen-vat-tu/:id/xac-nhan-nhan-hang: Confirm Goods Receipt for Transfer
router.patch('/:id/xac-nhan-nhan-hang', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { nguoi_nhan_hang, items } = req.body;
    const [rows] = await conn.query('SELECT * FROM phieu_dieu_chuyen_vat_tu WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Không tìm thấy phiếu điều chuyển' });
    }

    const transfer = rows[0];
    if (transfer.trang_thai === 'Đã nhận') {
      await conn.rollback();
      return res.status(400).json({ error: 'Phiếu điều chuyển này đã được nhận hàng trước đó' });
    }

    // Update actual received quantities for items
    if (Array.isArray(items)) {
      for (const it of items) {
        const actualQty = parseFloat(it.so_luong_nhan_thuc_te) || 0;
        await conn.query(`
          UPDATE phieu_dieu_chuyen_vat_tu_chi_tiet
          SET so_luong_nhan_thuc_te = ?
          WHERE id = ? AND id_phieu_dieu_chuyen = ?
        `, [actualQty, it.id, req.params.id]);
      }
    }

    // Update header status
    await conn.query(`
      UPDATE phieu_dieu_chuyen_vat_tu
      SET trang_thai = 'Đã nhận',
          nguoi_nhan_hang = ?
      WHERE id = ?
    `, [nguoi_nhan_hang || 'Người nhận tại điểm đích', req.params.id]);

    const [updatedItems] = await conn.query(`
      SELECT * FROM phieu_dieu_chuyen_vat_tu_chi_tiet WHERE id_phieu_dieu_chuyen = ?
    `, [req.params.id]);

    // 1. DEDUCT FROM SOURCE
    for (const item of updatedItems) {
      const qty = parseFloat(item.so_luong_nhan_thuc_te) || parseFloat(item.so_luong_dieu_chuyen) || 0;
      if (qty > 0) {
        if (transfer.loai_nguon === 'CONG_TRINH') {
          // Deduct from Virtual Site Stock
          await conn.query(`
            UPDATE vat_tu_cong_trinh
            SET so_luong_dieu_chuyen_di = so_luong_dieu_chuyen_di + ?
            WHERE id_cong_trinh = ? AND id_danh_muc_vat_tu = ?
          `, [qty, transfer.id_nguon, item.id_danh_muc_vat_tu]);
        } else if (transfer.loai_nguon === 'KHO_HANG') {
          // Deduct from Company Warehouse Stock in ton_kho
          await conn.query(`
            UPDATE ton_kho
            SET so_luong_ton = so_luong_ton - ?
            WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?
          `, [qty, transfer.id_nguon, item.id_danh_muc_vat_tu]);
        }
      }
    }

    // 2. ADD TO TARGET
    for (const item of updatedItems) {
      const qty = parseFloat(item.so_luong_nhan_thuc_te) || 0;
      if (qty > 0) {
        if (transfer.loai_dich === 'CONG_TRINH') {
          // Add to Virtual Site Stock
          await conn.query(`
            INSERT INTO vat_tu_cong_trinh (id_cong_trinh, id_danh_muc_vat_tu, so_luong_nhan_tong)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE so_luong_nhan_tong = so_luong_nhan_tong + ?
          `, [transfer.id_dich, item.id_danh_muc_vat_tu, qty, qty]);
        } else if (transfer.loai_dich === 'KHO_HANG') {
          // Add to Company Warehouse Stock in ton_kho
          const [destStock] = await conn.query(
            'SELECT id FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?',
            [transfer.id_dich, item.id_danh_muc_vat_tu]
          );
          if (destStock.length > 0) {
            await conn.query(
              'UPDATE ton_kho SET so_luong_ton = so_luong_ton + ? WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?',
              [qty, transfer.id_dich, item.id_danh_muc_vat_tu]
            );
          } else {
            await conn.query(
              'INSERT INTO ton_kho (id_kho_hang, id_danh_muc_vat_tu, so_luong_ton) VALUES (?, ?, ?)',
              [transfer.id_dich, item.id_danh_muc_vat_tu, qty]
            );
          }
        }
      }
    }

    await conn.commit();
    res.json({ message: 'Xác nhận điều chuyển hàng thành công và đã cập nhật kho nguồn & đích' });
  } catch (err) {
    await conn.rollback();
    console.error('Error confirming transfer:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi xác nhận điều chuyển' });
  } finally {
    conn.release();
  }
});

module.exports = router;
