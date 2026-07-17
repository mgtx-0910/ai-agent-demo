# 项目记忆

## 项目约定

### @see JSDoc 注释规范
- 每个 `.mjs` 文件的文件头使用 `/** */` 多行 JSDoc 注释块来描述文件用途和技术要点
- 使用 `@see filename.mjs — 中文说明` 标注文件间依赖与关联关系
- `@see` 注释放在 import 语句之前、JSDoc 描述之后
- 文件在同目录：直接写文件名，如 `@see query.mjs`
- 文件在不同目录/子项目：必须写清相对项目 src 根路径，如 `@see test/all-tools.mjs`
