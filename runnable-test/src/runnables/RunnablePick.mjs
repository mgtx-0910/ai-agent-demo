/**
 * RunnablePick - 从对象中挑选指定字段
 * 
 * new RunnablePick(["name", "fullInfo"]) 从输入对象中只保留指定 key，
 * 过滤掉其他字段。适合在 chain 中间精简数据、减少后续步骤的输入噪音。
 * 
 * @see RunnablePassthrough.mjs    — 反向操作：追加字段而非删减
 */
import 'dotenv/config';
import { RunnablePick, RunnableSequence } from "@langchain/core/runnables";

// 测试输入：包含大量字段的原始对象
const inputData = {
  name: "神光",
  age: 30,
  city: "北京",
  country: "中国",
  email: "shenguang@example.com",
  phone: "+86-13800138000",
};

// 数据流向：inputData → 拼接 fullInfo 字段 → 只保留 name + fullInfo
const chain = RunnableSequence.from([
  (input) => ({                          // 1. 在原对象基础上追加 fullInfo
    ...input,
    fullInfo: `${input.name}，${input.age}岁，来自${input.city}`,
  }),
  new RunnablePick(["name", "fullInfo"]), // 2. 过滤：只保留 name 和 fullInfo，丢弃其余字段
]);

// 输出: { name: "神光", fullInfo: "神光，30岁，来自北京" }
const result = await chain.invoke(inputData);
console.log(result);
