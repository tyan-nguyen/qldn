const { pool } = require('../config/db');

/**
 * Service cấp số vào sổ (so_vao_so) và sinh mã chứng từ chính thức
 * Đảm bảo transaction/locking chống trùng số khi nhiều người thao tác đồng thời.
 * Quy tắc đặt mã: [Mã LVKD] + [Mã Loại Phiếu] + [2 số cuối của Năm] + [Số thứ tự 5 chữ số, e.g. 00001, nếu > 5 chữ số thì giữ nguyên]
 */

async function generateSequenceNumber(connOrOptions, maybeOptions) {
  let connection = connOrOptions;
  let options = maybeOptions;

  if (!connOrOptions || !connOrOptions.query) {
    // If first argument is not a connection, treat it as options
    options = connOrOptions || {};
    connection = pool;
  }

  const { id_linh_vuc_kinh_doanh, loai_chung_tu, nam, ma_lvkd } = options || {};
  let tableName = 'yeu_cau_vat_tu';
  let lvkdCol = 'id_linh_vuc_kinh_doanh';
  let namCol = 'nam';
  let prefixType = (loai_chung_tu || 'CT').toUpperCase().trim();
  let extraCondition = '';

  const normalizedType = prefixType;

  let sysCode = 'YCVT';
  if (normalizedType === 'DH') {
    tableName = 'don_hang';
    lvkdCol = 'id_lvkd';
    namCol = 'nam_vao_so';
    prefixType = 'DH';
    sysCode = 'DH';
  } else if (normalizedType === 'XK') {
    tableName = 'phieu_xuat_kho';
    prefixType = 'XK';
    sysCode = 'XK';
  } else if (normalizedType === 'NK') {
    tableName = 'phieu_nhap_kho';
    prefixType = 'NK';
    sysCode = 'NK';
  } else if (normalizedType === 'PT') {
    tableName = 'phieu_thu_chi';
    prefixType = 'PT';
    sysCode = 'PT';
    extraCondition = " AND loai_phieu = 'Phieu_Thu'";
  } else if (normalizedType === 'PC') {
    tableName = 'phieu_thu_chi';
    prefixType = 'PC';
    sysCode = 'PC';
    extraCondition = " AND loai_phieu = 'Phieu_Chi'";
  } else if (normalizedType === 'CK') {
    tableName = 'phieu_chuyen_kho_noi_bo';
    prefixType = 'CK';
    sysCode = 'CK';
  } else if (normalizedType === 'YCMH') {
    tableName = 'yeu_cau_mua_hang';
    prefixType = 'YCMH';
    sysCode = 'YCMH';
  } else if (normalizedType === 'MH' || normalizedType === 'PMH') {
    tableName = 'phieu_mua_hang';
    prefixType = 'MH';
    sysCode = 'MH';
  } else if (normalizedType === 'DC') {
    tableName = 'phieu_dieu_chuyen_vat_tu';
    prefixType = 'DC';
    sysCode = 'DC';
  } else if (normalizedType === 'SD') {
    tableName = 'phieu_su_dung_vat_tu';
    prefixType = 'SD';
    sysCode = 'SD';
  } else if (normalizedType === 'TK' || normalizedType === 'TLK') {
    tableName = 'phieu_tra_lai_kho';
    prefixType = 'TK';
    sysCode = 'TK';
  } else if (normalizedType === 'HD') {
    tableName = 'hop_dong';
    prefixType = 'HD';
    sysCode = 'HD';
  } else if (normalizedType === 'HH') {
    tableName = 'phieu_hao_hut_vat_tu';
    prefixType = 'HH';
    sysCode = 'HH';
  } else if (normalizedType === 'DNTT') {
    tableName = 'de_nghi_thanh_toan';
    prefixType = 'DNTT';
    sysCode = 'DNTT';
  } else if (normalizedType === 'KK') {
    tableName = 'kiem_ke_kho';
    prefixType = 'KK';
    sysCode = 'KK';
  } else if (normalizedType === 'YCVT' || normalizedType === 'VT' || normalizedType === 'CT') {
    tableName = 'yeu_cau_vat_tu';
    prefixType = 'YCVT';
    sysCode = 'YCVT';
  }

  let numDigits = 5;
  let isYearly = true;

  // Tra cứu mã loại phiếu, độ dài chuỗi số và tùy chọn đánh số theo năm động từ danh_muc_loai_phieu trong database
  try {
    const [cfgRows] = await connection.query(
      'SELECT ma_loai_phieu, do_dai_chuoi_so, theo_nam FROM danh_muc_loai_phieu WHERE ma_he_thong = ? AND (trang_thai = "Hoat_Dong" OR trang_thai IS NULL) LIMIT 1',
      [sysCode]
    );
    if (cfgRows.length > 0) {
      if (cfgRows[0].ma_loai_phieu !== null && cfgRows[0].ma_loai_phieu !== undefined) {
        prefixType = cfgRows[0].ma_loai_phieu.trim().toUpperCase();
      }
      if (cfgRows[0].do_dai_chuoi_so && parseInt(cfgRows[0].do_dai_chuoi_so, 10) > 0) {
        numDigits = parseInt(cfgRows[0].do_dai_chuoi_so, 10);
      }
      if (cfgRows[0].theo_nam !== undefined && cfgRows[0].theo_nam !== null) {
        isYearly = Boolean(cfgRows[0].theo_nam) && cfgRows[0].theo_nam !== 0 && String(cfgRows[0].theo_nam) !== '0';
      }
    }
  } catch (e) {
    // Fallback sang mặc định nếu bảng chưa tồn tại
  }

  const effectiveYear = parseInt(nam, 10) || new Date().getFullYear();
  const effectiveLvkdId = parseInt(id_linh_vuc_kinh_doanh, 10) || 1;
  const yearShort = String(effectiveYear).slice(-2);

  // Dynamically check existing columns in the table to prevent SQL errors
  let hasLvkd = true;
  let hasNam = true;
  let hasSoVaoSo = true;

  try {
    const [cols] = await connection.query(`SHOW COLUMNS FROM ${tableName}`);
    const colNames = cols.map(c => c.Field);
    if (!colNames.includes(lvkdCol)) hasLvkd = false;
    if (!colNames.includes(namCol)) hasNam = false;
    if (!colNames.includes('so_vao_so')) hasSoVaoSo = false;
  } catch (e) {
    // If SHOW COLUMNS fails, proceed with default
  }

  let query = `SELECT COALESCE(MAX(so_vao_so), 0) AS max_so FROM ${tableName} WHERE 1=1`;
  const params = [];
  if (hasLvkd) {
    query += ` AND (${lvkdCol} = ? OR ${lvkdCol} IS NULL)`;
    params.push(effectiveLvkdId);
  }
  // Chỉ lọc theo năm khi loại phiếu được cấu hình đánh số theo năm
  if (hasNam && isYearly) {
    query += ` AND (${namCol} = ? OR ${namCol} IS NULL)`;
    params.push(effectiveYear);
  }
  query += ` ${extraCondition} FOR UPDATE`;

  let nextSo = 1;
  if (hasSoVaoSo) {
    const [rows] = await connection.query(query, params);
    nextSo = (rows[0]?.max_so || 0) + 1;
  } else {
    const [cntRows] = await connection.query(`SELECT COUNT(*) AS total FROM ${tableName}`);
    nextSo = (cntRows[0]?.total || 0) + 1;
  }

  // Format so_vao_so with leading zeroes based on configured do_dai_chuoi_so (default 5 digits)
  let formattedSo = String(nextSo);
  if (formattedSo.length < numDigits) {
    formattedSo = formattedSo.padStart(numDigits, '0');
  }

  // Lấy mã LVKD nếu chưa truyền
  let prefixLvkd = (ma_lvkd || '').toUpperCase().trim();
  if (!prefixLvkd && effectiveLvkdId) {
    try {
      const [lvkdRows] = await connection.query('SELECT ma_lvkd FROM linh_vuc_kinh_doanh WHERE id = ?', [effectiveLvkdId]);
      if (lvkdRows.length > 0 && lvkdRows[0].ma_lvkd) {
        prefixLvkd = lvkdRows[0].ma_lvkd.toUpperCase().trim();
      }
    } catch (e) {
      console.warn('Cannot fetch ma_lvkd:', e.message);
    }
  }
  if (!prefixLvkd) {
    prefixLvkd = 'VLXD';
  }

  // Quy tắc đặt mã phiếu: [mã LVKD] + [loai_chung_tu] + [2 số cuối năm nếu theo_nam = 1] + [Số thứ tự format theo do_dai_chuoi_so]
  const yearPart = isYearly ? yearShort : '';
  const maPhieu = `${prefixLvkd}${prefixType}${yearPart}${formattedSo}`;

  return {
    so_vao_so: nextSo,
    ma_phieu: maPhieu
  };
}

module.exports = {
  generateSequenceNumber
};

