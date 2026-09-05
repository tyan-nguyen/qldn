/**
 * Helper to record operation audit logs (Logs thay đổi dữ liệu)
 * @param {object} connection - MySQL connection or pool transaction instance
 * @param {string} ten_bang - Table name
 * @param {number} id_ban_ghi - Record ID
 * @param {string} hanh_dong - Action type ('THEM_MOI', 'CAP_NHAT', 'XOA')
 * @param {object|null} du_lieu_cu - Previous state of the row
 * @param {object|null} du_lieu_moi - New state of the row
 * @param {string} nguoi_tao - User who performed the action
 */
async function logChange(connection, ten_bang, id_ban_ghi, hanh_dong, du_lieu_cu, du_lieu_moi, nguoi_tao) {
  try {
    const query = `
      INSERT INTO nhat_ky_thao_tac (ten_bang, id_ban_ghi, hanh_dong, du_lieu_cu, du_lieu_moi, nguoi_tao)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const oldStr = du_lieu_cu ? JSON.stringify(du_lieu_cu) : null;
    const newStr = du_lieu_moi ? JSON.stringify(du_lieu_moi) : null;

    await connection.query(query, [
      ten_bang,
      id_ban_ghi,
      hanh_dong,
      oldStr,
      newStr,
      nguoi_tao || 'Hệ thống'
    ]);
  } catch (err) {
    console.error('Lỗi khi ghi nhật ký thao tác:', err.message);
  }
}

module.exports = {
  logChange
};
