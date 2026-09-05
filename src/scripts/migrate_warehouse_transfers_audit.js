const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  });

  console.log('--- STARTING WAREHOUSE TRANSFERS & AUDIT MIGRATION ---');

  try {
    // 1. Create or alter phieu_chuyen_kho_noi_bo table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS phieu_chuyen_kho_noi_bo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu_chuyen VARCHAR(50) NULL,
        so_vao_so INT NULL,
        nam INT NULL,
        id_linh_vuc_kinh_doanh INT NULL,
        id_kho_nguon INT NOT NULL,
        id_kho_dich INT NOT NULL,
        id_cong_trinh INT NULL,
        ngay_chuyen DATETIME DEFAULT CURRENT_TIMESTAMP,
        nguoi_thuc_hien VARCHAR(255) NULL,
        nguoi_giao_hang VARCHAR(255) NULL,
        nguoi_nhan_hang VARCHAR(255) NULL,
        trang_thai VARCHAR(50) DEFAULT 'Dang_Chuyen',
        ly_do_chuyen TEXT NULL,
        ghi_chu TEXT NULL,
        da_xoa TINYINT(1) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_kho_nguon (id_kho_nguon),
        INDEX idx_kho_dich (id_kho_dich),
        INDEX idx_nam (nam)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure columns exist in phieu_chuyen_kho_noi_bo
    const [cols] = await pool.query(`DESCRIBE phieu_chuyen_kho_noi_bo`);
    const colNames = cols.map(c => c.Field);
    
    if (!colNames.includes('nguoi_giao_hang')) {
      await pool.query(`ALTER TABLE phieu_chuyen_kho_noi_bo ADD COLUMN nguoi_giao_hang VARCHAR(255) NULL AFTER nguoi_thuc_hien`);
    }
    if (!colNames.includes('nguoi_nhan_hang')) {
      await pool.query(`ALTER TABLE phieu_chuyen_kho_noi_bo ADD COLUMN nguoi_nhan_hang VARCHAR(255) NULL AFTER nguoi_giao_hang`);
    }
    if (!colNames.includes('ly_do_chuyen')) {
      await pool.query(`ALTER TABLE phieu_chuyen_kho_noi_bo ADD COLUMN ly_do_chuyen TEXT NULL AFTER trang_thai`);
    }
    if (!colNames.includes('da_xoa')) {
      await pool.query(`ALTER TABLE phieu_chuyen_kho_noi_bo ADD COLUMN da_xoa TINYINT(1) DEFAULT 0 AFTER ghi_chu`);
    }
    // Update enum/varchar for trang_thai
    await pool.query(`ALTER TABLE phieu_chuyen_kho_noi_bo MODIFY COLUMN trang_thai VARCHAR(50) DEFAULT 'Dang_Chuyen'`);

    console.log('Verified table phieu_chuyen_kho_noi_bo');

    // 2. Create or alter phieu_chuyen_kho_chi_tiet table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS phieu_chuyen_kho_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_phieu_chuyen INT NOT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NULL,
        so_luong_chuyen DECIMAL(15,3) NOT NULL DEFAULT 0.000,
        so_luong_nhan_thuc_te DECIMAL(15,3) NOT NULL DEFAULT 0.000,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_phieu_chuyen (id_phieu_chuyen),
        INDEX idx_vat_tu (id_danh_muc_vat_tu)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [dtCols] = await pool.query(`DESCRIBE phieu_chuyen_kho_chi_tiet`);
    const dtColNames = dtCols.map(c => c.Field);
    if (!dtColNames.includes('so_luong_nhan_thuc_te')) {
      await pool.query(`ALTER TABLE phieu_chuyen_kho_chi_tiet ADD COLUMN so_luong_nhan_thuc_te DECIMAL(15,3) NOT NULL DEFAULT 0.000 AFTER so_luong_chuyen`);
    }
    console.log('Verified table phieu_chuyen_kho_chi_tiet');

    // 3. Create kiem_ke_kho table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kiem_ke_kho (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu VARCHAR(50) NULL,
        so_vao_so INT NULL,
        nam INT NULL,
        id_linh_vuc_kinh_doanh INT NULL,
        id_kho_hang INT NOT NULL,
        ngay_kiem_ke DATE NOT NULL,
        nguoi_chu_tri VARCHAR(255) NULL,
        thanh_vien_kiem_ke TEXT NULL,
        trang_thai VARCHAR(50) DEFAULT 'Dang_Kiem_Ke',
        tong_sl_so_sach DECIMAL(15,3) DEFAULT 0.000,
        tong_sl_thuc_te DECIMAL(15,3) DEFAULT 0.000,
        tong_sl_lech_thua DECIMAL(15,3) DEFAULT 0.000,
        tong_sl_lech_thieu DECIMAL(15,3) DEFAULT 0.000,
        tong_gia_tri_lech_vnd DECIMAL(15,2) DEFAULT 0.00,
        nguoi_duyet_can_doi VARCHAR(255) NULL,
        ngay_duyet_can_doi DATETIME NULL,
        ghi_chu TEXT NULL,
        da_xoa TINYINT(1) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_kho (id_kho_hang),
        INDEX idx_nam (nam),
        INDEX idx_ngay (ngay_kiem_ke)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('Verified table kiem_ke_kho');

    // 4. Create kiem_ke_kho_chi_tiet table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kiem_ke_kho_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_kiem_ke_kho INT NOT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NULL,
        so_luong_so_sach DECIMAL(15,3) NOT NULL DEFAULT 0.000,
        so_luong_thuc_te DECIMAL(15,3) NOT NULL DEFAULT 0.000,
        so_luong_chenh_lech DECIMAL(15,3) NOT NULL DEFAULT 0.000,
        don_gia_von DECIMAL(15,2) DEFAULT 0.00,
        thanh_tien_chenh_lech DECIMAL(15,2) DEFAULT 0.00,
        ly_do_chenh_lech VARCHAR(255) NULL,
        bien_phap_xu_ly VARCHAR(255) NULL,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_kiem_ke (id_kiem_ke_kho),
        INDEX idx_vat_tu (id_danh_muc_vat_tu)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('Verified table kiem_ke_kho_chi_tiet');

    console.log('--- MIGRATION COMPLETED SUCCESSFULLY ---');
    await pool.end();
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
