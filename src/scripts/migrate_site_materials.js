const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  let db;
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'bv_code'
    });

    console.log('--- STARTING DATABASE MIGRATION FOR SITE MATERIALS MODULE ---');

    // 1. Alter kho_hang table
    try {
      await db.query(`ALTER TABLE kho_hang ADD COLUMN id_cong_trinh INT NULL AFTER ten_kho`);
      console.log('Added id_cong_trinh to kho_hang');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) console.log('kho_hang.id_cong_trinh:', e.message);
    }
    try {
      await db.query(`ALTER TABLE kho_hang ADD COLUMN la_kho_tam_cong_trinh TINYINT(1) DEFAULT 0 AFTER id_cong_trinh`);
      console.log('Added la_kho_tam_cong_trinh to kho_hang');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) console.log('kho_hang.la_kho_tam_cong_trinh:', e.message);
    }

    // 2. Alter phieu_xuat_kho table
    try {
      await db.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN id_yeu_cau_vat_tu INT NULL`);
      console.log('Added id_yeu_cau_vat_tu to phieu_xuat_kho');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) console.log('phieu_xuat_kho.id_yeu_cau_vat_tu:', e.message);
    }
    try {
      await db.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN id_cong_trinh INT NULL`);
      console.log('Added id_cong_trinh to phieu_xuat_kho');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) console.log('phieu_xuat_kho.id_cong_trinh:', e.message);
    }
    try {
      await db.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN id_kho_tam_nhan INT NULL`);
      console.log('Added id_kho_tam_nhan to phieu_xuat_kho');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) console.log('phieu_xuat_kho.id_kho_tam_nhan:', e.message);
    }
    try {
      await db.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN so_vao_so INT NULL`);
      console.log('Added so_vao_so to phieu_xuat_kho');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) console.log('phieu_xuat_kho.so_vao_so:', e.message);
    }
    try {
      await db.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN nam INT NULL`);
      console.log('Added nam to phieu_xuat_kho');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) console.log('phieu_xuat_kho.nam:', e.message);
    }
    try {
      await db.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN id_linh_vuc_kinh_doanh INT NULL`);
      console.log('Added id_linh_vuc_kinh_doanh to phieu_xuat_kho');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) console.log('phieu_xuat_kho.id_linh_vuc_kinh_doanh:', e.message);
    }
    try {
      await db.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN loai_xuat_kho ENUM('ban_hang', 'cong_trinh') DEFAULT 'ban_hang'`);
      console.log('Added loai_xuat_kho to phieu_xuat_kho');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) console.log('phieu_xuat_kho.loai_xuat_kho:', e.message);
    }

    // 3. Alter phieu_xuat_kho_chi_tiet table
    try {
      await db.query(`ALTER TABLE phieu_xuat_kho_chi_tiet ADD COLUMN id_chi_tiet_yeu_cau_vat_tu INT NULL`);
      console.log('Added id_chi_tiet_yeu_cau_vat_tu to phieu_xuat_kho_chi_tiet');
    } catch (e) {
      if (!e.message.includes('Duplicate column')) console.log('phieu_xuat_kho_chi_tiet.id_chi_tiet_yeu_cau_vat_tu:', e.message);
    }

    // 4. Create yeu_cau_vat_tu table
    await db.query(`
      CREATE TABLE IF NOT EXISTS yeu_cau_vat_tu (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu VARCHAR(50) NULL,
        so_vao_so INT NULL,
        nam INT NULL,
        id_linh_vuc_kinh_doanh INT NULL,
        id_cong_trinh INT NOT NULL,
        dia_diem_cap_vat_tu TEXT NULL,
        nguoi_yeu_cau VARCHAR(255) NULL,
        loai_phieu ENUM('online', 'giay') DEFAULT 'online',
        noi_dung_yeu_cau TEXT NULL,
        ngay_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
        id_nguoi_tao INT NULL,
        id_nguoi_gui INT NULL,
        thoi_gian_gui DATETIME NULL,
        id_nguoi_duyet INT NULL,
        thoi_gian_duyet DATETIME NULL,
        noi_dung_duyet TEXT NULL,
        ket_qua_duyet VARCHAR(50) NULL,
        trang_thai ENUM('Nháp', 'Chờ duyệt', 'Đã duyệt', 'Từ chối') DEFAULT 'Nháp',
        ghi_chu TEXT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('Created table yeu_cau_vat_tu');

    // 5. Create yeu_cau_vat_tu_chi_tiet table
    await db.query(`
      CREATE TABLE IF NOT EXISTS yeu_cau_vat_tu_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_yeu_cau_vat_tu INT NOT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NULL,
        so_luong_yeu_cau DECIMAL(15,3) NOT NULL DEFAULT 0.000,
        don_gia DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        chiet_khau DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        thanh_tien DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_yeu_cau (id_yeu_cau_vat_tu),
        INDEX idx_vat_tu (id_danh_muc_vat_tu)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('Created table yeu_cau_vat_tu_chi_tiet');

    // 6. Create nghiem_thu_vat_tu_cong_trinh table
    await db.query(`
      CREATE TABLE IF NOT EXISTS nghiem_thu_vat_tu_cong_trinh (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ma_phieu_nghiem_thu VARCHAR(50) NULL,
        id_cong_trinh INT NOT NULL,
        id_kho_tam INT NOT NULL,
        ngay_nghiem_thu DATETIME DEFAULT CURRENT_TIMESTAMP,
        nguoi_nghiem_thu VARCHAR(255) NULL,
        ghi_chu TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('Created table nghiem_thu_vat_tu_cong_trinh');

    // 7. Create nghiem_thu_vat_tu_chi_tiet table
    await db.query(`
      CREATE TABLE IF NOT EXISTS nghiem_thu_vat_tu_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_nghiem_thu INT NOT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        so_luong_da_giao DECIMAL(15,3) NOT NULL DEFAULT 0.000,
        so_luong_thuc_te_su_dung DECIMAL(15,3) NOT NULL DEFAULT 0.000,
        so_luong_con_lai DECIMAL(15,3) NOT NULL DEFAULT 0.000,
        don_gia DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        thanh_tien DECIMAL(15,2) NOT NULL DEFAULT 0.00,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_nghiem_thu (id_nghiem_thu)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('Created table nghiem_thu_vat_tu_chi_tiet');

    // 8. Create phieu_chuyen_kho_noi_bo table
    await db.query(`
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
        trang_thai ENUM('Nháp', 'Đã chuyển') DEFAULT 'Nháp',
        ghi_chu TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('Created table phieu_chuyen_kho_noi_bo');

    // 9. Create phieu_chuyen_kho_chi_tiet table
    await db.query(`
      CREATE TABLE IF NOT EXISTS phieu_chuyen_kho_chi_tiet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        id_phieu_chuyen INT NOT NULL,
        id_danh_muc_vat_tu INT NOT NULL,
        don_vi_tinh VARCHAR(50) NULL,
        so_luong_chuyen DECIMAL(15,3) NOT NULL DEFAULT 0.000,
        ghi_chu VARCHAR(255) NULL,
        INDEX idx_phieu_chuyen (id_phieu_chuyen)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('Created table phieu_chuyen_kho_chi_tiet');

    // 10. Auto-create Site Temp Warehouses for existing projects in cong_trinh table
    const [projects] = await db.query('SELECT id, ten_cong_trinh FROM cong_trinh');
    for (const p of projects) {
      const [existingKho] = await db.query('SELECT id FROM kho_hang WHERE id_cong_trinh = ? AND la_kho_tam_cong_trinh = 1', [p.id]);
      if (existingKho.length === 0) {
        const tenKho = 'Kho tạm - ' + p.ten_cong_trinh;
        await db.query(`
          INSERT INTO kho_hang (ten_kho, loai_kho, id_cong_trinh, la_kho_tam_cong_trinh, dia_diem, ghi_chu)
          VALUES (?, 'Kho tạm công trình', ?, 1, ?, ?)
        `, [tenKho, p.id, 'Tại công trình ' + p.ten_cong_trinh, 'Kho tạm công trình khởi tạo tự động']);
        console.log(`Created Site Temp Warehouse for project #${p.id}: ${tenKho}`);
      }
    }

    console.log('--- DATABASE MIGRATION SUCCESSFUL ---');
    await db.end();
  } catch (err) {
    console.error('DATABASE MIGRATION ERROR:', err);
    if (db) await db.end();
    process.exit(1);
  }
})();
