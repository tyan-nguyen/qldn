const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrateTheoNam() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026'
  });

  console.log('--- STARTING MIGRATION FOR theo_nam in danh_muc_loai_phieu ---');

  // Check if theo_nam column exists
  const [cols] = await connection.query(`SHOW COLUMNS FROM danh_muc_loai_phieu LIKE 'theo_nam'`);
  if (cols.length === 0) {
    console.log('Adding column theo_nam to danh_muc_loai_phieu...');
    await connection.query(`
      ALTER TABLE danh_muc_loai_phieu 
      ADD COLUMN theo_nam TINYINT(1) NOT NULL DEFAULT 1 AFTER do_dai_chuoi_so
    `);
    console.log('Successfully added theo_nam column.');
  } else {
    console.log('Column theo_nam already exists.');
  }

  // Ensure default value is 1 for all existing rows if null
  await connection.query(`UPDATE danh_muc_loai_phieu SET theo_nam = 1 WHERE theo_nam IS NULL`);

  const [all] = await connection.query(`SELECT id, ma_he_thong, ma_loai_phieu, do_dai_chuoi_so, theo_nam, ten_loai_phieu FROM danh_muc_loai_phieu ORDER BY thu_tu ASC`);
  console.log('Current danh_muc_loai_phieu rows:');
  console.table(all);

  await connection.end();
  console.log('--- MIGRATION COMPLETED SUCCESSFULLY ---');
}

migrateTheoNam().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
