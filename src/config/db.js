const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'bv_2026',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true
});

async function initializeDatabase() {
  let connection;
  try {
    // Attempt connection without database first to ensure database exists
    const tempConn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || ''
    });
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'bv_2026'}\`;`);
    await tempConn.end();

    connection = await pool.getConnection();
    console.log('Successfully connected to MySQL database: ' + process.env.DB_NAME);

    // Read and run schema.sql to ensure tables exist
    const schemaPath = path.join(__dirname, '../../database/schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      const queries = schemaSql
        .split(/;\s*$/m)
        .map(q => q.trim())
        .filter(q => q.length > 0);

      for (const query of queries) {
        await connection.query(query);
      }
      console.log('Database schema checked and loaded successfully.');
      
      // Ensure nguoi_dung_lich_su table exists
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS nguoi_dung_lich_su (
            id INT AUTO_INCREMENT PRIMARY KEY,
            id_nguoi_dung INT NOT NULL,
            ten_dang_nhap VARCHAR(100) NOT NULL,
            ho_ten VARCHAR(255),
            hanh_dong VARCHAR(50) NOT NULL,
            thoi_gian DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
        console.log('Successfully created/checked nguoi_dung_lich_su table.');
      } catch (histTableErr) {
        console.warn('Could not create nguoi_dung_lich_su table: ', histTableErr.message);
      }

      // Ensure files table exists
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ten_bang VARCHAR(100) NOT NULL,
            id_ban_ghi INT NOT NULL,
            ten_file VARCHAR(255) NOT NULL,
            ten_file_luu VARCHAR(255) NOT NULL,
            loai_file VARCHAR(50) DEFAULT 'other',
            extension VARCHAR(20) DEFAULT '',
            duong_dan VARCHAR(255) NOT NULL,
            kich_thuoc INT DEFAULT 0,
            nguoi_tao VARCHAR(100),
            thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_files_bang_bangghi (ten_bang, id_ban_ghi)
          );
        `);
        console.log('Successfully created/checked files table.');
      } catch (filesTableErr) {
        console.warn('Could not create files table: ', filesTableErr.message);
      }

      // Ensure cong_trinh has ten_viet_tat column
      try { await connection.query(`ALTER TABLE cong_trinh ADD COLUMN ten_viet_tat VARCHAR(100) NULL`); } catch (e) {}

      // Ensure phieu_xuat_kho has necessary columns for site materials export
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN id_yeu_cau_vat_tu INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN id_kho_tam_nhan INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN so_vao_so INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN nam INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN id_linh_vuc_kinh_doanh INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN loai_xuat_kho VARCHAR(50) DEFAULT 'ban_hang'`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN ma_phieu VARCHAR(50) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN thoi_gian_xuat DATETIME NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN nguoi_xuat VARCHAR(100) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN tong_tien DECIMAL(15,2) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN trang_thai_xuat VARCHAR(50) DEFAULT 'Nháp'`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN ly_do_huy TEXT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN thoi_gian_huy DATETIME NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN nguoi_huy VARCHAR(100) NULL`); } catch (e) {}

      // Ensure phieu_nhap_kho has cancellation columns
      try { await connection.query(`ALTER TABLE phieu_nhap_kho ADD COLUMN ly_do_huy TEXT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_nhap_kho ADD COLUMN thoi_gian_huy DATETIME NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_nhap_kho ADD COLUMN nguoi_huy VARCHAR(100) NULL`); } catch (e) {}
      try { await connection.query(`UPDATE phieu_nhap_kho SET da_xoa = 0 WHERE trang_thai_nhap = 'Đã hủy'`); } catch (e) {}

      // Ensure other voucher tables have sequence columns
      try { await connection.query(`ALTER TABLE phieu_tra_lai_kho ADD COLUMN so_vao_so INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_tra_lai_kho ADD COLUMN nam INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_tra_lai_kho ADD COLUMN id_linh_vuc_kinh_doanh INT NULL`); } catch (e) {}

      try { await connection.query(`ALTER TABLE phieu_su_dung_vat_tu ADD COLUMN so_vao_so INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_su_dung_vat_tu ADD COLUMN nam INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_su_dung_vat_tu ADD COLUMN id_linh_vuc_kinh_doanh INT NULL`); } catch (e) {}

      try { await connection.query(`ALTER TABLE phieu_hao_hut_vat_tu ADD COLUMN so_vao_so INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_hao_hut_vat_tu ADD COLUMN nam INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_hao_hut_vat_tu ADD COLUMN id_linh_vuc_kinh_doanh INT NULL`); } catch (e) {}

      try { await connection.query(`ALTER TABLE phieu_dieu_chuyen_vat_tu ADD COLUMN so_vao_so INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_dieu_chuyen_vat_tu ADD COLUMN nam INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_dieu_chuyen_vat_tu ADD COLUMN id_linh_vuc_kinh_doanh INT NULL`); } catch (e) {}

      // Ensure phieu_xuat_kho_chi_tiet has necessary columns for site materials export
      try { await connection.query(`ALTER TABLE phieu_xuat_kho_chi_tiet ADD COLUMN id_chi_tiet_yeu_cau_vat_tu INT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho_chi_tiet ADD COLUMN so_luong_xuat DECIMAL(12,2) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho_chi_tiet ADD COLUMN don_vi_tinh VARCHAR(50) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho_chi_tiet ADD COLUMN don_gia DECIMAL(15,2) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho_chi_tiet ADD COLUMN chiet_khau DECIMAL(15,2) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho_chi_tiet ADD COLUMN thanh_tien DECIMAL(15,2) DEFAULT 0`); } catch (e) {}

      // Ensure khach_hang has da_xoa, trang_thai, no_dau_ky, ngay_chot_no_dau_ky, ghi_chu_no_dau_ky columns
      try { await connection.query(`ALTER TABLE khach_hang ADD COLUMN da_xoa TINYINT(1) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE khach_hang ADD COLUMN trang_thai VARCHAR(50) DEFAULT 'con_giao_dich'`); } catch (e) {}
      try { await connection.query(`UPDATE khach_hang SET trang_thai = 'con_giao_dich' WHERE trang_thai IS NULL OR trang_thai = ''`); } catch (e) {}
      try { await connection.query(`ALTER TABLE khach_hang ADD COLUMN no_dau_ky DECIMAL(15,2) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE khach_hang ADD COLUMN ngay_chot_no_dau_ky DATE NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE khach_hang ADD COLUMN ghi_chu_no_dau_ky TEXT NULL`); } catch (e) {}

      // Ensure nha_cung_cap has necessary debt columns
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN da_xoa TINYINT(1) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN trang_thai VARCHAR(50) DEFAULT 'con_giao_dich'`); } catch (e) {}
      try { await connection.query(`UPDATE nha_cung_cap SET trang_thai = 'con_giao_dich' WHERE trang_thai IS NULL OR trang_thai = ''`); } catch (e) {}
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN ma_so_thue VARCHAR(50) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN nguoi_dai_dien VARCHAR(100) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN so_tai_khoan VARCHAR(100) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN ten_ngan_hang VARCHAR(255) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN so_ngay_no_toi_da INT DEFAULT 30`); } catch (e) {}
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN han_muc_no DECIMAL(15,2) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN no_dau_ky DECIMAL(15,2) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN ngay_chot_no_dau_ky DATE NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE nha_cung_cap ADD COLUMN ghi_chu_no_dau_ky TEXT NULL`); } catch (e) {}

      // Ensure linh_vuc_kinh_doanh has company details and logo columns
      try { await connection.query(`ALTER TABLE linh_vuc_kinh_doanh ADD COLUMN ten_cong_ty VARCHAR(255) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE linh_vuc_kinh_doanh ADD COLUMN dia_chi VARCHAR(500) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE linh_vuc_kinh_doanh ADD COLUMN dien_thoai VARCHAR(100) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE linh_vuc_kinh_doanh ADD COLUMN ma_so_thue VARCHAR(100) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE linh_vuc_kinh_doanh ADD COLUMN nguoi_dai_dien VARCHAR(255) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE linh_vuc_kinh_doanh ADD COLUMN chuc_vu VARCHAR(255) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE linh_vuc_kinh_doanh ADD COLUMN logo_url TEXT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE linh_vuc_kinh_doanh ADD COLUMN da_xoa TINYINT(1) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE quy_tien ADD COLUMN da_xoa TINYINT(1) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_thu_chi ADD COLUMN da_xoa TINYINT(1) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE de_nghi_thanh_toan ADD COLUMN da_xoa TINYINT(1) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho ADD COLUMN da_xoa TINYINT(1) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE phieu_xuat_kho_chi_tiet ADD COLUMN da_xoa TINYINT(1) DEFAULT 0`); } catch (e) {}
      try { await connection.query(`ALTER TABLE don_hang ADD COLUMN ghi_chu TEXT NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE don_hang ADD COLUMN ngay_huy DATETIME NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE don_hang ADD COLUMN nguoi_huy VARCHAR(100) NULL`); } catch (e) {}
      try { await connection.query(`ALTER TABLE don_hang ADD COLUMN ly_do_huy TEXT NULL`); } catch (e) {}

      // Ensure cong_no_khac_ncc table exists
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS cong_no_khac_ncc (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ma_chung_tu VARCHAR(50) UNIQUE NOT NULL,
            id_nha_cung_cap INT NOT NULL,
            loai_chi_phi VARCHAR(100) NOT NULL,
            so_hoa_don_vat VARCHAR(100) NULL,
            ngay_phat_sinh DATE NOT NULL,
            han_thanh_toan DATE NULL,
            id_cong_trinh INT NULL,
            so_tien DECIMAL(15, 2) NOT NULL,
            da_thanh_toan DECIMAL(15, 2) DEFAULT 0,
            con_lai DECIMAL(15, 2) DEFAULT 0,
            trang_thai_thanh_toan VARCHAR(50) DEFAULT 'chua_thanh_toan',
            dien_giai TEXT NOT NULL,
            ghi_chu TEXT NULL,
            da_xoa TINYINT(1) DEFAULT 0,
            nguoi_tao VARCHAR(100) NOT NULL,
            thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_cnk_ncc (id_nha_cung_cap),
            INDEX idx_cnk_ctr (id_cong_trinh)
          );
        `);
        console.log('Successfully created/checked cong_no_khac_ncc table.');
      } catch (cnkErr) {
        console.warn('Could not create cong_no_khac_ncc table: ', cnkErr.message);
      }

      // Ensure chi_tiet_gach_no_ncc table exists
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS chi_tiet_gach_no_ncc (
            id INT AUTO_INCREMENT PRIMARY KEY,
            id_phieu_thu_chi INT NOT NULL,
            loai_chung_tu_no VARCHAR(50) NOT NULL,
            id_chung_tu_no INT NOT NULL,
            so_tien_khau_tru DECIMAL(15, 2) NOT NULL,
            nguoi_tao VARCHAR(100) NOT NULL,
            thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_gach_ncc_ptc (id_phieu_thu_chi),
            INDEX idx_gach_ncc_ct (loai_chung_tu_no, id_chung_tu_no)
          );
        `);
        console.log('Successfully created/checked chi_tiet_gach_no_ncc table.');
      } catch (gachNccErr) {
        console.warn('Could not create chi_tiet_gach_no_ncc table: ', gachNccErr.message);
      }

      // Ensure da_xoa column exists for inventory tables
      try {
        const [vCols] = await connection.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'danh_muc_vat_tu' AND COLUMN_NAME = 'da_xoa'`);
        if (vCols.length === 0) {
          await connection.query(`ALTER TABLE danh_muc_vat_tu ADD COLUMN da_xoa TINYINT(1) NOT NULL DEFAULT 0 AFTER thoi_gian_tao`);
        }
        const [kCols] = await connection.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'kho_hang' AND COLUMN_NAME = 'da_xoa'`);
        if (kCols.length === 0) {
          await connection.query(`ALTER TABLE kho_hang ADD COLUMN da_xoa TINYINT(1) NOT NULL DEFAULT 0 AFTER thoi_gian_tao`);
        }
        const [lCols] = await connection.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'danh_muc_loai_vat_tu' AND COLUMN_NAME = 'da_xoa'`);
        if (lCols.length === 0) {
          await connection.query(`ALTER TABLE danh_muc_loai_vat_tu ADD COLUMN da_xoa TINYINT(1) NOT NULL DEFAULT 0 AFTER thoi_gian_tao`);
        }
      } catch (invColErr) {
        console.warn('Could not check/add da_xoa column to inventory tables:', invColErr.message);
      }

      // Ensure setting table exists for system AI configuration
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS setting (
            id INT AUTO_INCREMENT PRIMARY KEY,
            \`key\` VARCHAR(100) UNIQUE NOT NULL,
            \`value\` TEXT NULL,
            \`ghi_chu\` VARCHAR(255) NULL,
            \`cap_nhat_luc\` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          );
        `);

        const defaultSettings = [
          ['ai_openai', '0', 'Sử dụng OpenAI Vision API (0: Disable, 1: Enable)'],
          ['ai_gemini', '0', 'Sử dụng Google Gemini Vision API (0: Disable, 1: Enable)'],
          ['ai_custom', '1', 'Sử dụng Custom Local LLM Gateway (0: Disable, 1: Enable)'],
          ['ai_custom_url', 'http://localhost:20128/v1', 'URL Custom LLM Gateway'],
          ['ai_custom_model', 'ag/gemini-3.7-flash-medium', 'Tên Model trên Custom LLM Gateway'],
          ['ai_custom_key', 'sk-custom-test', 'API Key trên Custom LLM Gateway']
        ];

        for (const [k, v, note] of defaultSettings) {
          await connection.query(
            `INSERT IGNORE INTO setting (\`key\`, \`value\`, \`ghi_chu\`) VALUES (?, ?, ?)`,
            [k, v, note]
          );
        }
      } catch (settingErr) {
        console.warn('Could not initialize setting table:', settingErr.message);
      }

      // Ensure danh_muc_loai_phieu table exists and is seeded with standard voucher types
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS danh_muc_loai_phieu (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ma_he_thong VARCHAR(50) UNIQUE NOT NULL,
            ten_loai_phieu VARCHAR(255) NOT NULL,
            ma_loai_phieu VARCHAR(50) NOT NULL,
            do_dai_chuoi_so INT NOT NULL DEFAULT 5,
            theo_nam TINYINT(1) NOT NULL DEFAULT 1,
            bang_du_lieu VARCHAR(100) NOT NULL,
            mo_ta TEXT NULL,
            thu_tu INT DEFAULT 0,
            trang_thai VARCHAR(50) DEFAULT 'Hoat_Dong',
            thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
            thoi_gian_cap_nhat DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          );
        `);

        // Check if do_dai_chuoi_so and theo_nam exist (migration for existing database)
        try {
          const [checkCols] = await connection.query(`SHOW COLUMNS FROM danh_muc_loai_phieu LIKE 'do_dai_chuoi_so'`);
          if (checkCols.length === 0) {
            await connection.query(`ALTER TABLE danh_muc_loai_phieu ADD COLUMN do_dai_chuoi_so INT NOT NULL DEFAULT 5 AFTER ma_loai_phieu`);
          }
          const [checkTheoNam] = await connection.query(`SHOW COLUMNS FROM danh_muc_loai_phieu LIKE 'theo_nam'`);
          if (checkTheoNam.length === 0) {
            await connection.query(`ALTER TABLE danh_muc_loai_phieu ADD COLUMN theo_nam TINYINT(1) NOT NULL DEFAULT 1 AFTER do_dai_chuoi_so`);
          }
        } catch (colErr) {
          // Ignore if error checking column
        }

        const defaultVoucherTypes = [
          ['DH', 'Đơn hàng bán (POS / Bán lẻ)', 'DH', 5, 1, 'don_hang', 'Mã đơn hàng bán lẻ / POS', 1],
          ['XK', 'Phiếu xuất kho', 'XK', 5, 1, 'phieu_xuat_kho', 'Phiếu xuất kho bán hàng / cấp công trình', 2],
          ['NK', 'Phiếu nhập kho', 'NK', 5, 1, 'phieu_nhap_kho', 'Phiếu nhập kho mua hàng / trả lại', 3],
          ['PT', 'Phiếu thu tiền', 'PT', 5, 1, 'phieu_thu_chi', 'Phiếu thu tiền sổ quỹ', 4],
          ['PC', 'Phiếu chi tiền', 'PC', 5, 1, 'phieu_thu_chi', 'Phiếu chi tiền sổ quỹ', 5],
          ['MH', 'Phiếu mua hàng (PO)', 'MH', 5, 1, 'phieu_mua_hang', 'Phiếu đặt mua hàng / vật tư', 6],
          ['TK', 'Phiếu trả lại kho', 'TK', 5, 1, 'phieu_tra_lai_kho', 'Phiếu thu hồi / trả lại kho', 7],
          ['YCMH', 'Phiếu yêu cầu mua hàng', 'YCMH', 5, 1, 'yeu_cau_mua_hang', 'Phiếu đề xuất mua sắm vật tư', 8],
          ['YCVT', 'Phiếu yêu cầu vật tư', 'YCVT', 5, 1, 'yeu_cau_vat_tu', 'Phiếu yêu cầu cấp vật tư công trình', 9],
          ['CK', 'Phiếu chuyển kho nội bộ', 'CK', 5, 1, 'phieu_chuyen_kho_noi_bo', 'Phiếu điều chuyển giữa 2 kho', 10],
          ['DC', 'Phiếu điều chuyển vật tư', 'DC', 5, 1, 'phieu_dieu_chuyen_vat_tu', 'Phiếu điều chuyển vật tư công trình', 11],
          ['SD', 'Phiếu sử dụng vật tư', 'SD', 5, 1, 'phieu_su_dung_vat_tu', 'Phiếu nghiệm thu vật tư đưa vào sử dụng', 12],
          ['HH', 'Phiếu hao hụt vật tư', 'HH', 5, 1, 'phieu_hao_hut_vat_tu', 'Phiếu báo cáo hao hụt, hư hỏng', 13],
          ['DNTT', 'Phiếu đề nghị thanh toán', 'DNTT', 5, 1, 'de_nghi_thanh_toan', 'Phiếu đề nghị thanh toán công nợ/chi phí', 14],
          ['HD', 'Hợp đồng kinh tế', 'HD', 5, 1, 'hop_dong', 'Hợp đồng thi công / thương mại', 15],
          ['KK', 'Phiếu kiểm kê kho', 'KK', 5, 1, 'kiem_ke_kho', 'Phiếu kiểm kê kho hàng định kỳ', 16]
        ];

        for (const [sysCode, name, prefix, digits, yearly, table, note, order] of defaultVoucherTypes) {
          await connection.query(
            `INSERT IGNORE INTO danh_muc_loai_phieu (ma_he_thong, ten_loai_phieu, ma_loai_phieu, do_dai_chuoi_so, theo_nam, bang_du_lieu, mo_ta, thu_tu) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [sysCode, name, prefix, digits, yearly, table, note, order]
          );
        }
        console.log('Successfully created/checked danh_muc_loai_phieu table.');
      } catch (loaiPhieuErr) {
        console.warn('Could not initialize danh_muc_loai_phieu table:', loaiPhieuErr.message);
      }

      // Seed default vehicle types if danh_muc_loai_xe is empty
      try {
        const [vTypes] = await connection.query('SELECT id FROM danh_muc_loai_xe LIMIT 1');
        if (vTypes.length === 0) {
          const defaultTypes = [
            'Xe Tải 5 Tấn',
            'Xe Tải 8 Tấn',
            'Xe Tải 15 Tấn',
            'Xe Đầu Kéo',
            'Xe Bơm Bê Tông',
            'Xe Trộn Bê Tông',
            'Xe Cẩu Chuyên Dụng'
          ];
          for (const t of defaultTypes) {
            await connection.query(
              'INSERT INTO danh_muc_loai_xe (ten_loai_xe, mo_ta, nguoi_tao) VALUES (?, ?, ?)',
              [t, 'Hệ thống tự động khởi tạo', 'Hệ thống']
            );
          }
          console.log('Default vehicle types seeded successfully.');
        }
      } catch (typeErr) {
        console.warn('Error seeding danh_muc_loai_xe: ', typeErr.message);
      }

      // Initialize thong_bao_de_nghi_thanh_toan table for payment request notifications
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS thong_bao_de_nghi_thanh_toan (
            id INT AUTO_INCREMENT PRIMARY KEY,
            id_de_nghi_thanh_toan INT NOT NULL,
            ma_phieu VARCHAR(50) NOT NULL,
            nguoi_nhan VARCHAR(100) NOT NULL,
            loai_thong_bao VARCHAR(50) NOT NULL,
            tieu_de VARCHAR(255) NOT NULL,
            noi_dung TEXT NULL,
            da_xem TINYINT(1) DEFAULT 0,
            thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_nguoi_nhan_da_xem (nguoi_nhan, da_xem),
            INDEX idx_dntt (id_de_nghi_thanh_toan)
          );
        `);
      } catch (tbErr) {
        console.warn('Could not initialize thong_bao_de_nghi_thanh_toan table:', tbErr.message);
      }

      // Seed default users if table is empty
      const [users] = await connection.query('SELECT id FROM nguoi_dung LIMIT 1');
      if (users.length === 0) {
        const bcrypt = require('bcryptjs');
        const defaultUsers = [
          { user: 'admin', pass: 'admin123', name: 'Quản trị viên hệ thống', role: 'Admin,Ban_Giam_Doc' },
          { user: 'director', pass: 'director123', name: 'Giám đốc Ban Vũ', role: 'Ban_Giam_Doc' },
          { user: 'accountant', pass: 'accountant123', name: 'Kế toán Trưởng', role: 'Ke_Toan' },
          { user: 'planning', pass: 'planning123', name: 'Trưởng phòng Kế hoạch', role: 'Ke_Hoach' },
          { user: 'technical', pass: 'technical123', name: 'Trưởng phòng Kỹ thuật', role: 'Ky_Thuat' },
          { user: 'materials', pass: 'materials123', name: 'Quản lý Vật tư', role: 'Vat_Tu' },
          { user: 'sales', pass: 'sales123', name: 'Quản lý Kinh doanh', role: 'Kinh_Doanh' }
        ];

        for (const u of defaultUsers) {
          const salt = await bcrypt.genSalt(10);
          const hashed = await bcrypt.hash(u.pass, salt);
          await connection.query(
            'INSERT INTO nguoi_dung (ten_dang_nhap, mat_khau, ho_ten, vai_tro, nguoi_tao) VALUES (?, ?, ?, ?, ?)',
            [u.user, hashed, u.name, u.role, 'Hệ thống']
          );
        }
        console.log('Default users seeded successfully.');
      }
    }
  } catch (err) {
    console.error('Error initializing database: ', err.message);
  } finally {
    if (connection) connection.release();
  }
}

module.exports = {
  pool,
  initializeDatabase
};
