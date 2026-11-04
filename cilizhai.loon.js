/******************************
脚本名称：磁力宅智存 会员解锁
Version  : v1.0.2
更新时间：2026-10-30
Platform : Loon
脚本功能：本地解锁 磁力宅智存 会员判定（倍速/去广告/付费墙/身份显示）
使用说明：MITM 重写 user/get_user_status_big 响应，打开 App 即生效。
         首次运行会把原始响应打进 Loon 日志，用于确认真实字段名。

Loon 原生 API：
  $persistentStore.read / write   持久化开关（免改文件）
  $notification.post             解锁成功通知
  $done({ body })                只回 body，不覆盖 status/headers
*******************************/

// ========== 配置 ==========
var CONFIG = {
  targetTag: 4,          // 4=diamond 3=supreme 1=member 0=free
  extendDays: 3650,      // 到期时间往后推 10 年
  dumpOriginal: true,    // 首跑打印原始响应
  dumpLimit: 3000,
  patchUserTags: false,  // user_tags 可能是 UI 文案，默认不动
  notifyOnSuccess: true
};

// 实测确认真实键名后填这里（优先级最高）
var EXACT_TRUE_KEYS = [];
var EXACT_FALSE_KEYS = [];
var EXACT_TAG_KEYS = [];
var EXACT_TIME_KEYS = [];
var EXACT_NUM_KEYS = [];

// 模糊匹配（去 _ - 后小写），依据 Swift 反射表 ModelUserStatus / ModelUserGrade
var K_TRUE = ["ismemeber", "ismember", "isvip", "issvip", "issupreme", "ispremium",
              "ispaid", "vipflag", "memberflag", "svipflag", "hasvip", "hasmember", "usermember"];
var K_FALSE = ["expired", "isexpired", "isvipexpired", "istrial", "istrying", "isspeedlimited",
               "viprequired", "sviprequired", "svipplusrequired"];
var K_TAG = ["usertag", "tag", "membertype", "viptype", "gradetype", "leveltype",
             "memberlevel", "viplevel", "usergrade", "userlevel"];
var K_NUM = ["gradelevel", "gradevalue", "advancedlevel", "advancedvalue"];
var K_TIME = ["expiredate", "expiretime", "expireat", "vipendtime", "vipenddate",
              "memberexpire", "svipendtime", "expire"];

var TAG_NAMES = ["free", "member", "eternal", "supreme", "diamond"];
var SCRIPT_NAME = "磁力宅智存";
var SCRIPT_VERSION = "v1.0.2";

// ========== 持久化开关（Loon: $persistentStore）==========
var PREF_DUMP = "cilizhai.dump";
var PREF_TAG = "cilizhai.tag";
var PREF_NOTIFIED = "cilizhai.notified";

function prefGet(key, fallback) {
  try {
    var v = $persistentStore.read(key);
    return (v === null || v === undefined || v === "") ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function prefSet(key, value) {
  try { $persistentStore.write(String(value), key); } catch (e) {}
}

function applyPrefs() {
  var d = prefGet(PREF_DUMP, null);
  if (d !== null) CONFIG.dumpOriginal = String(d) === "1";

  var t = prefGet(PREF_TAG, null);
  if (t !== null && /^[0-4]$/.test(String(t))) CONFIG.targetTag = parseInt(String(t), 10);
}

// ========== 日志 ==========
function log() {
  try { console.log(Array.prototype.join.call(arguments, " ")); } catch (e) {}
}

function logField(label, value) {
  var padding = "              ";
  log((label + padding).substring(0, 14) + ": " + value);
}

function logStart() {
  var now = new Date();
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  var ver = (typeof $loon !== "undefined" && $loon) ? $loon : "Loon";
  log("🚀 Script Start");
  log("Time     : " + now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) +
      " " + p(now.getHours()) + ":" + p(now.getMinutes()) + ":" + p(now.getSeconds()));
  log("Version  : " + SCRIPT_VERSION + " | Loon | Response");
  log("Loon     : " + ver);
  log("------------------------------------");
}

function logSummary(total, success, failed, result) {
  log("📊 Summary");
  log("Total      : " + total);
  log("Success    : " + success);
  log("Failed     : " + failed);
  log("🎯 Result  : " + result);
  log("End");
}

// ========== 工具 ==========
function isObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function inList(list, v) { for (var i = 0; i < list.length; i++) if (list[i] === v) return true; return false; }
function normalizeKey(k) { return String(k).replace(/[_\-]/g, "").toLowerCase(); }
function pad2(n) { return (n < 10 ? "0" : "") + n; }

function getResponseBody() {
  return (typeof $response !== "undefined" && $response && $response.body) ? $response.body : "";
}

function parseResponse(raw) {
  if (!raw) return null;
  try {
    var parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// 类型保持：原值什么类型就还什么类型，避免 Swift JSONDecoder 整体失败
function futureValue(original, days) {
  var ms = Date.now() + days * 86400000;
  var d = new Date(ms);
  if (typeof original === "number") {
    return original > 1e11 ? Math.floor(ms / 1000) * 1000 : Math.floor(ms / 1000);
  }
  if (typeof original === "string") {
    if (/^\d+$/.test(original)) return original.length >= 13 ? String(ms) : String(Math.floor(ms / 1000));
    if (original.indexOf("T") >= 0) return d.toISOString();
    if (original.indexOf("-") >= 0) {
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
             " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    }
    return d.toISOString();
  }
  return Math.floor(ms / 1000);
}

function tagValue(original) {
  if (typeof original === "number") return CONFIG.targetTag;
  if (typeof original === "string") {
    if (/^\d+$/.test(original)) return String(CONFIG.targetTag);
    return TAG_NAMES[CONFIG.targetTag] || "diamond";
  }
  if (typeof original === "boolean") return true;
  return CONFIG.targetTag;
}

function numValue(original) {
  if (typeof original === "number") return original < 99 ? 99 : original;
  if (typeof original === "string" && /^\d+$/.test(original)) return "99";
  return original;
}

function trueValue(original) {
  if (typeof original === "boolean") return true;
  if (typeof original === "number") return 1;
  if (typeof original === "string") return /^\d+$/.test(original) ? "1" : "true";
  return true;
}

function falseValue(original) {
  if (typeof original === "boolean") return false;
  if (typeof original === "number") return 0;
  if (typeof original === "string") return /^\d+$/.test(original) ? "0" : "false";
  return false;
}

// ========== 改写核心 ==========
var changed = [];
var seen = {};

function mark(p) { if (!seen[p]) { seen[p] = 1; changed.push(p); } }

function applyFields(node, path) {
  if (!isObject(node) && !Array.isArray(node)) return;

  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) {
      if (node[i] !== null && typeof node[i] === "object") applyFields(node[i], path + "[" + i + "]");
    }
    return;
  }

  for (var key in node) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) continue;

    var value = node[key];
    var p = path ? path + "." + key : key;
    var nk = normalizeKey(key);

    if (CONFIG.patchUserTags && nk === "usertags" && Array.isArray(value)) {
      var label = TAG_NAMES[CONFIG.targetTag] || "diamond";
      for (var j = 0; j < value.length; j++) {
        if (typeof value[j] === "string" && value[j] !== label) value[j] = label;
      }
      mark(p);
      continue;
    }

    if (inList(EXACT_TRUE_KEYS, key))  { node[key] = trueValue(value);  mark(p); continue; }
    if (inList(EXACT_FALSE_KEYS, key)) { node[key] = falseValue(value); mark(p); continue; }
    if (inList(EXACT_TAG_KEYS, key))   { node[key] = tagValue(value);   mark(p); continue; }
    if (inList(EXACT_TIME_KEYS, key))  { node[key] = futureValue(value, CONFIG.extendDays); mark(p); continue; }
    if (inList(EXACT_NUM_KEYS, key))   { node[key] = numValue(value);   mark(p); continue; }

    if (value !== null && typeof value === "object") { applyFields(value, p); continue; }

    if (inList(K_TIME, nk))  { node[key] = futureValue(value, CONFIG.extendDays); mark(p); continue; }
    if (inList(K_TAG, nk))   { node[key] = tagValue(value);   mark(p); continue; }
    if (inList(K_TRUE, nk))  { node[key] = trueValue(value);  mark(p); continue; }
    if (inList(K_FALSE, nk)) { node[key] = falseValue(value); mark(p); continue; }
    if (inList(K_NUM, nk))   { node[key] = numValue(value);   mark(p); continue; }
  }
}

function buildResponse(raw) {
  var body = parseResponse(raw);
  if (!body) return null;

  changed = [];
  seen = {};
  applyFields(body, "");

  var stamps = ["ts", "timestamp", "serverTime", "server_time", "request_date"];
  for (var i = 0; i < stamps.length; i++) {
    var k = stamps[i];
    if (Object.prototype.hasOwnProperty.call(body, k) && typeof body[k] === "number") {
      body[k] = body[k] > 1e11 ? Date.now() : Math.floor(Date.now() / 1000);
    }
  }
  return body;
}

// Loon: response-body 脚本只回 body，不覆盖 status / headers
function finish(bodyText) {
  $done({ body: bodyText });
}

// ========== 主流程 ==========
function run() {
  applyPrefs();
  logStart();

  var raw = getResponseBody();

  if (CONFIG.dumpOriginal && raw) {
    logField("Raw", raw.length > CONFIG.dumpLimit ? raw.substring(0, CONFIG.dumpLimit) + "..." : raw);
    log("------------------------------------");
  }

  var body = buildResponse(raw);

  if (!body) {
    logField("Status", "❌ JSON parse error");
    log("------------------------------------");
    logSummary(1, 0, 1, "Invalid response");
    return finish(raw);
  }

  if (!changed.length) {
    logField("Status", "⚠️ No field matched");
    logField("Message", "把上面的 Raw 里真实键名填入 EXACT_*_KEYS");
    log("------------------------------------");
    logSummary(1, 0, 1, "Need calibration");
    return finish(JSON.stringify(body));
  }

  logField("Status", "✅ VIP unlocked");
  for (var i = 0; i < changed.length && i < 12; i++) logField("Message", "patched " + changed[i]);
  if (changed.length > 12) logField("Message", "... +" + (changed.length - 12) + " more");
  logField("Expire", "+" + CONFIG.extendDays + " days");
  logField("UserTag", CONFIG.targetTag + " (" + TAG_NAMES[CONFIG.targetTag] + ")");
  log("------------------------------------");
  logSummary(1, 1, 0, "Success");

  if (CONFIG.notifyOnSuccess && prefGet(PREF_NOTIFIED, "") !== SCRIPT_VERSION) {
    try {
      $notification.post(SCRIPT_NAME, "会员已解锁",
                        TAG_NAMES[CONFIG.targetTag] + " · patched " + changed.length + " fields");
      prefSet(PREF_NOTIFIED, SCRIPT_VERSION);
    } catch (e) {}
  }

  return finish(JSON.stringify(body));
}

try {
  run();
} catch (error) {
  log("fatal: " + error);
  finish(getResponseBody());
}
