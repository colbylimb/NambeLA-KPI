/* Nambe Drugs Los Alamos — KPI wall display.
 * Reads data/daily.csv (date,vaccines,compounds), one row per day.
 * The CSV is updated once a day at 8 PM; this page re-checks it every
 * 10 minutes, so the screen picks up the new numbers on its own.
 */
(function () {
  "use strict";

  var DATA_URL = "data/daily.csv";
  var REFRESH_MS = 10 * 60 * 1000;      // re-read the CSV every 10 minutes
  var UPDATE_HOUR = 20, UPDATE_GRACE_MIN = 30; // expect new data by 8:30 PM

  var METRICS = [
    { key: "vaccines",  name: "Vaccines",  unit: "vaccines given", icon: "syringe" },
    { key: "compounds", name: "Compounds", unit: "compounds made", icon: "flask" }
  ];

  var COLORS = { bar: "#1D7A4D", accent: "#50B341", ghost: "#D3DAD6", surface: "#FFFFFF" };

  var ICONS = {
    syringe: '<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/>',
    flask: '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
    up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    flat: '<path d="M5 12h14"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
  }

  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var MON = MONTHS.map(function (m) { return m.slice(0, 3); });
  var DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // ---------- Date helpers (all calendar dates, local time) ----------
  function key(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }   // m is 0-based
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function daysIn(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function prevMonth(y, m) { return m === 0 ? { y: y - 1, m: 11 } : { y: y, m: m - 1 }; }
  function addMonths(y, m, k) { var t = y * 12 + m + k; return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 }; }
  function fmtShort(y, m, d) { return MON[m] + " " + d; }
  function fmtLong(y, m, d) { return DOW[new Date(y, m, d).getDay()] + ", " + MON[m] + " " + d; }
  function fmtNum(n) { return n == null ? "—" : Math.round(n).toLocaleString("en-US"); }

  // ---------- Data ----------
  var state = { rows: null, byKey: {}, sample: false, latest: null, lastFetchOk: true, lastFetchAt: null };

  function parseCsv(text) {
    var rows = [], sample = false, header = null;
    text.split(/\r?\n/).forEach(function (line) {
      var raw = line.trim();
      if (!raw) return;
      if (raw.charAt(0) === "#") { if (/sample/i.test(raw)) sample = true; return; }
      var cells = raw.split(",").map(function (c) { return c.trim(); });
      if (!header) {
        if (/date/i.test(cells[0])) { header = cells.map(function (c) { return c.toLowerCase(); }); return; }
        header = ["date", "vaccines", "compounds"];
      }
      var rec = {};
      header.forEach(function (h, i) { rec[h] = cells[i]; });
      var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(rec.date || "");
      if (!m) return;
      var row = { y: +m[1], m: +m[2] - 1, d: +m[3] };
      row.key = key(row.y, row.m, row.d);
      METRICS.forEach(function (mt) {
        var v = rec[mt.key];
        row[mt.key] = v === undefined || v === "" || isNaN(+v) ? null : +v;
      });
      rows.push(row);
    });
    rows.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
    return { rows: rows, sample: sample };
  }

  function load() {
    return fetch(DATA_URL + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (text) {
        var parsed = parseCsv(text);
        if (!parsed.rows.length) throw new Error("No rows in " + DATA_URL);
        state.rows = parsed.rows;
        state.sample = parsed.sample;
        state.byKey = {};
        parsed.rows.forEach(function (r) { state.byKey[r.key] = r; });
        state.latest = parsed.rows[parsed.rows.length - 1];
        state.lastFetchOk = true;
        state.lastFetchAt = new Date();
        render();
      })
      .catch(function (err) {
        console.error(err);
        state.lastFetchOk = false;
        if (!state.rows) {
          document.getElementById("grid").innerHTML =
            '<div class="empty">Couldn’t load ' + DATA_URL + ". Retrying in a few minutes.</div>";
        }
        renderStatus();
      });
  }

  function val(metric, y, m, d) {
    var r = state.byKey[key(y, m, d)];
    return r ? r[metric] : null;
  }
  function sumRange(metric, y, m, d1, d2) {
    var s = 0, any = false;
    for (var d = d1; d <= d2; d++) { var v = val(metric, y, m, d); if (v != null) { s += v; any = true; } }
    return any ? s : null;
  }

  // Every number on the board is anchored to the latest day in the CSV.
  function compute(metric) {
    var L = state.latest, y = L.y, m = L.m, d = L.d;
    var p = prevMonth(y, m);
    var pd = Math.min(d, daysIn(p.y, p.m));               // Mar 31 compares to Feb 28/29
    var out = {
      y: y, m: m, d: d, p: p, pd: pd,
      day: val(metric, y, m, d),
      dayPrev: val(metric, p.y, p.m, pd),
      mtd: sumRange(metric, y, m, 1, d),
      mtdPrev: sumRange(metric, p.y, p.m, 1, pd)
    };

    // Daily series for this month and last month (by day of month).
    var dimCur = daysIn(y, m), dimPrev = daysIn(p.y, p.m);
    out.daily = [];
    for (var i = 1; i <= dimCur; i++) {
      out.daily.push({
        day: i,
        cur: i <= d ? val(metric, y, m, i) : null,
        prev: i <= dimPrev ? val(metric, p.y, p.m, i) : null
      });
    }

    // Last 12 months of totals, current month = month to date.
    out.monthly = [];
    for (var k = -11; k <= 0; k++) {
      var mm = addMonths(y, m, k);
      var last = k === 0 ? d : daysIn(mm.y, mm.m);
      out.monthly.push({ y: mm.y, m: mm.m, total: sumRange(metric, mm.y, mm.m, 1, last), current: k === 0 });
    }
    var dim = dimCur;
    out.pace = out.mtd != null && d < dim ? Math.round(out.mtd / d * dim) : null;
    out.prevTotal = out.monthly[10].total;
    return out;
  }

  // ---------- Rendering ----------
  function deltaPill(cur, prev) {
    if (cur == null || prev == null) return "";
    if (prev === 0) return cur === 0 ? '<span class="delta flat">' + icon("flat") + "Same</span>" : "";
    var pct = (cur - prev) / prev * 100;
    var r = Math.round(pct);
    if (r === 0) return '<span class="delta flat">' + icon("flat") + "Even</span>";
    var dir = r > 0 ? "up" : "down";
    return '<span class="delta ' + dir + '">' + icon(dir) + Math.abs(r) + "%</span>";
  }

  function dayLabel(y, m, d) {
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var that = new Date(y, m, d);
    var diff = Math.round((today - that) / 86400000);
    if (diff === 0) return "Today · " + fmtShort(y, m, d);
    if (diff === 1) return "Yesterday · " + fmtShort(y, m, d);
    return fmtLong(y, m, d);
  }

  function compareText(prev, label) {
    return prev == null ? "<span>No data yet for " + label + "</span>" : "<span>vs <b>" + fmtNum(prev) + "</b> on " + label + "</span>";
  }

  function panelHtml(mt, c) {
    var mName = MONTHS[c.m], pName = MONTHS[c.p.m];
    return '' +
      '<section class="panel" aria-label="' + mt.name + '">' +
        '<div class="panel-head"><div class="panel-icon">' + icon(mt.icon) + "</div><h2>" + mt.name + "</h2></div>" +
        '<div class="kpis">' +
          '<div class="kpi is-primary">' +
            '<div class="overline">' + dayLabel(c.y, c.m, c.d) + "</div>" +
            '<div class="value">' + fmtNum(c.day) + "</div>" +
            '<div class="compare">' + deltaPill(c.day, c.dayPrev) +
              compareText(c.dayPrev, fmtShort(c.p.y, c.p.m, c.pd)) + "</div>" +
          "</div>" +
          '<div class="kpi">' +
            '<div class="overline">' + mName + " to date · " + MON[c.m] + " 1–" + c.d + "</div>" +
            '<div class="value">' + fmtNum(c.mtd) + "</div>" +
            '<div class="compare">' + deltaPill(c.mtd, c.mtdPrev) +
              compareText(c.mtdPrev, MON[c.p.m] + " 1–" + c.pd) + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="chart-card daily">' +
          '<div class="chart-head"><h3>' + mName + ", day by day</h3>" +
            '<div class="legend"><span><i style="background:' + COLORS.bar + '"></i>' + mName + "</span>" +
            '<span><i style="background:' + COLORS.ghost + '"></i>' + pName + " (same date)</span></div></div>" +
          '<div class="chart" data-chart="daily" data-metric="' + mt.key + '"></div>' +
        "</div>" +
        '<div class="chart-card monthly">' +
          '<div class="chart-head"><h3>Monthly totals</h3>' +
            '<div class="note">' + [
              c.pace != null ? "On pace for <b>" + fmtNum(c.pace) + "</b> in " + mName : "",
              c.prevTotal != null ? pName + " finished at <b>" + fmtNum(c.prevTotal) + "</b>" : ""
            ].filter(Boolean).join(" · ") + "</div></div>" +
          '<div class="chart" data-chart="monthly" data-metric="' + mt.key + '"></div>' +
        "</div>" +
      "</section>";
  }

  var computed = {};
  function render() {
    if (!state.rows) return;
    var grid = document.getElementById("grid");
    grid.innerHTML = METRICS.map(function (mt) {
      computed[mt.key] = compute(mt.key);
      return panelHtml(mt, computed[mt.key]);
    }).join("");
    drawCharts();
    renderStatus();
    var c = computed[METRICS[0].key];
    document.getElementById("footnote").textContent =
      "Comparisons use the same date last month: " + fmtShort(c.y, c.m, c.d) + " vs " + fmtShort(c.p.y, c.p.m, c.pd) +
      ", and " + MON[c.m] + " 1–" + c.d + " vs " + MON[c.p.m] + " 1–" + c.pd + ".";
    document.getElementById("sample-pill").hidden = !state.sample;
  }

  function renderStatus() {
    var el = document.getElementById("status");
    if (!state.latest) { el.className = "status is-error"; el.innerHTML = icon("alert") + "No data yet"; return; }
    var L = state.latest, now = new Date();
    var afterUpdate = now.getHours() * 60 + now.getMinutes() >= UPDATE_HOUR * 60 + UPDATE_GRACE_MIN;
    var expected = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (afterUpdate ? 0 : 1));
    var latest = new Date(L.y, L.m, L.d);
    var through = "Data through " + fmtLong(L.y, L.m, L.d);
    if (!state.lastFetchOk) {
      el.className = "status is-error"; el.innerHTML = icon("alert") + "Can’t reach data · showing " + fmtShort(L.y, L.m, L.d);
    } else if (latest < expected) {
      el.className = "status is-warning"; el.innerHTML = icon("clock") + "Waiting on 8 PM update · " + through;
    } else {
      el.className = "status"; el.innerHTML = icon("check") + through;
    }
  }

  function tickClock() {
    var now = new Date();
    document.getElementById("clock-time").textContent =
      now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    document.getElementById("clock-date").textContent =
      now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  // ---------- SVG charts ----------
  var NS = "http://www.w3.org/2000/svg";
  function el(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function rem() { return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; }

  function niceScale(max, count) {
    if (!max || max <= 0) return { max: 4, step: 1 };
    var raw = Math.max(1, max / count), mag = Math.pow(10, Math.floor(Math.log10(raw)));   // counts are whole numbers
    var steps = [1, 2, 2.5, 5, 10], step = mag;
    for (var i = 0; i < steps.length; i++) { if (steps[i] * mag >= raw) { step = steps[i] * mag; break; } }
    return { max: Math.ceil(max / step) * step, step: step };
  }

  // Bar with 4px rounded top, square at the baseline.
  function barPath(x, y, w, h, r) {
    if (h <= 0) return "";
    r = Math.min(r, w / 2, h);
    return "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
      "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + "Z";
  }

  function frame(host, yMax, ticks) {
    var R = rem(), W = host.clientWidth, H = host.clientHeight;
    var m = { l: 2.6 * R, r: 0.25 * R, t: 1.5 * R, b: 1.7 * R };
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img" });
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var scale = niceScale(yMax, ticks);
    var y = function (v) { return m.t + ph - (v / scale.max) * ph; };
    for (var t = 0; t <= scale.max + 1e-9; t += scale.step) {
      var yy = Math.round(y(t)) + 0.5;
      svg.appendChild(el("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, "class": t === 0 ? "baseline" : "grid-line" }));
      svg.appendChild(el("text", { x: m.l - 0.6 * R, y: yy, "text-anchor": "end", "dominant-baseline": "middle", "class": "tick" }, fmtNum(t)));
    }
    return { svg: svg, W: W, H: H, m: m, pw: pw, ph: ph, y: y, R: R };
  }

  function drawDaily(host, c) {
    var data = c.daily, n = data.length;
    var maxV = Math.max.apply(null, data.map(function (p) { return Math.max(p.cur || 0, p.prev || 0); }));
    var f = frame(host, maxV, 4), slot = f.pw / n, R = f.R;
    var ghostW = Math.max(4, slot * 0.78), curW = Math.max(3, slot * 0.5);
    var base = f.y(0);

    data.forEach(function (p, i) {
      var cx = f.m.l + slot * i + slot / 2;
      if (p.prev != null && p.prev > 0) {
        f.svg.appendChild(el("path", { d: barPath(cx - ghostW / 2, f.y(p.prev), ghostW, base - f.y(p.prev), 4), fill: COLORS.ghost }));
      }
      if (p.cur != null && p.cur > 0) {
        var isLatest = p.day === c.d;
        f.svg.appendChild(el("path", {
          d: barPath(cx - curW / 2, f.y(p.cur), curW, base - f.y(p.cur), 4),
          fill: isLatest ? COLORS.accent : COLORS.bar,
          stroke: COLORS.surface, "stroke-width": 2, "paint-order": "stroke"
        }));
      }
      // hover target + native tooltip
      var hit = el("rect", { x: f.m.l + slot * i, y: f.m.t, width: slot, height: f.ph, fill: "transparent" });
      hit.appendChild(el("title", {}, fmtShort(c.y, c.m, p.day) + ": " + fmtNum(p.cur) + "  ·  " +
        fmtShort(c.p.y, c.p.m, p.day) + ": " + fmtNum(p.prev)));
      f.svg.appendChild(hit);
    });

    // Value label on the latest day.
    var latest = data[c.d - 1];
    if (latest && latest.cur != null) {
      var lx = f.m.l + slot * (c.d - 1) + slot / 2;
      var top = Math.min(f.y(latest.cur), latest.prev != null ? f.y(latest.prev) : Infinity);
      f.svg.appendChild(el("text", { x: lx, y: top - 0.45 * R, "text-anchor": "middle", "class": "val" }, fmtNum(latest.cur)));
    }

    // Day-of-month ticks: 1, every 5th, last day, and the latest day (bold).
    var show = {};
    show[1] = true; for (var k = 5; k <= n; k += 5) show[k] = true; show[n] = true;
    Object.keys(show).forEach(function (k) { if (Math.abs(+k - c.d) < 2) delete show[k]; });
    if (n - 30 < 2 && show[n] && show[30] && n !== 30) delete show[30];
    show[c.d] = "strong";
    Object.keys(show).forEach(function (k) {
      f.svg.appendChild(el("text", {
        x: f.m.l + slot * (+k - 1) + slot / 2, y: f.H - 0.35 * R, "text-anchor": "middle",
        "class": show[k] === "strong" ? "tick strong" : "tick"
      }, k));
    });

    f.svg.setAttribute("aria-label", MONTHS[c.m] + " daily counts compared with " + MONTHS[c.p.m]);
    host.replaceChildren(f.svg);
  }

  function drawMonthly(host, c) {
    var data = c.monthly, n = data.length;
    var maxV = Math.max(c.pace || 0, Math.max.apply(null, data.map(function (p) { return p.total || 0; })));
    var f = frame(host, maxV, 3), slot = f.pw / n, R = f.R;
    var bw = Math.max(6, Math.min(slot * 0.58, 4 * R)), base = f.y(0);

    data.forEach(function (p, i) {
      var cx = f.m.l + slot * i + slot / 2, x = cx - bw / 2;
      if (p.current && c.pace != null && c.pace > (p.total || 0)) {
        var py = f.y(c.pace);
        f.svg.appendChild(el("path", {
          d: barPath(x + 1, py + 1, bw - 2, base - py - 1, 4),
          fill: "none", stroke: COLORS.accent, "stroke-width": 2, "stroke-dasharray": "5 4"
        }));
      }
      if (p.total != null && p.total > 0) {
        f.svg.appendChild(el("path", {
          d: barPath(x, f.y(p.total), bw, base - f.y(p.total), 4),
          fill: p.current ? COLORS.accent : COLORS.bar
        }));
      }
      // Narrow screens: label only the current month and shorten month names.
      var narrow = slot < 3.2 * R;
      var labelled = narrow ? p.current : i >= n - 2;
      if (labelled && p.total != null) {
        var top = p.current && c.pace != null ? Math.min(f.y(p.total), f.y(c.pace)) : f.y(p.total);
        var txt = fmtNum(p.total) + (p.current && !narrow ? " so far" : "");
        var halfW = txt.length * 0.3 * R, tx = cx, anchor = "middle";
        if (cx + halfW > f.W) { tx = f.W; anchor = "end"; }   // keep the last label inside the card
        f.svg.appendChild(el("text", {
          x: tx, y: top - 0.45 * R, "text-anchor": anchor, "class": p.current ? "val" : "val muted"
        }, txt));
      }
      var lbl = narrow ? MON[p.m].charAt(0) : MON[p.m] + (p.m === 0 ? " ’" + String(p.y).slice(2) : "");
      f.svg.appendChild(el("text", {
        x: cx, y: f.H - 0.35 * R, "text-anchor": "middle", "class": p.current ? "tick strong" : "tick"
      }, lbl));
      var hit = el("rect", { x: f.m.l + slot * i, y: f.m.t, width: slot, height: f.ph, fill: "transparent" });
      hit.appendChild(el("title", {}, MONTHS[p.m] + " " + p.y + ": " + fmtNum(p.total) + (p.current ? " (month to date)" : "")));
      f.svg.appendChild(hit);
    });

    f.svg.setAttribute("aria-label", "Monthly totals for the last 12 months");
    host.replaceChildren(f.svg);
  }

  function drawCharts() {
    document.querySelectorAll("[data-chart]").forEach(function (host) {
      var c = computed[host.getAttribute("data-metric")];
      if (!c) return;
      if (host.getAttribute("data-chart") === "daily") drawDaily(host, c);
      else drawMonthly(host, c);
    });
  }

  // ---------- Boot ----------
  var resizeTimer;
  window.addEventListener("resize", function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 150); });
  window.addEventListener("mousemove", function () {
    document.body.classList.add("has-pointer");
    clearTimeout(window.__ptr); window.__ptr = setTimeout(function () { document.body.classList.remove("has-pointer"); }, 3000);
  });

  tickClock();
  setInterval(function () { tickClock(); renderStatus(); }, 15 * 1000);
  load();
  setInterval(load, REFRESH_MS);

  // Full reload once a night (3 AM) so the screen picks up any page changes too.
  (function scheduleReload() {
    var now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 3, 0, 0);
    setTimeout(function () { location.reload(); }, next - now);
  })();
})();
