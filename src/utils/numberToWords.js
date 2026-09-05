const defaultNumbers = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

function readThreeDigits(bas, tram, chuc, donvi) {
  let str = '';

  // Read hundreds
  if (tram !== undefined) {
    str += defaultNumbers[tram] + ' trăm ';
  }

  // Read tens
  if (chuc !== undefined) {
    if (chuc === 0) {
      if (donvi === 0) {
        // do nothing
      } else if (tram !== undefined) {
        str += 'lẻ ';
      }
    } else if (chuc === 1) {
      str += 'mười ';
    } else {
      str += defaultNumbers[chuc] + ' mươi ';
    }
  }

  // Read units
  if (donvi !== undefined && donvi !== 0) {
    if (chuc > 1 && donvi === 1) {
      str += 'mốt';
    } else if (donvi === 5 && chuc > 0) {
      str += 'lăm';
    } else if (donvi === 5) {
      str += 'năm';
    } else {
      str += defaultNumbers[donvi];
    }
  } else if (donvi === 0 && tram !== undefined && chuc === 0) {
    // do nothing
  } else if (donvi === 0 && chuc > 0) {
    // do nothing
  }

  return str.trim();
}

function VNDToWords(amount) {
  if (amount === 0) return 'Không đồng.';
  if (amount < 0) return 'Âm ' + VNDToWords(Math.abs(amount));

  let str = '';
  let tempAmount = Math.floor(amount);

  const units = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ', ' triệu tỷ'];

  let unitIndex = 0;
  while (tempAmount > 0) {
    const chunk = tempAmount % 1000;
    tempAmount = Math.floor(tempAmount / 1000);

    if (chunk > 0) {
      const tram = Math.floor(chunk / 100);
      const chuc = Math.floor((chunk % 100) / 10);
      const donvi = chunk % 10;

      // Handle displaying hundreds for intermediate groups (e.g. 1,005,000 -> "một triệu không trăm lẻ năm nghìn")
      const chunkStr = readThreeDigits(true, tempAmount > 0 ? tram : (tram > 0 ? tram : undefined), chuc, donvi);
      if (chunkStr) {
        str = chunkStr + units[unitIndex] + ' ' + str;
      }
    }
    unitIndex++;
  }

  // Clean trailing spaces and formatting
  let res = str.trim();
  if (res.length > 0) {
    // Capitalize first character
    res = res.charAt(0).toUpperCase() + res.slice(1);
    res += ' đồng.';
  }

  return res;
}

module.exports = {
  VNDToWords
};
