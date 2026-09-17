(function () {
  "use strict";

  var MENUS = [
    { key: "kids", label: "小学生パーソナル・セミパーソナル", capacity: 1, times: [
      "9:00~10:00（土・日）パーソナル",
      "10:00~11:00（土・日）パーソナル",
      "11:00~12:00（土・日）パーソナル",
      "13:00~14:00（土・日）パーソナル",
      "14:00~15:00（土・日）パーソナル",
      "18:00~18:50（月・水・金）セミパーソナル"
    ]},
    { key: "semi", label: "セミパーソナル", capacity: 5, times: [
      "19:00~19:50（月・水・金）",
      "20:00~20:50（月・水・金）"
    ]},
    { key: "personal", label: "パーソナル", capacity: 1, times: [
      "8:00~9:00（土・日）",
      "9:00~10:00（土・日）",
      "10:00~11:00（土・日）",
      "11:00~12:00（土・日）",
      "13:00~14:00（土・日）",
      "14:00~15:00（土・日）",
      "21:00~21:50（月・水・金）"
    ]}
  ];

  var ADMIN_PIN_KEY = "aberto_admin_pin_v1";

  var root = document.getElementById("root");
  var API_URL = (window.ABERTO_CONFIG && window.ABERTO_CONFIG.APPS_SCRIPT_URL) || "";

  // ---- API helpers ----
  function apiGetAvailability() {
    return fetch(API_URL + "?action=availability", { method: "GET" })
      .then(function (res) { return res.json(); });
  }
  function apiPost(payload) {
    return fetch(API_URL, {
      method: "POST",
      body: JSON.stringify(payload) // no custom headers: keeps this a CORS-simple request for Apps Script
    }).then(function (res) { return res.json(); });
  }
  function apiCreate(payload) {
    return apiPost(Object.assign({ action: "create" }, payload));
  }
  function apiLookup(code, phone) {
    return apiPost({ action: "lookup", confirmCode: code, phone: phone });
  }
  function apiCancel(id, code, phone) {
    return apiPost({ action: "cancel", id: id, confirmCode: code, phone: phone });
  }
  function apiAdminList(pin) {
    return apiPost({ action: "adminList", pin: pin });
  }
  function apiAdminCancel(pin, id) {
    return apiPost({ action: "adminCancel", pin: pin, id: id });
  }

  // ---- helpers ----
  function findMenu(key) {
    for (var i = 0; i < MENUS.length; i++) if (MENUS[i].key === key) return MENUS[i];
    return null;
  }
  function slotCapacity(menuKey) {
    var m = findMenu(menuKey);
    return m && m.capacity ? m.capacity : 1;
  }
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function parseSlotRange(timeLabel) {
    var m = /^(\d{1,2}):(\d{2})~(\d{1,2}):(\d{2})/.exec(timeLabel);
    if (!m) return null;
    return { sh: parseInt(m[1], 10), sm: parseInt(m[2], 10), eh: parseInt(m[3], 10), em: parseInt(m[4], 10) };
  }
  function jstToIcsUtc(dateStr, h, m) {
    var d = new Date(dateStr + "T" + pad2(h) + ":" + pad2(m) + ":00+09:00");
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + "T" +
      pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + "Z";
  }
  function reservationTimes(r) {
    var range = parseSlotRange(r.timeLabel);
    if (!range) return null;
    return {
      startUtc: jstToIcsUtc(r.date, range.sh, range.sm),
      endUtc: jstToIcsUtc(r.date, range.eh, range.em)
    };
  }
  function buildGoogleCalUrl(r) {
    var t = reservationTimes(r);
    if (!t) return null;
    var qs = new URLSearchParams({
      action: "TEMPLATE",
      text: "studio ABERTO ご予約(" + r.menuLabel + ")",
      dates: t.startUtc + "/" + t.endUtc,
      details: "時間帯: " + r.timeLabel + " ／ 予約番号: " + r.confirmCode,
      location: "studio ABERTO"
    });
    return "https://calendar.google.com/calendar/render?" + qs.toString();
  }
  function buildIcsContent(r) {
    var t = reservationTimes(r);
    if (!t) return null;
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad2(now.getUTCMonth() + 1) + pad2(now.getUTCDate()) + "T" +
      pad2(now.getUTCHours()) + pad2(now.getUTCMinutes()) + pad2(now.getUTCSeconds()) + "Z";
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//studio ABERTO//Reservation//JP",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "UID:" + r.id + "@studio-aberto",
      "DTSTAMP:" + stamp,
      "DTSTART:" + t.startUtc,
      "DTEND:" + t.endUtc,
      "SUMMARY:studio ABERTO ご予約(" + r.menuLabel + ")",
      "DESCRIPTION:時間帯: " + r.timeLabel + " ／ 予約番号: " + r.confirmCode,
      "LOCATION:studio ABERTO",
      "END:VEVENT",
      "END:VCALENDAR"
    ];
    return lines.join("\r\n");
  }
  function downloadIcs(r) {
    var content = buildIcsContent(r);
    if (!content) return;
    var blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "studio-aberto-" + r.date + ".ics";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function heroHtml(subtitle) {
    return '<header class="hero">' +
      '<div class="brand-logo"><img src="assets/logo.png" width="88" height="88" alt="studio ABERTO"></div>' +
      '<p class="eyebrow">studio</p>' +
      '<h1>ABERTO</h1>' +
      '<p class="sub">' + escapeHtml(subtitle) + '</p>' +
      '</header>';
  }

  // ---- router ----
  var currentView = "booking";
  var lookupPrefill = { code: "", phone: "" };
  var pendingCancelReservation = null;

  function goBooking() { currentView = "booking"; render(); }
  function goLookup(code, phone) {
    lookupPrefill = { code: code || "", phone: phone || "" };
    currentView = "lookup";
    render();
  }
  function goCancelConfirm(reservation) {
    pendingCancelReservation = reservation;
    currentView = "cancelConfirm";
    render();
  }
  function goAdminGate() { currentView = "adminGate"; render(); }

  function render() {
    if (currentView === "admin") initAdminView();
    else if (currentView === "adminGate") initAdminGateView();
    else if (currentView === "lookup") initLookupView();
    else if (currentView === "cancelConfirm") initCancelConfirmView(pendingCancelReservation);
    else initBookingView();
  }

  // ---- booking view ----
  function initBookingView() {
    var html = [
      heroHtml("ご予約・お問い合わせフォーム"),
      '<p class="lead" style="margin:-8px 0 20px;">ご希望の日時をお知らせください。空き状況を確認のうえ、予約確定のご連絡をいたします。</p>',
      '<div id="banner" class="banner" hidden></div>',
      '<div id="successPanel" class="panel" hidden></div>',
      '<form id="bookingForm" novalidate>',
      '  <div class="field">',
      '    <label for="fldName">お名前 <span class="req">*</span></label>',
      '    <input type="text" id="fldName" name="fldName" autocomplete="name" required>',
      '  </div>',
      '  <div class="field">',
      '    <label for="fldEmail">メールアドレス <span class="req">*</span></label>',
      '    <input type="email" id="fldEmail" name="fldEmail" autocomplete="email" required>',
      '  </div>',
      '  <div class="field">',
      '    <label for="fldPhone">電話番号 <span class="req">*</span></label>',
      '    <input type="tel" id="fldPhone" name="fldPhone" autocomplete="tel" inputmode="tel" required>',
      '  </div>',
      '  <fieldset class="field">',
      '    <legend>ご利用メニュー <span class="req">*</span></legend>',
      '    <div class="menu-options">',
      '      <label class="menu-option"><input type="radio" name="menu" value="kids"><span>小学生パーソナル・セミパーソナル</span></label>',
      '      <label class="menu-option"><input type="radio" name="menu" value="semi"><span>セミパーソナル</span></label>',
      '      <label class="menu-option"><input type="radio" name="menu" value="personal"><span>パーソナル</span></label>',
      '    </div>',
      '  </fieldset>',
      '  <div id="step2" class="step2" hidden>',
      '    <div class="field">',
      '      <label for="fldDate">希望日 <span class="req">*</span></label>',
      '      <input type="date" id="fldDate" name="fldDate" required>',
      '    </div>',
      '    <fieldset class="field">',
      '      <legend>希望時間 <span class="req">*</span></legend>',
      '      <div id="timeOptions" class="time-options"><p class="hint">希望日を選択すると空き状況が表示されます。</p></div>',
      '    </fieldset>',
      '  </div>',
      '  <div class="field">',
      '    <label for="fldNote">質問・ご要望がございましたら、ご記入ください（任意）</label>',
      '    <textarea id="fldNote" name="fldNote" rows="3"></textarea>',
      '  </div>',
      '  <button type="submit" id="submitBtn" class="submit-btn">送信する</button>',
      '</form>',
      '<p class="link-row" style="text-align:center; margin-top:28px;"><button type="button" class="link-btn" id="lookupNavBtn">予約の確認・キャンセルはこちら</button></p>',
      '<p class="staff-link-row"><button type="button" class="staff-link-btn" id="staffNavBtn">Staff</button></p>'
    ].join("\n");

    root.innerHTML = html;

    var els = {
      banner: document.getElementById("banner"),
      successPanel: document.getElementById("successPanel"),
      form: document.getElementById("bookingForm"),
      name: document.getElementById("fldName"),
      email: document.getElementById("fldEmail"),
      phone: document.getElementById("fldPhone"),
      step2: document.getElementById("step2"),
      date: document.getElementById("fldDate"),
      timeOptions: document.getElementById("timeOptions"),
      note: document.getElementById("fldNote"),
      submitBtn: document.getElementById("submitBtn")
    };

    document.getElementById("lookupNavBtn").addEventListener("click", function () { goLookup("", ""); });
    document.getElementById("staffNavBtn").addEventListener("click", goAdminGate);

    try {
      var todayJst = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
      els.date.min = todayJst;
    } catch (e) {}

    function getSelectedMenu() {
      var radios = document.getElementsByName("menu");
      for (var i = 0; i < radios.length; i++) if (radios[i].checked) return radios[i].value;
      return null;
    }
    function getSelectedTime() {
      var radios = document.getElementsByName("time");
      for (var i = 0; i < radios.length; i++) if (radios[i].checked) return radios[i].value;
      return null;
    }

    function showBanner(type, message) {
      els.banner.hidden = false;
      els.banner.className = "banner banner-" + type;
      els.banner.textContent = message;
    }
    function hideBanner() {
      els.banner.hidden = true;
      els.banner.textContent = "";
    }

    function renderTimeOptions() {
      var menuKey = getSelectedMenu();
      var date = els.date.value;
      var container = els.timeOptions;
      if (!menuKey) {
        container.innerHTML = '<p class="hint">先にご利用メニューを選択してください。</p>';
        return;
      }
      if (!date) {
        container.innerHTML = '<p class="hint">希望日を選択すると空き状況が表示されます。</p>';
        return;
      }
      container.innerHTML = '<p class="hint">空き状況を確認しています…</p>';

      apiGetAvailability().then(function (res) {
        if (currentView !== "booking" || getSelectedMenu() !== menuKey || els.date.value !== date) return; // stale
        var counts = (res && res.ok && res.counts) || [];
        var menu = findMenu(menuKey);
        var capacity = slotCapacity(menuKey);
        var html = "";
        for (var i = 0; i < menu.times.length; i++) {
          var t = menu.times[i];
          var entry = counts.find(function (c) { return c.date === date && c.menuKey === menuKey && c.timeLabel === t; });
          var count = entry ? entry.count : 0;
          var full = count >= capacity;
          html += '<label class="time-option' + (full ? ' is-booked' : '') + '">';
          html += '<input type="radio" name="time" value="' + escapeAttr(t) + '"' + (full ? ' disabled' : '') + '>';
          html += '<span>' + escapeHtml(t) + '</span>';
          if (capacity > 1) {
            html += full
              ? '<span class="badge">満員</span>'
              : '<span class="badge badge-open">あと' + (capacity - count) + '名</span>';
          } else if (full) {
            html += '<span class="badge">予約済み</span>';
          }
          html += '</label>';
        }
        container.innerHTML = html || '<p class="hint">この日にご利用いただける時間枠はありません。</p>';
      }).catch(function () {
        container.innerHTML = '<p class="hint">空き状況の取得に失敗しました。通信状況をご確認のうえ、時間をおいて再度お試しください。</p>';
      });
    }

    function setSubmitting(on) {
      els.submitBtn.disabled = on;
      els.submitBtn.textContent = on ? "送信中…" : "送信する";
    }
    function resetForm() {
      els.form.reset();
      els.step2.hidden = true;
      renderTimeOptions();
    }

    function showSuccessPanel(reservation) {
      var gcalUrl = buildGoogleCalUrl(reservation);
      var html = "";
      html += "<h2>ご予約を受け付けました</h2>";
      html += '<div class="summary-row"><span class="k">予約番号</span><span class="v">' + escapeHtml(reservation.confirmCode) + "</span></div>";
      html += '<div class="summary-row"><span class="k">お名前</span><span class="v">' + escapeHtml(reservation.name) + "</span></div>";
      html += '<div class="summary-row"><span class="k">メニュー</span><span class="v">' + escapeHtml(reservation.menuLabel) + "</span></div>";
      html += '<div class="summary-row"><span class="k">日時</span><span class="v">' + escapeHtml(reservation.date) + " " + escapeHtml(reservation.timeLabel) + "</span></div>";
      html += '<p class="hint" style="margin-top:10px;">確認のご連絡をお待ちください。予約番号は変更・キャンセルの際に必要になりますので、控えをお願いいたします。</p>';
      html += '<div class="btn-row">';
      if (gcalUrl) html += '<a class="btn-secondary" href="' + escapeAttr(gcalUrl) + '" target="_blank" rel="noopener">Googleカレンダーに追加</a>';
      html += '<button type="button" class="btn-secondary" id="icsBtn">カレンダーファイルを保存(.ics)</button>';
      html += "</div>";
      html += '<div class="link-row">予約の変更・キャンセルは<button type="button" class="link-btn" id="goCancelFromSuccessBtn">こちら</button></div>';
      els.successPanel.innerHTML = html;
      els.successPanel.hidden = false;

      document.getElementById("goCancelFromSuccessBtn").addEventListener("click", function () {
        goLookup(reservation.confirmCode, reservation.phone || "");
      });
      document.getElementById("icsBtn").addEventListener("click", function () {
        downloadIcs(reservation);
      });
    }

    function handleMenuChange() {
      els.step2.hidden = false;
      renderTimeOptions();
    }

    function handleSubmit(ev) {
      ev.preventDefault();
      hideBanner();

      var name = els.name.value.trim();
      var email = els.email.value.trim();
      var phone = els.phone.value.trim();
      var menuKey = getSelectedMenu();
      var date = els.date.value;
      var time = getSelectedTime();
      var note = els.note.value.trim();

      if (!name || !email || !phone || !menuKey || !date || !time) {
        showBanner("error", "すべての必須項目(お名前・メールアドレス・電話番号・ご利用メニュー・希望日・希望時間)を入力してください。");
        return;
      }
      var menu = findMenu(menuKey);

      setSubmitting(true);
      apiCreate({
        name: name, email: email, phone: phone,
        menuKey: menuKey, menuLabel: menu.label, date: date, timeLabel: time, note: note
      }).then(function (res) {
        setSubmitting(false);
        if (res && res.ok) {
          hideBanner();
          resetForm();
          showSuccessPanel(res.reservation);
        } else if (res && res.error === "full") {
          showBanner("error", "その日時はちょうど満員になりました。別の日時をお選びください。");
          renderTimeOptions();
        } else {
          showBanner("error", "送信に失敗しました。通信状況をご確認のうえ、もう一度お試しください。");
        }
      }).catch(function () {
        setSubmitting(false);
        showBanner("error", "送信に失敗しました。通信状況をご確認のうえ、もう一度お試しください。");
      });
    }

    var menuRadios = document.getElementsByName("menu");
    for (var mi = 0; mi < menuRadios.length; mi++) menuRadios[mi].addEventListener("change", handleMenuChange);
    els.date.addEventListener("change", renderTimeOptions);
    els.form.addEventListener("submit", handleSubmit);
    renderTimeOptions();
  }

  // ---- lookup view ----
  function initLookupView() {
    var html = "";
    html += heroHtml("予約の確認・キャンセル");
    html += '<div class="panel">';
    html += '<p class="hint" style="margin:0 0 16px;">ご予約時にお伝えした予約番号と、ご登録の電話番号を入力してください。</p>';
    html += '<div id="lookupBanner" class="banner banner-error" hidden></div>';
    html += '<form id="lookupForm" novalidate>';
    html += '  <div class="field"><label for="fldCode">予約番号 <span class="req">*</span></label>' +
      '<input type="text" id="fldCode" name="fldCode" inputmode="numeric" autocomplete="off" required value="' + escapeAttr(lookupPrefill.code) + '"></div>';
    html += '  <div class="field"><label for="fldLookupPhone">電話番号 <span class="req">*</span></label>' +
      '<input type="tel" id="fldLookupPhone" name="fldLookupPhone" autocomplete="tel" required value="' + escapeAttr(lookupPrefill.phone) + '"></div>';
    html += '  <button type="submit" class="submit-btn" id="lookupSubmitBtn">予約を検索する</button>';
    html += '</form>';
    html += '<p class="link-row" style="text-align:center; margin-top:20px;"><button type="button" class="link-btn" id="backToBookingBtn">予約フォームに戻る</button></p>';
    html += '</div>';
    root.innerHTML = html;

    document.getElementById("backToBookingBtn").addEventListener("click", goBooking);

    var form = document.getElementById("lookupForm");
    var banner = document.getElementById("lookupBanner");
    var btn = document.getElementById("lookupSubmitBtn");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var code = document.getElementById("fldCode").value.trim().toUpperCase();
      var phone = document.getElementById("fldLookupPhone").value.trim();
      if (!code || !phone) {
        banner.hidden = false;
        banner.textContent = "予約番号と電話番号を入力してください。";
        return;
      }
      btn.disabled = true;
      btn.textContent = "検索中…";
      apiLookup(code, phone).then(function (res) {
        btn.disabled = false;
        btn.textContent = "予約を検索する";
        if (res && res.ok) {
          banner.hidden = true;
          goCancelConfirm(res.reservation);
        } else {
          banner.hidden = false;
          banner.textContent = "該当する予約が見つかりませんでした。予約番号・電話番号をご確認ください。";
        }
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = "予約を検索する";
        banner.hidden = false;
        banner.textContent = "通信に失敗しました。もう一度お試しください。";
      });
    });
  }

  // ---- cancel confirm view ----
  function initCancelConfirmView(reservation) {
    var html = "";
    html += heroHtml("予約の取り消し");
    html += '<div class="panel">';
    if (!reservation) {
      html += "<h2>予約情報が見つかりませんでした</h2>";
      html += '<div class="btn-row"><button type="button" class="btn-secondary" id="backBtn">予約フォームに戻る</button></div>';
      html += "</div>";
      root.innerHTML = html;
      document.getElementById("backBtn").addEventListener("click", goBooking);
      return;
    }
    html += "<h2>この予約を取り消しますか？</h2>";
    html += '<div class="summary-row"><span class="k">予約番号</span><span class="v">' + escapeHtml(reservation.confirmCode) + "</span></div>";
    html += '<div class="summary-row"><span class="k">お名前</span><span class="v">' + escapeHtml(reservation.name) + "</span></div>";
    html += '<div class="summary-row"><span class="k">メニュー</span><span class="v">' + escapeHtml(reservation.menuLabel) + "</span></div>";
    html += '<div class="summary-row"><span class="k">日時</span><span class="v">' + escapeHtml(reservation.date) + " " + escapeHtml(reservation.timeLabel) + "</span></div>";
    html += '<div id="cancelMsg" class="hint" style="margin-top:10px;"></div>';
    html += '<div class="btn-row"><button type="button" class="btn-danger" id="cancelConfirmBtn">この予約を取り消す</button>' +
      '<button type="button" class="btn-secondary" id="cancelBackBtn">取り消さずに戻る</button></div>';
    html += "</div>";
    root.innerHTML = html;

    document.getElementById("cancelBackBtn").addEventListener("click", goBooking);

    var btn = document.getElementById("cancelConfirmBtn");
    var msg = document.getElementById("cancelMsg");
    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "処理中…";
      apiCancel(reservation.id, reservation.confirmCode, reservation.phone).then(function (res) {
        if (res && res.ok) {
          root.innerHTML = heroHtml("予約の取り消し") +
            '<div class="panel"><h2>取り消しが完了しました</h2><p class="hint">またのご予約をお待ちしております。</p>' +
            '<div class="btn-row"><button type="button" class="btn-secondary" id="backBtn2">予約フォームに戻る</button></div></div>';
          document.getElementById("backBtn2").addEventListener("click", goBooking);
        } else {
          btn.disabled = false;
          btn.textContent = "この予約を取り消す";
          msg.textContent = "取り消しに失敗しました。もう一度お試しください。";
        }
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = "この予約を取り消す";
        msg.textContent = "通信に失敗しました。もう一度お試しください。";
      });
    });
  }

  // ---- admin gate ----
  function initAdminGateView() {
    var html = "";
    html += heroHtml("予約管理（管理者用）");
    html += '<div class="panel">';
    html += '<p class="hint" style="margin:0 0 16px;">合言葉を入力してください。</p>';
    html += '<div id="pinBanner" class="banner banner-error" hidden></div>';
    html += '<form id="pinForm" novalidate>';
    html += '  <div class="field"><label for="fldPin">合言葉</label><input type="text" id="fldPin" name="fldPin" autocomplete="off"></div>';
    html += '  <button type="submit" class="submit-btn" id="pinSubmitBtn">開く</button>';
    html += '</form>';
    html += '<p class="link-row" style="text-align:center; margin-top:20px;"><button type="button" class="link-btn" id="backFromGateBtn">予約フォームに戻る</button></p>';
    html += '</div>';
    root.innerHTML = html;

    document.getElementById("backFromGateBtn").addEventListener("click", goBooking);

    var form = document.getElementById("pinForm");
    var banner = document.getElementById("pinBanner");
    var btn = document.getElementById("pinSubmitBtn");

    function tryPin(pin) {
      btn.disabled = true;
      btn.textContent = "確認中…";
      return apiAdminList(pin).then(function (res) {
        btn.disabled = false;
        btn.textContent = "開く";
        if (res && res.ok) {
          try { localStorage.setItem(ADMIN_PIN_KEY, pin); } catch (e) {}
          currentView = "admin";
          initAdminView(res.reservations, pin);
          return true;
        }
        banner.hidden = false;
        banner.textContent = "合言葉が正しくありません。";
        return false;
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = "開く";
        banner.hidden = false;
        banner.textContent = "通信に失敗しました。もう一度お試しください。";
        return false;
      });
    }

    // すでにこの端末で開いたことがあれば自動で試す
    var savedPin = null;
    try { savedPin = localStorage.getItem(ADMIN_PIN_KEY); } catch (e) {}
    if (savedPin) {
      btn.textContent = "確認中…";
      btn.disabled = true;
      tryPin(savedPin);
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      banner.hidden = true;
      var val = document.getElementById("fldPin").value.trim();
      tryPin(val);
    });
  }

  // ---- admin calendar view ----
  function initAdminView(reservations, pin) {
    reservations = reservations || [];
    var todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    var todayParts = todayStr.split("-").map(Number);
    var viewYear = todayParts[0];
    var viewMonth = todayParts[1] - 1;
    var selectedDate = null;
    var DOW = ["日", "月", "火", "水", "木", "金", "土"];

    function reservationsOnDate(dateStr) {
      return reservations.filter(function (r) { return r.date === dateStr; });
    }
    function dateStrOf(y, m, d) { return y + "-" + pad2(m + 1) + "-" + pad2(d); }

    function draw() {
      var daysInMo = new Date(viewYear, viewMonth + 1, 0).getDate();
      var firstDow = new Date(viewYear, viewMonth, 1).getDay();

      var html = "";
      html += heroHtml("予約管理（管理者用）");
      html += '<p class="hint" style="margin-bottom:16px;">この端末では次回から合言葉の入力なしで開けます。</p>';

      html += '<div class="cal-header">';
      html += '<button type="button" class="cal-nav-btn" id="prevMonthBtn">‹ 前月</button>';
      html += '<span class="cal-title">' + viewYear + '年' + (viewMonth + 1) + '月</span>';
      html += '<button type="button" class="cal-nav-btn" id="nextMonthBtn">次月 ›</button>';
      html += '</div>';

      html += '<div class="cal-grid">';
      for (var d0 = 0; d0 < 7; d0++) html += '<div class="cal-dow">' + DOW[d0] + '</div>';
      for (var e = 0; e < firstDow; e++) html += '<div class="cal-day empty"></div>';
      for (var day = 1; day <= daysInMo; day++) {
        var ds = dateStrOf(viewYear, viewMonth, day);
        var cnt = reservationsOnDate(ds).length;
        var cls = "cal-day";
        if (cnt > 0) cls += " has-res";
        if (ds === todayStr) cls += " today";
        if (ds === selectedDate) cls += " selected";
        html += '<div class="' + cls + '" data-date="' + ds + '">';
        html += '<span class="num">' + day + '</span>';
        if (cnt > 0) html += '<span class="cnt">' + cnt + '件</span>';
        html += '</div>';
      }
      html += '</div>';

      if (selectedDate) {
        html += '<div class="cal-filter-note"><span>' + escapeHtml(selectedDate) + ' の予約を表示中</span><button type="button" id="clearFilterBtn">すべて表示</button></div>';
      }

      var list = (selectedDate ? reservationsOnDate(selectedDate) : reservations.slice()).slice().sort(function (a, b) {
        var ka = a.date + " " + a.timeLabel, kb = b.date + " " + b.timeLabel;
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      });

      if (list.length === 0) {
        html += '<div class="admin-empty">' + (selectedDate ? "この日の予約はありません。" : "現在、予約はありません。") + '</div>';
      } else {
        html += '<div class="admin-list">';
        for (var i = 0; i < list.length; i++) {
          var r = list[i];
          html += '<div class="admin-item">';
          html += '<div class="row1"><span>' + escapeHtml(r.date) + " " + escapeHtml(r.timeLabel) + '</span><span>' + escapeHtml(r.menuLabel) + '</span></div>';
          html += '<div class="meta">予約番号: ' + escapeHtml(r.confirmCode) + '</div>';
          html += '<div class="meta">' + escapeHtml(r.name) +
            (r.email ? (" ／ " + escapeHtml(r.email)) : "") +
            (r.phone ? (" ／ " + escapeHtml(r.phone)) : "") + '</div>';
          if (r.note) html += '<div class="meta">備考: ' + escapeHtml(r.note) + '</div>';
          html += '<div class="actions"><button type="button" class="btn-danger cancel-btn" data-id="' + escapeAttr(r.id) + '">取り消す</button></div>';
          html += '</div>';
        }
        html += '</div>';
      }

      html += '<p class="link-row"><button type="button" class="link-btn back-link" id="backToBookingFromAdmin">予約フォームを表示</button></p>';
      html += '<p class="link-row"><button type="button" class="link-btn" id="adminLockBtn" style="font-size:12px;">この端末のログイン状態を解除</button></p>';
      root.innerHTML = html;

      document.getElementById("backToBookingFromAdmin").addEventListener("click", goBooking);
      document.getElementById("adminLockBtn").addEventListener("click", function () {
        try { localStorage.removeItem(ADMIN_PIN_KEY); } catch (e) {}
        goBooking();
      });
      document.getElementById("prevMonthBtn").addEventListener("click", function () {
        viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        draw();
      });
      document.getElementById("nextMonthBtn").addEventListener("click", function () {
        viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        draw();
      });
      var dayCells = document.querySelectorAll(".cal-day.has-res");
      for (var dc = 0; dc < dayCells.length; dc++) {
        (function (cell) {
          cell.addEventListener("click", function () {
            var ds2 = cell.getAttribute("data-date");
            selectedDate = (selectedDate === ds2) ? null : ds2;
            draw();
          });
        })(dayCells[dc]);
      }
      var clearBtn = document.getElementById("clearFilterBtn");
      if (clearBtn) clearBtn.addEventListener("click", function () { selectedDate = null; draw(); });

      var buttons = document.querySelectorAll(".cancel-btn");
      for (var bi = 0; bi < buttons.length; bi++) {
        (function (btn) {
          btn.addEventListener("click", function () {
            if (btn.getAttribute("data-armed") !== "1") {
              btn.setAttribute("data-armed", "1");
              btn.textContent = "もう一度押すと取り消します";
              setTimeout(function () {
                if (btn.getAttribute("data-armed") === "1") {
                  btn.setAttribute("data-armed", "0");
                  btn.textContent = "取り消す";
                }
              }, 4000);
              return;
            }
            var id = btn.getAttribute("data-id");
            btn.disabled = true;
            btn.textContent = "処理中…";
            apiAdminCancel(pin, id).then(function (res) {
              if (res && res.ok) {
                reservations = reservations.filter(function (r) { return r.id !== id; });
                draw();
              } else {
                btn.disabled = false;
                btn.setAttribute("data-armed", "0");
                btn.textContent = "取り消す";
              }
            }).catch(function () {
              btn.disabled = false;
              btn.setAttribute("data-armed", "0");
              btn.textContent = "取り消す";
            });
          });
        })(buttons[bi]);
      }
    }

    draw();
  }

  render();
})();
