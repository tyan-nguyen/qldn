const { pool } = require('../config/db');

async function migrate() {
  const connection = await pool.getConnection();
  try {
    console.log('Starting migration for Contract and Profitability Report...');
    await connection.beginTransaction();

    // 1. Check if columns exist in hop_dong and add missing columns
    const [existingCols] = await connection.query('DESCRIBE hop_dong');
    const colNames = existingCols.map(c => c.Field);

    const colsToAdd = [
      { name: 'ma_hop_dong', sql: 'ADD COLUMN ma_hop_dong VARCHAR(100) NULL AFTER id' },
      { name: 'so_vao_so', sql: 'ADD COLUMN so_vao_so INT DEFAULT 1 AFTER ma_hop_dong' },
      { name: 'nam', sql: 'ADD COLUMN nam INT DEFAULT 2026 AFTER so_vao_so' },
      { name: 'id_linh_vuc_kinh_doanh', sql: 'ADD COLUMN id_linh_vuc_kinh_doanh INT DEFAULT 1 AFTER nam' },
      { name: 'id_khach_hang', sql: 'ADD COLUMN id_khach_hang INT NULL AFTER id_linh_vuc_kinh_doanh' },
      { name: 'ten_hop_dong', sql: 'ADD COLUMN ten_hop_dong VARCHAR(255) NULL AFTER id_cong_trinh' },
      { name: 'loai_hop_dong', sql: "ADD COLUMN loai_hop_dong ENUM('thi_cong_xay_dung', 'cung_cap_vat_tu', 'kinh_doanh_thuong_mai', 'dich_vu_khac') DEFAULT 'thi_cong_xay_dung' AFTER ten_hop_dong" },
      { name: 'ngay_bat_dau', sql: 'ADD COLUMN ngay_bat_dau DATE NULL AFTER ngay_hieu_luc' },
      { name: 'ngay_ket_thuc', sql: 'ADD COLUMN ngay_ket_thuc DATE NULL AFTER ngay_bat_dau' },
      { name: 'gia_tri_truoc_thue', sql: 'ADD COLUMN gia_tri_truoc_thue DECIMAL(15,2) DEFAULT 0 AFTER ngay_het_han' },
      { name: 'thue_vat', sql: 'ADD COLUMN thue_vat DECIMAL(5,2) DEFAULT 0 AFTER gia_tri_truoc_thue' },
      { name: 'tien_thue_vat', sql: 'ADD COLUMN tien_thue_vat DECIMAL(15,2) DEFAULT 0 AFTER thue_vat' },
      { name: 'da_thanh_toan', sql: 'ADD COLUMN da_thanh_toan DECIMAL(15,2) DEFAULT 0 AFTER gia_tri_hop_dong' },
      { name: 'con_lai', sql: 'ADD COLUMN con_lai DECIMAL(15,2) DEFAULT 0 AFTER da_thanh_toan' },
      // Report percentage parameters
      { name: 'ti_le_chi_phi_quan_ly', sql: 'ADD COLUMN ti_le_chi_phi_quan_ly DECIMAL(5,2) DEFAULT 3.00 AFTER con_lai' },
      { name: 'ti_le_thanh_tra_kiem_toan', sql: 'ADD COLUMN ti_le_thanh_tra_kiem_toan DECIMAL(5,2) DEFAULT 1.00 AFTER ti_le_chi_phi_quan_ly' },
      { name: 'ti_le_thue_vat_tndn', sql: 'ADD COLUMN ti_le_thue_vat_tndn DECIMAL(5,2) DEFAULT 5.00 AFTER ti_le_thanh_tra_kiem_toan' },
      { name: 'ti_le_chi_phi_tim_viec', sql: 'ADD COLUMN ti_le_chi_phi_tim_viec DECIMAL(5,2) DEFAULT 10.00 AFTER ti_le_thue_vat_tndn' },
      { name: 'chi_phi_tim_viec_co_dinh', sql: 'ADD COLUMN chi_phi_tim_viec_co_dinh DECIMAL(15,2) DEFAULT 0 AFTER ti_le_chi_phi_tim_viec' },
      { name: 'loai_tinh_chi_phi_tim_viec', sql: "ADD COLUMN loai_tinh_chi_phi_tim_viec ENUM('phan_tram', 'so_tien_co_dinh') DEFAULT 'phan_tram' AFTER chi_phi_tim_viec_co_dinh" },
      // Contract terms
      { name: 'dieu_khoan_thanh_toan', sql: 'ADD COLUMN dieu_khoan_thanh_toan TEXT NULL AFTER loai_tinh_chi_phi_tim_viec' },
      { name: 'dieu_khoan_giao_hang', sql: 'ADD COLUMN dieu_khoan_giao_hang TEXT NULL AFTER dieu_khoan_thanh_toan' },
      { name: 'dieu_khoan_bao_hanh', sql: 'ADD COLUMN dieu_khoan_bao_hanh TEXT NULL AFTER dieu_khoan_giao_hang' },
      { name: 'thoi_han_bao_hanh_thang', sql: 'ADD COLUMN thoi_han_bao_hanh_thang INT DEFAULT 12 AFTER dieu_khoan_bao_hanh' },
      { name: 'trang_thai', sql: "ADD COLUMN trang_thai VARCHAR(50) DEFAULT 'Hieu_Luc' AFTER ngay_het_han_bao_hanh" },
      { name: 'ghi_chu', sql: 'ADD COLUMN ghi_chu TEXT NULL AFTER trang_thai' },
      { name: 'da_xoa', sql: 'ADD COLUMN da_xoa TINYINT(1) DEFAULT 0 AFTER thoi_gian_tao' }
    ];

    for (const c of colsToAdd) {
      if (!colNames.includes(c.name)) {
        console.log(`Adding column ${c.name} to hop_dong...`);
        await connection.query(`ALTER TABLE hop_dong ${c.sql}`);
      }
    }

    // Set default values for existing rows in hop_dong
    await connection.query(`
      UPDATE hop_dong 
      SET ma_hop_dong = CONCAT('HD', LPAD(id, 6, '0'), '/26')
      WHERE ma_hop_dong IS NULL OR ma_hop_dong = ''
    `);
    await connection.query(`
      UPDATE hop_dong 
      SET ten_hop_dong = CONCAT('Hợp đồng kinh tế #', id)
      WHERE ten_hop_dong IS NULL OR ten_hop_dong = ''
    `);
    await connection.query(`
      UPDATE hop_dong 
      SET con_lai = gia_tri_hop_dong - COALESCE(da_thanh_toan, 0)
      WHERE con_lai IS NULL OR con_lai = 0
    `);

    // 2. Create table hop_dong_dot_thanh_toan
    console.log('Creating table hop_dong_dot_thanh_toan...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS hop_dong_dot_thanh_toan (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_hop_dong INT NOT NULL,
        loai_dot ENUM('Tam_Ung', 'Dot_Thanh_Toan', 'Giao_Hang', 'Nghiem_Thu', 'Quyet_Toan', 'Bao_Hanh', 'Khac') NOT NULL,
        ten_dot VARCHAR(255) NOT NULL,
        hinh_thuc_thanh_toan VARCHAR(50) DEFAULT 'Chuyen_Khoan',
        han_thanh_toan DATE NULL,
        phan_tram DECIMAL(5, 2) DEFAULT 0,
        so_tien DECIMAL(15, 2) NOT NULL DEFAULT 0,
        phan_tram_giu_lai DECIMAL(5, 2) DEFAULT 0,
        tien_giu_lai DECIMAL(15, 2) DEFAULT 0,
        da_thanh_toan DECIMAL(15, 2) DEFAULT 0,
        con_lai DECIMAL(15, 2) DEFAULT 0,
        trang_thai VARCHAR(50) DEFAULT 'Chua_Thanh_Toan',
        mo_ta TEXT NULL,
        ngay_thanh_toan_thuc_te DATETIME NULL,
        id_phieu_thu INT NULL,
        nguoi_tao VARCHAR(100) NOT NULL,
        thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_hddtt_hop_dong (id_hop_dong)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 3. Create table hop_dong_file
    console.log('Creating table hop_dong_file...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS hop_dong_file (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_hop_dong INT NOT NULL,
        ten_file VARCHAR(255) NOT NULL,
        duong_dan VARCHAR(500) NOT NULL,
        loai_file VARCHAR(50) NULL,
        kich_thuoc_bytes INT DEFAULT 0,
        ghi_chu TEXT NULL,
        nguoi_tao VARCHAR(100) NOT NULL,
        thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_hdf_hop_dong (id_hop_dong)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await connection.commit();
    console.log('Migration completed successfully!');
  } catch (err) {
    await connection.rollback();
    console.error('Migration failed:', err);
    throw err;
  } finally {
    connection.release();
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
