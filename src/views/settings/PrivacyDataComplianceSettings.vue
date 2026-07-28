<template>
  <div class="display-settings legal-content">
    <section class="settings-card">
      <h3 class="settings-card__title">数据处理说明</h3>
      <p class="settings-card__desc">SimpBangumi 会处理登录、数据访问和配信跟踪所需的信息。部分数据保存在本地，部分数据会发送给 Bangumi、Cloudflare 或其他第三方服务。</p>
      <dl class="about-meta">
        <div><dt>OAuth 数据</dt><dd>客户端会处理授权 code、PKCE verifier、访问令牌、刷新令牌和 Bangumi 用户标识。OAuth code 和令牌会经过 Cloudflare Worker 转发给 Bangumi OAuth 接口。Worker 代码不会将这些 token 写入 KV 或 Durable Object，但 Cloudflare 平台可能依据其日志、监控和服务保留策略处理请求元数据。</dd></div>
        <div><dt>设备绑定数据</dt><dd>客户端生成 Ed25519 设备密钥对。私钥种子优先保存在本地系统 keyring 中；在 Windows 上 keyring 不可用时，可能使用 DPAPI 加密的本地回退文件保存。不上传私钥。Worker 会保存设备 ID、设备公钥、关联的 Bangumi 用户标识和创建时间，用于校验设备签名、限制设备数量以及阻止未经绑定的设备刷新令牌。设备绑定记录没有在应用代码中设置自动过期时间。</dd></div>
        <div><dt>限流与 nonce 数据</dt><dd>Worker 会使用请求来源 IP 和设备 ID 执行频率限制。IP 和设备计数按分钟分桶，代码设置计数记录约 120 秒后过期；nonce 默认保存约 180 秒后过期。Cloudflare 平台日志、网络元数据和备份的实际保留期限取决于部署配置及 Cloudflare 服务政策。</dd></div>
        <div><dt>本地存储</dt><dd>OAuth 访问令牌、刷新令牌和 Personal Access Token 会保存在本地系统 keyring，并同时写入使用 Windows DPAPI 加密的本地会话文件；设备私钥在 keyring 不可用时也可能写入 DPAPI 加密的本地回退文件。应用设置、配信跟踪记录和部分匹配缓存保存在本地 localStorage。退出登录会删除本地 OAuth 会话令牌，但不会自动删除设备密钥或 Worker 上的设备绑定，也不会远程撤销令牌。</dd></div>
        <div><dt>Web Cookie</dt><dd>使用 Bangumi Web 登录功能时，应用可能保存包含 chii_auth、chii_sid 等字段的 Cookie，并将其发送至 bgm.tv。Cookie 属于敏感认证凭据，应用不会将其发送给 OAuth Worker。</dd></div>
        <div><dt>其他本地数据</dt><dd>应用不会主动读取与功能无关的文件、通讯录、麦克风或摄像头内容。诊断报告由用户主动导出并保存在本地，报告可能包含日志、系统信息、网络状态和部分用户相关数据；上传前应自行检查。</dd></div>
      </dl>
    </section>

    <section class="settings-card">
      <h3 class="settings-card__title">第三方服务</h3>
      <dl class="about-meta">
        <div><dt>Cloudflare Workers、KV 与 Durable Objects</dt><dd>转发 OAuth code 和刷新令牌请求，校验 Ed25519 签名，保存设备绑定和短期 nonce，并执行 IP 与设备频率限制。Worker 代码会持久化设备绑定数据，但不会将 OAuth token 写入 KV 或 Durable Object。</dd></div>
        <div><dt>Bangumi OAuth、API 与 Web</dt><dd>提供 OAuth 授权、用户信息、番组、收藏及其他用户授权数据。使用 Web 登录功能时，客户端会将已保存的 Cookie 发送至 bgm.tv。</dd></div>
        <div><dt>Tenrai API</dt><dd>配信跟踪和动画匹配功能可能发送搜索关键词、MAL 条目标识和动画查询参数，以获取补充的配信时间、状态和集数信息。</dd></div>
        <div><dt>MyAnimeList</dt><dd>使用 MAL 数据源时，客户端会根据 MAL 条目标识请求公开动画页面并解析动画信息，不会向 MAL 发送 Bangumi OAuth token 或 Web Cookie。</dd></div>
        <div><dt>GitHub</dt><dd>启用版本检查时，客户端会请求 GitHub Releases API 查询最新版本。GitHub 可能获得正常的网络连接元数据。</dd></div>
        <div><dt>图片资源</dt><dd>部分封面和图片会从 Bangumi 图片域名等第三方地址加载，相关服务可能获得网络请求元数据。</dd></div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.settings-card { overflow: hidden; }
.settings-card__title { display: flex; align-items: center; gap: 10px; font-size: 16px; letter-spacing: 0.02em; }
.settings-card__title::before { width: 4px; height: 18px; border-radius: 999px; background: var(--accent); content: ""; flex: 0 0 auto; }
.settings-card__desc { max-width: 760px; line-height: 1.75; }
.about-meta { gap: 14px; }
.about-meta div { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--border) 70%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--surface) 45%, transparent); }
.about-meta dt { margin-bottom: 4px; color: var(--text); font-size: 13px; }
.about-meta dd { margin: 0; color: var(--muted); font-size: 13px; font-weight: 400; letter-spacing: normal; line-height: 1.75; }
</style>
