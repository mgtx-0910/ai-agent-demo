# oss-test —— 对象存储上传客户端对比

一个学习向的对比实验项目：**同一张 `zao.png`，用三种不同 SDK 各上传一次**，理解"对象存储接入"的几种常见姿势。

```
上传前：./zao.png（本地文件）
                │
        ┌───────┼───────────────────┐
        ▼       ▼                   ▼
 minio SDK   ali-oss SDK        AWS S3 SDK
 (MinIO系)   (阿里云 OSS)      (通用 S3 协议)
        │       │                   │
        ▼       ▼                   ▼
   本地 rustfs  阿里云云端 Bucket   本地 rustfs
```

## 为什么有三份代码

对象存储（OSS / S3）领域 SDK 很多，本质模型却一致：`endpoint（服务地址）+ AK/SK（密钥）+ bucket（桶）+ key（对象路径）`。本项目的三个脚本正是围绕"接入方式差异"展开：

| 文件 | SDK | 能连谁 | 配置来源 |
|---|---|---|---|
| `src/s3-upload.mjs` | `@aws-sdk/client-s3` (v3) | **最通用**：RustFS、MinIO、阿里云 OSS(兼容)、任何 S3 协议服务 | `.env` 的 `S3_*` |
| `src/oss-upload.mjs` | `ali-oss` | 仅阿里云 OSS（需真实云账号） | `.env` 的 `OSS_*` |
| `src/minio-upload.mjs` | `minio` | MinIO / RustFS 等本地 S3 服务 | `.env` 的 `MINIO_*` |

> 核心认知：**S3 不只是一个产品，而是一套协议**。AWS 官方 SDK 因为协议兼容性反而成了对接各种私有存储的通用钥匙。

## 目录结构

```
oss-test/
├── docker-compose.yml    # 本地 S3 服务 rustfs（控制台 29001 / API 29000），minio 版被注释保留
├── .env.example          # 环境变量模板（复制为 .env 使用）
├── zao.png               # 被上传的测试图片
└── src/
    ├── s3-upload.mjs     # 通用 S3 协议上传（推荐首选示例）
    ├── oss-upload.mjs    # 阿里云 OSS 上传
    └── minio-upload.mjs  # MinIO SDK 上传
```

> 端口说明：宿主机映射选 `29000`（S3 API）/ `29001`（Web 控制台），容器内部仍是 9000/9001。
> 为什么不用常规端口：
> - `9000/9001` 落在这台机器的 **Windows 保留段（8947-9046）** 内，宿主机无法绑定；
> - `19000/19001` 已被已有的 `minio-dev` 容器占用。

## 快速开始

前置：本机有 Node.js 与 Docker。

```bash
# 1. 安装依赖（AWS S3 SDK / ali-oss / minio / dotenv）
npm install

# 2. 准备环境变量
cp .env.example .env
#   然后编辑 .env 填入你的密钥（本地 S3_* 组用默认 admin / Admin@123456 即可）

# 3. 启动本地对象存储（rustfs：宿主 API 29000 + Web 控制台 29001）
docker compose up -d
#   浏览器打开 http://localhost:29001
#   默认账号 admin / Admin@123456

# 4. 在控制台里先创建 bucket：hello、aaa
#    （MinIO/RustFS 不会自动建桶，不建会报 BucketNotFound）
```

### 运行上传脚本

```bash
# 通用 S3 协议版（上传到本地 rustfs 的 hello 桶，key = aaa/bbb/first.png）
node src/s3-upload.mjs

# MinIO SDK 版（上传到 aaa 桶，key = ccc/ddd/hello.png）
node src/minio-upload.mjs

# 阿里云 OSS 版（需真实云账号，上传到 .env 里 OSS_BUCKET 的 aaa/bbb/first.png）
node src/oss-upload.mjs
```

### 验证上传结果

- 控制台方式：`http://localhost:29001` → 找到对应 bucket，应能看到 `first.png` / `hello.png`
- 直接下载：`http://localhost:29000/<bucket>/<key>`，如 `http://localhost:29000/hello/aaa/bbb/first.png`
- 命令行方式：`curl.exe http://localhost:29000/hello/aaa/bbb/first.png -o down.png`

## 一次上传背后的数据流

以 `s3-upload.mjs` 为例，一次上传经历了这些环节：

```
本地文件 zao.png
   │  fs.createReadStream()       ① 读出「可读流」（边读边传，不进内存）
   ▼
PutObjectCommand { Bucket, Key, Body, ContentType }
   │  s3Client.send(cmd)          ② 组装 S3 请求（Signature V4 签名）
   ▼
HTTP PUT http://localhost:29000/hello/aaa/bbb/first.png
   │                             ③ 寻址方式 = path-style（forcePathStyle）
   ▼
rustfs 落盘                   ④ 存储服务校验密钥后写入
   │
   ▼
返回 etag / 控制台可见           ⑤ 成功信号
```

关键名词：

- **endpoint**：存储服务地址。本地私有存储必须带协议+端口（`http://localhost:29000`）；连云厂商可省略或用服务商地址。
- **bucket（桶）**：存储空间，相当于顶层"文件夹"，需提前创建。
- **key（对象路径）**：桶内的完整路径字符串，`aaa/bbb/first.png` 里的 `/` 只是展示成层级，不是真实目录。
- **forcePathStyle**：请求用 `host/bucket/key` 而非 `bucket.host/key`，本地私有存储基本都要求 `true`。
- **Body 传流**：三个 SDK 都支持直接传可读流，大文件不必整读进内存。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 连本地存储失败 / 连接被拒 | rustfs 容器没起：先 `docker compose up -d`；确认端口是 29000（API）不是 29001 |
| `BucketNotFound` / `NoSuchBucket` | bucket 没提前建，控制台 29001 建好再传 |
| S3 版报 endpoint 解析错误 | `.env` 里 `S3_ENDPOINT` 需带协议与端口，写成 `http://localhost:29000` |
| `AccessDenied` / 签名不匹配 | `.env` 密钥与 docker-compose 里 `RUSTFS_ACCESS_KEY/SECRET_KEY` 不一致（默认 `admin` / `Admin@123456`） |
| 想用回 9000/9001 被拒绝 | 9000/9001 在 Windows 保留段（8947-9046）内宿主机绑不了，属系统限制而非配置错误 |
| 19000/19001 也提示被占用 | 它们已被本机另一个 `minio-dev` 容器映射，换 29000/29001 即可 |
| 阿里云版报 403 | `authorizationV4: true` 与地域/账号版本不匹配，或 AK/SK/Bucket 不属于当前账号 |
| region 填什么 | 连本地私有存储时随便填不影响；连云厂商必须填真实地域（如 `oss-cn-hangzhou`） |

## 备注

- 三个脚本内部注释详细解释了每步语义，建议从 `s3-upload.mjs` 读起（最通用、可迁移到任何 S3 服务）。
- `docker-compose.yml` 中默认使用 RustFS（轻量 S3 兼容服务），同文件里保留了 MinIO 的注释配置，想换 MinIO 时取消注释并注释掉 rustfs 段即可。
- 本机另有一个长期运行的 `minio-dev` 容器（宿主 `19000/19001`），若它与你其它项目的密钥一致，也可以直接复用它做本地存储，不必再起 rustfs。
- 本地环境的 `S3_ENDPOINT`、`MINIO_*` 仅本地测试用；`OSS_*` 涉及你的真实云资源，**切勿提交 `.env` 到仓库**。
