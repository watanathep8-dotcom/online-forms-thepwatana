# Design: Optional criteria notes

## Intent

Add a `หมายเหตุ` column to the physical-inspection criteria table. The inspector can enter a note for the currently selected packaging category, but the field is optional.

## Goals

- Show an editable note cell beside each category row, matching the supplied reference image.
- Persist the note with the inspection and show it when viewing the saved inspection.
- Keep old inspections valid and preserve all existing data; empty notes remain allowed.

## Non-goals

- Do not make notes required or change Pass/Fail rules.
- Do not change the packaging catalog or the existing checklist text.

## Approaches considered

1. One free-text note below the table: simplest, but loses the category context.
2. One note per criteria row: matches the image and keeps the note tied to its category. **Selected.**
3. One note per individual checkbox: more granular than requested and adds unnecessary data-entry work.

## Implementation

- Frontend: add a `หมายเหตุ` column and an optional textarea for each category row; only the active category row is editable. Store notes in a category-keyed object in form state and send it as `criteria_notes`.
- Backend: append an optional `criteria_notes` column to the inspections schema, accept and normalize a category-keyed JSON object, and keep missing values empty for existing records.
- Detail view: render non-empty category notes under the corresponding criteria row; omit empty notes.
- Verification: add a failing contract test first, then run the frontend parse checks and the complete GAS mock suite.

## Constraints and compatibility

The existing Apps Script table helper appends new columns without rewriting old rows. Existing inspections therefore remain readable, and the new field is optional for both new and edited submissions.
