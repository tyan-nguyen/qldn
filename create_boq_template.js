const xlsx = require('xlsx');
const path = require('path');

const data = [
  {
    'Mã Hạng Mục': 'VT-001',
    'Tên Hạng Mục / Vật Tư': 'Xi măng Hà Tiên Đa Dụng',
    'Đơn Vị Tính': 'Bao',
    'Số Lượng Dự Toán': 500,
    'Đơn Giá Dự Toán': 85000,
    'Phân Loại': 'Vat_Tu',
    'Mã Chi Phí Khác (nếu có)': ''
  },
  {
    'Mã Hạng Mục': 'VT-002',
    'Tên Hạng Mục / Vật Tư': 'Cát xây tô',
    'Đơn Vị Tính': 'Khối',
    'Số Lượng Dự Toán': 150,
    'Đơn Giá Dự Toán': 350000,
    'Phân Loại': 'Vat_Tu',
    'Mã Chi Phí Khác (nếu có)': ''
  },
  {
    'Mã Hạng Mục': 'NC-001',
    'Tên Hạng Mục / Vật Tư': 'Nhân công xây tường',
    'Đơn Vị Tính': 'Công',
    'Số Lượng Dự Toán': 30,
    'Đơn Giá Dự Toán': 400000,
    'Phân Loại': 'Nhan_Cong',
    'Mã Chi Phí Khác (nếu có)': ''
  },
  {
    'Mã Hạng Mục': 'CM-001',
    'Tên Hạng Mục / Vật Tư': 'Ca máy trộn bê tông',
    'Đơn Vị Tính': 'Ca',
    'Số Lượng Dự Toán': 10,
    'Đơn Giá Dự Toán': 1200000,
    'Phân Loại': 'Ca_May',
    'Mã Chi Phí Khác (nếu có)': ''
  },
  {
    'Mã Hạng Mục': 'CP-001',
    'Tên Hạng Mục / Vật Tư': 'Chi phí quản lý dự án',
    'Đơn Vị Tính': 'Gói',
    'Số Lượng Dự Toán': 1,
    'Đơn Giá Dự Toán': 15000000,
    'Phân Loại': 'Chi_Phi_Khac',
    'Mã Chi Phí Khác (nếu có)': 'QLDA'
  }
];

const ws = xlsx.utils.json_to_sheet(data);

ws['!cols'] = [
  { wch: 15 },
  { wch: 40 },
  { wch: 15 },
  { wch: 20 },
  { wch: 20 },
  { wch: 15 },
  { wch: 25 },
];

const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, ws, 'BOQ_Template');

// Save the file to workspace root
const rootPath = path.join(__dirname, '..', 'Mau_Import_BOQ.xlsx');
xlsx.writeFile(wb, rootPath);
console.log('Successfully created Excel template at:', rootPath);
