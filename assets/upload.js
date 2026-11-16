/* Upload page: parse the export in the browser, preview, then commit the
 * merged data/daily.csv to GitHub with the token saved on this computer. */
(function () {
  "use strict";
  var I = window.NambeIngest;
  var PATH = "data/daily.csv";
  var DEFAULT_REPO = "colbylimb/NambeLA-KPI";
  var $ = function (id) { return document.getElementById(id); };

  // ---------- settings (this browser only) ----------
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function guessRepo() {
    var h = location.hostname, seg = location.pathname.split("/").filter(Boolean)[0];
    if (/\.github\.io$/.test(h) && seg && !/\.html$/.test(seg)) return h.split(".")[0] + "/" + seg;
    return DEFAULT_REPO;
  }
  function settings() {
    return { token: load("nambe.token") || "", repo: load("nambe.repo") || guessRepo(), branch: load("nambe.branch") || "" };
  }
  function fillSettings() {
    var s = settings();
    $("token").value = s.token; $("repo").value = s.repo; $("branch").value = s.branch;
    $("conn-state").textContent = s.token ? "Connected to " + s.repo : "Not set up";
    $("conn-state").className = "conn" + (s.token ? " ok" : "");
  }

  // ---------- GitHub ----------
  function gh(method, url, token, body) {
    return fetch("https://api.github.com" + url, {
      method: method,
      headers: { "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      body: body ? JSON.stringify(body) : undefined, cache: "no-store"
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        return { status: r.status, ok: r.ok, json: j };
      });
    });
  }
  function ghError(res, what) {
    var msg = res.json && res.json.message ? res.json.message : "HTTP " + res.status;
    if (res.status === 401) return new Error("GitHub didn’t accept the token (" + msg + "). Check it under GitHub connection.");
    if (res.status === 403 || res.status === 404) return new Error("The token can’t " + what + " (" + msg + "). Make sure it has Contents: Read and write on this repository.");
    return new Error("Couldn’t " + what + ": " + msg);
  }
  function b64decode(b64) {
    var bin = atob(b64.replace(/\s/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  }
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function resolveBranch(s) {
    if (s.branch) return Promise.resolve(s.branch);
    return gh("GET", "/repos/" + s.repo, s.token).then(function (r) {
      if (!r.ok) throw ghError(r, "open the repository");
      return r.json.default_branch;
    });
  }
  function getFile(s, branch) {
    return gh("GET", "/repos/" + s.repo + "/contents/" + PATH + "?ref=" + encodeURIComponent(branch), s.token).then(function (r) {
      if (r.status === 404) return { text: "", sha: null };
      if (!r.ok) throw ghError(r, "read " + PATH);
      return { text: b64decode(r.json.content || ""), sha: r.json.sha };
    });
  }

  // ---------- state ----------
  var picked = [];        // [{name, summary}]
  var savedText = "";     // public copy of daily.csv, for the preview

  function fetchPublic() {
    return fetch(PATH + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; })
      .then(function (t) { savedText = t; });
  }

  var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  function fmtDate(k) { var p = k.split("-"), d = new Date(+p[0], +p[1] - 1, +p[2]); return DOW[d.getDay()] + ", " + MON[d.getMonth()] + " " + d.getDate() + ", " + p[0]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function readFile(f) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); };
      r.onerror = function () { rej(new Error("Couldn’t read " + f.name)); };
      r.readAsText(f);
    });
  }

  function handleFiles(list) {
    var files = Array.prototype.slice.call(list || []).filter(function (f) { return /\.csv$/i.test(f.name) || /csv/.test(f.type); });
    if (!files.length) { showNotice("error", "That doesn’t look like a CSV file. Export the report as .csv and try again."); $("review").hidden = false; return; }
    Promise.all([fetchPublic()].concat(files.map(function (f) {
      return readFile(f).then(function (text) {
        try { return { name: f.name, summary: I.summarizeExport(text) }; }
        catch (e) { return { name: f.name, error: e.message }; }
      });
    }))).then(function (results) {
      results.shift();
      picked = picked.concat(results);
      renderReview();
    });
  }

  function currentMerge() {
    var good = picked.filter(function (p) { return p.summary; });
    return I.merge(savedText, I.combine(good.map(function (p) { return p.summary; })));
  }

  var noticeHtml = "";
  function showNotice(kind, html) { noticeHtml += '<div class="notice ' + kind + '">' + html + "</div>"; $("notices").innerHTML = noticeHtml; }

  function renderReview() {
    $("review").hidden = false;
    $("result").hidden = true;
    noticeHtml = ""; $("notices").innerHTML = "";
    var good = picked.filter(function (p) { return p.summary; });
    picked.filter(function (p) { return p.error; }).forEach(function (p) {
      showNotice("error", "<b>" + esc(p.name) + "</b>: " + esc(p.error));
    });
    $("files-note").textContent = good.map(function (p) {
      return p.name + " · " + p.summary.rows.toLocaleString() + " rows";
    }).join("  ·  ");
    good.forEach(function (p) {
      if (p.summary.skipped) showNotice("info", esc(p.name) + ": skipped " + p.summary.skipped + " line(s) without a date, like totals or report footers.");
      if (!p.summary.columns.cls) showNotice("warn", esc(p.name) + ": no Therapeutic Class column, so vaccines can’t be counted.");
      if (!p.summary.columns.compound) showNotice("warn", esc(p.name) + ": no “Is Compound?” column, so compounds can’t be counted.");
    });
    if (!good.length) { $("rows").innerHTML = ""; $("save").disabled = true; $("download").disabled = true; return; }

    var m = currentMerge();
    if (m.clearedSample) showNotice("info", "This is the first real upload, so the sample data will be cleared from the dashboard.");
    $("rows").innerHTML = m.changes.map(function (c) {
      var st = c.status === "new" ? '<span class="badge ok">New day</span>'
        : c.status === "same" ? '<span class="badge muted">Already saved</span>'
        : '<span class="badge warn">Replaces ' + fmtNum(c.old.vaccines) + " / " + fmtNum(c.old.compounds) + "</span>";
      return "<tr><td>" + fmtDate(c.date) + '</td><td class="num"><b>' + c.vaccines + '</b></td><td class="num"><b>' + c.compounds +
        '</b></td><td class="num muted">' + c.rows.toLocaleString() + "</td><td>" + st + "</td></tr>";
    }).join("");
    $("save").disabled = false; $("download").disabled = false;
  }
  function fmtNum(n) { return n == null ? "—" : n; }

  function commitMessage(changes) {
    if (changes.length === 1) {
      var c = changes[0];
      return "Upload " + c.date + ": " + c.vaccines + " vaccines, " + c.compounds + " compounds";
    }
    return "Upload " + changes[0].date + " to " + changes[changes.length - 1].date + " (" + changes.length + " days)";
  }

  function save() {
    var s = settings();
    if (!s.token) {
      $("settings").open = true;
      showResult("result", "warn", "Set up the GitHub connection below first (one time per computer), then click Save again.");
      $("token").focus();
      return;
    }
    var good = picked.filter(function (p) { return p.summary; });
    var newDays = I.combine(good.map(function (p) { return p.summary; }));
    $("save").disabled = true; $("save").textContent = "Saving…";
    var branch;
    function attempt(retry) {
      return getFile(s, branch).then(function (file) {
        var m = I.merge(file.text, newDays);
        if (file.text === m.text) return { unchanged: true, m: m };
        var body = { message: commitMessage(m.changes), content: b64encode(m.text), branch: branch };
        if (file.sha) body.sha = file.sha;
        return gh("PUT", "/repos/" + s.repo + "/contents/" + PATH, s.token, body).then(function (r) {
          if ((r.status === 409 || r.status === 422) && retry) return attempt(false);  // file changed meanwhile
          if (!r.ok) throw ghError(r, "save " + PATH);
          return { commit: r.json.commit, m: m };
        });
      });
    }
    resolveBranch(s).then(function (b) { branch = b; return attempt(true); }).then(function (out) {
      savedText = out.m.text;
      var days = out.m.changes.length;
      if (out.unchanged) {
        showResult("result", "ok", "Nothing new to save. These counts are already on the dashboard.");
      } else {
        showResult("result", "ok", "<b>Saved " + days + " day" + (days > 1 ? "s" : "") + ".</b> GitHub publishes the update in about a minute, and the TV picks it up on its next check (every 10 minutes)." +
          (out.commit && out.commit.html_url ? ' <a href="' + esc(out.commit.html_url) + '" target="_blank" rel="noopener">View the change</a>' : ""));
      }
      renderReviewStatusOnly();
    }).catch(function (e) {
      showResult("result", "error", esc(e.message));
    }).then(function () {
      $("save").disabled = false; $("save").textContent = "Save to dashboard";
    });
  }
  function renderReviewStatusOnly() {
    var keep = $("result").innerHTML, cls = $("result").className;
    renderReview();
    $("result").innerHTML = keep; $("result").className = cls; $("result").hidden = false;
  }

  function showResult(id, kind, html) { var el = $(id); el.className = "result notice " + kind; el.innerHTML = html; el.hidden = false; }

  function download() {
    var m = currentMerge();
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([m.text], { type: "text/csv" }));
    a.download = "daily.csv"; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function saveSettings() {
    var token = $("token").value.trim(), repo = $("repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, ""), branch = $("branch").value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { showResult("settings-result", "error", "Repository should look like owner/repo."); return; }
    if (!token) { showResult("settings-result", "error", "Paste the access token first."); return; }
    store("nambe.token", token); store("nambe.repo", repo); store("nambe.branch", branch || null);
    fillSettings();
    var s = settings();
    showResult("settings-result", "info", "Testing…");
    resolveBranch(s).then(function (b) { return getFile(s, b).then(function () { return b; }); }).then(function (b) {
      showResult("settings-result", "ok", "Connected. Uploads will save to <b>" + esc(s.repo) + "</b> on branch <b>" + esc(b) + "</b>.");
    }).catch(function (e) { showResult("settings-result", "error", esc(e.message)); });
  }

  // ---------- wire up ----------
  var dz = $("dropzone");
  ["dragenter", "dragover"].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add("is-over"); }); });
  ["dragleave", "drop"].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove("is-over"); }); });
  dz.addEventListener("drop", function (e) { handleFiles(e.dataTransfer.files); });
  dz.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
  // Dropping anywhere on the page works too.
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); if (e.target !== dz && !dz.contains(e.target)) handleFiles(e.dataTransfer.files); });
  $("file").addEventListener("change", function () { handleFiles(this.files); this.value = ""; });
  $("save").addEventListener("click", save);
  $("download").addEventListener("click", download);
  $("reset").addEventListener("click", function () { picked = []; $("review").hidden = true; noticeHtml = ""; });
  $("save-settings").addEventListener("click", saveSettings);
  $("forget").addEventListener("click", function () { store("nambe.token", null); fillSettings(); showResult("settings-result", "info", "Token removed from this computer."); });

  fillSettings();
  if (!settings().token) $("settings").open = true;
  fetchPublic();
})();
