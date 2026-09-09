/**
 * oss-upload.mjs —— 用阿里云官方 ali-oss SDK 上传对象
 *
 * 与同目录另两个文件的区别：
 * - ali-oss 是阿里云「专用」SDK，只能连阿里云 OSS，需要真实云账号
 *   （Region、AccessKey ID/Secret、Bucket 都必须存在于你的阿里云账号下）
 * - 对比：minio-upload.mjs 面向本地自建存储；s3-upload.mjs 走通用 S3 协议
 *
 * 本文件要点：
 * - 全部配置来自环境变量（.env）：OSS_REGION / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET
 * - authorizationV4: true 表示使用 OSS 的 V4 签名算法（部分新地域强制要求）
 * - putStream 默认走 chunked encoding（HTTP 分块传输），适合大文件流式上传
 */
import 'dotenv/config';
import OSS from 'ali-oss';
import fs from 'fs';

// region 填 Bucket 所在地域，例如华东1（杭州）填 oss-cn-hangzhou
const client = new OSS({
  // yourRegion填写Bucket所在地域。以华东1（杭州）为例，Region填写为oss-cn-hangzhou。
  region: process.env.OSS_REGION,
  accessKeyId: process.env.OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  authorizationV4: true,        // 使用 V4 签名；老项目若为 V1 需去掉并对照官方文档
  bucket: process.env.OSS_BUCKET,
});

/**
 * 流式上传本地文件
 * - putStream 接口：SDK 会发起一个 chunked encoding 的 HTTP PUT 请求，边读边传
 * - key 形如 'aaa/bbb/first.png'：是对象的「完整路径」，不能包含 Bucket 名称
 */
async function putStream () {
  try {
    // 使用chunked encoding。使用putStream接口时，SDK默认会发起一个chunked encoding的HTTP PUT请求。
    let stream = fs.createReadStream('./zao.png');
    // 填写Object完整路径，例如exampledir/exampleobject.txt。Object完整路径中不能包含Bucket名称。
    let result = await client.putStream('aaa/bbb/first.png', stream);
    console.log(result);
  } catch (e) {
    console.log(e)
  }
}

putStream();
