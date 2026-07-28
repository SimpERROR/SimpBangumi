# OAuth Worker

这是 SimpBangumi 使用的 Cloudflare Worker 源码，用于转发 Bangumi OAuth 授权码和刷新令牌请求。

## 文件

- `oauth-proxy.js`：OAuth 请求代理 Worker。
- `nonce-guard.js`：Nonce 防重放 Durable Object。

## 必要配置

Secrets：

- `BANGUMI_CLIENT_ID`
- `BANGUMI_CLIENT_SECRET`

KV binding：

- `OAUTH_RATE_LIMIT_KV`

Durable Object binding：

- binding 名称：`NONCE_GUARD`
- class 名称：`NonceGuard`

可选环境变量：

- `ALLOWED_ORIGINS`：允许访问的浏览器 Origin，多个值使用英文逗号分隔。Tauri 客户端请求通常不携带 Origin。
- `MAX_DEVICES_PER_ACCOUNT`：单个 Bangumi 账号允许绑定的设备数量，默认值为 `5`。

如果缺少 KV binding，Worker 会返回 HTTP 503，并拒绝处理 OAuth 请求。

## 设备请求安全

客户端首次使用时会生成 Ed25519 密钥对，并将私钥种子保存在系统密钥环中。每次授权码或刷新令牌请求都会携带设备 ID、公钥、时间戳、随机 nonce 和签名。

Worker 仅在授权码与 PKCE 校验成功后创建设备绑定。刷新请求必须使用已存在的设备绑定和匹配的公钥；刷新令牌不会用于注册新设备。Worker 同时限制 IP 和设备在单位时间内的请求数量。

设备绑定使用以下 KV 记录：

- `oauth-device:<device_id>`：保存账号标识、公钥和创建时间。
- `oauth-account-devices:<account_id>`：保存账号已绑定的设备列表。

单个账号的设备数量受 `MAX_DEVICES_PER_ACCOUNT` 限制，默认最多绑定 5 台设备。

## Nonce 防重放

Nonce 防重放使用 `NONCE_GUARD` Durable Object。每台设备会路由到独立的 Durable Object，其中只保存 nonce 及其过期时间，不保存 OAuth code、刷新令牌、访问令牌、设备私钥或请求签名。

Nonce 在消费时和定时 alarm 中清理。每台设备的 nonce 数量有上限，超过容量时会拒绝新的 nonce。

KV namespace 负责请求限流和设备公钥绑定。Nonce 需要使用 Durable Object 来保证严格的一次性消费，不能使用非原子 KV 读写替代。
