-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3306
-- Generation Time: Aug 18, 2026 at 06:55 AM
-- Server version: 8.4.7
-- PHP Version: 8.0.30

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `pmdaotao3`
--

-- --------------------------------------------------------

--
-- Table structure for table `gd_hinh_anh`
--

DROP TABLE IF EXISTS `gd_hinh_anh`;
CREATE TABLE IF NOT EXISTS `gd_hinh_anh` (
  `id` int NOT NULL AUTO_INCREMENT,
  `loai` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'KEHOACH,LICHDUNGXE',
  `id_giao_vien` int NOT NULL,
  `date` date NOT NULL,
  `file_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_size` int NOT NULL,
  `extension` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `thoi_gian_tao` datetime DEFAULT NULL,
  `nguoi_tao` int DEFAULT NULL,
  `luot` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'DI or VE',
  PRIMARY KEY (`id`),
  KEY `id_giao_vien` (`id_giao_vien`),
  KEY `loai` (`loai`),
  KEY `date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
