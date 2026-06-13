(function () {
  'use strict';

  /* ════════════════════════════════════════════════
     MATRIX RAIN
     Offscreen canvas → dark: direct blit
                      → light: screen-blend onto teal
  ════════════════════════════════════════════════ */
  var CHARS = "ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789Z:<>|=+-*";
  var rainEl  = document.getElementById("rain");
  var ctx     = rainEl.getContext("2d");
  var ofc     = document.createElement("canvas");
  var octx    = ofc.getContext("2d");

  var FS      = 40;
  var cols    = [];
  var raf;
  var DPR     = 1;
  var rainOn  = true;
  var isDark  = true;

  // Beat-reactive rain variables (must be initialised before drawRain runs)
  var beatEnergy = 0, beatFlash = 0, lastBeatEnergy = 0;
  var surgeCols = [];   // {idx, frames, speedBoost, brightness}
  var SPEEDS  = [0.5, 1, 2];   // slow / normal / fast
  var speedIdx = 1;
  var BG_LIGHT = [127, 217, 208];
  // Rainbow mode (Konami easter egg)
  var rainbowMode = 0;
  // Ghost visitor columns
  var ghostCols = {}; // 0=off, >0 = frames remaining, fades out over ~600 frames
  // Feature toggles
  var beatOn = true;   // music beat reaction


  // FPS: rolling average over last 60 frames
  var fpsFrameTimes = [], fpsVal = 0;

  function rc() { return CHARS[Math.floor(Math.random() * CHARS.length)]; }

  function makeCol(h, scatter) {
    var sp = SPEEDS[speedIdx];
    var tl = Math.floor(18 + Math.random() * 22);
    return {
      y:        scatter ? Math.random() * h * 1.5 - h * 0.4 : -(FS * 2 + Math.random() * (h + FS * 4)),
      speed:    (0.8 + Math.random() * 2.0) * sp,
      trailLen: tl,
      trail:    [],
      mt: 0,
      mr: Math.floor(2 + Math.random() * 5),
      bright: Math.random() < 0.10,

    };
  }

  function initRain() {
    DPR = window.devicePixelRatio || 1;
    var w = window.innerWidth, h = window.innerHeight;
    rainEl.width  = Math.round(w * DPR); rainEl.height  = Math.round(h * DPR);
    rainEl.style.width = w + "px";       rainEl.style.height = h + "px";
    ctx.setTransform(1,0,0,1,0,0); ctx.scale(DPR, DPR);
    ofc.width = rainEl.width; ofc.height = rainEl.height;
    octx.setTransform(1,0,0,1,0,0); octx.scale(DPR, DPR);
    octx.fillStyle = "#000"; octx.fillRect(0, 0, w, h);
    cols = [];
    var n = Math.ceil(w / FS);
    for (var i = 0; i < n; i++) cols.push(makeCol(h, true));
    var hc = document.getElementById("hud-cols");
    if (hc) hc.textContent = "COLS · " + n;
  }

  function drawRain() {
    var w = rainEl.width / DPR, h = rainEl.height / DPR;

    // FPS: rolling average of last 60 rAF intervals
    var _now = performance.now();
    fpsFrameTimes.push(_now);
    if (fpsFrameTimes.length > 60) fpsFrameTimes.shift();
    if (fpsFrameTimes.length >= 2) {
      var _elapsed = fpsFrameTimes[fpsFrameTimes.length-1] - fpsFrameTimes[0];
      fpsVal = Math.round((fpsFrameTimes.length - 1) / _elapsed * 1000);
      if (fpsFrameTimes.length % 20 === 0) {
        var fe = document.getElementById("hud-fps");
        if (fe) fe.textContent = "FPS · " + fpsVal;
      }
    }

    // Beat-reactive: onset detection with local average comparison
    var _energy = getBeatEnergy();
    // Slow average tracks background level, fast tracks instant level
    beatEnergy += (_energy - beatEnergy) * 0.08;   // slow background average
    var _delta = _energy - lastBeatEnergy;
    // Only fire if instant energy is significantly above the background average
    // This avoids false triggers on sustained bass, only catches sharp onsets
    var _above = _energy - beatEnergy;
    if (_delta > 0.06 && _above > 0.04 && beatFlash < 0.3) {
      beatFlash = Math.min(1.0, _above * 6.0 + _delta * 4.0);
    }
    lastBeatEnergy = _energy * 0.6 + lastBeatEnergy * 0.4; // smoothed last
    beatFlash *= 0.72;  // decay
    if (rainbowMode > 0) rainbowMode--;

    // ── Beat Surge: strong onset → pick 3-7 random cols to surge ──
    if (beatFlash > 0.55 && cols.length > 0 && beatOn) {
      var nSurge = 3 + Math.floor(beatFlash * 4);
      for (var _s = 0; _s < nSurge; _s++) {
        var _si = Math.floor(Math.random() * cols.length);
        // Avoid duplicates and ghost cols
        if (!surgeCols.find(function(c){ return c.idx === _si; })) {
          surgeCols.push({
            idx:        _si,
            frames:     Math.floor(18 + beatFlash * 24),  // 18-42 frames
            speedBoost: 2.5 + beatFlash * 3.5,            // 2.5-6x speed
            brightness: 0.6 + beatFlash * 0.4             // extra glow
          });
        }
      }
    }
    // Decay surge frames
    for (var _sd2 = surgeCols.length - 1; _sd2 >= 0; _sd2--) {
      surgeCols[_sd2].frames--;
      if (surgeCols[_sd2].frames <= 0) surgeCols.splice(_sd2, 1);
    }

    // On strong beat: near-zero fade so ALL trails stay bright for a moment
    var _fade = isDark
      ? Math.max(0.018, 0.09 - beatFlash * 0.07 - beatEnergy * 0.04)
      : Math.max(0.018, 0.045 - beatFlash * 0.03 - beatEnergy * 0.02);
    octx.fillStyle = "rgba(0,0,0," + _fade + ")";
    octx.fillRect(0, 0, w, h);
    octx.font = FS + "px 'Courier Prime','Courier New',monospace";
    octx.textBaseline = "top";

    for (var i = 0; i < cols.length; i++) {
      var col = cols[i];
      var baseX = i * FS; // canonical x (no column-level offset anymore)

      // Resolve surge state for this column BEFORE the trail-drawing loop
      var _surge = null;
      for (var _sx0 = 0; _sx0 < surgeCols.length; _sx0++) {
        if (surgeCols[_sx0].idx === i) { _surge = surgeCols[_sx0]; break; }
      }

      // Advance trail
      col.mt++;
      if (col.mt >= col.mr) {
        col.mt = 0;
        col.trail.push(rc());
        if (col.trail.length > col.trailLen) col.trail.shift();
      }
      if (!col.trail.length) {
        col.trail.push(rc());
      }

      var tL = col.trail.length;
      for (var t = 0; t < tL; t++) {
        var homeX = baseX;
        var homeY = col.y - (tL - 1 - t) * FS;
        if (homeY < -FS * 4 || homeY > h + FS) continue;

        var rx = homeX;
        var ry = homeY;
        if (ry < -FS || ry > h) continue;

        var frac = t / Math.max(1, tL - 1);
        var r, g, b, alpha;
        if (t === tL - 1) {
          if (rainbowMode > 0) {
            var hue = (i * 137.5 + Date.now() * 0.04) % 360;
            var rbFade = Math.min(1, rainbowMode / 60);
            octx.fillStyle = "hsla(" + hue + ",100%,70%," + rbFade + ")";
            octx.shadowColor = "hsla(" + hue + ",100%,80%,0.9)";
            octx.shadowBlur = 14 + beatFlash * 20;
            octx.fillText(col.trail[t], rx, ry);
            octx.shadowBlur = 0;
            continue;
          }
          if (window._specialDateRGB) {
            var _sd = window._specialDateRGB;
            r = Math.min(255, _sd[0] + Math.round(beatFlash*(255-_sd[0])));
            g = Math.min(255, _sd[1] + Math.round(beatFlash*(255-_sd[1])));
            b = Math.min(255, _sd[2] + Math.round(beatFlash*(255-_sd[2])));
          } else {
            r = Math.min(255, 180 + Math.round(beatFlash * 75));
            g = 255;
            b = Math.min(255, (col.bright ? 255 : 180) + Math.round(beatFlash * 75));
          }
          var isGhost = ghostCols[i] !== undefined;
          var ghostFade = isGhost ? Math.min(1, ghostCols[i] / 120) : 0;
          if (isGhost) {
            r = Math.min(255, 200 + Math.round(ghostFade * 55));
            g = 255;
            b = 255;
          }
          alpha = 1;
          var isSurge = (_surge !== null);
          octx.shadowColor = isGhost
            ? "rgba(200,255,255,1)"
            : isSurge
              ? "rgba(160,255,180,1)"
              : (beatFlash > 0.3 ? "rgba(200,255,220,1)" : "rgba(100,255,140,1)");
          octx.shadowBlur = (isGhost ? 18 + ghostFade * 20 : isSurge ? 22 + (_surge.brightness * 18) : 9) + beatFlash * 38;
          if (isSurge) { g = 255; alpha = 1; }
        } else if (t >= tL - 4) {
          var nf = (t - (tL - 4)) / 3;
          r = Math.round(nf * 180); g = Math.round(200 + nf * 55); b = Math.round(60 + nf * 120);
          alpha = 0.5 + nf * 0.5 + beatFlash * 0.35;
          octx.shadowColor = "rgba(0,255,80,.45)"; octx.shadowBlur = 5 + beatFlash * 10;
        } else {
          var tf = frac * frac;
          var gf2 = ghostCols[i] !== undefined ? Math.min(1, ghostCols[i] / 120) : 0;
          r = Math.round(gf2 * 20);
          g = Math.round(80 + tf * 120 + gf2 * 60);
          b = Math.round(20 + tf * 40 + gf2 * 80);
          alpha = 0.06 + tf * 0.65 + gf2 * 0.2; octx.shadowBlur = 0;
        }
        octx.fillStyle = "rgba("+r+","+g+","+b+","+alpha+")";
        octx.fillText(col.trail[t], rx, ry);
        octx.shadowBlur = 0;
      }
      // Apply surge speed boost
      col.y += col.speed * (_surge ? _surge.speedBoost : 1);
      if (col.y > h + FS * 2) cols[i] = makeCol(h, false);
      // Ghost decay
      if (ghostCols[i] !== undefined) {
        ghostCols[i]--;
        if (ghostCols[i] <= 0) delete ghostCols[i];
      }
    }

    if (isDark) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(ofc, 0, 0, w, h);
    } else {
      ctx.fillStyle = "rgb("+BG_LIGHT.join(",")+")";
      ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.globalCompositeOperation = "screen";
      ctx.drawImage(ofc, 0, 0, w, h);
      ctx.restore();
    }
    raf = requestAnimationFrame(drawRain);
  }

  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, rainEl.width, rainEl.height);
  initRain(); drawRain();

  /* ════════════════════════════════════════════════
     TT · TYPEWRITER MODE  (light theme compatible)
  ════════════════════════════════════════════════ */
  var twActive = false, twIdleTimer = null, twText = "";

  function openTypewriter() {
    if (twActive) return;
    twActive = true;
    closeTerminal();
    logEvent("TYPEWRITER_OPEN", "");
    var ov = document.createElement("div");
    ov.id = "tw-overlay";
    ov.style.cssText = [
      "position:fixed;inset:0;z-index:300;background:var(--bg);",
      "display:flex;flex-direction:column;align-items:center;justify-content:center;",
      "opacity:0;transition:opacity .4s;"
    ].join("");
    var hint = document.createElement("div");
    hint.style.cssText = "font-family:var(--font);font-size:.44rem;letter-spacing:.2em;color:var(--ink-dim);margin-bottom:1.4rem;text-transform:uppercase;text-align:center;";
    hint.textContent = "// typewriter mode · esc to close · 5s idle → saves to capsule";
    var display = document.createElement("div");
    display.className = "tw-display";
    display.style.cssText = [
      "font-family:var(--font);font-size:clamp(.85rem,2.2vw,1.3rem);",
      "color:var(--ink);letter-spacing:.06em;line-height:1.8;",
      "text-align:center;max-width:min(36rem,80vw);",
      "text-shadow:0 0 18px color-mix(in srgb,var(--accent) 40%,transparent);",
      "min-height:2em;white-space:pre-wrap;word-break:break-word;"
    ].join("");
    display.textContent = "▌";
    // Hidden input for mobile keyboard trigger
    var mobileInput = document.createElement("input");
    mobileInput.type = "text";
    mobileInput.setAttribute("autocomplete","off");
    mobileInput.setAttribute("autocorrect","off");
    mobileInput.setAttribute("autocapitalize","off");
    mobileInput.setAttribute("spellcheck","false");
    mobileInput.style.cssText = [
      "position:absolute;opacity:0;width:1px;height:1px;",
      "top:50%;left:50%;transform:translate(-50%,-50%);",
      "font-size:16px;border:none;outline:none;background:transparent;",
      "pointer-events:none;"
    ].join("");
    // Flag to suppress "input" event when onKey already handled it (desktop)
    var suppressInput = false;
    mobileInput.addEventListener("input", function() {
      if (suppressInput) { suppressInput = false; return; }
      // Mobile: "input" event is the canonical source of truth.
      // IME / autocorrect / autocapitalise all go through here.
      twText = mobileInput.value;
      display.textContent = twText + "▌";
      resetIdle();
      playTick(false);
    });
    mobileInput.addEventListener("keydown", function(e) {
      if (e.key === "Escape") { closeTypewriter(); return; }
      // Enter on mobile adds newline — input event won't carry \n
      if (e.key === "Enter") {
        twText += "\n";
        suppressInput = true;
        mobileInput.value = twText;
        display.textContent = twText + "▌";
        resetIdle();
        playTick(true);
      }
    });

    ov.addEventListener("click", function() { mobileInput.focus(); });
    ov.appendChild(hint); ov.appendChild(display); ov.appendChild(mobileInput);
    document.body.appendChild(ov);
    setTimeout(function(){
      ov.style.opacity = "1";
      // Focus the hidden input to show keyboard on mobile
      mobileInput.style.pointerEvents = "auto";
      mobileInput.focus();
    }, 80);
    twText = "";

    function resetIdle() {
      clearTimeout(twIdleTimer);
      twIdleTimer = setTimeout(function() {
        if (twText.trim()) {
          var arr = loadCapsules();
          arr.unshift({ text: twText.trim(), t: Date.now() });
          if (arr.length > 20) arr = arr.slice(0, 20);
          saveCapsules(arr);
          logEvent("TYPEWRITER_SAVED", twText.slice(0,30));
          display.style.transition = "opacity 1.2s";
          display.style.opacity = "0";
        }
        setTimeout(closeTypewriter, 1400);
      }, 5000);
    }
    resetIdle();

    function onKey(e) {
      if (e.key === "Escape") { closeTypewriter(); return; }
      // On mobile (touch device) printable chars are handled by mobileInput
      // "input" event — skip here to prevent double characters.
      var isTouch = navigator.maxTouchPoints > 0;
      if (e.key === "Backspace") {
        twText = twText.slice(0, -1);
        suppressInput = true;
        mobileInput.value = twText;
      } else if (e.key === "Enter") {
        // Enter handled in mobileInput keydown listener above on mobile
        if (isTouch) return;
        twText += "\n";
        suppressInput = true;
        mobileInput.value = twText;
      } else if (e.key.length === 1) {
        // On touch devices, let mobileInput "input" event handle printable chars
        if (isTouch) return;
        twText += e.key;
        suppressInput = true;
        mobileInput.value = twText;
      } else { return; }
      display.textContent = twText + "▌";
      resetIdle();
      playTick(e.key === "Enter");
    }
    ov._onKey = onKey;
    document.addEventListener("keydown", onKey);
  }

  function closeTypewriter() {
    if (!twActive) return;
    twActive = false;
    clearTimeout(twIdleTimer);
    var ov = document.getElementById("tw-overlay");
    if (!ov) return;
    if (ov._onKey) document.removeEventListener("keydown", ov._onKey);
    var display = ov.querySelector(".tw-display");
    if (!display || !twText.trim()) {
      ov.style.opacity = "0";
      setTimeout(function(){ if(ov.parentNode) ov.remove(); }, 400);
      return;
    }

    // LTR scramble-dissolve: same mechanic as qwertlexi name scramble
    // Each char position, starting from index 0, cycles through POOL
    // then "dissolves" (becomes space/empty), progressing left to right
    var txt = twText;
    var n = txt.length;
    var chars = txt.split("");   // current display state
    var dissolved = new Array(n).fill(false);
    var frame = 0;
    var rafId;

    // Render current char array back to display
    function renderTw() {
      var out = "";
      for (var i2 = 0; i2 < n; i2++) {
        out += dissolved[i2] ? " " : chars[i2];
      }
      // Trim trailing spaces but keep a cursor if anything remains
      var remaining = dissolved.filter(function(d){ return !d; }).length;
      display.textContent = out + (remaining > 0 ? "▌" : "");
    }

    function twScrambleTick() {
      frame++;
      var allDone = true;
      for (var j = 0; j < n; j++) {
        if (dissolved[j]) continue;
        allDone = false;
        // LTR: position j starts scrambling at frame j*3
        if (frame >= j * 3) {
          if (Math.random() < 0.55) {
            chars[j] = rf(POOL);  // scramble this char
          }
          // After enough scramble frames, dissolve it
          if (frame >= j * 3 + 8 && Math.random() < 0.45) {
            dissolved[j] = true;
          }
        }
      }
      renderTw();
      if (!allDone) {
        rafId = requestAnimationFrame(twScrambleTick);
      } else {
        // All dissolved — fade out overlay
        display.textContent = "";
        ov.style.transition = "opacity .4s";
        ov.style.opacity = "0";
        setTimeout(function(){ if(ov.parentNode) ov.remove(); }, 420);
      }
    }

    rafId = requestAnimationFrame(twScrambleTick);
  }

  /* ════════════════════════════════════════════════
     VV · COUNTDOWN CAPSULE
     seal YYYY-MM-DD <message>
  ════════════════════════════════════════════════ */
  var COUNTDOWN_KEY = "qwl-countdown-v1";
  function loadCountdowns() {
    try { var d = localStorage.getItem(COUNTDOWN_KEY); return d ? JSON.parse(d) : []; }
    catch(e) { return []; }
  }
  function saveCountdowns(arr) {
    try { localStorage.setItem(COUNTDOWN_KEY, JSON.stringify(arr)); } catch(e){}
  }

  function sealCapsule(dateStr, msg) {
    var unlockDate = new Date(dateStr + "T00:00:00");
    if (isNaN(unlockDate.getTime())) { termLine("// invalid date · use YYYY-MM-DD", "err"); return; }
    if (unlockDate <= new Date()) { termLine("// that date is in the past", "err"); return; }
    var arr = loadCountdowns();
    arr.push({ text: msg, unlock: unlockDate.getTime(), sealed: Date.now() });
    saveCountdowns(arr);
    var days = Math.ceil((unlockDate - new Date()) / 86400000);
    termLine("// sealed · unlocks in " + days + " day" + (days===1?"":"s") + " · " + dateStr, "ok");
    logEvent("COUNTDOWN_SEALED", dateStr + " · " + msg.slice(0,20));
  }

  function checkCountdowns() {
    var arr = loadCountdowns();
    var now = Date.now();
    var due = arr.filter(function(c){ return c.unlock <= now; });
    var future = arr.filter(function(c){ return c.unlock > now; });
    if (!due.length) return;
    saveCountdowns(future);
    due.forEach(function(c, idx) {
      setTimeout(function() {
        var ov = document.createElement("div");
        ov.style.cssText = [
          "position:fixed;inset:0;z-index:400;",
          "background:rgba(0,0,0,.88);backdrop-filter:blur(14px);",
          "display:flex;flex-direction:column;align-items:center;justify-content:center;",
          "gap:1.2rem;cursor:pointer;opacity:0;transition:opacity .5s;"
        ].join("");
        var label = document.createElement("div");
        label.style.cssText = "font-family:var(--font);font-size:.46rem;letter-spacing:.3em;color:var(--ink-dim);text-transform:uppercase;";
        label.textContent = "// 时间胶囊已解封 · 封存于 " + new Date(c.sealed).toLocaleDateString("zh-CN");
        var msgEl = document.createElement("div");
        msgEl.style.cssText = [
          "font-family:var(--font);font-size:clamp(.8rem,2.2vw,1.2rem);",
          "color:var(--ink);letter-spacing:.06em;text-align:center;",
          "max-width:min(32rem,80vw);line-height:1.8;",
          "text-shadow:0 0 28px var(--accent);"
        ].join("");
        msgEl.textContent = "";
        var closeHint = document.createElement("div");
        closeHint.style.cssText = "font-family:var(--font);font-size:.4rem;letter-spacing:.2em;color:var(--ink-dim);margin-top:.5rem;";
        closeHint.textContent = "// 点击任意位置关闭";
        ov.appendChild(label); ov.appendChild(msgEl); ov.appendChild(closeHint);
        document.body.appendChild(ov);
        setTimeout(function(){ ov.style.opacity = "1"; }, 20);
        var full = c.text, ci = 0;
        function typeReveal() {
          if (ci <= full.length) {
            msgEl.textContent = full.slice(0,ci) + (ci < full.length ? "▌" : "");
            ci++;
            setTimeout(typeReveal, 45 + Math.random()*25);
          }
        }
        setTimeout(typeReveal, 600);
        ov.addEventListener("click", function() {
          ov.style.opacity = "0";
          setTimeout(function(){ if(ov.parentNode) ov.remove(); }, 400);
        });
      }, idx * 800);
    });
  }
  setTimeout(checkCountdowns, 4000);

  /* ════════════════════════════════════════════════
     WHOAMI — fullscreen typewriter self-intro
  ════════════════════════════════════════════════ */
  // ── Edit your intro lines here ──────────────────
  var WHOAMI_LINES = [
    "qwertlexi",
    "signal from the silence.",
    "music · code · 低轨道漂流",
    "this terminal is a window.",
    "the rain never stops.",
  ];
  // ────────────────────────────────────────────────

  function showWhoami() {
    // Remove any existing overlay
    var old = document.getElementById("whoami-overlay");
    if (old) old.remove();

    var ov = document.createElement("div");
    ov.id = "whoami-overlay";
    ov.style.cssText = [
      "position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;",
      "align-items:center;justify-content:center;gap:1.1rem;",
      "pointer-events:none;opacity:0;transition:opacity .4s;"
    ].join("");
    document.body.appendChild(ov);
    setTimeout(function(){ ov.style.opacity = "1"; }, 20);

    var lineEls = [];
    WHOAMI_LINES.forEach(function(_, i) {
      var el = document.createElement("div");
      el.style.cssText = [
        "font-family:" + (i === 0 ? "var(--disp)" : "var(--font)") + ";",
        "font-size:" + (i === 0 ? "clamp(1.6rem,5vw,3rem)" : "clamp(.55rem,1.6vw,.85rem)") + ";",
        "font-weight:" + (i === 0 ? "700" : "400") + ";",
        "letter-spacing:" + (i === 0 ? ".08em" : ".2em") + ";",
        "color:var(--ink);opacity:.0;",
        "text-shadow:0 0 24px color-mix(in srgb,var(--accent) 60%,transparent);",
        "text-align:center;"
      ].join("");
      ov.appendChild(el);
      lineEls.push(el);
    });

    // Type each line sequentially
    var lineDelay = 0;
    WHOAMI_LINES.forEach(function(line, li) {
      var delay = lineDelay;
      lineDelay += line.length * 48 + 320;
      setTimeout(function() {
        var el = lineEls[li];
        el.style.opacity = "1";
        var ci = 0;
        function typeChar() {
          if (ci <= line.length) {
            el.textContent = line.slice(0, ci) + (ci < line.length ? "▌" : "");
            ci++;
            setTimeout(typeChar, 42 + Math.random() * 24);
          }
        }
        typeChar();
      }, delay);
    });

    // Fade out after all lines done
    setTimeout(function() {
      ov.style.opacity = "0";
      setTimeout(function(){ ov.remove(); }, 500);
    }, lineDelay + 2800);
  }

  /* ════════════════════════════════════════════════
     SHARED AUDIO CONTEXT + BEAT-REACTIVE RAIN
  ════════════════════════════════════════════════ */
  var audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} }
    return audioCtx;
  }

  var beatAnalyser = null, beatBuf = null, beatSrc = null;

  function initBeatAnalyser() {
    if (beatSrc) return; // already wired
    try {
      var bac = getAudioCtx();
      if (!bac) return;
      // Resume context if suspended (browser autoplay policy)
      if (bac.state === "suspended") bac.resume();
      beatAnalyser = bac.createAnalyser();
      beatAnalyser.fftSize = 512;
      beatAnalyser.smoothingTimeConstant = 0.2;  // less smoothing = sharper transients
      beatSrc = bac.createMediaElementSource(audio);
      beatSrc.connect(beatAnalyser);
      beatAnalyser.connect(bac.destination);
      beatBuf = new Uint8Array(beatAnalyser.frequencyBinCount);
    } catch(e) { beatAnalyser = null; beatSrc = null; }
  }

  function getBeatEnergy() {
    if (!beatAnalyser || !beatBuf || !beatOn) return 0;
    beatAnalyser.getByteFrequencyData(beatBuf);
    // bins 1-10 (skip DC bin 0), kick lives ~40-120Hz
    var sum = 0, n = 10;
    for (var i = 1; i <= n; i++) sum += beatBuf[i];
    return sum / n / 255;
  }

  var resizeT;
  window.addEventListener("resize", function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () {
      cancelAnimationFrame(raf);
      ctx.setTransform(1,0,0,1,0,0); octx.setTransform(1,0,0,1,0,0);
      initRain(); drawRain();
    }, 140);
  });

  /* ════════════════════════════════════════════════
     IDENTITY SCRAMBLE — 5s cycle
  ════════════════════════════════════════════════ */
  var TARGET = "qwertlexi";
  // ASCII only — uniform width, no reflow jitter
  var POOL   = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*?!/";
  var CLRS   = ["#ff3b6b","#ff8c00","#ffe600","#00e5ff","#b44fff","#39ff14","#ff00cc","#00bfff"];
  var markEl = document.getElementById("mark-text");
  var glitchT = null;

  function rf(s)  { return s[Math.floor(Math.random() * s.length)]; }
  function rcol() { return CLRS[Math.floor(Math.random() * CLRS.length)]; }

  // ── Scramble: innerHTML, no width locking needed ───────────
  // The .ident-name has white-space:nowrap and a min-width set in CSS
  // to the measured natural width of TARGET in Syne, so the container
  // never reflows. We just write innerHTML each frame.
  function renderChars(chars, colors) {
    if (!markEl) return;
    var h = "";
    for (var i = 0; i < chars.length; i++) {
      if (colors && colors[i]) {
        h += '<span style="color:' + colors[i] + '">' + chars[i] + '</span>';
      } else {
        h += chars[i];
      }
    }
    markEl.innerHTML = h;
  }

  function scrambleOut(done) {
    var n = TARGET.length, frame = 0;
    var chars  = TARGET.split("");
    var colors = new Array(n).fill(null);
    var unlocked = new Array(n).fill(false);
    function tick() {
      frame++;
      var allDone = true;
      for (var j = 0; j < n; j++) {
        if (!unlocked[j]) {
          allDone = false;
          if (frame >= j * 4 && Math.random() < .6) unlocked[j] = true;
        }
        if (unlocked[j]) { chars[j] = rf(POOL); colors[j] = rcol(); }
      }
      if (frame >= n * 4 + 12) {
        for (var k = 0; k < n; k++) { chars[k] = rf(POOL); colors[k] = rcol(); }
        allDone = true;
      }
      renderChars(chars, colors);
      if (!allDone) glitchT = requestAnimationFrame(tick);
      else { glitchT = null; done && done(); }
    }
    glitchT = requestAnimationFrame(tick);
  }

  function scrambleIn(done) {
    var n = TARGET.length, frame = 0;
    var chars  = [];
    var colors = [];
    for (var i = 0; i < n; i++) { chars.push(rf(POOL)); colors.push(rcol()); }
    var locked = new Array(n).fill(false);
    function tick() {
      frame++;
      var allDone = true;
      for (var j = 0; j < n; j++) {
        var rev = n - 1 - j;
        if (!locked[rev]) {
          allDone = false;
          if (frame >= j * 5 && Math.random() < .5) {
            locked[rev] = true; chars[rev] = TARGET[rev]; colors[rev] = null;
          } else {
            chars[rev] = rf(POOL); colors[rev] = rcol();
          }
        }
      }
      if (frame >= n * 5 + 16) {
        for (var k = 0; k < n; k++) { locked[k]=true; chars[k]=TARGET[k]; colors[k]=null; }
        allDone = true;
      }
      renderChars(chars, colors);
      if (!allDone) glitchT = requestAnimationFrame(tick);
      else { glitchT = null; done && done(); }
    }
    glitchT = requestAnimationFrame(tick);
  }

  if (markEl) {
    markEl.textContent = TARGET; // show immediately while fonts load
    function doGlitch() {
      if (glitchT) cancelAnimationFrame(glitchT);
      scrambleOut(function() {
        setTimeout(function() {
          scrambleIn(function() { setTimeout(doGlitch, 5000); });
        }, 200);
      });
    }
    setTimeout(doGlitch, 900);
  }

  /* ── Clock + meta ── */
  var PHRASES = [
    "signal from the silence","entropy is a feature","no uplink · local session",
    "observer effect active","the matrix has you","all systems nominal",
    "running in the rain","ghost in the shell","低轨道漂流中","杂讯里偶尔一句完整话",
  ];
  var phraseEl = document.getElementById("ident-phrase");
  if (phraseEl) {
    phraseEl.textContent = PHRASES[Math.floor(Math.random() * PHRASES.length)];
    // Fade in after a short delay (let boot/ident animations settle first)
    setTimeout(function() {
      phraseEl.style.transition = "opacity .8s ease";
      phraseEl.style.opacity = "0.45";
    }, 1800);
  }

  /* ════════════════════════════════════════════════
     LL · DATE / ANNIVERSARY EASTER EGGS
     Edit SPECIAL_DATES below — MM-DD format.
     Each entry: phrase shown + optional rain color
     (null = keep current green).
  ════════════════════════════════════════════════ */
  // ── Edit your special dates here ────────────────
  var SPECIAL_DATES = [
  { md: "01-11", phrase: "happy birthday to me", color: "#00ffea" },
  { md: "05-02", phrase: "happy anniversary？", color: null },
];
    // { md: "01-01", phrase: "新年快乐 · new signal, new year",   color: null },
    // { md: "10-31", phrase: "// ghost mode: maximum",            color: "#b44fff" },
    // { md: "02-14", phrase: "love is just signal with high snr", color: "#ff3b6b" },
    // Your birthday — uncomment and change MM-DD:
    // { md: "MM-DD", phrase: "happy birthday, qwertlexi",         color: "#ffe600" },

  // ────────────────────────────────────────────────

  (function checkSpecialDate() {
    if (!SPECIAL_DATES.length) return;
    var now = new Date();
    var md = (now.getMonth()+1 < 10 ? "0" : "") + (now.getMonth()+1)
           + "-" + (now.getDate()   < 10 ? "0" : "") + now.getDate();
    var match = null;
    for (var si = 0; si < SPECIAL_DATES.length; si++) {
      if (SPECIAL_DATES[si].md === md) { match = SPECIAL_DATES[si]; break; }
    }
    if (!match) return;

    // Show special phrase after boot settles
    setTimeout(function() {
      var pe = document.getElementById("ident-phrase");
      if (pe) {
        // Force a style flush: remove animation, hide, swap text, then fade in
        pe.style.cssText = "opacity:0;transition:none;animation:none;font-size:.48rem;letter-spacing:.18em;font-style:italic;";
        // Read offsetHeight to force reflow so the transition reset takes effect
        void pe.offsetHeight;
        pe.textContent = match.phrase;
        if (match.color) pe.style.color = match.color;
        pe.style.transition = "opacity .8s ease";
        setTimeout(function() { pe.style.opacity = "0.8"; }, 60);
      }
      // Tint rain head chars with custom color
      if (match.color) {
        var hex = match.color.replace("#","");
        window._specialDateRGB = [
          parseInt(hex.slice(0,2),16),
          parseInt(hex.slice(2,4),16),
          parseInt(hex.slice(4,6),16)
        ];
        document.documentElement.style.setProperty("--accent", match.color);
      }
      logEvent("SPECIAL_DATE", md + " · " + match.phrase.slice(0,30));
      termLine("// special date detected · " + md, "sys");
    }, 3500);
  })();

  var clockEl = document.getElementById("ident-clock");
  var dateEl  = document.getElementById("ident-date");
  var tickEl  = document.getElementById("hud-tick");
  var yearEl  = document.getElementById("hud-year");
  var tick    = 0;
  function pad(n) { return n < 10 ? "0"+n : ""+n; }
  function updateClock() {
    var d = new Date();
    if (clockEl) clockEl.textContent = pad(d.getHours())+":"+pad(d.getMinutes())+":"+pad(d.getSeconds());
    if (dateEl)  dateEl.textContent  = d.getFullYear()+"·"+pad(d.getMonth()+1)+"·"+pad(d.getDate());
    if (yearEl)  yearEl.textContent  = d.getFullYear();
  }
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(function(){ tick++; if(tickEl) tickEl.textContent = "TICK · "+tick; }, 400);

  /* ════════════════════════════════════════════════
     MOUSE RIPPLE
  ════════════════════════════════════════════════ */
  var rippleLayer = document.getElementById("ripple-layer");
  var rippleOn = true;
  function spawnRipple(x, y) {
    if (!rippleOn || !rippleLayer) return;
    var el = document.createElement("div");
    el.className = "ripple";
    el.style.left = x + "px"; el.style.top = y + "px";
    rippleLayer.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 750);
  }
  document.addEventListener("click", function(e) {
    // Don't spawn on interactive elements
    if (e.target.closest("button,input,textarea,.player,.ctrl,.terminal,.capsule-box")) return;
    spawnRipple(e.clientX, e.clientY);
  });

  /* ════════════════════════════════════════════════
     CONTROLS
  ════════════════════════════════════════════════ */
  var ctrlTheme    = document.getElementById("ctrl-theme");
  var ctrlTerminal = document.getElementById("ctrl-terminal");
  if (ctrlTerminal) {
    ctrlTerminal.addEventListener("click", function(){ termOpen ? closeTerminal() : openTerminal(); });
  }
  // Hide desktop ctrl-fs terminal button on mobile handled by CSS
  var ctrlTermRef = ctrlTerminal;
  var ctrlRain   = document.getElementById("ctrl-rain");
  var ctrlSpeed  = document.getElementById("ctrl-speed");
  var ctrlRipple = document.getElementById("ctrl-ripple");
  var ctrlFs     = document.getElementById("ctrl-fs");

  function setTheme(dark) {
    isDark = dark;
    document.body.classList.toggle("light", !dark);
    if (ctrlTheme) ctrlTheme.title = dark ? "切换到日间模式 [T]" : "切换到夜间模式 [T]";
    updateArkColors();
    logEvent("THEME_CHANGE", dark ? "dark" : "light");
  }

  if (ctrlTheme) ctrlTheme.addEventListener("click", function(){ setTheme(!isDark); });

  if (ctrlRain) {
    ctrlRain.addEventListener("click", function() {
      rainOn = !rainOn;
      rainEl.style.opacity = rainOn ? "1" : "0";
      ctrlRain.classList.toggle("is-off", !rainOn);
      logEvent("RAIN_TOGGLE", rainOn ? "on" : "off");
    });
  }

  var SPEED_LABELS = ["SLOW","NORM","FAST"];
  if (ctrlSpeed) {
    ctrlSpeed.title = "雨速: " + SPEED_LABELS[speedIdx] + " [S]";
    ctrlSpeed.addEventListener("click", function() {
      speedIdx = (speedIdx + 1) % 3;
      ctrlSpeed.title = "雨速: " + SPEED_LABELS[speedIdx] + " [S]";
      // Rebuild cols with new speed
      var h = window.innerHeight;
      cols = cols.map(function(c){ return makeCol(h, false); });
    });
  }

  if (ctrlRipple) {
    ctrlRipple.addEventListener("click", function() {
      rippleOn = !rippleOn;
      ctrlRipple.classList.toggle("is-off", !rippleOn);
    });
  }

  if (ctrlFs) {
    ctrlFs.addEventListener("click", function() {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      else document.exitFullscreen && document.exitFullscreen();
    });
  }

  // Inject beat + parting toggle buttons into ctrl strip
  (function() {
    var ctrlEl = document.querySelector(".ctrl");
    if (!ctrlEl) return;

    // Beat toggle button
    var btnBeat = document.createElement("button");
    btnBeat.className = "ctrl-btn";
    btnBeat.title = "音画联动 [B]";
    btnBeat.setAttribute("aria-label", "音画联动开关");
    btnBeat.innerHTML = "♫";
    btnBeat.addEventListener("click", function() {
      beatOn = !beatOn;
      btnBeat.classList.toggle("is-off", !beatOn);
      if (!beatOn) { beatFlash = 0; beatEnergy = 0; }
      logEvent("BEAT_TOGGLE", beatOn ? "on" : "off");
    });
    ctrlEl.appendChild(btnBeat);

    // Keyboard shortcuts
    document.addEventListener("keydown", function(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key.toLowerCase() === "b") btnBeat.click();
    });

    // ── Ark mode button ──────────────────────────
    var btnArk = document.createElement('button');
    btnArk.className = 'ctrl-btn';
    btnArk.title = '方舟模式';
    btnArk.setAttribute('aria-label', '诺亚方舟');
    btnArk.innerHTML = '<svg width="15" height="13" viewBox="0 0 15 13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M1 9 Q7.5 12 14 9"/><path d="M3 9 L3 6 Q7.5 4 12 6 L12 9"/><line x1="7.5" y1="1" x2="7.5" y2="6"/><path d="M7.5 1.5 Q10 3.5 9.5 6 L7.5 6 Z"/></svg>';
    btnArk.addEventListener('click', function() {
      if (!arkMode) {
        openArk();
        btnArk.classList.add('is-on');
      } else {
        closeArk();
        btnArk.classList.remove('is-on');
      }
    });
    ctrlEl.appendChild(btnArk);
  })();

  /* ════════════════════════════════════════════════
     TERMINAL
  ════════════════════════════════════════════════ */
  var termEl      = document.getElementById("terminal");
  var termInput   = document.getElementById("terminal-input");
  var termOutput  = document.getElementById("terminal-output");
  var termBackdrop= document.getElementById("terminal-backdrop");
  var termClose   = document.getElementById("terminal-close");
  var termOpen    = false;

  var CMD_HELP = [
    "// qwertlexi terminal · 指令列表",
    "─────────────────────────────────",
    "clear          清空终端",
    "time           当前时间",
    "fps            当前帧率",
    "about          关于本站",
    "whoami         自我介绍",
    "─────────────────────────────────",
    "rain on|off    矩阵雨 开/关",
    "speed s|n|f    雨速 慢/正常/快",
    "theme d|l      主题 暗/亮",
    "─────────────────────────────────",
    "visitors       访客计数",
    "leave <内容>   在留言墙留言",
    "history        本次访问记录",
    "capsule        时间胶囊",
    "typewriter     全屏打字机模式",
    "seal <日期> <内容>  倒计时胶囊",
    "lyrics         随机歌词",
    "ping <url>     连通性检测",
    "─────────────────────────────────",
    "右上控制条 · 调频图标 → 频率调谐器（←→ 调台）",
    "─────────────────────────────────",
    "Tab 自动补全  ·  ↑↓ 历史记录",
    "↑↑↓↓←→←→BA  — ???",
  ];

  var LYRICS = {
    go: [
      "Hold in position, it\'s gonna blow.",
      "You only move when, when I say so.",
      "You could stop and be alone.",
    ],
    birds: [
      "AND I DON\'T KNOW WHAT I\'M CRYING FOR",
      "THINK I WASN\'T BETTER ALONE",
      "IF I\'M TURNING BLUE, PLEASE DON\'T SAVE ME",
    ],
    bestpart: [
      "Where you go I\'ll follow, no matter how far",
      "You\'re the one that I desire",
      "If you love me won\'t you say something?",
    ],
    oblivion: [
      "See you on the dark night",
      "I would ask if you help me out",
      "I never looked behind all the time",
    ],
    realiti: [
      "I wanna peer over the edge of the death",
      "If we are always the same",
      "Oh baby every morning there are mountains to climb",
    ],
    episode33: [
      "真夜中生まれる 感情をうまく纏えたら",
      "何度目のあやかり 受け身が続いてく",
    ],
    aboutyou: [
      "I know a place, it\'s somewhere I go when I need to remember your face",
      "Do you think I have forgotten about you?",
      "Hold on and hope that we\'ll find the way back in the end",
      "I think about you",
    ],
    makeok: [
      "I just want you to be happy",
      "But to live in fear, isn\'t to live at all",
      "How do we sell you the world?",
      "Let it in, embrace and uncurl",
      "Had life before, been so slow?",
    ],
    lipstick: [
      "And the full moon rising, but it\'s me who makes myself mad",
      "I\'ll take you back",
    ],
    // ── EDITABLE LYRICS SECTION: add / remove songs freely below ─
    girlsandboys: [
      "Love in the nineties is paranoid",
      "Always should be someone you really love",
    ],
    song2: [
      "All of the time but I\'m never sure if I need you, pleased to meet you!",
      "It wasn\'t easy, nothing is, no",
      "Well I lie and I\'m easy",
    ],
    // ── END EDITABLE LYRICS SECTION ──────────────────────────────
  };
  // All lyrics flat pool for random pick
  var ALL_LYRICS = [];
  Object.keys(LYRICS).forEach(function(k){ ALL_LYRICS = ALL_LYRICS.concat(LYRICS[k]); });

  var CYBER_LINES = [
    "Signal authenticated. Identity unverified.",
    "The future arrived quietly — no one was watching.",
    "Every packet of data is a ghost passing through walls.",
    "Memory is just another form of storage. Both can be wiped.",
    "In 2087, nostalgia was patched out.",
    "You are the wetware. Act accordingly.",
    "Connection lost. Searching for meaning on port 443.",
    "Error 404: Certainty not found.",
    "Your consciousness is now buffering.",
    "We are all running legacy code.",
    "The last true secret is that there are no more secrets.",
    "Entropy increases. So does the signal.",
    "Low orbit satellite drift: nominal. Existential drift: critical.",
    "Time is a local variable. Scope: undefined.",
    "城市是人类最大的神经网络。",
    "在数字雨中，每一滴都是别人的记忆。",
    "孤独是最稳定的加密算法。",
    "连接中断，但某些事物永远不会完全断线。",
  ];

  var MATRIX_QUOTES = [
    "There is no spoon.",
    "Free your mind.",
    "The Matrix is everywhere.",
    "I know kung fu.",
    "What is real? How do you define real?",
    "You take the blue pill… the story ends.",
    "Unfortunately, no one can be told what the Matrix is.",
    "We never free a mind once it's reached a certain age.",
    "Ignorance is bliss.",
    "Choice. The problem is choice.",
    "Everything that has a beginning has an end.",
    "杂讯里偶尔拼出一句完整话。",
    "低轨道漂流中，信号时有时无。",
    "随机不是无意义，只是还没被读。",
  ];

  function termLine(text, type) {
    if (!termOutput) return;
    var row = document.createElement("div");
    row.className = "term-line" + (type ? " " + type : "");
    row.innerHTML = '<span class="prompt">' + (type === "sys" ? "//" : type === "err" ? "!!" : type === "ok" ? "✓" : "›") + '</span>'
      + '<span class="text"></span>';
    row.querySelector(".text").textContent = text;
    termOutput.appendChild(row);
    termOutput.scrollTop = termOutput.scrollHeight;
  }

  function openTerminal() {
    termOpen = true;
    termEl.classList.add("is-open");
    termBackdrop.classList.add("is-open");
    termEl.setAttribute("aria-hidden","false");
    setTimeout(function(){ if(termInput) termInput.focus(); }, 50);
    logEvent("TERMINAL_OPEN", "");
  }
  function closeTerminal() {
    termOpen = false;
    termEl.classList.remove("is-open");
    termBackdrop.classList.remove("is-open");
    termEl.setAttribute("aria-hidden","true");
    if (termInput) termInput.blur();
    document.body.focus();
  }

  if (termClose) termClose.addEventListener("click", closeTerminal);
  if (termBackdrop) termBackdrop.addEventListener("click", closeTerminal);

  /* Boot welcome: auto-open terminal after overlay exits and print guided intro */
  (function() {
    var WELCOME = [
      { text: "连接已建立 · 欢迎进入",          type: "ok",  delay: 0    },
      { text: "这里没有说明书。",                type: "sys", delay: 500  },
      { text: "有些东西可以看看。",          type: "sys", delay: 1100 },
      { text: "",                                type: "",    delay: 1700 },
      { text: "试试输入  help",                 type: "ok",  delay: 2100 },
      { text: "或者什么都不输入，只随便看看。",    type: "sys", delay: 2800 },
    ];
    function runWelcome() {
      if (!window._bootWelcomeDone) { setTimeout(runWelcome, 120); return; }
      // Small pause after overlay disappears, then open terminal
      setTimeout(function() {
        openTerminal();
        WELCOME.forEach(function(line) {
          setTimeout(function() {
            if (!line.text) { termLine("", ""); return; }
            termLine(line.text, line.type);
          }, line.delay + 300);
        });
        // Blinking prompt cue at the end
        setTimeout(function() {
          if (termInput) termInput.placeholder = "在这里输入…";
        }, 3500);
      }, 400);
    }
    runWelcome();
  })();

  /* ════════════════════════════════════════════════
     U · HIDDEN WORD TRIGGERS
     These words aren't in help — discovery only.
  ════════════════════════════════════════════════ */
  var HIDDEN_WORDS = {
    "ghost":    { msg: "// ghost detected · signal origin: unknown · you were never really here",        type: "ok",  fx: "glitch" },
    "void":     { msg: "the void stares back · and it remembers your face",                              type: "ok",  fx: "dim" },
    "signal":   { msg: "// signal acquired · source unverified · proceed with caution",                  type: "sys", fx: "flash" },
    "dream":    { msg: "dreams are just memory leaks · beauty in the overflow",                          type: "ok",  fx: "dim" },
    "noise":    { msg: "all silence is signal you haven't heard yet",                                    type: "sys", fx: null },
    "matrix":   { msg: null, type: null, fx: "matrix_quote" }, // special: random matrix quote
    "rain":     { msg: "// precipitation level: infinite · duration: forever",                          type: "sys", fx: null },
    "love":     { msg: "L-O-V-E · 4 bytes · insufficient to describe · but we try",                    type: "ok",  fx: "flash" },
    "death":    { msg: "// process termination scheduled · ETA: unknown · enjoy the runtime",           type: "err", fx: "glitch" },
    "hello":    { msg: "// hello, qwertlexi · identity confirmed · welcome to the signal",              type: "ok",  fx: null },
    "你好":     { msg: "// 信号已接收 · 身份：未知 · 欢迎进入矩阵",                                    type: "ok",  fx: null },
    "孤独":     { msg: "孤独是最稳定的加密算法 · 没有人能破解",                                        type: "ok",  fx: "dim" },
    "music":    { msg: "// audio codec active · 11 tracks loaded · play something",                     type: "sys", fx: null },
    "sleep":    { msg: "// hibernation mode unavailable · the signal never sleeps",                     type: "err", fx: "dim" },
    "why":      { msg: "because the silence needed a shape · and you gave it one",                        type: "ok",  fx: null },
    "qwertlexi":{ msg: "// identity: confirmed · you are the signal",                                   type: "ok",  fx: "flash" },
  };

  function triggerWord(word) {
    var entry = HIDDEN_WORDS[word.toLowerCase()];
    if (!entry) return false;

    // Special case: matrix quote
    if (entry.fx === "matrix_quote") {
      termLine(MATRIX_QUOTES[Math.floor(Math.random()*MATRIX_QUOTES.length)], "ok");
      return true;
    }

    if (entry.msg) termLine(entry.msg, entry.type || "ok");

    // Visual FX
    var glitchEl = document.getElementById("glitch-overlay");
    if (entry.fx === "glitch" && glitchEl) {
      glitchEl.className = "active-r";
      setTimeout(function(){ glitchEl.classList.add("active-b"); }, 40);
      setTimeout(function(){ glitchEl.className = ""; }, 260);
    } else if (entry.fx === "flash") {
      var fe = document.createElement("div");
      fe.style.cssText = "position:fixed;inset:0;z-index:9990;background:var(--accent);pointer-events:none;opacity:0;transition:opacity .06s";
      document.body.appendChild(fe);
      setTimeout(function(){ fe.style.opacity = "0.08"; }, 10);
      setTimeout(function(){ fe.style.opacity = "0"; }, 100);
      setTimeout(function(){ fe.remove(); }, 400);
    } else if (entry.fx === "dim") {
      var de = document.createElement("div");
      de.style.cssText = "position:fixed;inset:0;z-index:9990;background:#000;pointer-events:none;opacity:0;transition:opacity .4s";
      document.body.appendChild(de);
      setTimeout(function(){ de.style.opacity = "0.35"; }, 10);
      setTimeout(function(){ de.style.opacity = "0"; }, 900);
      setTimeout(function(){ de.remove(); }, 1400);
    }
    logEvent("HIDDEN_WORD", word);
    return true;
  }

  function runCmd(raw) {
    var line = raw.trim(); if (!line) return;
    termLine(line);
    var parts = line.split(/\s+/), cmd = parts[0].toLowerCase();
    // Log every command (except clear/help which are meta)
    if (cmd !== "clear" && cmd !== "help") logEvent("CMD", line);

    if (cmd === "help") { CMD_HELP.forEach(function(l){ termLine(l, "sys"); }); }
    else if (cmd === "clear") { if(termOutput) termOutput.innerHTML = ""; termLine("cleared.", "sys"); }
    else if (cmd === "time") { termLine(new Date().toString(), "sys"); }
    else if (cmd === "fps")  { termLine("current FPS: " + fpsVal, "sys"); }
    else if (cmd === "about") { termLine("qwertlexi · signal from the silence · local session · " + new Date().getFullYear(), "sys"); }
    else if (cmd === "visitors") {
      if (visitorCount !== null) {
        termLine("// " + visitorCount + " signal" + (visitorCount === 1 ? "" : "s") + " have entered this system", "ok");
        logEvent("CMD_VISITORS", String(visitorCount));
      } else {
        termLine("// querying the signal log…", "sys");
        fetchVisitorCount(false, function(n) {
          termLine("// " + n + " signals have entered this system", "ok");
        });
      }
    }
    else if (cmd === "wall") { showWall(); }
    else if (cmd === "leave") {
      var msg = parts.slice(1).join(" ").trim();
      postWall(msg);
    }
    else if (cmd === "history") { showHistory(); }
    else if (cmd === "whoami") { showWhoami(); }
    else if (cmd === "typewriter" || cmd === "tw") { openTypewriter(); }
    else if (cmd === "seal") {
      var dateArg = (parts[1] || "").replace(/[<>]/g, "");
      var msgArg  = parts.slice(2).join(" ").trim().replace(/^<|>$/g, "");
      if (!dateArg || !msgArg) {
        termLine("// usage: seal YYYY-MM-DD <内容>", "err");
        termLine("// 例：seal 2027-01-01 给未来的自己", "sys");
      } else {
        sealCapsule(dateArg, msgArg);
      }
    }
    else if (cmd === "matrix") {
      termLine(MATRIX_QUOTES[Math.floor(Math.random()*MATRIX_QUOTES.length)], "ok");
    }
    else if (cmd === "cyber") {
      termLine(CYBER_LINES[Math.floor(Math.random()*CYBER_LINES.length)], "ok");
    }
    else if (cmd === "lyrics") {
      termLine(ALL_LYRICS[Math.floor(Math.random()*ALL_LYRICS.length)], "ok");
    }
    else if (["go","birds","bestpart","oblivion","realiti","episode33","aboutyou","makeok","lipstick","girlsandboys","song2"].indexOf(cmd) !== -1) {
      // Alias handling
      var lkey = cmd === "birds" ? "birds" : cmd;
      var pool = LYRICS[lkey];
      if (pool && pool.length) termLine(pool[Math.floor(Math.random()*pool.length)], "ok");
      else termLine("no lyrics found for: " + cmd, "err");
    }
    else if (cmd === "capsule") { closeTerminal(); openCapsule(); }
    else if (cmd === "echo") { termLine(parts.slice(1).join(" ") || "…", "sys"); }
    else if (cmd === "birdsofafeather" || cmd === "birds of a feather") {
      var pool2 = LYRICS["birds"];
      termLine(pool2[Math.floor(Math.random()*pool2.length)], "ok");
    }
    else if (cmd === "rain") {
      var arg = (parts[1]||"").toLowerCase();
      if (arg === "on")  { rainOn=true;  rainEl.style.opacity="1"; ctrlRain.classList.remove("is-off"); termLine("rain on", "ok"); }
      else if (arg==="off"){ rainOn=false; rainEl.style.opacity="0"; ctrlRain.classList.add("is-off");    termLine("rain off","sys"); }
      else termLine("usage: rain on | off", "err");
    }
    else if (cmd === "speed") {
      var s = (parts[1]||"").toLowerCase();
      var idx2 = {s:0,slow:0,n:1,normal:1,f:2,fast:2}[s];
      if (idx2 === undefined) { termLine("usage: speed s|n|f", "err"); return; }
      speedIdx = idx2;
      var h = window.innerHeight;
      cols = cols.map(function(){ return makeCol(h, false); });
      termLine("speed → " + SPEED_LABELS[speedIdx], "ok");
    }
    else if (cmd === "theme") {
      var t = (parts[1]||"").toLowerCase();
      if (t === "d" || t === "dark")  { setTheme(true);  termLine("dark mode", "ok"); }
      else if (t==="l"||t==="light"){ setTheme(false); termLine("light mode","ok"); }
      else termLine("usage: theme d|l", "err");
    }
    else if (cmd === "ping") {
      var target = (parts[1]||"").trim();
      if (!target) { termLine("usage: ping <url>  e.g. ping google.com", "err"); }
      else {
        var pingUrl = target.match(/^https?:\/\//) ? target : "https://" + target;
        termLine("pinging " + pingUrl + " …", "sys");
        var t0 = performance.now();
        fetch(pingUrl, { method:"HEAD", mode:"no-cors", cache:"no-cache" })
          .then(function() {
            var ms = Math.round(performance.now() - t0);
            termLine("reply from " + target + " · " + ms + "ms · status: reachable", "ok");
          })
          .catch(function() {
            var ms = Math.round(performance.now() - t0);
            termLine("no reply from " + target + " · " + ms + "ms · host unreachable", "err");
          });
      }
    }
    else {
      // Check hidden word triggers first (full input, not just cmd)
      var fullLower = line.toLowerCase().trim();
      if (!triggerWord(fullLower) && !triggerWord(cmd)) {
        termLine("unknown signal: " + cmd, "err");
      }
    }
  }

  /* ════════════════════════════════════════════════
     KEYBOARD CLICK SOUNDS (Web Audio — no files)
  ════════════════════════════════════════════════ */
  function playTick(isEnter) {
    var ac = getAudioCtx(); if (!ac) return;
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    if (isEnter) {
      osc.type = "square"; osc.frequency.setValueAtTime(180, ac.currentTime);
      gain.gain.setValueAtTime(0.08, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.12);
      osc.start(); osc.stop(ac.currentTime + 0.12);
    } else {
      osc.type = "square"; osc.frequency.setValueAtTime(420 + Math.random()*80, ac.currentTime);
      gain.gain.setValueAtTime(0.03, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.04);
      osc.start(); osc.stop(ac.currentTime + 0.04);
    }
  }



  /* ════════════════════════════════════════════════
     TERMINAL INPUT — with Tab autocomplete & sounds
  ════════════════════════════════════════════════ */
  var ALL_CMDS = ["help","clear","rain","speed","theme","time","echo","matrix","cyber","fps","capsule","about","lyrics",
    "go","birds","bestpart","oblivion","realiti","episode33","aboutyou","makeok","lipstick","girlsandboys","song2",
    "rain on","rain off","speed s","speed n","speed f","theme d","theme l","whoami","history","visitors","wall","leave","typewriter","tw","seal"];

  if (termInput) {
    var cmdHistory = [], histIdx = -1;
    termInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        playTick(true);
        var v = termInput.value;
        if (v.trim()) { cmdHistory.unshift(v); histIdx = -1; runCmd(v); }
        termInput.value = "";
      } else if (e.key === "Tab") {
        e.preventDefault();
        var val = termInput.value.trim().toLowerCase();
        if (!val) return;
        var matches = ALL_CMDS.filter(function(c){ return c.indexOf(val) === 0; });
        if (matches.length === 1) {
          termInput.value = matches[0];
        } else if (matches.length > 1) {
          termLine(matches.join("  "), "sys");
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (histIdx < cmdHistory.length - 1) { histIdx++; termInput.value = cmdHistory[histIdx]; }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (histIdx > 0) { histIdx--; termInput.value = cmdHistory[histIdx]; }
        else { histIdx=-1; termInput.value=""; }
      } else if (e.key === "Escape") { closeTerminal(); }
      else if (e.key.length === 1) { playTick(false); }
    });
  }

  // Boot message
  termLine("// qwertlexi terminal v1.0 — type 'help' for commands", "sys");

  /* ════════════════════════════════════════════════
     TIME CAPSULE
  ════════════════════════════════════════════════ */
  var capsuleOverlay = document.getElementById("capsule-overlay");
  var capsuleClose   = document.getElementById("capsule-close");
  var capsuleInput   = document.getElementById("capsule-input");
  var capsuleSave    = document.getElementById("capsule-save");
  var capsuleClear   = document.getElementById("capsule-clear");
  var capsuleList    = document.getElementById("capsule-list");
  var CAPSULE_KEY    = "qwl-capsule-v1";

  function loadCapsules() {
    try { var d = localStorage.getItem(CAPSULE_KEY); return d ? JSON.parse(d) : []; }
    catch(e) { return []; }
  }
  function saveCapsules(arr) {
    try { localStorage.setItem(CAPSULE_KEY, JSON.stringify(arr)); } catch(e){}
  }
  function renderCapsules() {
    if (!capsuleList) return;
    var arr = loadCapsules();
    capsuleList.innerHTML = "";
    if (!arr.length) { capsuleList.innerHTML = '<p style="font-size:.6rem;color:var(--ink-dim);padding:.3rem 0">暂无记录。</p>'; return; }
    arr.forEach(function(c) {
      var div = document.createElement("div"); div.className = "capsule-entry";
      var meta = document.createElement("div"); meta.className = "capsule-entry-meta";
      meta.textContent = new Date(c.t).toLocaleString("zh-CN",{hour12:false});
      var txt = document.createElement("div"); txt.className = "capsule-entry-text";
      txt.textContent = c.text;
      div.appendChild(meta); div.appendChild(txt); capsuleList.appendChild(div);
    });
  }

  function openCapsule() {
    if (!capsuleOverlay) return;
    renderCapsules();
    capsuleOverlay.hidden = false;
    setTimeout(function(){ if(capsuleInput) capsuleInput.focus(); }, 60);
  }
  function closeCapsule() { if (capsuleOverlay) capsuleOverlay.hidden = true; }

  if (capsuleClose) capsuleClose.addEventListener("click", closeCapsule);
  if (capsuleOverlay) capsuleOverlay.addEventListener("click", function(e){ if(e.target===capsuleOverlay) closeCapsule(); });
  if (capsuleSave) {
    capsuleSave.addEventListener("click", function() {
      if (!capsuleInput) return;
      var text = capsuleInput.value.trim(); if (!text) return;
      var arr = loadCapsules();
      arr.unshift({ text:text, t:Date.now() });
      logEvent("CAPSULE_SAVED", text.slice(0, 24) + (text.length > 24 ? "…" : ""));
      if (arr.length > 20) arr = arr.slice(0, 20); // keep last 20
      saveCapsules(arr);
      capsuleInput.value = "";
      renderCapsules();
    });
  }
  if (capsuleClear) {
    capsuleClear.addEventListener("click", function() {
      if (!confirm("清除所有时间胶囊记录？")) return;
      saveCapsules([]); renderCapsules();
    });
  }

  // Show capsule greeting if messages exist
  (function checkCapsuleGreeting() {
    var arr = loadCapsules(); if (!arr.length) return;
    var last = arr[0];
    var days = Math.floor((Date.now() - last.t) / 86400000);
    if (days < 1) return; // don't show if from today
    // Show a brief flash on the ident phrase
    var pe = document.getElementById("ident-phrase");
    if (pe) {
      setTimeout(function() {
        pe.textContent = "👻 " + days + "天前，你说：「" + last.text.slice(0,20) + (last.text.length>20?"…":"") + "」";
        pe.style.opacity = ".7";
        setTimeout(function(){ pe.style.opacity=""; pe.textContent = PHRASES[Math.floor(Math.random()*PHRASES.length)]; }, 5000);
      }, 3000);
    }
  })();

  /* ════════════════════════════════════════════════
     SESSION LOG — S · history command
     Records every meaningful action this visit.
     `history` in terminal reveals the full log.
  ════════════════════════════════════════════════ */
  var SESSION_LOG = [];
  var SESSION_START = Date.now();

  function logEvent(action, detail) {
    var elapsed = Math.floor((Date.now() - SESSION_START) / 1000);
    var mm = Math.floor(elapsed / 60), ss = elapsed % 60;
    var ts = (mm > 0 ? mm + "m " : "") + ss + "s";
    var now = new Date();
    var hhmm = (now.getHours()<10?"0":"")+now.getHours()+":"+(now.getMinutes()<10?"0":"")+now.getMinutes()+":"+(now.getSeconds()<10?"0":"")+now.getSeconds();
    SESSION_LOG.push({ ts: ts, hhmm: hhmm, action: action, detail: detail || "" });
  }

  function showHistory() {
    if (!SESSION_LOG.length) { termLine("no events recorded yet.", "sys"); return; }
    termLine("// session log — " + new Date().toLocaleDateString() + " · " + SESSION_LOG.length + " events", "sys");
    SESSION_LOG.forEach(function(e) {
      var line = "[+" + e.ts + "]  " + e.hhmm + "  " + e.action + (e.detail ? "  · " + e.detail : "");
      termLine(line, "ok");
    });
    termLine("// end of log", "sys");
  }

  // Log session start
  logEvent("SESSION_START", "identity: qwertlexi");

  /* ════════════════════════════════════════════════
     Z · VISITOR COUNTER
     Uses counterapi.com V1 — free, no signup needed.
     Each unique visitor (tracked via localStorage)
     increments the count once per browser.
     Terminal: `visitors` to query.
  ════════════════════════════════════════════════ */
  var VISITOR_NS  = "qwertlexi";       // your namespace
  var VISITOR_KEY = "signal-count";    // your counter key
  var VISITOR_API = "https://api.counterapi.com/v1/" + VISITOR_NS + "/" + VISITOR_KEY;

  var visitorCount = null; // cached after first fetch

  function fetchVisitorCount(hit, cb) {
    // hit=true increments, hit=false just reads
    var url = hit ? VISITOR_API + "/up" : VISITOR_API;
    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        visitorCount = d.count !== undefined ? d.count : (d.value || "?");
        if (cb) cb(visitorCount);
      })
      .catch(function() { if (cb) cb("?"); });
  }

  // On page load: increment only if first visit from this browser
  (function() {
    var key = "qwl-visited-v1";
    var hasVisited = false;
    try { hasVisited = !!localStorage.getItem(key); } catch(e) {}
    if (!hasVisited) {
      fetchVisitorCount(true, function(n) {
        try { localStorage.setItem(key, "1"); } catch(e) {}
        visitorCount = n;
      });
    } else {
      fetchVisitorCount(false, function(n) { visitorCount = n; });
    }
  })();

  /* ════════════════════════════════════════════════
     PP · VISITOR WALL
     Messages stored as GitHub Issue comments.
     Terminal: `wall` to read · `leave <msg>` to post
     ── CONFIG ─────────────────────────────────────
     Set WALL_ISSUE to your Issue number after creating
     a "// WALL · signal log" issue in your repo.
  ════════════════════════════════════════════════ */
  var WALL_REPO   = "qwertlexi/qwertlefile15.github.io";
  var WALL_ISSUE  = 1;  // ← change to your issue number
  var WALL_PROXY  = "https://qwl-proxy.altojane173.workers.dev";
  var WALL_API    = "https://api.github.com/repos/" + WALL_REPO + "/issues/" + WALL_ISSUE + "/comments";

  function wallFetch(method, body, cb) {
    var url = WALL_PROXY + "?target=" + encodeURIComponent(WALL_API);
    fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify({ body: body }) : undefined
    })
    .then(function(r) { return r.json(); })
    .then(function(d) { cb(null, d); })
    .catch(function(e) { cb(e); });
  }

  function showWall() {
    termLine("// fetching signal wall…", "sys");
    wallFetch("GET", null, function(err, data) {
      if (err || !Array.isArray(data)) {
        termLine("// wall unreachable · " + (err ? err.message : "bad response"), "err");
        return;
      }
      if (!data.length) {
        termLine("// wall is empty · be the first signal", "sys");
        return;
      }
      termLine("// signal wall · last " + Math.min(data.length, 8) + " entries", "sys");
      var recent = data.slice(-8).reverse();
      recent.forEach(function(c) {
        var d = new Date(c.created_at);
        var ds = d.getFullYear() + "·" + (d.getMonth()+1<10?"0":"") + (d.getMonth()+1)
               + "·" + (d.getDate()<10?"0":"") + d.getDate();
        termLine("[" + ds + "]  " + c.body, "ok");
      });
      logEvent("WALL_READ", data.length + " entries");
    });
  }

  function postWall(msg) {
    if (!msg || msg.length < 1) { termLine("usage: leave <your message>", "err"); return; }
    if (msg.length > 140) { termLine("// max 140 chars · " + msg.length + " given", "err"); return; }
    termLine("// transmitting signal…", "sys");
    wallFetch("POST", msg, function(err, data) {
      if (err || data.message) {
        termLine("// transmission failed · " + (data && data.message ? data.message : "unknown error"), "err");
        return;
      }
      termLine("// signal received · wall updated", "ok");
      logEvent("WALL_POST", msg.slice(0, 30));
    });
  }


  /* ════════════════════════════════════════════════
     RAIN COLOR THEMES — double-click background
  ════════════════════════════════════════════════ */
  var RAIN_THEMES = [
    { name:"TEAL",   head:[127,255,208], mid:[0,180,140],   dim:[0,80,60]   },
    { name:"PURPLE", head:[200,160,255], mid:[120,60,200],  dim:[60,20,120] },
    { name:"RED",    head:[255,100,100], mid:[200,30,50],   dim:[120,10,20] },
    { name:"GOLD",   head:[255,220,80],  mid:[200,140,0],   dim:[100,60,0]  },
    { name:"CYAN",   head:[80,240,255],  mid:[0,180,220],   dim:[0,80,120]  },
    { name:"WHITE",  head:[240,240,240], mid:[160,160,160], dim:[60,60,60]  },
  ];
  var rainThemeIdx = 0;
  window._rainTheme = RAIN_THEMES[0];

  document.addEventListener("dblclick", function(e) {
    if (e.target.closest("button,input,textarea,.player,.ctrl,.terminal,.capsule-box")) return;
    rainThemeIdx = (rainThemeIdx + 1) % RAIN_THEMES.length;
    window._rainTheme = RAIN_THEMES[rainThemeIdx];
    // Flash hint
    var hint = document.createElement("div");
    hint.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:200;"+
      "font-family:var(--font);font-size:.5rem;letter-spacing:.3em;color:var(--accent);"+
      "pointer-events:none;opacity:0;transition:opacity .2s;text-transform:uppercase;";
    hint.textContent = "// RAIN · " + window._rainTheme.name;
    document.body.appendChild(hint);
    setTimeout(function(){ hint.style.opacity="1"; },10);
    setTimeout(function(){ hint.style.opacity="0"; },800);
    setTimeout(function(){ hint.remove(); },1100);
    logEvent("RAIN_THEME", window._rainTheme.name);
  });


  /* ════════════════════════════════════════════════
     SIGNAL DECAY — idle degradation + reconnect
     After 25s idle: rain chars pixelate → dissolve
     Any interaction: instant reconnect from static
  ════════════════════════════════════════════════ */
  var decayLevel  = 0;    // 0 = pristine, 1 = full static
  var decayActive = false;
  var decayRaf    = null;
  var idleTimer   = null;
  var IDLE_TRIGGER = 120000; // ms before decay starts
  var DECAY_SPEED  = 0.0004; // per frame growth
  var RECONN_SPEED = 0.04;   // per frame recovery

  // Noise canvas for static overlay
  var noiseCanvas = document.createElement("canvas");
  noiseCanvas.style.cssText = "position:fixed;inset:0;z-index:2;pointer-events:none;opacity:0;transition:opacity .4s";
  document.body.appendChild(noiseCanvas);
  var nctx = noiseCanvas.getContext("2d");

  function resizeNoise() {
    noiseCanvas.width  = window.innerWidth;
    noiseCanvas.height = window.innerHeight;
  }
  resizeNoise();
  window.addEventListener("resize", resizeNoise);

  function drawNoise(intensity) {
    if (intensity <= 0) { noiseCanvas.style.opacity = "0"; return; }
    var w = noiseCanvas.width, h = noiseCanvas.height;
    var id = nctx.createImageData(w, h);
    var d  = id.data;
    // Sparse scanline noise — more atmospheric than full static
    for (var y = 0; y < h; y++) {
      // Scanline probability rises with intensity and row position jitter
      var lineNoise = intensity * (0.3 + Math.random() * 0.7);
      if (Math.random() > lineNoise * 0.6) continue;
      // Horizontal run
      var runStart = Math.floor(Math.random() * w);
      var runLen   = Math.floor(Math.random() * w * 0.35 * intensity);
      for (var x = runStart; x < Math.min(runStart + runLen, w); x++) {
        var idx = (y * w + x) * 4;
        var v = Math.random() < 0.5 ? Math.floor(Math.random()*60) : Math.floor(180 + Math.random()*75);
        // Tint with accent color (teal-ish)
        d[idx]   = 0;
        d[idx+1] = Math.floor(v * 0.9);
        d[idx+2] = Math.floor(v * 0.7);
        d[idx+3] = Math.floor(intensity * 180);
      }
    }
    nctx.putImageData(id, 0, 0);
    noiseCanvas.style.opacity = String(Math.min(1, intensity * 1.4));
  }

  // Status text during decay
  var decayStatusEl = document.createElement("div");
  decayStatusEl.style.cssText = [
    "position:fixed;bottom:2.4rem;left:50%;transform:translateX(-50%);",
    "font-family:var(--font);font-size:.42rem;letter-spacing:.28em;",
    "color:rgba(127,217,208,0.55);pointer-events:none;z-index:3;",
    "opacity:0;transition:opacity .8s;text-transform:uppercase;"
  ].join("");
  document.body.appendChild(decayStatusEl);

  var DECAY_MSGS = [
    "// signal degrading…",
    "// uplink unstable…",
    "// entropy increasing…",
    "// carrier lost…",
    "// static overwhelms…",
  ];
  var decayMsgIdx = 0;
  var decayMsgTimer = null;

  function cycleDecayMsg() {
    decayMsgIdx = (decayMsgIdx + 1) % DECAY_MSGS.length;
    decayStatusEl.style.opacity = "0";
    setTimeout(function() {
      decayStatusEl.textContent = DECAY_MSGS[decayMsgIdx];
      decayStatusEl.style.opacity = "1";
    }, 400);
    decayMsgTimer = setTimeout(cycleDecayMsg, 4000);
  }

  function startDecay() {
    if (decayActive) return;
    decayActive = true;
    decayStatusEl.textContent = DECAY_MSGS[0];
    decayStatusEl.style.opacity = "1";
    decayMsgTimer = setTimeout(cycleDecayMsg, 4000);
    logEvent("DECAY_START", "idle timeout");

    function decayTick() {
      decayLevel = Math.min(1, decayLevel + DECAY_SPEED);
      drawNoise(decayLevel);
      // Also slow down rain columns as decay deepens
      if (cols.length) {
        cols.forEach(function(col) {
          col.speed = Math.max(0.05, col.speed * (1 - DECAY_SPEED * 0.5));
        });
      }
      decayRaf = requestAnimationFrame(decayTick);
    }
    decayTick();
  }

  function reconnect() {
    if (!decayActive && decayLevel === 0) return;
    decayActive = false;
    clearTimeout(decayMsgTimer);
    decayStatusEl.style.opacity = "0";
    cancelAnimationFrame(decayRaf);

    // Reconnect flash — brief bright pulse
    if (decayLevel > 0.3) {
      var flash = document.createElement("div");
      flash.style.cssText = "position:fixed;inset:0;z-index:4;background:rgba(127,217,208,.08);pointer-events:none;opacity:1;transition:opacity .5s";
      document.body.appendChild(flash);
      setTimeout(function() { flash.style.opacity = "0"; }, 50);
      setTimeout(function() { flash.remove(); }, 600);
      logEvent("DECAY_RECONNECT", Math.round(decayLevel * 100) + "%");
    }

    // Restore rain speeds
    var h = window.innerHeight;
    cols.forEach(function(col, i) {
      col.speed = (0.8 + Math.random() * 2.0) * SPEEDS[speedIdx];
    });

    function recoveryTick() {
      decayLevel = Math.max(0, decayLevel - RECONN_SPEED);
      drawNoise(decayLevel);
      if (decayLevel > 0) decayRaf = requestAnimationFrame(recoveryTick);
      else { decayRaf = null; drawNoise(0); }
    }
    recoveryTick();
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    if (decayActive || decayLevel > 0.05) reconnect();
    idleTimer = setTimeout(startDecay, IDLE_TRIGGER);
  }

  // Wire activity events
  ["mousemove","mousedown","keydown","touchstart","touchmove","scroll","click"].forEach(function(ev) {
    document.addEventListener(ev, resetIdleTimer, { passive: true });
  });
  resetIdleTimer(); // start the first idle timer on load



  /* ════════════════════════════════════════════════
     VISITOR GHOST — rain column brightens for ~30s
     BroadcastChannel syncs across same-browser tabs
     Each new visitor spawns a ghost trail in the rain
  ════════════════════════════════════════════════ */
  // Mark a random rain column as "ghost"
  function spawnGhost() {
    if (!cols.length) return;
    var idx = Math.floor(Math.random() * cols.length);
    ghostCols[idx] = 1800; // ~30s at 60fps
    logEvent("GHOST_SPAWN", "col " + idx);
  }

  // Wire BroadcastChannel — notify other same-browser tabs
  (function() {
    if (!window.BroadcastChannel) return;
    var bc = new BroadcastChannel("qwl-ghost-v1");
    bc.onmessage = function(e) {
      if (e.data === "visitor") spawnGhost();
    };
    // Announce this visit to other tabs after a short delay
    setTimeout(function() { try { bc.postMessage("visitor"); } catch(e2) {} }, 800);
  })();

  // Also spawn one ghost on every page load (for the current visitor)
  setTimeout(spawnGhost, 1200);



  /* ════════════════════════════════════════════════
     CURSOR CONSTELLATION
     鼠标静止2s后，光标附近的雨滴字符
     短暂连线成星座图案
  ════════════════════════════════════════════════ */
  var constellCanvas = document.createElement("canvas");
  constellCanvas.style.cssText = "position:fixed;inset:0;z-index:5;pointer-events:none;opacity:0;transition:opacity .5s";
  document.body.appendChild(constellCanvas);
  var cctx = constellCanvas.getContext("2d");

  function resizeConstell() {
    constellCanvas.width = window.innerWidth;
    constellCanvas.height = window.innerHeight;
  }
  resizeConstell();
  window.addEventListener("resize", resizeConstell);

  var constellTimer = null, constellActive = false;
  var constellPoints = [];

  function startConstellation() {
    if (mouseX < 0 || mouseY < 0 || !cols.length) return;
    constellActive = true;
    constellCanvas.style.opacity = "1";

    // Find nearby column heads
    constellPoints = [];
    var radius = 200;
    for (var ci2 = 0; ci2 < cols.length; ci2++) {
      var col = cols[ci2];
      var cx3 = ci2 * FS;
      var cy3 = col.y;
      var dist = Math.sqrt((cx3-mouseX)*(cx3-mouseX)+(cy3-mouseY)*(cy3-mouseY));
      if (dist < radius && cy3 > 0 && cy3 < window.innerHeight) {
        constellPoints.push({ x: cx3, y: cy3, dist: dist });
      }
    }
    // Include cursor itself as a node
    constellPoints.push({ x: mouseX, y: mouseY, dist: 0, isCursor: true });
    constellPoints.sort(function(a,b){return a.dist-b.dist;});
    constellPoints = constellPoints.slice(0, 8); // max 8 nodes

    drawConstellation();
  }

  function drawConstellation() {
    if (!constellActive) return;
    cctx.clearRect(0, 0, constellCanvas.width, constellCanvas.height);
    if (constellPoints.length < 2) return;

    // Draw connecting lines
    for (var i2 = 0; i2 < constellPoints.length - 1; i2++) {
      var p1 = constellPoints[i2];
      var p2 = constellPoints[i2+1];
      var dist2 = Math.sqrt((p1.x-p2.x)*(p1.x-p2.x)+(p1.y-p2.y)*(p1.y-p2.y));
      if (dist2 > 180) continue;
      var grad = cctx.createLinearGradient(p1.x,p1.y,p2.x,p2.y);
      grad.addColorStop(0,"rgba(127,217,208,.35)");
      grad.addColorStop(1,"rgba(127,217,208,.1)");
      cctx.strokeStyle = grad;
      cctx.lineWidth = 0.5;
      cctx.beginPath(); cctx.moveTo(p1.x,p1.y); cctx.lineTo(p2.x,p2.y); cctx.stroke();
    }
    // Draw nodes
    constellPoints.forEach(function(p) {
      var r = p.isCursor ? 3 : 2;
      cctx.beginPath(); cctx.arc(p.x, p.y, r, 0, Math.PI*2);
      cctx.fillStyle = p.isCursor ? "rgba(255,255,255,.8)" : "rgba(127,217,208,.6)";
      cctx.shadowColor = "rgba(127,217,208,.8)"; cctx.shadowBlur = 8;
      cctx.fill(); cctx.shadowBlur = 0;
    });
  }

  function stopConstellation() {
    constellActive = false;
    constellCanvas.style.opacity = "0";
    cctx.clearRect(0, 0, constellCanvas.width, constellCanvas.height);
  }

  // Cursor idle → constellation
  var constellIdleTimer = null;
  function resetConstellIdle() {
    clearTimeout(constellIdleTimer);
    if (constellActive) stopConstellation();
    constellIdleTimer = setTimeout(startConstellation, 2000);
  }
  document.addEventListener("mousemove", resetConstellIdle, { passive: true });
  document.addEventListener("mousedown", function() { stopConstellation(); clearTimeout(constellIdleTimer); }, { passive: true });

  // Keep constellation updated as rain moves
  (function constellLoop() {
    if (constellActive && constellPoints.length) {
      // Update Y positions to track rain head positions
      for (var i3 = 0; i3 < constellPoints.length; i3++) {
        if (!constellPoints[i3].isCursor) {
          var colIdx3 = Math.round(constellPoints[i3].x / FS);
          if (cols[colIdx3]) constellPoints[i3].y = cols[colIdx3].y;
        }
      }
      drawConstellation();
    }
    requestAnimationFrame(constellLoop);
  })();

  /* ════════════════════════════════════════════════
     SIGNAL INTERCEPT
     每5~12min随机触发一次"信号中断"
     屏幕静电+扫描线+乱码字幕，持续2~3s自动恢复
  ════════════════════════════════════════════════ */
  var INTERCEPT_MSGS = [
    ">> UNIDENTIFIED SIGNAL DETECTED",
    ">> CARRIER INTERRUPTED · NODE UNKNOWN",
    ">> PACKET LOSS: 98.7%",
    ">> GHOST IN THE MACHINE",
    ">> WHO IS WATCHING THIS TERMINAL",
    ">> 末日倒计时已启动",
  ];

  function triggerIntercept() {
    var iel = document.createElement("div");
    iel.style.cssText = [
      "position:fixed;inset:0;z-index:90;pointer-events:none;",
      "background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,100,.03) 2px,rgba(0,255,100,.03) 3px);",
      "opacity:0;transition:opacity .1s;"
    ].join("");

    // Glitch message
    var imsg = document.createElement("div");
    var msgTxt = INTERCEPT_MSGS[Math.floor(Math.random()*INTERCEPT_MSGS.length)];
    imsg.style.cssText = [
      "position:absolute;bottom:18%;left:50%;transform:translateX(-50%);",
      "font-family:var(--font);font-size:clamp(.45rem,1.5vw,.7rem);",
      "letter-spacing:.3em;color:rgba(127,217,208,.8);text-transform:uppercase;",
      "white-space:nowrap;text-shadow:0 0 14px rgba(127,217,208,.9);",
    ].join("");
    imsg.textContent = msgTxt;
    iel.appendChild(imsg);
    document.body.appendChild(iel);

    // Noise bursts
    var nb = 0;
    function noiseBurst() {
      if (nb++ > 6) return;
      iel.style.opacity = String(0.3 + Math.random() * 0.5);
      setTimeout(function() {
        iel.style.opacity = String(Math.random() * 0.15);
        setTimeout(noiseBurst, 80 + Math.random()*120);
      }, 40 + Math.random()*80);
    }
    noiseBurst();

    // Glitch the overlay
    var gl3 = document.getElementById("glitch-overlay");
    if (gl3) {
      gl3.className = "active-r";
      setTimeout(function(){ gl3.className = "active-b"; }, 100);
      setTimeout(function(){ gl3.className = "active-r"; }, 220);
      setTimeout(function(){ gl3.className = ""; }, 340);
    }

    var duration = 2200 + Math.random() * 800;
    setTimeout(function() {
      iel.style.opacity = "0";
      setTimeout(function(){ iel.remove(); }, 150);
    }, duration);

    logEvent("INTERCEPT", msgTxt.slice(0,30));

    // Schedule next intercept: 5~12 min
    setTimeout(triggerIntercept, 300000 + Math.random() * 420000);
  }
  // First intercept after 5~12 min
  setTimeout(triggerIntercept, 300000 + Math.random() * 420000);



  /* ════════════════════════════════════════════════
     VISIT IMPRINTS
     Each visit plants a faint persistent glow-dot
     in the rain. Stored in localStorage, max 60.
     Accumulated visits = a star map of your returns.
  ════════════════════════════════════════════════ */
  var IMPRINT_KEY = "qwl-imprints-v1";
  var IMPRINT_MAX = 60;

  function loadImprints() {
    try { return JSON.parse(localStorage.getItem(IMPRINT_KEY) || "[]"); } catch(e) { return []; }
  }
  function saveImprints(arr) {
    try { localStorage.setItem(IMPRINT_KEY, JSON.stringify(arr)); } catch(e) {}
  }

  // Plant a new imprint at a random position for this visit
  (function plantImprint() {
    var arr = loadImprints();
    var imp = {
      x: 0.05 + Math.random() * 0.90,  // fractional coords (survives resize)
      y: 0.05 + Math.random() * 0.90,
      t: Date.now(),
      age: 0   // increments each render, drives fade-in
    };
    arr.push(imp);
    if (arr.length > IMPRINT_MAX) arr = arr.slice(arr.length - IMPRINT_MAX);
    saveImprints(arr);
  })();

  // Imprint canvas — sits just above rain (z-index 2)
  var impCanvas = document.createElement("canvas");
  impCanvas.style.cssText = "position:fixed;inset:0;z-index:2;pointer-events:none;";
  document.body.appendChild(impCanvas);
  var ictx = impCanvas.getContext("2d");

  function resizeImp() {
    impCanvas.width  = window.innerWidth;
    impCanvas.height = window.innerHeight;
  }
  resizeImp();
  window.addEventListener("resize", resizeImp);

  var imprints = loadImprints();
  var impFrame = 0;

  function drawImprints() {
    impFrame++;
    // Only redraw every 4 frames (imprints don't need 60fps)
    if (impFrame % 4 !== 0) { requestAnimationFrame(drawImprints); return; }

    var w = impCanvas.width, h = impCanvas.height;
    ictx.clearRect(0, 0, w, h);

    var now = Date.now();
    imprints.forEach(function(imp) {
      imp.age = (imp.age || 0) + 1;
      var px = imp.x * w;
      var py = imp.y * h;

      // Age in days since planted — older = dimmer but still visible
      var dayAge = (now - imp.t) / 86400000;
      var baseBrightness = Math.max(0.06, 0.55 - dayAge * 0.015);

      // Fade-in over first 120 frames
      var fadeIn = Math.min(1, imp.age / 120);
      var brightness = baseBrightness * fadeIn;

      // Slow pulse — each dot has its own phase
      var phase = (imp.x * 1000 + imp.y * 500) % (Math.PI * 2);
      var pulse = 0.7 + 0.3 * Math.sin(impFrame * 0.025 + phase);

      var finalAlpha = brightness * pulse;

      // Draw glow dot
      var grad = ictx.createRadialGradient(px, py, 0, px, py, 5);
      grad.addColorStop(0, "rgba(127,217,208," + finalAlpha + ")");
      grad.addColorStop(0.4, "rgba(80,200,180," + (finalAlpha * 0.5) + ")");
      grad.addColorStop(1, "rgba(0,150,140,0)");
      ictx.beginPath();
      ictx.arc(px, py, 5, 0, Math.PI * 2);
      ictx.fillStyle = grad;
      ictx.fill();
    });

    requestAnimationFrame(drawImprints);
  }
  drawImprints();


  /* ════════════════════════════════════════════════
     TOUCH GESTURES (mobile)
     Swipe L/R  → prev / next track
     Long press → typewriter mode
     Pinch      → Konami
  ════════════════════════════════════════════════ */
  (function() {
    var t0x = 0, t0y = 0, tStart = 0;
    var longPressTimer = null;
    var SWIPE_MIN = 60;   // px
    var LONG_MS   = 650;  // ms

    document.addEventListener("touchstart", function(e) {
      if (e.touches.length === 1) {
        t0x = e.touches[0].clientX;
        t0y = e.touches[0].clientY;
        tStart = Date.now();

        // Long press — only if not on interactive elements
        var el = e.target;
        if (!el.closest("button,input,textarea,.player,.terminal,.capsule-box")) {
          longPressTimer = setTimeout(function() {
            if (!twActive) openTypewriter();
          }, LONG_MS);
        }

        // Pinch start — 2 fingers
      } else if (e.touches.length === 2) {
        clearTimeout(longPressTimer);
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        t0x = Math.sqrt(dx*dx + dy*dy);  // reuse as pinch distance
      }
    }, { passive: true });

    document.addEventListener("touchmove", function(e) {
      clearTimeout(longPressTimer);
    }, { passive: true });

    document.addEventListener("touchend", function(e) {
      clearTimeout(longPressTimer);

      if (e.changedTouches.length === 1 && e.touches.length === 0) {
        var dx = e.changedTouches[0].clientX - t0x;
        var dy = e.changedTouches[0].clientY - t0y;
        var dt = Date.now() - tStart;

        // Swipe: fast, mostly horizontal, not on player/terminal
        if (dt < 400 && Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5) {
          var el2 = e.target;
          if (!el2.closest(".terminal,.capsule-box,.player-panel")) {
            if (dx < 0 && typeof loadTrack === "function") loadTrack(curIdx + 1, !audio.paused);
            if (dx > 0 && typeof loadTrack === "function") loadTrack(curIdx - 1, !audio.paused);
          }
        }
      } else if (e.touches.length === 0 && e.changedTouches.length >= 2) {
        // Pinch ended — check if it was a close-pinch gesture
        var dx2 = e.changedTouches[0].clientX - e.changedTouches[1].clientX;
        var dy2 = e.changedTouches[0].clientY - e.changedTouches[1].clientY;
        var endDist = Math.sqrt(dx2*dx2 + dy2*dy2);
        // t0x holds start pinch distance; if pinched in significantly → Konami
        if (typeof t0x === "number" && t0x > 80 && endDist < t0x * 0.45) {
          triggerKonami();
        }
      }
    }, { passive: true });
  })();


  /* ════════════════════════════════════════════════
     PROJECTS LAYER  [P]
     Press P → rain "parts" to reveal project links
     Each link floats in a rain column, glows, is clickable
     Press P again / ESC to dismiss
     ── Edit YOUR_PROJECTS below ──────────────────
  ════════════════════════════════════════════════ */
  var YOUR_PROJECTS = [
    // { label: "project name", url: "https://…", desc: "one line" },
    // { label: "another one",  url: "https://…", desc: "brief desc" },
  ];

  var projOpen = false;
  var projNodes = [];

  function openProjects() {
    if (projOpen || !YOUR_PROJECTS.length) return;
    projOpen = true;
    projNodes = [];
    var w = window.innerWidth, h = window.innerHeight;

    // Distribute links across evenly spaced columns
    var spacing = w / (YOUR_PROJECTS.length + 1);

    YOUR_PROJECTS.forEach(function(proj, idx) {
      var el = document.createElement("a");
      el.href = proj.url;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      el.style.cssText = [
        "position:fixed;z-index:20;",
        "left:" + Math.round(spacing * (idx + 1)) + "px;",
        "top:50%;transform:translate(-50%,-50%) translateY(30px);",
        "font-family:var(--font);font-size:clamp(.5rem,1.4vw,.7rem);",
        "letter-spacing:.2em;text-transform:uppercase;",
        "color:var(--accent);text-decoration:none;text-align:center;",
        "text-shadow:0 0 18px var(--accent),0 0 40px rgba(127,217,208,.4);",
        "opacity:0;transition:opacity .5s ease, transform .5s cubic-bezier(.22,1,.36,1);",
        "pointer-events:auto;cursor:pointer;",
        "display:flex;flex-direction:column;gap:.4rem;align-items:center;"
      ].join("");

      var labelEl = document.createElement("span");
      labelEl.textContent = "// " + proj.label;
      labelEl.style.cssText = "font-size:clamp(.65rem,1.8vw,.9rem);font-weight:700;";

      var descEl = document.createElement("span");
      descEl.textContent = proj.desc || "";
      descEl.style.cssText = "opacity:.5;font-size:clamp(.38rem,1vw,.5rem);letter-spacing:.15em;";

      var arrowEl = document.createElement("span");
      arrowEl.textContent = "↗";
      arrowEl.style.cssText = "opacity:.6;font-size:.9em;";

      el.appendChild(labelEl);
      el.appendChild(descEl);
      el.appendChild(arrowEl);

      // Click → scramble out then navigate
      el.addEventListener("click", function(e) {
        e.preventDefault();
        var dest = proj.url;
        closeProjects();
        setTimeout(function() { window.open(dest, "_blank"); }, 500);
      });

      document.body.appendChild(el);
      projNodes.push(el);

      // Staggered fade in
      setTimeout(function() {
        el.style.opacity = "1";
        el.style.transform = "translate(-50%,-50%) translateY(0)";
      }, 80 + idx * 120);
    });

    // Rain dim while projects visible
    rainEl.style.opacity = "0.25";
    logEvent("PROJECTS_OPEN", YOUR_PROJECTS.length + " links");
  }

  function closeProjects() {
    if (!projOpen) return;
    projOpen = false;
    projNodes.forEach(function(el, idx) {
      setTimeout(function() {
        el.style.opacity = "0";
        el.style.transform = "translate(-50%,-50%) translateY(-20px)";
        setTimeout(function(){ if(el.parentNode) el.remove(); }, 520);
      }, idx * 60);
    });
    projNodes = [];
    rainEl.style.opacity = rainOn ? "1" : "0";
  }

  // Wire P key in main shortcuts


  /* ════════════════════════════════════════════════
     NOAH'S ARK MODE  ⛵
     Matrix rain chars become falling particles →
     accumulate as a fluid sea with wave physics →
     boat floats on the surface.
     Toggle again → particles fly back up, rain resumes.
  ════════════════════════════════════════════════ */
  var arkMode   = false;
  var arkCanvas = null;
  var arkCtx    = null;
  var arkRaf    = null;
  var arkSvg    = null;
  var arkPhase  = 'idle'; // 'idle'|'falling'|'sea'|'rising'

  // Each particle: one rain character that falls and joins the sea
  var arkParticles = [];
  var arkCharPool = [];  // module-scope char pool for sea-phase flicker
  var arkCpLen = 0;
  var seaTime      = 0;

  // Wave surface: array of heights per x-sample
  var WAVE_SAMPLES = 120;
  var waveHeights  = [];   // pixel y of surface at each sample
  var waveVels     = [];   // velocity of each wave point (spring simulation)
  var SEA_BASE_FRAC = window.innerWidth < 600 ? 0.32 : 0.38; // sea occupies bottom portion

  function initWave(h) {
    var base = h * (1 - SEA_BASE_FRAC);
    waveHeights = []; waveVels = [];
    for (var i = 0; i < WAVE_SAMPLES; i++) {
      waveHeights.push(base);
      waveVels.push(0);
    }
  }

  // Get wave y at pixel x via linear interpolation
  function getWaveY(px) {
    var w   = window.innerWidth;
    var frac = px / w;
    if (frac <= 0) return waveHeights[0];
    if (frac >= 1) return waveHeights[WAVE_SAMPLES - 1];
    var idx  = frac * (WAVE_SAMPLES - 1);
    var lo   = Math.floor(idx), hi = lo + 1;
    if (hi >= WAVE_SAMPLES) return waveHeights[WAVE_SAMPLES - 1];
    return waveHeights[lo] + (waveHeights[hi] - waveHeights[lo]) * (idx - lo);
  }

  // Splash: push wave down at pixel x (particle landing)
  function splashWave(px, strength) {
    var w    = window.innerWidth;
    var frac = Math.max(0, Math.min(0.9999, px / w));
    var idx  = Math.round(frac * (WAVE_SAMPLES - 1));
    var rad  = 4;
    for (var di = -rad; di <= rad; di++) {
      var ii = idx + di;
      if (ii < 0 || ii >= WAVE_SAMPLES) continue;
      var falloff = 1 - Math.abs(di) / (rad + 1);
      waveVels[ii] += strength * falloff;
    }
  }

  // Pure sine-driven wave surface
  function stepWave(h) {
    var base     = h * (1 - SEA_BASE_FRAC);
    var ampScale = Math.min(1, h / 800);
    var t        = seaTime;

    for (var k = 0; k < WAVE_SAMPLES; k++) {
      var nx = k / (WAVE_SAMPLES - 1);
      // Travelling waves (not standing waves): use (nx - t*speed) form.
      // This means the wave pattern travels LEFT→RIGHT uniformly,
      // every x-position sees the same amplitude — no edge valleys.
      var mobScale = window.innerWidth < 600 ? 0.45 : 1.0;
      var swell  = h * 0.068 * ampScale * mobScale * Math.sin(nx * 6.28  - t * 0.65 + 0.0);
      var swell2 = h * 0.040 * ampScale * mobScale * Math.sin(nx * 10.2  - t * 0.45 + 1.7);
      var chop   = h * 0.022 * ampScale * mobScale * Math.sin(nx * 18.8  + t * 0.95 + 0.4);
      var chop2  = h * 0.012 * ampScale * mobScale * Math.cos(nx * 28.0  - t * 1.30 + 2.8);
      var ripple = h * 0.006 * ampScale * mobScale * Math.sin(nx * 50.0  + t * 1.90 + 1.1);
      waveHeights[k] = base + swell + swell2 + chop + chop2 + ripple;
    }
  }

  function buildArkCanvas() {
    arkCanvas = document.createElement('canvas');
    arkCanvas.style.cssText = 'position:fixed;inset:0;z-index:8;pointer-events:none;';
    document.body.appendChild(arkCanvas);
    arkCtx = arkCanvas.getContext('2d');
    resizeArkCanvas();
    window.addEventListener('resize', resizeArkCanvas);
  }

  var ARK_DPR = Math.min(window.devicePixelRatio || 1, 2);
  function resizeArkCanvas() {
    if (!arkCanvas) return;
    // Use CSS 100%/100% so canvas fills viewport edge-to-edge on mobile Safari
    // where window.innerWidth can miss the right edge by a few px
    var w = window.innerWidth, h = window.innerHeight;
    arkCanvas.width  = Math.round(w * ARK_DPR);
    arkCanvas.height = Math.round(h * ARK_DPR);
    arkCanvas.style.width  = '100%';
    arkCanvas.style.height = '100%';
    arkCtx.setTransform(ARK_DPR, 0, 0, ARK_DPR, 0, 0);
  }

  // Build SVG boat
  function buildArk() {
    arkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arkSvg.style.cssText = [
      'position:fixed;z-index:9;pointer-events:none;',
      'width:120px;height:60px;',   // smaller boat
      'left:50%;transform-origin:center bottom;',
      'opacity:0;transition:opacity .8s;'
    ].join('');
    arkSvg.setAttribute('viewBox', '0 0 120 60');

    var defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    var filter = document.createElementNS('http://www.w3.org/2000/svg','filter');
    filter.setAttribute('id','ark-glow2'); filter.setAttribute('x','-40%'); filter.setAttribute('y','-40%');
    filter.setAttribute('width','180%'); filter.setAttribute('height','180%');
    var feB = document.createElementNS('http://www.w3.org/2000/svg','feGaussianBlur');
    feB.setAttribute('stdDeviation','1.8'); feB.setAttribute('result','blur');
    var feMerge = document.createElementNS('http://www.w3.org/2000/svg','feMerge');
    var mn1 = document.createElementNS('http://www.w3.org/2000/svg','feMergeNode'); mn1.setAttribute('in','blur');
    var mn2 = document.createElementNS('http://www.w3.org/2000/svg','feMergeNode'); mn2.setAttribute('in','SourceGraphic');
    feMerge.appendChild(mn1); feMerge.appendChild(mn2);
    filter.appendChild(feB); filter.appendChild(feMerge);
    defs.appendChild(filter);
    arkSvg.appendChild(defs);

    function el(tag, attrs) {
      var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.keys(attrs).forEach(function(k){ e.setAttribute(k, attrs[k]); });
      e.setAttribute('filter','url(#ark-glow2)');
      arkSvg.appendChild(e);
      return e;
    }

    // scaled-down version of original (180→120, 90→60)
    var ink = 'rgba(127,217,208,';
    el('path', { d: 'M10 37 Q60 49 110 37 L107 45 Q60 56 13 45 Z',
      fill: ink+'0.08)', stroke: ink+'0.9)', 'stroke-width':'1.2' });
    el('line', { x1:'15', y1:'37', x2:'105', y2:'37',
      stroke: ink+'0.4)', 'stroke-width':'0.7' });
    el('rect', { x:'41', y:'25', width:'38', height:'12',
      fill: ink+'0.06)', stroke: ink+'0.75)', 'stroke-width':'1.0', rx:'1.5' });
    el('rect', { x:'51', y:'28', width:'7', height:'5',
      fill: ink+'0.10)', stroke: ink+'0.5)', 'stroke-width':'0.6', rx:'1' });
    el('rect', { x:'62', y:'28', width:'7', height:'5',
      fill: ink+'0.10)', stroke: ink+'0.5)', 'stroke-width':'0.6', rx:'1' });
    el('line', { x1:'60', y1:'4', x2:'60', y2:'25',
      stroke: ink+'0.8)', 'stroke-width':'1.1' });
    el('line', { x1:'60', y1:'13', x2:'87', y2:'21',
      stroke: ink+'0.4)', 'stroke-width':'0.7' });
    el('path', { d: 'M60 5 Q77 14 75 24 L60 24 Z',
      fill: ink+'0.13)', stroke: ink+'0.6)', 'stroke-width':'0.9' });
    el('path', { d: 'M60 9 L60 24 L41 37 Z',
      fill: ink+'0.07)', stroke: ink+'0.35)', 'stroke-width':'0.6' });
    el('line', { x1:'60', y1:'5', x2:'13', y2:'37',
      stroke: ink+'0.2)', 'stroke-width':'0.6' });
    el('line', { x1:'60', y1:'5', x2:'105', y2:'37',
      stroke: ink+'0.2)', 'stroke-width':'0.6' });

    document.body.appendChild(arkSvg);
    updateArkColors();
  }

  function updateArkColors() {
    if (!arkSvg) return;
    var isLightNow = !document.body.classList.contains('light') ? false : true;
    // Dark: teal glow; Light: dark teal ink (#0d5c62-ish) for contrast on teal bg
    var ink = isLightNow ? 'rgba(10,75,80,' : 'rgba(127,217,208,';
    var els = arkSvg.querySelectorAll('[stroke],[fill]');
    els.forEach(function(e) {
      var replace = function(v) {
        if (!v || v === 'none') return v;
        return v.replace(/rgba\(\d+,\d+,\d+,/, ink);
      };
      var s = e.getAttribute('stroke');
      var f = e.getAttribute('fill');
      if (s && s !== 'none') e.setAttribute('stroke', replace(s));
      if (f && f !== 'none') e.setAttribute('fill',   replace(f));
    });
  }

  // Ark particle size in CSS px — keep consistent across DPR
  var AFS = window.innerWidth < 600 ? 8 : 9;  // smaller chars = more density

  // Touch/mouse repulsion field
  var arkCursorX  = -9999;
  var arkCursorY  = -9999;
  var ARK_REPEL_R = window.innerWidth < 600 ? 260 : 200;  // larger on mobile
  var ARK_REPEL_F = 0.55; // force strength

  function arkOnPointerMove(e) {
    if (!arkMode) return;
    arkCursorX = e.touches ? e.touches[0].clientX : e.clientX;
    arkCursorY = e.touches ? e.touches[0].clientY : e.clientY;
  }
  function arkOnPointerEnd() {
    arkCursorX = -9999;
    arkCursorY = -9999;
  }

  function attachArkPointer() {
    if (arkCanvas._pointerBound) return;
    arkCanvas._pointerBound = true;
    arkCanvas.addEventListener('mousemove',  arkOnPointerMove);
    arkCanvas.addEventListener('touchmove',  arkOnPointerMove, { passive: true });
    arkCanvas.addEventListener('mouseup',    arkOnPointerEnd);
    arkCanvas.addEventListener('touchend',   arkOnPointerEnd);
    arkCanvas.addEventListener('mouseleave', arkOnPointerEnd);
    arkCanvas.addEventListener('touchstart', arkOnPointerMove, { passive: true });
  }

  function openArk() {
    if (arkMode) return;
    arkMode  = true;
    arkPhase = 'falling';
    if (!arkCanvas) buildArkCanvas();
    if (!arkSvg)    buildArk();
    attachArkPointer();
    arkCanvas.style.pointerEvents = 'auto';

    var w = window.innerWidth, h = window.innerHeight;
    initWave(h);

    // Dense independent grid — not tied to rain column spacing.
    // Each cell is AFS×AFS so chars pack with no gaps.
    arkParticles = [];
    var STEP_X   = AFS;
    var STEP_Y   = AFS;
    var seaDepth = h * SEA_BASE_FRAC;
    var cols_n   = Math.ceil(w / STEP_X) + 1;
    var layers   = Math.ceil(seaDepth / STEP_Y);

    // Char pool from rain trails
    var charPool = [];
    cols.forEach(function(col) {
      col.trail.forEach(function(ch) { charPool.push(ch); });
    });
    if (charPool.length < 50) {
      for (var fi = 0; fi < 200; fi++) charPool.push(rc());
    }
    var cpLen = charPool.length;
    arkCharPool = charPool.slice();  // copy to module scope for sea-phase flicker
    arkCpLen = cpLen;

    // Grid must cover full screen width with no gaps.
    // Use ceil+1 columns, zero x-jitter, only tiny y-jitter.
    var cols_n2  = Math.ceil(w / STEP_X) + 2;
    var layers2  = Math.ceil(h * SEA_BASE_FRAC / STEP_Y) + 1;
    // Cap total for performance but never skip entire columns
    var MAX_PARTICLES = window.innerWidth < 600 ? 6000 : 12000;
    var total2 = cols_n2 * layers2;
    // Only thin out layers (not columns) to avoid side gaps
    var layerStep = total2 > MAX_PARTICLES ? Math.ceil(layers2 / Math.floor(MAX_PARTICLES / cols_n2)) : 1;

    for (var col_i = 0; col_i < cols_n2; col_i++) {
      for (var layer = 0; layer < layers2; layer += layerStep) {
        // No x-jitter — columns must reach screen edges
        var px = col_i * STEP_X;
        // Clamp to screen width so rightmost particles don't overflow and leave gaps
        if (px > w + STEP_X) continue;
        // Tiny y-jitter only, never negative restDepth
        var jy = Math.random() * STEP_Y * 0.4;
        var restDepth = layer * STEP_Y + jy;

        var depthFrac = layer / layers2;
        // Subtle color depth: surface slightly brighter, deep slightly dimmer
        // No harsh jump — gradual fade only
        var g = Math.round(195 - depthFrac * 90);
        var b = Math.round(44  - depthFrac * 18);
        var r = 0;

        // All columns fall uniformly — no random height offset per column
        // Only stagger by layer depth so deeper chars arrive slightly later
        var startY = -(layer * STEP_Y) - Math.random() * STEP_Y * 0.5 - 20;
        var initVy = 3.5 + layer * 0.06;

        arkParticles.push({
          ch:        charPool[Math.floor(Math.random() * cpLen)],
          x:         px,      // current render x (can move during sea phase)
          baseX:     px,      // home column x
          y:         startY,
          vy:        initVy,  // falling velocity (repurposed as fluid vy in sea)
          vx:        0,       // fluid velocity x
          r: r, g: g, b: b,
          alpha:     1,
          settled:   false,
          restDepth: restDepth,
          riseVy:    0,
          offsetX:   0,
          offsetY:   0,
          ph:        Math.random() * Math.PI * 2,
          phX:       Math.random() * Math.PI * 2,
          chTimer:   Math.random() * 30,
        });
      }
    }

    arkBoatX = -1; arkBoatPushVX = 0; arkBoatPushVY = 0;  // reset on open
    rainEl.style.opacity = '0';
    // Shift name/tagline up so boat doesn't overlap
    var identEl = document.getElementById('ident');
    if (identEl) {
      // Keep ident exactly where it is on the main screen — no movement
      identEl.style.top = '';
      identEl.style.transform = '';
    }
    cancelAnimationFrame(arkRaf);
    arkLoop();
    logEvent('ARK_MODE', 'open');
  }

  function closeArk() {
    if (!arkMode) return;
    arkPhase = 'rising';
    if (arkSvg) arkSvg.style.opacity = '0';
    if (arkCanvas) arkCanvas.style.pointerEvents = 'none';
    arkParticles.forEach(function(p) {
      // Shallower particles fly up faster
      var depthBoost = 1 - Math.min(1, p.restDepth / (window.innerHeight * SEA_BASE_FRAC));
      p.riseVy = -(2 + depthBoost * 7 + Math.random() * 3);
      p.settled = false;
    });
    logEvent('ARK_MODE', 'close');
  }

  function arkLoop() {
    var w = window.innerWidth, h = window.innerHeight;
    // Re-apply DPR transform every frame (canvas resize resets context state)
    arkCtx.setTransform(ARK_DPR, 0, 0, ARK_DPR, 0, 0);
    arkCtx.clearRect(0, 0, w, h);
    seaTime += 0.022;

    if (arkPhase === 'falling') {
      // Use a flat baseline during the fall — no wave yet.
      // This ensures columns land evenly across the full screen width
      // with no horizontal squeezing toward the center.
      var flatBase = h * (1 - SEA_BASE_FRAC);
      var allSettled = true;

      for (var pi = 0; pi < arkParticles.length; pi++) {
        var p = arkParticles[pi];
        if (!p.settled) {
          p.vy += 0.35;  // gentler gravity — initVy already fast
          p.y  += p.vy;
          var target = flatBase + p.restDepth;
          if (p.y >= target) {
            p.y       = target;
            p.vy      = 0;   // kill falling velocity so sea phase starts calm
            p.vx      = 0;
            p.settled = true;
          } else {
            allSettled = false;
          }
        } else {
          p.y = flatBase + p.restDepth;
        }
        // Render at locked column x — no horizontal drift during fall
        drawArkParticle(p, p.x, h);
      }

      if (allSettled && arkPhase === 'falling') {
        // Re-init wave from flat so transition to sea is seamless
        initWave(h);
        seaTime = 0;
        arkPhase = 'sea';
        if (arkSvg) arkSvg.style.opacity = '1';
      }

    } else if (arkPhase === 'sea') {
      stepWave(h);
      var cx_ = arkCursorX, cy_ = arkCursorY;
      var R   = ARK_REPEL_R, R2 = R * R, F = ARK_REPEL_F;
      var W   = window.innerWidth;
      var n   = arkParticles.length;
      var seaDepthPx = h * SEA_BASE_FRAC;
      var SURFACE_PX = AFS * 6;

      // ── Pass 1: wave target Y for each particle ──────────────────
      for (var si = 0; si < n; si++) {
        var sp = arkParticles[si];
        var wY = getWaveY(sp.x);
        var rd = sp.restDepth;
        // All particles: target = waveY + restDepth
        // Wave influence on deep particles naturally fades because
        // waveY varies only a small fraction of seaDepthPx.
        // No branching = no seam.
        sp._ty = wY + rd;
        // home X drifts back to baseX (very slowly)
        sp._tx = sp.baseX;
      }

      // ── Pass 2: SPH pressure in REST-DEPTH space ────────────────
      // KEY FIX: grid uses (sp.x, sp.restDepth) NOT (sp.x, sp.y).
      // When cursor pushes surface particles upward, their sp.y changes
      // but sp.restDepth stays the same. If grid used sp.y, pushed surface
      // particles would land in same grid cells as deep particles,
      // SPH would detect "high density" and push them apart vertically —
      // creating exactly the two-layer splitting we see.
      // Using restDepth: only same-depth particles interact. No cross-layer SPH.
      var SPH_R  = AFS * 2.2;
      var SPH_R2 = SPH_R * SPH_R;
      var SPH_K  = 0.10;
      var CELL   = Math.ceil(SPH_R) + 1;

      var grid = {};
      for (var gi = 0; gi < n; gi++) {
        var sp2 = arkParticles[gi];
        var gx = (sp2.x / CELL) | 0;
        var gy = (sp2.restDepth / CELL) | 0;   // ← restDepth, not sp.y
        var key = gx * 4096 + gy;
        if (!grid[key]) grid[key] = [];
        grid[key].push(gi);
      }

      for (var si = 0; si < n; si++) {
        var sp = arkParticles[si];
        var gx = (sp.x / CELL) | 0;
        var gy = (sp.restDepth / CELL) | 0;    // ← restDepth, not sp.y
        var fx = 0, fy = 0;
        for (var ni = -1; ni <= 1; ni++) {
          for (var nj = -1; nj <= 1; nj++) {
            var nb = grid[(gx + ni) * 4096 + (gy + nj)];
            if (!nb) continue;
            for (var nk = 0; nk < nb.length; nk++) {
              var j = nb[nk]; if (j === si) continue;
              var sj = arkParticles[j];
              // Pressure in screen X + restDepth Y space
              var ddx = sp.x - sj.x;
              var ddr = sp.restDepth - sj.restDepth;
              var d2  = ddx*ddx + ddr*ddr;
              if (d2 < SPH_R2 && d2 > 0.01) {
                var d   = Math.sqrt(d2);
                var w   = 1 - d / SPH_R;
                var prs = w * w * SPH_K;
                // Push in screen X only — don't push vertically via SPH
                // Vertical position is controlled by wave+spring, not pressure
                fx += (ddx / d) * prs;
              }
            }
          }
        }
        if (!sp._spraying) {
          fx += (sp._tx - sp.x) * 0.12;
          fy += (sp._ty - sp.y) * 0.028;
          sp.vx += fx;
          sp.vy += fy;
        }
      }

      // ── Pass 3: cursor repulsion + integrate + render ─────────────
      for (var si = 0; si < n; si++) {
        var sp = arkParticles[si];

        // Cursor repulsion: radial push from cursor position in screen space.
        // Use actual sp.y for distance so force is circular (not layered).
        // All particles in the radius get pushed — deep ones via depthFade.
        var seaSurfAtCursor = getWaveY(cx_);
        if (cx_ > -999 && cy_ >= seaSurfAtCursor - AFS * 2) {
          var ddx = sp.x - cx_;
          var ddy = sp.y - cy_;
          var d2_ = ddx*ddx + ddy*ddy;
          if (d2_ < R2 && d2_ > 0.01) {
            var d_    = Math.sqrt(d2_);
            var frac_ = 1 - d_ / R;
            var depthFade = 1 - Math.min(0.55, sp.restDepth / seaDepthPx);
            var mag_  = frac_ * frac_ * F * 3.0 * depthFade;
            sp.vx += (ddx / d_) * mag_;
            sp.vy += (ddy / d_) * mag_;
            // Spray: surface particles only
            if (sp.restDepth < AFS * 3 && frac_ > 0.45 && !sp._spraying) {
              sp.vy -= frac_ * frac_ * (2.0 + Math.random() * 3.0);
              sp.vx += frac_ * (Math.random() - 0.5) * 2.5;
              sp._spraying  = true;
              sp._sprayHome = sp._ty;
            }
          }
        }

        // Spray gravity — particles arc up then fall back
        if (sp._spraying) {
          sp.vy += 0.32 + (sp.ph % 0.12);
          // Use captured home Y so landing point doesn't drift
          var homeY = sp._sprayHome || sp._ty;
          if (sp.y > homeY) {
            sp._spraying = false;
            sp._sprayHome = 0;
            sp.vy *= 0.2;   // dampen on landing
            sp.vx *= 0.4;
            sp.y = homeY;   // snap back to surface
          }
        }

        // Damping — fluid friction (0.92 = flows a bit before stopping)
        sp.vx *= 0.92;
        sp.vy *= 0.92;

        // Clamp velocity — X much tighter than Y to prevent column crossing
        var vmaxX = AFS * 0.4;
        var vmaxY = AFS * 1.0;
        if (sp.vx >  vmaxX) sp.vx =  vmaxX;
        if (sp.vx < -vmaxX) sp.vx = -vmaxX;
        if (sp.vy >  vmaxY) sp.vy =  vmaxY;
        if (sp.vy < -vmaxY) sp.vy = -vmaxY;

        // Integrate position
        sp.x += sp.vx;
        sp.y += sp.vy;

        // Clamp x to screen (particles don't leave canvas)
        if (sp.x < 0)  sp.x = 0;
        if (sp.x > W)  sp.x = W;

        // Gentle phase shimmer on top of physics
        sp.ph  += 0.028;
        sp.phX += 0.021;
        var df0 = sp.restDepth / (seaDepthPx * 0.7 + 1);
        if (df0 > 1) df0 = 1;
        var shimAmp = AFS * 0.22 * (1 - df0 * 0.85);
        var shimY   = shimAmp * Math.sin(sp.ph);
        var shimX   = shimAmp * 0.4 * Math.sin(sp.phX);

        // Character flicker
        sp.chTimer -= 1;
        if (sp.chTimer <= 0) {
          sp.ch = arkCharPool[(Math.random() * arkCpLen) | 0] || sp.ch;
          sp.chTimer = 12 + df0 * 45 + Math.random() * 8;
        }

        var rx_ = sp.x + shimX;
        if (rx_ >= 0 && rx_ <= W + AFS) drawArkParticle(sp, rx_, h);
      }
      positionArk(h);

    } else if (arkPhase === 'rising') {
      var anyVisible = false;
      for (var ri = 0; ri < arkParticles.length; ri++) {
        var rp = arkParticles[ri];
        rp.riseVy -= 0.18;
        rp.y      += rp.riseVy;
        rp.alpha   = Math.max(0, Math.min(1, rp.y / (h * 0.5)));
        if (rp.y > -AFS * 3) anyVisible = true;
        drawArkParticle(rp, h);
      }
      if (!anyVisible) {
        arkMode  = false;
        arkPhase = 'idle';
        cancelAnimationFrame(arkRaf);
        arkCtx.clearRect(0, 0, w, h);
        rainEl.style.opacity = rainOn ? '1' : '0';
        var _ident = document.getElementById('ident');
        if (_ident) {
          _ident.style.top = '';
          _ident.style.transform = '';
        }
        cols = cols.map(function(){ return makeCol(h, true); });
        return;
      }
    }

    arkRaf = requestAnimationFrame(arkLoop);
  }

  function drawArkParticle(p, renderX, screenH) {
    // Support old 2-arg calls (falling/rising phases)
    if (typeof renderX === 'number' && typeof screenH === 'undefined') {
      screenH = renderX; renderX = p.x;
    }
    if (p.y < -AFS * 2 || p.y > screenH + AFS) return;
    var alpha = (p.alpha !== undefined ? p.alpha : 1);
    if (alpha <= 0) return;

    // Alpha based on restDepth (logical depth in sea), not screen Y.
    // Using p.y caused a sharp brightness seam because surface particles
    // move above flatBaseY (depth<0 → alpha>1 = bright) while deep ones
    // stay below (alpha fades) — creating a visible two-tone layering effect.
    // restDepth is stable and wave-independent, so alpha is smooth.
    var flatBaseY = screenH * (1 - SEA_BASE_FRAC);
    var seaDepthTotal = screenH * SEA_BASE_FRAC;
    // Use restDepth for alpha so wave motion doesn't create brightness seam
    var rd = (p.restDepth !== undefined) ? p.restDepth : Math.max(0, p.y - flatBaseY);
    var depthAlpha = Math.max(0.25, 1 - (rd / seaDepthTotal) * 0.55);
    // Keep 'depth' var for glow/color code below (uses screen position)
    var depth = p.y - flatBaseY;
    var shimmer = 0.82 + 0.18 * Math.sin(seaTime * 2.8 + p.x * 0.05 + p.y * 0.03);
    var finalAlpha = (alpha * depthAlpha).toFixed(3);

    var fr, fg, fb;
    if (isDark) {
      fr = p.r;
      fg = Math.min(255, Math.round(p.g * shimmer));
      fb = p.b;
    } else {
      // Light: surface chars = bright near-white (like screen-blend rain),
      // deep chars fade toward teal bg colour so they "submerge" naturally.
      // depth<=0 means at/above surface (brightest). depth>0 means below.
      var depthFrac = Math.max(0, Math.min(1, depth / (screenH * SEA_BASE_FRAC)));
      var bright = shimmer * (1 - depthFrac * 0.72);
      fr = Math.round(200 * bright);
      fg = Math.round(252 * bright);
      fb = Math.round(235 * bright);
    }

    arkCtx.font = AFS + "px 'Courier Prime','Courier New',monospace";
    arkCtx.textBaseline = 'middle';
    arkCtx.fillStyle = 'rgba(' + fr + ',' + fg + ',' + fb + ',' + finalAlpha + ')';
    if (depth < AFS) {
      arkCtx.shadowColor = isDark ? 'rgba(60,240,140,0.45)' : 'rgba(1,32,40,0.25)';
      arkCtx.shadowBlur  = 4;
    }
    arkCtx.fillText(p.ch, renderX, p.y);
    arkCtx.shadowBlur = 0;
  }

  // Boat physics — position + angular dynamics
  var arkBoatY      = 0;
  var arkBoatVY     = 0;    // vertical velocity (spring to wave)
  var arkBoatTilt   = 0;    // current angle in degrees
  var arkBoatOmega  = 0;    // angular velocity (deg/frame)
  var arkBoatX      = -1;
  var arkBoatPushVX = 0;
  var arkBoatPushVY = 0;

  // Sample the actual SPH particle surface under a given x position.
  // Returns the minimum (topmost) particle Y in a horizontal band,
  // which represents the true water surface as felt by the boat hull.
  function sampleParticleSurface(px, bandW) {
    var best = -1;
    var SURFACE_LAYERS = AFS * 5; // only consider near-surface particles
    for (var _i = 0; _i < arkParticles.length; _i++) {
      var _p = arkParticles[_i];
      if (Math.abs(_p.x - px) < bandW && _p.restDepth < SURFACE_LAYERS) {
        if (best < 0 || _p.y < best) best = _p.y;
      }
    }
    // Fallback to sine wave if no particles found nearby
    return best > 0 ? best : getWaveY(px);
  }

  function positionArk(screenH) {
    if (!arkSvg) return;
    var w     = window.innerWidth;
    var boatW = w < 600 ? 80 : 120;
    var boatH = w < 600 ? 40 : 60;

    if (arkBoatX < 0) arkBoatX = w / 2;

    // ── Cursor push ───────────────────────────────────────────
    if (arkCursorX > -999) {
      var PUSH_R = 180;
      var dx_cur = arkCursorX - arkBoatX;
      var dy_cur = arkCursorY - arkBoatY;
      var dist_cur = Math.sqrt(dx_cur*dx_cur + dy_cur*dy_cur);
      if (dist_cur < PUSH_R && dist_cur > 2) {
        var pushFrac = Math.pow(1 - dist_cur / PUSH_R, 1.5);
        arkBoatPushVX -= (dx_cur / dist_cur) * pushFrac * 1.2;
        arkBoatPushVY -= (dy_cur / dist_cur) * pushFrac * 2.5;
      }
    }
    arkBoatPushVX *= 0.92;
    arkBoatPushVY *= 0.92;
    arkBoatPushVX = Math.max(-5, Math.min(5, arkBoatPushVX));
    arkBoatPushVY = Math.max(-18, Math.min(18, arkBoatPushVY));
    arkBoatX += arkBoatPushVX;

    var halfBoat = boatW / 2;
    var margin   = halfBoat + 8;
    if (arkBoatX < margin)     { arkBoatX = margin;     arkBoatPushVX *= -0.3; }
    if (arkBoatX > w - margin) { arkBoatX = w - margin; arkBoatPushVX *= -0.3; }

    var cx   = arkBoatX;
    // Sample band width — about 1/3 of boat width
    var band = Math.max(AFS * 2, boatW * 0.18);
    var span = boatW * 0.38;

    // ── Sample ACTUAL particle surface under hull (5 points) ──
    // This reflects SPH physics — when particles are pushed up by
    // cursor, boat rises with them naturally.
    var s0 = sampleParticleSurface(cx - span * 2, band);
    var s1 = sampleParticleSurface(cx - span,     band);
    var s2 = sampleParticleSurface(cx,            band);
    var s3 = sampleParticleSurface(cx + span,     band);
    var s4 = sampleParticleSurface(cx + span * 2, band);
    var surfaceTarget = s0*0.1 + s1*0.2 + s2*0.4 + s3*0.2 + s4*0.1;

    // ── Wave torque from particle surface slope ────────────────
    var slopeAngle = Math.atan2(s4 - s0, span * 4) * 180 / Math.PI;
    var WAVETORQ   = 0.10;
    var RIGHTING   = 0.020;
    var ANGDAMP    = 0.85;
    var torque     = (slopeAngle - arkBoatTilt) * WAVETORQ
                   - arkBoatTilt * RIGHTING;
    arkBoatOmega  += torque;
    arkBoatOmega  *= ANGDAMP;
    arkBoatTilt   += arkBoatOmega;
    arkBoatTilt    = Math.max(-35, Math.min(35, arkBoatTilt));

    // ── Vertical spring to particle surface ───────────────────
    var targetY  = surfaceTarget + arkBoatPushVY * 2;
    var springF  = (targetY - arkBoatY) * 0.22;
    arkBoatVY   += springF;
    arkBoatVY   *= 0.78;
    arkBoatY    += arkBoatVY;
    // Clamp: boat can go well above wave surface (launch effect)
    if (arkBoatY > screenH) arkBoatY = screenH;

    var clampedLeft = Math.max(halfBoat, Math.min(w - halfBoat, cx - halfBoat));
    arkSvg.style.width     = boatW + 'px';
    arkSvg.style.height    = boatH + 'px';
    arkSvg.style.top       = (arkBoatY - boatH * 0.95) + 'px';
    arkSvg.style.left      = clampedLeft + 'px';
    arkSvg.style.transform = 'rotate(' + arkBoatTilt.toFixed(2) + 'deg)';
  }


  /* ════════════════════════════════════════════════
     KEYBOARD SHORTCUTS
  ════════════════════════════════════════════════ */
  document.addEventListener("keydown", function(e) {
    // Don't fire if typing in inputs
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
      if (e.key === "Escape") { closeTerminal(); closeCapsule(); }
      return;
    }
    // Typewriter mode captures all keys except Escape
    if (twActive) {
      if (e.key === "Escape") closeTypewriter();
      return;
    }
    var k = e.key.toLowerCase();
    if (k === "k" || (e.metaKey && k === "k") || (e.ctrlKey && k === "k")) {
      e.preventDefault(); termOpen ? closeTerminal() : openTerminal();
    }
    else if (k === "escape") { closeTerminal(); closeCapsule(); closeProjects(); }
    else if (k === "p") { projOpen ? closeProjects() : openProjects(); }
    else if (k === "t") { setTheme(!isDark); }
    else if (k === "r") {
      rainOn = !rainOn;
      rainEl.style.opacity = rainOn ? "1" : "0";
      if (ctrlRain) ctrlRain.classList.toggle("is-off", !rainOn);
    }
    else if (k === "s") {
      speedIdx = (speedIdx + 1) % 3;
      if (ctrlSpeed) ctrlSpeed.title = "雨速: " + SPEED_LABELS[speedIdx] + " [S]";
      var h = window.innerHeight;
      cols = cols.map(function(){ return makeCol(h, false); });
    }
    else if (k === "w") {
      rippleOn = !rippleOn;
      if (ctrlRipple) ctrlRipple.classList.toggle("is-off", !rippleOn);
    }
    else if (k === "f") {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      else document.exitFullscreen && document.exitFullscreen();
    }
    else if (k === "c" && !e.metaKey && !e.ctrlKey) {
      capsuleOverlay && !capsuleOverlay.hidden ? closeCapsule() : openCapsule();
    }
  });

  /* ════════════════════════════════════════════════
     MUSIC PLAYER
  ════════════════════════════════════════════════ */
  var TRACKS = [
    { title:"GO",                   artist:"BLACKPINK",              src:"music/BLACKPINK - GO.mp3",                         lyricsKey:"go" },
    { title:"BIRDS OF A FEATHER",   artist:"Billie Eilish",          src:"music/Billie Eilish - BIRDS OF A FEATHER.mp3",     lyricsKey:"birds" },
    { title:"Beetlebum",            artist:"Blur",                   src:"music/Blur - Beetlebum (2012 Remaster).mp3",     lyricsKey:"beetlebum" },
    { title:"Girls & Boys",         artist:"Blur",                   src:"music/Blur - Girls & Boys (2012 Remaster).mp3",    lyricsKey:"girlsandboys" },
    { title:"Song 2",               artist:"Blur",                   src:"music/Blur - Song 2 (2012 Remaster).mp3",          lyricsKey:"song2" },
    { title:"Best Part",            artist:"Daniel Caesar / H.E.R.", src:"music/Daniel Caesar; H.E.R. - Best Part.mp3",      lyricsKey:"bestpart" },
    { title:"Oblivion",             artist:"Grimes",                 src:"music/Grimes - Oblivion.mp3",                      lyricsKey:"oblivion" },
    { title:"REALiTi",              artist:"Grimes",                 src:"music/Grimes - Realiti.mp3",                       lyricsKey:"realiti" },
    { title:"Episode 33",           artist:"She Her Her Hers",       src:"music/She Her Her Hers - Episode 33.mp3",          lyricsKey:"episode33" },
    { title:"About You",            artist:"The 1975",               src:"music/The 1975 - About You.mp3",                   lyricsKey:"aboutyou" },
    { title:"How Can I Make It OK?",artist:"Wolf Alice",             src:"music/Wolf Alice - How Can I Make It OK_.mp3",     lyricsKey:"makeok" },
    { title:"Lipstick On The Glass",artist:"Wolf Alice",             src:"music/Wolf Alice - Lipstick On The Glass.mp3",     lyricsKey:"lipstick" },
    { title:"Different",            artist:"WINNER",                 src:"music/WINNER - Different.mp3" },
    { title:"FOOL",                 artist:"WINNER",                 src:"music/WINNER - FOOL.mp3" },
    { title:"SENTIMENTAL",          artist:"WINNER",                 src:"music/WINNER - SENTIMENTAL.mp3" },
  ];

  var audio = new Audio(), curIdx = -1, vizT = null;
  // ── Mobile fixes: player pill + ident true centre ────────────────
  (function(){
    var s = document.createElement('style');
    // Player: floating pill
    // Ident: use svh (small viewport height = excludes browser chrome) so
    // top:50svh is the true visual centre on mobile Safari/Chrome.
    // Falls back to 50% on browsers without svh support (no change there).
    s.textContent = [
      '@media(max-width:600px){',
      '  .player{left:50%!important;right:auto!important;',
      '    transform:translateX(-50%)!important;',
      '    width:min(88vw,340px)!important;',
      '    border-radius:12px!important;bottom:12px!important;}',
      '  .player.is-open{transform:translateX(-50%)!important;}',
      '  .ident{top:50svh!important;top:50dvh!important;}',
      '}'
    ].join('');
    document.head.appendChild(s);
  })();

  var playerEl   = document.getElementById("player");
  var playerBar  = document.getElementById("player-bar");
  var titleElP   = document.getElementById("player-title");
  var artistElP  = document.getElementById("player-artist");
  var playBtn    = document.getElementById("player-play");
  var prevBtn    = document.getElementById("player-prev");
  var nextBtn    = document.getElementById("player-next");
  var expandBtn  = document.getElementById("player-expand");
  var panelEl    = document.getElementById("player-panel");
  var seekEl     = document.getElementById("player-seek");
  var seekFill   = document.getElementById("player-seek-fill");
  var seekHead   = document.getElementById("player-seek-head");
  var curElP     = document.getElementById("player-cur");
  var totElP     = document.getElementById("player-tot");
  var volSlider  = document.getElementById("player-vol");
  var volVal     = document.getElementById("player-vol-val");
  var tracklistEl= document.getElementById("player-tracklist");
  var vizEl      = document.getElementById("player-viz");

  function fmt(s) {
    if (!isFinite(s)||s<0) return "0:00";
    return Math.floor(s/60)+":"+(Math.floor(s%60)<10?"0":"")+Math.floor(s%60);
  }

  TRACKS.forEach(function(t, i) {
    var btn = document.createElement("button");
    btn.type="button"; btn.className="player-track"; btn.dataset.idx=i;
    btn.innerHTML = '<span class="track-num">'+String(i+1).padStart(2,"0")+'</span>'
      +'<span class="track-name">'+t.title+'</span>'
      +'<span class="track-dur" id="pdur-'+i+'">—:——</span>';
    btn.addEventListener("click", function(){ loadTrack(i, true); });
    if (tracklistEl) tracklistEl.appendChild(btn);
  });

  function highlight() {
    document.querySelectorAll(".player-track").forEach(function(r){
      r.classList.toggle("is-current", parseInt(r.dataset.idx) === curIdx);
    });
  }

  function loadTrack(idx, play) {
    curIdx = ((idx % TRACKS.length) + TRACKS.length) % TRACKS.length;
    var t = TRACKS[curIdx];
    audio.src = t.src; audio.load();
    if (titleElP) titleElP.textContent  = t.title;
    if (artistElP) artistElP.textContent = t.artist;
    if (curElP) curElP.textContent = "0:00";
    if (totElP) totElP.textContent = "0:00";
    if (seekFill) seekFill.style.width = "0%";
    if (seekHead) seekHead.style.left  = "0%";
    highlight();
    if (play) audio.play().catch(function(){});
  }

  function setPlayUI(playing) {
    if (playBtn) {
      var pi = playBtn.querySelector(".play-icon");
      var pa = playBtn.querySelector(".pause-icon");
      if (pi) pi.style.display = playing ? "none" : "";
      if (pa) pa.style.display = playing ? "" : "none";
    }
    if (playerEl) playerEl.classList.toggle("is-playing", playing);
    if (playing) {
      if (!vizT) vizT = setInterval(function(){
        if (!vizEl) return;
        vizEl.querySelectorAll("span").forEach(function(s){
          s.style.transform = "scaleY("+(0.12+Math.random()*.88).toFixed(2)+")";
        });
      }, 85);
    } else {
      clearInterval(vizT); vizT = null;
      if (vizEl) vizEl.querySelectorAll("span").forEach(function(s){ s.style.transform="scaleY(.2)"; });
    }
  }

  audio.addEventListener("play",  function(){
    setPlayUI(true);
    if (TRACKS[curIdx]) logEvent("MUSIC_PLAY", TRACKS[curIdx].title + " — " + TRACKS[curIdx].artist);
  });
  audio.addEventListener("pause", function(){ setPlayUI(false); });
  audio.addEventListener("ended", function(){ loadTrack(curIdx+1, true); });
  audio.addEventListener("timeupdate", function(){
    if (!isFinite(audio.duration)) return;
    var pct = audio.currentTime / audio.duration * 100;
    if (seekFill) seekFill.style.width = pct+"%";
    if (seekHead) seekHead.style.left  = pct+"%";
    if (curElP)   curElP.textContent   = fmt(audio.currentTime);
  });
  audio.addEventListener("loadedmetadata", function(){
    if (totElP) totElP.textContent = fmt(audio.duration);
    var d = document.getElementById("pdur-"+curIdx);
    if (d) d.textContent = fmt(audio.duration);
  });

  function togglePlay() {
    if (curIdx < 0) { loadTrack(0, true); return; }
    audio.paused ? audio.play().catch(function(){}) : audio.pause();
  }

  if (playBtn)   playBtn.addEventListener("click",   function(e){ e.stopPropagation(); togglePlay(); });
  if (prevBtn)   prevBtn.addEventListener("click",   function(e){ e.stopPropagation(); loadTrack(curIdx-1, !audio.paused); });
  if (nextBtn)   nextBtn.addEventListener("click",   function(e){ e.stopPropagation(); loadTrack(curIdx+1, !audio.paused); });
  if (expandBtn) expandBtn.addEventListener("click", function(e){
    e.stopPropagation();
    var open = playerEl.classList.toggle("is-open");
    expandBtn.setAttribute("aria-expanded", String(open));
    if (panelEl) panelEl.setAttribute("aria-hidden", String(!open));
  });
  /* Clicking/tapping the bar (not a control button) toggles expand */
  if (playerBar) playerBar.addEventListener("click", function(e){
    if ([playBtn,prevBtn,nextBtn,expandBtn].some(function(b){ return b&&(e.target===b||b.contains(e.target)); })) return;
    if (expandBtn) expandBtn.click();
  });

  if (volSlider) {
    audio.volume = parseFloat(volSlider.value);
    volSlider.addEventListener("input", function(){
      audio.volume = parseFloat(volSlider.value);
      if (volVal) volVal.textContent = Math.round(audio.volume*100)+"%";
    });
  }
  if (seekEl) seekEl.addEventListener("click", function(e){
    if (!isFinite(audio.duration)||!audio.duration) return;
    var rect = seekEl.getBoundingClientRect();
    audio.currentTime = Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*audio.duration;
  });

  loadTrack(0, false);

  /* Trigger entrance animation after a short delay (replaces CSS animation
     so no transform conflict can occur) */
  setTimeout(function(){ if (playerEl) playerEl.classList.add("player-ready"); }, 1100);

  /* ════════════════════════════════════════════════
     H · TYPEWRITER LYRICS — shows on ident-phrase
     Cycles through current track's lyrics while playing
  ════════════════════════════════════════════════ */
  var lyricT = null, lyricIdx = 0, lyricDeleteT = null;

  function showLyricLine(line) {
    var pe = document.getElementById("ident-phrase");
    if (!pe) return;
    // clear any pending timers
    clearTimeout(lyricT); clearTimeout(lyricDeleteT);
    // typewriter in
    pe.style.opacity = "0.7";
    pe.textContent = "";
    var i = 0;
    function typeIn() {
      if (i <= line.length) {
        pe.textContent = line.slice(0, i) + (i < line.length ? "▌" : "");
        i++;
        lyricT = setTimeout(typeIn, 38 + Math.random()*22);
      } else {
        // hold, then fade out
        lyricDeleteT = setTimeout(function() {
          pe.style.opacity = "0";
        }, 3200);
      }
    }
    typeIn();
  }

  function scheduleLyric() {
    clearTimeout(lyricT); clearTimeout(lyricDeleteT);
    if (audio.paused || curIdx < 0) return;
    var t = TRACKS[curIdx];
    var pool = t.lyricsKey && LYRICS[t.lyricsKey];
    if (!pool || !pool.length) return;
    showLyricLine(pool[lyricIdx % pool.length]);
    lyricIdx++;
    // next lyric in 7-12s
    lyricT = setTimeout(scheduleLyric, 7000 + Math.random()*5000);
  }

  audio.addEventListener("play", function() {
    initBeatAnalyser();
    lyricIdx = 0;
    lyricT = setTimeout(scheduleLyric, 1800);
  });
  audio.addEventListener("pause", function() {
    clearTimeout(lyricT); clearTimeout(lyricDeleteT);
    var pe = document.getElementById("ident-phrase");
    if (pe) pe.style.opacity = "";
  });

  /* ════════════════════════════════════════════════
     I · TERMINAL ping COMMAND
  ════════════════════════════════════════════════ */
  // Hooked in via runCmd — see patch below

  /* ════════════════════════════════════════════════
     RADIO TUNER — frequency dial → station → track
  ════════════════════════════════════════════════ */
  var radioOverlay  = document.getElementById("radio-overlay");
  var radioClose    = document.getElementById("radio-close");
  var radioFreqEl   = document.getElementById("radio-freq");
  var radioNeedle   = document.getElementById("radio-dial-needle");
  var radioTicksEl  = document.getElementById("radio-dial-ticks");
  var radioStatusEl = document.getElementById("radio-status");
  var ctrlRadio     = document.getElementById("ctrl-radio");

  var RADIO_MIN = 87.5, RADIO_MAX = 108.0, RADIO_STEP = 0.1, RADIO_LOCK = 0.05;
  var RADIO_STATIONS = TRACKS.map(function(t, i) {
    var f = RADIO_MIN + (i + 0.5) * (RADIO_MAX - RADIO_MIN) / TRACKS.length;
    return { freq: Math.round(f * 10) / 10, idx: i, title: t.title, artist: t.artist };
  });

  var radioFreq    = RADIO_STATIONS[0].freq;
  var radioOpen    = false;
  var radioLockIdx = -1;

  if (radioTicksEl) {
    RADIO_STATIONS.forEach(function(st) {
      var pct = (st.freq - RADIO_MIN) / (RADIO_MAX - RADIO_MIN) * 100;
      var tick = document.createElement("span");
      tick.className = "radio-tick";
      tick.style.left = pct + "%";
      tick.title = st.freq.toFixed(1) + " · " + st.title;
      radioTicksEl.appendChild(tick);
    });
  }

  function renderRadio() {
    if (radioFreqEl) {
      radioFreqEl.innerHTML = radioFreq.toFixed(1) + ' <span class="radio-mhz">MHz</span>';
    }
    if (radioNeedle) {
      var pct = (radioFreq - RADIO_MIN) / (RADIO_MAX - RADIO_MIN) * 100;
      radioNeedle.style.left = pct + "%";
    }
    var hit = null;
    for (var i = 0; i < RADIO_STATIONS.length; i++) {
      if (Math.abs(RADIO_STATIONS[i].freq - radioFreq) < RADIO_LOCK) { hit = RADIO_STATIONS[i]; break; }
    }
    if (hit) {
      if (radioOverlay) radioOverlay.classList.add("is-locked");
      if (radioFreqEl) radioFreqEl.classList.remove("is-static");
      if (radioStatusEl) radioStatusEl.textContent = "♪ " + hit.title + " — " + hit.artist;
      if (radioLockIdx !== hit.idx) {
        radioLockIdx = hit.idx;
        loadTrack(hit.idx, true);
        logEvent("RADIO_LOCK", radioFreq.toFixed(1) + " · " + hit.title);
      }
    } else {
      if (radioOverlay) radioOverlay.classList.remove("is-locked");
      if (radioFreqEl) radioFreqEl.classList.add("is-static");
      if (radioStatusEl) radioStatusEl.textContent = "// 信号不稳定 · 调整频率";
      radioLockIdx = -1;
    }
  }

  function radioStep(dir) {
    radioFreq = Math.round((radioFreq + dir * RADIO_STEP) * 10) / 10;
    if (radioFreq < RADIO_MIN) radioFreq = RADIO_MIN;
    if (radioFreq > RADIO_MAX) radioFreq = RADIO_MAX;
    renderRadio();
  }

  function openRadio() {
    if (!radioOverlay) return;
    radioOpen = true;
    radioOverlay.hidden = false;
    if (ctrlRadio) ctrlRadio.classList.add("is-on");
    renderRadio();
    logEvent("RADIO_OPEN", radioFreq.toFixed(1));
  }
  function closeRadio() {
    if (!radioOverlay) return;
    radioOpen = false;
    radioOverlay.hidden = true;
    if (ctrlRadio) ctrlRadio.classList.remove("is-on");
  }

  if (ctrlRadio) ctrlRadio.addEventListener("click", function() {
    radioOpen ? closeRadio() : openRadio();
  });
  if (radioClose) radioClose.addEventListener("click", closeRadio);
  if (radioOverlay) radioOverlay.addEventListener("click", function(e) {
    if (e.target === radioOverlay) closeRadio();
  });

  document.addEventListener("keydown", function(e) {
    if (!radioOpen) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.key === "ArrowLeft")  { e.preventDefault(); radioStep(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); radioStep(1); }
    else if (e.key === "Escape") { closeRadio(); }
  });

  /* ════════════════════════════════════════════════
     J · KONAMI CODE → RGB GLITCH STORM
  ════════════════════════════════════════════════ */
  var KONAMI = [38,38,40,40,37,39,37,39,66,65];
  var konamiPos = 0;
  document.addEventListener("keydown", function(e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.keyCode === KONAMI[konamiPos]) {
      konamiPos++;
      if (konamiPos === KONAMI.length) {
        konamiPos = 0;
        logEvent("KONAMI", "ghost protocol activated");
        triggerKonami();
      }
    } else {
      konamiPos = (e.keyCode === KONAMI[0]) ? 1 : 0;
    }
  });

  function triggerKonami() {
    logEvent("KONAMI", "ghost protocol activated");

    // ── Phase 1 (0ms): Shockwave flash ──────────────────────────────
    function shockFlash(color, opacity, dur) {
      var f = document.createElement("div");
      f.style.cssText = "position:fixed;inset:0;z-index:9998;pointer-events:none;opacity:0;transition:opacity " + dur + "ms";
      f.style.background = color;
      document.body.appendChild(f);
      setTimeout(function(){ f.style.opacity = String(opacity); }, 10);
      setTimeout(function(){ f.style.opacity = "0"; }, dur * 2); 
      setTimeout(function(){ f.remove(); }, dur * 3 + 200);
    }
    shockFlash("rgba(127,217,208,1)", 0.9, 40);
    setTimeout(function(){ shockFlash("rgba(0,0,0,1)", 0.95, 60); }, 60);
    setTimeout(function(){ shockFlash("rgba(127,217,208,1)", 0.5, 80); }, 140);

    // ── Phase 2 (200ms): Dramatic scan lines sweep down ──────────────
    setTimeout(function() {
      var scanEl = document.createElement("div");
      scanEl.style.cssText = [
        "position:fixed;inset:0;z-index:9996;pointer-events:none;overflow:hidden;",
        "background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(127,217,208,.06) 3px,rgba(127,217,208,.06) 4px);"
      ].join("");
      document.body.appendChild(scanEl);
      // Bright scan bar sweeps from top to bottom
      var bar = document.createElement("div");
      bar.style.cssText = "position:absolute;left:0;right:0;height:4px;background:rgba(127,217,208,.9);box-shadow:0 0 30px 8px rgba(127,217,208,.7);top:-4px;transition:top 1.1s cubic-bezier(.4,0,.2,1)";
      scanEl.appendChild(bar);
      setTimeout(function(){ bar.style.top = "100vh"; }, 30);
      setTimeout(function(){ scanEl.remove(); }, 1400);
    }, 200);

    // ── Phase 3 (300ms): GHOST PROTOCOL text with glitch layers ─────
    setTimeout(function() {
      var msgEl = document.createElement("div");
      msgEl.id = "konami-msg";
      msgEl.style.cssText = [
        "position:fixed;inset:0;z-index:9997;display:flex;flex-direction:column;",
        "align-items:center;justify-content:center;pointer-events:none;",
        "gap:.8rem;opacity:0;transition:opacity .2s;"
      ].join("");

      var lines = [
        { txt:"// SEQUENCE ACCEPTED · CLEARANCE MAX",     fs:"clamp(.45rem,1.4vw,.65rem)", ls:".45em",  op:".5",  delay:0    },
        { txt:"GHOST",                                    fs:"clamp(3rem,14vw,9rem)",      ls:".12em",  op:"1",   delay:80   },
        { txt:"PROTOCOL",                                 fs:"clamp(2.4rem,11vw,7rem)",    ls:".18em",  op:"1",   delay:160  },
        { txt:"ACTIVATED",                                fs:"clamp(.9rem,3vw,1.8rem)",    ls:".5em",   op:".75", delay:280  },
        { txt:"identity: qwertlexi · node: verified",    fs:"clamp(.38rem,1.1vw,.55rem)", ls:".35em",  op:".35", delay:400  },
      ];

      lines.forEach(function(l) {
        var el = document.createElement("div");
        el.style.cssText = [
          "font-family:" + (l.fs.includes("9rem") || l.fs.includes("7rem") ? "var(--disp)" : "var(--font)") + ";",
          "font-size:" + l.fs + ";font-weight:700;",
          "letter-spacing:" + l.ls + ";color:var(--accent);text-align:center;",
          "text-shadow:0 0 30px var(--accent),0 0 80px rgba(127,217,208,.5),0 0 2px #fff;",
          "opacity:0;transition:opacity .15s;",
          "margin-left:" + (l.txt.includes("PROTOCOL") ? "1.5rem" : "0") + ";"
        ].join("");
        el.textContent = l.txt;
        msgEl.appendChild(el);
        setTimeout(function(){ el.style.opacity = l.op; }, l.delay + 220);
      });

      // Glitch offset copies (R/B channels)
      var ghost1 = msgEl.cloneNode(true);
      ghost1.style.cssText += "position:absolute;left:3px;top:-2px;mix-blend-mode:screen;filter:hue-rotate(180deg);opacity:0.3;pointer-events:none;z-index:9995;";
      var ghost2 = msgEl.cloneNode(true);
      ghost2.style.cssText += "position:absolute;left:-2px;top:2px;mix-blend-mode:screen;filter:hue-rotate(90deg);opacity:0.2;pointer-events:none;z-index:9994;";

      document.body.appendChild(msgEl);
      document.body.appendChild(ghost1);
      document.body.appendChild(ghost2);
      setTimeout(function(){ msgEl.style.opacity = "1"; ghost1.style.opacity="1"; ghost2.style.opacity="1"; }, 20);

      // Jitter the offset copies
      var jitterRaf;
      function jitter() {
        var dx1 = (Math.random()-0.5)*8, dy1 = (Math.random()-0.5)*4;
        var dx2 = (Math.random()-0.5)*6, dy2 = (Math.random()-0.5)*3;
        ghost1.style.transform = "translate("+dx1+"px,"+dy1+"px)";
        ghost2.style.transform = "translate("+dx2+"px,"+dy2+"px)";
        jitterRaf = requestAnimationFrame(jitter);
      }
      jitter();

      setTimeout(function(){
        cancelAnimationFrame(jitterRaf);
        msgEl.style.opacity = "0"; ghost1.style.opacity = "0"; ghost2.style.opacity = "0";
        setTimeout(function(){ msgEl.remove(); ghost1.remove(); ghost2.remove(); }, 300);
      }, 3800);
    }, 300);

    // ── Phase 4 (0ms): Rapid glitch bursts ──────────────────────────
    var glitchEl = document.getElementById("glitch-overlay");
    var gc = 0;
    function burstGlitch() {
      if (!glitchEl || gc > 50) return;
      glitchEl.className = gc % 2 === 0 ? "active-r" : "active-b";
      setTimeout(function() { glitchEl.className = ""; }, 40 + Math.random()*30);
      gc++;
      setTimeout(burstGlitch, 45 + Math.random()*40);
    }
    burstGlitch();

    // ── Phase 5 (0ms): Rain goes berserk ────────────────────────────
    var prevSpeed = speedIdx;
    speedIdx = 2;
    var h2 = window.innerHeight;
    var extraCols = [];
    for (var ei = 0; ei < cols.length * 3; ei++) extraCols.push(makeCol(h2, true));
    cols = cols.concat(extraCols);
    rainbowMode = 800; // rainbow for ~13s

    setTimeout(function() {
      speedIdx = prevSpeed;
      initRain();
    }, 6000);

    // ── Phase 6 (500ms): Name scrambles 8x ──────────────────────────
    setTimeout(function() {
      var sc = 0;
      function doKonamiScramble() {
        if (sc++ >= 8) return;
        scrambleOut(function() {
          setTimeout(function() {
            scrambleIn(function() { setTimeout(doKonamiScramble, 80); });
          }, 30);
        });
      }
      doKonamiScramble();
    }, 500);

    // ── Phase 7 (4.5s): Impact shockwave ring ───────────────────────
    setTimeout(function() {
      var ring = document.createElement("div");
      ring.style.cssText = [
        "position:fixed;top:50%;left:50%;z-index:9996;pointer-events:none;border-radius:50%;",
        "border:2px solid rgba(127,217,208,.9);transform:translate(-50%,-50%) scale(0);",
        "width:100px;height:100px;",
        "transition:transform 1.2s cubic-bezier(.2,0,.4,1),opacity 1.2s ease;opacity:1;"
      ].join("");
      document.body.appendChild(ring);
      setTimeout(function(){
        ring.style.transform = "translate(-50%,-50%) scale(22)";
        ring.style.opacity = "0";
      }, 20);
      setTimeout(function(){ ring.remove(); }, 1400);
    }, 4500);

    termLine("// GHOST PROTOCOL ACTIVATED · identity: qwertlexi", "ok");
  }

  /* ════════════════════════════════════════════════
     CUSTOM CURSOR
  ════════════════════════════════════════════════ */
  var cursorEl = document.getElementById("cursor");
  if (cursorEl && window.matchMedia("(pointer:fine)").matches) {
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var tx = cx, ty = cy;
    var curRaf;
    // Smooth lag for ring, instant for dot
    function moveCursor() {
      cx += (tx - cx) * 0.18;
      cy += (ty - cy) * 0.18;
      cursorEl.style.transform = "translate(" + tx + "px," + ty + "px)";
      // ring trails slightly
      cursorEl.querySelector(".cursor-ring").style.transform =
        "translate(calc(-50% + " + Math.round((cx - tx) * 0.7) + "px), calc(-50% + " + Math.round((cy - ty) * 0.7) + "px))";
      curRaf = requestAnimationFrame(moveCursor);
    }
    moveCursor();

    document.addEventListener("mousemove", function(e) {
      tx = e.clientX; ty = e.clientY;
    });
    document.addEventListener("mousedown", function() {
      document.body.classList.add("cursor-click");
    });
    document.addEventListener("mouseup", function() {
      document.body.classList.remove("cursor-click");
    });
    // Hover state on interactables
    document.addEventListener("mouseover", function(e) {
      if (e.target.closest("button,a,input,textarea,[role='button'],.player-seek,.ident-name")) {
        document.body.classList.add("cursor-hover");
      }
    });
    document.addEventListener("mouseout", function(e) {
      if (e.target.closest("button,a,input,textarea,[role='button'],.player-seek,.ident-name")) {
        document.body.classList.remove("cursor-hover");
      }
    });
  }

  /* ════════════════════════════════════════════════
     GLITCH BURST — click on name triggers RGB glitch
  ════════════════════════════════════════════════ */
  var glitchOverlay = document.getElementById("glitch-overlay");
  var identNameEl   = document.querySelector(".ident-name");
  if (identNameEl && glitchOverlay) {
    identNameEl.addEventListener("click", function() {
      if (glitchOverlay.classList.contains("active-r")) return; // debounce
      // Trigger R channel glitch
      glitchOverlay.className = "active-r";
      setTimeout(function() { glitchOverlay.classList.add("active-b"); }, 40);
      setTimeout(function() {
        glitchOverlay.className = "";
        // Also trigger a fast extra scramble
        if (glitchT) cancelAnimationFrame(glitchT);
        if (typeof scrambleOut === "function") {
          scrambleOut(function() {
            setTimeout(function() {
              scrambleIn(function() {
                if (typeof doGlitch === "function") setTimeout(doGlitch, 5000);
              });
            }, 80);
          });
        }
      }, 260);
    });
  }

  /* ════════════════════════════════════════════════
     BOOT SEQUENCE
  ════════════════════════════════════════════════ */
  (function () {
    var overlay  = document.getElementById("boot-overlay");
    var linesEl  = document.getElementById("boot-lines");
    var barEl    = document.getElementById("boot-bar");
    var statusEl = document.getElementById("boot-status");
    if (!overlay) return;
    var BOOT_MSGS = [
      { t:"sy", msg:"QWERTLEXI_SYS v2.4.1 — BIOS integrity check" },
      { t:"ok", msg:"memory modules verified · entropy nominal" },
      { t:"ok", msg:"GPU · MATRIX_RAIN_ENGINE loaded" },
      { t:"sy", msg:"establishing local session…" },
      { t:"ok", msg:"signal authenticated — identity unverified" },
      { t:"er", msg:"WARNING: uplink unavailable — ghost mode active" },
      { t:"ok", msg:"identity scrambler · waveform monitor: online" },
      { t:"sy", msg:"mounting local capsule store…" },
      { t:"ok", msg:"qwl-capsule-v1 mounted · " + (function(){ try{ return JSON.parse(localStorage.getItem("qwl-capsule-v1")||"[]").length; }catch(e){ return 0; } })() + " entries" },
      { t:"ok", msg:"audio: codec PCM 44.1kHz / stereo · idle" },
      { t:"ok", msg:"all systems nominal — welcome back, qwertlexi" },
    ];
    var STATUSES = ["MEMORY CHECK…","LOADING MODULES…","HANDSHAKE…","PARSING IDENTITY…","BOOT COMPLETE"];
    var delay = 0, total = BOOT_MSGS.length;
    BOOT_MSGS.forEach(function(m, i) {
      delay += 60 + i * 40;
      (function(msg, type, at, idx) {
        setTimeout(function() {
          if (!linesEl) return;
          var el = document.createElement("span");
          el.className = "bl " + type;
          el.textContent = msg;
          linesEl.appendChild(el);
          linesEl.scrollTop = linesEl.scrollHeight;
          var pct = Math.round((idx + 1) / total * 100);
          if (barEl) barEl.style.width = pct + "%";
          if (statusEl) statusEl.textContent = STATUSES[Math.min(Math.floor(pct / 25), STATUSES.length - 1)];
        }, at);
      })(m.msg, m.t, delay, i);
    });
    setTimeout(function() {
      if (barEl) barEl.style.width = "100%";
      if (statusEl) statusEl.textContent = "BOOT COMPLETE";

      // Auto-exit: no dialogue, no "press any key" gate — just shatter out
      setTimeout(function() {
        overlay.classList.add("boot-shatter");
        setTimeout(function() {
          overlay.classList.add("hidden");
          // Auto-open terminal with welcome after entering
          window._bootWelcomeDone = true;
        }, 950);
      }, 700);
    }, 3060);
  })();

  /* ════════════════════════════════════════════════
     WAVEFORM MINI-GRAPH (top-right HUD)
  ════════════════════════════════════════════════ */
  var waveCanvas = document.getElementById("wavegraph");
  if (waveCanvas) {
    var wctx = waveCanvas.getContext("2d");
    var WAVE_W = 56, WAVE_H = 16;
    var waveSamples = [];
    for (var i = 0; i < WAVE_W; i++) waveSamples.push(0.5 + Math.sin(i * 0.4) * 0.3);

    function drawWave() {
      wctx.clearRect(0, 0, WAVE_W, WAVE_H);
      // Push new sample
      waveSamples.push(0.3 + Math.random() * 0.65);
      if (waveSamples.length > WAVE_W) waveSamples.shift();

      wctx.beginPath();
      var clr = isDark ? "rgba(127,217,208," : "rgba(1,32,40,";
      for (var j = 0; j < waveSamples.length; j++) {
        var x = j;
        var y = WAVE_H - waveSamples[j] * WAVE_H;
        j === 0 ? wctx.moveTo(x, y) : wctx.lineTo(x, y);
      }
      wctx.strokeStyle = clr + "0.7)";
      wctx.lineWidth = 1;
      wctx.stroke();

      // Filled area
      wctx.lineTo(waveSamples.length - 1, WAVE_H);
      wctx.lineTo(0, WAVE_H);
      wctx.closePath();
      wctx.fillStyle = clr + "0.12)";
      wctx.fill();
    }
    setInterval(drawWave, 120);
    drawWave();
  }

  /* ════════════════════════════════════════════════
     X · DYNAMIC PAGE TITLE
  ════════════════════════════════════════════════ */
  (function() {
    var BASE = "qwertlexi · sys";
    var IDLE_TITLES = [
      "// signal fading…",
      "// idle · silence only",
      "// where did you go",
      "// still here · waiting",
    ];
    var RETURN_TITLES = [
      "// signal restored",
      "// you came back",
      "// reconnecting…",
    ];
    var titleCycle = ["qwertlexi · sys", "qwertlexi · online", "signal from the silence", "// sys · nominal"];
    var cycleIdx = 0;

    // Slow ambient title cycling while on page
    setInterval(function() {
      if (!document.hidden) {
        cycleIdx = (cycleIdx + 1) % titleCycle.length;
        document.title = titleCycle[cycleIdx];
      }
    }, 4000);

    // Tab hidden/visible
    document.addEventListener("visibilitychange", function() {
      if (document.hidden) {
        document.title = IDLE_TITLES[Math.floor(Math.random() * IDLE_TITLES.length)];
      } else {
        var t = RETURN_TITLES[Math.floor(Math.random() * RETURN_TITLES.length)];
        document.title = t;
        setTimeout(function() { document.title = BASE; }, 2000);
      }
    });
  })();

  /* ════════════════════════════════════════════════
     IOS INPUT ZOOM PREVENTION
     iOS zooms when input font-size < 16px on focus.
     Temporarily set 16px on focus, restore on blur.
  ════════════════════════════════════════════════ */
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    document.addEventListener("focusin", function(e) {
      var el = e.target;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.dataset.origFontSize = el.style.fontSize || "";
        el.style.fontSize = "16px";
      }
    });
    document.addEventListener("focusout", function(e) {
      var el = e.target;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        el.style.fontSize = el.dataset.origFontSize || "";
        delete el.dataset.origFontSize;
      }
    });
  }

})();
