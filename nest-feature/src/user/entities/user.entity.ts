/**
 * User 实体：内存中的"用户表"结构
 *
 * 对应真实项目中的数据库实体（typeorm @Entity），本示例不接数据库，
 * 仅用一个普通类定义数据形状。字段说明：
 *  - id:        主键，自增
 *  - username:  登录账号
 *  - name:      显示名称
 *  - age:       年龄
 *  - role:      角色 —— admin（管理员）/ user（普通用户），
 *               用于演示 Guard 里的"越权"权限控制
 */
export class User {
  id: number;
  username: string;
  name: string;
  age: number;
  role: 'admin' | 'user';
}
