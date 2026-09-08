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
 */
export interface JwtPayload {
  id: number;
  username: string;
  role: 'admin' | 'user';
}
