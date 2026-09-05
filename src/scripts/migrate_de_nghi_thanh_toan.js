const { pool } = require('../config/db');

async function migrateDeNghiThanhToan() {
  const db = await pool.getConnection();
  try {
    console.log('--- Migrating de_nghi_thanh_toan tables ---');

    // 1. Danh mục Loại chứng từ ĐNTT
    await db.query(`
      CREATE TABLE IF NOT EXISTS danh_muc_loai_chung_tu_dntt (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_loai VARCHAR(50) UNIQUE NOT NULL,
        ten_loai VARCHAR(255) NOT NULL,
        mo_ta TEXT NULL,
        thu_tu INT DEFAULT 0,
        trang_thai ENUM('hoat_dong', 'tam_dung') DEFAULT 'hoat_dong',
        nguoi_tao VARCHAR(100) NOT NULL,
        thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Table danh_muc_loai_chung_tu_dntt created/ready');

    // Seed default document types
    const defaultDocTypes = [
      { ma: 'PHIEU_DNTT', ten: 'Phiếu đề nghị thanh toán', mo_ta: 'Bản in phiếu đề nghị thanh toán có chữ ký người lập và phụ trách', thu_tu: 1 },
      { ma: 'HOP_DONG_PO', ten: 'Hợp đồng / Đơn đặt hàng (PO)', mo_ta: 'Hợp đồng kinh tế, phụ lục hoặc Phiếu đặt mua hàng đã ký kết', thu_tu: 2 },
      { ma: 'HOA_DON_VAT', ten: 'Hóa đơn GTGT / Hóa đơn bán lẻ', mo_ta: 'Hóa đơn điện tử, bản sao hóa đơn GTGT hoặc hóa đơn trực tiếp', thu_tu: 3 },
      { ma: 'BBNT', ten: 'Biên bản nghiệm thu / Phiếu giao hàng', mo_ta: 'Biên bản nghiệm thu công việc, khối lượng hoàn thành hoặc phiếu xuất/giao hàng', thu_tu: 4 },
      { ma: 'TAM_UNG_HOAN_UNG', ten: 'Đề nghị tạm ứng / Bảng hoàn ứng', mo_ta: 'Giấy đề nghị tạm ứng kinh phí hoặc Bảng kê thanh toán hoàn ứng', thu_tu: 5 },
      { ma: 'BANG_KE_CHI_PHI', ten: 'Bảng kê chi tiết / Dự toán đính kèm', mo_ta: 'Bảng kê danh mục hàng hóa, bảng chấm công, bảng kê cước xe/chi phí', thu_tu: 6 },
      { ma: 'KHAC', ten: 'Chứng từ & Hồ sơ khác', mo_ta: 'Các tài liệu, chứng từ giải trình bổ sung khác', thu_tu: 7 }
    ];

    for (const dt of defaultDocTypes) {
      const [existing] = await db.query('SELECT id FROM danh_muc_loai_chung_tu_dntt WHERE ma_loai = ?', [dt.ma]);
      if (existing.length === 0) {
        await db.query(
          'INSERT INTO danh_muc_loai_chung_tu_dntt (ma_loai, ten_loai, mo_ta, thu_tu, nguoi_tao) VALUES (?, ?, ?, ?, ?)',
          [dt.ma, dt.ten, dt.mo_ta, dt.thu_tu, 'system']
        );
      }
    }

    // 2. Danh mục Loại chi phí ĐNTT
    await db.query(`
      CREATE TABLE IF NOT EXISTS danh_muc_loai_chi_phi_dntt (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_loai_chi_phi VARCHAR(50) UNIQUE NOT NULL,
        ten_loai_chi_phi VARCHAR(255) NOT NULL,
        mo_ta TEXT NULL,
        thu_tu INT DEFAULT 0,
        trang_thai ENUM('hoat_dong', 'tam_dung') DEFAULT 'hoat_dong',
        nguoi_tao VARCHAR(100) NOT NULL,
        thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Table danh_muc_loai_chi_phi_dntt created/ready');

    // 3. Cấu hình Loại chi phí yêu cầu Loại chứng từ nào
    await db.query(`
      CREATE TABLE IF NOT EXISTS cau_hinh_chi_phi_chung_tu (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_loai_chi_phi INT NOT NULL,
        id_loai_chung_tu INT NOT NULL,
        bat_buoc TINYINT(1) DEFAULT 1,
        ghi_chu VARCHAR(255) NULL,
        FOREIGN KEY (id_loai_chi_phi) REFERENCES danh_muc_loai_chi_phi_dntt(id) ON DELETE CASCADE,
        FOREIGN KEY (id_loai_chung_tu) REFERENCES danh_muc_loai_chung_tu_dntt(id) ON DELETE CASCADE,
        UNIQUE KEY uk_chiphi_chungtu (id_loai_chi_phi, id_loai_chung_tu)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Table cau_hinh_chi_phi_chung_tu created/ready');

    // Seed default cost types and default required document configurations
    const defaultCostTypes = [
      {
        ma: 'MUA_HANG_PO',
        ten: 'Thanh toán mua hàng vật tư (Theo PO)',
        mo_ta: 'Thanh toán tiền vật tư, nguyên vật liệu theo đơn đặt hàng / PO nhà cung cấp',
        thu_tu: 1,
        requiredDocs: ['PHIEU_DNTT', 'HOP_DONG_PO', 'HOA_DON_VAT', 'BBNT']
      },
      {
        ma: 'SUA_CHUA_BAO_DUONG',
        ten: 'Sửa chữa, Bảo dưỡng máy móc & Xe cộ',
        mo_ta: 'Thanh toán tiền sửa chữa, đại tu, thay phụ tùng xe máy công trình',
        thu_tu: 2,
        requiredDocs: ['PHIEU_DNTT', 'HOA_DON_VAT', 'BANG_KE_CHI_PHI']
      },
      {
        ma: 'DIEN_NUOC_VIEN_THONG',
        ten: 'Tiện ích (Điện, Nước, Cước Viễn thông)',
        mo_ta: 'Thanh toán tiền điện lực, nước sạch thi công, cước internet/mạng',
        thu_tu: 3,
        requiredDocs: ['PHIEU_DNTT', 'HOA_DON_VAT']
      },
      {
        ma: 'THAU_PHU_TO_DOI',
        ten: 'Thanh toán Hợp đồng Thầu phụ / Tổ đội',
        mo_ta: 'Thanh toán đợt theo hợp đồng thi công giao khoán thầu phụ, tổ đội nhân công',
        thu_tu: 4,
        requiredDocs: ['PHIEU_DNTT', 'HOP_DONG_PO', 'BBNT', 'BANG_KE_CHI_PHI']
      },
      {
        ma: 'THUE_CA_XE_VAN_CHUYEN',
        ten: 'Thuê ca xe máy, Vận chuyển & Bốc xếp',
        mo_ta: 'Thuê cẩu hạ ngoài, cước xe kéo, xe ben chở xà bần, bốc xếp',
        thu_tu: 5,
        requiredDocs: ['PHIEU_DNTT', 'BBNT', 'BANG_KE_CHI_PHI']
      },
      {
        ma: 'TAM_UNG_HOAN_UNG',
        ten: 'Tạm ứng công tác & Hoàn ứng chi phí',
        mo_ta: 'Tạm ứng tiền đi công tác, mua vật tư nhanh, hoàn ứng chi phí công trường',
        thu_tu: 6,
        requiredDocs: ['PHIEU_DNTT', 'TAM_UNG_HOAN_UNG', 'BANG_KE_CHI_PHI']
      },
      {
        ma: 'HANH_CHINH_TIEP_KHACH',
        ten: 'Chi phí Hành chính, Tiếp khách & Khác',
        mo_ta: 'Văn phòng phẩm, tiếp khách đối tác, chi phí quản lý điều hành',
        thu_tu: 7,
        requiredDocs: ['PHIEU_DNTT', 'HOA_DON_VAT']
      }
    ];

    for (const ct of defaultCostTypes) {
      let costTypeId;
      const [existingCost] = await db.query('SELECT id FROM danh_muc_loai_chi_phi_dntt WHERE ma_loai_chi_phi = ?', [ct.ma]);
      if (existingCost.length === 0) {
        const [res] = await db.query(
          'INSERT INTO danh_muc_loai_chi_phi_dntt (ma_loai_chi_phi, ten_loai_chi_phi, mo_ta, thu_tu, nguoi_tao) VALUES (?, ?, ?, ?, ?)',
          [ct.ma, ct.ten, ct.mo_ta, ct.thu_tu, 'system']
        );
        costTypeId = res.insertId;
      } else {
        costTypeId = existingCost[0].id;
      }

      // Map required docs
      if (ct.requiredDocs && ct.requiredDocs.length > 0) {
        for (const docCode of ct.requiredDocs) {
          const [docRow] = await db.query('SELECT id FROM danh_muc_loai_chung_tu_dntt WHERE ma_loai = ?', [docCode]);
          if (docRow.length > 0) {
            const docId = docRow[0].id;
            const [exMap] = await db.query(
              'SELECT id FROM cau_hinh_chi_phi_chung_tu WHERE id_loai_chi_phi = ? AND id_loai_chung_tu = ?',
              [costTypeId, docId]
            );
            if (exMap.length === 0) {
              await db.query(
                'INSERT INTO cau_hinh_chi_phi_chung_tu (id_loai_chi_phi, id_loai_chung_tu, bat_buoc, ghi_chu) VALUES (?, ?, 1, ?)',
                [costTypeId, docId, 'Chứng từ bắt buộc']
              );
            }
          }
        }
      }
    }

    // 4. Bảng de_nghi_thanh_toan
    await db.query(`
      CREATE TABLE IF NOT EXISTS de_nghi_thanh_toan (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu VARCHAR(50) UNIQUE NOT NULL,
        so_vao_so INT NOT NULL,
        nam INT NOT NULL,
        ngay_de_nghi DATE NOT NULL,
        han_thanh_toan DATE NULL,
        id_linh_vuc_kinh_doanh INT NOT NULL,
        id_cong_trinh INT NULL,
        
        id_loai_chi_phi INT NOT NULL,
        ten_loai_chi_phi VARCHAR(255) NOT NULL,
        
        nguoi_de_nghi VARCHAR(100) NOT NULL,
        bo_phan_de_nghi VARCHAR(100) NULL,
        
        loai_doi_tuong ENUM('Nha_Cung_Cap', 'Thau_Phu', 'Khach_Hang', 'Nhan_Vien', 'Doi_Tac_Khac') DEFAULT 'Nha_Cung_Cap',
        id_doi_tuong INT NULL,
        ten_nguoi_thu_huong VARCHAR(255) NOT NULL,
        so_tai_khoan VARCHAR(50) NULL,
        ten_ngan_hang VARCHAR(255) NULL,
        chi_nhanh_ngan_hang VARCHAR(255) NULL,
        
        so_tien DECIMAL(15, 2) NOT NULL,
        so_tien_bang_chu TEXT NULL,
        hinh_thuc_de_xuat ENUM('Chuyen_Khoan', 'Tien_Mat') DEFAULT 'Chuyen_Khoan',
        noi_dung_thanh_toan TEXT NOT NULL,
        lan_thanh_toan_so INT DEFAULT 1,
        ghi_chu TEXT NULL,
        
        trang_thai ENUM(
          'Cho_TBP_Duyet',
          'Cho_Ke_Toan_Kiem_Tra',
          'Cho_GDTC_Duyet',
          'Da_Duyet_Cho_Chi',
          'Da_Thanh_Toan',
          'Tu_Choi',
          'Da_Huy'
        ) DEFAULT 'Cho_TBP_Duyet',
        
        ma_chung_tu_goc VARCHAR(100) NULL,
        loai_chung_tu_goc VARCHAR(50) NULL,
        id_chung_tu_goc INT NULL,
        id_loai_chung_tu_goc INT NULL,
        
        tbp_nguoi_duyet VARCHAR(100) NULL,
        tbp_ngay_duyet DATETIME NULL,
        tbp_y_kien TEXT NULL,
        
        kt_nguoi_kiem_tra VARCHAR(100) NULL,
        kt_ngay_kiem_tra DATETIME NULL,
        kt_y_kien TEXT NULL,
        
        gdtc_nguoi_duyet VARCHAR(100) NULL,
        gdtc_ngay_duyet DATETIME NULL,
        gdtc_y_kien TEXT NULL,
        
        ly_do_tu_choi TEXT NULL,
        
        id_phieu_thu_chi INT NULL,
        ma_phieu_chi VARCHAR(50) NULL,
        ngay_chi_tien DATETIME NULL,
        so_tien_da_chi DECIMAL(15, 2) DEFAULT 0,
        
        nguoi_tao VARCHAR(100) NOT NULL,
        thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
        da_xoa TINYINT(1) DEFAULT 0,
        
        INDEX idx_dntt_trang_thai (trang_thai),
        INDEX idx_dntt_lvkd (id_linh_vuc_kinh_doanh),
        INDEX idx_dntt_ngay (ngay_de_nghi),
        INDEX idx_dntt_ptc (id_phieu_thu_chi)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Table de_nghi_thanh_toan created/ready');

    // 5. Bảng de_nghi_thanh_toan_file
    await db.query(`
      CREATE TABLE IF NOT EXISTS de_nghi_thanh_toan_file (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_de_nghi_thanh_toan INT NOT NULL,
        id_loai_chung_tu INT NOT NULL,
        ten_loai_chung_tu VARCHAR(255) NOT NULL,
        ten_file VARCHAR(255) NOT NULL,
        duong_dan VARCHAR(500) NOT NULL,
        dung_luong INT NULL,
        nguoi_tai_len VARCHAR(100) NOT NULL,
        thoi_gian_tai DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        trang_thai_kiem_tra ENUM('Chua_Kiem_Tra', 'Dat', 'Khong_Dat') DEFAULT 'Chua_Kiem_Tra',
        nguoi_kiem_tra VARCHAR(100) NULL,
        thoi_gian_kiem_tra DATETIME NULL,
        ghi_chu_kiem_tra TEXT NULL,
        
        FOREIGN KEY (id_de_nghi_thanh_toan) REFERENCES de_nghi_thanh_toan(id) ON DELETE CASCADE,
        FOREIGN KEY (id_loai_chung_tu) REFERENCES danh_muc_loai_chung_tu_dntt(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Table de_nghi_thanh_toan_file created/ready');

    console.log('--- Migration de_nghi_thanh_toan completed successfully ---');
  } catch (err) {
    console.error('Migration error:', err);
    throw err;
  } finally {
    db.release();
  }
}

if (require.main === module) {
  migrateDeNghiThanhToan().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { migrateDeNghiThanhToan };
