const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { getCustomerDebtInfo } = require('./khach_hang');
const { VNDToWords } = require('../utils/numberToWords');

// ========================================================
// 1. THEO DÕI CÔNG TRÌNH (DRILL-DOWN ĐA TẦNG DẠNG CÂY)
// ========================================================
router.get('/project-tree/:id', authMiddleware, async (req, res) => {
  const id_cong_trinh = req.params.id;

  try {
    const [projectRow] = await pool.query('SELECT * FROM cong_trinh WHERE id = ?', [id_cong_trinh]);
    if (projectRow.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy công trình.' });
    }
    const project = projectRow[0];

    // Node 1: Guarantees
    const [guarantees] = await pool.query('SELECT * FROM hop_dong WHERE id_cong_trinh = ?', [id_cong_trinh]);

    // Node 2: Owner Payments
    const [payments] = await pool.query('SELECT * FROM thanh_toan_cong_trinh WHERE id_cong_trinh = ?', [id_cong_trinh]);
    const totalPayments = payments.reduce((sum, p) => sum + parseFloat(p.so_tien_thanh_toan), 0);

    // Node 3: Consumed Materials (Actual quantities Xuat_Kho_Cong_Trinh - Thu_Hoi_Thua)
    const [materials] = await pool.query(
      `SELECT n.id, n.ngay_thuc_hien, n.so_luong, n.don_gia, n.loai_giao_dich,
              v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh, ncc.ten_nha_cung_cap
       FROM nhat_ky_kho n
       JOIN danh_muc_vat_tu v ON n.id_danh_muc_vat_tu = v.id
       LEFT JOIN nha_cung_cap ncc ON n.id_nha_cung_cap = ncc.id
       WHERE (n.id_kho_hang_dich IN (SELECT id FROM kho_hang WHERE id_cong_trinh = ?) OR n.id_kho_hang_nguon IN (SELECT id FROM kho_hang WHERE id_cong_trinh = ?))
         AND n.trang_thai = 'Da_Nghiem_Thu'`,
      [id_cong_trinh, id_cong_trinh]
    );

    let actualMaterialCost = 0;
    const materialSummary = {};
    for (const m of materials) {
      const qty = parseFloat(m.so_luong);
      const price = parseFloat(m.don_gia);
      const isReturn = m.loai_giao_dich === 'Thu_Hoi_Thua';
      const factor = isReturn ? -1 : 1;

      actualMaterialCost += factor * qty * price;

      if (!materialSummary[m.ma_vat_tu]) {
        materialSummary[m.ma_vat_tu] = {
          ma_vat_tu: m.ma_vat_tu,
          ten_vat_tu: m.ten_vat_tu,
          don_vi_tinh: m.don_vi_tinh,
          so_luong: 0,
          thanh_tien: 0
        };
      }
      materialSummary[m.ma_vat_tu].so_luong += factor * qty;
      materialSummary[m.ma_vat_tu].thanh_tien += factor * qty * price;
    }

    // Node 4: Labor Contracts
    const [labor] = await pool.query(
      `SELECT h.*, nc.ho_ten, nc.so_dien_thoai 
       FROM hop_dong_nhan_cong h
       JOIN nhan_cong nc ON h.id_nhan_cong = nc.id
       WHERE h.id_cong_trinh = ?`,
      [id_cong_trinh]
    );
    const totalLabor = labor.reduce((sum, l) => sum + parseFloat(l.gia_tri_hop_dong), 0);

    // Node 5: Subcontractors
    const [subcontractors] = await pool.query('SELECT * FROM nha_thau_phu WHERE id_cong_trinh = ?', [id_cong_trinh]);
    const totalSubcontractor = subcontractors.reduce((sum, s) => sum + parseFloat(s.gia_tri_hop_dong), 0);

    // Node 6: Machinery Rentals
    const [machinery] = await pool.query('SELECT * FROM ca_may_thue WHERE id_cong_trinh = ?', [id_cong_trinh]);
    const totalMachinery = machinery.reduce((sum, m) => sum + parseFloat(m.tong_tien), 0);

    // Node 7: Other Expenses
    const [otherExpenses] = await pool.query(
      `SELECT t.*, k.ten_chi_phi_khac_theo_ctr, d.ten_chi_phi, t.so_tien_thanh_toan as so_tien, t.ngay_thanh_toan as ngay_giao_dich
       FROM ctr_chi_phi_khac_thanh_toan t
       JOIN ctr_chi_phi_khac k ON t.id_ctr_chi_phi_khac = k.id
       LEFT JOIN danh_muc_chi_phi_khac d ON k.id_danh_muc_chi_phi_khac = d.id
       WHERE k.id_cong_trinh = ?`,
      [id_cong_trinh]
    );
    const totalOther = otherExpenses.reduce((sum, o) => sum + parseFloat(o.so_tien_thanh_toan || o.so_tien || 0), 0);

    return res.json({
      project,
      tree: {
        bao_lanh: guarantees[0] || null,
        chu_dau_tu: {
          tong: totalPayments,
          danh_sach: payments
        },
        vat_tu: {
          tong: actualMaterialCost,
          danh_sach: Object.values(materialSummary),
          nhat_ky_giao_dich: materials
        },
        nhan_cong: {
          tong: totalLabor,
          danh_sach: labor
        },
        nha_thau_phu: {
          tong: totalSubcontractor,
          danh_sach: subcontractors
        },
        ca_may: {
          tong: totalMachinery,
          danh_sach: machinery
        },
        chi_phi_khac: {
          tong: totalOther,
          danh_sach: otherExpenses
        }
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi tạo cây chi phí tài chính công trình.' });
  }
});

// ========================================================
// 2. ĐỐI CHIẾU CÔNG NỢ KHÁCH HÀNG (MẪU BA VŨ)
// ========================================================
router.get('/customer-reconciliation/:id_khach_hang', authMiddleware, async (req, res) => {
  const id_khach_hang = req.params.id_khach_hang;
  const { tu_ngay, den_ngay } = req.query;

  if (!tu_ngay || !den_ngay) {
    return res.status(400).json({ message: 'Vui lòng cung cấp ngày bắt đầu và kết thúc.' });
  }

  try {
    const [customerRow] = await pool.query('SELECT * FROM khach_hang WHERE id = ?', [id_khach_hang]);
    if (customerRow.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy khách hàng.' });
    }
    const customer = customerRow[0];

    // Calculate beginning balance (nợ đầu kỳ)
    // Orders before tu_ngay - Payments before tu_ngay
    const [oldOrders] = await pool.query(
      'SELECT SUM(tong_tien) as total FROM don_hang WHERE id_khach_hang = ? AND ngay_dat_hang < ?',
      [id_khach_hang, tu_ngay]
    );
    const [oldPayments] = await pool.query(
      'SELECT SUM(so_tien_nhan) as total FROM thanh_toan_khach_hang WHERE id_khach_hang = ? AND ngay_thanh_toan < ?',
      [id_khach_hang, tu_ngay]
    );

    const oldOrderSum = parseFloat(oldOrders[0].total) || 0;
    const oldPaymentSum = parseFloat(oldPayments[0].total) || 0;
    const beginningDebt = oldOrderSum - oldPaymentSum;

    // Retrieve order list in period
    const [orders] = await pool.query(
      `SELECT d.*, c.ten_cong_trinh 
       FROM don_hang d
       LEFT JOIN cong_trinh c ON d.id_cong_trinh = c.id
       WHERE d.id_khach_hang = ? AND d.ngay_dat_hang BETWEEN ? AND ?
       ORDER BY d.ngay_dat_hang ASC`,
      [id_khach_hang, tu_ngay, den_ngay]
    );

    const orderDetails = [];
    let periodSales = 0;

    for (const ord of orders) {
      const [items] = await pool.query(
        `SELECT c.*, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh 
         FROM chi_tiet_don_hang c
         JOIN danh_muc_vat_tu v ON c.id_danh_muc_vat_tu = v.id
         WHERE c.id_don_hang = ?`,
        [ord.id]
      );
      periodSales += parseFloat(ord.tong_tien);
      orderDetails.push({
        order: ord,
        items
      });
    }

    // Retrieve payment list in period
    const [payments] = await pool.query(
      `SELECT * FROM thanh_toan_khach_hang 
       WHERE id_khach_hang = ? AND ngay_thanh_toan BETWEEN ? AND ?
       ORDER BY ngay_thanh_toan ASC`,
      [id_khach_hang, tu_ngay, den_ngay]
    );
    const periodPayments = payments.reduce((sum, p) => sum + parseFloat(p.so_tien_nhan), 0);

    const endingDebt = beginningDebt + periodSales - periodPayments;
    const endingDebtWords = VNDToWords(endingDebt);

    return res.json({
      customer,
      loc_tu_ngay: tu_ngay,
      loc_den_ngay: den_ngay,
      no_dau_ky: beginningDebt,
      phat_sinh_mua: orderDetails,
      tong_mua_trong_ky: periodSales,
      phat_sinh_thanh_toan: payments,
      tong_thanh_toan_trong_ky: periodPayments,
      no_cuoi_ky: endingDebt,
      no_cuoi_ky_bang_chu: endingDebtWords
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi trích xuất đối chiếu công nợ.' });
  }
});

// ========================================================
// 3. SO SÁNH DỰ TOÁN VÀ THỰC TẾ (MẪU B - 10 CỘT VARIANCE)
// ========================================================
router.get('/variance/:id_cong_trinh', authMiddleware, async (req, res) => {
  const id_cong_trinh = req.params.id_cong_trinh;

  try {
    // 1. Get BOQ items
    const [boqRows] = await pool.query('SELECT * FROM du_toan_boq WHERE id_cong_trinh = ?', [id_cong_trinh]);

    // 2. Fetch actual material consumption
    // Xuat_Kho_Cong_Trinh (trang_thai = 'Da_Nghiem_Thu') minus Thu_Hoi_Thua
    const [actualMats] = await pool.query(
      `SELECT n.id_danh_muc_vat_tu, v.ma_vat_tu, v.ten_vat_tu, v.don_vi_tinh,
              SUM(CASE WHEN n.loai_giao_dich = 'Xuat_Kho_Cong_Trinh' THEN n.so_luong ELSE 0 END) as qty_out,
              SUM(CASE WHEN n.loai_giao_dich = 'Thu_Hoi_Thua' THEN n.so_luong ELSE 0 END) as qty_return,
              MAX(n.don_gia) as max_price
       FROM nhat_ky_kho n
       JOIN danh_muc_vat_tu v ON n.id_danh_muc_vat_tu = v.id
       WHERE (n.id_kho_hang_dich IN (SELECT id FROM kho_hang WHERE id_cong_trinh = ?) OR n.id_kho_hang_nguon IN (SELECT id FROM kho_hang WHERE id_cong_trinh = ?))
         AND n.trang_thai = 'Da_Nghiem_Thu'
       GROUP BY n.id_danh_muc_vat_tu`,
      [id_cong_trinh, id_cong_trinh]
    );

    // Map actuals to key
    const actualMap = {};
    for (const am of actualMats) {
      actualMap[am.ma_vat_tu] = {
        qty: parseFloat(am.qty_out) - parseFloat(am.qty_return),
        price: parseFloat(am.max_price) || 0
      };
    }

    // Build comparison lines
    const comparison = [];
    let idx = 1;

    for (const b of boqRows) {
      let kl_thuc_te = 0;
      let dg_thuc_te = 0;

      if (b.phan_loai === 'Vat_Tu') {
        const matMatch = actualMap[b.ma_hang_muc];
        if (matMatch) {
          kl_thuc_te = matMatch.qty;
          dg_thuc_te = matMatch.price;
        }
      } else if (b.phan_loai === 'Nhan_Cong') {
        // Query actual payroll / payments for labor contract matching this category
        const [labRows] = await pool.query(
          `SELECT SUM(da_thanh_toan) as total FROM hop_dong_nhan_cong WHERE id_cong_trinh = ?`,
          [id_cong_trinh]
        );
        kl_thuc_te = 1.0;
        dg_thuc_te = parseFloat(labRows[0].total) || 0;
      } else if (b.phan_loai === 'Ca_May') {
        // Query actual ca_may sum
        const [machRows] = await pool.query(
          `SELECT SUM(tong_tien) as total FROM ca_may_thue WHERE id_cong_trinh = ? AND ten_may LIKE ?`,
          [id_cong_trinh, `%${b.ten_hang_muc}%`]
        );
        kl_thuc_te = 1.0;
        dg_thuc_te = parseFloat(machRows[0].total) || 0;
      } else if (b.phan_loai === 'Chi_Phi_Khac') {
        // Query actual other expenses matching the category ID from ctr_chi_phi_khac_thanh_toan
        const [otherRows] = await pool.query(
          `SELECT SUM(t.so_tien_thanh_toan) as total 
           FROM ctr_chi_phi_khac_thanh_toan t
           JOIN ctr_chi_phi_khac k ON t.id_ctr_chi_phi_khac = k.id
           WHERE k.id_cong_trinh = ? AND k.id_danh_muc_chi_phi_khac = ?`,
          [id_cong_trinh, b.id_danh_muc_chi_phi_khac]
        );
        kl_thuc_te = 1.0;
        dg_thuc_te = parseFloat(otherRows[0]?.total) || 0;
      }

      const kl_du_toan = parseFloat(b.so_luong_du_toan);
      const dg_du_toan = parseFloat(b.don_gia_du_toan);
      const tt_du_toan = kl_du_toan * dg_du_toan;
      const tt_thuc_te = kl_thuc_te * dg_thuc_te;
      const chenh_lech = tt_du_toan - tt_thuc_te; // positive is savings, negative is over-budget

      // Traffic light logic (Xanh lá < 90%, Vàng 90%-100%, Đỏ > 100%)
      const ratio = tt_du_toan > 0 ? (tt_thuc_te / tt_du_toan) * 100 : 0;
      let status = 'Xanh'; // Green
      if (ratio >= 90 && ratio <= 100) {
        status = 'Vang'; // Yellow
      } else if (ratio > 100) {
        status = 'Do'; // Red
      }

      comparison.push({
        stt: idx++,
        ten: b.ten_hang_muc,
        dvt: b.don_vi_tinh,
        kl_du_toan,
        kl_thuc_te,
        dg_du_toan,
        dg_thuc_te,
        tt_du_toan,
        tt_thuc_te,
        chenh_lech,
        status,
        ti_le: ratio
      });
    }

    return res.json(comparison);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi trích xuất báo cáo chênh lệch dự toán.' });
  }
});

// ========================================================
// 4. BẢNG KÊ CHI TIẾT VẬT TƯ CÔNG TRÌNH (MẪU C)
// ========================================================
router.get('/material-details/:id_cong_trinh', authMiddleware, async (req, res) => {
  const id_cong_trinh = req.params.id_cong_trinh;

  try {
    const [projectRow] = await pool.query('SELECT * FROM cong_trinh WHERE id = ?', [id_cong_trinh]);
    if (projectRow.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy công trình.' });
    }

    // Query dispatches
    const [rows] = await pool.query(
      `SELECT n.id, DATE(n.ngay_thuc_hien) as ngay_giao, n.so_chung_tu,
              ncc.ten_nha_cung_cap, v.ten_vat_tu, v.don_vi_tinh,
              n.so_luong, n.don_gia, (n.so_luong * n.don_gia) as thanh_tien
       FROM nhat_ky_kho n
       JOIN danh_muc_vat_tu v ON n.id_danh_muc_vat_tu = v.id
       LEFT JOIN nha_cung_cap ncc ON n.id_nha_cung_cap = ncc.id
       WHERE n.id_kho_hang_dich IN (SELECT id FROM kho_hang WHERE id_cong_trinh = ?)
         AND n.loai_giao_dich = 'Xuat_Kho_Cong_Trinh'
         AND n.trang_thai = 'Da_Nghiem_Thu'
       ORDER BY n.ngay_thuc_hien ASC`,
      [id_cong_trinh]
    );

    // Group by Date
    const grouped = {};
    for (const r of rows) {
      const dateStr = new Date(r.ngay_giao).toLocaleDateString('vi-VN');
      if (!grouped[dateStr]) {
        grouped[dateStr] = {
          ngay: dateStr,
          details: [],
          tong_cong: 0
        };
      }
      grouped[dateStr].details.push(r);
      grouped[dateStr].tong_cong += parseFloat(r.thanh_tien);
    }

    return res.json({
      project: projectRow[0],
      grouped: Object.values(grouped)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi trích xuất bảng kê chi tiết vật tư.' });
  }
});

// ========================================================
// 5. PHIẾU THEO DÕI XĂNG DẦU HẰNG NGÀY (MẪU D)
// ========================================================
router.get('/fuel-log', authMiddleware, async (req, res) => {
  const { tu_ngay, den_ngay } = req.query;
  if (!tu_ngay || !den_ngay) {
    return res.status(400).json({ message: 'Vui lòng cung cấp khoảng thời gian.' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT n.*, p.bien_so_xe, p.loai_xe, p.dinh_muc_tieu_hao,
              nc.ho_ten as tai_xe_ten, c.ten_cong_trinh
       FROM nhat_ky_nhien_lieu n
       JOIN phuong_tien p ON n.id_phuong_tien = p.id
       JOIN nhan_cong nc ON n.id_nhan_cong = nc.id
       LEFT JOIN cong_trinh c ON n.id_cong_trinh = c.id
       WHERE n.ngay_ghi_nhan BETWEEN ? AND ?
       ORDER BY n.ngay_ghi_nhan ASC`,
      [tu_ngay, den_ngay]
    );

    const logs = rows.map((r, index) => {
      const lit_bom = parseFloat(r.so_lit_bom) || 0;
      const lit_tieu_hao = parseFloat(r.so_lit_tieu_hao) || 0;
      const distance = parseFloat(r.cu_ly_van_chuyen) || 0;
      const lit_tren_km = distance > 0 ? (lit_tieu_hao / distance).toFixed(2) : '0';

      // Driver reward fee: trips * don_gia_chuyen
      const driverFee = (parseInt(r.so_chuyen_chay) || 0) * (parseFloat(r.don_gia_chuyen) || 0);

      // Remaining fuel calculation (mocked beginning stock = 0 for pure transaction offset in this sheet)
      // Remaining = Bom - Tieu_hao (since it displays liters remaining in tank after trips)
      const lit_con_lai = lit_bom - lit_tieu_hao;

      let detailDesc = '';
      /* if (r.ghi_chu && r.ghi_chu.trim().length > 0) {
        detailDesc = r.ghi_chu;
      } else */ if (r.ten_cong_trinh) {
        detailDesc = `Công trình ${r.ten_cong_trinh} mỗi chuyến đi và về là ${r.cu_ly_mot_chuyen} km * ${r.so_chuyen_chay} chuyến = ${r.cu_ly_van_chuyen} km`;
      } else {
        detailDesc = `Mỗi chuyến đi và về là ${r.cu_ly_mot_chuyen} km * ${r.so_chuyen_chay} chuyến = ${r.cu_ly_van_chuyen} km`;
      }

      return {
        stt: index + 1,
        xe_bien_so: `${r.loai_xe} / ${r.bien_so_xe}`,
        tai_xe: r.tai_xe_ten,
        lit_bom,
        cu_ly: distance,
        lit_tieu_hao,
        lit_con_lai,
        lit_tren_km,
        driver_fee: `${driverFee.toLocaleString()} / Chuyến`,
        driver_fee_raw: driverFee,
        don_gia_chuyen: parseFloat(r.don_gia_chuyen) || 0,
        so_chuyen_chay: parseInt(r.so_chuyen_chay) || 0,
        ghi_chu: r.ghi_chu || '',
        detail_desc: detailDesc
      };
    });

    return res.json({
      khoang_thoi_gian: `Từ ngày ${new Date(tu_ngay).toLocaleDateString('vi-VN')} đến ngày ${new Date(den_ngay).toLocaleDateString('vi-VN')}`,
      logs
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi trích xuất báo cáo xăng dầu.' });
  }
});

// ========================================================
// 6. PHIẾU THANH TOÁN TIỀN NHÂN CÔNG SẢN PHẨM (MẪU E)
// ========================================================
router.get('/piece-rate-wages/:id_nhan_cong', authMiddleware, async (req, res) => {
  const id_nhan_cong = req.params.id_nhan_cong;
  const { tu_ngay, den_ngay, loai_san_pham } = req.query; // 'Gach_Khong_Nung', 'Gach_Via_He', 'Be_Tong', 'Cong'

  if (!tu_ngay || !den_ngay || !loai_san_pham) {
    return res.status(400).json({ message: 'Vui lòng cung cấp khoảng thời gian và loại sản phẩm.' });
  }

  try {
    const [workerRow] = await pool.query('SELECT * FROM nhan_cong WHERE id = ?', [id_nhan_cong]);
    if (workerRow.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy nhân công.' });
    }
    const worker = workerRow[0];

    // Query logs
    const [rows] = await pool.query(
      `SELECT l.*, v.ten_vat_tu, v.ma_vat_tu
       FROM luong_san_pham l
       JOIN danh_muc_vat_tu v ON l.id_danh_muc_vat_tu = v.id
       WHERE l.id_nhan_cong = ? AND l.ngay_thuc_hien BETWEEN ? AND ?
       ORDER BY l.ngay_thuc_hien ASC`,
      [id_nhan_cong, tu_ngay, den_ngay]
    );

    // Sum advances in period
    const [advances] = await pool.query(
      `SELECT SUM(so_tien_tam_ung) as total FROM tam_ung_nhan_cong 
       WHERE id_nhan_cong = ? AND ngay_tam_ung BETWEEN ? AND ?`,
      [id_nhan_cong, tu_ngay, den_ngay]
    );
    const totalAdvances = parseFloat(advances[0].total) || 0;

    let totalEarnings = 0;
    const mappedLogs = rows.map(r => {
      const qty = parseFloat(r.so_luong);
      const rate = parseFloat(r.don_gia_nhan_cong);
      const subtotal = qty * rate;
      totalEarnings += subtotal;

      return {
        ngay: new Date(r.ngay_thuc_hien).toLocaleDateString('vi-VN'),
        ten_hang: r.ten_vat_tu,
        so_luong: qty,
        don_gia: rate,
        thanh_tien: subtotal,
        ghi_chu: r.ghi_chu || ''
      };
    });

    const netPay = totalEarnings - totalAdvances;

    return res.json({
      worker,
      loai_san_pham,
      loc_tu_ngay: tu_ngay,
      loc_den_ngay: den_ngay,
      logs: mappedLogs,
      tong_cong: totalEarnings,
      tam_ung: totalAdvances,
      thuc_nhan: netPay,
      thuc_nhan_bang_chu: VNDToWords(netPay)
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi kết xuất báo cáo lương sản phẩm.' });
  }
});

module.exports = router;
