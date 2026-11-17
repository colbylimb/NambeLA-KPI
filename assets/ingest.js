/* Turns a pharmacy dispensing export into daily counts and merges them
 * into data/daily.csv.
 *
 *   Rx Processed = every dated row (one row per prescription)
 *   Vaccines  = rows whose Therapeutic Class contains "VACCINE"
 *   Compounds = rows whose "Is Compound?" column is Yes
 *
 * Merging is by date: a date that appears in the new file replaces that
 * date's counts; every other saved date is kept. Re-uploading the same
 * file therefore never double-counts, and a new file never wipes old days.
 *
 * Works in the browser (window.NambeIngest) and in Node (module.exports).
 */
(function (root) {
  "use strict";

  // ---------- CSV parsing (RFC 4180: quoted fields, embedded commas/newlines) ----------
  function parseCsvRows(text) {
    text = String(text).replace(/^﻿/, "");
    var rows = [], row = [], field = "", i = 0, q = false, c;
    while (i < text.length) {
      c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { q = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // "11/9/2026", "11/09/26", "11/9/2026 3:14 PM", "2026-11-09", "2026-11-09T15:00"
  function parseDate(s) {
    s = String(s || "").trim();
    var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})\b/.exec(s), y, mo, d;
    if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1) return null;          // e.g. 2/30
    return y + "-" + pad(mo) + "-" + pad(d);
  }

  function findCol(header, patterns) {
    for (var p = 0; p < patterns.length; p++) {
      for (var i = 0; i < header.length; i++) if (patterns[p].test(header[i])) return i;
    }
    return -1;
  }

  /** Read one export. Returns { days: {date: {rx, vaccines, compounds}}, rows, skipped, columns }. */
  function summarizeExport(text) {
    var rows = parseCsvRows(text);
    var hIdx = -1, header;
    for (var r = 0; r < Math.min(rows.length, 30); r++) {
      var h = rows[r].map(norm);
      if (h.some(function (c) { return /date/.test(c); }) &&
          h.some(function (c) { return /compound|therapeutic|class/.test(c); })) { hIdx = r; header = h; break; }
    }
    if (hIdx < 0) throw new Error("Couldn’t find the header row. The file needs a date column plus “Is Compound?” and/or “Therapeutic Class”.");

    var cDate = findCol(header, [/dispens.*date/, /fill.*date/, /date/]);
    var cComp = findCol(header, [/is\s*compound/, /compound/]);
    var cClass = findCol(header, [/therapeutic\s*class/, /therapeutic/, /\bclass\b/]);
    if (cComp < 0 && cClass < 0) throw new Error("Couldn’t find an “Is Compound?” or “Therapeutic Class” column.");

    var days = {}, counted = 0, skipped = 0;
    for (var k = hIdx + 1; k < rows.length; k++) {
      var row = rows[k];
      if (!row.some(function (c) { return String(c).trim() !== ""; })) continue;   // blank line
      var date = parseDate(row[cDate]);
      if (!date) { skipped++; continue; }                                          // totals/footer lines
      var day = days[date] || (days[date] = { rx: 0, vaccines: 0, compounds: 0 });
      day.rx++; counted++;
      if (cClass >= 0 && /vaccin/i.test(row[cClass] || "")) day.vaccines++;
      if (cComp >= 0 && /^\s*(y|yes|true|1)\s*$/i.test(row[cComp] || "")) day.compounds++;
    }
    if (!counted) throw new Error("No rows with a readable date were found.");
    return {
      days: days, rows: counted, skipped: skipped,
      columns: { date: header[cDate], compound: cComp >= 0 ? header[cComp] : null, cls: cClass >= 0 ? header[cClass] : null }
    };
  }

  // ---------- data/daily.csv ----------
  var FIELDS = ["rx", "vaccines", "compounds"];

  function parseDaily(text) {
    var out = { sample: false, days: {} }, cols = ["date", "vaccines", "compounds"];   // older files had no rx column
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var raw = line.trim();
      if (!raw) return;
      if (raw[0] === "#") { if (/sample/i.test(raw)) out.sample = true; return; }
      var c = raw.split(",").map(function (x) { return x.trim(); });
      if (/^date$/i.test(c[0])) { cols = c.map(function (x) { return x.toLowerCase(); }); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c[0])) return;
      var d = {};
      FIELDS.forEach(function (f) { var i = cols.indexOf(f), v = i < 0 ? "" : c[i]; d[f] = v === "" || v == null ? null : +v; });
      out.days[c[0]] = d;
    });
    return out;
  }

  function serializeDaily(days) {
    var lines = ["date," + FIELDS.join(",")];
    Object.keys(days).sort().forEach(function (k) {
      lines.push([k].concat(FIELDS.map(function (f) { return days[k][f] == null ? "" : days[k][f]; })).join(","));
    });
    return lines.join("\n") + "\n";
  }

  /** Merge new per-day counts into the saved file. Sample data is dropped on the first real upload. */
  function merge(existingText, newDays) {
    var ex = parseDaily(existingText);
    var base = ex.sample ? {} : ex.days;
    var merged = {}, changes = [];
    Object.keys(base).forEach(function (k) { merged[k] = base[k]; });
    Object.keys(newDays).sort().forEach(function (k) {
      var n = newDays[k], old = base[k];
      var status = !old ? "new"
        : FIELDS.every(function (f) { return old[f] === n[f]; }) ? "same" : "replaced";
      changes.push({ date: k, rx: n.rx, vaccines: n.vaccines, compounds: n.compounds, status: status, old: old || null });
      merged[k] = { rx: n.rx, vaccines: n.vaccines, compounds: n.compounds };
    });
    return { text: serializeDaily(merged), changes: changes, clearedSample: ex.sample, keptDays: Object.keys(base).length };
  }

  /** Combine several exports picked at once. Files are applied in the order given (later wins per date). */
  function combine(summaries) {
    var days = {};
    summaries.forEach(function (s) { Object.keys(s.days).forEach(function (k) { days[k] = s.days[k]; }); });
    return days;
  }

  var api = { parseCsvRows: parseCsvRows, parseDate: parseDate, summarizeExport: summarizeExport,
              parseDaily: parseDaily, serializeDaily: serializeDaily, merge: merge, combine: combine };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NambeIngest = api;
})(this);
