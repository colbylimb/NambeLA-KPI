I need step-by-step help building a nightly Microsoft 365 automation. I'm not a developer, so give me exact click paths, exact expressions to paste, and full code. Build it in the order below and check in with me after each part so I can confirm it works before we move on.

## What already exists

- A KPI dashboard for my pharmacy (Nambe Drugs Los Alamos), hosted on GitHub Pages from the GitHub repo **colbylimb/NambeLA-KPI**, branch **main**.
- The dashboard reads one file: **`data/daily.csv`** in that repo. It re-reads the file every 10 minutes, so updating that file is all it takes to update the TV.
- `daily.csv` format (exact header, one row per day, sorted by date, ISO dates, plain integers, `\n` line endings, trailing newline):
  ```
  date,rx,vaccines,compounds
  2026-11-09,214,12,9
  2026-11-10,198,8,11
  ```
- Right now `daily.csv` contains made-up sample data and starts with a comment line containing the word `SAMPLE`. **If the file contains a line starting with `#` that includes "SAMPLE", the first real run must throw away all existing rows** and write only real data. After that, never delete existing days.
- There's also a manual upload page on the dashboard that writes to the same file, so the automation must **merge into the current file**, not overwrite it from scratch.

## The input

- Every night at **11:45 PM (Mountain Time, America/Denver)** our pharmacy system emails a **CSV attachment** to my Outlook inbox. I'll tell you the sender address and subject line when we get there.
- The CSV columns: **`Dispensed Date`**, **`Vaccine`** (actually the drug name), **`Is Compound?`**, **`Therapeutic Class`**. One row per prescription.
- Dates look like `11/9/2026` (M/D/YYYY, no leading zeros, sometimes possibly with a time after them).
- Some Therapeutic Class values contain commas and are quoted, e.g. `"ANXIOLYTICS,SEDATIVES,AND HYPNOTICS,MISC"`, so the CSV must be parsed properly (quote-aware), not just split on commas.
- The file may have title lines above the header and a total/footer line at the bottom. Find the header row by looking for the `Dispensed Date` column, and skip any row whose date doesn't parse.

## Counting rules (must match the dashboard exactly)

Group rows by **Dispensed Date**. For each date:
- **rx** (shown as "Rx Processed") = number of rows with a valid date
- **vaccines** = rows where `Therapeutic Class` contains "VACCIN" (case-insensitive)
- **compounds** = rows where `Is Compound?` is Yes / Y / True / 1 (case-insensitive)

**Merge rule:** a date that appears in the new export **replaces** that date's row; every other date already in `daily.csv` is kept unchanged. Re-running on the same email must not double-count.

## What I want built

1. **An Excel workbook in SharePoint** (tell me where to put it, e.g. a document library in my team site) with a table named `Daily` (`Date`, `RxProcessed`, `Vaccines`, `Compounds`, `UpdatedAt`) that keeps a running history, upserted by date with the same merge rule. This is our backup copy and something staff can open.

2. **An Office Script** (TypeScript, saved to that workbook) that Power Automate can run, with:
   - inputs: `exportCsv: string` (the raw attachment text) and `currentDailyCsv: string` (the current contents of `data/daily.csv` from GitHub, may be empty)
   - behavior: parse the export, compute per-day counts, upsert them into the `Daily` table, merge them into `currentDailyCsv` using the merge and SAMPLE rules above
   - returns: an object with `dailyCsv` (the full merged file text in the exact format above), `daysUpdated` (count), and a short `summary` string like "2026-11-17: 214 Rx, 12 vaccines, 9 compounds"
   - Remember Office Scripts can't call external APIs when run from Power Automate, so the script should only do parsing and Excel work. Power Automate does the GitHub calls.

3. **A Power Automate cloud flow**:
   - **Trigger:** Recurrence, every day at **11:59 PM**, time zone **(UTC-07:00) Mountain Time**.
   - Find tonight's email: from the pharmacy-system sender, received today (Mountain Time), with a `.csv` attachment. Use the newest one if there's more than one.
   - Get the attachment content and convert it to text.
   - **GET** the current file from GitHub: `GET https://api.github.com/repos/colbylimb/NambeLA-KPI/contents/data/daily.csv?ref=main` with headers `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. Take `content` (base64, contains line breaks; strip them before decoding) and `sha` from the response.
   - Run the Office Script with the attachment text and the decoded current file.
   - **PUT** the result back: `PUT https://api.github.com/repos/colbylimb/NambeLA-KPI/contents/data/daily.csv` with JSON body `{ "message": "Nightly update: <summary>", "content": "<base64 of dailyCsv>", "sha": "<sha from the GET>", "branch": "main" }`. If the PUT returns 409 (file changed in between), re-GET and retry once.
   - Turn on **Secure inputs/outputs** for the HTTP actions so the token isn't visible in run history.
   - **Failure handling:** if no email is found, or any step fails, send me an Outlook email (or Teams message) saying what went wrong. Also send a short success email with the summary. Tell me how to set "run after" so the failure branch actually fires.

## Things to check with me / tell me up front

- The **HTTP** action is a **premium** connector. Tell me how to check whether my license includes it. If it doesn't, give me the best alternative (for example a custom connector, or another approach) and explain the tradeoffs.
- The GitHub token: I'll create a **fine-grained personal access token** limited to the `colbylimb/NambeLA-KPI` repo with **Contents: Read and write**. Tell me the safest place to store it in Power Automate (e.g. an environment variable / secret, or at minimum a secure Compose action), and remind me it expires so I need to renew it.
- Risk of timing: the email comes at 11:45 and the flow runs at 11:59. If the email is late, the run finds nothing. Give me a simple safeguard (e.g. a second run at 12:30 AM that only acts if no update happened, or switching to a "When a new email arrives" trigger) and recommend one.
- Any time zone gotchas (Power Automate runs in UTC; the "received today" filter must use Mountain Time).

## How to test

Give me a test plan:
1. Run the Office Script by hand in Excel with a small pasted sample (include a sample export with 2 dates, a quoted class containing commas, a vaccine row, a compound row, and a footer line) and show me the expected output.
2. Test the flow manually against a real email before turning on the schedule.
3. How to confirm the dashboard updated: open `https://github.com/colbylimb/NambeLA-KPI/blob/main/data/daily.csv`, then the dashboard within ~10 minutes.
