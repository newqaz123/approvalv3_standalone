---
status: diagnosed
trigger: "Diagnose the root cause of these form validation issues: Cost Estimate field auto-fills with '0', Shows red validation text 'Cost must be greater than 0' even when user types numbers, Currency dropdown only has 'THB' option"
created: 2026-02-02T00:00:00Z
updated: 2026-02-02T00:00:02Z
symptoms_prefilled: true
goal: find_root_cause_only
---

## Current Focus
hypothesis: Root causes identified across all three issues
test: Code review completed
expecting: All three issues confirmed
next_action: Document findings in Resolution section

## Symptoms
expected:
- Cost Estimate field should be optional and accept any positive number
- No "Cost must be greater than 0" error when typing valid numbers
- Currency dropdown should have THB, USD, EUR options

actual:
- Cost Estimate field auto-fills with "0"
- Shows red validation text "Cost must be greater than 0" even when typing numbers
- Currency dropdown only shows "THB" option

errors:
- Validation error: "Cost must be greater than 0"
- Missing currency options: USD, EUR

reproduction:
- Open solution form
- Attempt to enter cost estimate value
- Observe validation error
- Check currency dropdown options

started: 2026-02-02

## Eliminated

## Evidence

- timestamp: 2026-02-02T00:00:01Z
  checked: solutionFormSchema (lines 36-48)
  found:
    - Line 39-42: costEstimate validation requires .positive('Cost must be greater than 0') AND .min(0.01, 'Minimum cost is 0.01')
    - This makes the field required, not optional
    - Field must be a number > 0.01
  implication: Field is mandatory despite being described as optional, and validation triggers immediately

- timestamp: 2026-02-02T00:00:01Z
  checked: form defaultValues (lines 80-89)
  found:
    - Line 83: costEstimate defaults to 0
    - Default value 0 conflicts with validation requiring > 0.01
  implication: Form initializes with invalid value, triggering validation error immediately

- timestamp: 2026-02-02T00:00:01Z
  checked: costEstimate input onChange handler (lines 351-354)
  found:
    - onChange converts empty input to 0: `field.onChange(isNaN(value) ? 0 : value)`
    - When user clears field or types incomplete number, it becomes 0
    - 0 fails validation (must be > 0.01)
  implication: User can't clear field or edit without triggering error

- timestamp: 2026-02-02T00:00:01Z
  checked: currency Zod schema (line 43)
  found:
    - `currency: z.enum(['THB'])`
    - Only 'THB' is allowed value
  implication: Schema restricts currency to THB only

- timestamp: 2026-02-02T00:00:01Z
  checked: currency Select options (lines 377-379)
  found:
    - Only one SelectItem: `<SelectItem value="THB">THB (฿)</SelectItem>`
    - Missing USD and EUR options
  implication: Dropdown only shows THB, no other currencies available

## Resolution
root_cause: |
  Three separate root causes identified:

  1. **Cost Estimate auto-fills with "0":** Default value set to 0 in form initialization (line 83)
  2. **Validation error when typing:** Multiple conflicting issues:
     - Zod schema requires .positive() and .min(0.01) making field mandatory, not optional (lines 39-42)
     - onChange handler converts empty/incomplete input to 0, which fails validation (lines 351-354)
     - Field label says "Cost Estimate *" (required) but business intent is optional
  3. **Currency dropdown only has THB:**
     - Zod enum only allows 'THB' value (line 43)
     - Select only has THB SelectItem (line 378)
     - Missing USD and EUR in both schema and UI

fix: |
  For each issue:

  1. **Make costEstimate truly optional:**
     - Change schema from `.number().positive().min(0.01)` to `.number().optional().or(z.literal(0))` or use `z.nullable(z.number())`
     - Remove .positive() and .min() constraints, or apply them conditionally when value is provided

  2. **Fix default value and onChange handler:**
     - Change default value from `0` to `undefined` or `null`
     - Update onChange to preserve undefined/null: `field.onChange(isNaN(value) ? undefined : value)`
     - Or make field truly required and remove "optional" from business requirements

  3. **Add missing currency options:**
     - Update Zod schema: `z.enum(['THB', 'USD', 'EUR'])`
     - Add SelectItem components for USD and EUR in the dropdown
     - Maintain THB as default value

verification: ""
files_changed: []
