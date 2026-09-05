const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrateDonHangCancelFields() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026'
  });

  console.log('--- MIGRATING don_hang CANCEL FIELDS ---');

  const [cols] = await connection.query('SHOW COLUMNS FROM don_hang');
  const colNames = cols.map(c => c.Field);

  if (!colNames.includes('ghi_chu')) {
    console.log('Adding ghi_chu to don_hang...');
    await connection.query('ALTER TABLE don_hang ADD COLUMN ghi_chu TEXT NULL');
  }

  if (!colNames.includes('ngay_huy')) {
    console.log('Adding ngay_huy to don_hang...');
    await connection.query('ALTER TABLE don_hang ADD COLUMN ngay_huy DATETIME NULL');
  }

  if (!colNames.includes('nguoi_huy')) {
    console.log('Adding nguoi_huy to don_hang...');
    await connection.query('ALTER TABLE don_hang ADD COLUMN nguoi_huy VARCHAR(100) NULL');
  }

  if (!colNames.includes('ly_do_huy')) {
    console.log('Adding ly_do_huy to don_hang...');
    await connection.query('ALTER TABLE don_hang ADD COLUMN ly_do_huy TEXT NULL');
  }

  console.log('--- MIGRATION FINISHED SUCCESSFULLY ---');
  await connection.end();
}

migrateDonHangCancelFields().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
