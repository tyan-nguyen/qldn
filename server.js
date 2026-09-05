const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
require('dotenv').config();

const { initializeDatabase } = require('./src/config/db');

// Import routes
const authRoutes = require('./src/routes/auth');
const { router: khachHangRouter } = require('./src/routes/khach_hang');
const congTrinhRoutes = require('./src/routes/cong_trinh');
const { router: khoRouter } = require('./src/routes/kho');
const donHangRoutes = require('./src/routes/don_hang');
const nhanCongRoutes = require('./src/routes/nhan_cong');
const doiXeRoutes = require('./src/routes/doi_xe');
const financeRoutes = require('./src/routes/finance');
const logsRoutes = require('./src/routes/logs');
const nhaCungCapRoutes = require('./src/routes/nha_cung_cap');
const reportsRoutes = require('./src/routes/reports');
const vatTuCongTrinhRoutes = require('./src/routes/vatTuCongTrinh');
const purchaseRequisitionsRoutes = require('./src/routes/purchaseRequisitions');
const purchaseOrdersRoutes = require('./src/routes/purchaseOrders');
const siteTransfersRoutes = require('./src/routes/siteTransfers');
const siteMaterialOutletsRoutes = require('./src/routes/siteMaterialOutlets');
const hopDongRoutes = require('./src/routes/hop_dong');
const paymentRequestsRoutes = require('./src/routes/paymentRequests');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

// Setup Socket.io Realtime server
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log('⚡ Realtime Client Socket.io connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('🔌 Realtime Client Socket.io disconnected:', socket.id);
  });
});

// Enable security headers and CORS (cho phép nhúng iframe xem trước PDF và tài liệu)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
  frameguard: false,
  contentSecurityPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const fs = require('fs');

const staticOptions = {
  setHeaders: (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.removeHeader('X-Frame-Options');
  }
};

// Serve static assets if needed
app.use('/public', express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'), staticOptions));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), staticOptions));
app.use('/public/uploads', express.static(path.join(__dirname, 'public/uploads'), staticOptions));

// Register API routes
app.use('/api/auth', authRoutes);
app.use('/api/khach-hang', khachHangRouter);
app.use('/api/nha-cung-cap', nhaCungCapRoutes);
app.use('/api/cong-trinh', congTrinhRoutes);
app.use('/api/hop-dong', hopDongRoutes);
app.use('/api/kho', khoRouter);
app.use('/api/don-hang', donHangRoutes);
app.use('/api/ban-hang/pos', donHangRoutes);
app.use('/api/nhan-cong', nhanCongRoutes);
app.use('/api/nhan-su', nhanCongRoutes);
app.use('/api/doi-xe', doiXeRoutes);
app.use('/api/xe-xang-dau', doiXeRoutes);
app.use('/api/tai-chinh', financeRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/vat-tu-cong-trinh', vatTuCongTrinhRoutes);
app.use('/api/yeu-cau-mua-hang', purchaseRequisitionsRoutes);
app.use('/api/phieu-mua-hang', purchaseOrdersRoutes);
app.use('/api/dieu-chuyen-vat-tu', siteTransfersRoutes);
app.use('/api/vat-tu-cong-trinh-dau-ra', siteMaterialOutletsRoutes);
app.use('/api/de-nghi-thanh-toan', paymentRequestsRoutes);

// Dedicated file download endpoint with Content-Disposition
app.get('/api/download', (req, res) => {
  try {
    const rawPath = req.query.path || req.query.url;
    const customName = req.query.name;

    if (!rawPath) {
      return res.status(400).json({ message: 'Thiếu đường dẫn tệp tin cần tải (path).' });
    }

    // Clean up path
    const cleanRelativePath = rawPath
      .replace(/^https?:\/\/[^\/]+/, '')
      .replace(/^\/public\//, '')
      .replace(/^\/uploads\//, 'uploads/')
      .replace(/^\//, '');

    // Possible locations on disk
    const candidatePaths = [
      path.join(__dirname, 'public', cleanRelativePath),
      path.join(__dirname, 'public/uploads', cleanRelativePath.replace(/^uploads\//, '')),
      path.join(__dirname, 'uploads', cleanRelativePath.replace(/^uploads\//, '')),
      path.join(__dirname, cleanRelativePath)
    ];

    let foundPath = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        foundPath = p;
        break;
      }
    }

    if (!foundPath) {
      return res.status(404).json({ message: 'Không tìm thấy tệp tin trên máy chủ.' });
    }

    // Determine filename to send
    const ext = path.extname(foundPath);
    let downloadName = customName || path.basename(foundPath);
    if (ext && !downloadName.toLowerCase().endsWith(ext.toLowerCase())) {
      downloadName = `${downloadName}${ext}`;
    }

    res.download(foundPath, downloadName, (err) => {
      if (err && !res.headersSent) {
        console.error('Lỗi download file:', err);
        res.status(500).json({ message: 'Lỗi tải tệp: ' + err.message });
      }
    });
  } catch (err) {
    console.error('Lỗi api download:', err);
    res.status(500).json({ message: 'Lỗi máy chủ khi tải file: ' + err.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Lỗi hệ thống:', err);
  res.status(500).json({ message: 'Đã xảy ra lỗi máy chủ nội bộ.', error: err.message });
});

// Initialize DB and start server
async function startServer() {
  await initializeDatabase();
  server.listen(PORT, () => {
    console.log(`🚀 Server with Realtime Socket.io is running on port ${PORT}`);
  });
}

startServer();
