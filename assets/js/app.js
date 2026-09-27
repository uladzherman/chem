(function () {
  "use strict";

  var LS = {
    known: "chem-trainer-known-v1",
    srs: "chem-trainer-srs-v1",
    stats: "chem-trainer-stats-v1"
  };
  var KATEX_DISPLAY = { throwOnError: false, displayMode: true, strict: "ignore", trust: false };
  var KATEX_INLINE = { throwOnError: false, displayMode: false, strict: "ignore", trust: false };
  var DAY = 86400000;

  var SECTION_TITLE = {};
  window.SECTIONS.forEach(function (s) { SECTION_TITLE[s.id] = s.title; });

  // Стабильный ID карточки (не зависит от порядка карточек).
  function cardId(card) { return card.t; }
  var CARD_ENTRIES = window.CARDS.map(function (c) { return { card: c, id: cardId(c) }; });
  // Для тестов «название → формула», «формула → название» и пар «название ↔ формула»
  // используем только карточки-названия (без качественных реакций).
  var NAME_ENTRIES = CARD_ENTRIES.filter(function (e) { return e.card.kind !== "quality"; });
  var QUALITY_ENTRIES = CARD_ENTRIES.filter(function (e) { return e.card.kind === "quality"; });
  var ACID_ENTRIES = CARD_ENTRIES.filter(function (e) { return e.card.kind === "acid"; });
  var CLASS_ENTRIES = (window.CLASSES || []).map(function (c, i) { return { card: c, id: "class::" + i }; });

  function load(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* недоступно */ }
  }
  function byId(id) { return document.getElementById(id); }
  function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function wrapMath(s) { return String(s).indexOf("$") === -1 ? "$" + s + "$" : String(s); }
  var SVG_NS = "http://www.w3.org/2000/svg";

  var state = {
    mode: "cards",
    section: "all",
    shuffled: false,
    list: [],
    known: new Set(load(LS.known, [])),
    srs: load(LS.srs, {}),
    stats: load(LS.stats, {}),
    formula: { order: [], pos: 0, kind: "substance" },
    names: { order: [], pos: 0 },
    reaction: { order: [], pos: 0 },
    match: { set: [], selectedId: null, matched: {}, errors: 0, type: "name" },
    review: { queue: [] }
  };
  var statKeys = ["formulaOk", "formulaBad", "namesOk", "namesBad", "reactOk", "reactBad", "matchOk", "matchBad"];
  statKeys.forEach(function (k) { if (state.stats[k] === undefined) state.stats[k] = 0; });

  /* ---------- Рендер химии ---------- */
  function renderFormula(node, latex) {
    node.innerHTML = "";
    if (window.katex) {
      try { window.katex.render(latex, node, KATEX_DISPLAY); return; } catch (e) { /* фолбэк */ }
    }
    var code = document.createElement("code");
    code.textContent = latex;
    node.appendChild(code);
  }
  function renderMathInline(node, latex) {
    node.innerHTML = "";
    if (window.katex) {
      try { window.katex.render(latex, node, KATEX_INLINE); return; } catch (e) { /* фолбэк */ }
    }
    node.textContent = latex;
  }
  function appendRich(parent, text) {
    if (!text) return;
    String(text).split("$").forEach(function (part, i) {
      if (i % 2 === 1) {
        var span = document.createElement("span");
        renderMathInline(span, part);
        parent.appendChild(span);
      } else if (part) {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }

  /* ---------- Авто-масштаб формулы под карточку ---------- */
  function fitFormula(container) {
    var node = container.querySelector(".katex-display") || container.querySelector(".katex");
    if (!node) return;
    node.style.transform = "";
    node.style.transformOrigin = "center center";
    var availW = container.clientWidth, availH = container.clientHeight;
    if (availW <= 0 || availH <= 0) return;
    var w = node.offsetWidth || node.scrollWidth, h = node.offsetHeight || node.scrollHeight;
    if (!w || !h) return;
    var scale = Math.min(1, (availW - 6) / w, (availH - 6) / h);
    if (scale < 0.999) node.style.transform = "scale(" + scale.toFixed(4) + ")";
  }
  function fitAllWithin(root) {
    root.querySelectorAll(".formula").forEach(fitFormula);
  }

  /* ---------- Карточка ---------- */
  function createCard(entry, opts) {
    opts = opts || {};
    var card = entry.card, id = entry.id;
    var isQuality = card.kind === "quality";
    var isAcid = card.kind === "acid";

    var root = document.createElement("div");
    root.className = "card" + (state.known.has(id) ? " is-known" : "");
    root.tabIndex = 0;
    root.setAttribute("role", "button");
    root.setAttribute("aria-pressed", "false");
    root.setAttribute("aria-label", card.t);
    root.dataset.id = id;

    var inner = document.createElement("div");
    inner.className = "card__inner";

    // лицо — тривиальное название
    var front = document.createElement("div");
    front.className = "card__face card__face--front";
    var badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = SECTION_TITLE[card.s] || "";
    var title = document.createElement("p");
    title.className = "card__title";
    title.textContent = card.t;
    var hint = document.createElement("span");
    hint.className = "card__hint";
    hint.textContent = isQuality
      ? "Нажмите, чтобы увидеть реактив и признак"
      : (isAcid ? "Нажмите, чтобы увидеть кислотный остаток" : "Нажмите, чтобы увидеть формулу");
    front.appendChild(badge); front.appendChild(title); front.appendChild(hint);

    // оборот — формула + систематическое название
    var back = document.createElement("div");
    back.className = "card__face card__face--back";
    var badgeBack = document.createElement("span");
    badgeBack.className = "badge";
    badgeBack.textContent = SECTION_TITLE[card.s] || "";

    var formula = document.createElement("div");
    formula.className = "formula";
    if (card.f) renderFormula(formula, card.f);

    var meta = document.createElement("div");
    meta.className = "card__meta";
    var sys = document.createElement("p");
    sys.className = "card__sys";
    if (isAcid) appendRich(sys, "Кислотный остаток: $" + card.anion + "$");
    else sys.textContent = isQuality ? ("Реактив: " + card.reagent) : card.sys;
    meta.appendChild(sys);
    var noteText;
    if (isAcid) noteText = "Название остатка: " + card.anionName;
    else if (isQuality) noteText = "Признак: " + card.sign;
    else noteText = card.n;
    if (noteText) {
      var note = document.createElement("p");
      note.className = "card__note";
      appendRich(note, noteText);
      meta.appendChild(note);
    }

    var actions = document.createElement("div");
    actions.className = "card__actions";
    if (!opts.review) {
      var knownBtn = document.createElement("button");
      knownBtn.type = "button";
      knownBtn.className = "known-btn";
      knownBtn.textContent = state.known.has(id) ? "✓ Изучено" : "Отметить изученным";
      knownBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleKnown(id, root, knownBtn);
      });
      actions.appendChild(knownBtn);
    }

    back.appendChild(badgeBack);
    back.appendChild(formula);
    back.appendChild(meta);
    back.appendChild(actions);

    inner.appendChild(front);
    inner.appendChild(back);
    root.appendChild(inner);

    function flip() {
      var flipped = root.classList.toggle("is-flipped");
      root.setAttribute("aria-pressed", String(flipped));
      if (flipped) fitFormula(formula);
    }
    root.addEventListener("click", flip);
    root.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); flip(); }
    });

    return root;
  }

  function toggleKnown(id, root, btn) {
    if (state.known.has(id)) {
      state.known.delete(id); root.classList.remove("is-known");
      if (btn) btn.textContent = "Отметить изученным";
    } else {
      state.known.add(id); root.classList.add("is-known");
      if (btn) btn.textContent = "✓ Изучено";
    }
    save(LS.known, Array.from(state.known));
    updateProgress();
  }

  function updateProgress() {
    var total = window.CARDS.length, done = state.known.size;
    var pct = total ? Math.round((done / total) * 100) : 0;
    byId("progressFill").style.width = pct + "%";
    byId("progressLabel").textContent = done + " / " + total;
  }

  /* ---------- Режим «Карточки» ---------- */
  var gridEl = byId("grid"), emptyEl = byId("empty"), chipsEl = byId("sectionChips");

  function buildChips() {
    var frag = document.createDocumentFragment();
    function makeChip(id, title) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (state.section === id ? " is-active" : "");
      btn.textContent = title;
      btn.dataset.section = id;
      btn.addEventListener("click", function () {
        state.section = id; state.shuffled = false;
        chipsEl.querySelectorAll(".chip").forEach(function (c) {
          c.classList.toggle("is-active", c.dataset.section === id);
        });
        renderBrowse();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      return btn;
    }
    frag.appendChild(makeChip("all", "Все разделы"));
    window.SECTIONS.forEach(function (s) { frag.appendChild(makeChip(s.id, s.title)); });
    chipsEl.appendChild(frag);
  }

  function buildChipGroup(box, items, activeId, attr, onPick) {
    box.innerHTML = "";
    items.forEach(function (item) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (activeId === item.id ? " is-active" : "");
      btn.textContent = item.title;
      btn.dataset[attr] = item.id;
      btn.addEventListener("click", function () {
        box.querySelectorAll(".chip").forEach(function (c) {
          c.classList.toggle("is-active", c.dataset[attr] === item.id);
        });
        onPick(item.id);
      });
      box.appendChild(btn);
    });
  }

  function buildFormulaChips() {
    buildChipGroup(byId("formulaChips"), [
      { id: "substance", title: "Вещество → формула" },
      { id: "class", title: "Класс → общая формула" }
    ], state.formula.kind, "kind", function (id) {
      state.formula.kind = id;
      formulaNewOrder();
      formulaRender();
    });
  }

  function buildMatchTypeChips() {
    buildChipGroup(byId("matchTypeChips"), [
      { id: "name", title: "Название ↔ формула" },
      { id: "acid", title: "Кислота ↔ остаток" },
      { id: "quality", title: "Вещество ↔ реактив" }
    ], state.match.type, "type", function (id) {
      state.match.type = id;
      matchNewRound();
    });
  }

  function renderBrowse() {
    var base = CARD_ENTRIES.slice();
    state.list = state.section === "all" ? base : base.filter(function (x) { return x.card.s === state.section; });
    if (state.shuffled) shuffleArr(state.list);

    gridEl.innerHTML = "";
    if (!state.list.length) { emptyEl.hidden = false; return; }
    emptyEl.hidden = true;
    var frag = document.createDocumentFragment();
    state.list.forEach(function (entry) { frag.appendChild(createCard(entry)); });
    gridEl.appendChild(frag);
    window.requestAnimationFrame(function () { fitAllWithin(gridEl); });
  }

  /* ---------- Общее для тестов ---------- */
  function buildChoices(correctText, poolValues, count) {
    var others = poolValues.filter(function (v) { return v !== correctText; });
    shuffleArr(others);
    var out = [{ ok: true, text: correctText }];
    others.slice(0, count).forEach(function (v) { out.push({ ok: false, text: v }); });
    return shuffleArr(out);
  }

  function renderOptions(box, choices, decorate, onPick) {
    box.innerHTML = "";
    choices.forEach(function (choice) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option";
      if (choice.ok) btn.dataset.correct = "1";
      decorate(btn, choice);
      btn.addEventListener("click", function () { onPick(btn, choice); });
      box.appendChild(btn);
    });
  }

  function renderRichOptions(box, choices, onPick) {
    renderOptions(box, choices, function (btn, c) { appendRich(btn, c.text); }, onPick);
    window.requestAnimationFrame(function () { fitOptions(box); });
  }

  function fitOptions(box) {
    box.querySelectorAll(".option").forEach(function (btn) {
      var node = btn.querySelector(".katex");
      if (!node) return;
      node.style.transform = "";
      node.style.transformOrigin = "center center";
      var availW = btn.clientWidth - 14;
      var availH = btn.clientHeight - 14;
      if (availW <= 0 || availH <= 0) return;
      var w = node.offsetWidth, h = node.offsetHeight;
      if (!w || !h) return;
      var scale = Math.min(1, availW / w, availH / h);
      if (scale < 0.999) node.style.transform = "scale(" + scale.toFixed(4) + ")";
    });
  }

  function answerOption(box, btn, ok, feedbackEl, okText, badText) {
    box.querySelectorAll(".option").forEach(function (b) {
      b.disabled = true;
      if (b.dataset.correct) b.classList.add("is-correct");
    });
    if (!ok) btn.classList.add("is-wrong");
    feedbackEl.textContent = ok ? okText : badText;
    feedbackEl.className = "feedback " + (ok ? "feedback--ok" : "feedback--bad");
  }

  function resetFeedback(id) {
    byId(id).textContent = "";
    byId(id).className = "feedback";
  }

  /* ---------- Режим «Соответствие» ---------- */
  function matchPool() {
    if (state.match.type === "quality") return QUALITY_ENTRIES;
    if (state.match.type === "acid") return ACID_ENTRIES;
    return NAME_ENTRIES;
  }
  function matchLeftText(card) { return state.match.type === "quality" ? card.sub : card.t; }
  function matchRightValue(card) {
    if (state.match.type === "quality") return card.reagent;
    if (state.match.type === "acid") return card.anion;
    return card.f;
  }
  function matchRightIsText() { return state.match.type === "quality"; }

  function matchNewRound() {
    var pool = shuffleArr(matchPool().slice());
    var chosen = [], used = {};
    for (var i = 0; i < pool.length && chosen.length < 4; i++) {
      var key = matchRightValue(pool[i].card);
      if (used[key]) continue;
      used[key] = 1;
      chosen.push(pool[i]);
    }
    state.match.set = chosen;
    state.match.selectedId = null;
    state.match.matched = {};

    var namesBox = byId("matchNames"), formulasBox = byId("matchFormulas");
    namesBox.innerHTML = "";
    formulasBox.innerHTML = "";
    byId("matchNext").disabled = true;
    resetFeedback("matchFeedback");
    var hints = {
      quality: "Соедините вещество слева с реактивом для его качественного определения справа.",
      acid: "Соедините кислоту слева с её кислотным остатком справа.",
      name: "Соедините тривиальное название слева с его формулой справа."
    };
    byId("matchHint").textContent = hints[state.match.type] || hints.name;

    var leftOrder = shuffleArr(chosen.slice());
    var rightOrder = shuffleArr(chosen.slice());

    leftOrder.forEach(function (entry) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "match-item";
      btn.dataset.id = entry.id;
      btn.textContent = matchLeftText(entry.card);
      btn.addEventListener("click", function () { matchSelectName(btn); });
      namesBox.appendChild(btn);
    });
    rightOrder.forEach(function (entry) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "match-item";
      btn.dataset.id = entry.id;
      if (matchRightIsText()) btn.textContent = matchRightValue(entry.card);
      else renderMathInline(btn, matchRightValue(entry.card));
      btn.addEventListener("click", function () { matchPickFormula(btn); });
      formulasBox.appendChild(btn);
    });
    matchMeta();
    window.requestAnimationFrame(drawMatchLines);
  }

  function matchNameBtn(id) {
    var found = null;
    byId("matchNames").querySelectorAll(".match-item").forEach(function (b) {
      if (b.dataset.id === id) found = b;
    });
    return found;
  }
  function matchFormulaBtn(id) {
    var found = null;
    byId("matchFormulas").querySelectorAll(".match-item").forEach(function (b) {
      if (b.dataset.id === id) found = b;
    });
    return found;
  }

  // Линии-стрелки между соединёнными плитками.
  function drawMatchLines() {
    var svg = byId("matchLines"), wrap = svg && svg.parentNode;
    if (!svg || !wrap) return;
    var wrect = wrap.getBoundingClientRect();
    if (!wrect.width || !wrect.height) { svg.innerHTML = ""; return; }
    svg.setAttribute("viewBox", "0 0 " + wrect.width + " " + wrect.height);
    svg.innerHTML = "";

    var defs = document.createElementNS(SVG_NS, "defs");
    var marker = document.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", "matchArrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    var tip = document.createElementNS(SVG_NS, "path");
    tip.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    tip.setAttribute("class", "match__arrow");
    marker.appendChild(tip);
    defs.appendChild(marker);
    svg.appendChild(defs);

    Object.keys(state.match.matched).forEach(function (id) {
      var n = matchNameBtn(id), f = matchFormulaBtn(id);
      if (!n || !f) return;
      var nr = n.getBoundingClientRect(), fr = f.getBoundingClientRect();
      var x1 = nr.right - wrect.left, y1 = nr.top + nr.height / 2 - wrect.top;
      var x2 = fr.left - wrect.left, y2 = fr.top + fr.height / 2 - wrect.top;
      var mid = (x1 + x2) / 2;
      var path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", "M " + x1 + " " + y1 +
        " C " + mid + " " + y1 + ", " + mid + " " + y2 + ", " + x2 + " " + y2);
      path.setAttribute("class", "match__line");
      path.setAttribute("marker-end", "url(#matchArrow)");
      svg.appendChild(path);
    });
  }

  function matchSelectName(btn) {
    if (btn.disabled) return;
    byId("matchNames").querySelectorAll(".match-item").forEach(function (b) {
      b.classList.remove("is-selected");
    });
    btn.classList.add("is-selected");
    state.match.selectedId = btn.dataset.id;
    resetFeedback("matchFeedback");
  }

  function matchPickFormula(btn) {
    if (btn.disabled) return;
    if (!state.match.selectedId) {
      byId("matchFeedback").textContent = "Сначала выберите элемент слева.";
      byId("matchFeedback").className = "feedback feedback--info";
      return;
    }
    var id = btn.dataset.id;
    var nameBtn = matchNameBtn(state.match.selectedId);

    if (id === state.match.selectedId) {
      state.match.matched[id] = true;
      if (nameBtn) { nameBtn.classList.remove("is-selected"); nameBtn.classList.add("is-matched"); nameBtn.disabled = true; }
      btn.classList.add("is-matched");
      btn.disabled = true;
      state.match.selectedId = null;
      if (Object.keys(state.match.matched).length === state.match.set.length) {
        state.stats.matchOk++;
        save(LS.stats, state.stats);
        byId("matchNext").disabled = false;
        byId("matchFeedback").textContent = "Раунд собран!";
        byId("matchFeedback").className = "feedback feedback--ok";
      }
      matchMeta();
      window.requestAnimationFrame(drawMatchLines);
    } else {
      state.stats.matchBad++;
      save(LS.stats, state.stats);
      var wrongBtn = btn;
      if (nameBtn) nameBtn.classList.add("is-wrong");
      wrongBtn.classList.add("is-wrong");
      state.match.selectedId = null;
      matchMeta();
      window.setTimeout(function () {
        if (nameBtn) nameBtn.classList.remove("is-wrong", "is-selected");
        wrongBtn.classList.remove("is-wrong");
      }, 550);
    }
  }

  function matchMeta() {
    var s = state.stats;
    byId("matchMeta").textContent = "Собрано пар " + s.matchOk + " · Ошибок " + s.matchBad;
    byId("matchReset").disabled = (s.matchOk + s.matchBad) === 0;
  }

  /* ---------- Режим «Формулы» (вещество → формула / класс → общая формула) ---------- */
  var allNames = NAME_ENTRIES.map(function (e) { return e.card.t; });

  function formulaSource() { return state.formula.kind === "class" ? CLASS_ENTRIES : NAME_ENTRIES; }

  function formulaNewOrder() {
    state.formula.order = shuffleArr(formulaSource().map(function (_, i) { return i; }));
    state.formula.pos = 0;
  }
  function formulaDistractors(entry) {
    var source = formulaSource();
    var correct = wrapMath(entry.card.f);
    var res = [];
    function push(f) {
      f = wrapMath(f);
      if (f !== correct && res.indexOf(f) === -1 && res.length < 3) res.push(f);
    }
    var same = shuffleArr(source.filter(function (e) {
      return e.card.s === entry.card.s && e.card.f !== entry.card.f;
    }));
    same.forEach(function (e) { if (res.length < 3) push(e.card.f); });
    shuffleArr(source.map(function (e) { return wrapMath(e.card.f); }))
      .forEach(function (f) { if (res.length < 3) push(f); });
    return res;
  }
  function formulaRender() {
    if (!state.formula.order.length) formulaNewOrder();
    var source = formulaSource();
    var entry = source[state.formula.order[state.formula.pos % state.formula.order.length]];
    state.formula.answered = false;

    var isClass = state.formula.kind === "class";
    byId("formulaPrompt").textContent = isClass
      ? "Какая общая формула соответствует классу соединений:"
      : "Какая формула соответствует веществу:";
    byId("formulaSection").textContent = isClass
      ? "Классы органических соединений"
      : (SECTION_TITLE[entry.card.s] || "");
    byId("formulaName").textContent = entry.card.t;
    resetFeedback("formulaFeedback");
    formulaMeta();

    renderRichOptions(byId("formulaOptions"),
      buildChoices(wrapMath(entry.card.f), formulaDistractors(entry), 3),
      function (btn, c) { formulaAnswer(btn, c.ok); });
  }
  function formulaMeta() {
    var s = state.stats, total = formulaSource().length;
    byId("formulaMeta").textContent = "Задача " + (state.formula.pos + 1) + " из " + total +
      " · Верно " + s.formulaOk + " · Ошибок " + s.formulaBad;
    byId("formulaReset").disabled = (s.formulaOk + s.formulaBad) === 0;
  }
  function formulaAnswer(btn, ok) {
    if (state.formula.answered) return;
    state.formula.answered = true;
    state.stats[ok ? "formulaOk" : "formulaBad"]++;
    save(LS.stats, state.stats);
    answerOption(byId("formulaOptions"), btn, ok, byId("formulaFeedback"), "Верно!",
      "Неверно — верный вариант выделен.");
    formulaMeta();
  }
  function formulaNext() {
    state.formula.pos++;
    if (state.formula.pos >= state.formula.order.length) formulaNewOrder();
    formulaRender();
  }

  /* ---------- Режим «Названия» (формула → название) ---------- */
  function namesNewOrder() {
    state.names.order = shuffleArr(NAME_ENTRIES.map(function (_, i) { return i; }));
    state.names.pos = 0;
  }
  function namesDistractors(card) {
    var same = NAME_ENTRIES.filter(function (e) { return e.card.s === card.s && e.card.t !== card.t; });
    shuffleArr(same);
    var res = [];
    for (var i = 0; i < same.length && res.length < 3; i++) {
      if (res.indexOf(same[i].card.t) === -1) res.push(same[i].card.t);
    }
    var all = shuffleArr(allNames.slice());
    for (var j = 0; j < all.length && res.length < 3; j++) {
      if (all[j] !== card.t && res.indexOf(all[j]) === -1) res.push(all[j]);
    }
    return res;
  }
  function namesRender() {
    if (!state.names.order.length) namesNewOrder();
    var entry = NAME_ENTRIES[state.names.order[state.names.pos % state.names.order.length]];
    state.names.answered = false;

    byId("namesSection").textContent = SECTION_TITLE[entry.card.s] || "";
    renderMathInline(byId("namesFormula"), entry.card.f);
    resetFeedback("namesFeedback");
    namesMeta();

    // Одна формула может иметь несколько верных названий (например, $\\ce{H2S}$ —
    // сероводород и сероводородная кислота). Исключаем их из дистракторов.
    var valid = NAME_ENTRIES
      .filter(function (e) { return e.card.f === entry.card.f; })
      .map(function (e) { return e.card.t; });
    var distractors = namesDistractors(entry.card).filter(function (n) {
      return valid.indexOf(n) === -1;
    });
    renderRichOptions(byId("namesOptions"),
      buildChoices(entry.card.t, distractors, 3),
      function (btn, c) { namesAnswer(btn, c.ok); });
  }
  function namesMeta() {
    var s = state.stats, total = NAME_ENTRIES.length;
    byId("namesMeta").textContent = "Задача " + (state.names.pos + 1) + " из " + total +
      " · Верно " + s.namesOk + " · Ошибок " + s.namesBad;
    byId("namesReset").disabled = (s.namesOk + s.namesBad) === 0;
  }
  function namesAnswer(btn, ok) {
    if (state.names.answered) return;
    state.names.answered = true;
    state.stats[ok ? "namesOk" : "namesBad"]++;
    save(LS.stats, state.stats);
    answerOption(byId("namesOptions"), btn, ok, byId("namesFeedback"), "Верно!",
      "Неверно — верный вариант выделен.");
    namesMeta();
  }
  function namesNext() {
    state.names.pos++;
    if (state.names.pos >= state.names.order.length) namesNewOrder();
    namesRender();
  }

  /* ---------- Режим «Реакции» ---------- */
  function reactionNewOrder() {
    state.reaction.order = shuffleArr(window.REACTIONS.map(function (_, i) { return i; }));
    state.reaction.pos = 0;
  }
  function reactionRender() {
    if (!state.reaction.order.length) reactionNewOrder();
    var task = window.REACTIONS[state.reaction.order[state.reaction.pos % state.reaction.order.length]];
    state.reaction.answered = false;

    var body = byId("reactionBody");
    body.innerHTML = "";
    appendRich(body, task.q);
    var caption = byId("reactionCaption");
    caption.textContent = task.hint || "";
    caption.hidden = !task.hint;
    resetFeedback("reactionFeedback");
    reactionMeta();

    renderRichOptions(byId("reactionOptions"),
      shuffleArr([{ ok: true, text: task.a }].concat(task.wrong.map(function (w) { return { ok: false, text: w }; }))),
      function (btn, c) { reactionAnswer(btn, c.ok); });
  }
  function reactionMeta() {
    var s = state.stats, total = window.REACTIONS.length;
    byId("reactionMeta").textContent = "Задача " + (state.reaction.pos + 1) + " из " + total +
      " · Верно " + s.reactOk + " · Ошибок " + s.reactBad;
    byId("reactionReset").disabled = (s.reactOk + s.reactBad) === 0;
  }
  function reactionAnswer(btn, ok) {
    if (state.reaction.answered) return;
    state.reaction.answered = true;
    state.stats[ok ? "reactOk" : "reactBad"]++;
    save(LS.stats, state.stats);
    answerOption(byId("reactionOptions"), btn, ok, byId("reactionFeedback"), "Верно!",
      "Неверно — верный вариант выделен.");
    reactionMeta();
  }
  function reactionNext() {
    state.reaction.pos++;
    if (state.reaction.pos >= state.reaction.order.length) reactionNewOrder();
    reactionRender();
  }

  /* ---------- Режим «Повторение» (SRS, SM-2 lite) ---------- */
  function dueEntries() {
    var now = Date.now();
    return CARD_ENTRIES
      .filter(function (e) {
        var st = state.srs[e.id];
        return !st || st.due <= now;
      })
      .sort(function (a, b) {
        var da = state.srs[a.id] ? state.srs[a.id].due : 0;
        var db = state.srs[b.id] ? state.srs[b.id].due : 0;
        return da - db;
      });
  }
  function dueCount() {
    var now = Date.now();
    return CARD_ENTRIES.reduce(function (n, e) {
      var st = state.srs[e.id];
      return n + (!st || st.due <= now ? 1 : 0);
    }, 0);
  }
  function updateDueBadge() { byId("dueCount").textContent = dueCount(); }

  function schedule(id, grade) {
    var st = state.srs[id] || { ease: 2.5, interval: 0, reps: 0, due: 0 };
    var ease = st.ease, interval = st.interval, reps = st.reps;
    if (grade === "hard") {
      ease = Math.max(1.3, ease - 0.15);
      interval = Math.max(1, Math.round((interval || 1) * 1.2));
    } else if (grade === "good") {
      reps += 1;
      interval = reps === 1 ? 1 : (reps === 2 ? 6 : Math.round((interval || 1) * ease));
    } else { // easy
      ease += 0.15; reps += 1;
      interval = reps <= 1 ? 4 : Math.round((interval || 1) * ease * 1.3);
    }
    state.srs[id] = { ease: ease, interval: interval, reps: reps, due: Date.now() + interval * DAY };
    save(LS.srs, state.srs);
  }

  function renderReview() {
    var slot = byId("reviewSlot"), grades = byId("reviewGrades"), done = byId("reviewDone");
    state.review.queue = dueEntries();
    byId("reviewReset").disabled = Object.keys(state.srs).length === 0;

    if (!state.review.queue.length) {
      slot.innerHTML = "";
      grades.hidden = true;
      done.hidden = false;
      byId("reviewMeta").textContent = "Все карточки на сегодня повторены.";
      return;
    }
    done.hidden = true;
    grades.hidden = false;
    slot.innerHTML = "";
    var entry = state.review.queue[0];
    slot.appendChild(createCard(entry, { review: true }));
    window.requestAnimationFrame(function () { fitAllWithin(slot); });
    byId("reviewMeta").textContent = "К повторению: " + state.review.queue.length +
      " · всего в расписании: " + Object.keys(state.srs).length;
  }
  function reviewGrade(grade) {
    var entry = state.review.queue[0];
    if (!entry) return;
    schedule(entry.id, grade);
    updateDueBadge();
    renderReview();
  }

  /* ---------- Переключение режимов ---------- */
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("is-active", t.dataset.mode === mode);
    });
    byId("viewCards").hidden = mode !== "cards";
    byId("viewMatch").hidden = mode !== "match";
    byId("viewFormulas").hidden = mode !== "formulas";
    byId("viewNames").hidden = mode !== "names";
    byId("viewReactions").hidden = mode !== "reactions";
    byId("viewReview").hidden = mode !== "review";
    byId("progress").style.display = mode === "cards" ? "" : "none";

    if (mode === "cards") renderBrowse();
    else if (mode === "match") matchNewRound();
    else if (mode === "formulas") { if (!state.formula.order.length) formulaNewOrder(); formulaRender(); }
    else if (mode === "names") { if (!state.names.order.length) namesNewOrder(); namesRender(); }
    else if (mode === "reactions") { if (!state.reaction.order.length) reactionNewOrder(); reactionRender(); }
    else if (mode === "review") renderReview();

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------- Инициализация ---------- */
  function init() {
    buildChips();
    buildFormulaChips();
    buildMatchTypeChips();
    renderBrowse();
    updateProgress();
    updateDueBadge();
    matchMeta();

    byId("tabs").addEventListener("click", function (e) {
      var tab = e.target.closest(".tab");
      if (tab) setMode(tab.dataset.mode);
    });

    byId("shuffleBtn").addEventListener("click", function () {
      state.shuffled = true; renderBrowse();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    byId("resetBtn").addEventListener("click", function () {
      if (!state.known.size) return;
      if (!window.confirm("Сбросить прогресс изучения карточек?")) return;
      state.known.clear(); save(LS.known, []);
      renderBrowse(); updateProgress();
    });

    byId("matchNext").addEventListener("click", matchNewRound);
    byId("matchReset").addEventListener("click", function () {
      if ((state.stats.matchOk + state.stats.matchBad) === 0) return;
      if (!window.confirm("Сбросить прогресс в режиме «Соответствие»?")) return;
      state.stats.matchOk = 0; state.stats.matchBad = 0;
      save(LS.stats, state.stats);
      matchNewRound();
    });

    byId("formulaNext").addEventListener("click", formulaNext);
    byId("formulaReset").addEventListener("click", function () {
      if ((state.stats.formulaOk + state.stats.formulaBad) === 0) return;
      if (!window.confirm("Сбросить прогресс в режиме «Формулы»?")) return;
      state.stats.formulaOk = 0; state.stats.formulaBad = 0;
      save(LS.stats, state.stats);
      formulaNewOrder(); formulaRender();
    });

    byId("namesNext").addEventListener("click", namesNext);
    byId("namesReset").addEventListener("click", function () {
      if ((state.stats.namesOk + state.stats.namesBad) === 0) return;
      if (!window.confirm("Сбросить прогресс в режиме «Названия»?")) return;
      state.stats.namesOk = 0; state.stats.namesBad = 0;
      save(LS.stats, state.stats);
      namesNewOrder(); namesRender();
    });

    byId("reactionNext").addEventListener("click", reactionNext);
    byId("reactionReset").addEventListener("click", function () {
      if ((state.stats.reactOk + state.stats.reactBad) === 0) return;
      if (!window.confirm("Сбросить прогресс в режиме «Реакции»?")) return;
      state.stats.reactOk = 0; state.stats.reactBad = 0;
      save(LS.stats, state.stats);
      reactionNewOrder(); reactionRender();
    });

    byId("reviewGrades").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-grade]");
      if (btn) reviewGrade(btn.dataset.grade);
    });
    byId("reviewReset").addEventListener("click", function () {
      if (!Object.keys(state.srs).length) return;
      if (!window.confirm("Сбросить расписание повторений?")) return;
      state.srs = {}; save(LS.srs, state.srs);
      updateDueBadge(); renderReview();
    });

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        fitAllWithin(document);
        if (state.mode === "match") drawMatchLines();
        if (state.mode === "formulas") fitOptions(byId("formulaOptions"));
        if (state.mode === "names") fitOptions(byId("namesOptions"));
        if (state.mode === "reactions") fitOptions(byId("reactionOptions"));
      }, 150);
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { fitAllWithin(document); });
    }
  }

  init();
})();