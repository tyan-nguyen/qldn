const { pool } = require('../config/db');

async function migratePhieuThuChi() {
  const db = await pool.getConnection();
  try {
    console.log('--- Migrating phieu_thu_chi table and payment fields ---');

    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_thu_chi (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu VARCHAR(50) UNIQUE NOT NULL,
        so_vao_so INT NOT NULL,
        nam INT NOT NULL,
        id_linh_vuc_kinh_doanh INT NOT NULL,
        loai_phieu ENUM('Phieu_Thu', 'Phieu_Chi') NOT NULL,
        loai_thu_chi VARCHAR(100) NOT NULL,
        loai_chung_tu_lien_ket VARCHAR(100) DEFAULT 'khac',
        id_chung_tu INT NULL,
        ma_chung_tu VARCHAR(100) NULL,
        loai_doi_tuong VARCHAR(50) DEFAULT 'khac',
        id_doi_tuong INT NULL,
        ten_doi_tuong VARCHAR(255) NOT NULL,
        dia_chi_doi_tuong VARCHAR(255) NULL,
        sdt_doi_tuong VARCHAR(50) NULL,
        id_quy_tien INT NOT NULL,
        hinh_thuc_thanh_toan ENUM('Tien_Mat', 'Chuyen_Khoan', 'Quy_Cong_Truong') DEFAULT 'Tien_Mat',
        so_tien DECIMAL(15, 2) NOT NULL,
        ngay_chung_tu DATETIME DEFAULT CURRENT_TIMESTAMP,
        nguoi_nop_nhan VARCHAR(100) NULL,
        ly_do_thu_chi TEXT NOT NULL,
        kem_theo_chung_tu_goc VARCHAR(255) NULL,
        trang_thai VARCHAR(50) DEFAULT 'đã thanh toán',
        ghi_chu TEXT NULL,
        nguoi_tao VARCHAR(100) NOT NULL,
        thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
        da_xoa TINYINT(1) DEFAULT 0,
        INDEX idx_ptc_lvkd (id_linh_vuc_kinh_doanh),
        INDEX idx_ptc_quy (id_quy_tien),
        INDEX idx_ptc_loai (loai_phieu),
        INDEX idx_ptc_nam (nam),
        INDEX idx_ptc_chung_tu (loai_chung_tu_lien_ket, id_chung_tu),
        INDEX idx_ptc_doi_tuong (loai_doi_tuong, id_doi_tuong)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('Created table phieu_thu_chi');

    // Add payment tracking fields to phieu_mua_hang if they do not exist
    const [poColumns] = await db.query(`SHOW COLUMNS FROM phieu_mua_hang LIKE 'da_thanh_toan'`);
    if (poColumns.length === 0) {
      await db.query(`
        ALTER TABLE phieu_mua_hang
        ADD COLUMN da_thanh_toan DECIMAL(15, 2) DEFAULT 0 AFTER tong_tien,
        ADD COLUMN con_lai DECIMAL(15, 2) DEFAULT 0 AFTER da_thanh_toan,
        ADD COLUMN trang_thai_thanh_toan VARCHAR(50) DEFAULT 'Chưa thanh toán' AFTER con_lai
      `);
      console.log('Added payment columns to phieu_mua_hang');

      // Initialize con_lai = tong_tien for existing purchase orders
      await db.query(`UPDATE phieu_mua_hang SET con_lai = tong_tien WHERE da_thanh_toan = 0`);
    }

    console.log('Migration completed successfully!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    db.release();
    process.exit(0);
  }
}

migratePhieuThuChi();
