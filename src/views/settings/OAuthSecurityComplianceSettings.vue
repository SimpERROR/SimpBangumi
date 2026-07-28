<template>
  <div class="display-settings legal-content">
    <section class="settings-card">
      <h3 class="settings-card__title">OAuth 登录说明</h3>
      <p class="settings-card__desc">应用使用 Bangumi 提供的 OAuth 授权登录，授权页面由 Bangumi 负责。</p>
      <ul class="settings-card__list">
        <li>登录在 Bangumi 授权页面完成，客户端不会获取用户在该页面输入的密码。</li>
        <li>授权完成后，OAuth code 通过固定的本机 loopback 回调交给客户端，再经 Cloudflare Worker 转发给 Bangumi OAuth 接口交换令牌。</li>
        <li>Worker 会在交换和刷新期间处理 code、PKCE verifier、访问令牌和刷新令牌。当前 Worker 代码未将这些 token 写入 KV 或 Durable Object，但这不代表 Cloudflare 平台不会根据其配置和服务政策生成请求日志或其他运行记录。</li>
      </ul>
    </section>

    <section class="settings-card">
      <h3 class="settings-card__title">设备安全机制</h3>
      <p class="settings-card__desc">客户端使用设备密钥为发往 Worker 的敏感请求提供完整性和时效性保护，但该机制不等同于用户身份认证。</p>
      <ul class="settings-card__list">
        <li>客户端首次使用时生成 Ed25519 密钥对，私钥种子优先保存在本地系统 keyring 中；在 Windows 上 keyring 不可用时，可能使用 DPAPI 加密的本地回退文件保存。私钥不会上传。</li>
        <li>Worker 保存设备 ID、设备公钥、关联的 Bangumi 用户标识和创建时间；请求包含时间戳、随机 nonce 和签名，用于防止请求篡改与重放。</li>
        <li>refresh 返回的 Bangumi 用户标识必须与设备绑定的用户标识一致。</li>
        <li>该机制不用于 DRM 或限制开源软件的运行，也不能防止本地设备或系统密钥存储已被控制时的滥用。</li>
      </ul>
    </section>

    <section class="settings-card">
      <h3 class="settings-card__title">免责声明</h3>
      <p class="settings-card__desc">请在使用本项目时自行判断并承担相应责任。</p>
      <ul class="settings-card__list">
        <li>用户应遵守所在国家或地区的法律法规以及相关第三方服务的使用条款。</li>
        <li>本项目不得用于未授权访问、绕过访问控制、侵犯他人权益或其他违法用途。</li>
        <li>SimpBangumi 是开源项目，功能、服务可用性及第三方服务内容可能发生变化。</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.settings-card { overflow: hidden; }
.settings-card__title { display: flex; align-items: center; gap: 10px; font-size: 16px; letter-spacing: 0.02em; }
.settings-card__title::before { width: 4px; height: 18px; border-radius: 999px; background: var(--accent); content: ""; flex: 0 0 auto; }
.settings-card__desc { max-width: 760px; line-height: 1.75; }
.settings-card__list { display: grid; gap: 9px; margin: 12px 0 0; padding-left: 20px; color: var(--muted); font-size: 13px; line-height: 1.75; }
.settings-card__list li::marker { color: var(--accent); }
</style>
