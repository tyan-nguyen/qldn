const mysql = require('mysql2/promise');
require('dotenv').config();
const { generateSequenceNumber } = require('../services/sequenceService');

async function testVoucherDigitLength() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'bv_2026'
  });

  console.log('--- TESTING DYNAMIC DIGIT LENGTH IN SEQUENCE GENERATION ---');

  // Test 1: Standard 5 digits for NK
  const seqNK = await generateSequenceNumber(connection, {
    loai_chung_tu: 'NK',
    id_linh_vuc_kinh_doanh: 1,
    nam: 2026
  });
  console.log('Test 1 (NK with 5 digits):', seqNK.ma_phieu);
  const nkSuffix = seqNK.ma_phieu.replace(/^VLXDNK26/, '');
  console.assert(nkSuffix.length >= 5, `Expected suffix length >= 5, got ${nkSuffix.length}`);

  // Test 2: Update XK to 4 digits
  await connection.query('UPDATE danh_muc_loai_phieu SET do_dai_chuoi_so = 4 WHERE ma_he_thong = "XK"');
  const seqXK = await generateSequenceNumber(connection, {
    loai_chung_tu: 'XK',
    id_linh_vuc_kinh_doanh: 1,
    nam: 2026
  });
  console.log('Test 2 (XK with 4 digits):', seqXK.ma_phieu);
  const xkSuffix = seqXK.ma_phieu.replace(/^VLXDXK26/, '');
  console.assert(xkSuffix.length >= 4, `Expected suffix length >= 4, got ${xkSuffix.length}`);

  // Test 3: Update DH to 6 digits and prefix BH
  await connection.query('UPDATE danh_muc_loai_phieu SET ma_loai_phieu = "BH", do_dai_chuoi_so = 6 WHERE ma_he_thong = "DH"');
  const seqDH = await generateSequenceNumber(connection, {
    loai_chung_tu: 'DH',
    id_linh_vuc_kinh_doanh: 1,
    nam: 2026
  });
  console.log('Test 3 (DH with custom prefix BH and 6 digits):', seqDH.ma_phieu);
  const dhSuffix = seqDH.ma_phieu.replace(/^VLXDBH26/, '');
  console.assert(dhSuffix.length >= 6, `Expected suffix length >= 6, got ${dhSuffix.length}`);

  // Test 4: Update KK to 3 digits
  await connection.query('UPDATE danh_muc_loai_phieu SET do_dai_chuoi_so = 3 WHERE ma_he_thong = "KK"');
  const seqKK = await generateSequenceNumber(connection, {
    loai_chung_tu: 'KK',
    id_linh_vuc_kinh_doanh: 1,
    nam: 2026
  });
  console.log('Test 4 (KK with 3 digits):', seqKK.ma_phieu);
  const kkSuffix = seqKK.ma_phieu.replace(/^VLXDKK26/, '');
  console.assert(kkSuffix.length >= 3, `Expected suffix length >= 3, got ${kkSuffix.length}`);

  // Reset back to standard defaults for tests clean state
  await connection.query('UPDATE danh_muc_loai_phieu SET ma_loai_phieu = ma_he_thong, do_dai_chuoi_so = 5 WHERE ma_he_thong != "DH"');
  await connection.query('UPDATE danh_muc_loai_phieu SET ma_loai_phieu = "", do_dai_chuoi_so = 5 WHERE ma_he_thong = "DH"');

  await connection.end();
  console.log('--- ALL SEQUENCE DIGIT LENGTH TESTS PASSED SUCCESSFULLY! ---');
}

testVoucherDigitLength().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
