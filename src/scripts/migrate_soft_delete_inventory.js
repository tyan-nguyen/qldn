const { pool } = require('../config/db');

async function migrateSoftDeleteInventory() {
  console.log('--- Bắt đầu Migration: Thêm da_xoa vào danh_muc_vat_tu, kho_hang, danh_muc_loai_vat_tu ---');
  try {
    // 1. Check & add da_xoa to danh_muc_vat_tu
    const [colsVatTu] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'danh_muc_vat_tu'
        AND COLUMN_NAME = 'da_xoa'
    `);
    if (colsVatTu.length === 0) {
      await pool.query(`
        ALTER TABLE danh_muc_vat_tu
        ADD COLUMN da_xoa TINYINT(1) NOT NULL DEFAULT 0 AFTER thoi_gian_tao
      `);
      console.log('✅ Đã thêm cột da_xoa vào bảng danh_muc_vat_tu.');
    } else {
      console.log('ℹ️ Cột da_xoa đã tồn tại trong danh_muc_vat_tu.');
    }

    // 2. Check & add da_xoa to kho_hang
    const [colsKho] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'kho_hang'
        AND COLUMN_NAME = 'da_xoa'
    `);
    if (colsKho.length === 0) {
      await pool.query(`
        ALTER TABLE kho_hang
        ADD COLUMN da_xoa TINYINT(1) NOT NULL DEFAULT 0 AFTER thoi_gian_tao
      `);
      console.log('✅ Đã thêm cột da_xoa vào bảng kho_hang.');
    } else {
      console.log('ℹ️ Cột da_xoa đã tồn tại trong kho_hang.');
    }

    // 3. Check & add da_xoa to danh_muc_loai_vat_tu
    const [colsLoai] = await pool.query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'danh_muc_loai_vat_tu'
        AND COLUMN_NAME = 'da_xoa'
    `);
    if (colsLoai.length === 0) {
      await pool.query(`
        ALTER TABLE danh_muc_loai_vat_tu
        ADD COLUMN da_xoa TINYINT(1) NOT NULL DEFAULT 0 AFTER thoi_gian_tao
      `);
      console.log('✅ Đã thêm cột da_xoa vào bảng danh_muc_loai_vat_tu.');
    } else {
      console.log('ℹ️ Cột da_xoa đã tồn tại trong danh_muc_loai_vat_tu.');
    }

    console.log('🎉 Hoàn thành migration soft delete vật tư & kho bãi!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Lỗi migration:', err);
    process.exit(1);
  }
}

migrateSoftDeleteInventory();
