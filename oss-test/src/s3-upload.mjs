/**
 * s3-upload.mjs —— 用 AWS S3 SDK v3（@aws-sdk/client-s3）上传对象
 *
 * 为什么用 AWS 的 SDK 传"非 AWS"的服务？
 * 因为 S3 不只是一个产品，更是一套被广泛兼容的「对象存储协议」：
 * RustFS、MinIO、阿里云 OSS（兼容模式）、腾讯 COS 等都实现了它。
 * 客户端只需知道 endpoint（服务地址）和密钥，就能对接任意实现——
 * endpoint 指到哪，数据就传到哪：
 *   - 本地：S3_ENDPOINT 指向 docker-compose 起的 rustfs（http://localhost:9000）
 *   - 云端：填服务商地址（AWS 本身可省略 endpoint），AK/SK 换成对应的
 *
 * 对比同目录文件：
 *   - minio-upload.mjs：官方 minio SDK（只能连 MinIO 系服务）
 *   - oss-upload.mjs：阿里云 ali-oss（只能连阿里云 OSS）
 *   - 本文件：最通用的 S3 协议方案，一套代码通吃
 */
import 'dotenv/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';

// 初始化统一S3客户端（RustFS/MinIO/阿里云OSS通用）
const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,            // 本地私有存储需带协议+端口，如 http://localhost:9000
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  // path-style 寻址：请求形如 http://host/<bucket>/<key>，本地私有存储几乎都要求 true；
  // 云厂商新版多用 virtual-host 风格（bucket.host），连真 AWS 时可去掉此项
  forcePathStyle: true,
  signatureVersion: 'v4',                       // 使用 AWS Signature V4 签名
  region: 'aaa' // 本地私有存储随便填，不影响
});

/**
 * 文件流上传
 * @param {string} objectKey 对象路径 aaa/bbb/first.png
 * @param {ReadableStream} stream fs可读流
 * @param {string} contentType 文件类型（图片/pdf等）
 */
async function putStream(objectKey, stream, contentType = 'image/png') {
  try {
    const uploadCmd = new PutObjectCommand({
      Bucket: 'hello',                          // bucket 名：本地存储需先手动创建 'hello'
      Key: objectKey,                           // 对象 key：bucket 内的完整路径
      Body: stream,                             // 直接传可读流，SDK 自动分块发送
      ContentType: contentType                  // 声明文件 MIME，控制台预览/下载依赖它
    });
    await s3Client.send(uploadCmd);             // send 是 S3 v3 的统一执行入口
    console.log('上传成功');
  } catch (err) {
    console.error('上传失败', err);
    throw err;                                  // 失败向上抛，便于调用方感知（当前 main 未捕获）
  }
}

async function main() {
  // 相对当前工作目录（npm/终端在 oss-test 下运行时指向 oss-test/zao.png）
  const stream = fs.createReadStream('./zao.png');
  await putStream('aaa/bbb/first.png', stream, 'image/png');
}

main();
