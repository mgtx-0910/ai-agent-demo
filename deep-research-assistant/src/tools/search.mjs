// ============================================================================
// src/tools/search.mjs — Bocha 联网搜索工具
//
// 将 Bocha AI 的 Web Search API 封装为 LangChain `tool`，
// 供 researcher 子 Agent 通过 `web_search` 工具调用。
// 所有失败场景都返回可读的中文错误字符串（而不是抛异常），
// 让模型能直接理解原因并决定下一步动作。
// ============================================================================
import { tool } from "langchain";
import { z } from "zod";

// Bocha Web Search API 端点
const BOCHA_API_URL = "https://api.bochaai.com/v1/web-search";

/**
 * 将 Bocha API 返回的网页结果数组格式化为模型易读的文本。
 * 每条结果包含：编号引用、标题、URL、摘要、网站名称、图标与发布时间。
 *
 * @param {Array<Object>} webpages - API 返回的 `data.webPages.value` 数组
 * @returns {string} 编号引用格式的搜索结果文本
 */
function formatWebPages(webpages) {
  return webpages
    .map(
      (page, idx) =>
        `引用: ${idx + 1}
标题: ${page.name ?? ""}
URL: ${page.url ?? ""}
摘要: ${page.summary ?? ""}
网站名称: ${page.siteName ?? ""}
网站图标: ${page.siteIcon ?? ""}
发布时间: ${page.dateLastCrawled ?? ""}`,
    )
    .join("\n\n");
}

/**
 * 调用 Bocha 搜索 API 并处理各种失败场景。
 *
 * @param {string} query - 搜索关键词（中文优先）
 * @param {number} count - 期望返回的结果条数
 * @returns {Promise<string>} 格式化后的搜索结果，或中文错误提示
 */
async function bochaWebSearch(query, count) {
  // 未配置密钥时直接返回提示，避免无谓的网络请求
  const apiKey = process.env.BOCHA_API_KEY?.trim();
  if (!apiKey) {
    return "Bocha 联网搜索的 API Key 未配置（环境变量 BOCHA_API_KEY），请先在 .env 中配置后再重试。";
  }

  // 调用 Bocha Web Search API
  const response = await fetch(BOCHA_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      freshness: "noLimit", // 不限时效，由模型自行判断信息新旧
      summary: true, // 请求返回网页摘要
      count,
    }),
  });

  // HTTP 层失败
  if (!response.ok) {
    const errorText = await response.text();
    return `搜索 API 请求失败，状态码: ${response.status}，错误信息: ${errorText}`;
  }

  // 解析响应体
  let json;
  try {
    json = await response.json();
  } catch (e) {
    return `搜索 API 请求失败，原因是：搜索结果解析失败 ${e.message}`;
  }

  try {
    // 业务层失败：Bocha 返回 code !== 200
    if (json.code !== 200 || !json.data) {
      return `搜索 API 请求失败，原因是: ${json.msg ?? "未知错误"}`;
    }

    // 成功但无结果
    const webpages = json.data.webPages?.value ?? [];
    if (!webpages.length) {
      return `未找到与「${query}」相关的结果。`;
    }

    // 格式化输出结果
    return formatWebPages(webpages);
  } catch (e) {
    return `搜索 API 请求失败，原因是：搜索结果解析失败 ${e.message}`;
  }
}

// 导出 LangChain 工具：web_search（含 zod 参数校验 schema）
export const webSearch = tool(
  async (input) => {
    const count = input.count ?? 10; // 默认返回 10 条结果
    console.log(`  🔎 搜索: ${input.query}（${count} 条）`);
    return bochaWebSearch(input.query, count);
  },
  {
    name: "web_search",
    description:
      "使用 Bocha 联网搜索 API 检索互联网网页。输入中文或中英结合的搜索关键词，可选 count 指定结果数量。返回标题、URL、摘要、网站名称、图标和发布时间。",
    schema: z.object({
      query: z
        .string()
        .min(1)
        .describe("搜索关键词，优先使用中文，例如：2026年 AI Agent 框架对比、LangGraph 最新动态"),
      count: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("返回的搜索结果数量，默认 10 条"),
    }),
  },
);
