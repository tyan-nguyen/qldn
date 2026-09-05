const express = require('express');
const router = express.Router();
const { pool: db } = require('../config/db');
const { generateSequenceNumber } = require('../services/sequenceService');

// --- 1. KHO TẠM CÔNG TRÌNH (Vật tư hiện có tại công trình) ---
router.get('/ton-kho-cong-trinh', async (req, res) => {
  try {
    const { id_cong_trinh, search } = req.query;
    if (!id_cong_trinh) {
      return res.status(400).json({ error: 'Vui lòng cung cấp id_cong_trinh' });
    }

    let query = `
      SELECT v.*,
             vt.ma_vat_tu, vt.ten_vat_tu, vt.don_vi_tinh, lvt.ten_loai_vat_tu AS loai_vat_tu
      FROM vat_tu_cong_trinh v
      JOIN danh_muc_vat_tu vt ON v.id_danh_muc_vat_tu = vt.id
      LEFT JOIN danh_muc_loai_vat_tu lvt ON vt.id_loai_vat_tu = lvt.id
      WHERE v.id_cong_trinh = ?
    `;
    const params = [id_cong_trinh];

    if (search) {
      const term = `%${search}%`;
      query += ` AND (vt.ma_vat_tu LIKE ? OR vt.ten_vat_tu LIKE ? OR lvt.ten_loai_vat_tu LIKE ?)`;
      params.push(term, term, term);
    }

    query += ` ORDER BY vt.ten_vat_tu ASC`;

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching site virtual inventory:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy tồn kho công trình' });
  }
});

// --- 2. ĐẦU RA 1: SỬ DỤNG VẬT TƯ THI CÔNG (CONSUMPTION) ---
router.get('/su-dung', async (req, res) => {
  try {
    const { id_cong_trinh } = req.query;
    let query = `
      SELECT s.*, c.ten_cong_trinh
      FROM phieu_su_dung_vat_tu s
      LEFT JOIN cong_trinh c ON s.id_cong_trinh = c.id
      WHERE 1=1
    `;
    const params = [];
    if (id_cong_trinh) {
      query += ` AND s.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }
    query += ` ORDER BY s.id DESC`;

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching usage slips:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy danh sách phiếu sử dụng vật tư' });
  }
});

router.post('/su-dung', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { id_cong_trinh, id_boq_item, ngay_su_dung, nguoi_su_dung, noi_dung_thi_cong, ghi_chu, items } = req.body;
    if (!id_cong_trinh || !ngay_su_dung || !nguoi_su_dung || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ thông tin phiếu sử dụng và danh sách vật tư' });
    }

    // Check available stock at site
    for (const item of items) {
      const [stockRows] = await conn.query(`
        SELECT so_luong_ton_hien_tai FROM vat_tu_cong_trinh WHERE id_cong_trinh = ? AND id_danh_muc_vat_tu = ?
      `, [id_cong_trinh, item.id_danh_muc_vat_tu]);
      const avail = stockRows.length > 0 ? parseFloat(stockRows[0].so_luong_ton_hien_tai) || 0 : 0;
      const reqQty = parseFloat(item.so_luong_su_dung) || 0;
      if (reqQty > avail + 0.001) {
        await conn.rollback();
        return res.status(400).json({ error: `Số lượng xuất dùng (${reqQty}) vượt quá số lượng tồn tại công trình (${avail.toFixed(2)})` });
      }
    }

    const nam = new Date(ngay_su_dung).getFullYear();
    const { ma_phieu: ma_phieu_su_dung } = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: 1,
      loai_chung_tu: 'SD',
      nam,
      ma_lvkd: 'XD'
    });

    const [result] = await conn.query(`
      INSERT INTO phieu_su_dung_vat_tu (ma_phieu_su_dung, id_cong_trinh, id_boq_item, ngay_su_dung, nguoi_su_dung, noi_dung_thi_cong, ghi_chu)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [ma_phieu_su_dung, id_cong_trinh, id_boq_item || null, ngay_su_dung, nguoi_su_dung, noi_dung_thi_cong || null, ghi_chu || null]);

    const slipId = result.insertId;

    for (const item of items) {
      const qty = parseFloat(item.so_luong_su_dung) || 0;
      await conn.query(`
        INSERT INTO phieu_su_dung_vat_tu_chi_tiet (id_phieu_su_dung, id_danh_muc_vat_tu, don_vi_tinh, so_luong_su_dung, ghi_chu)
        VALUES (?, ?, ?, ?, ?)
      `, [slipId, item.id_danh_muc_vat_tu, item.don_vi_tinh, qty, item.ghi_chu || null]);

      // Deduct site inventory by increasing so_luong_da_su_dung
      await conn.query(`
        UPDATE vat_tu_cong_trinh
        SET so_luong_da_su_dung = so_luong_da_su_dung + ?
        WHERE id_cong_trinh = ? AND id_danh_muc_vat_tu = ?
      `, [qty, id_cong_trinh, item.id_danh_muc_vat_tu]);
    }

    await conn.commit();
    res.status(201).json({ message: 'Ghi nhận xuất dùng vật tư công trình thành công', id: slipId, ma_phieu_su_dung });
  } catch (err) {
    await conn.rollback();
    console.error('Error creating site usage slip:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lập phiếu sử dụng vật tư' });
  } finally {
    conn.release();
  }
});

// --- 3. ĐẦU RA 2: TRẢ LẠI KHO CÔNG TY (RETURN TO WAREHOUSE) ---
router.get('/tra-lai', async (req, res) => {
  try {
    const { id_cong_trinh } = req.query;
    let query = `
      SELECT t.*, c.ten_cong_trinh, k.ten_kho AS ten_kho_nhan
      FROM phieu_tra_lai_kho t
      LEFT JOIN cong_trinh c ON t.id_cong_trinh = c.id
      LEFT JOIN kho_hang k ON t.id_kho_nhan = k.id
      WHERE 1=1
    `;
    const params = [];
    if (id_cong_trinh) {
      query += ` AND t.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }
    query += ` ORDER BY t.id DESC`;

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching return slips:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy danh sách phiếu trả lại kho' });
  }
});

router.post('/tra-lai', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { id_cong_trinh, id_kho_nhan, ngay_tra, nguoi_tra, ly_do_tra, items } = req.body;
    if (!id_cong_trinh || !id_kho_nhan || !ngay_tra || !nguoi_tra || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ thông tin phiếu trả lại kho' });
    }

    const nam = new Date(ngay_tra).getFullYear();
    const { ma_phieu: ma_phieu_tra } = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: 1,
      loai_chung_tu: 'TLK',
      nam,
      ma_lvkd: 'XD'
    });

    const [result] = await conn.query(`
      INSERT INTO phieu_tra_lai_kho (ma_phieu_tra, id_cong_trinh, id_kho_nhan, ngay_tra, nguoi_tra, trang_thai, ly_do_tra)
      VALUES (?, ?, ?, ?, ?, 'Chờ nhập kho', ?)
    `, [ma_phieu_tra, id_cong_trinh, id_kho_nhan, ngay_tra, nguoi_tra, ly_do_tra || null]);

    const returnId = result.insertId;

    for (const item of items) {
      const qty = parseFloat(item.so_luong_tra) || 0;
      await conn.query(`
        INSERT INTO phieu_tra_lai_kho_chi_tiet (id_phieu_tra_lai, id_danh_muc_vat_tu, don_vi_tinh, so_luong_tra, ghi_chu)
        VALUES (?, ?, ?, ?, ?)
      `, [returnId, item.id_danh_muc_vat_tu, item.don_vi_tinh, qty, item.ghi_chu || null]);
    }

    await conn.commit();
    res.status(201).json({ message: 'Tạo phiếu trả lại kho công ty thành công', id: returnId, ma_phieu_tra });
  } catch (err) {
    await conn.rollback();
    console.error('Error creating return slip:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi tạo phiếu trả lại kho' });
  } finally {
    conn.release();
  }
});

// Confirm warehouse receipt for Return slip -> Reduces site stock & INCREASES COMPANY WAREHOUSE STOCK
router.patch('/tra-lai/:id/xac-nhan', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { nguoi_nhan_kho } = req.body;
    const [rows] = await conn.query('SELECT * FROM phieu_tra_lai_kho WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Không tìm thấy phiếu trả lại kho' });
    }

    const returnSlip = rows[0];
    if (returnSlip.trang_thai === 'Đã nhập kho') {
      await conn.rollback();
      return res.status(400).json({ error: 'Phiếu trả lại này đã được nhập kho trước đó' });
    }

    await conn.query(`
      UPDATE phieu_tra_lai_kho
      SET trang_thai = 'Đã nhập kho',
          nguoi_nhan_kho = ?
      WHERE id = ?
    `, [nguoi_nhan_kho || 'Thủ kho công ty', req.params.id]);

    const [items] = await conn.query(`
      SELECT * FROM phieu_tra_lai_kho_chi_tiet WHERE id_phieu_tra_lai = ?
    `, [req.params.id]);

    for (const item of items) {
      const qty = parseFloat(item.so_luong_tra) || 0;
      if (qty > 0) {
        // 1. Deduct from site virtual stock (by increasing so_luong_da_tra_lai)
        await conn.query(`
          UPDATE vat_tu_cong_trinh
          SET so_luong_da_tra_lai = so_luong_da_tra_lai + ?
          WHERE id_cong_trinh = ? AND id_danh_muc_vat_tu = ?
        `, [qty, returnSlip.id_cong_trinh, item.id_danh_muc_vat_tu]);

        // 2. INCREASE COMPANY WAREHOUSE STOCK
        await conn.query(`
          INSERT INTO kho_hang (id_kho, id_danh_muc_vat_tu, ton_kho)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE ton_kho = ton_kho + ?
        `, [returnSlip.id_kho_nhan, item.id_danh_muc_vat_tu, qty, qty]);
      }
    }

    await conn.commit();
    res.json({ message: 'Xác nhận nhập lại kho công ty thành công và đã tăng tồn kho' });
  } catch (err) {
    await conn.rollback();
    console.error('Error confirming return slip:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi xác nhận nhận lại kho' });
  } finally {
    conn.release();
  }
});

// --- 4. ĐẦU RA 3: HAO HỤT VẬT TƯ (LOSS / WASTAGE) ---
router.get('/hao-hut', async (req, res) => {
  try {
    const { id_cong_trinh } = req.query;
    let query = `
      SELECT h.*, c.ten_cong_trinh
      FROM phieu_hao_hut_vat_tu h
      LEFT JOIN cong_trinh c ON h.id_cong_trinh = c.id
      WHERE 1=1
    `;
    const params = [];
    if (id_cong_trinh) {
      query += ` AND h.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }
    query += ` ORDER BY h.id DESC`;

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching wastage slips:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy danh sách phiếu hao hụt vật tư' });
  }
});

router.post('/hao-hut', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { id_cong_trinh, ngay_ghi_nhan, nguoi_bao_cao, ly_do_hao_hut, items } = req.body;
    if (!id_cong_trinh || !ngay_ghi_nhan || !nguoi_bao_cao || !ly_do_hao_hut || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ thông tin báo cáo hao hụt vật tư' });
    }

    const nam = new Date(ngay_ghi_nhan).getFullYear();
    const { ma_phieu: ma_phieu_hao_hut } = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: 1,
      loai_chung_tu: 'HH',
      nam,
      ma_lvkd: 'XD'
    });

    const [result] = await conn.query(`
      INSERT INTO phieu_hao_hut_vat_tu (ma_phieu_hao_hut, id_cong_trinh, ngay_ghi_nhan, nguoi_bao_cao, trang_thai, ly_do_hao_hut)
      VALUES (?, ?, ?, ?, 'Chờ duyệt', ?)
    `, [ma_phieu_hao_hut, id_cong_trinh, ngay_ghi_nhan, nguoi_bao_cao, ly_do_hao_hut]);

    const wastageId = result.insertId;

    for (const item of items) {
      const qty = parseFloat(item.so_luong_hao_hut) || 0;
      await conn.query(`
        INSERT INTO phieu_hao_hut_vat_tu_chi_tiet (id_phieu_hao_hut, id_danh_muc_vat_tu, don_vi_tinh, so_luong_hao_hut, ghi_chu)
        VALUES (?, ?, ?, ?, ?)
      `, [wastageId, item.id_danh_muc_vat_tu, item.don_vi_tinh, qty, item.ghi_chu || null]);
    }

    await conn.commit();
    res.status(201).json({ message: 'Lập báo cáo hao hụt vật tư thành công', id: wastageId, ma_phieu_hao_hut });
  } catch (err) {
    await conn.rollback();
    console.error('Error creating wastage slip:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lập báo cáo hao hụt' });
  } finally {
    conn.release();
  }
});

// Approve Wastage -> Deducts site virtual stock by increasing so_luong_hao_hut
router.patch('/hao-hut/:id/duyet', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { trang_thai, nguoi_duyet } = req.body;
    if (!['Đã duyệt', 'Từ chối'].includes(trang_thai)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Trạng thái phê duyệt không hợp lệ' });
    }

    const [rows] = await conn.query('SELECT * FROM phieu_hao_hut_vat_tu WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Không tìm thấy phiếu hao hụt vật tư' });
    }

    const wastage = rows[0];
    await conn.query(`
      UPDATE phieu_hao_hut_vat_tu
      SET trang_thai = ?,
          nguoi_duyet = ?,
          thoi_gian_duyet = NOW()
      WHERE id = ?
    `, [trang_thai, nguoi_duyet || 'Chỉ huy trưởng', req.params.id]);

    if (trang_thai === 'Đã duyệt') {
      const [items] = await conn.query('SELECT * FROM phieu_hao_hut_vat_tu_chi_tiet WHERE id_phieu_hao_hut = ?', [req.params.id]);
      for (const item of items) {
        const qty = parseFloat(item.so_luong_hao_hut) || 0;
        if (qty > 0) {
          await conn.query(`
            UPDATE vat_tu_cong_trinh
            SET so_luong_hao_hut = so_luong_hao_hut + ?
            WHERE id_cong_trinh = ? AND id_danh_muc_vat_tu = ?
          `, [qty, wastage.id_cong_trinh, item.id_danh_muc_vat_tu]);
        }
      }
    }

    await conn.commit();
    res.json({ message: `Đã ${trang_thai.toLowerCase()} báo cáo hao hụt vật tư` });
  } catch (err) {
    await conn.rollback();
    console.error('Error approving wastage slip:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi phê duyệt báo cáo hao hụt' });
  } finally {
    conn.release();
  }
});

module.exports = router;
