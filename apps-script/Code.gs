/**
 * studio ABERTO 予約システム - バックエンド (Google Apps Script)
 *
 * このスクリプトを、予約データを保存したいGoogleスプレッドシートに
 * 紐づけて「ウェブアプリ」としてデプロイしてください。
 * デプロイ設定: 実行するユーザー = 自分 / アクセスできるユーザー = 全員
 *
 * シートには以下のヘッダー行を1行目に用意してください(なければ自動作成されます):
 * id | confirmCode | name | email | phone | menuKey | menuLabel | date | timeLabel | note | createdAt | status
 */

// ==== 設定 ====
var SHEET_NAME = "reservations";
var ADMIN_PIN = "aberto"; // 管理者用の合言葉。変更したい場合はここを書き換えてください(小文字で保存)。
var CODE_VERSION = "2026-09-18-fix2"; // デプロイが正しく反映されたか確認用のバージョン表示(getAvailabilityの応答に含まれます)

var MENUS = {
  kids: { label: "小学生パーソナル・セミパーソナル", capacity: 1 },
  semi: { label: "セミパーソナル", capacity: 5 },
  personal: { label: "パーソナル", capacity: 1 }
};

var HEADERS = ["id", "confirmCode", "name", "email", "phone", "menuKey", "menuLabel", "date", "timeLabel", "note", "createdAt", "status"];

// ==== エントリーポイント ====

function doGet(e) {
  try {
    var action = (e.parameter && e.parameter.action) || "availability";
    if (action === "availability") {
      return jsonOut(getAvailability());
    }
    return jsonOut({ ok: false, error: "unknown_action" });
  } catch (err) {
    return jsonOut({ ok: false, error: "server_error", message: String(err) });
  }
}

function doPost(e) {
  try {
    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (parseErr) { body = {}; }
    var action = body.action;

    if (action === "create") return jsonOut(createReservation(body));
    if (action === "lookup") return jsonOut(lookupReservation(body));
    if (action === "cancel") return jsonOut(cancelReservation(body));
    if (action === "adminList") return jsonOut(adminList(body));
    if (action === "adminCancel") return jsonOut(adminCancel(body));

    return jsonOut({ ok: false, error: "unknown_action" });
  } catch (err) {
    return jsonOut({ ok: false, error: "server_error", message: String(err) });
  }
}

// ==== シート操作 ====

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }
  // 重要: スプレッドシートは日付らしき文字列("2026-09-30"など)や
  // 数字らしき文字列(電話番号・予約番号)を自動的に日付型/数値型に変換してしまい、
  // 電話番号の先頭の0が消えたり、日付の比較が合わなくなったりする不具合の原因になる。
  // それを防ぐため、全列を「書式なしテキスト」に固定する。
  sheet.getRange(1, 1, sheet.getMaxRows(), HEADERS.length).setNumberFormat("@");
  return sheet;
}

// スプレッドシートは列を書式なしテキストにしていても、既存データや手入力などの
// 経路で日付/数値として解釈された値が紛れ込む可能性がある。読み込み時にも
// 文字列へ強制変換して、"YYYY-MM-DD" 比較や電話番号の先頭ゼロ落ちを防ぐ。
function coerceCell(headerName, value) {
  if (value instanceof Date) {
    if (headerName === "date") {
      return Utilities.formatDate(value, "Asia/Tokyo", "yyyy-MM-dd");
    }
    return Utilities.formatDate(value, "Asia/Tokyo", "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (headerName === "phone" || headerName === "confirmCode") {
    return String(value);
  }
  return value;
}

function readAllRows() {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = HEADERS.length;
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var row = {};
    for (var c = 0; c < HEADERS.length; c++) row[HEADERS[c]] = coerceCell(HEADERS[c], values[i][c]);
    row._rowIndex = i + 2; // 1-indexed sheet row number
    rows.push(row);
  }
  return rows;
}

function activeRows() {
  return readAllRows().filter(function (r) { return r.status !== "cancelled"; });
}

// ==== ロジック ====

function normPhone(s) {
  return String(s || "").replace(/\D/g, "").slice(-10);
}

// 先頭にアポストロフィを付けて「文字列として書き込む」ことを強制するヘルパー。
// getValues() で読み出す際にはアポストロフィは付いてこない。
function forceText(v) {
  var s = String(v == null ? "" : v);
  if (s.charAt(0) === "'") return s;
  return "'" + s;
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }

function generateId() {
  return "res_" + new Date().getTime() + "_" + Math.random().toString(36).slice(2, 8);
}

function generateConfirmCode(existingRows) {
  var used = {};
  for (var i = 0; i < existingRows.length; i++) used[String(existingRows[i].confirmCode)] = true;
  var code;
  var guard = 0;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
    guard++;
  } while (used[code] && guard < 1000);
  return code;
}

// 公開用: 名前・連絡先などのPIIを一切含まない、枠ごとの件数だけを返す
function getAvailability() {
  var rows = activeRows();
  var counts = {}; // key: date|menuKey|timeLabel -> count
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var key = r.date + "|" + r.menuKey + "|" + r.timeLabel;
    counts[key] = (counts[key] || 0) + 1;
  }
  var list = [];
  for (var k in counts) {
    var parts = k.split("|");
    list.push({ date: parts[0], menuKey: parts[1], timeLabel: parts[2], count: counts[k] });
  }
  return { ok: true, counts: list, codeVersion: CODE_VERSION };
}

function createReservation(body) {
  var name = String(body.name || "").trim();
  var email = String(body.email || "").trim();
  var phone = String(body.phone || "").trim();
  var menuKey = String(body.menuKey || "").trim();
  var menuLabel = String(body.menuLabel || "").trim();
  var date = String(body.date || "").trim();
  var timeLabel = String(body.timeLabel || "").trim();
  var note = String(body.note || "").trim();

  if (!name || !email || !phone || !menuKey || !date || !timeLabel) {
    return { ok: false, error: "invalid" };
  }
  var menu = MENUS[menuKey];
  if (!menu) return { ok: false, error: "invalid" };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var rows = activeRows();
    var count = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].date === date && rows[i].menuKey === menuKey && rows[i].timeLabel === timeLabel) count++;
    }
    if (count >= menu.capacity) {
      return { ok: false, error: "full" };
    }

    var id = generateId();
    var confirmCode = generateConfirmCode(rows);
    var createdAt = new Date().toISOString();

    var sheet = getSheet();
    // 先頭に "'" (アポストロフィ) を付けて書き込むと、スプレッドシートが
    // 数値/日付として自動変換するのを確実に防げる(読み出し時には付いてこない)。
    // setNumberFormat("@") だけでは自動変換を防げないケースがあるための保険。
    sheet.appendRow([
      forceText(id),
      forceText(confirmCode),
      name,
      email,
      forceText(phone),
      menuKey,
      menuLabel,
      forceText(date),
      timeLabel,
      note,
      createdAt,
      "active"
    ]);

    return {
      ok: true,
      reservation: {
        id: id, confirmCode: confirmCode, name: name, email: email, phone: phone,
        menuKey: menuKey, menuLabel: menuLabel, date: date, timeLabel: timeLabel, note: note, createdAt: createdAt
      }
    };
  } finally {
    lock.releaseLock();
  }
}

function findByCodeAndPhone(code, phone) {
  var rows = activeRows();
  var normTarget = normPhone(phone);
  if (!normTarget) return null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].confirmCode) === String(code) && normPhone(rows[i].phone) === normTarget) {
      return rows[i];
    }
  }
  return null;
}

function lookupReservation(body) {
  var code = String(body.confirmCode || "").trim().toUpperCase();
  var phone = String(body.phone || "").trim();
  var found = findByCodeAndPhone(code, phone);
  if (!found) return { ok: false, error: "not_found" };
  return {
    ok: true,
    reservation: {
      id: found.id, confirmCode: found.confirmCode, name: found.name, email: found.email, phone: found.phone,
      menuKey: found.menuKey, menuLabel: found.menuLabel, date: found.date, timeLabel: found.timeLabel, note: found.note
    }
  };
}

function cancelReservation(body) {
  var code = String(body.confirmCode || "").trim().toUpperCase();
  var phone = String(body.phone || "").trim();
  var id = String(body.id || "").trim();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var found = findByCodeAndPhone(code, phone);
    if (!found || found.id !== id) return { ok: false, error: "not_found" };
    var sheet = getSheet();
    sheet.getRange(found._rowIndex, HEADERS.indexOf("status") + 1).setValue("cancelled");
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function checkPin(pin) {
  return String(pin || "").trim().toLowerCase() === ADMIN_PIN;
}

function adminList(body) {
  if (!checkPin(body.pin)) return { ok: false, error: "pin" };
  var rows = activeRows();
  var list = rows.map(function (r) {
    return {
      id: r.id, confirmCode: r.confirmCode, name: r.name, email: r.email, phone: r.phone,
      menuKey: r.menuKey, menuLabel: r.menuLabel, date: r.date, timeLabel: r.timeLabel, note: r.note
    };
  });
  return { ok: true, reservations: list };
}

function adminCancel(body) {
  if (!checkPin(body.pin)) return { ok: false, error: "pin" };
  var id = String(body.id || "").trim();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var rows = readAllRows();
    var target = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].id === id && rows[i].status !== "cancelled") { target = rows[i]; break; }
    }
    if (!target) return { ok: false, error: "not_found" };
    var sheet = getSheet();
    sheet.getRange(target._rowIndex, HEADERS.indexOf("status") + 1).setValue("cancelled");
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ==== 出力ヘルパー ====

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
