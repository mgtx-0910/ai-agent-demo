# 1. 无 Token → 401
curl http://localhost:3000/user/2
# 2. 普通用户查自己 → 200
curl -H "Authorization: Bearer user-token-456" http://localhost:3000/user/2
# 3. 普通用户查他人 → 403
curl -H "Authorization: Bearer user-token-456" http://localhost:3000/user/1
# 4. 管理员查任意用户 → 200
curl -H "Authorization: Bearer admin-token-123" http://localhost:3000/user/2
# 5. Pipe：age 字符串转数字 → 200
curl "http://localhost:3000/user/age-demo?age=25"
# 6. Pipe：非法 ID → 400（DELETE 无 Guard，Pipe 可直接拦截）
curl -X DELETE http://localhost:3000/user/abc
# 7. 用户不存在 → 404
curl -H "Authorization: Bearer admin-token-123" http://localhost:3000/user/999
