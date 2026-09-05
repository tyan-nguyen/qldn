-- 33. Bảng quản lý tập tin / hình ảnh tập trung hệ thống
CREATE TABLE IF NOT EXISTS files (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ten_bang VARCHAR(100) NOT NULL,
    id_ban_ghi INT NOT NULL,
    ten_file VARCHAR(255) NOT NULL,
    ten_file_luu VARCHAR(255) NOT NULL,
    loai_file VARCHAR(50) DEFAULT 'other',
    extension VARCHAR(20) DEFAULT '',
    duong_dan VARCHAR(255) NOT NULL,
    kich_thuoc INT DEFAULT 0,
    nguoi_tao VARCHAR(100),
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_files_bang_bangghi (ten_bang, id_ban_ghi)
);

-- 1. Bảng quản lý người dùng hệ thống (RBAC phân tổ theo 6 phòng ban)
CREATE TABLE IF NOT EXISTS nguoi_dung (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ten_dang_nhap VARCHAR(100) UNIQUE NOT NULL,
    mat_khau VARCHAR(255) NOT NULL,
    ho_ten VARCHAR(255) NOT NULL,
    vai_tro VARCHAR(255) NOT NULL, -- Dạng chuỗi phân cách bởi dấu phẩy, e.g., 'Kinh_Doanh,Ke_Toan'
    trang_thai VARCHAR(50) DEFAULT 'Hoat_Dong',
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 1b. Bảng lịch sử đăng nhập/đăng xuất người dùng
CREATE TABLE IF NOT EXISTS nguoi_dung_lich_su (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_nguoi_dung INT NOT NULL,
    ten_dang_nhap VARCHAR(100) NOT NULL,
    ho_ten VARCHAR(255),
    hanh_dong VARCHAR(50) NOT NULL, -- 'Dang_Nhap', 'Dang_Xuat'
    thoi_gian DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng lưu vết thay đổi dữ liệu (Logs)
CREATE TABLE IF NOT EXISTS nhat_ky_thao_tac (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ten_bang VARCHAR(100) NOT NULL,
    id_ban_ghi INT NOT NULL,
    hanh_dong VARCHAR(50) NOT NULL, -- 'THEM_MOI', 'CAP_NHAT', 'XOA'
    du_lieu_cu TEXT,                -- Dạng JSON
    du_lieu_moi TEXT,               -- Dạng JSON
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Danh mục Nhà cung cấp vật tư & Dịch vụ
CREATE TABLE IF NOT EXISTS nha_cung_cap (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ten_nha_cung_cap VARCHAR(255) NOT NULL,
    so_dien_thoai VARCHAR(20),
    dia_chi VARCHAR(255),
    ma_so_thue VARCHAR(50),
    nguoi_dai_dien VARCHAR(100),
    so_tai_khoan VARCHAR(100),
    ten_ngan_hang VARCHAR(255),
    so_ngay_no_toi_da INT DEFAULT 30,
    han_muc_no DECIMAL(15, 2) DEFAULT 0,
    trang_thai VARCHAR(50) DEFAULT 'con_giao_dich',
    da_xoa TINYINT(1) DEFAULT 0,
    no_dau_ky DECIMAL(15, 2) DEFAULT 0,
    ngay_chot_no_dau_ky DATE,
    ghi_chu_no_dau_ky TEXT,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3.1. Công nợ khác / Dịch vụ thủ công NCC (Điện, nước, mạng, sửa chữa máy móc...)
CREATE TABLE IF NOT EXISTS cong_no_khac_ncc (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_chung_tu VARCHAR(50) UNIQUE NOT NULL,
    id_nha_cung_cap INT NOT NULL,
    loai_chi_phi VARCHAR(100) NOT NULL,
    so_hoa_don_vat VARCHAR(100),
    ngay_phat_sinh DATE NOT NULL,
    han_thanh_toan DATE,
    id_cong_trinh INT NULL,
    so_tien DECIMAL(15, 2) NOT NULL,
    da_thanh_toan DECIMAL(15, 2) DEFAULT 0,
    con_lai DECIMAL(15, 2) DEFAULT 0,
    trang_thai_thanh_toan VARCHAR(50) DEFAULT 'chua_thanh_toan',
    dien_giai TEXT NOT NULL,
    ghi_chu TEXT,
    da_xoa TINYINT(1) DEFAULT 0,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_nha_cung_cap) REFERENCES nha_cung_cap(id),
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id)
);

-- 3.2. Chi tiết gạch nợ thanh toán Nhà cung cấp (Cấn trừ PO / Nợ khác)
CREATE TABLE IF NOT EXISTS chi_tiet_gach_no_ncc (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_phieu_thu_chi INT NOT NULL,
    loai_chung_tu_no VARCHAR(50) NOT NULL, -- 'phieu_mua_hang', 'cong_no_khac'
    id_chung_tu_no INT NOT NULL,
    so_tien_khau_tru DECIMAL(15, 2) NOT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Danh sách Khách hàng
CREATE TABLE IF NOT EXISTS khach_hang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ten_khach_hang VARCHAR(255) NOT NULL,
    so_dien_thoai VARCHAR(20),
    dia_chi VARCHAR(255),
    han_muc_tin_dung DECIMAL(15, 2) DEFAULT 0,
    so_ngay_no_toi_da INT DEFAULT 30,
    loai_khach_hang VARCHAR(50) NOT NULL, -- 'Khach_Le', 'To_Chuc'
    ten_cong_ty VARCHAR(255),             -- Dành cho Khách hàng Công ty/Tổ chức
    ten_ngan_hang VARCHAR(255),
    so_tai_khoan VARCHAR(100),
    ma_so_thue VARCHAR(50),
    nguoi_dai_dien VARCHAR(100),
    ghi_chu TEXT,
    trang_thai VARCHAR(50) DEFAULT 'con_giao_dich', -- 'con_giao_dich', 'khong_con_giao_dich'
    da_xoa TINYINT(1) DEFAULT 0,
    no_dau_ky DECIMAL(15, 2) DEFAULT 0,
    ngay_chot_no_dau_ky DATE,
    ghi_chu_no_dau_ky TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Hồ sơ Công trình/Dự án
CREATE TABLE IF NOT EXISTS cong_trinh (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ten_cong_trinh VARCHAR(255) NOT NULL,
    ten_viet_tat VARCHAR(100),
    dia_chi VARCHAR(200),
    id_khach_hang INT,
    tong_ngan_sach DECIMAL(15, 2) DEFAULT 0,
    ngay_bat_dau DATE,
    ngay_ket_thuc DATE,
    trang_thai VARCHAR(50) DEFAULT 'Dang_Thi_Cong',
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_khach_hang) REFERENCES khach_hang(id)
);

-- 6. Hợp đồng Công trình & Bảo lãnh & Tạm ứng (Có lưu ngày hết hạn bảo lãnh phục vụ cảnh báo 15 ngày)
CREATE TABLE IF NOT EXISTS hop_dong (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_cong_trinh INT,
    gia_tri_hop_dong DECIMAL(15, 2) NOT NULL,
    ngay_ky DATE,
    ngay_hieu_luc DATE,
    ngay_het_han DATE,
    gia_tri_tam_ung DECIMAL(15, 2) DEFAULT 0,
    ngay_bao_lanh_tam_ung DATE,
    ngay_het_han_bao_lanh_tam_ung DATE,
    bao_lanh_thuc_hien DECIMAL(15, 2) DEFAULT 0,
    ngay_bao_lanh_thuc_hien DATE,
    ngay_het_han_bao_lanh_thuc_hien DATE,
    bao_hanh_cong_trinh DECIMAL(15, 2) DEFAULT 0,
    ngay_bao_hanh_cong_trinh DATE,
    ngay_het_han_bao_hanh DATE,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id)
);

-- 7. Các đợt thanh toán của Chủ đầu tư cho Công trình
CREATE TABLE IF NOT EXISTS thanh_toan_cong_trinh (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_cong_trinh INT NOT NULL,
    dot_thanh_toan VARCHAR(100) NOT NULL,
    so_tien_thanh_toan DECIMAL(15, 2) NOT NULL,
    ngay_thanh_toan DATE NOT NULL,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id)
);

-- 8. Danh mục Chi phí khác
CREATE TABLE IF NOT EXISTS danh_muc_chi_phi_khac (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_chi_phi VARCHAR(50) UNIQUE NOT NULL,
    ten_chi_phi VARCHAR(255) NOT NULL,
    mo_ta TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. Bảng Dự toán gốc BOQ
CREATE TABLE IF NOT EXISTS du_toan_boq (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_cong_trinh INT,
    id_danh_muc_vat_tu INT NULL,
    ma_hang_muc VARCHAR(50) NOT NULL,
    ten_hang_muc VARCHAR(255) NOT NULL,
    don_vi_tinh VARCHAR(50),
    so_luong_du_toan DECIMAL(12, 2) NOT NULL,
    don_gia_du_toan DECIMAL(15, 2) NOT NULL,
    phan_loai VARCHAR(50) NOT NULL, -- 'Vat_Tu', 'Nhan_Cong', 'Thau_Phu', 'Ca_May', 'Chi_Phi_Khac'
    id_danh_muc_chi_phi_khac INT,
    trang_thai_khoa TINYINT DEFAULT 0,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id),
    FOREIGN KEY (id_danh_muc_vat_tu) REFERENCES danh_muc_vat_tu(id),
    FOREIGN KEY (id_danh_muc_chi_phi_khac) REFERENCES danh_muc_chi_phi_khac(id)
);

-- 10. Danh mục vật tư bán lẻ / cấp phát
CREATE TABLE IF NOT EXISTS danh_muc_vat_tu (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_vat_tu VARCHAR(50) UNIQUE NOT NULL,
    ten_vat_tu VARCHAR(255) NOT NULL,
    don_vi_tinh VARCHAR(50),
    don_gia_tieu_chuan DECIMAL(15, 2) DEFAULT 0,
    id_anh_dai_dien INT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. Danh mục Kho bãi
CREATE TABLE IF NOT EXISTS kho_hang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ten_kho VARCHAR(255) NOT NULL,
    loai_kho VARCHAR(50) NOT NULL, -- 'Kho_Tong', 'Kho_Cong_Trinh'
    id_cong_trinh INT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id)
);

-- 12. Tồn kho chi tiết
CREATE TABLE IF NOT EXISTS ton_kho (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_kho_hang INT,
    id_danh_muc_vat_tu INT,
    so_luong_ton DECIMAL(12, 2) DEFAULT 0,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_kho_hang) REFERENCES kho_hang(id),
    FOREIGN KEY (id_danh_muc_vat_tu) REFERENCES danh_muc_vat_tu(id)
);

-- 13. Nhật ký luân chuyển kho (5 bước)
CREATE TABLE IF NOT EXISTS nhat_ky_kho (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_kho_hang_nguon INT,
    id_kho_hang_dich INT,
    id_danh_muc_vat_tu INT,
    id_nha_cung_cap INT,
    so_luong DECIMAL(12, 2) NOT NULL,
    don_gia DECIMAL(15, 2) DEFAULT 0, -- Giá trị vật tư thực tế tại thời điểm xuất/nhập
    loai_giao_dich VARCHAR(50) NOT NULL, -- 'Nhap_Mua', 'POS_Ban_Le', 'Xuat_Kho_Cong_Trinh', 'Thu_Hoi_Thua'
    trang_thai VARCHAR(50) DEFAULT 'Cho_Nghiem_Thu', -- 'Cho_Nghiem_Thu', 'Da_Nghiem_Thu'
    ngay_thuc_hien DATETIME NOT NULL,
    so_chung_tu VARCHAR(100),
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_kho_hang_nguon) REFERENCES kho_hang(id),
    FOREIGN KEY (id_kho_hang_dich) REFERENCES kho_hang(id),
    FOREIGN KEY (id_danh_muc_vat_tu) REFERENCES danh_muc_vat_tu(id),
    FOREIGN KEY (id_nha_cung_cap) REFERENCES nha_cung_cap(id)
);

-- 14. Phê duyệt vượt hạn mức của Giám đốc (Override)
CREATE TABLE IF NOT EXISTS duyet_vuot_han_muc (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_khach_hang INT,
    so_tien_yeu_cau DECIMAL(15, 2) NOT NULL,
    trang_thai_duyet VARCHAR(50) DEFAULT 'Cho_Duyet',
    ngay_yeu_cau DATETIME NOT NULL,
    ngay_duyet DATETIME,
    nguoi_duyet VARCHAR(100),
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_khach_hang) REFERENCES khach_hang(id)
);

-- 15. Danh sách Đơn hàng của khách (Cho phép ghi đè/sửa giá trực tiếp trên phiếu)
CREATE TABLE IF NOT EXISTS don_hang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_lvkd INT,
    so_vao_so INT DEFAULT NULL,
    nam_vao_so INT DEFAULT NULL,
    ma_don_hang VARCHAR(50) UNIQUE NOT NULL,
    id_khach_hang INT NOT NULL,
    id_duyet_vuot_han_muc INT,
    trang_thai_don_hang VARCHAR(50) DEFAULT 'Nháp',
    trang_thai_thanh_toan VARCHAR(50) DEFAULT 'chưa thanh toán',
    trang_thai_xuat_kho VARCHAR(50) DEFAULT 'chua_xua_kho',
    trang_thai_giao_hang VARCHAR(50) DEFAULT 'chua_giao_hang',
    ngay_dat_hang DATE NOT NULL,
    ngay_san_xuat DATE,
    ngay_giao_hang DATE,
    chi_phi_van_chuyen DECIMAL(15, 2) DEFAULT 0,
    tong_tien DECIMAL(15, 2) DEFAULT 0,
    so_tien_da_thanh_toan DECIMAL(15, 2) DEFAULT 0,
    so_tien_con_lai DECIMAL(15, 2) DEFAULT 0,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_lvkd) REFERENCES linh_vuc_kinh_doanh(id),
    FOREIGN KEY (id_khach_hang) REFERENCES khach_hang(id),
    FOREIGN KEY (id_duyet_vuot_han_muc) REFERENCES duyet_vuot_han_muc(id)
);

-- 16. Chi tiết Đơn hàng
CREATE TABLE IF NOT EXISTS chi_tiet_don_hang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_don_hang INT NOT NULL,
    id_danh_muc_vat_tu INT NOT NULL,
    so_luong DECIMAL(12, 2) NOT NULL,
    don_gia DECIMAL(15, 2) NOT NULL,     -- Giá áp dụng riêng cho phiếu này (cho phép kế toán/kinh doanh sửa đổi)
    chiet_khau DECIMAL(15, 2) DEFAULT 0,
    thanh_tien DECIMAL(15, 2) DEFAULT 0,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_don_hang) REFERENCES don_hang(id),
    FOREIGN KEY (id_danh_muc_vat_tu) REFERENCES danh_muc_vat_tu(id)
);

-- 17. Thanh toán nợ/đơn hàng nhận từ Khách hàng
CREATE TABLE IF NOT EXISTS thanh_toan_khach_hang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_khach_hang INT NOT NULL,
    so_tien_nhan DECIMAL(15, 2) NOT NULL,
    ngay_thanh_toan DATE NOT NULL,
    hinh_thuc_thanh_toan VARCHAR(50) NOT NULL,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_khach_hang) REFERENCES khach_hang(id)
);

-- 18. Chi tiết gạch nợ từng đơn hàng
CREATE TABLE IF NOT EXISTS chi_tiet_gach_no (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_thanh_toan_khach_hang INT NOT NULL,
    id_don_hang INT NOT NULL,
    so_tien_khau_tru DECIMAL(15, 2) NOT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_thanh_toan_khach_hang) REFERENCES thanh_toan_khach_hang(id),
    FOREIGN KEY (id_don_hang) REFERENCES don_hang(id)
);

-- 19. Danh sách Nhân công
CREATE TABLE IF NOT EXISTS nhan_cong (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ho_ten VARCHAR(255) NOT NULL,
    so_dien_thoai VARCHAR(20),
    so_cccd VARCHAR(20) NOT NULL,
    don_gia_luong_ngay DECIMAL(15, 2) DEFAULT 0,
    ten_to_doi VARCHAR(100),
    hinh_anh TEXT,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 20. Hợp đồng giao khoán nhân công theo Công trình
CREATE TABLE IF NOT EXISTS hop_dong_nhan_cong (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_cong_trinh INT NOT NULL,
    id_nhan_cong INT NOT NULL,
    gia_tri_hop_dong DECIMAL(15, 2) DEFAULT 0,
    da_thanh_toan DECIMAL(15, 2) DEFAULT 0,
    cong_no_con_lai DECIMAL(15, 2) DEFAULT 0,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id),
    FOREIGN KEY (id_nhan_cong) REFERENCES nhan_cong(id)
);

-- 20.2 Chi tiết thanh toán hợp đồng giao khoán nhân công
CREATE TABLE IF NOT EXISTS thanh_toan_nhan_cong (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_hop_dong_nhan_cong INT NOT NULL,
    so_tien_thanh_toan DECIMAL(15, 2) NOT NULL,
    ngay_thanh_toan DATE NOT NULL,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_hop_dong_nhan_cong) REFERENCES hop_dong_nhan_cong(id)
);

-- 21. Nhật ký chấm công hiện trường (Tính lương nhật công theo ngày)
CREATE TABLE IF NOT EXISTS cham_cong_hang_ngay (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_nhan_cong INT,
    id_cong_trinh INT,
    ngay_cham_cong DATE NOT NULL,
    so_cong DECIMAL(4, 2) DEFAULT 1.0,
    don_gia_ap_dung DECIMAL(15, 2),
    ghi_chu TEXT,
    id_phieu_chi_luong INT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_nhan_cong) REFERENCES nhan_cong(id),
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id)
);

-- 22. Nhật ký sản phẩm thợ (Bốc vát, bốc xếp hạ hàng, sản xuất theo đơn hàng)
CREATE TABLE IF NOT EXISTS luong_san_pham (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_nhan_cong INT NOT NULL,
    id_don_hang INT,
    id_nhat_ky_kho INT,
    id_danh_muc_vat_tu INT NOT NULL,
    ngay_thuc_hien DATE NOT NULL,
    so_luong DECIMAL(12, 2) NOT NULL,
    don_gia_nhan_cong DECIMAL(15, 2) NOT NULL,
    thanh_tien DECIMAL(15, 2) DEFAULT 0,
    ghi_chu TEXT,
    id_phieu_chi_luong INT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_nhan_cong) REFERENCES nhan_cong(id),
    FOREIGN KEY (id_don_hang) REFERENCES don_hang(id),
    FOREIGN KEY (id_nhat_ky_kho) REFERENCES nhat_ky_kho(id),
    FOREIGN KEY (id_danh_muc_vat_tu) REFERENCES danh_muc_vat_tu(id)
);

-- 23. Nhật ký tạm ứng thợ
CREATE TABLE IF NOT EXISTS tam_ung_nhan_cong (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_nhan_cong INT,
    id_cong_trinh INT,
    so_tien_tam_ung DECIMAL(15, 2) NOT NULL,
    ngay_tam_ung DATE NOT NULL,
    trang_thai_can_tru VARCHAR(50) DEFAULT 'Chua_Can_Tru',
    id_phieu_chi_luong INT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_nhan_cong) REFERENCES nhan_cong(id),
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id)
);

-- 24. Bảng lương chi tiết
CREATE TABLE IF NOT EXISTS phieu_chi_luong (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_phieu_luong VARCHAR(50) UNIQUE NOT NULL,
    id_nhan_cong INT,
    tu_ngay DATE NOT NULL,
    den_ngay DATE NOT NULL,
    tong_luong_gop DECIMAL(15, 2) DEFAULT 0,
    tong_tam_ung DECIMAL(15, 2) DEFAULT 0,
    luong_thuc_linh DECIMAL(15, 2) DEFAULT 0,
    no_ke_thua DECIMAL(15, 2) DEFAULT 0,
    trang_thai_thanh_toan VARCHAR(50) DEFAULT 'Cho_Duyet',
    ngay_tao DATE NOT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_nhan_cong) REFERENCES nhan_cong(id)
);

-- 25a. Danh mục Loại xe chuyên dùng
CREATE TABLE IF NOT EXISTS danh_muc_loai_xe (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ten_loai_xe VARCHAR(100) UNIQUE NOT NULL,
    mo_ta TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 25b. Danh sách Phương tiện xe vận tải
CREATE TABLE IF NOT EXISTS phuong_tien (
    id INT AUTO_INCREMENT PRIMARY KEY,
    bien_so_xe VARCHAR(20) UNIQUE NOT NULL,
    loai_xe VARCHAR(100) NOT NULL,
    dinh_muc_tieu_hao DECIMAL(6, 2) NOT NULL,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 26. Nhật ký theo dõi xăng dầu hằng ngày
CREATE TABLE IF NOT EXISTS nhat_ky_nhien_lieu (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_phuong_tien INT,
    id_nhan_cong INT,
    id_cong_trinh INT,
    ngay_ghi_nhan DATE NOT NULL,
    so_lit_bom DECIMAL(8, 2) DEFAULT 0,
    cu_ly_mot_chuyen DECIMAL(8, 2) DEFAULT 0,
    so_chuyen_chay INT DEFAULT 0,
    cu_ly_van_chuyen DECIMAL(8, 2) DEFAULT 0,
    so_lit_tieu_hao DECIMAL(8, 2) DEFAULT 0,
    don_gia_chuyen DECIMAL(15, 2) DEFAULT 0,
    so_km_odometer DECIMAL(12, 2) DEFAULT NULL,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_phuong_tien) REFERENCES phuong_tien(id),
    FOREIGN KEY (id_nhan_cong) REFERENCES nhan_cong(id),
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id)
);

-- 27. Bảng chính quản lý Nhà thầu phụ
CREATE TABLE IF NOT EXISTS nha_thau_phu (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_cong_trinh INT,
    ten_nha_thau VARCHAR(255) NOT NULL,
    noi_dung_khoan VARCHAR(255) NOT NULL,
    gia_tri_hop_dong DECIMAL(15, 2) DEFAULT 0,
    da_thanh_toan DECIMAL(15, 2) DEFAULT 0,
    cong_no_con_lai DECIMAL(15, 2) DEFAULT 0,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id)
);

-- 28. Chi tiết các đợt thanh toán cho Nhà thầu phụ
CREATE TABLE IF NOT EXISTS thanh_toan_thau_phu (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_nha_thau_phu INT NOT NULL,
    so_tien_thanh_toan DECIMAL(15, 2) NOT NULL,
    ngay_thanh_toan DATE NOT NULL,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_nha_thau_phu) REFERENCES nha_thau_phu(id)
);

-- 29. Bảng chính theo dõi Nhật trình Ca máy thuê ngoài
CREATE TABLE IF NOT EXISTS ca_may_thue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_cong_trinh INT,
    ten_may VARCHAR(255) NOT NULL,
    nha_cung_cap VARCHAR(255),
    so_ca_lam_viec DECIMAL(6, 2) DEFAULT 1.0,
    don_gia_ca_may DECIMAL(15, 2) DEFAULT 0,
    tong_tien DECIMAL(15, 2) DEFAULT 0,
    da_thanh_toan DECIMAL(15, 2) DEFAULT 0,
    cong_no_con_lai DECIMAL(15, 2) DEFAULT 0,
    ngay_thuc_hien DATE NOT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id)
);

-- 30. Chi tiết thanh toán Ca máy
CREATE TABLE IF NOT EXISTS thanh_toan_ca_may (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_ca_may_thue INT NOT NULL,
    so_tien_thanh_toan DECIMAL(15, 2) NOT NULL,
    ngay_thanh_toan DATE NOT NULL,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_ca_may_thue) REFERENCES ca_may_thue(id)
);

-- 30.2 Lịch sử ca máy thuê chi tiết
CREATE TABLE IF NOT EXISTS ca_may_thue_lich_su (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_ca_may_thue INT NOT NULL,
    so_ca DECIMAL(6, 2) NOT NULL,
    ngay_thuc_hien_tu DATE NOT NULL,
    ngay_thuc_hien_den DATE NOT NULL,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    ngay_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_ca_may_thue) REFERENCES ca_may_thue(id) ON DELETE CASCADE
);

-- (Bảng giao_dich_tai_chinh cũ đã được chuẩn hóa và thay thế hoàn toàn bằng bảng 40. phieu_thu_chi)

-- 32. Chi phí khác theo Công trình
CREATE TABLE IF NOT EXISTS ctr_chi_phi_khac (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_cong_trinh INT NOT NULL,
    id_danh_muc_chi_phi_khac INT NOT NULL,
    ten_chi_phi_khac_theo_ctr VARCHAR(255),
    ghi_chu TEXT,
    tong_tien DECIMAL(15, 2) DEFAULT 0,
    da_thanh_toan DECIMAL(15, 2) DEFAULT 0,
    cong_no_con_lai DECIMAL(15, 2) DEFAULT 0,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id),
    FOREIGN KEY (id_danh_muc_chi_phi_khac) REFERENCES danh_muc_chi_phi_khac(id)
);

-- 33. Chi tiết thanh toán Chi phí khác theo Công trình
CREATE TABLE IF NOT EXISTS ctr_chi_phi_khac_thanh_toan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_ctr_chi_phi_khac INT NOT NULL,
    so_tien_thanh_toan DECIMAL(15, 2) NOT NULL,
    ngay_thanh_toan DATE NOT NULL,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_ctr_chi_phi_khac) REFERENCES ctr_chi_phi_khac(id)
);

-- 34. Lĩnh vực kinh doanh
CREATE TABLE IF NOT EXISTS linh_vuc_kinh_doanh (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_lvkd VARCHAR(50) UNIQUE NOT NULL,
    ten_lvkd VARCHAR(255) NOT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    da_xoa TINYINT(1) DEFAULT 0,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 35. Quỹ tiền / Tài khoản thanh toán
CREATE TABLE IF NOT EXISTS quy_tien (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_lvkd INT NOT NULL,
    ma_quy VARCHAR(50) UNIQUE NOT NULL,
    ten_quy VARCHAR(255) NOT NULL,
    loai_quy VARCHAR(50) NOT NULL, -- 'tiền mặt', 'ngân hàng',...
    hinh_thuc_thanh_toan VARCHAR(20) DEFAULT 'TM', -- 'TM' (Tiền mặt), 'CK' (Chuyển khoản)
    trang_thai VARCHAR(50) DEFAULT 'Kích hoạt',
    da_xoa TINYINT(1) DEFAULT 0,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_lvkd) REFERENCES linh_vuc_kinh_doanh(id)
);

-- 36. Phiếu xuất kho từ đơn hàng
CREATE TABLE IF NOT EXISTS phieu_xuat_kho (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_don_hang INT NOT NULL,
    id_cong_trinh INT,
    id_kho_hang INT NOT NULL,
    ghi_chu TEXT,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_don_hang) REFERENCES don_hang(id),
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id),
    FOREIGN KEY (id_kho_hang) REFERENCES kho_hang(id)
);

-- 37. Chi tiết phiếu xuất kho
CREATE TABLE IF NOT EXISTS phieu_xuat_kho_chi_tiet (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_phieu_xuat_kho INT NOT NULL,
    id_danh_muc_vat_tu INT NOT NULL,
    so_luong DECIMAL(12, 2) NOT NULL,
    ghi_chu TEXT,
    FOREIGN KEY (id_phieu_xuat_kho) REFERENCES phieu_xuat_kho(id) ON DELETE CASCADE,
    FOREIGN KEY (id_danh_muc_vat_tu) REFERENCES danh_muc_vat_tu(id)
);

-- 38. Phiếu nhập kho
CREATE TABLE IF NOT EXISTS phieu_nhap_kho (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_phieu VARCHAR(50) UNIQUE NOT NULL,
    so_vao_so INT NOT NULL,
    nam INT NOT NULL,
    id_linh_vuc_kinh_doanh INT NULL,
    loai_nhap_kho ENUM('mua_hang', 'tra_lai_cong_trinh', 'nhap_thu_cong', 'tra_hang_ban') NOT NULL DEFAULT 'mua_hang',
    id_phieu_mua_hang INT NULL,
    id_nha_cung_cap INT NULL,
    id_kho_hang INT NOT NULL,
    id_cong_trinh INT NULL,
    id_kho_tam_nguon INT NULL,
    id_don_hang INT NULL,
    id_khach_hang INT NULL,
    so_hoa_don_ncc VARCHAR(100) NULL,
    ngay_hoa_don_ncc DATE NULL,
    thoi_gian_nhap DATETIME DEFAULT CURRENT_TIMESTAMP,
    nguoi_giao_hang VARCHAR(100) NULL,
    nguoi_nhap_kho VARCHAR(100) NOT NULL,
    tong_tien DECIMAL(15, 2) DEFAULT 0,
    trang_thai_nhap VARCHAR(50) DEFAULT 'Đã nhập',
    ghi_chu TEXT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    da_xoa TINYINT(1) DEFAULT 0,
    FOREIGN KEY (id_linh_vuc_kinh_doanh) REFERENCES linh_vuc_kinh_doanh(id),
    FOREIGN KEY (id_kho_hang) REFERENCES kho_hang(id),
    FOREIGN KEY (id_nha_cung_cap) REFERENCES nha_cung_cap(id)
);

-- 39. Chi tiết phiếu nhập kho
CREATE TABLE IF NOT EXISTS phieu_nhap_kho_chi_tiet (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_phieu_nhap_kho INT NOT NULL,
    id_chi_tiet_phieu_mua_hang INT NULL,
    id_danh_muc_vat_tu INT NOT NULL,
    don_vi_tinh VARCHAR(50) NULL,
    so_luong_yeu_cau DECIMAL(12, 2) DEFAULT 0,
    so_luong_thuc_nhap DECIMAL(12, 2) NOT NULL,
    don_gia DECIMAL(15, 2) DEFAULT 0,
    chiet_khau DECIMAL(15, 2) DEFAULT 0,
    thanh_tien DECIMAL(15, 2) DEFAULT 0,
    ghi_chu TEXT NULL,
    FOREIGN KEY (id_phieu_nhap_kho) REFERENCES phieu_nhap_kho(id) ON DELETE CASCADE,
    FOREIGN KEY (id_danh_muc_vat_tu) REFERENCES danh_muc_vat_tu(id)
);

-- 40. Phiếu Thu / Phiếu Chi sổ quỹ
CREATE TABLE IF NOT EXISTS phieu_thu_chi (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_phieu VARCHAR(50) UNIQUE NOT NULL,
    so_vao_so INT NOT NULL,
    nam INT NOT NULL,
    id_linh_vuc_kinh_doanh INT NOT NULL,
    loai_phieu ENUM('Phieu_Thu', 'Phieu_Chi') NOT NULL,
    loai_thu_chi VARCHAR(100) NOT NULL,
    loai_chung_tu_lien_ket VARCHAR(100) DEFAULT 'khac',
    id_chung_tu INT NULL,
    ma_chung_tu VARCHAR(100) NULL,
    loai_doi_tuong VARCHAR(50) DEFAULT 'khac',
    id_doi_tuong INT NULL,
    ten_doi_tuong VARCHAR(255) NOT NULL,
    dia_chi_doi_tuong VARCHAR(255) NULL,
    sdt_doi_tuong VARCHAR(50) NULL,
    id_quy_tien INT NOT NULL,
    hinh_thuc_thanh_toan ENUM('Tien_Mat', 'Chuyen_Khoan', 'Quy_Cong_Truong') DEFAULT 'Tien_Mat',
    so_tien DECIMAL(15, 2) NOT NULL,
    ngay_chung_tu DATETIME DEFAULT CURRENT_TIMESTAMP,
    nguoi_nop_nhan VARCHAR(100) NULL,
    ly_do_thu_chi TEXT NOT NULL,
    kem_theo_chung_tu_goc VARCHAR(255) NULL,
    trang_thai VARCHAR(50) DEFAULT 'đã thanh toán',
    ghi_chu TEXT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    da_xoa TINYINT(1) DEFAULT 0,
    FOREIGN KEY (id_linh_vuc_kinh_doanh) REFERENCES linh_vuc_kinh_doanh(id),
    FOREIGN KEY (id_quy_tien) REFERENCES quy_tien(id)
);

-- 41. Hợp đồng kinh tế
CREATE TABLE IF NOT EXISTS hop_dong (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ma_hop_dong VARCHAR(100) UNIQUE NOT NULL,
    so_vao_so INT NOT NULL,
    nam INT NOT NULL,
    id_linh_vuc_kinh_doanh INT NOT NULL,
    id_khach_hang INT NOT NULL,
    id_cong_trinh INT NULL,
    ten_hop_dong VARCHAR(255) NOT NULL,
    loai_hop_dong ENUM('thi_cong_xay_dung', 'cung_cap_vat_tu', 'kinh_doanh_thuong_mai', 'dich_vu_khac') DEFAULT 'thi_cong_xay_dung',
    ngay_ky DATE NOT NULL,
    ngay_hieu_luc DATE NULL,
    ngay_bat_dau DATE NULL,
    ngay_ket_thuc DATE NULL,
    gia_tri_truoc_thue DECIMAL(15, 2) DEFAULT 0,
    thue_vat DECIMAL(5, 2) DEFAULT 0,
    tien_thue_vat DECIMAL(15, 2) DEFAULT 0,
    gia_tri_hop_dong DECIMAL(15, 2) NOT NULL DEFAULT 0,
    da_thanh_toan DECIMAL(15, 2) DEFAULT 0,
    con_lai DECIMAL(15, 2) DEFAULT 0,
    ti_le_chi_phi_quan_ly DECIMAL(5, 2) DEFAULT 3.00,
    ti_le_thanh_tra_kiem_toan DECIMAL(5, 2) DEFAULT 1.00,
    ti_le_thue_vat_tndn DECIMAL(5, 2) DEFAULT 5.00,
    ti_le_chi_phi_tim_viec DECIMAL(5, 2) DEFAULT 10.00,
    chi_phi_tim_viec_co_dinh DECIMAL(15, 2) DEFAULT 0,
    loai_tinh_chi_phi_tim_viec ENUM('phan_tram', 'so_tien_co_dinh') DEFAULT 'phan_tram',
    dieu_khoan_thanh_toan TEXT NULL,
    dieu_khoan_giao_hang TEXT NULL,
    dieu_khoan_bao_hanh TEXT NULL,
    thoi_han_bao_hanh_thang INT DEFAULT 12,
    gia_tri_tam_ung DECIMAL(15, 2) DEFAULT 0,
    ngay_bao_lanh_tam_ung DATE NULL,
    ngay_het_han_bao_lanh_tam_ung DATE NULL,
    bao_lanh_thuc_hien DECIMAL(15, 2) DEFAULT 0,
    ngay_bao_lanh_thuc_hien DATE NULL,
    ngay_het_han_bao_lanh_thuc_hien DATE NULL,
    bao_hanh_cong_trinh DECIMAL(15, 2) DEFAULT 0,
    ngay_bao_hanh_cong_trinh DATE NULL,
    ngay_het_han_bao_hanh DATE NULL,
    trang_thai VARCHAR(50) DEFAULT 'Hieu_Luc',
    ghi_chu TEXT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    da_xoa TINYINT(1) DEFAULT 0,
    FOREIGN KEY (id_linh_vuc_kinh_doanh) REFERENCES linh_vuc_kinh_doanh(id),
    FOREIGN KEY (id_khach_hang) REFERENCES khach_hang(id),
    FOREIGN KEY (id_cong_trinh) REFERENCES cong_trinh(id)
);

-- 42. Đợt thanh toán hợp đồng
CREATE TABLE IF NOT EXISTS hop_dong_dot_thanh_toan (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_hop_dong INT NOT NULL,
    loai_dot ENUM('Tam_Ung', 'Dot_Thanh_Toan', 'Giao_Hang', 'Nghiem_Thu', 'Quyet_Toan', 'Bao_Hanh', 'Khac') NOT NULL,
    ten_dot VARCHAR(255) NOT NULL,
    hinh_thuc_thanh_toan VARCHAR(50) DEFAULT 'Chuyen_Khoan',
    han_thanh_toan DATE NULL,
    phan_tram DECIMAL(5, 2) DEFAULT 0,
    so_tien DECIMAL(15, 2) NOT NULL DEFAULT 0,
    phan_tram_giu_lai DECIMAL(5, 2) DEFAULT 0,
    tien_giu_lai DECIMAL(15, 2) DEFAULT 0,
    da_thanh_toan DECIMAL(15, 2) DEFAULT 0,
    con_lai DECIMAL(15, 2) DEFAULT 0,
    trang_thai VARCHAR(50) DEFAULT 'Chua_Thanh_Toan',
    mo_ta TEXT NULL,
    ngay_thanh_toan_thuc_te DATETIME NULL,
    id_phieu_thu INT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_hop_dong) REFERENCES hop_dong(id) ON DELETE CASCADE
);

-- 43. File đính kèm hợp đồng
CREATE TABLE IF NOT EXISTS hop_dong_file (
    id INT AUTO_INCREMENT PRIMARY KEY,
    id_hop_dong INT NOT NULL,
    ten_file VARCHAR(255) NOT NULL,
    duong_dan VARCHAR(500) NOT NULL,
    loai_file VARCHAR(50) NULL,
    kich_thuoc_bytes INT DEFAULT 0,
    ghi_chu TEXT NULL,
    nguoi_tao VARCHAR(100) NOT NULL,
    thoi_gian_tao DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_hop_dong) REFERENCES hop_dong(id) ON DELETE CASCADE
);

