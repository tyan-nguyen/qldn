const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');
const { getCustomerDebtInfo } = require('./khach_hang');
const { updateStock } = require('./kho');
const { VNDToWords } = require('../utils/numberToWords');
const { generateSequenceNumber } = require('../services/sequenceService');

// 0. Get list of distinct recording years (năm vào sổ)
router.get('/years', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT COALESCE(nam_vao_so, YEAR(ngay_dat_hang)) as year 
       FROM don_hang 
       WHERE nam_vao_so IS NOT NULL OR ngay_dat_hang IS NOT NULL
       ORDER BY year DESC`
    );
    const currentYear = new Date().getFullYear();
    const dbYears = rows.map(r => parseInt(r.year, 10)).filter(y => !isNaN(y) && y > 1900);
    const uniqueYears = Array.from(new Set([currentYear, currentYear - 1, ...dbYears])).sort((a, b) => b - a);
    return res.json(uniqueYears);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách năm vào sổ.' });
  }
});

// 1. Get list of orders (filtered by nam_vao_so and id_lvkd if specified, optimized for millions of records)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { nam_vao_so, id_lvkd } = req.query;
    let sql = `SELECT d.*, k.ten_khach_hang, l.ten_lvkd, l.ma_lvkd, 
                      COALESCE(u.ho_ten_ngan, u.ho_ten, d.nguoi_tao) AS ho_ten_nguoi_tao,
                      COALESCE((
                        SELECT SUM(pnk.tong_tien) 
                        FROM phieu_nhap_kho pnk 
                        WHERE pnk.id_don_hang = d.id 
                          AND pnk.loai_nhap_kho = 'tra_hang_ban' 
                          AND COALESCE(pnk.da_xoa, 0) = 0
                      ), 0) AS tong_tien_da_tra,
                      COALESCE((
                        SELECT SUM(pnkct.so_luong_thuc_nhap)
                        FROM phieu_nhap_kho pnk
                        JOIN phieu_nhap_kho_chi_tiet pnkct ON pnkct.id_phieu_nhap_kho = pnk.id
                        WHERE pnk.id_don_hang = d.id
                          AND pnk.loai_nhap_kho = 'tra_hang_ban'
                          AND COALESCE(pnk.da_xoa, 0) = 0
                      ), 0) AS tong_sl_da_tra,
                      COALESCE((
                        SELECT SUM(ct.so_luong)
                        FROM chi_tiet_don_hang ct
                        WHERE ct.id_don_hang = d.id
                      ), 0) AS tong_sl_ban
               FROM don_hang d
               LEFT JOIN khach_hang k ON d.id_khach_hang = k.id
               LEFT JOIN linh_vuc_kinh_doanh l ON d.id_lvkd = l.id
               LEFT JOIN nguoi_dung u ON (d.nguoi_tao = u.ten_dang_nhap OR CAST(d.nguoi_tao AS CHAR) = CAST(u.id AS CHAR) OR d.nguoi_tao = u.ho_ten)
               WHERE 1=1`;
    const params = [];

    if (nam_vao_so && nam_vao_so !== 'all' && nam_vao_so !== 'ALL') {
      const yearNum = parseInt(nam_vao_so, 10);
      if (!isNaN(yearNum)) {
        sql += ` AND (d.nam_vao_so = ? OR (d.nam_vao_so IS NULL AND YEAR(d.ngay_dat_hang) = ?))`;
        params.push(yearNum, yearNum);
      }
    }

    if (id_lvkd && id_lvkd !== 'all') {
      const lvkdNum = parseInt(id_lvkd, 10);
      if (!isNaN(lvkdNum)) {
        sql += ` AND d.id_lvkd = ?`;
        params.push(lvkdNum);
      }
    }

    sql += ` ORDER BY d.id DESC`;

    const [rows] = await pool.query(sql, params);
    const enrichedRows = rows.map(r => {
      const soldQty = parseFloat(r.tong_sl_ban) || 0;
      const retQty = parseFloat(r.tong_sl_da_tra) || 0;
      let trang_thai_tra_hang = 'chua_tra';
      if (soldQty > 0 && retQty >= soldQty) {
        trang_thai_tra_hang = 'tra_toan_bo';
      } else if (retQty > 0) {
        trang_thai_tra_hang = 'tra_mot_phan';
      }
      return {
        ...r,
        trang_thai_tra_hang
      };
    });

    return res.json(enrichedRows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn đơn hàng.' });
  }
});

// 2. Get detailed order print data (A5 Invoice layout support)
router.get('/:id/print', authMiddleware, async (req, res) => {
  try {
    const [orderRow] = await pool.query(
      `SELECT d.*, k.ten_khach_hang, k.so_dien_thoai as khach_sdt, k.dia_chi as khach_dia_chi,
              k.loai_khach_hang, k.ten_cong_ty, k.ma_so_thue, k.ten_ngan_hang, k.so_tai_khoan,
              l.ten_lvkd, l.ma_lvkd,
              COALESCE(u.ho_ten, u.ho_ten_ngan, d.nguoi_tao) AS ho_ten_nguoi_tao
       FROM don_hang d
       LEFT JOIN khach_hang k ON d.id_khach_hang = k.id
       LEFT JOIN linh_vuc_kinh_doanh l ON d.id_lvkd = l.id
       LEFT JOIN nguoi_dung u ON (d.nguoi_tao = u.ten_dang_nhap OR CAST(d.nguoi_tao AS CHAR) = CAST(u.id AS CHAR) OR d.nguoi_tao = u.ho_ten)
       WHERE d.id = ?`,
      [req.params.id]
    );

    if (orderRow.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const [items] = await pool.query(
      `SELECT c.*, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh 
       FROM chi_tiet_don_hang c
       JOIN danh_muc_vat_tu v ON c.id_danh_muc_vat_tu = v.id
       WHERE c.id_don_hang = ?`,
      [req.params.id]
    );

    const order = orderRow[0];
    const totalWords = VNDToWords(order.tong_tien);

    return res.json({
      order,
      items,
      tong_tien_bang_chu: totalWords
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi lấy thông tin in hóa đơn.' });
  }
});

// 3. POS Order Checkout / Edit Draft
router.post('/checkout', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Ke_Toan', 'Vat_Tu']), async (req, res) => {
  const {
    id_don_hang, // Optional, if updating/committing a draft
    id_lvkd,
    id_khach_hang,
    ngay_dat_hang,
    ngay_san_xuat,
    ngay_giao_hang,
    chi_phi_van_chuyen,
    id_kho_hang, // Default Central Warehouse ID
    items, // array of { id_danh_muc_vat_tu, so_luong, don_gia, chiet_khau }
    trang_thai_don_hang, // 'Nháp' or 'Ghi sổ'
    id_quy_tien, // Payment fund account
    amount_paid // Optional payment amount at checkout
  } = req.body;

  if (!id_khach_hang) {
    return res.status(400).json({ message: 'Vui lòng chọn khách hàng.' });
  }

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'Danh sách sản phẩm là bắt buộc.' });
  }

  const selectedKho = id_kho_hang || 1; // Default to central shop warehouse
  const transportFee = parseFloat(chi_phi_van_chuyen) || 0;
  const isDraft = (trang_thai_don_hang === 'Nháp');

  // Calculate order total price
  let itemsTotal = 0;
  for (const item of items) {
    const qty = parseFloat(item.so_luong) || 0;
    const price = parseFloat(item.don_gia) || 0;
    const discount = parseFloat(item.chiet_khau) || 0;
    itemsTotal += qty * price - discount;
  }
  const orderPrice = itemsTotal + transportFee;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let orderId = id_don_hang;
    let oldOrder = null;
    let ma_don_hang = '';
    let so_vao_so = null;
    let nam_vao_so = null;

    const orderDate = (ngay_dat_hang && String(ngay_dat_hang).trim()) ? new Date(ngay_dat_hang) : new Date();
    const prodDate = (ngay_san_xuat && String(ngay_san_xuat).trim()) ? new Date(ngay_san_xuat) : null;
    const delivDate = (ngay_giao_hang && String(ngay_giao_hang).trim()) ? new Date(ngay_giao_hang) : null;
    const currentYear = orderDate.getFullYear();
    const yearShort = String(currentYear).slice(-2);

    if (orderId) {
      // Edit existing order (must be Draft)
      const [existing] = await connection.query('SELECT * FROM don_hang WHERE id = ?', [orderId]);
      if (existing.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ message: 'Không tìm thấy đơn hàng cần cập nhật.' });
      }
      if (existing[0].trang_thai_don_hang !== 'Nháp') {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ message: 'Không thể chỉnh sửa đơn hàng đã ghi sổ.' });
      }
      oldOrder = existing[0];
      ma_don_hang = existing[0].ma_don_hang;
      so_vao_so = existing[0].so_vao_so;
      nam_vao_so = existing[0].nam_vao_so;
    }

    if (isDraft) {
      // TRẠNG THÁI NHÁP: Không tạo số vào sổ và không tạo mã đơn hàng
      so_vao_so = null;
      nam_vao_so = null;
      ma_don_hang = null;
    } else {
      // TRẠNG THÁI GHI SỔ: Chỉ khi ghi sổ mới tạo số vào sổ và mã đơn hàng (nếu chưa có)
      if (!ma_don_hang || !so_vao_so) {
        const seq = await generateSequenceNumber(connection, {
          id_linh_vuc_kinh_doanh: id_lvkd || 1,
          loai_chung_tu: 'DH',
          nam: currentYear
        });

        so_vao_so = seq.so_vao_so;
        nam_vao_so = currentYear;
        ma_don_hang = seq.ma_phieu;
      }
    }

    let id_duyet_vuot_han_muc = null;

    if (!isDraft) {
      // 1. Credit Limit and Overdue checking (Only when committing/Ghi sổ)
      if (id_khach_hang) {
        const debtInfo = await getCustomerDebtInfo(id_khach_hang);
        const [custLimit] = await connection.query(
          'SELECT han_muc_tin_dung, ten_khach_hang FROM khach_hang WHERE id = ?',
          [id_khach_hang]
        );
        const creditLimit = parseFloat(custLimit[0]?.han_muc_tin_dung) || 0;

        const isOverLimit = debtInfo.currentDebt + orderPrice > creditLimit;
        const isOverdue = debtInfo.isOverdue;

        if (isOverLimit || isOverdue) {
          // Look for an approved override request
          const [override] = await connection.query(
            `SELECT id FROM duyet_vuot_han_muc 
             WHERE id_khach_hang = ? AND trang_thai_duyet = 'Da_Duyet' 
               AND so_tien_yeu_cau >= ? 
               AND id NOT IN (SELECT COALESCE(id_duyet_vuot_han_muc, 0) FROM don_hang WHERE id <> ?)
             ORDER BY id DESC LIMIT 1`,
            [id_khach_hang, orderPrice, orderId || 0]
          );

          if (override.length > 0) {
            id_duyet_vuot_han_muc = override[0].id;
          } else {
            await connection.rollback();
            connection.release();
            return res.status(403).json({
              credit_blocked: true,
              message: `Không thể xuất hàng! Khách hàng ${custLimit[0]?.ten_khach_hang || ''} đã vượt hạn mức nợ hoặc có nợ quá hạn. Yêu cầu phê duyệt từ Giám đốc.`,
              currentDebt: debtInfo.currentDebt,
              limit: creditLimit,
              isOverLimit,
              isOverdue
            });
          }
        }
      }

      // 2. Comprehensive Inventory Stock Pre-check (Strict Check for All Items Before Committing)
      const [khoRows] = await connection.query('SELECT id, ten_kho FROM kho_hang WHERE id = ?', [selectedKho]);
      const tenKho = khoRows[0]?.ten_kho || `Kho #${selectedKho}`;

      // Aggregate requested quantities per material
      const matQtyMap = {};
      for (const item of items) {
        const matId = item.id_danh_muc_vat_tu;
        const qty = parseFloat(item.so_luong) || 0;
        if (matId && qty > 0) {
          matQtyMap[matId] = (matQtyMap[matId] || 0) + qty;
        }
      }

      const insufficientItems = [];
      for (const [matId, reqQty] of Object.entries(matQtyMap)) {
        const [matRows] = await connection.query(
          'SELECT id, ma_vat_tu, ten_vat_tu, don_vi_tinh FROM danh_muc_vat_tu WHERE id = ?',
          [matId]
        );
        const [stockRows] = await connection.query(
          'SELECT so_luong_ton FROM ton_kho WHERE id_kho_hang = ? AND id_danh_muc_vat_tu = ? FOR UPDATE',
          [selectedKho, matId]
        );
        const currentStock = stockRows.length > 0 ? parseFloat(stockRows[0].so_luong_ton) || 0 : 0;

        if (currentStock < reqQty) {
          insufficientItems.push({
            id: matId,
            ma_vat_tu: matRows[0]?.ma_vat_tu || `#${matId}`,
            ten_vat_tu: matRows[0]?.ten_vat_tu || 'Vật tư',
            don_vi_tinh: matRows[0]?.don_vi_tinh || 'đv',
            currentStock,
            reqQty,
            missing: Math.round((reqQty - currentStock) * 1000) / 1000
          });
        }
      }

      if (insufficientItems.length > 0) {
        await connection.rollback();
        connection.release();
        const errorLines = insufficientItems.map(i =>
          `• ${i.ma_vat_tu} - ${i.ten_vat_tu}: Tồn kho hiện có ${i.currentStock.toLocaleString('vi-VN')} ${i.don_vi_tinh}, Yêu cầu xuất ${i.reqQty.toLocaleString('vi-VN')} ${i.don_vi_tinh} (Thiếu: ${i.missing.toLocaleString('vi-VN')} ${i.don_vi_tinh})`
        ).join('\n');

        return res.status(400).json({
          stock_error: true,
          insufficient_items: insufficientItems,
          message: `Không thể ghi sổ đơn hàng! Kho hàng "${tenKho}" không đủ số lượng tồn kho cho các mặt hàng sau:\n${errorLines}\n\nHệ thống đã hủy bỏ thao tác và không ghi sổ. Vui lòng kiểm tra lại số lượng hoặc chọn kho hàng khác!`
        });
      }
    }

    // Determine payment details
    const cleanAmountPaid = parseFloat(amount_paid) || 0;
    const finalAmountPaid = isDraft ? 0 : cleanAmountPaid; // No payment on Draft
    const remainingBalance = isDraft ? orderPrice : (orderPrice - finalAmountPaid);
    const paymentStatus = isDraft ? 'chưa thanh toán' : (finalAmountPaid >= orderPrice ? 'đã thanh toán' : (finalAmountPaid > 0 ? 'thanh toán một phần' : 'chưa thanh toán'));

    if (orderId) {
      // Update Header
      await connection.query(
        `UPDATE don_hang 
         SET id_lvkd = ?, so_vao_so = ?, nam_vao_so = ?, ma_don_hang = ?, id_khach_hang = ?, id_duyet_vuot_han_muc = ?,
             trang_thai_don_hang = ?, trang_thai_thanh_toan = ?, trang_thai_xuat_kho = ?, trang_thai_giao_hang = ?,
             ngay_dat_hang = ?, ngay_san_xuat = ?, ngay_giao_hang = ?, chi_phi_van_chuyen = ?, tong_tien = ?, 
             so_tien_da_thanh_toan = ?, so_tien_con_lai = ?
         WHERE id = ?`,
        [
          id_lvkd || null,
          so_vao_so,
          nam_vao_so,
          ma_don_hang,
          id_khach_hang,
          id_duyet_vuot_han_muc,
          trang_thai_don_hang || (isDraft ? 'Nháp' : 'Ghi sổ'),
          paymentStatus,
          isDraft ? 'chua_xua_kho' : 'da_xuat_kho_du',
          isDraft ? 'chua_giao_hang' : 'da_giao_hang',
          orderDate,
          prodDate,
          delivDate,
          transportFee,
          orderPrice,
          finalAmountPaid,
          remainingBalance,
          orderId
        ]
      );

      // Clean old details
      await connection.query('DELETE FROM chi_tiet_don_hang WHERE id_don_hang = ?', [orderId]);
    } else {
      // Insert Header
      const [insertResult] = await connection.query(
        `INSERT INTO don_hang (id_lvkd, so_vao_so, nam_vao_so, ma_don_hang, id_khach_hang, id_duyet_vuot_han_muc,
                                trang_thai_don_hang, trang_thai_thanh_toan, trang_thai_xuat_kho, trang_thai_giao_hang,
                                ngay_dat_hang, ngay_san_xuat, ngay_giao_hang, chi_phi_van_chuyen, tong_tien, so_tien_da_thanh_toan, so_tien_con_lai, nguoi_tao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id_lvkd || null,
          so_vao_so,
          nam_vao_so,
          ma_don_hang,
          id_khach_hang,
          id_duyet_vuot_han_muc,
          trang_thai_don_hang || 'Nháp',
          paymentStatus,
          isDraft ? 'chua_xua_kho' : 'da_xuat_kho_du',
          isDraft ? 'chua_giao_hang' : 'da_giao_hang',
          orderDate,
          prodDate,
          delivDate,
          transportFee,
          orderPrice,
          finalAmountPaid,
          remainingBalance,
          req.user.ten_dang_nhap
        ]
      );
      orderId = insertResult.insertId;
    }

    let pxkId = null;
    let seqPXK = null;

    if (!isDraft) {
      // 1. Generate standard sequence for Phieu Xuat Kho
      let maLvkd = 'BT';
      if (id_lvkd) {
        const [lvkdRows] = await connection.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [id_lvkd]);
        if (lvkdRows.length > 0 && lvkdRows[0].ma_lvkd) {
          maLvkd = lvkdRows[0].ma_lvkd.trim().toUpperCase();
        }
      }

      seqPXK = await generateSequenceNumber(connection, {
        id_linh_vuc_kinh_doanh: id_lvkd || 1,
        loai_chung_tu: 'XK',
        nam: currentYear,
        ma_lvkd: maLvkd
      });

      // 2. Check if an export voucher for this order already exists (clean if re-committing)
      const [existingPxk] = await connection.query('SELECT id FROM phieu_xuat_kho WHERE id_don_hang = ?', [orderId]);
      if (existingPxk.length > 0) {
        pxkId = existingPxk[0].id;
        await connection.query(
          `UPDATE phieu_xuat_kho 
           SET id_linh_vuc_kinh_doanh = ?, id_kho_hang = ?, id_cong_trinh = NULL, id_yeu_cau_vat_tu = NULL, id_kho_tam_nhan = NULL,
               loai_xuat_kho = 'ban_hang', thoi_gian_xuat = ?, nguoi_xuat = ?, tong_tien = ?, trang_thai_xuat = 'Đã xuất',
               ghi_chu = ?
           WHERE id = ?`,
          [
            id_lvkd || null, selectedKho, orderDate,
            req.user?.ho_ten || req.user?.ten_dang_nhap || 'Thủ kho',
            orderPrice, `Xuất kho đơn hàng bán lẻ ${ma_don_hang}`, pxkId
          ]
        );
        await connection.query('DELETE FROM phieu_xuat_kho_chi_tiet WHERE id_phieu_xuat_kho = ?', [pxkId]);
      } else {
        const [pxkResult] = await connection.query(
          `INSERT INTO phieu_xuat_kho (
            ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, id_don_hang,
            id_cong_trinh, id_yeu_cau_vat_tu, id_kho_hang, id_kho_tam_nhan,
            loai_xuat_kho, thoi_gian_xuat, nguoi_xuat, tong_tien, trang_thai_xuat, ghi_chu, nguoi_tao
          ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, 'ban_hang', ?, ?, ?, 'Đã xuất', ?, ?)`,
          [
            seqPXK.ma_phieu, seqPXK.so_vao_so, currentYear, id_lvkd || null, orderId,
            selectedKho, orderDate, req.user?.ho_ten || req.user?.ten_dang_nhap || 'Thủ kho',
            orderPrice, `Xuất kho đơn hàng bán lẻ ${ma_don_hang}`, req.user.ten_dang_nhap
          ]
        );
        pxkId = pxkResult.insertId;
      }
    }

    // Insert Order details, deduct stock, and log inventory history
    for (const item of items) {
      const qty = parseFloat(item.so_luong) || 0;
      const price = parseFloat(item.don_gia) || 0;
      const discount = parseFloat(item.chiet_khau) || 0;
      const amount = qty * price - discount;

      // Insert details
      await connection.query(
        `INSERT INTO chi_tiet_don_hang (id_don_hang, id_danh_muc_vat_tu, so_luong, don_gia, chiet_khau, thanh_tien, nguoi_tao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.id_danh_muc_vat_tu, qty, price, discount, amount, req.user.ten_dang_nhap]
      );

      if (!isDraft) {
        // Deduct stock balance
        const tonKhoId = await updateStock(connection, selectedKho, item.id_danh_muc_vat_tu, -qty);

        // Insert inventory stock history (ton_kho_lich_su)
        await connection.query(
          `INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao)
           VALUES (?, ?, ?, ?, ?, 'Phiếu xuất kho', ?, ?)`,
          [
            tonKhoId,
            selectedKho,
            item.id_danh_muc_vat_tu,
            -qty,
            pxkId,
            `Xuất kho bán hàng theo đơn ${ma_don_hang} (${seqPXK?.ma_phieu || ''})`,
            req.user.ten_dang_nhap
          ]
        );

        // Insert inventory transaction log (nhat_ky_kho)
        await connection.query(
          `INSERT INTO nhat_ky_kho (id_kho_hang_nguon, id_danh_muc_vat_tu, so_luong, don_gia, loai_giao_dich, trang_thai, ngay_thuc_hien, so_chung_tu, nguoi_tao)
           VALUES (?, ?, ?, ?, 'POS_Ban_Le', 'Da_Nghiem_Thu', NOW(), ?, ?)`,
          [
            selectedKho,
            item.id_danh_muc_vat_tu,
            qty,
            price,
            ma_don_hang,
            req.user.ten_dang_nhap
          ]
        );

        // Insert export voucher detail
        let dvt = item.don_vi_tinh || '';
        if (!dvt) {
          const [vtRows] = await connection.query('SELECT don_vi_tinh FROM danh_muc_vat_tu WHERE id = ?', [item.id_danh_muc_vat_tu]);
          dvt = vtRows[0]?.don_vi_tinh || '';
        }

        await connection.query(
          `INSERT INTO phieu_xuat_kho_chi_tiet (
            id_phieu_xuat_kho, id_chi_tiet_yeu_cau_vat_tu, id_danh_muc_vat_tu,
            don_vi_tinh, so_luong, so_luong_xuat, don_gia, chiet_khau, thanh_tien, ghi_chu
          ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'Xuất kho bán hàng')`,
          [pxkId, item.id_danh_muc_vat_tu, dvt, qty, qty, price, discount, amount]
        );
      }
    }

      // Create cleared receipt voucher (PT) if finalAmountPaid > 0
      if (finalAmountPaid > 0) {
        const currentYear = new Date().getFullYear();
        const effectiveLvkdId = (id_lvkd && id_lvkd !== 'all') ? parseInt(id_lvkd, 10) : 1;

        let effectiveMaLvkd = 'VLXD';
        const [lvkdRows] = await connection.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [effectiveLvkdId]);
        if (lvkdRows.length > 0 && lvkdRows[0].ma_lvkd) {
          effectiveMaLvkd = lvkdRows[0].ma_lvkd.trim().toUpperCase();
        }

        const seqPT = await generateSequenceNumber(connection, {
          id_linh_vuc_kinh_doanh: effectiveLvkdId,
          loai_chung_tu: 'PT',
          nam: currentYear,
          ma_lvkd: effectiveMaLvkd
        });

        const [khRows] = await connection.query('SELECT ten_khach_hang, dia_chi, so_dien_thoai FROM khach_hang WHERE id = ?', [id_khach_hang]);
        const tenKh = khRows[0]?.ten_khach_hang || 'Khách lẻ';
        const diaChiKh = khRows[0]?.dia_chi || null;
        const sdtKh = khRows[0]?.so_dien_thoai || null;

        await connection.query(
          `INSERT INTO phieu_thu_chi (
            ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
            loai_chung_tu_lien_ket, id_chung_tu, ma_chung_tu, loai_doi_tuong, id_doi_tuong,
            ten_doi_tuong, dia_chi_doi_tuong, sdt_doi_tuong, id_quy_tien, hinh_thuc_thanh_toan,
            so_tien, ngay_chung_tu, nguoi_nop_nhan, ly_do_thu_chi, trang_thai, nguoi_tao
          ) VALUES (?, ?, ?, ?, 'Phieu_Thu', 'thu_ban_hang', 'don_hang', ?, ?, 'khach_hang', ?, ?, ?, ?, ?, 'Tien_Mat', ?, NOW(), ?, ?, 'đã thanh toán', ?)`,
          [
            seqPT.ma_phieu,
            seqPT.so_vao_so,
            currentYear,
            effectiveLvkdId,
            orderId,
            ma_don_hang,
            id_khach_hang || null,
            tenKh,
            diaChiKh,
            sdtKh,
            id_quy_tien || 1,
            finalAmountPaid,
            tenKh,
            `Thu tiền bán hàng POS theo đơn ${ma_don_hang}`,
            req.user.ten_dang_nhap
          ]
        );
      }

    const [newRow] = await connection.query('SELECT * FROM don_hang WHERE id = ?', [orderId]);
    await logChange(connection, 'don_hang', orderId, oldOrder ? 'CAP_NHAT' : 'THEM_MOI', oldOrder, newRow[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json({
      message: isDraft ? 'Lưu nháp đơn hàng thành công.' : 'Ghi sổ và thanh toán đơn hàng thành công.',
      id: orderId,
      ma_don_hang
    });
  } catch (err) {
    await connection.rollback();
    console.error('POS Checkout Error:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi thực hiện lưu đơn hàng.' });
  } finally {
    connection.release();
  }
});

// 4. Delete draft order
router.delete('/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [ord] = await connection.query('SELECT * FROM don_hang WHERE id = ?', [req.params.id]);
    if (ord.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }
    if (ord[0].trang_thai_don_hang !== 'Nháp') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Không thể xóa đơn hàng đã ghi sổ.' });
    }

    // Delete details
    await connection.query('DELETE FROM chi_tiet_don_hang WHERE id_don_hang = ?', [req.params.id]);
    // Delete order
    await connection.query('DELETE FROM don_hang WHERE id = ?', [req.params.id]);

    await logChange(connection, 'don_hang', req.params.id, 'XOA', ord[0], null, req.user.ten_dang_nhap);
    await connection.commit();
    return res.json({ message: 'Xóa đơn hàng nháp thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xóa đơn hàng.' });
  } finally {
    connection.release();
  }
});

// 4b. Hủy đơn hàng và rollback toàn bộ dữ liệu (Tồn kho, Phiếu xuất kho, Thu chi, Sổ quỹ, Công nợ)
router.post('/:id/cancel', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Ke_Toan']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const orderId = req.params.id;
    const { ly_do_huy } = req.body;

    if (!ly_do_huy || !ly_do_huy.trim()) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Vui lòng nhập lý do hủy đơn hàng.' });
    }

    // 1. Lấy thông tin đơn hàng và khóa dòng
    const [orders] = await connection.query('SELECT * FROM don_hang WHERE id = ? FOR UPDATE', [orderId]);
    if (orders.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng cần hủy.' });
    }

    const order = orders[0];
    if (order.trang_thai_don_hang === 'Đã hủy') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Đơn hàng này đã ở trạng thái Đã hủy trước đó.' });
    }

    // 2. Kiểm tra xem đơn hàng đã có phiếu trả hàng bán (phieu_nhap_kho loại tra_hang_ban) chưa
    const [returnSlips] = await connection.query(
      `SELECT ma_phieu FROM phieu_nhap_kho 
       WHERE id_don_hang = ? AND loai_nhap_kho = 'tra_hang_ban' AND COALESCE(da_xoa, 0) = 0`,
      [orderId]
    );
    if (returnSlips.length > 0) {
      const slipCodes = returnSlips.map(s => s.ma_phieu).join(', ');
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        message: `Không thể hủy đơn hàng do đã phát sinh phiếu trả hàng bán (${slipCodes}). Vui lòng xử lý hoặc xóa các phiếu trả hàng trước khi hủy đơn hàng!`
      });
    }

    const reasonClean = ly_do_huy.trim();
    const cancelledBy = req.user?.ho_ten || req.user?.ten_dang_nhap || 'system';

    // 3. Rollback Tồn Kho Vật Tư & Phiếu Xuất Kho (nếu đơn hàng không phải là Nháp)
    if (order.trang_thai_don_hang !== 'Nháp') {
      // Tìm các phiếu xuất kho liên kết chưa xóa
      const [pxkList] = await connection.query(
        'SELECT * FROM phieu_xuat_kho WHERE id_don_hang = ? AND COALESCE(da_xoa, 0) = 0',
        [orderId]
      );

      for (const pxk of pxkList) {
        const khoId = pxk.id_kho_hang;
        // Lấy danh sách chi tiết vật tư đã xuất
        const [pxkDetails] = await connection.query(
          'SELECT * FROM phieu_xuat_kho_chi_tiet WHERE id_phieu_xuat_kho = ? AND COALESCE(da_xoa, 0) = 0',
          [pxk.id]
        );

        for (const item of pxkDetails) {
          const qty = parseFloat(item.so_luong_xuat) || parseFloat(item.so_luong) || 0;
          if (qty > 0 && item.id_danh_muc_vat_tu && khoId) {
            // Cộng hoàn trả lại tồn kho
            const tonKhoId = await updateStock(connection, khoId, item.id_danh_muc_vat_tu, qty);

            // Ghi nhận lịch sử tồn kho
            await connection.query(
              `INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, ghi_chu, nguoi_tao)
               VALUES (?, ?, ?, ?, ?, 'Huy_Don_Hang_Hoan_Kho', ?, ?)`,
              [tonKhoId, khoId, item.id_danh_muc_vat_tu, qty, orderId, `Hoàn kho do hủy đơn hàng ${order.ma_don_hang || orderId} - Lý do: ${reasonClean}`, req.user.ten_dang_nhap]
            );

            // Ghi nhận nhật ký kho
            await connection.query(
              `INSERT INTO nhat_ky_kho (id_kho_hang_dich, id_danh_muc_vat_tu, so_luong, don_gia, loai_giao_dich, trang_thai, ngay_thuc_hien, so_chung_tu, ghi_chu, nguoi_tao)
               VALUES (?, ?, ?, ?, 'Huy_Don_Hang_Hoan_Kho', 'Da_Nghiem_Thu', NOW(), ?, ?, ?)`,
              [khoId, item.id_danh_muc_vat_tu, qty, item.don_gia || 0, order.ma_don_hang || orderId, `Hoàn kho do hủy đơn ${order.ma_don_hang || orderId} (${reasonClean})`, req.user.ten_dang_nhap]
            );
          }
        }

        // Đánh dấu phiếu xuất kho là đã hủy
        await connection.query(
          `UPDATE phieu_xuat_kho 
           SET da_xoa = 1, trang_thai_xuat = 'Đã hủy', 
               ghi_chu = CONCAT(COALESCE(ghi_chu, ''), ' [HỦY THEO ĐƠN: ', ?, ' - LÝ DO: ', ?, ']') 
           WHERE id = ?`,
          [order.ma_don_hang || orderId, reasonClean, pxk.id]
        );

        await connection.query(
          'UPDATE phieu_xuat_kho_chi_tiet SET da_xoa = 1 WHERE id_phieu_xuat_kho = ?',
          [pxk.id]
        );
      }

      // Nếu không có pxkList nhưng có chi_tiet_don_hang và id_kho_hang trên đơn hàng (phòng trường hợp xuất trực tiếp)
      if (pxkList.length === 0 && order.id_kho_hang) {
        const [orderItems] = await connection.query('SELECT * FROM chi_tiet_don_hang WHERE id_don_hang = ?', [orderId]);
        for (const it of orderItems) {
          const qty = parseFloat(it.so_luong) || 0;
          if (qty > 0 && it.id_danh_muc_vat_tu) {
            await updateStock(connection, order.id_kho_hang, it.id_danh_muc_vat_tu, qty);
          }
        }
      }

      // 4. Rollback Thu Chi & Sổ Quỹ Tiền (Phiếu Thu liên quan đến đơn hàng)
      const [receipts] = await connection.query(
        `SELECT id, ma_phieu, id_quy_tien, so_tien, trang_thai, hinh_thuc_thanh_toan
         FROM phieu_thu_chi
         WHERE loai_phieu = 'Phieu_Thu'
           AND (
             (loai_chung_tu_lien_ket = 'don_hang' AND id_chung_tu = ?)
             OR (ma_chung_tu = ? AND loai_thu_chi = 'thu_ban_hang')
           )
           AND COALESCE(da_xoa, 0) = 0`,
        [orderId, order.ma_don_hang || '']
      );

      for (const pt of receipts) {
        const recAmount = parseFloat(pt.so_tien) || 0;
        // Hoàn trừ lại số tiền khỏi quỹ nếu quỹ đã nhận tiền
        if (recAmount > 0 && pt.id_quy_tien && (pt.trang_thai === 'đã thanh toán' || pt.trang_thai === 'Da_Duyet' || pt.trang_thai === 'hoan_thanh')) {
          await connection.query(
            'UPDATE quy_tien SET so_du_hien_tai = so_du_hien_tai - ? WHERE id = ?',
            [recAmount, pt.id_quy_tien]
          );
        }

        // Đánh dấu hủy phiếu thu
        await connection.query(
          `UPDATE phieu_thu_chi 
           SET da_xoa = 1, trang_thai = 'Đã hủy', 
               ghi_chu = CONCAT(COALESCE(ghi_chu, ''), ' [HỦY THEO ĐƠN: ', ?, ' - LÝ DO: ', ?, ']')
           WHERE id = ?`,
          [order.ma_don_hang || orderId, reasonClean, pt.id]
        );

        await logChange(connection, 'phieu_thu_chi', pt.id, 'HUY_PHIEU_THU', pt, null, req.user.ten_dang_nhap);
      }
    }

    // 5. Cập nhật trạng thái đơn hàng sang 'Đã hủy'
    await connection.query(
      `UPDATE don_hang 
       SET trang_thai_don_hang = 'Đã hủy',
           trang_thai_thanh_toan = 'da_huy',
           trang_thai_xuat_kho = 'da_huy',
           trang_thai_giao_hang = 'da_huy',
           so_tien_da_thanh_toan = 0,
           so_tien_con_lai = 0,
           ngay_huy = NOW(),
           nguoi_huy = ?,
           ly_do_huy = ?,
           ghi_chu = CONCAT(COALESCE(ghi_chu, ''), ' [ĐÃ HỦY: ', ?, ']')
       WHERE id = ?`,
      [cancelledBy, reasonClean, reasonClean, orderId]
    );

    const [updatedOrder] = await connection.query('SELECT * FROM don_hang WHERE id = ?', [orderId]);
    await logChange(connection, 'don_hang', orderId, 'HUY_DON_HANG', order, updatedOrder[0], req.user.ten_dang_nhap);

    await connection.commit();
    return res.json({
      message: `Hủy đơn hàng ${order.ma_don_hang || `#${orderId}`} thành công. Toàn bộ tồn kho và quỹ tiền đã được hoàn tác!`,
      order: updatedOrder[0]
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error cancelling sales order:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi hủy đơn hàng.' });
  } finally {
    connection.release();
  }
});

// 5. Get receipts (phieu_thu_chi) associated with an order
router.get('/:id/receipts', authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const [rows] = await pool.query(
      `SELECT ptc.*, q.ten_quy, q.ma_quy, q.loai_quy, 
              l.ten_lvkd, l.ma_lvkd, l.ten_cong_ty, l.dia_chi AS dia_chi_cong_ty, l.dien_thoai AS sdt_cong_ty, l.ma_so_thue AS mst_cong_ty, l.logo_url AS logo_lvkd,
              dh.ma_don_hang, kh.ten_khach_hang, kh.dia_chi AS khach_dia_chi, kh.so_dien_thoai AS khach_sdt
       FROM phieu_thu_chi ptc
       LEFT JOIN quy_tien q ON ptc.id_quy_tien = q.id
       LEFT JOIN linh_vuc_kinh_doanh l ON ptc.id_linh_vuc_kinh_doanh = l.id
       LEFT JOIN don_hang dh ON ptc.id_chung_tu = dh.id
       LEFT JOIN khach_hang kh ON dh.id_khach_hang = kh.id
       WHERE ptc.loai_chung_tu_lien_ket = 'don_hang' 
         AND ptc.id_chung_tu = ? 
         AND ptc.loai_phieu = 'Phieu_Thu'
         AND COALESCE(ptc.da_xoa, 0) = 0
       ORDER BY ptc.id DESC`,
      [orderId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching order receipts:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách phiếu thu của đơn hàng.' });
  }
});

// 6. Get export vouchers (phieu_xuat_kho) associated with an order
router.get('/:id/export-vouchers', authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const [vouchers] = await pool.query(
      `SELECT px.*,
              k.ten_kho AS ten_kho_hang,
              l.ten_lvkd, l.ma_lvkd, l.ten_cong_ty, l.dia_chi AS dia_chi_cong_ty, l.dien_thoai AS sdt_cong_ty, l.ma_so_thue AS mst_cong_ty, l.logo_url AS logo_lvkd,
              dh.ma_don_hang, kh.ten_khach_hang, kh.dia_chi AS khach_dia_chi, kh.so_dien_thoai AS khach_sdt,
              (SELECT COUNT(*) FROM phieu_xuat_kho_chi_tiet WHERE id_phieu_xuat_kho = px.id AND COALESCE(da_xoa, 0) = 0) AS tong_so_mat_hang
       FROM phieu_xuat_kho px
       LEFT JOIN kho_hang k ON px.id_kho_hang = k.id
       LEFT JOIN linh_vuc_kinh_doanh l ON px.id_linh_vuc_kinh_doanh = l.id
       LEFT JOIN don_hang dh ON px.id_don_hang = dh.id
       LEFT JOIN khach_hang kh ON dh.id_khach_hang = kh.id
       WHERE px.id_don_hang = ?
       ORDER BY px.id DESC`,
      [orderId]
    );

    // Also fetch items for each voucher
    for (const voucher of vouchers) {
      const [items] = await pool.query(
        `SELECT pxct.*, dm.ma_vat_tu, dm.ten_vat_tu, dm.don_vi_tinh AS dm_dvt
         FROM phieu_xuat_kho_chi_tiet pxct
         LEFT JOIN danh_muc_vat_tu dm ON pxct.id_danh_muc_vat_tu = dm.id
         WHERE pxct.id_phieu_xuat_kho = ?
           AND COALESCE(pxct.da_xoa, 0) = 0
         ORDER BY pxct.id ASC`,
        [voucher.id]
      );
      voucher.items = items;
    }

    return res.json(vouchers);
  } catch (err) {
    console.error('Error fetching order export vouchers:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách phiếu xuất kho của đơn hàng.' });
  }
});

// 7. Get order details with return information for sales return form
router.get('/:id/detail-with-returns', authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const [orderRows] = await pool.query(
      `SELECT d.*, k.ten_khach_hang, k.so_dien_thoai as khach_sdt, k.dia_chi as khach_dia_chi,
              l.ten_lvkd, l.ma_lvkd
       FROM don_hang d
       LEFT JOIN khach_hang k ON d.id_khach_hang = k.id
       LEFT JOIN linh_vuc_kinh_doanh l ON d.id_lvkd = l.id
       WHERE d.id = ?`,
      [orderId]
    );
    if (orderRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const [items] = await pool.query(
      `SELECT ct.*, dm.ma_vat_tu, dm.ten_vat_tu, dm.don_vi_tinh,
              COALESCE((
                SELECT SUM(pnkct.so_luong_thuc_nhap)
                FROM phieu_nhap_kho_chi_tiet pnkct
                JOIN phieu_nhap_kho pnk ON pnkct.id_phieu_nhap_kho = pnk.id
                WHERE pnk.id_don_hang = ct.id_don_hang
                  AND pnk.loai_nhap_kho = 'tra_hang_ban'
                  AND pnkct.id_danh_muc_vat_tu = ct.id_danh_muc_vat_tu
                  AND COALESCE(pnk.da_xoa, 0) = 0
              ), 0) AS so_luong_da_tra
       FROM chi_tiet_don_hang ct
       LEFT JOIN danh_muc_vat_tu dm ON ct.id_danh_muc_vat_tu = dm.id
       WHERE ct.id_don_hang = ?
       ORDER BY ct.id ASC`,
      [orderId]
    );

    const mappedItems = items.map(it => {
      const sold = parseFloat(it.so_luong) || 0;
      const returned = parseFloat(it.so_luong_da_tra) || 0;
      const remaining = Math.max(0, sold - returned);
      return {
        ...it,
        so_luong_da_tra: returned,
        so_luong_con_lai: remaining
      };
    });

    return res.json({
      order: orderRows[0],
      items: mappedItems
    });
  } catch (err) {
    console.error('Error fetching order detail with returns:', err);
    return res.status(500).json({ message: 'Lỗi lấy thông tin chi tiết trả hàng của đơn hàng.' });
  }
});

// 8. Process sales return for an order (Full or Partial)
router.post('/:id/returns', authMiddleware, authorize(['Kinh_Doanh', 'Ban_Giam_Doc', 'Admin', 'Ke_Toan', 'Vat_Tu']), async (req, res) => {
  const orderId = req.params.id;
  const {
    id_kho_hang,
    ly_do_tra,
    hinh_thuc_hoan_tien, // 'tru_cong_no' or 'hoan_tien_mat'
    id_quy_tien,
    items // array of { id_danh_muc_vat_tu, so_luong_tra, don_gia, chiet_khau }
  } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Vui lòng chọn ít nhất 1 mặt hàng cần trả lại.' });
  }

  const validItems = items.filter(it => parseFloat(it.so_luong_tra) > 0);
  if (validItems.length === 0) {
    return res.status(400).json({ message: 'Số lượng trả lại phải lớn hơn 0.' });
  }

  const targetKhoId = id_kho_hang || 1;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Check order
    const [orderRows] = await connection.query(
      `SELECT d.*, k.ten_khach_hang, k.dia_chi as khach_dia_chi, k.so_dien_thoai as khach_sdt,
              l.ten_lvkd, l.ma_lvkd
       FROM don_hang d
       LEFT JOIN khach_hang k ON d.id_khach_hang = k.id
       LEFT JOIN linh_vuc_kinh_doanh l ON d.id_lvkd = l.id
       WHERE d.id = ? FOR UPDATE`,
      [orderId]
    );

    if (orderRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng.' });
    }

    const order = orderRows[0];
    if (order.trang_thai_don_hang !== 'Ghi sổ') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Chỉ có thể lập phiếu trả hàng cho đơn hàng đã Ghi sổ.' });
    }

    // Check sold & already returned quantities
    const [soldItems] = await connection.query(
      `SELECT ct.*, dm.ma_vat_tu, dm.ten_vat_tu, dm.don_vi_tinh,
              COALESCE((
                SELECT SUM(pnkct.so_luong_thuc_nhap)
                FROM phieu_nhap_kho_chi_tiet pnkct
                JOIN phieu_nhap_kho pnk ON pnkct.id_phieu_nhap_kho = pnk.id
                WHERE pnk.id_don_hang = ct.id_don_hang
                  AND pnk.loai_nhap_kho = 'tra_hang_ban'
                  AND pnkct.id_danh_muc_vat_tu = ct.id_danh_muc_vat_tu
                  AND COALESCE(pnk.da_xoa, 0) = 0
              ), 0) AS so_luong_da_tra
       FROM chi_tiet_don_hang ct
       LEFT JOIN danh_muc_vat_tu dm ON ct.id_danh_muc_vat_tu = dm.id
       WHERE ct.id_don_hang = ?`,
      [orderId]
    );

    const soldMap = {};
    for (const s of soldItems) {
      soldMap[s.id_danh_muc_vat_tu] = {
        soldQty: parseFloat(s.so_luong) || 0,
        alreadyReturned: parseFloat(s.so_luong_da_tra) || 0,
        ma_vat_tu: s.ma_vat_tu,
        ten_vat_tu: s.ten_vat_tu,
        don_vi_tinh: s.don_vi_tinh,
        don_gia: parseFloat(s.don_gia) || 0,
        chiet_khau: parseFloat(s.chiet_khau) || 0
      };
    }

    let returnTotal = 0;
    const itemsToInsert = [];

    for (const it of validItems) {
      const matId = it.id_danh_muc_vat_tu;
      const qtyRet = parseFloat(it.so_luong_tra) || 0;
      const soldInfo = soldMap[matId];

      if (!soldInfo) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ message: `Mặt hàng (ID: ${matId}) không thuộc đơn hàng này.` });
      }

      const maxCanReturn = Math.max(0, soldInfo.soldQty - soldInfo.alreadyReturned);
      if (qtyRet > maxCanReturn) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          message: `Số lượng trả của "${soldInfo.ten_vat_tu}" (${qtyRet} ${soldInfo.don_vi_tinh}) vượt quá số lượng còn lại có thể trả (${maxCanReturn} ${soldInfo.don_vi_tinh}).`
        });
      }

      const price = parseFloat(it.don_gia) !== undefined && !isNaN(parseFloat(it.don_gia)) ? parseFloat(it.don_gia) : soldInfo.don_gia;
      const discount = parseFloat(it.chiet_khau) || 0;
      const lineTotal = Math.max(0, qtyRet * price - discount);
      returnTotal += lineTotal;

      itemsToInsert.push({
        id_danh_muc_vat_tu: matId,
        don_vi_tinh: soldInfo.don_vi_tinh || '',
        so_luong_yeu_cau: qtyRet,
        so_luong_thuc_nhap: qtyRet,
        don_gia: price,
        chiet_khau: discount,
        thanh_tien: lineTotal,
        ghi_chu: `Khách trả lại theo đơn ${order.ma_don_hang || orderId}`
      });
    }

    // Generate sequence for NK (Phiếu nhập kho)
    const currentYear = new Date().getFullYear();
    let effectiveMaLvkd = order.ma_lvkd || 'BT';
    const effectiveLvkdId = order.id_lvkd || 1;

    const seqNK = await generateSequenceNumber(connection, {
      id_linh_vuc_kinh_doanh: effectiveLvkdId,
      loai_chung_tu: 'NK',
      nam: currentYear,
      ma_lvkd: effectiveMaLvkd
    });

    const [pnkResult] = await connection.query(
      `INSERT INTO phieu_nhap_kho (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_nhap_kho,
        id_don_hang, id_khach_hang, id_kho_hang, thoi_gian_nhap,
        nguoi_giao_hang, nguoi_nhap_kho, tong_tien, trang_thai_nhap,
        ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, 'tra_hang_ban', ?, ?, ?, NOW(), ?, ?, ?, 'Đã nhập', ?, ?)`,
      [
        seqNK.ma_phieu,
        seqNK.so_vao_so,
        currentYear,
        effectiveLvkdId,
        orderId,
        order.id_khach_hang || null,
        targetKhoId,
        order.ten_khach_hang || 'Khách hàng',
        req.user?.ho_ten || req.user?.ten_dang_nhap || 'Thủ kho',
        returnTotal,
        ly_do_tra || `Khách trả lại hàng theo đơn ${order.ma_don_hang || orderId}`,
        req.user.ten_dang_nhap
      ]
    );

    const pnkId = pnkResult.insertId;

    // Insert details and update stock
    for (const item of itemsToInsert) {
      await connection.query(
        `INSERT INTO phieu_nhap_kho_chi_tiet (
          id_phieu_nhap_kho, id_danh_muc_vat_tu, don_vi_tinh,
          so_luong_yeu_cau, so_luong_thuc_nhap, don_gia, chiet_khau,
          thanh_tien, ghi_chu
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pnkId,
          item.id_danh_muc_vat_tu,
          item.don_vi_tinh,
          item.so_luong_yeu_cau,
          item.so_luong_thuc_nhap,
          item.don_gia,
          item.chiet_khau,
          item.thanh_tien,
          item.ghi_chu
        ]
      );

      // Restore inventory balance
      const tonKhoId = await updateStock(connection, targetKhoId, item.id_danh_muc_vat_tu, item.so_luong_thuc_nhap);
      
      await connection.query(
        `INSERT INTO ton_kho_lich_su (id_ton_kho, id_kho_hang, id_danh_muc_vat_tu, so_luong_thay_doi, id_chung_tu, loai_chung_tu, nguoi_tao)
         VALUES (?, ?, ?, ?, ?, 'Phiếu nhập kho hàng bán trả lại', ?)`,
        [tonKhoId, targetKhoId, item.id_danh_muc_vat_tu, item.so_luong_thuc_nhap, pnkId, req.user.ten_dang_nhap]
      );

      await connection.query(
        `INSERT INTO nhat_ky_kho (id_kho_hang_dich, id_danh_muc_vat_tu, so_luong, don_gia, loai_giao_dich, trang_thai, ngay_thuc_hien, so_chung_tu, nguoi_tao)
         VALUES (?, ?, ?, ?, 'Nhap_Kho_Tra_Hang', 'Da_Nghiem_Thu', NOW(), ?, ?)`,
        [targetKhoId, item.id_danh_muc_vat_tu, item.so_luong_thuc_nhap, item.don_gia, seqNK.ma_phieu, req.user.ten_dang_nhap]
      );
    }

    // Financial handling
    let pcMaPhieu = null;
    if (hinh_thuc_hoan_tien === 'hoan_tien_mat' && returnTotal > 0) {
      const seqPC = await generateSequenceNumber(connection, {
        id_linh_vuc_kinh_doanh: effectiveLvkdId,
        loai_chung_tu: 'PC',
        nam: currentYear,
        ma_lvkd: effectiveMaLvkd
      });
      pcMaPhieu = seqPC.ma_phieu;

      await connection.query(
        `INSERT INTO phieu_thu_chi (
          ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
          loai_chung_tu_lien_ket, id_chung_tu, ma_chung_tu, loai_doi_tuong, id_doi_tuong,
          ten_doi_tuong, dia_chi_doi_tuong, sdt_doi_tuong, id_quy_tien, hinh_thuc_thanh_toan,
          so_tien, ngay_chung_tu, nguoi_nop_nhan, ly_do_thu_chi, trang_thai, nguoi_tao
        ) VALUES (?, ?, ?, ?, 'Phieu_Chi', 'chi_tra_lai_hang', 'phieu_nhap_kho', ?, ?, 'Khach_Hang', ?, ?, ?, ?, ?, 'Tien_Mat', ?, NOW(), ?, ?, 'Da_Duyet', ?)`,
        [
          seqPC.ma_phieu,
          seqPC.so_vao_so,
          currentYear,
          effectiveLvkdId,
          pnkId,
          seqNK.ma_phieu,
          order.id_khach_hang || null,
          order.ten_khach_hang || 'Khách hàng',
          order.khach_dia_chi || null,
          order.khach_sdt || null,
          id_quy_tien || 1,
          returnTotal,
          order.ten_khach_hang || 'Khách hàng',
          `Chi tiền hoàn trả hàng bán theo đơn ${order.ma_don_hang || orderId} (Phiếu nhập ${seqNK.ma_phieu})`,
          req.user.ten_dang_nhap
        ]
      );

      // Deduct fund balance
      await connection.query(
        'UPDATE quy_tien SET so_du_hien_tai = so_du_hien_tai - ? WHERE id = ?',
        [returnTotal, id_quy_tien || 1]
      );
    } else if (hinh_thuc_hoan_tien === 'tru_cong_no' && returnTotal > 0) {
      // Deduct debt on the specific order if it has remaining unpaid balance
      const curPaid = parseFloat(order.so_tien_da_thanh_toan) || 0;
      const curTotal = parseFloat(order.tong_tien) || 0;
      const curConLai = Math.max(0, curTotal - curPaid);
      if (curConLai > 0) {
        const deductOrder = Math.min(curConLai, returnTotal);
        const newConLai = Math.max(0, curConLai - deductOrder);
        const newPayStatus = newConLai <= 0 ? 'đã thanh toán' : 'thanh toán một phần';
        await connection.query(
          `UPDATE don_hang SET so_tien_con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?`,
          [newConLai, newPayStatus, orderId]
        );
      }

      // Record customer debt settlement entry
      if (order.id_khach_hang) {
        const [ttkhRes] = await connection.query(
          `INSERT INTO thanh_toan_khach_hang (
            id_khach_hang, so_tien_nhan, ngay_thanh_toan, hinh_thuc_thanh_toan, ghi_chu, nguoi_tao
          ) VALUES (?, ?, NOW(), 'Khau_Tru_Tra_Hang', ?, ?)`,
          [
            order.id_khach_hang,
            returnTotal,
            `${seqNK.ma_phieu} - Giảm trừ công nợ do trả hàng theo đơn ${order.ma_don_hang || orderId}`,
            req.user.ten_dang_nhap
          ]
        );
        await connection.query(
          `INSERT INTO chi_tiet_gach_no (id_thanh_toan_khach_hang, id_don_hang, so_tien_khau_tru, nguoi_tao)
           VALUES (?, ?, ?, ?)`,
          [ttkhRes.insertId, orderId, returnTotal, req.user.ten_dang_nhap]
        );
      }
    }

    await logChange(connection, 'phieu_nhap_kho', pnkId, 'THEM_MOI', null, { id: pnkId, ma_phieu: seqNK.ma_phieu, tong_tien: returnTotal }, req.user.ten_dang_nhap);

    await connection.commit();
    return res.status(201).json({
      message: 'Tạo phiếu trả hàng bán thành công!',
      id_phieu_nhap: pnkId,
      ma_phieu_nhap: seqNK.ma_phieu,
      ma_phieu_chi: pcMaPhieu,
      tong_tien_tra: returnTotal
    });
  } catch (err) {
    await connection.rollback();
    console.error('Sales return error:', err);
    return res.status(500).json({ message: err.message || 'Lỗi khi tạo phiếu trả hàng bán.' });
  } finally {
    connection.release();
  }
});

// 9. Get return vouchers for an order
router.get('/:id/returns', authMiddleware, async (req, res) => {
  try {
    const orderId = req.params.id;
    const [returns] = await pool.query(
      `SELECT pnk.*,
              k.ten_kho AS ten_kho_hang,
              l.ten_lvkd, l.ma_lvkd, l.ten_cong_ty, l.dia_chi AS dia_chi_cong_ty, l.dien_thoai AS sdt_cong_ty, l.ma_so_thue AS mst_cong_ty, l.logo_url AS logo_lvkd,
              dh.ma_don_hang, kh.ten_khach_hang, kh.dia_chi AS khach_dia_chi, kh.so_dien_thoai AS khach_sdt,
              (SELECT COUNT(*) FROM phieu_nhap_kho_chi_tiet WHERE id_phieu_nhap_kho = pnk.id) AS tong_so_mat_hang
       FROM phieu_nhap_kho pnk
       LEFT JOIN kho_hang k ON pnk.id_kho_hang = k.id
       LEFT JOIN linh_vuc_kinh_doanh l ON pnk.id_linh_vuc_kinh_doanh = l.id
       LEFT JOIN don_hang dh ON pnk.id_don_hang = dh.id
       LEFT JOIN khach_hang kh ON dh.id_khach_hang = kh.id
       WHERE pnk.id_don_hang = ?
         AND pnk.loai_nhap_kho = 'tra_hang_ban'
         AND COALESCE(pnk.da_xoa, 0) = 0
       ORDER BY pnk.id DESC`,
      [orderId]
    );

    for (const ret of returns) {
      const [items] = await pool.query(
        `SELECT pnkct.*, dm.ma_vat_tu, dm.ten_vat_tu, dm.don_vi_tinh AS dm_dvt
         FROM phieu_nhap_kho_chi_tiet pnkct
         LEFT JOIN danh_muc_vat_tu dm ON pnkct.id_danh_muc_vat_tu = dm.id
         WHERE pnkct.id_phieu_nhap_kho = ?
         ORDER BY pnkct.id ASC`,
        [ret.id]
      );
      ret.items = items;
    }

    return res.json(returns);
  } catch (err) {
    console.error('Error fetching order returns:', err);
    return res.status(500).json({ message: 'Lỗi tải danh sách phiếu trả hàng của đơn hàng.' });
  }
});

// 10. Get detailed print data for a sales return voucher
router.get('/returns/:returnId/print', authMiddleware, async (req, res) => {
  try {
    const returnId = req.params.returnId;
    const [returnRows] = await pool.query(
      `SELECT pnk.*,
              k.ten_kho AS ten_kho_hang,
              l.ten_lvkd, l.ma_lvkd, l.ten_cong_ty, l.dia_chi AS dia_chi_cong_ty, l.dien_thoai AS sdt_cong_ty, l.ma_so_thue AS mst_cong_ty, l.logo_url AS logo_lvkd,
              dh.ma_don_hang, dh.ngay_dat_hang,
              kh.ten_khach_hang, kh.dia_chi AS khach_dia_chi, kh.so_dien_thoai AS khach_sdt,
              COALESCE(u.ho_ten, pnk.nguoi_tao) AS ho_ten_nguoi_tao
       FROM phieu_nhap_kho pnk
       LEFT JOIN kho_hang k ON pnk.id_kho_hang = k.id
       LEFT JOIN linh_vuc_kinh_doanh l ON pnk.id_linh_vuc_kinh_doanh = l.id
       LEFT JOIN don_hang dh ON pnk.id_don_hang = dh.id
       LEFT JOIN khach_hang kh ON dh.id_khach_hang = kh.id
       LEFT JOIN nguoi_dung u ON (pnk.nguoi_tao = u.ten_dang_nhap OR CAST(pnk.nguoi_tao AS CHAR) = CAST(u.id AS CHAR) OR pnk.nguoi_tao = u.ho_ten)
       WHERE pnk.id = ?
         AND pnk.loai_nhap_kho = 'tra_hang_ban'
         AND COALESCE(pnk.da_xoa, 0) = 0`,
      [returnId]
    );

    if (returnRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy phiếu trả hàng.' });
    }

    const ret = returnRows[0];

    const [items] = await pool.query(
      `SELECT pnkct.*, dm.ma_vat_tu, dm.ten_vat_tu, dm.don_vi_tinh AS dm_dvt
       FROM phieu_nhap_kho_chi_tiet pnkct
       LEFT JOIN danh_muc_vat_tu dm ON pnkct.id_danh_muc_vat_tu = dm.id
       WHERE pnkct.id_phieu_nhap_kho = ?
       ORDER BY pnkct.id ASC`,
      [returnId]
    );

    const totalWords = VNDToWords(ret.tong_tien);

    return res.json({
      returnVoucher: ret,
      items,
      tong_tien_bang_chu: totalWords
    });
  } catch (err) {
    console.error('Error fetching return voucher print data:', err);
    return res.status(500).json({ message: 'Lỗi lấy thông tin in phiếu trả hàng.' });
  }
});

module.exports = router;
