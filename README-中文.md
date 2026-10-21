# 随心传 PhotoDrop

基于 PairDrop 的完整开源分支，保留其界面、局域网发现、二维码/数字配对、临时房间、WebRTC 传输、接收确认及批量保存。新增发送前本地图片转换，默认 JPEG，可选 PNG。图片不会上传到转换服务。

## 使用

本机： http://127.0.0.1:19091 。点击“手机扫码打开”，手机连接同一 Wi-Fi 后扫码进入专用手机发送页。二维码带有手机模式和当前电脑设备标识，自动选择对应接收端。两端保持网页在前台。手机页提供“图片 / 文字 / 文件”入口；图片和文件需要电脑确认接收，文字可在电脑上复制。电脑刷新后设备标识可能变化，请重新扫码或手动选择接收端。

Windows 运行 `start.ps1`。Mac 安装 Node.js 22 或更新版本后运行 `npm install`，再执行 `sh start.command`。首次安装也可使用 pnpm install。服务端默认监听所有网卡，防火墙需要允许手机访问端口。

局域网 HTTP 下部分浏览器不提供 WebRTC，已启用 WebSocket 传输兜底；图片会经本机服务内存转发。HTTP 不加密，请在可信 Wi-Fi 使用。远程跨网络需要部署同一服务到支持 Node.js/WebSocket 的 HTTPS 主机；配对本身不能解决所有 NAT 限制，WebRTC 穿透失败时需配置 TURN，或在不支持 WebRTC 的浏览器使用 WebSocket。

## 格式转换

- 所有设备的静态图片在发送前按所选格式处理，保证 iPhone 发出的 HEIC 不会只改后缀。
- 默认图片最长边限制为 2048 像素（小图不放大），JPEG 质量 0.8；JPEG 白底填充透明区域。PNG 保留透明度，文件通常更大。
- 勾选“原图”时，非 HEIC 图片保留原文件字节和格式；HEIC 仍转所选格式，保留尺寸并采用 JPEG 质量 0.95。
- “文件”入口保留任何文件的字节，图片也不转换或压缩。
- 一次支持选择多张图片，缩略图列表显示排队、处理中、等待电脑确认、发送中和完成。最多同时处理 2 张；HEIC 兜底解码移至 Worker，超时后提示失败。失败取消整批发送，可减少张数重试。
- 图片处理结束后明确提示“等待电脑确认接收”，电脑点击“接收”后才开始传输。
- 多图收到后显示逐张缩略图和复选框，默认全选，可全选/全不选；仅保存或分享选中的图片。选多张保存为 ZIP，选一张直接保存，未选择时禁用保存。多图不再自动保存，留出选择时间。
- 转码可能移除 EXIF/GPS/HDR 等元数据，输出为静态图片；不保留 Live Photo 动态部分或动图动画。
- 浏览器内存限制仍然存在；尚需在真实 iPhone/Android/Windows/Mac 设备上验收。

## 来源与分析

PairDrop 上游 https://github.com/schlagmichdoch/PairDrop ，基线 commit `1b0c9c9d903c3cfc706df1303dc75c3b54d04c77`。REA 6.7.0 静态证据位于相邻 `research/pairdrop-rea-analysis.json`，分析记录见 `ANALYSIS.md`。

遵循上游 GPL-3.0（见 LICENSE），新增代码同样采用 GPL-3.0；heic-to 采用 LGPL-3.0，许可证保留在 public/scripts/libs/heic-to.LICENSE。分发部署时须同时提供对应源代码及许可证。
