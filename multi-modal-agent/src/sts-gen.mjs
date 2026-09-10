/**
 * OSS 直传签名服务 — 服务端「签发上传凭证」
 * =====================================================================
 * 用途：前端页面（public/index.html）不携带任何 AK/SK，直接 POST 文件到阿里云 OSS。
 *       但 OSS 要求每个上传请求都必须签名，所以由「可信的服务端」用主账号 AK/SK
 *       算好一份 policy + signature 下发给前端，前端拿着它去传文件。
 *
 * 运行：node src/sts-gen.mjs
 * 前置：.env 中 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
 * 输出：{ policy, signature, ... } 与上传用的 host（打印到控制台）
 *
 * 重要区分（别被文件名误导）：
 *   本脚本用的是 OSS 的「PostObject 表单直传」= calculatePostSignature：
 *     - 服务端只下发 一个策略(policy) + 一个签名(signature) + 主账号 AccessKeyId；
 *     - 有效期由 policy 里的 expiration 控制；签名是「一次上传」的授权，不是长期凭证。
 *   而真正的「STS」是另一条链路（assumeRole → 返回临时 AccessKeyId/Secret/Token）。
 *   两者都能实现前端直传，本项目演示的是更简单的 PostObject 方案。
 *
 * 安全提醒：
 *   - AccessKeySecret 绝不能进前端；只把 AccessKeyId + signature + policy 给前端；
 *   - policy 里的 conditions 决定了权限边界，本例只限制了文件大小上限；
 *   - 生产环境应把 expiration 设短（如 5 分钟），并限制 key 前缀、回调地址。
 * =====================================================================
 */
import 'dotenv/config';
import OSS from 'ali-oss';

async function main() {

    // 客户端配置：region/bucket 决定签名对应的目标存储空间
    // 注意：这两个字段目前是硬编码的，换 bucket 时要同步修改（也可提到 .env 里）
    const config = {
        region: 'oss-cn-beijing',
        bucket: 'yicheng-resume',
        accessKeyId: process.env.OSS_ACCESS_KEY_ID,         // 主账号 AK（会下发给前端）
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET, // 主账号 SK（绝不外泄）
    }

    const client = new OSS(config);

    // 计算凭证的过期时间：当前时间 + 1 天
    // 生产环境建议缩短到分钟级（如 5~15 分钟），降低凭证被滥用的风险
    const date = new Date();

    date.setDate(date.getDate() + 1);

    // 生成 PostObject 直传所需的 policy + signature
    //   - expiration：过了这个时间点，这份签名作废
    //   - conditions：对上传行为施加的限制（这里是文件大小区间）
    const res = client.calculatePostSignature({
        expiration: date.toISOString(), // ISO 8601 格式，如 2026-09-11T02:23:39.678Z
        conditions: [
            ["content-length-range", 0, 1048576000], // 允许上传 0 ~ 1GB 的文件      
        ]
    });

    // res 里包含 OSSAccessKeyId / policy / signature，正是前端 formdata 要用的字段
    console.log(res);

    // 查询桶所在的地域，用于拼出最终的上传地址
    // 说明：这里返回的 location 就是 region（如 oss-cn-beijing）
    const location = await client.getBucketLocation();

    // 上传地址格式必须是 https://<bucket>.<region>.aliyuncs.com
    // 注意两点：
    //   1) 建议用 https（公网上传走明文 http 会被浏览器/安全策略拦截）；
    //   2) 该 host 必须与签名使用的 bucket/region 完全一致，否则签名校验失败。
    const host = `http://${config.bucket}.${location.location}.aliyuncs.com`;

    console.log(host);
}

main();
