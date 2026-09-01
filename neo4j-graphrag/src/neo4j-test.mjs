/**
 * neo4j-test.mjs —— Neo4j 基础操作示例（增删改查）
 *
 * 用最直接的 neo4j-driver 方式演示对「奶茶知识图谱」的 6 种基本操作：
 *   1. createData     创建节点
 *   2. createRelation 创建关系
 *   3. queryData      查询数据（示例中默认运行）
 *   4. updateData     更新属性
 *   5. deleteRelation 删除关系
 *   6. deleteNode     删除节点
 *
 * 前置条件：Neo4j 已通过 docker-compose.yml 启动（bolt://localhost:7687，
 * 账号 neo4j / 密码 12345678）。
 *
 * 运行：node src/neo4j-test.mjs
 *
 * 注意：本文件是「手动操作演示」，与 graphrag.mjs（LangChain GraphRAG 工作流）
 * 相互独立；graphrag.mjs 内部会自己管理会话与查询。
 */
import neo4j from 'neo4j-driver'

// 连接信息（和你的 docker-compose 完全一致）
const driver = neo4j.driver(
  'bolt://localhost:7687', // Neo4j Bolt 协议地址（docker-compose 映射的宿主机端口）
  neo4j.auth.basic('neo4j', '12345678') // 用户名 / 密码
)

// 获取会话：driver 是长连接池，session 代表一次「事务上下文」，用完要 close
const session = driver.session()

// ---------------------------------------------------------------
// 1. 创建节点
//    CREATE (p:Product {...}) 表示新建一个标签为 Product 的节点
//    标签名相当于「表的名称」，属性以 {name: "..."} 形式给出
// ---------------------------------------------------------------
async function createData() {
  const result = await session.run(`
    CREATE (p:Product {name: "珍珠奶茶"})
    CREATE (i:Ingredient {name: "珍珠"})
  `)
  console.log('创建成功')
}

// ---------------------------------------------------------------
// 2. 创建关系
//    MATCH 先定位两个已存在的节点，CREATE 再在两节点之间建边
//    关系语法：(起点)-[:关系名]->(终点)，方向不能反
// ---------------------------------------------------------------
async function createRelation() {
  await session.run(`
    MATCH (p:Product {name: "珍珠奶茶"}), (i:Ingredient {name: "珍珠"})
    CREATE (p)-[:包含]->(i)
  `)
  console.log('关系创建成功')
}

// ---------------------------------------------------------------
// 3. 查询数据
//    MATCH (p)-[r]->(i) 沿任意关系 r 从 p 走到 i
//    RETURN p, r, i 返回节点与关系，再通过 record.get() 取字段
// ---------------------------------------------------------------
async function queryData() {
  const result = await session.run(`
    MATCH (p:Product {name: "珍珠奶茶"})-[r]->(i)
    RETURN p, r, i
  `)

  result.records.forEach(record => {
    console.log('奶茶:', record.get('p').properties.name)
    console.log('关系:', record.get('r').type)
    console.log('配料:', record.get('i').properties.name)
    console.log('--------------------------------')
  })
}

// ---------------------------------------------------------------
// 4. 更新属性
//    SET p.price = 15 表示给节点新增/覆盖属性（属性不存在则新建）
// ---------------------------------------------------------------
async function updateData() {
  await session.run(`
    MATCH (p:Product {name: "珍珠奶茶"})
    SET p.price = 15, p.calorie = "中高"
  `)
  console.log('更新成功')
}

// ---------------------------------------------------------------
// 5. 删除关系
//    DELETE r 只删边、不删节点；注意要先 MATCH 出该关系
// ---------------------------------------------------------------
async function deleteRelation() {
  await session.run(`
    MATCH (p:Product {name: "珍珠奶茶"})-[r:包含]->(i:Ingredient {name: "珍珠"})
    DELETE r
  `)
  console.log('删除关系成功')
}

// ---------------------------------------------------------------
// 6. 删除节点
//    DELETE p 删除节点；若节点仍有关联关系会报错（需先删关系）
// ---------------------------------------------------------------
async function deleteNode() {
  await session.run(`
    MATCH (p:Product {name: "珍珠奶茶"})
    DELETE p
  `)
  console.log('删除节点成功')
}

// ---------------------------------------------------------------
// 执行入口：想运行哪个就取消对应行的注释（同一会话内连续执行）
// 默认只跑 queryData()，避免重复建点建边报错
// ---------------------------------------------------------------
// createData()
// createRelation()
queryData()
// updateData()
// deleteRelation()
// deleteNode()
