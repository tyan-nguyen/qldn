const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');
const { generateSequenceNumber } = require('../services/sequenceService');

// 1. Get Suppliers List (Active)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM nha_cung_cap WHERE da_xoa = 0 ORDER BY id DESC');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách nhà cung cấp.' });
  }
});

// 2. Comprehensive Supplier Debts & Aging Report
router.get('/cong-no', authMiddleware, async (req, res) => {
  try {
    // 1. Get all active suppliers
    const [suppliers] = await pool.query(`
      SELECT id, ten_nha_cung_cap, so_dien_thoai, dia_chi, ma_so_thue,
             nguoi_dai_dien, so_tai_khoan, ten_ngan_hang, so_ngay_no_toi_da,
             han_muc_no, trang_thai,
             COALESCE(no_dau_ky, 0) AS no_dau_ky, ngay_chot_no_dau_ky, ghi_chu_no_dau_ky,
             ghi_chu
      FROM nha_cung_cap
      WHERE da_xoa = 0
      ORDER BY id DESC
    `);

    // 2. Aggregate Purchase Orders (phieu_mua_hang) - exclude cancelled orders
    const [poRows] = await pool.query(`
      SELECT id_nha_cung_cap,
             COALESCE(SUM(tong_tien), 0) AS tong_mua,
             COALESCE(SUM(da_thanh_toan), 0) AS da_thanh_toan_pos
      FROM phieu_mua_hang
      WHERE (trang_thai_giao_hang != 'Đã hủy' OR trang_thai_giao_hang IS NULL)
        AND id_nha_cung_cap IS NOT NULL
      GROUP BY id_nha_cung_cap
    `);
    const poMap = {};
    poRows.forEach(r => {
      poMap[r.id_nha_cung_cap] = {
        tong_mua: parseFloat(r.tong_mua) || 0,
        da_thanh_toan_pos: parseFloat(r.da_thanh_toan_pos) || 0
      };
    });

    // 3. Aggregate Non-PO / Service Debts (cong_no_khac_ncc)
    const [nonPoRows] = await pool.query(`
      SELECT id_nha_cung_cap,
             COALESCE(SUM(so_tien), 0) AS tong_no_khac,
             COALESCE(SUM(da_thanh_toan), 0) AS da_thanh_toan_no_khac
      FROM cong_no_khac_ncc
      WHERE da_xoa = 0
      GROUP BY id_nha_cung_cap
    `);
    const nonPoMap = {};
    nonPoRows.forEach(r => {
      nonPoMap[r.id_nha_cung_cap] = {
        tong_no_khac: parseFloat(r.tong_no_khac) || 0,
        da_thanh_toan_no_khac: parseFloat(r.da_thanh_toan_no_khac) || 0
      };
    });

    // 4. Aggregate all payments made to this supplier (phieu_thu_chi Phieu_Chi)
    const [paymentRows] = await pool.query(`
      SELECT id_doi_tuong AS id_nha_cung_cap,
             COALESCE(SUM(so_tien), 0) AS tong_chi
      FROM phieu_thu_chi
      WHERE loai_phieu = 'Phieu_Chi'
        AND (loai_doi_tuong = 'nha_cung_cap' OR loai_doi_tuong = 'Nha_Cung_Cap')
        AND (da_xoa = 0 OR da_xoa IS NULL)
      GROUP BY id_doi_tuong
    `);
    const paymentMap = {};
    paymentRows.forEach(r => {
      paymentMap[r.id_nha_cung_cap] = parseFloat(r.tong_chi) || 0;
    });

    // 5. Get unpaid Purchase Orders for Aging calculation
    const [unpaidPOs] = await pool.query(`
      SELECT id, id_nha_cung_cap, ma_phieu_mua AS ma_chung_tu, ngay_mua AS ngay_phat_sinh,
             tong_tien, COALESCE(da_thanh_toan, 0) AS da_tra,
             (tong_tien - COALESCE(da_thanh_toan, 0)) AS con_lai,
             'phieu_mua_hang' AS loai_chung_tu
      FROM phieu_mua_hang
      WHERE (tong_tien - COALESCE(da_thanh_toan, 0)) > 0
        AND (trang_thai_giao_hang != 'Đã hủy' OR trang_thai_giao_hang IS NULL)
        AND id_nha_cung_cap IS NOT NULL
      ORDER BY ngay_mua ASC
    `);

    // 6. Get unpaid Non-PO debts for Aging calculation
    const [unpaidNonPOs] = await pool.query(`
      SELECT id, id_nha_cung_cap, ma_chung_tu, ngay_phat_sinh,
             so_tien AS tong_tien, COALESCE(da_thanh_toan, 0) AS da_tra,
             (so_tien - COALESCE(da_thanh_toan, 0)) AS con_lai,
             'cong_no_khac' AS loai_chung_tu
      FROM cong_no_khac_ncc
      WHERE (so_tien - COALESCE(da_thanh_toan, 0)) > 0
        AND da_xoa = 0
      ORDER BY ngay_phat_sinh ASC
    `);

    const unpaidMap = {};
    [...unpaidPOs, ...unpaidNonPOs].forEach(doc => {
      if (!unpaidMap[doc.id_nha_cung_cap]) {
        unpaidMap[doc.id_nha_cung_cap] = [];
      }
      unpaidMap[doc.id_nha_cung_cap].push(doc);
    });

    const today = new Date();

    // 7. Calculate debt and aging for each supplier
    const result = suppliers.map(s => {
      const poInfo = poMap[s.id] || { tong_mua: 0, da_thanh_toan_pos: 0 };
      const nonPoInfo = nonPoMap[s.id] || { tong_no_khac: 0, da_thanh_toan_no_khac: 0 };
      
      const directPaid = (paymentMap[s.id] !== undefined) ? paymentMap[s.id] : (poInfo.da_thanh_toan_pos + nonPoInfo.da_thanh_toan_no_khac);
      const tongChi = Math.max(directPaid, (poInfo.da_thanh_toan_pos + nonPoInfo.da_thanh_toan_no_khac));

      const noDauKy = parseFloat(s.no_dau_ky) || 0;
      const tongMuaPO = poInfo.tong_mua;
      const tongNoKhac = nonPoInfo.tong_no_khac;
      const tongPhatSinh = tongMuaPO + tongNoKhac;

      // Dư nợ phải trả hiện tại = Nợ đầu kỳ + Tổng PO + Tổng nợ khác - Tổng đã thanh toán
      const tongDuNo = Math.max(0, noDauKy + tongPhatSinh - tongChi);

      const hanMuc = parseFloat(s.han_muc_no) || 0;
      const soNgayChoPhep = parseInt(s.so_ngay_no_toi_da) || 30;

      // Aging breakdown
      const suppUnpaid = unpaidMap[s.id] || [];
      let maxOverdueDays = 0;
      let noTrongHan = 0;
      let noQuaHan1_30 = 0;
      let noQuaHan31_60 = 0;
      let noQuaHan61_90 = 0;
      let noQuaHanTren90 = 0;
      let tongNoQuaHan = 0;

      suppUnpaid.forEach(doc => {
        const docDate = new Date(doc.ngay_phat_sinh);
        const diffTime = Math.max(0, today - docDate);
        const ageDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        const overdueDays = Math.max(0, ageDays - soNgayChoPhep);
        const remaining = parseFloat(doc.con_lai) || 0;

        if (overdueDays > maxOverdueDays) {
          maxOverdueDays = overdueDays;
        }

        if (overdueDays === 0) {
          noTrongHan += remaining;
        } else {
          tongNoQuaHan += remaining;
          if (overdueDays <= 30) {
            noQuaHan1_30 += remaining;
          } else if (overdueDays <= 60) {
            noQuaHan31_60 += remaining;
          } else if (overdueDays <= 90) {
            noQuaHan61_90 += remaining;
          } else {
            noQuaHanTren90 += remaining;
          }
        }
      });

      // If supplier has opening debt without active documents
      if (noDauKy > 0 && suppUnpaid.length === 0 && tongDuNo > 0) {
        if (s.ngay_chot_no_dau_ky) {
          const chotDate = new Date(s.ngay_chot_no_dau_ky);
          const diffTime = Math.max(0, today - chotDate);
          const ageDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          const overdueDays = Math.max(0, ageDays - soNgayChoPhep);
          if (overdueDays > 0) {
            maxOverdueDays = Math.max(maxOverdueDays, overdueDays);
            tongNoQuaHan += tongDuNo;
            if (overdueDays <= 30) noQuaHan1_30 += tongDuNo;
            else if (overdueDays <= 60) noQuaHan31_60 += tongDuNo;
            else if (overdueDays <= 90) noQuaHan61_90 += tongDuNo;
            else noQuaHanTren90 += tongDuNo;
          } else {
            noTrongHan += tongDuNo;
          }
        } else {
          noTrongHan += tongDuNo;
        }
      }

      let tuoiNoStatus = 'trong_han';
      let tuoiNoLabel = 'Trong hạn';
      if (maxOverdueDays > 90) {
        tuoiNoStatus = 'qua_han_tren_90';
        tuoiNoLabel = `Quá hạn >90 ngày (${maxOverdueDays} ngày)`;
      } else if (maxOverdueDays > 60) {
        tuoiNoStatus = 'qua_han_61_90';
        tuoiNoLabel = `Quá hạn 61-90 ngày (${maxOverdueDays} ngày)`;
      } else if (maxOverdueDays > 30) {
        tuoiNoStatus = 'qua_han_31_60';
        tuoiNoLabel = `Quá hạn 31-60 ngày (${maxOverdueDays} ngày)`;
      } else if (maxOverdueDays > 0) {
        tuoiNoStatus = 'qua_han_1_30';
        tuoiNoLabel = `Quá hạn 1-30 ngày (${maxOverdueDays} ngày)`;
      }

      const isVuotHanMuc = hanMuc > 0 && tongDuNo > hanMuc;

      return {
        ...s,
        no_dau_ky: noDauKy,
        tong_mua_po: tongMuaPO,
        tong_no_khac: tongNoKhac,
        tong_phat_sinh: tongPhatSinh,
        da_thanh_toan: tongChi,
        tong_du_no: tongDuNo,
        tong_no_qua_han: tongNoQuaHan,
        no_trong_han: noTrongHan,
        no_qua_han_1_30: noQuaHan1_30,
        no_qua_han_31_60: noQuaHan31_60,
        no_qua_han_61_90: noQuaHan61_90,
        no_qua_han_tren_90: noQuaHanTren90,
        max_overdue_days: maxOverdueDays,
        tuoi_no_status: tuoiNoStatus,
        tuoi_no_label: tuoiNoLabel,
        is_vuot_han_muc: isVuotHanMuc,
        so_luong_don_no: suppUnpaid.length
      };
    });

    return res.json(result);
  } catch (err) {
    console.error('Error fetching supplier debts:', err);
    return res.status(500).json({ message: 'Lỗi khi tải tổng hợp công nợ nhà cung cấp: ' + err.message });
  }
});

// 3. Create Supplier
router.post('/', authMiddleware, authorize(['Kinh_Doanh', 'Ke_Toan', 'Vat_Tu', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const {
    ten_nha_cung_cap,
    so_dien_thoai,
    dia_chi,
    ma_so_thue,
    nguoi_dai_dien,
    so_tai_khoan,
    ten_ngan_hang,
    so_ngay_no_toi_da,
    han_muc_no,
    trang_thai,
    no_dau_ky,
    ngay_chot_no_dau_ky,
    ghi_chu_no_dau_ky,
    ghi_chu
  } = req.body;

  if (!ten_nha_cung_cap || !ten_nha_cung_cap.trim()) {
    return res.status(400).json({ message: 'Tên nhà cung cấp là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO nha_cung_cap (
        ten_nha_cung_cap, so_dien_thoai, dia_chi, ma_so_thue, nguoi_dai_dien,
        so_tai_khoan, ten_ngan_hang, so_ngay_no_toi_da, han_muc_no, trang_thai,
        no_dau_ky, ngay_chot_no_dau_ky, ghi_chu_no_dau_ky, ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ten_nha_cung_cap.trim(),
        so_dien_thoai || null,
        dia_chi || null,
        ma_so_thue || null,
        nguoi_dai_dien || null,
        so_tai_khoan || null,
        ten_ngan_hang || null,
        so_ngay_no_toi_da ? parseInt(so_ngay_no_toi_da) : 30,
        han_muc_no ? parseFloat(han_muc_no) : 0,
        trang_thai || 'con_giao_dich',
        no_dau_ky ? parseFloat(no_dau_ky) : 0,
        ngay_chot_no_dau_ky || null,
        ghi_chu_no_dau_ky || null,
        ghi_chu || null,
        req.user.ten_dang_nhap
      ]
    );

    const insertedId = result.insertId;
    const [newRow] = await connection.query('SELECT * FROM nha_cung_cap WHERE id = ?', [insertedId]);

    await logChange(
      connection,
      'nha_cung_cap',
      insertedId,
      'THEM_MOI',
      null,
      newRow[0],
      req.user.ten_dang_nhap
    );

    await connection.commit();
    return res.status(201).json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi thêm mới nhà cung cấp.' });
  } finally {
    connection.release();
  }
});

// 4. Update Supplier
router.put('/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ke_Toan', 'Vat_Tu', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM nha_cung_cap WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy nhà cung cấp.' });
    }

    const fields = req.body;
    const updateKeys = [];
    const updateValues = [];

    const allowed = [
      'ten_nha_cung_cap',
      'so_dien_thoai',
      'dia_chi',
      'ma_so_thue',
      'nguoi_dai_dien',
      'so_tai_khoan',
      'ten_ngan_hang',
      'so_ngay_no_toi_da',
      'han_muc_no',
      'trang_thai',
      'no_dau_ky',
      'ngay_chot_no_dau_ky',
      'ghi_chu_no_dau_ky',
      'ghi_chu'
    ];

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        updateKeys.push(`\`${key}\` = ?`);
        updateValues.push(fields[key]);
      }
    }

    if (updateKeys.length > 0) {
      updateValues.push(req.params.id);
      await connection.query(
        `UPDATE nha_cung_cap SET ${updateKeys.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    const [newRow] = await connection.query('SELECT * FROM nha_cung_cap WHERE id = ?', [req.params.id]);

    await logChange(
      connection,
      'nha_cung_cap',
      req.params.id,
      'CAP_NHAT',
      oldRow[0],
      newRow[0],
      req.user.ten_dang_nhap
    );

    await connection.commit();
    return res.json(newRow[0]);
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi cập nhật nhà cung cấp.' });
  } finally {
    connection.release();
  }
});

// 5. Delete Supplier (Soft delete with relation checks)
router.delete('/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ke_Toan', 'Vat_Tu', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM nha_cung_cap WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy nhà cung cấp.' });
    }

    // Check relations
    const [poCount] = await connection.query('SELECT COUNT(*) as cnt FROM phieu_mua_hang WHERE id_nha_cung_cap = ?', [req.params.id]);
    const [nonPoCount] = await connection.query('SELECT COUNT(*) as cnt FROM cong_no_khac_ncc WHERE id_nha_cung_cap = ? AND da_xoa = 0', [req.params.id]);

    if ((poCount[0]?.cnt || 0) > 0 || (nonPoCount[0]?.cnt || 0) > 0) {
      // Switch status to ngung_giao_dich or mark da_xoa
      await connection.query('UPDATE nha_cung_cap SET da_xoa = 1, trang_thai = "khong_con_giao_dich" WHERE id = ?', [req.params.id]);
    } else {
      await connection.query('DELETE FROM nha_cung_cap WHERE id = ?', [req.params.id]);
    }

    await logChange(
      connection,
      'nha_cung_cap',
      req.params.id,
      'XOA',
      oldRow[0],
      null,
      req.user.ten_dang_nhap
    );

    await connection.commit();
    return res.json({ message: 'Đã xóa nhà cung cấp thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xóa nhà cung cấp: ' + err.message });
  } finally {
    connection.release();
  }
});

// 6. Create Non-PO / Service Debt manually (Ghi nhận nợ khác / Dịch vụ)
router.post('/:id/no-khac', authMiddleware, authorize(['Kinh_Doanh', 'Ke_Toan', 'Vat_Tu', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const id_nha_cung_cap = req.params.id;
    const {
      loai_chi_phi,
      so_hoa_don_vat,
      ngay_phat_sinh,
      han_thanh_toan,
      id_cong_trinh,
      so_tien,
      dien_giai,
      ghi_chu
    } = req.body;

    const amount = parseFloat(so_tien);
    if (isNaN(amount) || amount <= 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Số tiền nợ phát sinh phải lớn hơn 0.' });
    }

    if (!dien_giai || !dien_giai.trim()) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Vui lòng nhập nội dung diễn giải chi phí.' });
    }

    const [suppRows] = await connection.query('SELECT * FROM nha_cung_cap WHERE id = ?', [id_nha_cung_cap]);
    if (suppRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy nhà cung cấp.' });
    }

    const docDate = ngay_phat_sinh || new Date();
    const yearTwoDigits = String(new Date(docDate).getFullYear()).slice(-2);
    const [countRow] = await connection.query('SELECT COUNT(*) as cnt FROM cong_no_khac_ncc');
    const seqNum = (countRow[0]?.cnt || 0) + 1;
    const ma_chung_tu = `NK${String(seqNum).padStart(6, '0')}/${yearTwoDigits}`;

    const [insertResult] = await connection.query(
      `INSERT INTO cong_no_khac_ncc (
        ma_chung_tu, id_nha_cung_cap, loai_chi_phi, so_hoa_don_vat, ngay_phat_sinh,
        han_thanh_toan, id_cong_trinh, so_tien, da_thanh_toan, con_lai,
        trang_thai_thanh_toan, dien_giai, ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'chua_thanh_toan', ?, ?, ?)`,
      [
        ma_chung_tu,
        id_nha_cung_cap,
        loai_chi_phi || 'chi_phi_khac',
        so_hoa_don_vat || null,
        docDate,
        han_thanh_toan || null,
        id_cong_trinh || null,
        amount,
        amount,
        dien_giai.trim(),
        ghi_chu || null,
        req.user?.ten_dang_nhap || 'system'
      ]
    );

    const insertedId = insertResult.insertId;
    const [newRow] = await connection.query('SELECT * FROM cong_no_khac_ncc WHERE id = ?', [insertedId]);

    await logChange(
      connection,
      'cong_no_khac_ncc',
      insertedId,
      'THEM_MOI',
      null,
      newRow[0],
      req.user?.ten_dang_nhap || 'system'
    );

    await connection.commit();
    return res.status(201).json({
      message: `Ghi nhận khoản nợ khác ${ma_chung_tu} thành công!`,
      data: newRow[0]
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error creating non-po debt:', err);
    return res.status(500).json({ message: 'Lỗi khi ghi nhận nợ khác: ' + err.message });
  } finally {
    connection.release();
  }
});

// 7. Get List of Non-PO Debts of a Supplier
router.get('/:id/no-khac', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, ct.ten_cong_trinh
      FROM cong_no_khac_ncc c
      LEFT JOIN cong_trinh ct ON c.id_cong_trinh = ct.id
      WHERE c.id_nha_cung_cap = ? AND c.da_xoa = 0
      ORDER BY c.ngay_phat_sinh DESC, c.id DESC
    `, [req.params.id]);

    return res.json(rows);
  } catch (err) {
    console.error('Error fetching non-po debts:', err);
    return res.status(500).json({ message: 'Lỗi khi tải danh sách nợ khác: ' + err.message });
  }
});

// 8. Delete Non-PO Debt
router.delete('/no-khac/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ke_Toan', 'Vat_Tu', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  try {
    const [oldRow] = await pool.query('SELECT * FROM cong_no_khac_ncc WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy khoản nợ.' });
    }

    if (parseFloat(oldRow[0].da_thanh_toan || 0) > 0) {
      return res.status(400).json({ message: 'Khoản nợ này đã có thanh toán, không thể xóa.' });
    }

    await pool.query('UPDATE cong_no_khac_ncc SET da_xoa = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Đã xóa khoản nợ thành công.' });
  } catch (err) {
    console.error('Error deleting non-po debt:', err);
    return res.status(500).json({ message: 'Lỗi khi xóa khoản nợ: ' + err.message });
  }
});

// 9. Get all unpaid documents (POs and Non-PO debts) of a supplier
router.get('/:id/unpaid-documents', authMiddleware, async (req, res) => {
  try {
    const id_nha_cung_cap = req.params.id;

    // 1. Unpaid Purchase Orders
    const [pos] = await pool.query(`
      SELECT p.id, p.ma_phieu_mua AS ma_chung_tu, p.ngay_mua AS ngay_phat_sinh,
             p.tong_tien, COALESCE(p.da_thanh_toan, 0) AS da_thanh_toan,
             (p.tong_tien - COALESCE(p.da_thanh_toan, 0)) AS con_lai,
             p.trang_thai_thanh_toan,
             'phieu_mua_hang' AS loai_chung_tu,
             COALESCE(p.ghi_chu, 'Mua vật tư theo phiếu') AS dien_giai
      FROM phieu_mua_hang p
      WHERE p.id_nha_cung_cap = ?
        AND (p.tong_tien - COALESCE(p.da_thanh_toan, 0)) > 0
        AND (p.trang_thai_giao_hang != 'Đã hủy' OR p.trang_thai_giao_hang IS NULL)
      ORDER BY p.ngay_mua ASC, p.id ASC
    `, [id_nha_cung_cap]);

    // 2. Unpaid Non-PO Debts
    const [nonPos] = await pool.query(`
      SELECT c.id, c.ma_chung_tu, c.ngay_phat_sinh,
             c.so_tien AS tong_tien, COALESCE(c.da_thanh_toan, 0) AS da_thanh_toan,
             (c.so_tien - COALESCE(c.da_thanh_toan, 0)) AS con_lai,
             c.trang_thai_thanh_toan,
             'cong_no_khac' AS loai_chung_tu,
             c.dien_giai
      FROM cong_no_khac_ncc c
      WHERE c.id_nha_cung_cap = ?
        AND (c.so_tien - COALESCE(c.da_thanh_toan, 0)) > 0
        AND c.da_xoa = 0
      ORDER BY c.ngay_phat_sinh ASC, c.id ASC
    `, [id_nha_cung_cap]);

    const allUnpaid = [...pos, ...nonPos].sort((a, b) => new Date(a.ngay_phat_sinh) - new Date(b.ngay_phat_sinh));

    return res.json(allUnpaid);
  } catch (err) {
    console.error('Error fetching unpaid documents:', err);
    return res.status(500).json({ message: 'Lỗi khi tải danh sách chứng từ nợ: ' + err.message });
  }
});

// 10. Pay Supplier Debt & Deduct with FIFO or Specific Allocation
router.post('/:id/tra-no', authMiddleware, authorize(['Kinh_Doanh', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const id_nha_cung_cap = req.params.id;
    const {
      so_tien_chi,
      ngay_chi,
      hinh_thuc_thanh_toan, // 'Tien_Mat' | 'Chuyen_Khoan'
      id_quy_tien,
      kieu_gach_no, // 'fifo' | 'dich_danh'
      danh_sach_gach_no, // array of { loai_chung_tu, id_chung_tu, so_tien }
      ghi_chu
    } = req.body;

    const amount = parseFloat(so_tien_chi);
    if (isNaN(amount) || amount <= 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Số tiền chi trả nợ phải lớn hơn 0.' });
    }

    const [suppRows] = await connection.query('SELECT * FROM nha_cung_cap WHERE id = ?', [id_nha_cung_cap]);
    if (suppRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy nhà cung cấp.' });
    }
    const supp = suppRows[0];

    const voucherDate = ngay_chi || new Date();
    const currentYear = new Date(voucherDate).getFullYear();
    const lvkdId = 1;

    let maLvkd = 'VLXD';
    const [lvkdRows] = await connection.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [lvkdId]);
    if (lvkdRows.length > 0 && lvkdRows[0].ma_lvkd) {
      maLvkd = lvkdRows[0].ma_lvkd.trim().toUpperCase();
    }

    const seq = await generateSequenceNumber(connection, {
      id_linh_vuc_kinh_doanh: lvkdId,
      loai_chung_tu: 'PC',
      nam: currentYear,
      ma_lvkd: maLvkd
    });

    const lyDoChi = ghi_chu && ghi_chu.trim() ? ghi_chu.trim() : `Chi trả tiền nợ nhà cung cấp ${supp.ten_nha_cung_cap}`;

    // 1. Create phieu_thu_chi (Payment Voucher)
    const [ptcResult] = await connection.query(
      `INSERT INTO phieu_thu_chi (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
        loai_doi_tuong, id_doi_tuong, ten_doi_tuong, dia_chi_doi_tuong, sdt_doi_tuong,
        id_quy_tien, hinh_thuc_thanh_toan, so_tien, ngay_chung_tu, nguoi_nop_nhan,
        ly_do_thu_chi, trang_thai, ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, 'Phieu_Chi', 'chi_mua_hang', 'nha_cung_cap', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'đã thanh toán', ?, ?)`,
      [
        seq.ma_phieu,
        seq.so_vao_so,
        currentYear,
        lvkdId,
        id_nha_cung_cap,
        supp.ten_nha_cung_cap,
        supp.dia_chi || null,
        supp.so_dien_thoai || null,
        id_quy_tien || 1,
        hinh_thuc_thanh_toan || 'Tien_Mat',
        amount,
        voucherDate,
        supp.nguoi_dai_dien || supp.ten_nha_cung_cap,
        lyDoChi,
        ghi_chu || null,
        req.user?.ten_dang_nhap || 'system'
      ]
    );
    const id_phieu_thu_chi = ptcResult.insertId;

    // 2. Process Debt Deductions
    const allocatedDeductions = [];

    if (kieu_gach_no === 'dich_danh' && Array.isArray(danh_sach_gach_no) && danh_sach_gach_no.length > 0) {
      for (const item of danh_sach_gach_no) {
        const deductAmount = parseFloat(item.so_tien) || 0;
        if (deductAmount <= 0) continue;

        if (item.loai_chung_tu === 'phieu_mua_hang') {
          const [poRows] = await connection.query('SELECT tong_tien, da_thanh_toan FROM phieu_mua_hang WHERE id = ?', [item.id_chung_tu]);
          if (poRows.length > 0) {
            const totalPo = parseFloat(poRows[0].tong_tien) || 0;
            const currentPaid = parseFloat(poRows[0].da_thanh_toan) || 0;
            const newPaid = currentPaid + deductAmount;
            const remaining = Math.max(0, totalPo - newPaid);
            const payStatus = newPaid >= totalPo ? 'đã thanh toán' : 'thanh toán một phần';

            await connection.query(
              'UPDATE phieu_mua_hang SET da_thanh_toan = ?, cong_no_con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?',
              [newPaid, remaining, payStatus, item.id_chung_tu]
            );

            await connection.query(
              `INSERT INTO chi_tiet_gach_no_ncc (id_phieu_thu_chi, loai_chung_tu_no, id_chung_tu_no, so_tien_khau_tru, nguoi_tao)
               VALUES (?, 'phieu_mua_hang', ?, ?, ?)`,
              [id_phieu_thu_chi, item.id_chung_tu, deductAmount, req.user?.ten_dang_nhap || 'system']
            );

            allocatedDeductions.push({ loai: 'phieu_mua_hang', id: item.id_chung_tu, so_tien: deductAmount });
          }
        } else if (item.loai_chung_tu === 'cong_no_khac') {
          const [cnkRows] = await connection.query('SELECT so_tien, da_thanh_toan FROM cong_no_khac_ncc WHERE id = ?', [item.id_chung_tu]);
          if (cnkRows.length > 0) {
            const totalCnk = parseFloat(cnkRows[0].so_tien) || 0;
            const currentPaid = parseFloat(cnkRows[0].da_thanh_toan) || 0;
            const newPaid = currentPaid + deductAmount;
            const remaining = Math.max(0, totalCnk - newPaid);
            const payStatus = newPaid >= totalCnk ? 'da_thanh_toan' : 'thanh_toan_mot_phan';

            await connection.query(
              'UPDATE cong_no_khac_ncc SET da_thanh_toan = ?, con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?',
              [newPaid, remaining, payStatus, item.id_chung_tu]
            );

            await connection.query(
              `INSERT INTO chi_tiet_gach_no_ncc (id_phieu_thu_chi, loai_chung_tu_no, id_chung_tu_no, so_tien_khau_tru, nguoi_tao)
               VALUES (?, 'cong_no_khac', ?, ?, ?)`,
              [id_phieu_thu_chi, item.id_chung_tu, deductAmount, req.user?.ten_dang_nhap || 'system']
            );

            allocatedDeductions.push({ loai: 'cong_no_khac', id: item.id_chung_tu, so_tien: deductAmount });
          }
        }
      }
    } else {
      // FIFO: Oldest documents first
      let remainToAllocate = amount;

      // 1. Get unpaid POs
      const [pos] = await connection.query(`
        SELECT id, tong_tien, COALESCE(da_thanh_toan, 0) AS da_thanh_toan, ngay_mua AS ngay_phat_sinh, 'phieu_mua_hang' AS loai_chung_tu
        FROM phieu_mua_hang
        WHERE id_nha_cung_cap = ?
          AND (tong_tien - COALESCE(da_thanh_toan, 0)) > 0
          AND (trang_thai_giao_hang != 'Đã hủy' OR trang_thai_giao_hang IS NULL)
      `, [id_nha_cung_cap]);

      // 2. Get unpaid Non-PO debts
      const [nonPos] = await connection.query(`
        SELECT id, so_tien AS tong_tien, COALESCE(da_thanh_toan, 0) AS da_thanh_toan, ngay_phat_sinh, 'cong_no_khac' AS loai_chung_tu
        FROM cong_no_khac_ncc
        WHERE id_nha_cung_cap = ?
          AND (so_tien - COALESCE(da_thanh_toan, 0)) > 0
          AND da_xoa = 0
      `, [id_nha_cung_cap]);

      const allUnpaid = [...pos, ...nonPos].sort((a, b) => new Date(a.ngay_phat_sinh) - new Date(b.ngay_phat_sinh));

      for (const doc of allUnpaid) {
        if (remainToAllocate <= 0) break;

        const totalDoc = parseFloat(doc.tong_tien) || 0;
        const currentPaid = parseFloat(doc.da_thanh_toan) || 0;
        const debtThisDoc = totalDoc - currentPaid;

        const deduct = Math.min(remainToAllocate, debtThisDoc);
        const newPaid = currentPaid + deduct;
        const remaining = Math.max(0, totalDoc - newPaid);

        if (doc.loai_chung_tu === 'phieu_mua_hang') {
          const payStatus = newPaid >= totalDoc ? 'đã thanh toán' : 'thanh toán một phần';
          await connection.query(
            'UPDATE phieu_mua_hang SET da_thanh_toan = ?, cong_no_con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?',
            [newPaid, remaining, payStatus, doc.id]
          );

          await connection.query(
            `INSERT INTO chi_tiet_gach_no_ncc (id_phieu_thu_chi, loai_chung_tu_no, id_chung_tu_no, so_tien_khau_tru, nguoi_tao)
             VALUES (?, 'phieu_mua_hang', ?, ?, ?)`,
            [id_phieu_thu_chi, doc.id, deduct, req.user?.ten_dang_nhap || 'system']
          );
        } else {
          const payStatus = newPaid >= totalDoc ? 'da_thanh_toan' : 'thanh_toan_mot_phan';
          await connection.query(
            'UPDATE cong_no_khac_ncc SET da_thanh_toan = ?, con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?',
            [newPaid, remaining, payStatus, doc.id]
          );

          await connection.query(
            `INSERT INTO chi_tiet_gach_no_ncc (id_phieu_thu_chi, loai_chung_tu_no, id_chung_tu_no, so_tien_khau_tru, nguoi_tao)
             VALUES (?, 'cong_no_khac', ?, ?, ?)`,
            [id_phieu_thu_chi, doc.id, deduct, req.user?.ten_dang_nhap || 'system']
          );
        }

        allocatedDeductions.push({ loai: doc.loai_chung_tu, id: doc.id, so_tien: deduct });
        remainToAllocate -= deduct;
      }
    }

    await logChange(
      connection,
      'phieu_thu_chi',
      id_phieu_thu_chi,
      'THEM_MOI',
      null,
      { id: id_phieu_thu_chi, id_nha_cung_cap, so_tien: amount, ma_phieu: seq.ma_phieu, deductions: allocatedDeductions },
      req.user?.ten_dang_nhap || 'system'
    );

    await connection.commit();
    return res.status(201).json({
      message: `Lập Phiếu Chi ${seq.ma_phieu} và cấn trừ công nợ thành công!`,
      ma_phieu: seq.ma_phieu,
      so_tien: amount,
      allocatedDeductions
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error processing supplier debt payment:', err);
    return res.status(500).json({ message: 'Lỗi khi chi trả nợ nhà cung cấp: ' + err.message });
  } finally {
    connection.release();
  }
});

// 11. Get Supplier Ledger (Sổ chi tiết công nợ nhà cung cấp)
router.get('/:id/so-chi-tiet-cong-no', authMiddleware, async (req, res) => {
  try {
    const id_nha_cung_cap = req.params.id;
    const { tu_ngay, den_ngay } = req.query;

    const [suppRows] = await pool.query('SELECT * FROM nha_cung_cap WHERE id = ?', [id_nha_cung_cap]);
    if (suppRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy nhà cung cấp.' });
    }
    const supplier = suppRows[0];

    const startDate = tu_ngay ? new Date(tu_ngay) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = den_ngay ? new Date(den_ngay + ' 23:59:59') : new Date();

    const noDauKyInit = parseFloat(supplier.no_dau_ky) || 0;

    // 1. Debt before tu_ngay
    let [posBefore] = await pool.query(`
      SELECT COALESCE(SUM(tong_tien), 0) AS total
      FROM phieu_mua_hang
      WHERE id_nha_cung_cap = ?
        AND ngay_mua < ?
        AND (trang_thai_giao_hang != 'Đã hủy' OR trang_thai_giao_hang IS NULL)
    `, [id_nha_cung_cap, startDate]);

    let [nonPosBefore] = await pool.query(`
      SELECT COALESCE(SUM(so_tien), 0) AS total
      FROM cong_no_khac_ncc
      WHERE id_nha_cung_cap = ?
        AND ngay_phat_sinh < ?
        AND da_xoa = 0
    `, [id_nha_cung_cap, startDate]);

    let [paymentsBefore] = await pool.query(`
      SELECT COALESCE(SUM(so_tien), 0) AS total
      FROM phieu_thu_chi
      WHERE (loai_doi_tuong = 'nha_cung_cap' OR loai_doi_tuong = 'Nha_Cung_Cap')
        AND id_doi_tuong = ?
        AND loai_phieu = 'Phieu_Chi'
        AND (da_xoa = 0 OR da_xoa IS NULL)
        AND ngay_chung_tu < ?
    `, [id_nha_cung_cap, startDate]);

    const openingBalance = noDauKyInit + (parseFloat(posBefore[0].total) || 0) + (parseFloat(nonPosBefore[0].total) || 0) - (parseFloat(paymentsBefore[0].total) || 0);

    // 2. Transactions during period
    const [posDuring] = await pool.query(`
      SELECT id, ma_phieu_mua AS ma_chung_tu, ngay_mua AS ngay_phat_sinh,
             'Mua vật tư theo phiếu' AS dien_giai, tong_tien AS phat_sinh_tang, 0 AS phat_sinh_giam,
             'phieu_mua_hang' AS loai_giao_dich
      FROM phieu_mua_hang
      WHERE id_nha_cung_cap = ?
        AND ngay_mua >= ? AND ngay_mua <= ?
        AND (trang_thai_giao_hang != 'Đã hủy' OR trang_thai_giao_hang IS NULL)
    `, [id_nha_cung_cap, startDate, endDate]);

    const [nonPosDuring] = await pool.query(`
      SELECT id, ma_chung_tu, ngay_phat_sinh,
             dien_giai, so_tien AS phat_sinh_tang, 0 AS phat_sinh_giam,
             'cong_no_khac' AS loai_giao_dich
      FROM cong_no_khac_ncc
      WHERE id_nha_cung_cap = ?
        AND ngay_phat_sinh >= ? AND ngay_phat_sinh <= ?
        AND da_xoa = 0
    `, [id_nha_cung_cap, startDate, endDate]);

    const [paymentsDuring] = await pool.query(`
      SELECT id, ma_phieu AS ma_chung_tu, ngay_chung_tu AS ngay_phat_sinh,
             COALESCE(ly_do_thu_chi, 'Chi trả tiền nợ') AS dien_giai,
             0 AS phat_sinh_tang, so_tien AS phat_sinh_giam,
             'phieu_chi' AS loai_giao_dich
      FROM phieu_thu_chi
      WHERE (loai_doi_tuong = 'nha_cung_cap' OR loai_doi_tuong = 'Nha_Cung_Cap')
        AND id_doi_tuong = ?
        AND loai_phieu = 'Phieu_Chi'
        AND (da_xoa = 0 OR da_xoa IS NULL)
        AND ngay_chung_tu >= ? AND ngay_chung_tu <= ?
    `, [id_nha_cung_cap, startDate, endDate]);

    const allTransactions = [...posDuring, ...nonPosDuring, ...paymentsDuring].sort((a, b) => new Date(a.ngay_phat_sinh) - new Date(b.ngay_phat_sinh));

    let runningBalance = openingBalance;
    let totalTang = 0;
    let totalGiam = 0;

    const transactionRows = allTransactions.map(tx => {
      const tang = parseFloat(tx.phat_sinh_tang) || 0;
      const giam = parseFloat(tx.phat_sinh_giam) || 0;
      totalTang += tang;
      totalGiam += giam;
      runningBalance = runningBalance + tang - giam;

      return {
        ...tx,
        phat_sinh_tang: tang,
        phat_sinh_giam: giam,
        du_no_luy_ke: runningBalance
      };
    });

    return res.json({
      supplier,
      tu_ngay: startDate.toISOString().split('T')[0],
      den_ngay: endDate.toISOString().split('T')[0],
      so_du_dau_ky: openingBalance,
      tong_phat_sinh_tang: totalTang,
      tong_phat_sinh_giam: totalGiam,
      so_du_cuoi_ky: runningBalance,
      transactions: transactionRows
    });
  } catch (err) {
    console.error('Error fetching supplier ledger:', err);
    return res.status(500).json({ message: 'Lỗi khi tải sổ chi tiết công nợ nhà cung cấp: ' + err.message });
  }
});

module.exports = router;
