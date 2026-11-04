/******************************
脚本名称：磁力宅智存 会员解锁
Version  : v1.0.0
更新时间：2026-10-30
作者：—
Platform : Quantumult X / Loon / Surge / Shadowrocket
脚本功能：本地解锁 磁力宅智存 会员判定（倍速/去广告/付费墙/身份显示）
使用说明：MITM 重写 user/get_user_status_big 响应，打开 App 即生效。
         首次运行会把原始响应对齐打进日志，用于确认真实字段名。

[rewrite_local]
^https?:\/\/xiaozhai-v1\.miao2023\.cc\/nas_api\/user\/get_user_status_big url script-response-body https://raw.githubusercontent.com/USER/REPO/main/scripts/cilizhai/cilizhai.js

[MITM]
hostname = xiaozhai-v1.miao2023.cc
*******************************/

// ========== 三端平台识别 ==========
var isQX = typeof $task !== "undefined";
var isLoon = typeof $loon !== "undefined";
var isSurge = typeof $httpClient !== "undefined" && !isLoon;
var isShadowrocket = !isQX && !isLoon && !isSurge && typeof $response !== "undefined";

// ========== Logger 模块 ==========
var Logger = {
  scriptStart: function (name, version, platform, requestType) {
    var now = new Date();
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var time = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) +
               " " + pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
    console.log("🚀 Script Start");
    console.log("Time     : " + time);
    console.log("Version  : " + version + " | " + platform + " | " + requestType);
    console.log("Platform : " + platform);
    console.log("------------------------------------");
  },

  field: function (label, value) {
    var padding = "              ";
    var key = (label + padding).substring(0, 14);
    console.log(key + ": " + value);
  },

  status: function (icon, text) { this.field("Status", icon + " " + text); },
  message: function (value) { this.field("Message", value); },
  separator: function () { console.log("------------------------------------"); },
  summary: function (total, success, failed, result) {
    console.log("📊 Summary");
    console.log("Total      : " + total);
    console.log("Success    : " + success);
    console.log("Failed     : " + failed);
    console.log("🎯 Result  : " + result);
    console.log("End");
  }
};

// ========== 常量区 ==========
var SCRIPT_NAME = "磁力宅智存";
var SCRIPT_VERSION = "v1.0.0";

// UserTag 枚举：0=free 1=member 2=eternal 3=supreme 4=diamond
var TARGET_TAG = 4;
var TAG_NAMES = ["free", "member", "eternal", "supreme", "diamond"];

// 到期时间往后推多少天
var EXTEND_DAYS = 3650;

// 首次运行打印原始响应（确认真实字段名后改成 false）
var DUMP_ORIGINAL = true;
var DUMP_LIMIT = 3000;

// 可选：改写 user_tags 数组。该字段可能是 UI 文案（如"钻石会员"），默认不动
var PATCH_USER_TAGS = false;

// 实测确认真实键名后填这里，优先级最高（示例：["isMember", "vipType", "expire_date"]）
var EXACT_TRUE_KEYS = [];
var EXACT_FALSE_KEYS = [];
var EXACT_TAG_KEYS = [];
var EXACT_TIME_KEYS = [];
var EXACT_NUM_KEYS = [];

// 键名模糊匹配（去 _ - 后小写比较），依据 Swift 反射表 ModelUserStatus / ModelUserGrade
var K_TRUE = [
  "ismemeber", "ismember", "isvip", "issvip", "issupreme", "ispremium", "ispaid",
  "vipflag", "memberflag", "svipflag", "hasvip", "hasmember", "usermember"
];
var K_FALSE = [
  "expired", "isexpired", "isvipexpired", "istrial", "istrying",
  "isspeedlimited", "viprequired", "sviprequired", "svipplusrequired"
];
var K_TAG = [
  "usertag", "tag", "membertype", "viptype", "gradetype", "leveltype",
  "memberlevel", "viplevel", "usergrade", "userlevel"
];
var K_NUM = ["gradelevel", "gradevalue", "advancedlevel", "advancedvalue"];
var K_TIME = [
  "expiredate", "expiretime", "expireat", "vipendtime", "vipenddate",
  "memberexpire", "svipendtime", "expire"
];

// ========== 工具函数 ==========
function getPlatform() {
  if (isQX) return "Quantumult X";
  if (isLoon) return "Loon";
  if (isSurge) return "Surge";
  if (isShadowrocket) return "Shadowrocket";
  return "Unknown";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function inList(list, value) {
  for (var i = 0; i < list.length; i++) {
    if (list[i] === value) return true;
  }
  return false;
}

function normalizeKey(key) {
  return String(key).replace(/[_\-]/g, "").toLowerCase();
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }

function getResponseBody() {
  return typeof $response !== "undefined" && $response.body ? $response.body : "";
}

function parseResponse(raw) {
  if (!raw) return null;
  try {
    var parsed = JSON.parse(raw);
    return isObject(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

// 类型保持：原值是数字/字符串/布尔就还同样的形态，避免解码器崩
function futureValue(original, days) {
  var ms = Date.now() + days * 86400000;
  var d = new Date(ms);

  if (typeof original === "number") {
    return original > 1e11 ? Math.floor(ms / 1000) * 1000 : Math.floor(ms / 1000);
  }
  if (typeof original === "string") {
    if (/^\d+$/.test(original)) {
      return original.length >= 13 ? String(ms) : String(Math.floor(ms / 1000));
    }
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
  if (typeof original === "number") return TARGET_TAG;
  if (typeof original === "string") {
    if (/^\d+$/.test(original)) return String(TARGET_TAG);
    return TAG_NAMES[TARGET_TAG] || "diamond";
  }
  if (typeof original === "boolean") return true;
  return TARGET_TAG;
}

function numValue(original) {
  if (typeof original === "number") return original < 99 ? 99 : original;
  if (typeof original === "string" && /^\d+$/.test(original)) return "99";
  return original;
}

// 关键：布尔类字段同样保持原类型，否则 Int 字段被写成 true 会让解码器整体失败
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

// ========== 核心：按已知字段表改写（保留一切未知字段）==========
var changed = [];
var seenPaths = {};

function mark(path) {
  if (seenPaths[path]) return;
  seenPaths[path] = true;
  changed.push(path);
}

function applyFields(node, path) {
  if (!isObject(node) && !Array.isArray(node)) return;

  // 数组：只下钻元素里的对象，不改数组本身
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

    // 可选：user_tags 是标签数组，可能是 UI 文案，默认不动
    if (PATCH_USER_TAGS && nk === "usertags" && Array.isArray(value)) {
      var label = TAG_NAMES[TARGET_TAG] || "diamond";
      for (var j = 0; j < value.length; j++) {
        if (typeof value[j] === "string" && value[j] !== label) value[j] = label;
      }
      mark(p);
      continue;
    }

    // 精确规则优先
    if (inList(EXACT_TRUE_KEYS, key))  { node[key] = trueValue(value);  mark(p); continue; }
    if (inList(EXACT_FALSE_KEYS, key)) { node[key] = falseValue(value); mark(p); continue; }
    if (inList(EXACT_TAG_KEYS, key))   { node[key] = tagValue(value); mark(p); continue; }
    if (inList(EXACT_TIME_KEYS, key))  { node[key] = futureValue(value, EXTEND_DAYS); mark(p); continue; }
    if (inList(EXACT_NUM_KEYS, key))   { node[key] = numValue(value); mark(p); continue; }

    // 对象/数组继续下钻（grade 这类嵌套对象在这里被覆盖）
    if (value !== null && typeof value === "object") {
      applyFields(value, p);
      continue;
    }

    if (inList(K_TIME, nk))  { node[key] = futureValue(value, EXTEND_DAYS); mark(p); continue; }
    if (inList(K_TAG, nk))   { node[key] = tagValue(value); mark(p); continue; }
    if (inList(K_TRUE, nk))  { node[key] = trueValue(value); mark(p); continue; }
    if (inList(K_FALSE, nk)) { node[key] = falseValue(value); mark(p); continue; }
    if (inList(K_NUM, nk))   { node[key] = numValue(value); mark(p); continue; }
  }
}

function buildResponse(raw) {
  var body = parseResponse(raw);
  if (!body) return null;

  changed = [];
  seenPaths = {};

  // 一次遍历即可覆盖 data / data 内数组 / 根层所有对象
  applyFields(body, "");

  // 若存在时间戳类字段，刷新一下，避免被缓存判定
  var stamps = ["ts", "timestamp", "serverTime", "server_time", "request_date"];
  for (var i = 0; i < stamps.length; i++) {
    if (Object.prototype.hasOwnProperty.call(body, stamps[i]) && typeof body[stamps[i]] === "number") {
      body[stamps[i]] = body[stamps[i]] > 1e11 ? Date.now() : Math.floor(Date.now() / 1000);
    }
  }

  return body;
}

// ========== 统一返回 ==========
function done(body) {
  $done({
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache"
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

// ========== 入口 ==========
function run() {
  Logger.scriptStart(SCRIPT_NAME, SCRIPT_VERSION, getPlatform(), "Response");

  var raw = getResponseBody();

  if (DUMP_ORIGINAL && raw) {
    Logger.field("Raw", raw.length > DUMP_LIMIT ? raw.substring(0, DUMP_LIMIT) + "..." : raw);
    Logger.separator();
  }

  var body = buildResponse(raw);

  if (!body) {
    Logger.status("❌", "JSON parse error");
    Logger.separator();
    Logger.summary(1, 0, 1, "Invalid response");
    return done(raw);
  }

  if (!changed.length) {
    Logger.status("⚠️", "No field matched");
    Logger.message("把上面的 Raw 里真实键名填入 EXACT_*_KEYS");
    Logger.separator();
    Logger.summary(1, 0, 1, "Need calibration");
    return done(body);
  }

  Logger.status("✅", "VIP unlocked");
  for (var i = 0; i < changed.length && i < 12; i++) {
    Logger.message("patched " + changed[i]);
  }
  if (changed.length > 12) {
    Logger.message("... +" + (changed.length - 12) + " more");
  }
  Logger.field("Expire", "+" + EXTEND_DAYS + " days");
  Logger.field("UserTag", TARGET_TAG + " (" + TAG_NAMES[TARGET_TAG] + ")");
  Logger.separator();
  Logger.summary(1, 1, 0, "Success");
  return done(body);
}

try {
  run();
} catch (error) {
  console.log("fatal:", error);
  done(getResponseBody());
}
