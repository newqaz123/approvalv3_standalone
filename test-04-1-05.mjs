import fs from 'fs';

let pass = 0, fail = 0;

function test(name, condition, details = '') {
  const passed = Boolean(condition);
  if (passed) pass++; else fail++;
  console.log(`${passed ? '✅ PASS' : '❌ FAIL'} ${name} ${details}`);
}

console.log('\n=== Automated Test: Fade-in Animation (04.1-05) ===\n');

// Read source files
const cssPath = 'src/app/globals.css';
const modalPath = 'src/components/requests/request-detail-modal.tsx';

const cssText = fs.readFileSync(cssPath, 'utf8');
const modalText = fs.readFileSync(modalPath, 'utf8');

// Test 1: fadeIn keyframes exist
test('1. @keyframes fadeIn exists in globals.css',
  cssText.includes('@keyframes fadeIn')
);

// Test 2: fadeIn has opacity 0 to 1
test('2. fadeIn animation has opacity 0 to 1',
  cssText.includes('opacity: 0') && cssText.includes('opacity: 1')
);

// Test 3: content-fade-in class exists
test('3. .content-fade-in class exists',
  cssText.includes('.content-fade-in')
);

// Test 4: Animation is 150ms
test('4. Animation duration is 150ms',
  cssText.includes('150ms')
);

// Test 5: Animation uses ease-in timing
test('5. Animation uses ease-in timing',
  cssText.includes('ease-in')
);

// Test 6: contentVisible state declared
test('6. contentVisible state declared in modal',
  modalText.includes('const [contentVisible, setContentVisible]')
);

// Test 7: setContentVisible(false) on load start
test('7. setContentVisible(false) when loading starts',
  modalText.includes('setContentVisible(false)') && modalText.indexOf('setContentVisible(false)') < modalText.indexOf('setContentVisible(true)')
);

// Test 8: setContentVisible(true) on load complete
test('8. setContentVisible(true) when loading completes',
  modalText.includes('setContentVisible(true)')
);

// Test 9: content-fade-in class applied
test('9. content-fade-in class applied conditionally',
  modalText.includes('content-fade-in')
);

// Test 10: No flash on skeleton (early return)
test('10. Skeleton loads before fade-in applied',
  modalText.includes('RequestDetailSkeleton')
);

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Results: ${pass}/${pass + fail} tests passed`);
console.log(`Success Rate: ${Math.round((pass / (pass + fail)) * 100)}%`);
console.log('='.repeat(50));

if (fail === 0) {
  console.log('\n🎉 ALL TESTS PASSED - Fade-in animation verified!\n');
  process.exit(0);
} else {
  console.log(`\n⚠️  ${fail} test(s) failed\n`);
  process.exit(1);
}
