// ============================================================
// MongoDB 初始化脚本
// 由 mongo 容器首次启动时自动执行（docker-entrypoint-initdb.d）
// 只在「空数据卷」时跑一次；改完想重跑需要先删掉 volumes/mongo
// ============================================================

// 切到业务库（不存在则创建）
db = db.getSiblingDB("knowledge_hub");

// 业务侧使用的低权限账号：只对 knowledge_hub 有读写权限
// （应用连接串 MONGO_URI 用的就是这个账号，而不是容器管理员的 mongo_user）
db.createUser({
  user: "knowledge_hub_user",
  pwd: "knowledge_hub_password",
  roles: [{ role: "readWrite", db: "knowledge_hub" }],
});

// 文档正文集合：_id(ObjectId) ↔ kh_document.content_id，documentId ↔ kh_document.id
db.createCollection("document_content");

// documentId 建唯一索引：一条元数据只能对应一份正文，从数据库层兜住「重复写正文」
db.document_content.createIndex({ documentId: 1 }, { unique: true });
// deleted 建普通索引：配合「列表 / 详情只查未删除」的过滤条件
db.document_content.createIndex({ deleted: 1 });
