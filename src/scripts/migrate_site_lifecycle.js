const { pool: db } = require('../config/db');

async function migrateSiteLifecycle() {
  console.log('--- Starting Migration: Site Material Lifecycle & Purchase Requisitions ---');
  
  try {
    // 1. yeu_cau_mua_hang table
    await db.query(`
      CREATE TABLE IF NOT EXISTS yeu_cau_mua_hang (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_yeu_cau VARCHAR(50) UNIQUE NOT NULL,
        loai_yeu_cau ENUM('MUA_CHO_CONG_TRINH', 'MUA_NHAP_KHO') NOT NULL,
        id_linh_vuc_kinh_doanh INT NULL,
        id_cong_trinh INT NULL,
        id_yeu_cau_vat_tu INT NULL,
        ngay_yeu_cau DATE NOT NULL,
        ngay_can_hang DATE NULL,
        nguoi_yeu_cau VARCHAR(255) NOT NULL,
        bo_phan_yeu_cau VARCHAR(255) NULL,
        nguoi_gui_yeu_cau_duyet VARCHAR(255) NULL,
        thoi_gian_gui_yeu_cau_duyet DATETIME NULL,
        nguoi_duyet VARCHAR(255) NULL,
        thoi_gian_duyet DATETIME NULL,
        noi_dung_duyet TEXT NULL,
        trang_thai ENUM('Dự thảo', 'Chờ duyệt', 'Đã duyệt', 'Từ chối', 'Hoàn tất') DEFAULT 'Dự thảo',
        ly_do_yeu_cau TEXT NULL,
        ghi_chu TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_cong_trinh (id_cong_trinh),
        INDEX idx_yc_vattu (id_yeu_cau_vat_tu),
        INDEX idx_lvkd (id_linh_vuc_kinh_doanh)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created table yeu_cau_mua_hang');

    // 2. yeu_cau_mua_hang_chi_tiet table
    await db.query(`
      CREATE TABLE IF NOT EXISTS yeu_cau_mua_hang_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_yeu_cau_mua_hang INT NOT NULL,
        id_chi_tiet_yeu_cau_vat_tu INT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NOT NULL,
        so_luong_can_mua DECIMAL(12,2) NOT NULL,
        so_luong_da_tao_don_mua DECIMAL(12,2) DEFAULT 0,
        don_gia_du_kien DECIMAL(15,2) DEFAULT 0,
        thanh_tien_du_kien DECIMAL(15,2) DEFAULT 0,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_yc_mua (id_yeu_cau_mua_hang),
        INDEX idx_vat_tu (id_danh_muc_vat_tu)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created table yeu_cau_mua_hang_chi_tiet');

    // 3. phieu_mua_hang table
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_mua_hang (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu_mua VARCHAR(50) UNIQUE NOT NULL,
        id_yeu_cau_mua_hang INT NULL,
        id_yeu_cau_vat_tu INT NULL,
        id_linh_vuc_kinh_doanh INT NULL,
        loai_mua_hang ENUM('MUA_CHO_CONG_TRINH', 'MUA_NHAP_KHO') NOT NULL,
        id_cong_trinh INT NULL,
        id_kho_nhap INT NULL,
        id_nha_cung_cap INT NULL,
        ten_nha_cung_cap VARCHAR(255) NULL,
        ngay_mua DATE NOT NULL,
        ngay_du_kien_giao DATE NULL,
        ngay_giao_thuc_te DATE NULL,
        trang_thai_giao_hang ENUM('Chờ giao', 'Đã giao', 'Đã hủy') DEFAULT 'Chờ giao',
        nguoi_mua_hang VARCHAR(255) NULL,
        nguoi_giao_hang VARCHAR(255) NULL,
        nguoi_nhan_hang VARCHAR(255) NULL,
        tong_tien DECIMAL(15,2) DEFAULT 0,
        ghi_chu TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_cong_trinh (id_cong_trinh),
        INDEX idx_kho_nhap (id_kho_nhap),
        INDEX idx_lvkd (id_linh_vuc_kinh_doanh)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created table phieu_mua_hang');

    // 4. phieu_mua_hang_chi_tiet table
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_mua_hang_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_phieu_mua_hang INT NOT NULL,
        id_chi_tiet_yeu_cau_mua INT NULL,
        id_chi_tiet_yeu_cau_vat_tu INT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NOT NULL,
        so_luong_mua DECIMAL(12,2) NOT NULL,
        so_luong_nhan_thuc_te DECIMAL(12,2) DEFAULT 0,
        don_gia DECIMAL(15,2) DEFAULT 0,
        thanh_tien DECIMAL(15,2) DEFAULT 0,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_phieu_mua (id_phieu_mua_hang)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created table phieu_mua_hang_chi_tiet');

    // 5. phieu_dieu_chuyen_vat_tu table
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_dieu_chuyen_vat_tu (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu_dieu_chuyen VARCHAR(50) UNIQUE NOT NULL,
        id_linh_vuc_kinh_doanh INT NULL,
        id_yeu_cau_vat_tu INT NULL,
        loai_dieu_chuyen ENUM('CONG_TRINH_SANG_CONG_TRINH', 'KHO_SANG_CONG_TRINH', 'CONG_TRINH_SANG_KHO') NOT NULL,
        loai_nguon ENUM('CONG_TRINH', 'KHO_HANG') NOT NULL,
        id_nguon INT NOT NULL,
        loai_dich ENUM('CONG_TRINH', 'KHO_HANG') NOT NULL,
        id_dich INT NOT NULL,
        ngay_dieu_chuyen DATE NOT NULL,
        nguoi_dieu_chuyen VARCHAR(255) NOT NULL,
        nguoi_giao_hang VARCHAR(255) NULL,
        nguoi_nhan_hang VARCHAR(255) NULL,
        trang_thai ENUM('Chờ giao', 'Đã nhận', 'Đã hủy') DEFAULT 'Chờ giao',
        ly_do_dieu_chuyen TEXT NULL,
        ghi_chu TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_nguon (loai_nguon, id_nguon),
        INDEX idx_dich (loai_dich, id_dich)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created table phieu_dieu_chuyen_vat_tu');

    // 6. phieu_dieu_chuyen_vat_tu_chi_tiet table
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_dieu_chuyen_vat_tu_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_phieu_dieu_chuyen INT NOT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NOT NULL,
        so_luong_dieu_chuyen DECIMAL(12,2) NOT NULL,
        so_luong_nhan_thuc_te DECIMAL(12,2) DEFAULT 0,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_phieu_dc (id_phieu_dieu_chuyen)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created table phieu_dieu_chuyen_vat_tu_chi_tiet');

    // 7. vat_tu_cong_trinh (Virtual site stock) table
    await db.query(`
      CREATE TABLE IF NOT EXISTS vat_tu_cong_trinh (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_cong_trinh INT NOT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        so_luong_nhan_tong DECIMAL(12,2) DEFAULT 0,
        so_luong_dieu_chuyen_di DECIMAL(12,2) DEFAULT 0,
        so_luong_da_su_dung DECIMAL(12,2) DEFAULT 0,
        so_luong_da_tra_lai DECIMAL(12,2) DEFAULT 0,
        so_luong_hao_hut DECIMAL(12,2) DEFAULT 0,
        so_luong_ton_hien_tai DECIMAL(12,2) GENERATED ALWAYS AS (so_luong_nhan_tong - so_luong_dieu_chuyen_di - so_luong_da_su_dung - so_luong_da_tra_lai - so_luong_hao_hut) STORED,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_ctr_vattu (id_cong_trinh, id_danh_muc_vat_tu)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created table vat_tu_cong_trinh');

    // 8. phieu_su_dung_vat_tu table
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_su_dung_vat_tu (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu_su_dung VARCHAR(50) UNIQUE NOT NULL,
        id_cong_trinh INT NOT NULL,
        id_boq_item INT NULL,
        ngay_su_dung DATE NOT NULL,
        nguoi_su_dung VARCHAR(255) NOT NULL,
        noi_dung_thi_cong TEXT NULL,
        ghi_chu TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_su_dung_vat_tu_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_phieu_su_dung INT NOT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NOT NULL,
        so_luong_su_dung DECIMAL(12,2) NOT NULL,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_su_dung (id_phieu_su_dung)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created tables phieu_su_dung_vat_tu & chi_tiet');

    // 9. phieu_tra_lai_kho table
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_tra_lai_kho (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu_tra VARCHAR(50) UNIQUE NOT NULL,
        id_cong_trinh INT NOT NULL,
        id_kho_nhan INT NOT NULL,
        ngay_tra DATE NOT NULL,
        nguoi_tra VARCHAR(255) NOT NULL,
        nguoi_nhan_kho VARCHAR(255) NULL,
        trang_thai ENUM('Chờ nhập kho', 'Đã nhập kho', 'Đã hủy') DEFAULT 'Chờ nhập kho',
        ly_do_tra TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_tra_lai_kho_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_phieu_tra_lai INT NOT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NOT NULL,
        so_luong_tra DECIMAL(12,2) NOT NULL,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_tra_lai (id_phieu_tra_lai)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created tables phieu_tra_lai_kho & chi_tiet');

    // 10. phieu_hao_hut_vat_tu table
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_hao_hut_vat_tu (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu_hao_hut VARCHAR(50) UNIQUE NOT NULL,
        id_cong_trinh INT NOT NULL,
        ngay_ghi_nhan DATE NOT NULL,
        nguoi_bao_cao VARCHAR(255) NOT NULL,
        nguoi_duyet VARCHAR(255) NULL,
        thoi_gian_duyet DATETIME NULL,
        trang_thai ENUM('Chờ duyệt', 'Đã duyệt', 'Từ chối') DEFAULT 'Chờ duyệt',
        ly_do_hao_hut TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_hao_hut_vat_tu_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_phieu_hao_hut INT NOT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NOT NULL,
        so_luong_hao_hut DECIMAL(12,2) NOT NULL,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_hao_hut (id_phieu_hao_hut)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created tables phieu_hao_hut_vat_tu & chi_tiet');

    console.log('--- Migration Completed Successfully ---');
    process.exit(0);
  } catch (err) {
    console.error('Migration Failed:', err);
    process.exit(1);
  }
}

migrateSiteLifecycle();
