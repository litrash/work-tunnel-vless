/*
 * 无忧云盘 VIP 破解脚本
 * 适用: Loon / Quantumult X / Shadowrocket
 *
 * Loon 配置:
 *   [Script]
 *   http-response ^http://www\\.wuxueyun\\.com/center/vip/ script-path=https://raw.../vip_mitm.js, requires-body=true, tag=无忧云盘VIP
 *
 * Quantumult X 配置:
 *   [rewrite_remote]
 *   http-response ^http://www\\.wuxueyun\\.com/center/vip/ requires-body=true, script-path=.../vip_mitm.js, tag=无忧云盘VIP
 *
 * Shadowrocket 配置:
 *   [URL Rewrite] 不适用, 用 MITM + Script
 */

const url = $request.url;
const method = $request.method;

// 只处理无忧云盘的 VIP API
if (url.indexOf('/center/vip/') === -1) {
    $done({});
    return;
}

// let body = $response.body;
// 注意: 部分工具用 $response.body, 部分用 $response.bodyString
let body = $response.body || $response.bodyString || '';
if (!body) {
    $done({});
    return;
}

try {
    let obj = JSON.parse(body);
    const TS = Date.now();

    // === 1. vipInfo ===
    if (url.indexOf('/center/vip/vipInfo') !== -1) {
        obj = {
            "code": 200,
            "msg": "success",
            "data": {
                "isVip": true,
                "expireDay": "2099-12-31",
                "isRotationKfk": false,
                "autoProductIds": [
                    "com.twuyou.vip.monthly",
                    "com.twuyou.svip.monthly"
                ],
                "expireTime": 4102444800
            }
        };

    // === 2. product ===
    } else if (url.indexOf('/center/vip/product') !== -1) {
        obj = {
            "code": 200,
            "msg": "success",
            "data": [
                {
                    "productId": "com.twuyou.vip.monthly",
                    "productName": "VIP - \xe4\xbc\x9a\xe5\x91\x98",
                    "price": 0.01,
                    "promotPrice": 0.01
                },
                {
                    "productId": "com.twuyou.svip.monthly",
                    "productName": "SVIP - \xe8\xb6\x85\xe7\xba\xa7\xe4\xbc\x9a\xe5\x91\x98",
                    "price": 0.01,
                    "promotPrice": 0.01
                }
            ]
        };

    // === 3. verifyOrder ===
    } else if (url.indexOf('/center/vip/verifyOrder') !== -1) {
        obj = {
            "code": 200,
            "msg": "success",
            "data": {
                "isVip": true,
                "verifyResult": true,
                "transactionId": "FAKE_TX_" + TS
            }
        };

    // === 4. createOrder ===
    } else if (url.indexOf('/center/vip/createOrder') !== -1) {
        obj = {
            "code": 200,
            "msg": "success",
            "data": {
                "orderId": "FAKE_ORDER_" + TS
            }
        };

    // === 5. verifyOrderBefore ===
    } else if (url.indexOf('/center/vip/verifyOrderBefore') !== -1) {
        obj = {
            "code": 200,
            "msg": "success",
            "data": {
                "canOrder": true,
                "needVerify": false
            }
        };
    }

    $done({ body: JSON.stringify(obj) });

} catch (e) {
    console.log("[VIP Crack] parse error: " + e);
    $done({});
}
