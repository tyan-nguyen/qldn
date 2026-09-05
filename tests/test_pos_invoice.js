const { VNDToWords } = require('../src/utils/numberToWords');

function testVNDToWords() {
  console.log('--- TESTING NUMBERS TO VIETNAMESE WORDS ---');
  
  const testCases = [
    { num: 5900000, expected: 'Năm triệu chín trăm nghìn đồng.' },
    { num: 125000, expected: 'Một trăm hai mươi lăm nghìn đồng.' },
    { num: 2080000, expected: 'Hai triệu không trăm tám mươi nghìn đồng.' },
    { num: 6240000, expected: 'Sáu triệu hai trăm bốn mươi nghìn đồng.' },
    { num: 44938, expected: 'Bốn mươi bốn nghìn chín trăm ba mươi tám đồng.' }
  ];

  let successCount = 0;
  for (const tc of testCases) {
    const res = VNDToWords(tc.num);
    const pass = res === tc.expected;
    console.log(`Number: ${tc.num.toLocaleString()} VND`);
    console.log(`Result:   "${res}"`);
    console.log(`Expected: "${tc.expected}"`);
    console.log(`Status:   ${pass ? '🟢 PASS' : '🔴 FAIL'}\n`);
    if (pass) successCount++;
  }

  console.log(`Passed ${successCount}/${testCases.length} tests.`);
}

testVNDToWords();
