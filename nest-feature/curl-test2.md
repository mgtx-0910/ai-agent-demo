# 1. 签发 JWT → 200
curl -X POST http://localhost:3000/jwt-test/sign \
  -H "Content-Type: application/json" \
  -d '{"sub": 1, "username": "testuser"}'

# 2. 校验 JWT → 200（把 <token> 换成第 1 步返回的 access_token）
curl http://localhost:3000/jwt-test/verify \
  -H "Authorization: Bearer <token>"

# 3. 未携带 Token → 401
curl http://localhost:3000/jwt-test/verify

# 4. Token 无效 → 401
curl http://localhost:3000/jwt-test/verify \
  -H "Authorization: Bearer invalid-token"
