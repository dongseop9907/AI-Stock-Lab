v9.7.1 OpenDART Corporate Action Source Inventory

Run from C:\Users\user\Desktop\ai-stock-lab after extracting the script into the project root.

powershell.exe `
  -ExecutionPolicy Bypass `
  -File ".\run-opendart-corporate-action-source-inventory-v9-7-1.ps1" `
  -StartDate "2023-01-02" `
  -EndDate "2026-07-31" `
  -ChunkCalendarDays 90 `
  -RequestDelayMs 300

The script is resumable and writes:
  .\logs\corporate-action-v9-7-1-state.json
  .\logs\corporate-action-v9-7-1\candidates-<start>-<end>.json
  .\logs\corporate-action-v9-7-1\source-inventory-evidence.json

This stage proves that every OpenDART disclosure-list page for KOSPI/KOSDAQ was scanned over the requested range.
It intentionally does NOT create a COMPLETE v9.7 source-coverage row. Candidate disclosures still need structured detail parsing and ingestion into corporate_action_events.
