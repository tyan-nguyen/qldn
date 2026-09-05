const express = require('express');
const router = express.Router();
const { pool: db } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { generateSequenceNumber } = require('../services/sequenceService');

// GET /api/phieu-mua-hang/years: List distinct recording years
router.get('/years', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT COALESCE(nam, YEAR(ngay_mua), YEAR(ngay_du_kien_giao)) as year 
       FROM phieu_mua_hang 
       WHERE nam IS NOT NULL OR ngay_mua IS NOT NULL OR ngay_du_kien_giao IS NOT NULL
       ORDER BY year DESC`
    );
    const currentYear = new Date().getFullYear();
    const dbYears = rows.map(r => parseInt(r.year, 10)).filter(y => !isNaN(y) && y >= 2025 && y <= currentYear);
    const uniqueYears = Array.from(new Set([currentYear, ...dbYears])).sort((a, b) => b - a);
    return res.json(uniqueYears);
  } catch (err) {
    console.error('Error fetching PO years:', err);
    return res.status(500).json({ error: 'Lỗi lấy danh sách năm' });
  }
});

// GET /api/phieu-mua-hang: List Purchase Orders
router.get('/', async (req, res) => {
  try {
    const {
      id_linh_vuc_kinh_doanh, loai_mua_hang, id_cong_trinh,
      id_yeu_cau_vat_tu, trang_thai_giao_hang, search, nam, year
    } = req.query;
    let query = `
      SELECT p.*,
             c.ten_cong_trinh, c.ten_viet_tat,
             k.ten_kho AS ten_kho_nhap,
             lvkd.ten_lvkd, lvkd.ma_lvkd,
             ym.ma_yeu_cau AS ma_yeu_cau_mua,
             ycv.ma_phieu AS ma_yeu_cau_vat_tu,
             (SELECT COUNT(*) FROM phieu_mua_hang_chi_tiet WHERE id_phieu_mua_hang = p.id) AS tong_so_mat_hang
      FROM phieu_mua_hang p
      LEFT JOIN cong_trinh c ON p.id_cong_trinh = c.id
      LEFT JOIN kho_hang k ON p.id_kho_nhap = k.id
      LEFT JOIN linh_vuc_kinh_doanh lvkd ON p.id_linh_vuc_kinh_doanh = lvkd.id
      LEFT JOIN yeu_cau_mua_hang ym ON p.id_yeu_cau_mua_hang = ym.id
      LEFT JOIN yeu_cau_vat_tu ycv ON p.id_yeu_cau_vat_tu = ycv.id
      WHERE 1=1
    `;
    const params = [];

    const selectedYear = nam || year;
    if (selectedYear && selectedYear !== 'ALL' && selectedYear !== 'all') {
      query += ` AND (p.nam = ? OR YEAR(p.ngay_mua) = ? OR YEAR(p.ngay_du_kien_giao) = ?)`;
      params.push(selectedYear, selectedYear, selectedYear);
    }

    if (id_linh_vuc_kinh_doanh) {
      query += ` AND p.id_linh_vuc_kinh_doanh = ?`;
      params.push(id_linh_vuc_kinh_doanh);
    }
    if (loai_mua_hang) {
      query += ` AND p.loai_mua_hang = ?`;
      params.push(loai_mua_hang);
    }
    if (id_cong_trinh) {
      query += ` AND p.id_cong_trinh = ?`;
      params.push(id_cong_trinh);
    }
    if (id_yeu_cau_vat_tu) {
      query += ` AND p.id_yeu_cau_vat_tu = ?`;
      params.push(id_yeu_cau_vat_tu);
    }
    if (trang_thai_giao_hang) {
      query += ` AND p.trang_thai_giao_hang = ?`;
      params.push(trang_thai_giao_hang);
    }
    if (search) {
      const term = `%${search}%`;
      query += ` AND (p.ma_phieu_mua LIKE ? OR p.ten_nha_cung_cap LIKE ? OR c.ten_cong_trinh LIKE ?)`;
      params.push(term, term, term);
    }

    query += ` ORDER BY p.id DESC`;

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching purchase orders:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy danh sách phiếu mua hàng' });
  }
});

// GET /api/phieu-mua-hang/:id: Get Single PO Detail
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.*,
             c.ten_cong_trinh, c.ten_viet_tat,
             k.ten_kho AS ten_kho_nhap,
             lvkd.ten_lvkd, lvkd.ma_lvkd,
             ym.ma_yeu_cau AS ma_yeu_cau_mua,
             ycv.ma_phieu AS ma_yeu_cau_vat_tu
      FROM phieu_mua_hang p
      LEFT JOIN cong_trinh c ON p.id_cong_trinh = c.id
      LEFT JOIN kho_hang k ON p.id_kho_nhap = k.id
      LEFT JOIN linh_vuc_kinh_doanh lvkd ON p.id_linh_vuc_kinh_doanh = lvkd.id
      LEFT JOIN yeu_cau_mua_hang ym ON p.id_yeu_cau_mua_hang = ym.id
      LEFT JOIN yeu_cau_vat_tu ycv ON p.id_yeu_cau_vat_tu = ycv.id
      WHERE p.id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy phiếu mua hàng' });
    }

    const order = rows[0];

    const [items] = await db.query(`
      SELECT d.*,
             vt.ma_vat_tu, vt.ten_vat_tu, lvt.ten_loai_vat_tu AS loai_vat_tu
      FROM phieu_mua_hang_chi_tiet d
      LEFT JOIN danh_muc_vat_tu vt ON d.id_danh_muc_vat_tu = vt.id
      LEFT JOIN danh_muc_loai_vat_tu lvt ON vt.id_loai_vat_tu = lvt.id
      WHERE d.id_phieu_mua_hang = ?
    `, [req.params.id]);

    order.items = items;
    res.json(order);
  } catch (err) {
    console.error('Error fetching PO detail:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi lấy chi tiết phiếu mua hàng' });
  }
});

// POST /api/phieu-mua-hang: Create Purchase Order
router.post('/', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const {
      id_yeu_cau_mua_hang,
      id_yeu_cau_vat_tu,
      id_linh_vuc_kinh_doanh,
      loai_mua_hang,
      id_cong_trinh,
      id_kho_nhap,
      id_nha_cung_cap,
      ten_nha_cung_cap,
      ngay_mua,
      ngay_du_kien_giao,
      nguoi_mua_hang,
      nguoi_giao_hang,
      ghi_chu,
      items
    } = req.body;

    if (!loai_mua_hang || !ngay_mua || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Vui lòng cung cấp đầy đủ thông tin phiếu mua hàng và danh sách vật tư' });
    }

    if (loai_mua_hang === 'MUA_CHO_CONG_TRINH' && !id_cong_trinh) {
      await conn.rollback();
      return res.status(400).json({ error: 'Mua hàng cho công trình bắt buộc chọn công trình chỉ định' });
    }
    if (loai_mua_hang === 'MUA_NHAP_KHO' && !id_kho_nhap) {
      await conn.rollback();
      return res.status(400).json({ error: 'Mua hàng nhập kho bắt buộc chọn kho công ty chỉ định' });
    }

    // Check duplicate material rows in items payload
    const seenMatIds = new Set();
    for (const item of items) {
      const matIdStr = String(item.id_danh_muc_vat_tu);
      if (seenMatIds.has(matIdStr)) {
        await conn.rollback();
        return res.status(400).json({ error: 'Phiếu mua hàng chứa các dòng vật tư bị trùng lặp. Vui lòng gộp số lượng thành 1 dòng.' });
      }
      seenMatIds.add(matIdStr);
    }

    // Validate Requisition Items & Quantity limits if linked to YCMH
    if (id_yeu_cau_mua_hang) {
      const [reqItemRows] = await conn.query('SELECT * FROM yeu_cau_mua_hang_chi_tiet WHERE id_yeu_cau_mua_hang = ?', [id_yeu_cau_mua_hang]);

      for (const item of items) {
        const reqItem = reqItemRows.find(r => String(r.id_danh_muc_vat_tu) === String(item.id_danh_muc_vat_tu));
        if (!reqItem) {
          await conn.rollback();
          return res.status(400).json({ error: `Vật tư ID ${item.id_danh_muc_vat_tu} không nằm trong danh sách của phiếu đề xuất mua hàng đã chọn` });
        }

        const approvedQty = parseFloat(reqItem.so_luong_can_mua || reqItem.so_luong_yeu_cau || 0);
        const daTao = parseFloat(reqItem.so_luong_da_tao_don_mua || 0);
        const requestQty = parseFloat(item.so_luong_mua || 0);
        const maxRemaining = Math.max(0, approvedQty - daTao);

        if (requestQty > maxRemaining) {
          await conn.rollback();
          return res.status(400).json({
            error: `Số lượng mua (${requestQty}) vượt quá số lượng còn lại được phép mua (${maxRemaining}) của phiếu đề xuất`
          });
        }
      }
    }

    // Get LVKD code
    let maLvkd = 'XD';
    if (id_linh_vuc_kinh_doanh) {
      const [lvkdRows] = await conn.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [id_linh_vuc_kinh_doanh]);
      if (lvkdRows.length > 0) maLvkd = lvkdRows[0].ma_lvkd;
    }

    const nam = new Date(ngay_mua).getFullYear();
    const { ma_phieu: ma_phieu_mua, so_vao_so } = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: id_linh_vuc_kinh_doanh || 1,
      loai_chung_tu: 'PMH',
      nam,
      ma_lvkd: maLvkd
    });

    let tongTien = 0;
    items.forEach(it => {
      tongTien += (parseFloat(it.so_luong_mua) || 0) * (parseFloat(it.don_gia) || 0);
    });

    const [result] = await conn.query(`
      INSERT INTO phieu_mua_hang (
        ma_phieu_mua, so_vao_so, nam, id_yeu_cau_mua_hang, id_yeu_cau_vat_tu, id_linh_vuc_kinh_doanh,
        loai_mua_hang, id_cong_trinh, id_kho_nhap, id_nha_cung_cap, ten_nha_cung_cap,
        ngay_mua, ngay_du_kien_giao, trang_thai_giao_hang, nguoi_mua_hang, nguoi_giao_hang, tong_tien, ghi_chu
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Chờ giao', ?, ?, ?, ?)
    `, [
      ma_phieu_mua, so_vao_so, nam, id_yeu_cau_mua_hang || null, id_yeu_cau_vat_tu || null, id_linh_vuc_kinh_doanh || null,
      loai_mua_hang, id_cong_trinh || null, id_kho_nhap || null, id_nha_cung_cap || null, ten_nha_cung_cap || null,
      ngay_mua, ngay_du_kien_giao || null, nguoi_mua_hang || null, nguoi_giao_hang || null, tongTien, ghi_chu || null
    ]);

    const orderId = result.insertId;

    for (const item of items) {
      await conn.query(`
        INSERT INTO phieu_mua_hang_chi_tiet (
          id_phieu_mua_hang, id_chi_tiet_yeu_cau_mua, id_chi_tiet_yeu_cau_vat_tu, id_danh_muc_vat_tu,
          don_vi_tinh, so_luong_mua, so_luong_nhan_thuc_te, don_gia, thanh_tien, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `, [
        orderId,
        item.id_chi_tiet_yeu_cau_mua || null,
        item.id_chi_tiet_yeu_cau_vat_tu || null,
        item.id_danh_muc_vat_tu,
        item.don_vi_tinh,
        item.so_luong_mua,
        item.don_gia || 0,
        (parseFloat(item.so_luong_mua) || 0) * (parseFloat(item.don_gia) || 0),
        item.ghi_chu || null
      ]);

      // If created from Requisition, update so_luong_da_tao_don_mua in yeu_cau_mua_hang_chi_tiet
      if (item.id_chi_tiet_yeu_cau_mua) {
        await conn.query(`
          UPDATE yeu_cau_mua_hang_chi_tiet
          SET so_luong_da_tao_don_mua = so_luong_da_tao_don_mua + ?
          WHERE id = ?
        `, [item.so_luong_mua, item.id_chi_tiet_yeu_cau_mua]);
      }
    }

    await conn.commit();
    res.status(201).json({ message: 'Tạo phiếu mua hàng thành công', id: orderId, ma_phieu_mua });
  } catch (err) {
    await conn.rollback();
    console.error('Error creating purchase order:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi tạo phiếu mua hàng' });
  } finally {
    conn.release();
  }
});

// PATCH /api/phieu-mua-hang/:id/xac-nhan-nhan-hang: Confirm Goods Receipt with Actual Received Qty
router.patch('/:id/xac-nhan-nhan-hang', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { nguoi_nhan_hang, ngay_giao_thuc_te, items } = req.body;

    const [rows] = await conn.query('SELECT * FROM phieu_mua_hang WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Không tìm thấy phiếu mua hàng' });
    }

    const order = rows[0];
    if (order.trang_thai_giao_hang === 'Đã giao') {
      await conn.rollback();
      return res.status(400).json({ error: 'Phiếu mua hàng này đã được xác nhận nhận hàng trước đó' });
    }

    // Update line items with actual received quantities
    if (Array.isArray(items)) {
      for (const it of items) {
        const actualQty = parseFloat(it.so_luong_nhan_thuc_te) || 0;
        await conn.query(`
          UPDATE phieu_mua_hang_chi_tiet
          SET so_luong_nhan_thuc_te = ?
          WHERE id = ? AND id_phieu_mua_hang = ?
        `, [actualQty, it.id, req.params.id]);
      }
    }

    // Update PO Header status
    const actualDeliveryDate = ngay_giao_thuc_te || new Date().toISOString().split('T')[0];
    await conn.query(`
      UPDATE phieu_mua_hang
      SET trang_thai_giao_hang = 'Đã giao',
          ngay_giao_thuc_te = ?,
          nguoi_nhan_hang = ?
      WHERE id = ?
    `, [actualDeliveryDate, nguoi_nhan_hang || 'Thủ kho công trình', req.params.id]);

    // Fetch updated line items to create Goods Receipt & update inventory
    const [updatedItems] = await conn.query(`
      SELECT * FROM phieu_mua_hang_chi_tiet WHERE id_phieu_mua_hang = ?
    `, [req.params.id]);

    const lvkdId = order.id_linh_vuc_kinh_doanh || 1;
    const currentYear = new Date().getFullYear();

    let maLvkd = 'VLXD';
    const [lvkdRows] = await conn.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [lvkdId]);
    if (lvkdRows.length > 0 && lvkdRows[0].ma_lvkd) {
      maLvkd = lvkdRows[0].ma_lvkd.trim().toUpperCase();
    }

    // Generate NK Sequence
    const seq = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: lvkdId,
      loai_chung_tu: 'NK',
      nam: currentYear,
      ma_lvkd: maLvkd
    });

    let tongTienPnk = 0;
    updatedItems.forEach(it => {
      const q = parseFloat(it.so_luong_nhan_thuc_te) || parseFloat(it.so_luong_mua) || 0;
      const p = parseFloat(it.don_gia) || 0;
      tongTienPnk += q * p;
    });

    // Create Goods Receipt (phieu_nhap_kho)
    const [pnkResult] = await conn.query(
      `INSERT INTO phieu_nhap_kho (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_nhap_kho,
        id_phieu_mua_hang, id_nha_cung_cap, id_kho_hang, id_cong_trinh,
        thoi_gian_nhap, nguoi_giao_hang, nguoi_nhap_kho, tong_tien,
        trang_thai_nhap, ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, 'mua_hang', ?, ?, ?, ?, ?, ?, ?, ?, 'Đã nhập', ?, ?)`,
      [
        seq.ma_phieu,
        seq.so_vao_so,
        currentYear,
        lvkdId,
        order.id,
        order.id_nha_cung_cap || null,
        order.id_kho_nhap || 1,
        order.id_cong_trinh || null,
        actualDeliveryDate,
        order.nguoi_giao_hang || null,
        nguoi_nhan_hang || 'Thủ kho',
        tongTienPnk,
        `Nhập kho tự động từ phiếu mua hàng ${order.ma_phieu_mua}`,
        req.user?.ten_dang_nhap || 'system'
      ]
    );

    const pnkId = pnkResult.insertId;

    for (const item of updatedItems) {
      const actualQty = parseFloat(item.so_luong_nhan_thuc_te) || parseFloat(item.so_luong_mua) || 0;
      const price = parseFloat(item.don_gia) || 0;
      const lineTotal = actualQty * price;

      await conn.query(
        `INSERT INTO phieu_nhap_kho_chi_tiet (
          id_phieu_nhap_kho, id_chi_tiet_phieu_mua_hang, id_danh_muc_vat_tu,
          don_vi_tinh, so_luong_yeu_cau, so_luong_thuc_nhap, don_gia, chiet_khau, thanh_tien, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'Nhập từ PO')`,
        [
          pnkId,
          item.id,
          item.id_danh_muc_vat_tu,
          item.don_vi_tinh || '',
          item.so_luong_mua,
          actualQty,
          price,
          lineTotal
        ]
      );

      if (actualQty > 0) {
        if (order.loai_mua_hang === 'MUA_CHO_CONG_TRINH' && order.id_cong_trinh) {
          // Direct Purchase for Site -> Update Virtual Site Inventory (vat_tu_cong_trinh)
          await conn.query(`
            INSERT INTO vat_tu_cong_trinh (id_cong_trinh, id_danh_muc_vat_tu, so_luong_nhan_tong)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE so_luong_nhan_tong = so_luong_nhan_tong + ?
          `, [order.id_cong_trinh, item.id_danh_muc_vat_tu, actualQty, actualQty]);
        } else if (order.id_kho_nhap) {
          // Warehouse Restock Purchase -> Update Company Warehouse Inventory (ton_kho)
          const [whStock] = await conn.query(
            'SELECT id, so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ?',
            [order.id_kho_nhap, item.id_danh_muc_vat_tu]
          );

          let tonKhoId;
          if (whStock.length > 0) {
            tonKhoId = whStock[0].id;
            await conn.query(
              'UPDATE ton_kho SET so_luong_ton = so_luong_ton + ? WHERE id = ?',
              [actualQty, tonKhoId]
            );
          } else {
            const [insertStock] = await conn.query(
              'INSERT INTO ton_kho (id_kho_hang, id_danh_muc_vat_tu, so_luong_ton) VALUES (?, ?, ?)',
              [order.id_kho_nhap, item.id_danh_muc_vat_tu, actualQty]
            );
            tonKhoId = insertStock.insertId;
          }

          await conn.query(
            `INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, nguoi_tao)
             VALUES (?, ?, ?, ?, ?, 'Phiếu nhập kho', ?)`,
            [tonKhoId, order.id_kho_nhap, item.id_danh_muc_vat_tu, actualQty, pnkId, req.user?.ten_dang_nhap || 'system']
          );

          await conn.query(
            `INSERT INTO nhat_ky_kho (id_kho_hang_dich, id_danh_muc_vat_tu, so_luong, don_gia, loai_giao_dich, trang_thai, ngay_thuc_hien, so_chung_tu, nguoi_tao)
             VALUES (?, ?, ?, ?, 'Nhap_Kho_Mua_Hang', 'Da_Nghiem_Thu', NOW(), ?, ?)`,
            [order.id_kho_nhap, item.id_danh_muc_vat_tu, actualQty, price, seq.ma_phieu, req.user?.ten_dang_nhap || 'system']
          );
        }
      }
    }

    await conn.commit();
    res.json({ message: 'Xác nhận giao nhận hàng thành công và đã cập nhật kho' });
  } catch (err) {
    await conn.rollback();
    console.error('Error confirming PO goods receipt:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi xác nhận nhận hàng' });
  } finally {
    conn.release();
  }
});

// POST /api/phieu-mua-hang/:id/thanh-toan: Process payment for Purchase Order and auto create Payment Voucher (PC)
router.post('/:id/thanh-toan', authMiddleware, authorize(['Ke_Toan', 'Ban_Giam_Doc', 'Admin', 'Vat_Tu']), async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { so_tien, id_quy_tien, hinh_thuc_thanh_toan = 'Tien_Mat', ngay_chung_tu, nguoi_nhan_tien, ly_do_chi, kem_theo_chung_tu_goc } = req.body;
    const amount = parseFloat(so_tien);

    if (!amount || amount <= 0) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'Vui lòng nhập số tiền thanh toán hợp lệ (> 0).' });
    }

    if (!id_quy_tien) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: 'Vui lòng chọn Quỹ tiền / Tài khoản thanh toán.' });
    }

    const [rows] = await conn.query('SELECT * FROM phieu_mua_hang WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: 'Không tìm thấy phiếu mua hàng.' });
    }

    const order = rows[0];
    const totalPO = parseFloat(order.tong_tien) || 0;
    const currentPaid = parseFloat(order.da_thanh_toan) || 0;
    const remainingBefore = Math.max(0, totalPO - currentPaid);

    if (amount > remainingBefore) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ error: `Số tiền thanh toán (${amount.toLocaleString('vi-VN')} đ) không được vượt quá số tiền còn nợ (${remainingBefore.toLocaleString('vi-VN')} đ).` });
    }

    const newPaid = currentPaid + amount;
    const remainingAfter = Math.max(0, totalPO - newPaid);
    const payStatus = newPaid >= totalPO ? 'Đã thanh toán' : (newPaid > 0 ? 'Thanh toán một phần' : 'Chưa thanh toán');

    // Update PO
    await conn.query(
      'UPDATE phieu_mua_hang SET da_thanh_toan = ?, con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?',
      [newPaid, remainingAfter, payStatus, order.id]
    );

    const lvkdId = order.id_linh_vuc_kinh_doanh || 1;
    const currentYear = ngay_chung_tu ? new Date(ngay_chung_tu).getFullYear() : new Date().getFullYear();

    let maLvkd = 'VLXD';
    const [lvkdRows] = await conn.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [lvkdId]);
    if (lvkdRows.length > 0 && lvkdRows[0].ma_lvkd) {
      maLvkd = lvkdRows[0].ma_lvkd.trim().toUpperCase();
    }

    // Generate PC Sequence
    const seq = await generateSequenceNumber(conn, {
      id_linh_vuc_kinh_doanh: lvkdId,
      loai_chung_tu: 'PC',
      nam: currentYear,
      ma_lvkd: maLvkd
    });

    const tenNcc = order.ten_nha_cung_cap || 'Nhà cung cấp';
    const reason = ly_do_chi || `Thanh toán tiền mua hàng theo phiếu ${order.ma_phieu_mua}`;

    // Create Payment Voucher (phieu_thu_chi)
    const [ptcResult] = await conn.query(
      `INSERT INTO phieu_thu_chi (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
        loai_chung_tu_lien_ket, id_chung_tu, ma_chung_tu, loai_doi_tuong, id_doi_tuong,
        ten_doi_tuong, id_quy_tien, hinh_thuc_thanh_toan, so_tien, ngay_chung_tu,
        nguoi_nop_nhan, ly_do_thu_chi, kem_theo_chung_tu_goc, trang_thai, nguoi_tao
      ) VALUES (?, ?, ?, ?, 'Phieu_Chi', 'chi_mua_hang', 'phieu_mua_hang', ?, ?, 'nha_cung_cap', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'đã thanh toán', ?)`,
      [
        seq.ma_phieu,
        seq.so_vao_so,
        currentYear,
        lvkdId,
        order.id,
        order.ma_phieu_mua,
        order.id_nha_cung_cap || null,
        tenNcc,
        id_quy_tien,
        hinh_thuc_thanh_toan,
        amount,
        ngay_chung_tu || new Date(),
        nguoi_nhan_tien || tenNcc,
        reason,
        kem_theo_chung_tu_goc || null,
        req.user?.ten_dang_nhap || 'system'
      ]
    );

    await conn.commit();
    res.json({
      message: 'Thanh toán phiếu mua hàng thành công và đã tạo Phiếu Chi!',
      ma_phieu_chi: seq.ma_phieu,
      so_vao_so: seq.so_vao_so,
      da_thanh_toan: newPaid,
      con_lai: remainingAfter,
      trang_thai_thanh_toan: payStatus
    });
  } catch (err) {
    await conn.rollback();
    console.error('Error processing PO payment:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi thanh toán phiếu mua hàng.' });
  } finally {
    conn.release();
  }
});

module.exports = router;
