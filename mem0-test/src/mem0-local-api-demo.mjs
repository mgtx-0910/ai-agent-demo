/**
 * 本地部署版 Mem0 OpenAPI 演示（自写 fetch 客户端）
 *
 * mem0ai SDK 主要面向 Mem0 云端；本示例针对本地 docker 起的 mem0 服务
 * （默认 http://localhost:8888）直接用 HTTP 调用其 OpenAPI：
 *   POST   /memories   写入记忆
 *   GET    /memories   列出记忆（按 user_id / run_id / agent_id 过滤）
 *   POST   /search     语义搜索
 *   DELETE /memories   删除记忆
 *
 * 前置：本地 mem0 服务已启动；.env 配置 MEM0_LOCAL_API_KEY（服务端未开鉴权可留空）
 * 运行：node src/mem0-local-api-demo.mjs             （add）
 *        node src/mem0-local-api-demo.mjs search     （search）
 *        node src/mem0-local-api-demo.mjs list       （list）
 *        node src/mem0-local-api-demo.mjs --cleanup  （cleanup）
 */
import "dotenv/config";

// 本地 mem0 服务地址（末尾斜杠会被客户端自动去掉）
const BASE_URL = "http://localhost:8888"
// 演示用用户标识：记忆按该 id 隔离
const USER_ID = "local_api_demo";
// 服务端 API Key（写入 X-API-Key 请求头），未开启鉴权时可留空
const API_KEY = process.env.MEM0_LOCAL_API_KEY || '';

function log(title, data) {
  console.log(`\n=== ${title} ===`);
  console.log(typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

/** 针对本地 mem0 OpenAPI 的最小客户端（云 SDK 的本地替代实现） */
class LocalMem0Client {
  constructor({ baseUrl = BASE_URL, apiKey = API_KEY } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  // 统一请求头：JSON 内容 + 可选的 X-API-Key 鉴权
  headers() {
    const h = { "Content-Type": "application/json" };
    if (this.apiKey) h["X-API-Key"] = this.apiKey;
    return h;
  }

  // 封装 fetch：拼 baseUrl、自动 JSON 解析、非 2xx 抛错（优先透出服务端 detail）
  async request(path, options = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...this.headers(), ...options.headers },
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const detail = typeof body === "object" ? body.detail ?? JSON.stringify(body) : body;
      throw new Error(`${res.status} ${detail}`);
    }
    return body;
  }

  // 写入记忆：messages 为多轮对话；userId/runId/agentId 决定记忆归属的 scope
  async add(messages, { userId, runId, agentId, metadata, infer } = {}) {
    const payload = {
      messages: typeof messages === "string"
        ? [{ role: "user", content: messages }]
        : messages,
      user_id: userId,
      run_id: runId,
      agent_id: agentId,
      metadata,
      infer,
    };
    return this.request("/memories", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // 列出记忆：支持 userId / runId / agentId 过滤（filters 兼容 SDK 的写法）
  async getAll({ filters, userId, runId, agentId } = {}) {
    const params = new URLSearchParams();
    const uid = userId ?? filters?.user_id;
    const rid = runId ?? filters?.run_id;
    const aid = agentId ?? filters?.agent_id;
    if (uid) params.set("user_id", uid);
    if (rid) params.set("run_id", rid);
    if (aid) params.set("agent_id", aid);
    const qs = params.toString();
    return this.request(`/memories${qs ? `?${qs}` : ""}`);
  }

  // 语义搜索：threshold 为相似度阈值；explain=true 返回匹配详情
  async search(query, { filters, topK = 5, threshold, explain } = {}) {
    return this.request("/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        filters,
        top_k: topK,
        threshold,
        explain,
      }),
    });
  }

  // 按 scope（user_id / run_id / agent_id）删除记忆
  async deleteAll({ userId, runId, agentId } = {}) {
    const params = new URLSearchParams();
    if (userId) params.set("user_id", userId);
    if (runId) params.set("run_id", runId);
    if (agentId) params.set("agent_id", agentId);
    return this.request(`/memories?${params}`, { method: "DELETE" });
  }
}

async function main() {
  const client = new LocalMem0Client();
  // 第二个命令行参数决定动作：add / search / list / --cleanup
  const action = process.argv[2] ?? "add";

  // --cleanup：删除该用户全部记忆
  if (process.argv.includes("--cleanup")) {
    log("清理测试数据", await client.deleteAll({ userId: USER_ID }));
    return;
  }

  // add：写入一组示例对话，交给本地服务抽取并保存事实
  if (action === "add") {
    const added = await client.add(
      [
        { role: "user", content: "我是素食主义者，而且对坚果过敏。" },
        { role: "assistant", content: "好的，我会记住你的饮食偏好。" },
        { role: "user", content: "我住在北京，平时喜欢跑步。" },
        { role: "assistant", content: "已记录：北京、爱好跑步。" },
      ],
      { userId: USER_ID },
    );
    log("添加记忆", added);
    return;
  }

  // search：语义搜索该用户已有记忆
  if (action === "search") {
    log(
      "搜索记忆",
      await client.search("用户的饮食限制是什么？", {
        filters: { user_id: USER_ID },
        topK: Number(process.env.MEM0_TOP_K ?? 5),
      }),
    );
    return;
  }

  // list：直接列出该用户全部记忆
  if (action === "list") {
    log("列出全部记忆", await client.getAll({ filters: { user_id: USER_ID } }));
    return;
  }

  console.error(`未知命令: ${action}，可用: add | search | list | --cleanup`);
  process.exit(1);
}

main().catch((error) => {
  console.error("\n执行失败:", error.message ?? error);
  process.exit(1);
});
