/**
 * RunnablePassthrough - 透传输入，配合 .assign() 追加新字段
 * 
 * RunnablePassthrough 本身不做任何处理，直接返回输入。核心用途是通过 .assign()
 * 在保持原数据的同时追加计算结果。常用于在 chain 中间步骤"挂载"额外字段。
 * 
 * @see RunnableMap.mjs            — 对比：并行执行但只返回各子 Runnable 的结果
 * @see RunnablePick.mjs           — 反向操作：从对象中挑选字段而非追加
 */
import 'dotenv/config';
import { RunnablePassthrough, RunnableLambda, RunnableSequence, RunnableMap } from "@langchain/core/runnables";

// const chain = RunnableSequence.from([
//     RunnableLambda.from((input) => ({ concept: input })),
//     RunnableMap.from({
//         original: new RunnablePassthrough(),
//         processed: RunnableLambda.from((obj) => ({
//             concept: input,
//             upper: obj.concept.toUpperCase(),
//             length: obj.concept.length,
//         }))
//     })
// ]);
// 数据流向：字符串 → {concept} → .assign() 追加字段 → {concept, original, processed}
const chain = RunnableSequence.from([
    (input) => ({ concept: input }),  // 1. 将字符串包装成对象 {concept: "神说要有光"}
    RunnablePassthrough.assign({
        original: new RunnablePassthrough(), // 2a. 保留原对象所有字段（即 {concept}）
        processed: (obj) => ({               // 2b. 追加新字段 processed
            concept: input,
            upper: obj.concept.toUpperCase(), //    大写形式
            length: obj.concept.length,       //    字符长度
        })
    })
]);

const input = "神说要有光";

// 执行结果：{ concept: "神说要有光", original: { concept: "神说要有光" }, processed: { ... } }
const result = await chain.invoke(input);
console.log(result);
