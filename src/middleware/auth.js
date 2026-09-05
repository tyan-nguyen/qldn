const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'bv_secret_key_2026_jwt_token_secure';

function authMiddleware(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
  } else if (req.query && (req.query.token || req.query.auth_token)) {
    token = req.query.token || req.query.auth_token;
  }

  if (!token) {
    return res.status(401).json({ message: 'Không tìm thấy mã xác thực. Vui lòng đăng nhập.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, ten_dang_nhap, vai_tro }
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Mã xác thực không hợp lệ hoặc đã hết hạn.' });
  }
}

// Role authorization builder
function authorize(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Chưa được xác thực.' });
    }

    // Split user roles string into array
    const userRoles = Array.isArray(req.user.vai_tro)
      ? req.user.vai_tro
      : (req.user.vai_tro ? req.user.vai_tro.split(',') : []);

    // Check if user has Admin role (super admin override) or any allowed role
    const hasPermission = userRoles.includes('Admin') || allowedRoles.some(r => userRoles.includes(r));

    if (!hasPermission) {
      return res.status(403).json({
        message: `Bạn không có quyền thực hiện hành động này. Yêu cầu một trong các quyền: ${allowedRoles.join(', ')}.`
      });
    }

    next();
  };
}

module.exports = {
  authMiddleware,
  authorize
};
