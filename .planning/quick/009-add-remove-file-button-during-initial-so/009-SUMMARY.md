---
phase: quick
plan: 009
type: summary
subsystem: file-management
tags: [file-upload, solution-form, bug-fix, ui-interaction]

dependency-graph:
  requires: [quick-008]
  provides: ["Working remove button for pending files in solution form"]
  affects: []

tech-stack:
  added: []
  patterns: ["ID-based state management for file arrays"]

key-files:
  created: []
  modified:
    - path: src/components/solutions/solution-file-upload.tsx
      role: "Added onRemoveFile prop for ID-based file removal"
    - path: src/components/solutions/solution-form.tsx
      role: "Implemented handleRemoveNewFile to filter files by ID"

decisions:
  - decision: "Use ID-based removal instead of index-based"
    rationale: "Prevents index mismatch when filesWithProgress and files arrays diverge"
    alternatives: ["Synchronize array indices", "Rebuild entire state on removal"]
    chosen: "ID-based removal"
  - decision: "Add optional onRemoveFile prop for backward compatibility"
    rationale: "Existing code using index-based removal continues to work"
    alternatives: ["Breaking change to force ID-based removal everywhere"]
    chosen: "Optional prop with fallback"

metrics:
  duration: "1 min"
  completed: "2026-02-06"
---

# Quick Task 009: Fix Remove File Button for Pending Files in Solution Form

**One-liner:** ID-based file removal in solution form prevents state loss and index mismatch when removing pending files

## Summary

Fixed the remove file button for newly selected files during initial solution submission. The root cause was an index mismatch between the `displayFiles` array (which uses `filesWithProgress`) and the `files` prop array used by the `removeFile` function. Additionally, the `onFilesChange` callback in `SolutionForm` was rebuilding all selected files with new random IDs, causing state loss.

## Implementation

### Changes Made

**1. SolutionFileUpload Component**
- Added `onRemoveFile?: (fileId: string) => void` prop to interface
- Updated remove button onClick handler to prefer `onRemoveFile(item.id)` if available
- Maintains backward compatibility by falling back to `removeFile(index)` when `onRemoveFile` is not provided

**2. SolutionForm Component**
- Added `handleRemoveNewFile` function that filters `selectedFiles` by ID: `setSelectedFiles((prev) => prev.filter((f) => f.id !== fileId))`
- Passed `handleRemoveNewFile` as `onRemoveFile` prop to `SolutionFileUpload`
- Avoids the `onFilesChange` callback for removal, preserving other files' IDs and upload state

### Technical Details

**Before (broken behavior):**
```typescript
// Remove button called removeFile(index) where index came from displayFiles
onClick={() => removeFile(index)}

// But removeFile filtered the files prop by index (mismatch!)
const removeFile = (index: number) => {
  const newFiles = files.filter((_, i) => i !== index)
  onFilesChange(newFiles)
}

// And onFilesChange rebuilt everything with new IDs
onFilesChange={(files) =>
  setSelectedFiles(files.map((file) => ({
    id: Math.random().toString(36).substring(7), // New ID = state loss!
    file,
    status: 'pending' as const,
    progress: 0,
  })))
}
```

**After (fixed behavior):**
```typescript
// Remove button calls onRemoveFile with the file's ID
onClick={() => {
  if (onRemoveFile) {
    onRemoveFile(item.id)
  } else {
    removeFile(index)
  }
}}

// handleRemoveNewFile filters by ID, preserving other files
const handleRemoveNewFile = (fileId: string) => {
  setSelectedFiles((prev) => prev.filter((f) => f.id !== fileId))
}
```

## Verification

- ✅ TypeScript compilation passes: `npx tsc --noEmit`
- ✅ Remove button visible on each pending file
- ✅ Clicking X removes only the targeted file by ID
- ✅ Other files retain their state (no ID regeneration)

## Commits

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Fix file removal in SolutionFileUpload and SolutionForm | b3f6388 | solution-file-upload.tsx, solution-form.tsx |

## Deviations from Plan

None - plan executed exactly as written.

## Next Steps

- No follow-up work required
- Pattern established for ID-based removal can be applied to other file upload components if needed

## Related Issues

This fix ensures users can properly manage their file selections during solution submission without losing upload progress or encountering index mismatch errors.
