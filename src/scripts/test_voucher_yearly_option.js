const mysql = require('mysql2/promise');
require('dotenv').config();
const { generateSequenceNumber } = require('../services/sequenceService');

async function testVoucherYearlyOption() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026'
  });

  console.log('--- TESTING theo_nam OPTION IN SEQUENCE GENERATION ---');

  // Test 1: theo_nam = 1 (default) for NK
  await connection.query('UPDATE danh_muc_loai_phieu SET theo_nam = 1, do_dai_chuoi_so = 5 WHERE ma_he_thong = "NK"');
  const seqNK1 = await generateSequenceNumber(connection, {
    loai_chung_tu: 'NK',
    id_linh_vuc_kinh_doanh: 1,
    nam: 2026
  });
  console.log('Test 1 (NK with theo_nam = 1):', seqNK1.ma_phieu);
  console.assert(seqNK1.ma_phieu.includes('26'), 'Expected code to contain year 26');

  // Test 2: theo_nam = 0 (no year) for NK
  await connection.query('UPDATE danh_muc_loai_phieu SET theo_nam = 0, do_dai_chuoi_so = 5 WHERE ma_he_thong = "NK"');
  const seqNK0 = await generateSequenceNumber(connection, {
    loai_chung_tu: 'NK',
    id_linh_vuc_kinh_doanh: 1,
    nam: 2026
  });
  console.log('Test 2 (NK with theo_nam = 0):', seqNK0.ma_phieu);
  console.assert(!seqNK0.ma_phieu.includes('NK26'), 'Expected code NOT to contain year NK26');
  console.assert(seqNK0.ma_phieu.startsWith('VLNK0'), 'Expected code to start with VLNK0');

  // Test 3: theo_nam = 0 for XK with 4 digits
  await connection.query('UPDATE danh_muc_loai_phieu SET theo_nam = 0, do_dai_chuoi_so = 4 WHERE ma_he_thong = "XK"');
  const seqXK = await generateSequenceNumber(connection, {
    loai_chung_tu: 'XK',
    id_linh_vuc_kinh_doanh: 1,
    nam: 2026
  });
  console.log('Test 3 (XK with theo_nam = 0 & 4 digits):', seqXK.ma_phieu);
  console.assert(!seqXK.ma_phieu.includes('XK26'), 'Expected code NOT to contain year XK26');
  console.assert(seqXK.ma_phieu.startsWith('VLXK0'), 'Expected code to start with VLXK0');

  // Test 4: theo_nam = 1 for DH with 6 digits
  await connection.query('UPDATE danh_muc_loai_phieu SET ma_loai_phieu = "DH", theo_nam = 1, do_dai_chuoi_so = 6 WHERE ma_he_thong = "DH"');
  const seqDH = await generateSequenceNumber(connection, {
    loai_chung_tu: 'DH',
    id_linh_vuc_kinh_doanh: 1,
    nam: 2026
  });
  console.log('Test 4 (DH with theo_nam = 1 & 6 digits):', seqDH.ma_phieu);
  console.assert(seqDH.ma_phieu.includes('DH26'), 'Expected code to contain DH26');

  // Restore clean default state
  await connection.query('UPDATE danh_muc_loai_phieu SET ma_loai_phieu = ma_he_thong, do_dai_chuoi_so = 5, theo_nam = 1 WHERE ma_he_thong != "DH"');
  await connection.query('UPDATE danh_muc_loai_phieu SET ma_loai_phieu = "", do_dai_chuoi_so = 5, theo_nam = 1 WHERE ma_he_thong = "DH"');

  await connection.end();
  console.log('--- ALL theo_nam TESTS PASSED SUCCESSFULLY! ---');
}

testVoucherYearlyOption().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
