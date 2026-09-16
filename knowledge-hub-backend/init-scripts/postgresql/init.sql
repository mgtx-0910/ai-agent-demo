-- ============================================================
-- 文档元数据表 kh_document
-- 由 Postgres 容器首次启动时自动执行（docker-entrypoint-initdb.d）
-- 与 src/document/entities/document.entity.ts 一一对应，改结构请两边同步
--
-- 为什么用 IF NOT EXISTS：该脚本只在初始化「空数据卷」时执行一次，
-- 但写上后可保证重复执行不报错（例如手动 psql -f 再跑一遍）
-- ============================================================

CREATE TABLE IF NOT EXISTS kh_document (
    id BIGINT PRIMARY KEY,                  -- 雪花 ID（应用层生成，非自增）
    title VARCHAR NOT NULL,                 -- 标题
    content_id VARCHAR NOT NULL UNIQUE,     -- 指向 MongoDB document_content._id（一对一）
    summary VARCHAR,                        -- 摘要（列表页展示）
    category_id BIGINT,                     -- 分类 ID
    team_id BIGINT,                         -- 团队 ID
    author_id BIGINT,                       -- 作者 ID
    cover_image VARCHAR,                    -- 封面图 URL
    tags VARCHAR,                           -- 标签，逗号分隔字符串（如 "入职,研发中心"）
    status SMALLINT NOT NULL DEFAULT 0,     -- 0 草稿 / 1 已发布 / 2 已归档
    remark VARCHAR,                         -- 内部备注
    view_count INT NOT NULL DEFAULT 0,      -- 浏览数（业务累加）
    like_count INT NOT NULL DEFAULT 0,      -- 点赞数
    comment_count INT NOT NULL DEFAULT 0,   -- 评论数
    favourite_count INT NOT NULL DEFAULT 0, -- 收藏数
    word_count INT NOT NULL DEFAULT 0,      -- 字数（中英混合统计）
    publish_time TIMESTAMP,                 -- 首次发布时间（草稿为 NULL）
    is_public BOOLEAN NOT NULL DEFAULT false, -- 是否公开
    created_at TIMESTAMP NOT NULL DEFAULT NOW(), -- 创建时间
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(), -- 更新时间（TypeORM save 时刷新）
    create_by BIGINT,                       -- 创建人 ID
    update_by BIGINT,                       -- 更新人 ID
    deleted BOOLEAN NOT NULL DEFAULT false  -- 逻辑删除标记
);

-- 索引说明：当前只有主键与 content_id 唯一约束。
-- 数据量上来后，建议按实际查询补上（现未建，避免过早优化）：
--   CREATE INDEX idx_kh_document_list ON kh_document (deleted, status, created_at DESC);
--   CREATE INDEX idx_kh_document_team ON kh_document (team_id, deleted);
--   CREATE INDEX idx_kh_document_category ON kh_document (category_id, deleted);
