const { pool: db } = require('../config/db');

async function migrateSequenceColumns() {
  const tables = [
    'yeu_cau_mua_hang',
    'phieu_mua_hang',
    'phieu_dieu_chuyen_vat_tu',
    'phieu_su_dung_vat_tu',
    'phieu_tra_lai_kho',
    'phieu_hao_hut_vat_tu'
  ];

  for (const table of tables) {
    try {
      await db.query(`ALTER TABLE ${table} ADD COLUMN so_vao_so INT DEFAULT 0`);
      console.log(`Added so_vao_so to ${table}`);
    } catch (e) {
      if (!e.message.includes('Duplicate column')) {
        console.log(`${table}.so_vao_so:`, e.message);
      }
    }

    try {
      await db.query(`ALTER TABLE ${table} ADD COLUMN nam INT NULL`);
      console.log(`Added nam to ${table}`);
    } catch (e) {
      if (!e.message.includes('Duplicate column')) {
        console.log(`${table}.nam:`, e.message);
      }
    }
  }

  console.log('Finished migrating sequence columns!');
  process.exit(0);
}

migrateSequenceColumns().catch(err => {
  console.error(err);
  process.exit(1);
});
