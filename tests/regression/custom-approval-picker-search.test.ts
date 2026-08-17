import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

it("exposes shared picker harness selectors", () => {
	const approverSearchSource = read(
		"src/components/approvals/approver-search-field.tsx",
	);
	const sharedPickerSource = read(
		"src/components/solutions/custom-approval-picker.tsx",
	);

	assert.match(approverSearchSource, /data-picker-count/);
	assert.match(sharedPickerSource, /data-picker-open/);
	assert.match(sharedPickerSource, /data-picker-root/);
	assert.match(sharedPickerSource, /data-picker-item/);
	assert.match(sharedPickerSource, /PopoverTrigger/);
	assert.match(sharedPickerSource, /<Command[^>]*shouldFilter=\{false\}/);
	assert.match(sharedPickerSource, /CommandList/);
	assert.match(sharedPickerSource, /CommandItem/);
});

describe("ApproverSearchField", () => {
	it("exposes an accessible search field with live result count", () => {
		const source = read("src/components/approvals/approver-search-field.tsx");

		assert.match(source, /Search approvers/);
		assert.match(source, /Search by name, email, department, role, or level/);
		assert.match(source, /role="status"/);
		assert.match(source, /aria-live="polite"/);
		assert.match(source, /1 approver/);
		assert.match(source, /approvers/);
		assert.match(source, /min-h-(?:11|\[44px\])/);
		assert.match(source, /focus-visible:/);
	});

	it("uses Input by default and CommandInput for command kind without picker ownership", () => {
		const source = read("src/components/approvals/approver-search-field.tsx");

		assert.match(source, /from ['"]@\/components\/ui\/input['"]/);
		assert.match(source, /CommandInput/);
		assert.match(source, /from ['"]lucide-react['"]/);
		assert.match(source, /\bSearch\b/);
		assert.match(source, /inputKind\s*=\s*['"]input['"]/);
		assert.match(source, /<CommandInput/);
		assert.match(source, /<Input/);
		assert.doesNotMatch(
			source,
			/selectedIds|setOpen|filterApproversByQuery|onSelect/,
		);
	});
});

describe("CustomApprovalPicker search", () => {
	const source = read("src/components/solutions/custom-approval-picker.tsx");

	it("imports both shared search primitives and keeps a single exported picker", () => {
		assert.match(
			source,
			/import \{ filterApproversByQuery \} from ['"]@\/lib\/approver-search['"]/,
		);
		assert.match(
			source,
			/import \{ ApproverSearchField \} from ['"]@\/components\/approvals\/approver-search-field['"]/,
		);
		assert.match(source, /export function CustomApprovalPicker/);
		assert.match(
			source,
			/export \{ CustomApprovalPicker as SharedApprovalPickerHarness \}/,
		);
		assert.doesNotMatch(source, /function SharedApprovalPickerHarness/);
		assert.equal((source.match(/export function /g) || []).length, 1);
	});

	it("excludes the current user and selected ids before searching", () => {
		assert.match(source, /user\.id !== currentUserId/);
		assert.match(source, /!selectedIds\.includes\(user\.id\)/);
		assert.match(
			source,
			/const filteredUsers = filterApproversByQuery\(availableUsers, searchValue\)/,
		);
	});

	it("uses the command search field with external filtering and a bounded list", () => {
		assert.match(source, /<Command[^>]*shouldFilter=\{false\}/);
		assert.match(
			source,
			/<CommandList className="max-h-\[260px\] overflow-y-auto"/,
		);
		assert.match(source, /<ApproverSearchField inputKind="command"/);
		assert.match(source, /resultCount=\{filteredUsers\.length\}/);
		assert.match(source, /onOpenChange=\{handleOpenChange\}/);
		assert.match(
			source,
			/<CommandList className="max-h-\[260px\] overflow-y-auto">\s*\{availableUsers\.length > 0 && filteredUsers\.length === 0 && \(\s*<CommandEmpty>No approvers found<\/CommandEmpty>\s*\)\}\s*<CommandGroup/,
		);
	});

	it("distinguishes a search miss from exhausted selection", () => {
		assert.match(source, /<CommandEmpty>No approvers found<\/CommandEmpty>/);
		assert.match(
			source,
			/availableUsers\.length === 0 && \(\s*<p className="text-xs text-muted-foreground">No more users available<\/p>\s*\)/,
		);
		assert.match(
			source,
			/disabled=\{disabled \|\| availableUsers\.length === 0\}/,
		);
		assert.match(
			source,
			/availableUsers\.length > 0 && filteredUsers\.length === 0 && \(\s*<CommandEmpty>No approvers found<\/CommandEmpty>\s*\)/,
		);
		assert.doesNotMatch(source, /No users found\./);
	});

	it("resets search on close and after selection and shows non-null level metadata", () => {
		assert.match(
			source,
			/const handleOpenChange = \(nextOpen: boolean\) => \{\s*setOpen\(nextOpen\)\s*if \(!nextOpen\) setSearchValue\(['"]{2}\)\s*\}/,
		);
		assert.match(source, /setOpen\(false\)\s*setSearchValue\(['"]{2}\)/);
		assert.match(source, /user\.level != null/);
		assert.match(source, /Level \{user\.level\}/);
	});
});

function assertLiveModalPicker(path: string, harnessName: string) {
	const source = read(path);

	assert.match(source, /function CustomApprovalPicker/);
	assert.doesNotMatch(source, /export function CustomApprovalPicker/);
	assert.match(
		source,
		/import \{ filterApproversByQuery \} from ['"]@\/lib\/approver-search['"]/,
	);
	assert.match(
		source,
		/import \{ ApproverSearchField \} from ['"]@\/components\/approvals\/approver-search-field['"]/,
	);
	assert.match(
		source,
		/const \[searchQuery, setSearchQuery\] = useState\(['"]{2}\)/,
	);
	assert.match(
		source,
		/const searchInputRef = useRef<HTMLInputElement>\(null\)/,
	);
	assert.match(
		source,
		/const unselectedUsers = availableUsers\.filter\(\s*\(user\) => !selectedApprovers\.includes\(user\.id\),?\s*\)/,
	);
	assert.match(
		source,
		/const filteredUsers = filterApproversByQuery\(unselectedUsers, searchQuery\)/,
	);
	assert.match(source, /<ApproverSearchField/);
	assert.match(source, /data-picker-open/);
	assert.match(source, /data-picker-root/);
	assert.match(source, /data-picker-item/);
	assert.match(source, /No approvers found/);
	assert.match(source, /No more users available/);
	assert.match(source, /max-h-\[260px\] overflow-y-auto/);
	assert.match(source, /const setPickerOpen = \(nextOpen: boolean\)/);
	assert.match(source, /requestAnimationFrame/);
	assert.match(source, /setSearchQuery\(['"]{2}\)/);
	assert.match(source, /addApprover\(user\.id\);\s*setPickerOpen\(false\);/);
	assert.match(source, /onClick=\{\(\) => setPickerOpen\(false\)\}/);
	assert.match(
		source,
		/unselectedUsers\.length === 0 \? \([\s\S]*No more users available[\s\S]*\) : filteredUsers\.length === 0 \? \([\s\S]*No approvers found[\s\S]*\) : \(/,
	);
	assert.match(
		source,
		new RegExp("export \\{ CustomApprovalPicker as " + harnessName + " \\}"),
	);
	assert.doesNotMatch(source, new RegExp("function " + harnessName));
	assert.doesNotMatch(source, /currentUserId/);
}

describe("Submitter modal CustomApprovalPicker search", () => {
	it("keeps a file-private picker with shared search, reset, and harness alias", () => {
		assertLiveModalPicker(
			"src/components/requests/submitter-modal.tsx",
			"SubmitterApprovalPickerHarness",
		);
	});
});

describe("Submit final approval modal CustomApprovalPicker search", () => {
	it("keeps a file-private picker with shared search, reset, and harness alias", () => {
		assertLiveModalPicker(
			"src/components/requests/submit-final-approval-modal.tsx",
			"SubmitFinalApprovalPickerHarness",
		);
	});
});

describe("Final approval resubmit modal CustomApprovalPicker search", () => {
	it("keeps a file-private picker with shared search, reset, and harness alias", () => {
		assertLiveModalPicker(
			"src/components/requests/final-approval-resubmit-modal.tsx",
			"FinalApprovalResubmitPickerHarness",
		);
	});
});

describe("Legacy solution modal CustomApprovalPicker search", () => {
	it("keeps a file-private expanded picker with shared search, reset, and harness alias", () => {
		const source = read("src/components/requests/solution-modal.tsx");

		assert.match(source, /function CustomApprovalPicker/);
		assert.doesNotMatch(source, /export function CustomApprovalPicker/);
		assert.match(
			source,
			/import \{ filterApproversByQuery \} from ['"]@\/lib\/approver-search['"]/,
		);
		assert.match(
			source,
			/import \{ ApproverSearchField \} from ['"]@\/components\/approvals\/approver-search-field['"]/,
		);
		assert.match(
			source,
			/const \[searchQuery, setSearchQuery\] = useState\(['"]{2}\)/,
		);
		assert.match(
			source,
			/const availableUsers = users\.filter\(\(u\) => !selectedIds\.includes\(u\.id\)\)/,
		);
		assert.match(
			source,
			/const filteredUsers = filterApproversByQuery\(availableUsers, searchQuery\)/,
		);
		assert.match(
			source,
			/\{isExpanded && \([\s\S]*<ApproverSearchField[\s\S]*\)\}/,
		);
		assert.match(source, /<ApproverSearchField/);
		assert.match(source, /data-picker-open/);
		assert.match(source, /data-picker-root/);
		assert.match(source, /data-picker-item/);
		assert.match(source, /resultCount=\{filteredUsers\.length\}/);
		assert.match(source, /No more users available/);
		assert.match(source, /No approvers found/);
		assert.match(
			source,
			/availableUsers\.length === 0[\s\S]*No more users available[\s\S]*filteredUsers\.length === 0[\s\S]*No approvers found[\s\S]*filteredUsers\.map/,
		);
		assert.match(source, /max-h-\[260px\] overflow-y-auto/);
		assert.match(source, /user\.email/);
		assert.match(source, /user\.departmentName/);
		assert.match(source, /<Switch checked=\{isExpanded\}/);
		assert.match(source, /setIsExpanded\(false\)/);
		assert.match(source, /setSearchQuery\(['"]{2}\)/);
		assert.match(
			source,
			/setIsExpanded\(false\);\s*setSearchQuery\(['"]{2}\);/,
		);
		assert.match(source, /onClick=\{\(\) => setExpanded\(!isExpanded\)\}/);
		assert.match(
			source,
			/onChange\(\[\.\.\.selectedIds, user\.id\]\)[\s\S]*setSearchQuery\(['"]{2}\)/,
		);
		assert.match(
			source,
			/export \{ CustomApprovalPicker as SolutionModalApprovalPickerHarness \}/,
		);
		assert.doesNotMatch(source, /function SolutionModalApprovalPickerHarness/);
		assert.doesNotMatch(source, /currentUserId/);
	});
});
