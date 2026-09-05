const { pool } = require('../config/db');

async function migratePhieuNhapKho() {
  const db = await pool.getConnection();
  try {
    console.log('--- Migrating phieu_nhap_kho and phieu_nhap_kho_chi_tiet ---');

    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_nhap_kho (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu VARCHAR(50) UNIQUE NOT NULL,
        so_vao_so INT NOT NULL,
        nam INT NOT NULL,
        id_linh_vuc_kinh_doanh INT NULL,
        loai_nhap_kho ENUM('mua_hang', 'tra_lai_cong_trinh', 'nhap_thu_cong', 'tra_hang_ban') NOT NULL DEFAULT 'mua_hang',
        id_phieu_mua_hang INT NULL,
        id_nha_cung_cap INT NULL,
        id_kho_hang INT NOT NULL,
        id_cong_trinh INT NULL,
        id_kho_tam_nguon INT NULL,
        id_don_hang INT NULL,
        id_khach_hang INT NULL,
        so_hoa_don_ncc VARCHAR(100) NULL,
        ngay_hoa_don_ncc DATE NULL,
        thoi_gian_nhap DATETIME DEFAULT CURRENT_TIMESTAMP,
        nguoi_giao_hang VARCHAR(100) NULL,
        nguoi_nhap_kho VARCHAR(100) NOT NULL,
        tong_tien DECIMAL(15, 2) DEFAULT 0,
        trang_thai_nhap VARCHAR(50) DEFAULT 'Đã nhập',
        ghi_chu TEXT NULL,
        nguoi_tao VARCHAR(100) NOT NULL,
        thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
        da_xoa TINYINT(1) DEFAULT 0,
        INDEX idx_pnk_lvkd (id_linh_vuc_kinh_doanh),
        INDEX idx_pnk_kho (id_kho_hang),
        INDEX idx_pnk_ncc (id_nha_cung_cap),
        INDEX idx_pnk_po (id_phieu_mua_hang),
        INDEX idx_pnk_don_hang (id_don_hang),
        INDEX idx_pnk_nam (nam)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created table phieu_nhap_kho');

    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_nhap_kho_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_phieu_nhap_kho INT NOT NULL,
        id_chi_tiet_phieu_mua_hang INT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NULL,
        so_luong_yeu_cau DECIMAL(12, 2) DEFAULT 0,
        so_luong_thuc_nhap DECIMAL(12, 2) NOT NULL,
        don_gia DECIMAL(15, 2) DEFAULT 0,
        chiet_khau DECIMAL(15, 2) DEFAULT 0,
        thanh_tien DECIMAL(15, 2) DEFAULT 0,
        ghi_chu TEXT NULL,
        FOREIGN KEY (id_phieu_nhap_kho) REFERENCES phieu_nhap_kho(id) ON DELETE CASCADE,
        INDEX idx_pnk_ct_phieu (id_phieu_nhap_kho),
        INDEX idx_pnk_ct_vattu (id_danh_muc_vat_tu)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created table phieu_nhap_kho_chi_tiet');

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    db.release();
    process.exit(0);
  }
}

migratePhieuNhapKho();
