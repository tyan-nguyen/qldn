const { pool } = require('../config/db');

async function migrate() {
  console.log('--- Bắt đầu Migration: Thêm da_xoa vào linh_vuc_kinh_doanh và quy_tien ---');
  const conn = await pool.getConnection();
  try {
    // 1. Check & add da_xoa to linh_vuc_kinh_doanh
    const [lvkdCols] = await conn.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'linh_vuc_kinh_doanh' 
        AND COLUMN_NAME = 'da_xoa'
    `);
    if (lvkdCols.length === 0) {
      await conn.query(`
        ALTER TABLE linh_vuc_kinh_doanh 
        ADD COLUMN da_xoa TINYINT(1) NOT NULL DEFAULT 0 AFTER nguoi_tao
      `);
      console.log('✅ Đã thêm cột da_xoa vào bảng linh_vuc_kinh_doanh.');
    } else {
      console.log('ℹ️ Cột da_xoa đã tồn tại trong linh_vuc_kinh_doanh.');
    }

    // 2. Check & add da_xoa to quy_tien
    const [quyCols] = await conn.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'quy_tien' 
        AND COLUMN_NAME = 'da_xoa'
    `);
    if (quyCols.length === 0) {
      await conn.query(`
        ALTER TABLE quy_tien 
        ADD COLUMN da_xoa TINYINT(1) NOT NULL DEFAULT 0 AFTER trang_thai
      `);
      console.log('✅ Đã thêm cột da_xoa vào bảng quy_tien.');
    } else {
      console.log('ℹ️ Cột da_xoa đã tồn tại trong quy_tien.');
    }

    console.log('--- Hoàn tất Migration thành công! ---');
  } catch (err) {
    console.error('❌ Lỗi migration:', err);
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
