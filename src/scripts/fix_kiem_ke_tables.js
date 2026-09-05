const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixKiemKeTables() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
  });

  console.log('--- CHECKING & FIXING KIEM_KE_KHO COLUMNS ---');

  try {
    const [cols] = await pool.query('DESCRIBE kiem_ke_kho');
    console.log('Current kiem_ke_kho columns:', cols.map(c => c.Field));

    const existingFields = cols.map(c => c.Field);

    if (!existingFields.includes('ma_phieu')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN ma_phieu VARCHAR(50) NULL AFTER id');
      console.log('Added ma_phieu');
    }
    if (!existingFields.includes('so_vao_so')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN so_vao_so INT NULL AFTER ma_phieu');
      console.log('Added so_vao_so');
    }
    if (!existingFields.includes('nam')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN nam INT NULL AFTER so_vao_so');
      console.log('Added nam');
    }
    if (!existingFields.includes('id_linh_vuc_kinh_doanh')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN id_linh_vuc_kinh_doanh INT NULL AFTER nam');
      console.log('Added id_linh_vuc_kinh_doanh');
    }
    if (!existingFields.includes('id_kho_hang')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN id_kho_hang INT NOT NULL AFTER id_linh_vuc_kinh_doanh');
      console.log('Added id_kho_hang');
    }
    if (!existingFields.includes('ngay_kiem_ke')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN ngay_kiem_ke DATE NOT NULL AFTER id_kho_hang');
      console.log('Added ngay_kiem_ke');
    }
    if (!existingFields.includes('nguoi_chu_tri')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN nguoi_chu_tri VARCHAR(255) NULL AFTER ngay_kiem_ke');
      console.log('Added nguoi_chu_tri');
    }
    if (!existingFields.includes('thanh_vien_kiem_ke')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN thanh_vien_kiem_ke TEXT NULL AFTER nguoi_chu_tri');
      console.log('Added thanh_vien_kiem_ke');
    }
    if (!existingFields.includes('trang_thai')) {
      await pool.query("ALTER TABLE kiem_ke_kho ADD COLUMN trang_thai VARCHAR(50) DEFAULT 'Dang_Kiem_Ke' AFTER thanh_vien_kiem_ke");
      console.log('Added trang_thai');
    }
    if (!existingFields.includes('tong_sl_so_sach')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN tong_sl_so_sach DECIMAL(15,3) DEFAULT 0.000 AFTER trang_thai');
      console.log('Added tong_sl_so_sach');
    }
    if (!existingFields.includes('tong_sl_thuc_te')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN tong_sl_thuc_te DECIMAL(15,3) DEFAULT 0.000 AFTER tong_sl_so_sach');
      console.log('Added tong_sl_thuc_te');
    }
    if (!existingFields.includes('tong_sl_lech_thua')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN tong_sl_lech_thua DECIMAL(15,3) DEFAULT 0.000 AFTER tong_sl_thuc_te');
      console.log('Added tong_sl_lech_thua');
    }
    if (!existingFields.includes('tong_sl_lech_thieu')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN tong_sl_lech_thieu DECIMAL(15,3) DEFAULT 0.000 AFTER tong_sl_lech_thua');
      console.log('Added tong_sl_lech_thieu');
    }
    if (!existingFields.includes('tong_gia_tri_lech_vnd')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN tong_gia_tri_lech_vnd DECIMAL(15,2) DEFAULT 0.00 AFTER tong_sl_lech_thieu');
      console.log('Added tong_gia_tri_lech_vnd');
    }
    if (!existingFields.includes('nguoi_duyet_can_doi')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN nguoi_duyet_can_doi VARCHAR(255) NULL AFTER tong_gia_tri_lech_vnd');
      console.log('Added nguoi_duyet_can_doi');
    }
    if (!existingFields.includes('ngay_duyet_can_doi')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN ngay_duyet_can_doi DATETIME NULL AFTER nguoi_duyet_can_doi');
      console.log('Added ngay_duyet_can_doi');
    }
    if (!existingFields.includes('ghi_chu')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN ghi_chu TEXT NULL AFTER ngay_duyet_can_doi');
      console.log('Added ghi_chu');
    }
    if (!existingFields.includes('da_xoa')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN da_xoa TINYINT(1) DEFAULT 0 AFTER ghi_chu');
      console.log('Added da_xoa');
    }
    if (!existingFields.includes('created_at')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER da_xoa');
      console.log('Added created_at');
    }
    if (!existingFields.includes('updated_at')) {
      await pool.query('ALTER TABLE kiem_ke_kho ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');
      console.log('Added updated_at');
    }

    // Check kiem_ke_kho_chi_tiet
    console.log('--- CHECKING & FIXING KIEM_KE_KHO_CHI_TIET COLUMNS ---');
    try {
      const [dtCols] = await pool.query('DESCRIBE kiem_ke_kho_chi_tiet');
      console.log('Current kiem_ke_kho_chi_tiet columns:', dtCols.map(c => c.Field));
      const dtFields = dtCols.map(c => c.Field);

      if (!dtFields.includes('id_kiem_ke_kho')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN id_kiem_ke_kho INT NOT NULL AFTER id');
      }
      if (!dtFields.includes('id_danh_muc_vat_tu')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN id_danh_muc_vat_tu INT NOT NULL AFTER id_kiem_ke_kho');
      }
      if (!dtFields.includes('don_vi_tinh')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN don_vi_tinh VARCHAR(50) NULL AFTER id_danh_muc_vat_tu');
      }
      if (!dtFields.includes('so_luong_so_sach')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN so_luong_so_sach DECIMAL(15,3) DEFAULT 0.000 AFTER don_vi_tinh');
      }
      if (!dtFields.includes('so_luong_thuc_te')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN so_luong_thuc_te DECIMAL(15,3) DEFAULT 0.000 AFTER so_luong_so_sach');
      }
      if (!dtFields.includes('so_luong_chenh_lech')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN so_luong_chenh_lech DECIMAL(15,3) DEFAULT 0.000 AFTER so_luong_thuc_te');
      }
      if (!dtFields.includes('don_gia_von')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN don_gia_von DECIMAL(15,2) DEFAULT 0.00 AFTER so_luong_chenh_lech');
      }
      if (!dtFields.includes('thanh_tien_chenh_lech')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN thanh_tien_chenh_lech DECIMAL(15,2) DEFAULT 0.00 AFTER don_gia_von');
      }
      if (!dtFields.includes('ly_do_chenh_lech')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN ly_do_chenh_lech VARCHAR(255) NULL AFTER thanh_tien_chenh_lech');
      }
      if (!dtFields.includes('bien_phap_xu_ly')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN bien_phap_xu_ly VARCHAR(255) NULL AFTER ly_do_chenh_lech');
      }
      if (!dtFields.includes('ghi_chu')) {
        await pool.query('ALTER TABLE kiem_ke_kho_chi_tiet ADD COLUMN ghi_chu VARCHAR(255) NULL AFTER bien_phap_xu_ly');
      }
    } catch (e) {
      console.log('Creating kiem_ke_kho_chi_tiet as it did not exist...');
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
    }

    console.log('--- ALL KIEM_KE TABLES FIXED AND VERIFIED ---');
    await pool.end();
  } catch (err) {
    console.error('Error fixing kiem ke tables:', err);
    process.exit(1);
  }
}

fixKiemKeTables();
