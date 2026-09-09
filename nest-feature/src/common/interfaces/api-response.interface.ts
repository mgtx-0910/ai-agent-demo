/**
 * 全局统一响应 / 身份数据结构
 *
 * 设计目标：无论成功还是失败，HTTP 响应的 body 都是
 *   { code, data, message }
 * 前端只认这一种壳，解析逻辑可以写死。
 */

/** 统一响应体：code = HTTP 状态码，data = 业务数据，message = 描述信息 */
export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
}

/**
 * JWT 载荷 / 登录用户信息
 * AuthService 与 AuthGuard 共用，Guard 校验通过后作为 request.user 挂载
 *
 * 为什么用 interface 而不是 class / type：
 * - 它只描述"数据应有的形状"（纯类型契约），运行时不需 new，interface 编译期即被擦除，零开销；
 *   对比：user 模块的 User 实体用 class，是因为 service 里真的会 new User() 且有构造逻辑；
 * - interface 支持 extends 扩展与同名声明合并，适合作为跨模块共享、可演进的契约；
 * - 反观 JwtPayload 的 data 都是工厂/校验函数直接产出的对象字面量，用 interface 足够。
 */
export interface JwtPayload {
  id: number;
  username: string;
  role: 'admin' | 'user';
}
