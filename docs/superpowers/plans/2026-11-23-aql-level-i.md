# AQL Level I · 6.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนการคำนวณและการแสดงตาราง AQL ของฟอร์มตรวจรับจากระดับ II · 6.5 เป็นระดับ I · 6.5 ตามตารางอ้างอิงใหม่ โดยให้ backend และ frontend ใช้ข้อมูลชุดเดียวกัน

**Architecture:** `apps-script/Code.gs` เป็นแหล่งข้อมูลกลางของ `AQL_TABLE`, `AQL_LEVEL` และ `AQL_VALUE`; `aql_()` ใช้ตารางนี้คำนวณแผนสุ่มตรวจ และ `actionBootstrap_()` ส่งตาราง/ระดับไปยัง frontend. `docs/assets/app.js` จะแสดงค่าจาก bootstrap และจะไม่มีข้อความระดับ II ที่เขียนตายตัวเหลืออยู่

**Tech Stack:** Google Apps Script JavaScript, browser JavaScript/HTML template strings, Node.js assertion-based mock tests, GitHub Pages (`docs/`)

**Spec:** `docs/superpowers/specs/2026-11-23-aql-level-i-design.md`

## Global Constraints

- ใช้ AQL ระดับ `I` และค่า `6.5`.
- ใช้ช่วง/ค่า Code/Sample/AC/RE ตามตารางใหม่ในสเปกทุกแถว.
- Lot = 1 ยังคงเป็น Code A, Sample 1, AC 0, RE 1.
- Lot มากกว่า 10,000 ยังคงใช้แถวสุดท้าย J / 200 / 21 / 22.
- ไม่ auto-select ผลรวม Pass / Fail และไม่ backfill ข้อมูลตรวจรับเก่าที่บันทึกแล้ว.
- Frontend ต้องใช้ metadata/table จาก `bootstrap` เป็นหลัก; ข้อความอ้างอิงที่แสดงต้องเป็นระดับ I · 6.5.

## Review Focus

- Lot ที่อยู่ตรงขอบเขต 8/9, 15/16, 25/26, 50/51 และ 90/91 ต้องเลือกแถวใหม่ถูกต้อง — pinned in Task 1 AQL boundary test.
- Lot 150/151, 280/281, 500/501, 1,200/1,201 และ 3,200/3,201 ต้องเปลี่ยน Code/Sample/AC/RE ตามภาพ — pinned in Task 1 full table test.
- Lot = 1, 10,000, 10,001, ค่าว่าง, ศูนย์ และทศนิยมต้องคงพฤติกรรมที่ระบุ — pinned in Task 1 edge/error test.
- Backend metadata และข้อความ/ตาราง frontend ต้องไม่เหลือการอ้างอิงระดับ II — pinned in Task 1 source contract test.
- การส่งฟอร์มต้องใช้ค่าแผนจาก `aql_()` ชุดใหม่ ไม่ใช่เพียงเปลี่ยนข้อความ UI — pinned in Task 1 submit regression assertions.

---

### Task 1: Update the AQL regression contract

**Files:**
- Modify: `test/gas-mock.js:487-510` — expected bootstrap metadata and AQL mapping tests.
- Modify: `test/form-no-lot.js:1-20` — frontend/source contract assertions for the new level.

**Interfaces:**
- Consumes: existing `ctx.aql_()` and public `bootstrap` test helpers.
- Produces: failing tests that define Level I · 6.5 table values and frontend copy requirements for Task 2.

- [ ] **Step 1: Update the bootstrap assertion** to require `b.aql.level === "I"`, keep `b.aql.value === "6.5"`, and assert the complete `b.aql.table` equals the 11 Level I rows from the spec.
- [ ] **Step 2: Replace the Level II AQL test** with named assertions for all exact boundary pairs, Lot = 1, Lot > 10,000, and invalid inputs. Add submit-path assertions that a lot in a changed band persists the new Code/Sample/AC/RE values.
- [ ] **Step 3: Add frontend contract assertions** requiring the Level I copy and rejecting stale `ระดับ II` / `Level II` AQL references in `docs/assets/app.js` and `apps-script/Code.gs`.
- [ ] **Step 4: Run the tests to verify RED.**

Run:

```bash
node test/form-no-lot.js
node test/gas-mock.js
```

Expected: failures identify the current Level II metadata/table and stale copy; no unrelated test setup error.

- [ ] **Step 5: Commit the test contract** with `git add test/gas-mock.js test/form-no-lot.js && git commit -m "test: define AQL level I contract"`.

### Task 2: Implement the Level I source of truth and UI copy

**Files:**
- Modify: `apps-script/Code.gs:3,104-114` — comments, `AQL_TABLE`, and `AQL_LEVEL`.
- Modify: `docs/assets/app.js:19,386-389` — menu/table labels use Level I/dynamic bootstrap level.
- Modify: `docs/index.html:app.js cache-bust` — bump the asset query version.
- Modify: `README.md:3` — document AQL Level I · 6.5.

**Interfaces:**
- Consumes: Task 1’s expected `AQL_TABLE` row shape `[lotFrom, lotTo, code, sample, ac, re]` and public `aql_()` contract.
- Produces: `AQL_LEVEL === "I"`; `aql_()` and `bootstrap().aql.table` return the new plan used by all future submissions/edits; frontend labels and reference table identify Level I · 6.5.

- [ ] **Step 1: Replace the backend AQL rows** with the exact Level I table from the spec, set `AQL_LEVEL` to `"I"`, and update comments without changing the existing Lot = 1 or >10,000 fallback logic.
- [ ] **Step 2: Remove hardcoded Level II frontend copy** by using `b.aql.level` in the new-form subtitle and AQL reference summary; retain the dynamic `b.aql.table.map(...)` rendering.
- [ ] **Step 3: Update the README and bump the frontend asset cache version** so deployed browsers load the new labels.
- [ ] **Step 4: Run the targeted tests and syntax check to verify GREEN.**

Run:

```bash
node test/form-no-lot.js
node test/gas-mock.js
node --check docs/assets/app.js
git diff --check
```

Expected: `form-entry-contract: ok`, `28 passed, 0 failed` (or the updated full count), syntax check exits 0, and no whitespace errors.

- [ ] **Step 5: Commit implementation** with `git add apps-script/Code.gs docs/assets/app.js docs/index.html README.md test/gas-mock.js test/form-no-lot.js docs/superpowers/specs/2026-11-23-aql-level-i-design.md docs/superpowers/plans/2026-11-23-aql-level-i.md && git commit -m "feat: switch inspection sampling to AQL level I"`.

### Task 3: Final verification and publish gate

**Files:**
- Verify: all files changed in Tasks 1–2 and the live GitHub Pages/Apps Script endpoints after explicit publish approval.
- Modify: `.superpowers/sdd/aql-level-i/progress.md` — execution ledger and verification evidence.

**Interfaces:**
- Consumes: Task 2’s committed frontend/backend source and tests.
- Produces: verified commit, live site asset with Level I copy, and Apps Script deployment using the same source.

- [ ] **Step 1: Run the complete local verification suite** (`node test/form-no-lot.js`, `node test/gas-mock.js`, `node --check docs/assets/app.js`, `git diff --check`) and record results in the ledger.
- [ ] **Step 2: Perform a final read-only diff review** against the pre-change commit, checking that only AQL level/table/copy/cache/test/docs changes are present.
- [ ] **Step 3: Stop for explicit user approval immediately before pushing/deploying** because GitHub Pages and Apps Script are external side effects.
- [ ] **Step 4: Push `main`, update the existing Apps Script web-app deployment to a new version, and verify the deployed page asset and `bootstrap` API return HTTP 200 with Level I metadata/table.
- [ ] **Step 5: Complete the ledger and report the live URL, commit, deployment version, and verification results.**
