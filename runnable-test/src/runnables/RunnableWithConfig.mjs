/**
 * RunnableWithConfig - withConfig() 绑定配置 + configurable 动态注入参数
 * 
 * .withConfig({ configurable: { key: value } }) 在构建时预设配置参数。
 * lambda 的第二个参数 config 可获取 runtime 传入的配置，结合时 runtime 值覆盖构建期默认值。
 * 适合需要根据环境/用户切换行为的场景——构建期设默认，运行时按需覆盖。
 * 
 * @see RunnableLambda.mjs         — 基础：lambda 只读取 input，不处理 config
 */
import "dotenv/config";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";

// 模拟一个简单的"用户数据库"
const mockUsers = new Map([
  [
    "user-123",
    {
      id: "user-123",
      name: "神光",
      email: "guang@example.com",
    },
  ],
]);

// 节点1：根据 config.configurable.userId 查用户
const fetchUserFromConfig = RunnableLambda.from(async (input, config) => {
  const userId = config?.configurable?.userId;

  console.log("【节点1】收到了通知内容:", input);
  console.log("【节点1】从 config 里拿到 userId:", userId);

  const user = userId ? mockUsers.get(userId) : null;

  if (!user) {
    throw new Error("未找到用户，无法发送通知");
  }

  return {
    user,
    notification: input,
  };
});

// 节点2：根据 config.configurable.role 做权限判断
const checkPermissionByRole = RunnableLambda.from(async (state, config) => {
  const role = config?.configurable?.role ?? "普通用户";

  console.log("【节点2】当前角色:", role);

  const canSend =
    role === "管理员" ||
    role === "运营" ||
    role === "系统";

  if (!canSend) {
    throw new Error(`角色「${role}」无权限发送系统通知`);
  }

  return {
    ...state,
    role,
  };
});

// 节点3：根据 locale 生成最终通知文案
const formatNotificationByLocale = RunnableLambda.from(async (state, config) => {
  const locale = config?.configurable?.locale ?? "zh-CN";

  console.log("【节点3】locale:", locale);

  let content;
  if (locale === "en-US") {
    content = `Dear ${state.user.name},\n\n${state.notification}\n\n(from role: ${state.role})`;
  } else {
    content = `亲爱的 ${state.user.name}，\n\n${state.notification}\n\n（发送人角色：${state.role}）`;
  }

  return {
    ...state,
    locale,
    finalContent: content,
  };
});

// 数据流向：通知文案 → 查用户 → 权限校验 → 按 locale 格式化 → 最终通知内容
const chain = RunnableSequence.from([
  fetchUserFromConfig,        // 1. 根据 config.configurable.userId 查用户
  checkPermissionByRole,      // 2. 根据 config.configurable.role 判断是否有发送权限
  formatNotificationByLocale, // 3. 根据 config.configurable.locale 生成对应语言的通知文案
]);

// 配置 A：中文通知，管理员角色
const chainWithConfig = chain.withConfig({
  tags: ["demo", "withConfig", "notification"],
  metadata: { demoName: "RunnableWithConfig" },
  configurable: {
    userId: "user-123",  // 要查询的用户 ID
    role: "管理员",      // 发送权限角色
    locale: "zh-CN",     // 生成中文文案
  },
});

// 配置 B：英文通知，运营角色（展示同一 chain 绑定不同 config 的效果）
const chainWithConfig2 = chain.withConfig({
  tags: ["demo", "withConfig", "notification-en"],
  metadata: { demoName: "RunnableWithConfig2" },
  configurable: {
    userId: "user-123",
    role: "运营",
    locale: "en-US",     // 生成英文文案
  },
});

// 执行配置 A：输入为通知文案，config 中的 userId/role/locale 决定如何处理
const result = await chainWithConfig.invoke("你有一条新的系统通知，请及时查看。");
console.log("✅ 最终通知内容:\n", result.finalContent);

console.log("\n--- chainWithConfig2 ---\n");

// 执行配置 B：同一 chain，不同 config → 不同行为
const result2 = await chainWithConfig2.invoke("System maintenance scheduled tonight.");
console.log("✅ 最终通知内容:\n", result2.finalContent);

