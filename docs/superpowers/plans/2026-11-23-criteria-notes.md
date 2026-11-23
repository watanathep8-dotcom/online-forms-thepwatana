# Optional Criteria Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional, category-specific `หมายเหตุ` text fields to the physical-inspection criteria table and persist them with each inspection.

**Architecture:** Keep the existing static GitHub Pages frontend and Apps Script/Google Sheet backend. The browser will keep a category-keyed notes object and submit it as JSON; Apps Script will append one optional `criteria_notes` column and preserve empty/missing values for legacy inspections.

**Tech Stack:** Plain HTML/JavaScript frontend, Google Apps Script backend, Google Sheets persistence, Node-based mock tests.

**Spec:** `docs/superpowers/specs/2026-11-23-criteria-notes-design.md`

## Global Constraints

- Notes are optional and must never block submission.
- Notes are stored per packaging-category row, not per individual checkbox.
- Existing inspection rows must remain readable when `criteria_notes` is empty or absent.
- Only the active category row is editable in the entry form; other category rows remain read-only/disabled.
- Existing checklist text, Pass/Fail rules, catalog data, photos, signatures, and authentication behavior remain unchanged.

## Review Focus

- **Legacy row without `criteria_notes`:** form and detail view render normally with no note.
- **Empty note:** submission succeeds and stores an empty JSON object/value.
- **Thai text, quotes, newlines, and HTML-looking text:** value is escaped in the UI and round-trips without creating markup.
- **Category change while editing:** only the currently selected category is editable; old notes are not silently deleted.
- **Unknown/malformed note keys:** backend ignores or rejects invalid keys without corrupting the inspection row.

### Task 1: Add failing notes contract tests

**Files:**
- Modify: `test/form-no-lot.js`
- Test: `test/form-no-lot.js`

**Interfaces:**
- Consumes: current frontend source and Apps Script source.
- Produces: assertions for the `หมายเหตุ` column, `criteria_notes` payload/schema, optional empty notes, and detail rendering.

- [x] **Step 1: Write the failing assertions**

Assert that the frontend contains the `หมายเหตุ` column and `criteria_notes` state/payload, and that Apps Script contains the `criteria_notes` inspection column and optional normalization path.

- [x] **Step 2: Run the contract test and verify RED**

Run: `node test/form-no-lot.js`

Expected: FAIL because the current source has no criteria-notes UI or persistence field.

### Task 2: Implement frontend notes state and entry table

**Files:**
- Modify: `docs/assets/app.js`

**Interfaces:**
- Consumes: `b.categories`, existing `old` inspection data, and current form submission body.
- Produces: category-keyed `criteria_notes` JSON in submit/edit requests; optional note textarea in the active criteria row.

- [x] **Step 1: Add `criteriaNotes` state**

Initialize from `old.criteria_notes` when present, otherwise `{}`. Keep the notes keyed by category key so each row has stable storage independent of row order.

- [x] **Step 2: Render the `หมายเหตุ` column**

Extend `renderCrit()` with a final table header and cell. Render a textarea/input for the active category row only, with Thai placeholder text and no `required` attribute. Escape stored text before rendering and update the category-keyed state on input.

- [x] **Step 3: Submit and display notes**

Add `criteria_notes` to the submit body. In the saved-inspection detail view, render non-empty notes beside/under the matching category row and omit empty notes. Keep the existing checklist and result behavior unchanged.

- [x] **Step 4: Run the contract test and verify GREEN**

Run: `node test/form-no-lot.js`

Expected: PASS for the frontend assertions.

### Task 3: Persist optional notes in Apps Script

**Files:**
- Modify: `apps-script/Code.gs`
- Modify: `test/gas-mock.js`

**Interfaces:**
- Consumes: frontend `criteria_notes` JSON object keyed by category key.
- Produces: optional `inspections.criteria_notes` JSON string; old rows remain valid.

- [x] **Step 1: Append the schema column**

Add `criteria_notes` as a string column in `SCHEMA.inspections`; rely on the existing append-only table migration behavior so old Google Sheet rows are not rewritten.

- [x] **Step 2: Normalize on submit/update**

Parse an absent/empty value as `{}`. Accept only known category keys from the existing category catalog, normalize each note as text with the existing long-text limit, and serialize the resulting object. Never reject a submission merely because notes are absent.

- [x] **Step 3: Add backend behavior coverage**

Update the mock fixture/inspection assertions to verify empty notes are accepted, non-empty category notes are saved, and editing an old inspection without notes does not fail.

- [x] **Step 4: Run the full test suite and verify GREEN**

Run: `node test/form-no-lot.js; node --check docs/assets/app.js; node test/gas-mock.js`

Expected: the contract test passes and the complete mock suite reports 0 failures.

### Task 4: Version, publish, and verify

**Files:**
- Modify: `docs/index.html` (bump the `app.js` query version)

**Interfaces:**
- Consumes: passing frontend/backend changes from Tasks 2–3.
- Produces: GitHub Pages frontend and Apps Script web-app deployment using the existing URLs.

- [x] **Step 1: Bust the frontend asset cache**

Bump the `assets/app.js?v=` value in `docs/index.html`, then run `git diff --check`.

- [ ] **Step 2: Commit and push the frontend/backend source**

Run `git add` for the changed source/tests/docs and commit with a focused message, then push `main` to the existing origin.

- [ ] **Step 3: Deploy Apps Script**

Paste the updated `Code.gs` into the existing Apps Script project, save it, select `เวอร์ชันใหม่` in the existing web-app deployment, and deploy to the existing `/exec` URL.

- [ ] **Step 4: Verify the live result**

Confirm the GitHub Pages index references the new asset version, the live app script contains the `หมายเหตุ` UI contract, the Apps Script endpoint still returns bootstrap data, and the deployed version is shown in Apps Script.

- [ ] **Step 5: Report the live URL and test evidence**

Provide the website link, note that notes are optional, and report the test command results.
