/**
 * minio-upload.mjs —— 用 MinIO 官方 SDK 上传对象
 *
 * 项目定位：oss-test 是「对象存储上传客户端」对比演示项目，同一张 zao.png
 * 用三种 SDK 各传一份，验证不同接入方式：
 *   1. minio-upload.mjs  官方 minio SDK  → 直连本地自建 MinIO / RustFS（见 docker-compose.yml）
 *   2. oss-upload.mjs    阿里云 ali-oss  → 只能连阿里云 OSS（需真实云账号）
 *   3. s3-upload.mjs     AWS S3 SDK v3   → 走通用 S3 协议，本地私有存储与云厂商通吃
 *
 * 本文件要点：
 * - 连接参数中 endPoint / port / useSSL 写死指向本地容器（9000 是 S3 API 端口，非控制台 9001）
 * - 账号密钥从 .env 读取：MINIO_ACCESS_KEY / MINIO_SECRET_KEY（见 .env.example）
 * - putObject 支持直接传「文件流」，边读边传，不会把整个文件一次性读进内存
 */
import 'dotenv/config';
import fs from 'fs';
import * as Minio from 'minio';

// 初始化 MinIO 客户端：docker-compose 起的 rustfs 兼容 MinIO/S3 API，故可直接连
const minioClient = new Minio.Client({
  endPoint: 'localhost',                              // 容器跑在本机，指向 localhost
  port: 29000,                                        // 宿主映射端口（9000 在 Windows 保留段、19000 已被 minio-dev 占用）
  useSSL: false,                                      // 本地走 http 明文；线上必须 true
  accessKey: process.env.MINIO_ACCESS_KEY,            // 账号密钥建议放 .env，别写死在代码里
  secretKey: process.env.MINIO_SECRET_KEY,
})

/**
 * 用「可读流」上传文件
 * - 参数1 'aaa'：bucket 名称，需提前手动创建（MinIO/RustFS 不会自动建桶）
 * - 参数2 'ccc/ddd/hello.png'：对象 key。其中的 '/' 只会在控制台里展示成"文件夹层级"，
 *   实际上并不存在真实目录，key 只是一串带斜杠的字符串
 * - 参数3 stream：fs.createReadStream 产出的可读流，SDK 会分块读走上传
 */
async function putStream() {
    try {
        const stream = fs.createReadStream('./zao.png');          // 本地文件 → 可读流（相对当前工作目录）
        const result = await minioClient.putObject('aaa', 'ccc/ddd/hello.png', stream);
        console.log(result);        // 成功会返回 etag（对象指纹）等元信息
        console.log('上传成功');
    } catch (err) {
        console.log(err);           // 失败常见原因：bucket 不存在 / 密钥不符 / 9000 没起服务
    }
}

putStream();
