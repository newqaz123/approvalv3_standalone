import fs from 'fs';

const results = [];
let pass = 0, fail = 0;

function test(name, condition, details = '') {
  const passed = Boolean(condition);
  results.push({ name, passed, details });
  if (passed) pass++; else fail++;
  console.log(`${passed ? '✅ PASS' : '❌ FAIL'} ${name} ${details}`);
}

console.log('\n=== Automated Test: Form Interaction Blocking (04.1-04) ===\n');

// Read source files
const modalPath = 'src/components/requests/request-detail-modal.tsx';
const approvalPath = 'src/components/approvals/approval-actions.tsx';
const finalPath = 'src/components/solutions/final-approval-actions.tsx';

if (!fs.existsSync(modalPath)) {
  console.log('❌ File not found:', modalPath);
  process.exit(1);
}

const modalText = fs.readFileSync(modalPath, 'utf8');
const approvalText = fs.readFileSync(approvalPath, 'utf8');
const finalText = fs.readFileSync(finalPath, 'utf8');

// Test 1: isUserInteracting state
test('1. isUserInteracting state declared',
  modalText.includes('const [isUserInteracting, setIsUserInteracting] = useState(false)')
);

// Test 2: interactionTimer state
test('2. interactionTimer state declared',
  modalText.includes('const [interactionTimer, setInteractionTimer]')
);

// Test 3: handleFormInteraction function
test('3. handleFormInteraction function exists',
  modalText.includes('const handleFormInteraction = () =>')
);

// Test 4: 2-second timeout
test('4. 2-second timeout (2000ms)',
  modalText.includes('setTimeout') && modalText.includes('2000')
);

// Test 5: loadRequest blocking check
test('5. loadRequest has isUserInteracting check',
  modalText.includes('if (isUserInteracting)')
);

// Test 6: Console log for debugging
test('6. Console log message present',
  modalText.includes('Skipping refresh - user is actively typing')
);

// Test 7: ApprovalActions onFormInteraction prop
test('7. ApprovalActions has onFormInteraction prop',
  approvalText.includes('onFormInteraction?: () => void')
);

// Test 8: ApprovalActions destructuring
test('8. ApprovalActions destructures onFormInteraction',
  approvalText.includes('onFormInteraction }') || approvalText.includes('onFormInteraction,')
);

// Test 9: ApprovalActions onChange handler
test('9. ApprovalActions textarea has onChange with onFormInteraction',
  approvalText.includes('onFormInteraction?.()')
);

// Test 10: ApprovalActions onFocus handler
test('10. ApprovalActions textarea has onFocus with onFormInteraction',
  approvalText.includes('onFocus={() => onFormInteraction?.()}')
);

// Test 11: FinalApprovalActions onFormInteraction prop
test('11. FinalApprovalActions has onFormInteraction prop',
  finalText.includes('onFormInteraction?: () => void')
);

// Test 12: FinalApprovalActions onFocus handler
test('12. FinalApprovalActions textarea has onFocus with onFormInteraction',
  finalText.includes('onFocus={() => onFormInteraction?.()}')
);

// Test 13: Modal passes to ApprovalActions
test('13. Modal passes handleFormInteraction to components',
  modalText.includes('onFormInteraction={handleFormInteraction}')
);

// Test 14: Modal passes to both components (count occurrences)
const count = (modalText.match(/onFormInteraction={handleFormInteraction}/g) || []).length;
test('14. Modal passes handleFormInteraction to both components (2+)',
  count >= 2,
  `(found ${count} occurrences)`
);

// Test 15: Memory cleanup useEffect
test('15. useEffect cleanup for interactionTimer',
  modalText.includes('clearTimeout(interactionTimer)')
);

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Results: ${pass}/${pass + fail} tests passed`);
console.log(`Success Rate: ${Math.round((pass / (pass + fail)) * 100)}%`);
console.log('='.repeat(50));

if (fail === 0) {
  console.log('\n🎉 ALL TESTS PASSED - Form interaction blocking verified!\n');
  process.exit(0);
} else {
  console.log(`\n⚠️  ${fail} test(s) failed\n`);
  process.exit(1);
}
