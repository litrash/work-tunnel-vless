/*
 * 无忧云盘VIP破解 - Loon 脚本
 * 功能: 拦截 /center/vip/vipInfo 等API，返回VIP会员状态
 */

const url = $request.url;

if (!url.includes('/center/vip/')) {
    $done({});
    return;
}

let body = $response.body;
if (!body) {
    $done({});
    return;
}

try {
    let obj = JSON.parse(body);
    const ts = Date.now();

    if (url.includes('/center/vip/vipInfo')) {
        obj = {
            code: 200,
            msg: "success",
            data: {
                isVip: true,
                expireDay: "2099-12-31",
                expireTime: 4102444800,
                isRotationKfk: false,
                autoProductIds: ["com.twuyou.vip.monthly", "com.twuyou.svip.monthly"]
            }
        };
    } else if (url.includes('/center/vip/product')) {
        obj = {
            code: 200,
            msg: "success",
            data: [
                { productId: "com.twuyou.vip.monthly", productName: "VIP会员", price: 0.01, promotPrice: 0.01 },
                { productId: "com.twuyou.svip.monthly", productName: "SVIP超级会员", price: 0.01, promotPrice: 0.01 }
            ]
        };
    } else if (url.includes('/center/vip/verifyOrder')) {
        obj = {
            code: 200, msg: "success",
            data: { isVip: true, verifyResult: true, transactionId: "FAKE_" + ts }
        };
    } else if (url.includes('/center/vip/createOrder')) {
        obj = {
            code: 200, msg: "success",
            data: { orderId: "FAKE_" + ts }
        };
    } else if (url.includes('/center/vip/verifyOrderBefore')) {
        obj = {
            code: 200, msg: "success",
            data: { canOrder: true, needVerify: false }
        };
    }

    $done({ body: JSON.stringify(obj) });
} catch (e) {
    $done({});
}
