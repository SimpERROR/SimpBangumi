<template>
  <div class="display-settings legal-content">
    <section class="settings-card">
      <h3 class="settings-card__title">数据处理说明</h3>
      <p class="settings-card__desc">SimpBangumi 会处理登录、数据访问、配信跟踪、可选多平台评分和可选小游戏所需的信息。仅用于本地功能的数据与需要访问第三方服务的数据会分别处理；具体范围如下。</p>
      <dl class="about-meta">
        <div><dt>OAuth 数据</dt><dd>客户端会处理授权 code、PKCE verifier、访问令牌、刷新令牌和 Bangumi 用户标识。OAuth code 和令牌会经过 Cloudflare Worker 转发给 Bangumi OAuth 接口。Worker 代码不会将这些 token 写入 KV 或 Durable Object，但 Cloudflare 平台可能依据其日志、监控和服务保留策略处理请求元数据。</dd></div>
        <div><dt>设备绑定数据</dt><dd>客户端生成 Ed25519 设备密钥对。私钥种子优先保存在本地系统 keyring 中；在 Windows 上 keyring 不可用时，可能使用 DPAPI 加密的本地回退文件保存。不上传私钥。Worker 会保存设备 ID、设备公钥、关联的 Bangumi 用户标识和创建时间，用于校验设备签名、限制设备数量以及阻止未经绑定的设备刷新令牌。设备绑定记录没有在应用代码中设置自动过期时间。</dd></div>
        <div><dt>限流与 nonce 数据</dt><dd>Worker 会使用请求来源 IP 和设备 ID 执行频率限制。IP 和设备计数按分钟分桶，代码设置计数记录约 120 秒后过期；nonce 默认保存约 180 秒后过期。Cloudflare 平台日志、网络元数据和备份的实际保留期限取决于部署配置及 Cloudflare 服务政策。</dd></div>
        <div><dt>本地存储</dt><dd>OAuth 访问令牌、刷新令牌和 Personal Access Token 会保存在本地系统 keyring，并同时写入使用 Windows DPAPI 加密的本地会话文件；设备私钥在 keyring 不可用时也可能写入 DPAPI 加密的本地回退文件。应用设置、配信跟踪记录、部分匹配缓存、收藏小游戏最高分及小游戏行为分析数据保存在本地 localStorage。退出登录会删除本地 OAuth 会话令牌，但不会自动删除设备密钥、Worker 上的设备绑定、小游戏记录，也不会远程撤销令牌。</dd></div>
        <div><dt>多平台评分比对</dt><dd>该功能默认关闭，只有在用户主动开启并打开条目详情页时才会在后台请求所选平台的公开评分。请求可能包含条目标题、英文或罗马字标题、上映年份、集数及用于匹配的公开条目标识；不会附带 Bangumi OAuth 令牌、Web Cookie 或用户个人资料。评分结果、匹配结果和失败原因会按条目缓存在本机 localStorage，缓存通常每 7 天重新获取；关闭功能不会自动清除既有缓存。</dd></div>
        <div><dt>收藏小游戏与行为分析</dt><dd>启动收藏小游戏时，应用会读取当前 Bangumi 账户的动画收藏及封面，用于在本机生成题目。猜番会在本地记录累计答题表现，用于难度解锁和封面处理弱点判断；「恶意」难度还会在本地记录有限数量的近期答题信息，例如答案与点击位置、选项经过顺序、正确与否、反应时间区间、使用的封面处理和干扰项类型，以调整后续题目的封面处理、选项排列与干扰强度。使用鼠标答题时，恶意难度会短暂采样当前题目区域内的鼠标轨迹，并仅保存首次靠近和停留的选项位置、路径长度、直接程度及折返次数等派生特征；原始轨迹点不会持久化，键盘和触控答题不会记录轨迹。开始恶意题局时，应用可能在独立初始化页面中对有限数量的候选封面进行本地低分辨率采样，计算色相、饱和度、明暗、画面亮度重心、人脸候选区域和高对比文字带等粗略视觉特征，用于选择相似配色、相似构图干扰项，局部遮挡候选人脸或文字区域，以及相邻题目的视觉残留博弈；初始化页面会显示处理进度。该处理不识别人物身份，也不读取或保存文字内容。原始像素和这些特征均不会上传，若图片读取失败则自动跳过。上述分析仅用于小游戏对抗行为，不用于身份识别、广告、信用评价、内容推荐或产生法律及类似重大影响。</dd></div>
        <div><dt>小游戏数据控制</dt><dd>小游戏最高分和「恶意」难度分析数据均保存在当前设备，不会由应用上传至开发者服务器。用户可在「开发者设置」中分别清除两个小游戏的最高分，并单独清除「恶意」难度分析数据。清除恶意分析后系统会重新学习；用于恶意难度解锁的累计答题档案与恶意分析记录属于不同的本地数据，清除其中一项不会自动清除另一项。</dd></div>
        <div><dt>Web Cookie</dt><dd>使用 Bangumi Web 登录功能时，应用可能保存包含 chii_auth、chii_sid 等字段的 Cookie，并将其发送至 bgm.tv。Cookie 属于敏感认证凭据，应用不会将其发送给 OAuth Worker。</dd></div>
        <div><dt>其他本地数据</dt><dd>应用不会主动读取与功能无关的文件、通讯录、麦克风或摄像头内容。诊断报告由用户主动导出并保存在本地，报告可能包含日志、系统信息、网络状态和部分用户相关数据；上传前应自行检查。</dd></div>
      </dl>
    </section>

    <section class="settings-card">
      <h3 class="settings-card__title">第三方服务</h3>
      <dl class="about-meta">
        <div><dt>Cloudflare Workers、KV 与 Durable Objects</dt><dd>转发 OAuth code 和刷新令牌请求，校验 Ed25519 签名，保存设备绑定和短期 nonce，并执行 IP 与设备频率限制。Worker 代码会持久化设备绑定数据，但不会将 OAuth token 写入 KV 或 Durable Object。</dd></div>
        <div><dt>Bangumi OAuth、API 与 Web</dt><dd>提供 OAuth 授权、用户信息、番组、收藏及其他用户授权数据。启动收藏小游戏时，客户端会通过 Bangumi API 读取动画收藏；启用题库扩充或进入会强制扩充题库的模式时，还会请求 Bangumi 动画浏览页中的趋势榜和全站排名公开条目。使用 Web 登录功能时，客户端会将已保存的 Cookie 发送至 bgm.tv。</dd></div>
        <div><dt>Tenrai API</dt><dd>配信跟踪和动画匹配功能可能发送搜索关键词、MAL 条目标识和动画查询参数，以获取补充的配信时间、状态和集数信息。</dd></div>
        <div><dt>MyAnimeList</dt><dd>使用 MAL 数据源或多平台评分比对时，客户端会根据公开条目标识或标题请求 MAL/Tenrai 的动画信息和评分，不会向 MAL 发送 Bangumi OAuth token 或 Web Cookie。</dd></div>
        <div><dt>AniList</dt><dd>启用 AniList 评分比对时，客户端会通过公开 GraphQL 接口按条目标题查询匹配条目、评分和评价数量。请求不包含 Bangumi 账户信息或认证凭据；AniList 可能获得正常网络连接元数据。</dd></div>
        <div><dt>TMDB 与 IMDb</dt><dd>启用对应平台评分比对时，客户端会按条目标题及可能的年份等公开信息查询评分。可选择直接抓取平台公开网页，或使用用户自行申请的 TMDB API Key、OMDb API Key 调用官方接口。API Key 仅保存在本机并直接用于向对应服务发起请求，不会上传至 SimpBangumi 或 OAuth Worker；对应平台仍可能依据自身政策处理请求、API Key 和网络元数据。</dd></div>
        <div><dt>GitHub</dt><dd>启用版本检查时，客户端会请求 GitHub Releases API 查询最新版本。GitHub 可能获得正常的网络连接元数据。</dd></div>
        <div><dt>图片资源</dt><dd>条目页面及收藏小游戏中的部分封面和图片会从 Bangumi 图片域名等第三方地址加载，相关服务可能获得 IP 地址、请求时间、User-Agent 等正常网络请求元数据；本地形成的答题分析记录不会附加到这些图片请求中。</dd></div>
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
