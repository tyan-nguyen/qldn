const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authMiddleware, authorize } = require('../middleware/auth');
const { logChange } = require('../utils/logger');
const { generateSequenceNumber } = require('../services/sequenceService');

// Calculate customer debt and overdue status
async function getCustomerDebtInfo(id_khach_hang) {
  // 1. Total order value
  const [orderSum] = await pool.query(
    'SELECT SUM(tong_tien) as total_orders FROM don_hang WHERE id_khach_hang = ? AND trang_thai_don_hang != "Đã hủy"',
    [id_khach_hang]
  );
  const totalOrders = parseFloat(orderSum[0].total_orders) || 0;

  // 2. Total sales returns value
  const [returnSum] = await pool.query(
    `SELECT COALESCE(SUM(pnk.tong_tien), 0) AS total_returns
     FROM phieu_nhap_kho pnk
     LEFT JOIN don_hang dh ON pnk.id_don_hang = dh.id
     WHERE COALESCE(pnk.id_khach_hang, dh.id_khach_hang) = ?
       AND pnk.loai_nhap_kho = 'tra_hang_ban'
       AND COALESCE(pnk.da_xoa, 0) = 0`,
    [id_khach_hang]
  );
  const totalReturns = parseFloat(returnSum[0].total_returns) || 0;

  // 3. Total payments received (from phieu_thu_chi or thanh_toan_khach_hang)
  const [paySum] = await pool.query(
    `SELECT COALESCE(SUM(so_tien), 0) AS total_payments
     FROM phieu_thu_chi
     WHERE (loai_doi_tuong = 'Khach_Hang' OR loai_doi_tuong = 'khach_hang') AND id_doi_tuong = ? AND loai_phieu = 'Phieu_Thu' AND (da_xoa = 0 OR da_xoa IS NULL)`,
    [id_khach_hang]
  );
  let totalPayments = parseFloat(paySum[0].total_payments) || 0;
  if (totalPayments === 0) {
    const [legacyPaySum] = await pool.query(
      'SELECT SUM(so_tien_nhan) as total_payments FROM thanh_toan_khach_hang WHERE id_khach_hang = ?',
      [id_khach_hang]
    );
    totalPayments = parseFloat(legacyPaySum[0].total_payments) || 0;
  }

  const [customerInfo] = await pool.query(
    'SELECT so_ngay_no_toi_da, han_muc_tin_dung, COALESCE(no_dau_ky, 0) AS no_dau_ky, ngay_chot_no_dau_ky FROM khach_hang WHERE id = ?',
    [id_khach_hang]
  );

  if (customerInfo.length === 0) {
    return { currentDebt: 0, isOverdue: false, overdueOrders: [] };
  }

  const noDauKy = parseFloat(customerInfo[0].no_dau_ky) || 0;
  const currentDebt = Math.max(0, noDauKy + totalOrders - totalReturns - totalPayments);

  // 4. Check for overdue orders
  const [unpaidOrders] = await pool.query(
    `SELECT d.id, d.ma_don_hang, d.ngay_dat_hang, d.tong_tien,
            COALESCE(d.so_tien_da_thanh_toan, 0) as da_tra,
            (d.tong_tien - COALESCE(d.so_tien_da_thanh_toan, 0) - COALESCE((
              SELECT SUM(pnk.tong_tien) FROM phieu_nhap_kho pnk WHERE pnk.id_don_hang = d.id AND pnk.loai_nhap_kho = 'tra_hang_ban' AND COALESCE(pnk.da_xoa, 0) = 0
            ), 0)) as con_lai
     FROM don_hang d
     WHERE d.id_khach_hang = ? 
       AND (d.tong_tien - COALESCE(d.so_tien_da_thanh_toan, 0) - COALESCE((
              SELECT SUM(pnk.tong_tien) FROM phieu_nhap_kho pnk WHERE pnk.id_don_hang = d.id AND pnk.loai_nhap_kho = 'tra_hang_ban' AND COALESCE(pnk.da_xoa, 0) = 0
            ), 0)) > 0 
       AND d.trang_thai_don_hang != 'Đã hủy'
     ORDER BY d.ngay_dat_hang ASC`,
    [id_khach_hang]
  );

  const { so_ngay_no_toi_da } = customerInfo[0];
  const today = new Date();
  const overdueOrders = [];
  let isOverdue = false;

  for (const ord of unpaidOrders) {
    const orderDate = new Date(ord.ngay_dat_hang);
    const diffTime = Math.abs(today - orderDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays > so_ngay_no_toi_da) {
      isOverdue = true;
      overdueOrders.push({
        id: ord.id,
        ma_don_hang: ord.ma_don_hang,
        ngay_dat_hang: ord.ngay_dat_hang,
        no_ton: ord.con_lai,
        so_ngay_tre: diffDays - so_ngay_no_toi_da
      });
    }
  }

  return {
    currentDebt,
    isOverdue,
    overdueOrders
  };
}

// 1. Get debt status of all customers (Comprehensive Debt & Aging Report)
router.get('/cong-no', authMiddleware, async (req, res) => {
  try {
    const [customers] = await pool.query(`
      SELECT id, ten_khach_hang, so_dien_thoai, dia_chi, loai_khach_hang, ten_cong_ty,
             ma_so_thue, nguoi_dai_dien, han_muc_tin_dung, so_ngay_no_toi_da,
             COALESCE(no_dau_ky, 0) AS no_dau_ky, ngay_chot_no_dau_ky, ghi_chu_no_dau_ky,
             trang_thai
      FROM khach_hang
      WHERE da_xoa = 0
      ORDER BY id DESC
    `);

    // Aggregate sales orders
    const [orderRows] = await pool.query(`
      SELECT id_khach_hang,
             COALESCE(SUM(tong_tien), 0) AS tong_mua,
             COALESCE(SUM(so_tien_da_thanh_toan), 0) AS da_thanh_toan_orders
      FROM don_hang
      WHERE trang_thai_don_hang != 'Đã hủy'
      GROUP BY id_khach_hang
    `);
    const orderMap = {};
    orderRows.forEach(r => {
      orderMap[r.id_khach_hang] = {
        tong_mua: parseFloat(r.tong_mua) || 0,
        da_thanh_toan_orders: parseFloat(r.da_thanh_toan_orders) || 0
      };
    });

    // Aggregate receipts (phieu_thu_chi)
    const [receiptRows] = await pool.query(`
      SELECT id_doi_tuong AS id_khach_hang,
             COALESCE(SUM(so_tien), 0) AS tong_thu
      FROM phieu_thu_chi
      WHERE loai_phieu = 'Phieu_Thu' AND (loai_doi_tuong = 'Khach_Hang' OR loai_doi_tuong = 'khach_hang') AND (da_xoa = 0 OR da_xoa IS NULL)
      GROUP BY id_doi_tuong
    `);
    const receiptMap = {};
    receiptRows.forEach(r => {
      receiptMap[r.id_khach_hang] = parseFloat(r.tong_thu) || 0;
    });

    // Aggregate sales returns (phieu_nhap_kho tra_hang_ban)
    const [returnRows] = await pool.query(`
      SELECT COALESCE(pnk.id_khach_hang, dh.id_khach_hang) AS id_khach_hang,
             COALESCE(SUM(pnk.tong_tien), 0) AS tong_tra
      FROM phieu_nhap_kho pnk
      LEFT JOIN don_hang dh ON pnk.id_don_hang = dh.id
      WHERE pnk.loai_nhap_kho = 'tra_hang_ban' AND COALESCE(pnk.da_xoa, 0) = 0
      GROUP BY COALESCE(pnk.id_khach_hang, dh.id_khach_hang)
    `);
    const returnMap = {};
    returnRows.forEach(r => {
      if (r.id_khach_hang) {
        returnMap[r.id_khach_hang] = parseFloat(r.tong_tra) || 0;
      }
    });

    // Get unpaid orders for aging analysis
    const [unpaidOrders] = await pool.query(`
      SELECT d.id, d.id_khach_hang, d.ma_don_hang, d.ngay_dat_hang, d.tong_tien,
             COALESCE(d.so_tien_da_thanh_toan, 0) AS da_tra,
             (d.tong_tien - COALESCE(d.so_tien_da_thanh_toan, 0) - COALESCE((
               SELECT SUM(pnk.tong_tien) FROM phieu_nhap_kho pnk WHERE pnk.id_don_hang = d.id AND pnk.loai_nhap_kho = 'tra_hang_ban' AND COALESCE(pnk.da_xoa, 0) = 0
             ), 0)) AS con_lai
      FROM don_hang d
      WHERE (d.tong_tien - COALESCE(d.so_tien_da_thanh_toan, 0) - COALESCE((
               SELECT SUM(pnk.tong_tien) FROM phieu_nhap_kho pnk WHERE pnk.id_don_hang = d.id AND pnk.loai_nhap_kho = 'tra_hang_ban' AND COALESCE(pnk.da_xoa, 0) = 0
             ), 0)) > 0
        AND d.trang_thai_don_hang != 'Đã hủy'
      ORDER BY d.ngay_dat_hang ASC
    `);

    const unpaidMap = {};
    unpaidOrders.forEach(ord => {
      if (!unpaidMap[ord.id_khach_hang]) {
        unpaidMap[ord.id_khach_hang] = [];
      }
      unpaidMap[ord.id_khach_hang].push(ord);
    });

    const today = new Date();

    const result = customers.map(c => {
      const ordInfo = orderMap[c.id] || { tong_mua: 0, da_thanh_toan_orders: 0 };
      const tongTraHang = returnMap[c.id] || 0;
      const tongThu = receiptMap[c.id] || ordInfo.da_thanh_toan_orders;
      
      const noDauKy = parseFloat(c.no_dau_ky) || 0;
      const tongPhatSinh = ordInfo.tong_mua;
      const tongDuNo = Math.max(0, noDauKy + tongPhatSinh - tongTraHang - tongThu);

      const hanMuc = parseFloat(c.han_muc_tin_dung) || 0;
      const soNgayChoPhep = parseInt(c.so_ngay_no_toi_da) || 30;

      // Aging breakdown
      const custUnpaid = unpaidMap[c.id] || [];
      let maxOverdueDays = 0;
      let noTrongHan = 0;
      let noQuaHan1_30 = 0;
      let noQuaHan31_60 = 0;
      let noQuaHan61_90 = 0;
      let noQuaHanTren90 = 0;
      let tongNoQuaHan = 0;

      custUnpaid.forEach(ord => {
        const orderDate = new Date(ord.ngay_dat_hang);
        const diffTime = Math.max(0, today - orderDate);
        const ageDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        const overdueDays = Math.max(0, ageDays - soNgayChoPhep);
        const remaining = parseFloat(ord.con_lai) || 0;

        if (overdueDays > maxOverdueDays) {
          maxOverdueDays = overdueDays;
        }

        if (overdueDays === 0) {
          noTrongHan += remaining;
        } else {
          tongNoQuaHan += remaining;
          if (overdueDays <= 30) noQuaHan1_30 += remaining;
          else if (overdueDays <= 60) noQuaHan31_60 += remaining;
          else if (overdueDays <= 90) noQuaHan61_90 += remaining;
          else noQuaHanTren90 += remaining;
        }
      });

      if (noDauKy > 0 && custUnpaid.length === 0 && tongDuNo > 0) {
        if (c.ngay_chot_no_dau_ky) {
          const chotDate = new Date(c.ngay_chot_no_dau_ky);
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
        ...c,
        no_dau_ky: noDauKy,
        tong_phat_sinh: tongPhatSinh,
        tong_tra_hang: tongTraHang,
        da_thanh_toan: tongThu,
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
        so_luong_don_no: custUnpaid.length
      };
    });

    return res.json(result);
  } catch (err) {
    console.error('Error fetching customer debts:', err);
    return res.status(500).json({ message: 'Lỗi khi tải tổng hợp công nợ khách hàng: ' + err.message });
  }
});

// 2. Customer List (Accessible by sales, accountants, directors)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM khach_hang WHERE da_xoa = 0 ORDER BY id DESC');
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi truy vấn danh sách khách hàng.' });
  }
});

// 3. Create Customer
router.post('/', authMiddleware, authorize(['Kinh_Doanh', 'Ke_Toan', 'Ban_Giam_Doc']), async (req, res) => {
  const {
    ten_khach_hang,
    so_dien_thoai,
    dia_chi,
    han_muc_tin_dung,
    so_ngay_no_toi_da,
    loai_khach_hang,
    ten_cong_ty,
    ten_ngan_hang,
    so_tai_khoan,
    ma_so_thue,
    nguoi_dai_dien,
    ghi_chu,
    trang_thai,
    no_dau_ky,
    ngay_chot_no_dau_ky,
    ghi_chu_no_dau_ky
  } = req.body;

  if (!ten_khach_hang || !loai_khach_hang) {
    return res.status(400).json({ message: 'Tên khách hàng và loại khách hàng là bắt buộc.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO khach_hang (
        ten_khach_hang, so_dien_thoai, dia_chi, han_muc_tin_dung, so_ngay_no_toi_da,
        loai_khach_hang, ten_cong_ty, ten_ngan_hang, so_tai_khoan, ma_so_thue,
        nguoi_dai_dien, ghi_chu, trang_thai, no_dau_ky, ngay_chot_no_dau_ky,
        ghi_chu_no_dau_ky, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ten_khach_hang,
        so_dien_thoai || null,
        dia_chi || null,
        han_muc_tin_dung || 0,
        so_ngay_no_toi_da || 30,
        loai_khach_hang,
        ten_cong_ty || null,
        ten_ngan_hang || null,
        so_tai_khoan || null,
        ma_so_thue || null,
        nguoi_dai_dien || null,
        ghi_chu || null,
        trang_thai || 'con_giao_dich',
        no_dau_ky || 0,
        ngay_chot_no_dau_ky || null,
        ghi_chu_no_dau_ky || null,
        req.user.ten_dang_nhap
      ]
    );

    const insertedId = result.insertId;
    const [newRow] = await connection.query('SELECT * FROM khach_hang WHERE id = ?', [insertedId]);

    // Log the creation
    await logChange(
      connection,
      'khach_hang',
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
    return res.status(500).json({ message: 'Lỗi khi thêm mới khách hàng.' });
  } finally {
    connection.release();
  }
});

// 4. Update Customer
router.put('/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ke_Toan', 'Ban_Giam_Doc']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM khach_hang WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }

    const fields = req.body;
    const updateKeys = [];
    const updateValues = [];

    // Fields allowed to update
    const allowed = [
      'ten_khach_hang',
      'so_dien_thoai',
      'dia_chi',
      'han_muc_tin_dung',
      'so_ngay_no_toi_da',
      'loai_khach_hang',
      'ten_cong_ty',
      'ten_ngan_hang',
      'so_tai_khoan',
      'ma_so_thue',
      'nguoi_dai_dien',
      'ghi_chu',
      'trang_thai',
      'no_dau_ky',
      'ngay_chot_no_dau_ky',
      'ghi_chu_no_dau_ky'
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
        `UPDATE khach_hang SET ${updateKeys.join(', ')} WHERE id = ?`,
        updateValues
      );
    }

    const [newRow] = await connection.query('SELECT * FROM khach_hang WHERE id = ?', [req.params.id]);

    await logChange(
      connection,
      'khach_hang',
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
    return res.status(500).json({ message: 'Lỗi khi cập nhật khách hàng.' });
  } finally {
    connection.release();
  }
});

// 5. Get Unpaid Orders of a Customer
router.get('/:id/unpaid-orders', authMiddleware, async (req, res) => {
  try {
    const [orders] = await pool.query(`
      SELECT d.id, d.ma_don_hang, d.ngay_dat_hang, d.tong_tien,
             COALESCE(d.so_tien_da_thanh_toan, 0) AS da_thanh_toan,
             COALESCE((
               SELECT SUM(pnk.tong_tien) FROM phieu_nhap_kho pnk WHERE pnk.id_don_hang = d.id AND pnk.loai_nhap_kho = 'tra_hang_ban' AND COALESCE(pnk.da_xoa, 0) = 0
             ), 0) AS da_tra_hang,
             (d.tong_tien - COALESCE(d.so_tien_da_thanh_toan, 0) - COALESCE((
               SELECT SUM(pnk.tong_tien) FROM phieu_nhap_kho pnk WHERE pnk.id_don_hang = d.id AND pnk.loai_nhap_kho = 'tra_hang_ban' AND COALESCE(pnk.da_xoa, 0) = 0
             ), 0)) AS con_lai,
             d.trang_thai_thanh_toan, d.trang_thai_don_hang,
             l.ten_lvkd, l.ma_lvkd
      FROM don_hang d
      LEFT JOIN linh_vuc_kinh_doanh l ON d.id_lvkd = l.id
      WHERE d.id_khach_hang = ?
        AND (d.tong_tien - COALESCE(d.so_tien_da_thanh_toan, 0) - COALESCE((
               SELECT SUM(pnk.tong_tien) FROM phieu_nhap_kho pnk WHERE pnk.id_don_hang = d.id AND pnk.loai_nhap_kho = 'tra_hang_ban' AND COALESCE(pnk.da_xoa, 0) = 0
             ), 0)) > 0
        AND d.trang_thai_don_hang != 'Đã hủy'
      ORDER BY d.ngay_dat_hang ASC, d.id ASC
    `, [req.params.id]);

    return res.json(orders);
  } catch (err) {
    console.error('Error fetching unpaid orders:', err);
    return res.status(500).json({ message: 'Lỗi khi tải danh sách đơn hàng còn nợ: ' + err.message });
  }
});

// 6. Collect Debt / Pay Debt with FIFO or Specific Order Allocation
router.post('/:id/thu-no', authMiddleware, authorize(['Kinh_Doanh', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const id_khach_hang = req.params.id;
    const {
      so_tien_thu,
      ngay_thu,
      hinh_thuc_thanh_toan, // 'Tien_Mat' | 'Chuyen_Khoan'
      id_quy_tien,
      kieu_gach_no, // 'fifo' | 'dich_danh'
      danh_sach_gach_no, // array of { id_don_hang, so_tien }
      ghi_chu
    } = req.body;

    const amount = parseFloat(so_tien_thu);
    if (isNaN(amount) || amount <= 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({ message: 'Số tiền thu nợ phải lớn hơn 0.' });
    }

    const [custRows] = await connection.query('SELECT * FROM khach_hang WHERE id = ?', [id_khach_hang]);
    if (custRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }
    const cust = custRows[0];

    const receiptDate = ngay_thu || new Date();
    const currentYear = new Date(receiptDate).getFullYear();
    const lvkdId = 1;

    let maLvkd = 'VLXD';
    const [lvkdRows] = await connection.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [lvkdId]);
    if (lvkdRows.length > 0 && lvkdRows[0].ma_lvkd) {
      maLvkd = lvkdRows[0].ma_lvkd.trim().toUpperCase();
    }

    const seq = await generateSequenceNumber(connection, {
      id_linh_vuc_kinh_doanh: lvkdId,
      loai_chung_tu: 'PT',
      nam: currentYear,
      ma_lvkd: maLvkd
    });

    const lyDoThu = ghi_chu && ghi_chu.trim() ? ghi_chu.trim() : `Thu tiền công nợ khách hàng ${cust.ten_khach_hang}`;

    // 1. Create phieu_thu_chi
    const [ptcResult] = await connection.query(
      `INSERT INTO phieu_thu_chi (
        ma_phieu, so_vao_so, nam, id_linh_vuc_kinh_doanh, loai_phieu, loai_thu_chi,
        loai_doi_tuong, id_doi_tuong, ten_doi_tuong, dia_chi_doi_tuong, sdt_doi_tuong,
        id_quy_tien, hinh_thuc_thanh_toan, so_tien, ngay_chung_tu, nguoi_nop_nhan,
        ly_do_thu_chi, trang_thai, ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, 'Phieu_Thu', 'thu_cong_no_kh', 'Khach_Hang', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Da_Duyet', ?, ?)`,
      [
        seq.ma_phieu,
        seq.so_vao_so,
        currentYear,
        lvkdId,
        id_khach_hang,
        cust.ten_khach_hang,
        cust.dia_chi || null,
        cust.so_dien_thoai || null,
        id_quy_tien || 1,
        hinh_thuc_thanh_toan || 'Tien_Mat',
        amount,
        receiptDate,
        cust.nguoi_dai_dien || cust.ten_khach_hang,
        lyDoThu,
        ghi_chu || null,
        req.user?.ten_dang_nhap || 'system'
      ]
    );

    // 2. Create thanh_toan_khach_hang
    const [ttkhResult] = await connection.query(
      `INSERT INTO thanh_toan_khach_hang (
        id_khach_hang, so_tien_nhan, ngay_thanh_toan, hinh_thuc_thanh_toan, ghi_chu, nguoi_tao
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id_khach_hang,
        amount,
        receiptDate,
        hinh_thuc_thanh_toan || 'Tien_Mat',
        `${seq.ma_phieu} - ${lyDoThu}`,
        req.user?.ten_dang_nhap || 'system'
      ]
    );
    const id_thanh_toan_khach_hang = ttkhResult.insertId;

    // 3. Process Debt Deductions
    const allocatedDeductions = [];

    if (kieu_gach_no === 'dich_danh' && Array.isArray(danh_sach_gach_no) && danh_sach_gach_no.length > 0) {
      for (const item of danh_sach_gach_no) {
        const deductAmount = parseFloat(item.so_tien) || 0;
        if (deductAmount <= 0) continue;

        const [ordRows] = await connection.query('SELECT * FROM don_hang WHERE id = ?', [item.id_don_hang]);
        if (ordRows.length > 0) {
          const oldOrder = ordRows[0];
          const totalOrd = parseFloat(oldOrder.tong_tien) || 0;
          const currentPaid = parseFloat(oldOrder.so_tien_da_thanh_toan) || 0;
          const newPaid = currentPaid + deductAmount;
          const remaining = Math.max(0, totalOrd - newPaid);
          const payStatus = newPaid >= totalOrd ? 'đã thanh toán' : 'thanh toán một phần';

          await connection.query(
            'UPDATE don_hang SET so_tien_da_thanh_toan = ?, so_tien_con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?',
            [newPaid, remaining, payStatus, item.id_don_hang]
          );

          const [newOrderRow] = await connection.query('SELECT * FROM don_hang WHERE id = ?', [item.id_don_hang]);
          await logChange(connection, 'don_hang', item.id_don_hang, 'CAP_NHAT', oldOrder, newOrderRow[0], req.user?.ten_dang_nhap || 'system');

          await connection.query(
            `INSERT INTO chi_tiet_gach_no (id_thanh_toan_khach_hang, id_don_hang, so_tien_khau_tru, nguoi_tao)
             VALUES (?, ?, ?, ?)`,
            [id_thanh_toan_khach_hang, item.id_don_hang, deductAmount, req.user?.ten_dang_nhap || 'system']
          );

          allocatedDeductions.push({ id_don_hang: item.id_don_hang, so_tien: deductAmount });
        }
      }
    } else {
      // FIFO
      let remainToAllocate = amount;
      const [unpaidOrders] = await connection.query(`
        SELECT id, tong_tien, COALESCE(so_tien_da_thanh_toan, 0) AS da_thanh_toan
        FROM don_hang
        WHERE id_khach_hang = ?
          AND (tong_tien - COALESCE(so_tien_da_thanh_toan, 0)) > 0
          AND trang_thai_don_hang != 'Đã hủy'
        ORDER BY ngay_dat_hang ASC, id ASC
      `, [id_khach_hang]);

      for (const ord of unpaidOrders) {
        if (remainToAllocate <= 0) break;

        const [oldOrdRows] = await connection.query('SELECT * FROM don_hang WHERE id = ?', [ord.id]);
        const oldOrder = oldOrdRows[0];
        const totalOrd = parseFloat(oldOrder?.tong_tien || ord.tong_tien) || 0;
        const currentPaid = parseFloat(oldOrder?.so_tien_da_thanh_toan || ord.da_thanh_toan) || 0;
        const debtThisOrder = totalOrd - currentPaid;

        const deduct = Math.min(remainToAllocate, debtThisOrder);
        const newPaid = currentPaid + deduct;
        const remaining = Math.max(0, totalOrd - newPaid);
        const payStatus = newPaid >= totalOrd ? 'đã thanh toán' : 'thanh toán một phần';

        await connection.query(
          'UPDATE don_hang SET so_tien_da_thanh_toan = ?, so_tien_con_lai = ?, trang_thai_thanh_toan = ? WHERE id = ?',
          [newPaid, remaining, payStatus, ord.id]
        );

        const [newOrderRow] = await connection.query('SELECT * FROM don_hang WHERE id = ?', [ord.id]);
        await logChange(connection, 'don_hang', ord.id, 'CAP_NHAT', oldOrder, newOrderRow[0], req.user?.ten_dang_nhap || 'system');

        await connection.query(
          `INSERT INTO chi_tiet_gach_no (id_thanh_toan_khach_hang, id_don_hang, so_tien_khau_tru, nguoi_tao)
           VALUES (?, ?, ?, ?)`,
          [id_thanh_toan_khach_hang, ord.id, deduct, req.user?.ten_dang_nhap || 'system']
        );

        allocatedDeductions.push({ id_don_hang: ord.id, so_tien: deduct });
        remainToAllocate -= deduct;
      }
    }

    await logChange(
      connection,
      'thanh_toan_khach_hang',
      id_thanh_toan_khach_hang,
      'THEM_MOI',
      null,
      { id: id_thanh_toan_khach_hang, id_khach_hang, so_tien: amount, ma_phieu: seq.ma_phieu, deductions: allocatedDeductions },
      req.user?.ten_dang_nhap || 'system'
    );

    await connection.commit();
    return res.status(201).json({
      message: `Lập Phiếu Thu ${seq.ma_phieu} và gạch nợ thành công!`,
      ma_phieu: seq.ma_phieu,
      so_tien: amount,
      allocatedDeductions
    });
  } catch (err) {
    await connection.rollback();
    console.error('Error processing debt collection:', err);
    return res.status(500).json({ message: 'Lỗi khi thu tiền nợ khách hàng: ' + err.message });
  } finally {
    connection.release();
  }
});

// 7. Get Customer Ledger (Sổ chi tiết công nợ)
router.get('/:id/so-chi-tiet-cong-no', authMiddleware, async (req, res) => {
  try {
    const id_khach_hang = req.params.id;
    const { tu_ngay, den_ngay } = req.query;

    const [custRows] = await pool.query('SELECT * FROM khach_hang WHERE id = ?', [id_khach_hang]);
    if (custRows.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }
    const customer = custRows[0];

    const startDate = tu_ngay ? new Date(tu_ngay) : new Date(new Date().getFullYear(), 0, 1);
    const endDate = den_ngay ? new Date(den_ngay + ' 23:59:59') : new Date();

    const noDauKyInit = parseFloat(customer.no_dau_ky) || 0;

    // Debt before tu_ngay
    let [ordersBefore] = await pool.query(`
      SELECT COALESCE(SUM(tong_tien), 0) AS total
      FROM don_hang
      WHERE id_khach_hang = ?
        AND ngay_dat_hang < ?
        AND trang_thai_don_hang != 'Đã hủy'
    `, [id_khach_hang, startDate]);

    let [returnsBefore] = await pool.query(`
      SELECT COALESCE(SUM(pnk.tong_tien), 0) AS total
      FROM phieu_nhap_kho pnk
      LEFT JOIN don_hang dh ON pnk.id_don_hang = dh.id
      WHERE COALESCE(pnk.id_khach_hang, dh.id_khach_hang) = ?
        AND pnk.loai_nhap_kho = 'tra_hang_ban'
        AND COALESCE(pnk.da_xoa, 0) = 0
        AND COALESCE(pnk.thoi_gian_nhap, pnk.thoi_gian_tao) < ?
    `, [id_khach_hang, startDate]);

    let [receiptsBefore] = await pool.query(`
      SELECT COALESCE(SUM(so_tien), 0) AS total
      FROM phieu_thu_chi
      WHERE (loai_doi_tuong = 'Khach_Hang' OR loai_doi_tuong = 'khach_hang')
        AND id_doi_tuong = ?
        AND loai_phieu = 'Phieu_Thu'
        AND (da_xoa = 0 OR da_xoa IS NULL)
        AND ngay_chung_tu < ?
    `, [id_khach_hang, startDate]);

    const openingBalance = noDauKyInit + (parseFloat(ordersBefore[0].total) || 0) - (parseFloat(returnsBefore[0].total) || 0) - (parseFloat(receiptsBefore[0].total) || 0);

    // Transactions during period
    const [ordersDuring] = await pool.query(`
      SELECT id, ma_don_hang AS ma_chung_tu, ngay_dat_hang AS ngay_chung_tu,
             'Mua hàng VLXD' AS dien_giai, tong_tien AS phat_sinh_tang, 0 AS phat_sinh_giam,
             'don_hang' AS loai_giao_dich
      FROM don_hang
      WHERE id_khach_hang = ?
        AND ngay_dat_hang >= ? AND ngay_dat_hang <= ?
        AND trang_thai_don_hang != 'Đã hủy'
    `, [id_khach_hang, startDate, endDate]);

    const [returnsDuring] = await pool.query(`
      SELECT pnk.id, pnk.ma_phieu AS ma_chung_tu,
             COALESCE(pnk.thoi_gian_nhap, pnk.thoi_gian_tao) AS ngay_chung_tu,
             COALESCE(pnk.ghi_chu, CONCAT('Khách trả lại hàng theo đơn ', COALESCE(dh.ma_don_hang, ''))) AS dien_giai,
             0 AS phat_sinh_tang, pnk.tong_tien AS phat_sinh_giam,
             'tra_hang_ban' AS loai_giao_dich
      FROM phieu_nhap_kho pnk
      LEFT JOIN don_hang dh ON pnk.id_don_hang = dh.id
      WHERE COALESCE(pnk.id_khach_hang, dh.id_khach_hang) = ?
        AND pnk.loai_nhap_kho = 'tra_hang_ban'
        AND COALESCE(pnk.da_xoa, 0) = 0
        AND COALESCE(pnk.thoi_gian_nhap, pnk.thoi_gian_tao) >= ?
        AND COALESCE(pnk.thoi_gian_nhap, pnk.thoi_gian_tao) <= ?
    `, [id_khach_hang, startDate, endDate]);

    const [receiptsDuring] = await pool.query(`
      SELECT id, ma_phieu AS ma_chung_tu, ngay_chung_tu,
             COALESCE(ly_do_thu_chi, 'Thu tiền nợ') AS dien_giai,
             0 AS phat_sinh_tang, so_tien AS phat_sinh_giam,
             'phieu_thu' AS loai_giao_dich
      FROM phieu_thu_chi
      WHERE (loai_doi_tuong = 'Khach_Hang' OR loai_doi_tuong = 'khach_hang')
        AND id_doi_tuong = ?
        AND loai_phieu = 'Phieu_Thu'
        AND (da_xoa = 0 OR da_xoa IS NULL)
        AND ngay_chung_tu >= ? AND ngay_chung_tu <= ?
    `, [id_khach_hang, startDate, endDate]);

    const allTransactions = [...ordersDuring, ...returnsDuring, ...receiptsDuring].sort((a, b) => new Date(a.ngay_chung_tu) - new Date(b.ngay_chung_tu));

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
      customer,
      tu_ngay: startDate.toISOString().split('T')[0],
      den_ngay: endDate.toISOString().split('T')[0],
      so_du_dau_ky: openingBalance,
      tong_phat_sinh_tang: totalTang,
      tong_phat_sinh_giam: totalGiam,
      so_du_cuoi_ky: runningBalance,
      transactions: transactionRows
    });
  } catch (err) {
    console.error('Error fetching customer ledger:', err);
    return res.status(500).json({ message: 'Lỗi khi tải sổ chi tiết công nợ: ' + err.message });
  }
});

// Delete Customer (Soft Delete da_xoa = 1 with integrity check)
router.delete('/:id', authMiddleware, authorize(['Kinh_Doanh', 'Ke_Toan', 'Ban_Giam_Doc', 'Admin']), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM khach_hang WHERE id = ?', [req.params.id]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }

    // Check all related records across the system
    const [dhRows] = await connection.query('SELECT COUNT(*) as count FROM don_hang WHERE id_khach_hang = ?', [req.params.id]);
    const [hdRows] = await connection.query('SELECT COUNT(*) as count FROM hop_dong WHERE id_khach_hang = ? AND da_xoa = 0', [req.params.id]);
    const [ctRows] = await connection.query('SELECT COUNT(*) as count FROM cong_trinh WHERE id_khach_hang = ? AND (da_xoa = 0 OR da_xoa IS NULL)', [req.params.id]);
    const [ttRows] = await connection.query('SELECT COUNT(*) as count FROM thanh_toan_khach_hang WHERE id_khach_hang = ?', [req.params.id]);
    const [pxRows] = await connection.query('SELECT COUNT(*) as count FROM phieu_xuat_kho WHERE id_khach_hang = ?', [req.params.id]);
    const [pnRows] = await connection.query('SELECT COUNT(*) as count FROM phieu_nhap_kho WHERE id_khach_hang = ?', [req.params.id]);

    const details = [];
    if (dhRows[0]?.count > 0) details.push(`${dhRows[0].count} đơn hàng`);
    if (hdRows[0]?.count > 0) details.push(`${hdRows[0].count} hợp đồng`);
    if (ctRows[0]?.count > 0) details.push(`${ctRows[0].count} công trình`);
    if (ttRows[0]?.count > 0) details.push(`${ttRows[0].count} chứng từ thanh toán`);
    if (pxRows[0]?.count > 0) details.push(`${pxRows[0].count} phiếu xuất kho`);
    if (pnRows[0]?.count > 0) details.push(`${pnRows[0].count} phiếu nhập kho`);

    if (details.length > 0) {
      connection.release();
      return res.status(400).json({
        hasRelatedData: true,
        relatedDetails: details,
        message: `Không được xóa khách hàng này do đã phát sinh dữ liệu liên quan (${details.join(', ')}). Đề xuất chuyển trạng thái khách hàng sang "Không còn giao dịch".`
      });
    }

    // Soft delete: set da_xoa = 1
    await connection.query('UPDATE khach_hang SET da_xoa = 1 WHERE id = ?', [req.params.id]);

    await logChange(
      connection,
      'khach_hang',
      req.params.id,
      'XOA',
      oldRow[0],
      { ...oldRow[0], da_xoa: 1 },
      req.user.ten_dang_nhap
    );

    await connection.commit();
    return res.json({ message: 'Đã xóa khách hàng thành công.' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xóa khách hàng: ' + err.message });
  } finally {
    connection.release();
  }
});

// 5. Get Override Credit Limit Requests
router.get('/duyet-vuot-han-muc/danh-sach', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.*, k.ten_khach_hang, k.han_muc_tin_dung
       FROM duyet_vuot_han_muc d
       JOIN khach_hang k ON d.id_khach_hang = k.id
       ORDER BY d.id DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi truy vấn danh sách yêu cầu vượt hạn mức.' });
  }
});

// 6. Request Override Credit Limit (Called by Sales/POS)
router.post('/duyet-vuot-han-muc/yeu-cau', authMiddleware, authorize(['Kinh_Doanh']), async (req, res) => {
  const { id_khach_hang, so_tien_yeu_cau } = req.body;
  if (!id_khach_hang || !so_tien_yeu_cau) {
    return res.status(400).json({ message: 'Thiếu thông tin khách hàng hoặc số tiền yêu cầu.' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO duyet_vuot_han_muc (id_khach_hang, so_tien_yeu_cau, trang_thai_duyet, ngay_yeu_cau, nguoi_tao)
       VALUES (?, ?, 'Cho_Duyet', NOW(), ?)`,
      [id_khach_hang, so_tien_yeu_cau, req.user.ten_dang_nhap]
    );

    return res.status(201).json({
      message: 'Đã gửi yêu cầu phê duyệt vượt hạn mức tới Giám đốc.',
      id: result.insertId
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi gửi yêu cầu vượt hạn mức.' });
  }
});

// 7. Approve/Reject Override Credit Limit (Director only)
router.post('/duyet-vuot-han-muc/:id/phe-duyet', authMiddleware, authorize(['Ban_Giam_Doc']), async (req, res) => {
  const { trang_thai_duyet } = req.body; // 'Da_Duyet' or 'Tu_Choi'

  if (!['Da_Duyet', 'Tu_Choi'].includes(trang_thai_duyet)) {
    return res.status(400).json({ message: 'Trạng thái phê duyệt không hợp lệ.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [oldRow] = await connection.query('SELECT * FROM duyet_vuot_han_muc WHERE id = ?', [
      req.params.id
    ]);
    if (oldRow.length === 0) {
      connection.release();
      return res.status(404).json({ message: 'Không tìm thấy yêu cầu phê duyệt.' });
    }

    await connection.query(
      `UPDATE duyet_vuot_han_muc 
       SET trang_thai_duyet = ?, ngay_duyet = NOW(), nguoi_duyet = ? 
       WHERE id = ?`,
      [trang_thai_duyet, req.user.ten_dang_nhap, req.params.id]
    );

    const [newRow] = await connection.query('SELECT * FROM duyet_vuot_han_muc WHERE id = ?', [
      req.params.id
    ]);

    await logChange(
      connection,
      'duyet_vuot_han_muc',
      req.params.id,
      'CAP_NHAT',
      oldRow[0],
      newRow[0],
      req.user.ten_dang_nhap
    );

    await connection.commit();
    return res.json({
      message: trang_thai_duyet === 'Da_Duyet' ? 'Đã phê duyệt vượt hạn mức.' : 'Đã từ chối phê duyệt vượt hạn mức.',
      data: newRow[0]
    });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    return res.status(500).json({ message: 'Lỗi khi xử lý phê duyệt hạn mức.' });
  } finally {
    connection.release();
  }
});

module.exports = {
  router,
  getCustomerDebtInfo
};
