/**
 * 库存假接口模块：模拟「按 SKU 查库存」的外部服务。
 * 仅被 prebuilt-agent.mjs / prebuilt-tool-node.mjs 导入使用，不是独立入口。
 */

/** 假数据，模拟「按 SKU 查库存」接口 */
const rows = [
  { sku: "SKU-001", name: "无线鼠标", stock: 42 },
  { sku: "SKU-002", name: "机械键盘", stock: 7 },
  { sku: "SKU-003", name: "USB-C 线缆", stock: 120 },
];

// 按 SKU 查商品：SKU 忽略大小写与首尾空格，找不到时返回 found:false
export function getProductBySku(sku) {
  const key = String(sku).trim().toUpperCase();
  const row = rows.find((r) => r.sku.toUpperCase() === key);
  if (!row) return JSON.stringify({ found: false, sku: String(sku).trim() });
  return JSON.stringify({ found: true, ...row });
}
