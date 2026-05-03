# src/api/classifier.ts — audit if still used
- Read the file, check what it exports.
- Search all other files for imports of classifier: `grep -rn "classifier" src/api/ src/index.ts`.
- If the classifier router is not mounted in src/index.ts, mark for deletion.
Verification:
- File is either mounted+used or deleted. `npx tsc --noEmit` passes.
