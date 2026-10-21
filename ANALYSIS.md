# 搜索与 REA 分析记录

日期：2026-10-21。

| 方案 | 官方来源 | 对本需求的判断 |
| --- | --- | --- |
| PairDrop | https://github.com/schlagmichdoch/PairDrop | 浏览器端跨平台传输，具备配对、房间和二维码，选为复刻基础 |
| Snapdrop | https://github.com/SnapDrop/snapdrop | 浏览器局域网分享的基础方案，PairDrop 在其基础上扩展 |
| LocalSend | https://localsend.org/ | 面向安装客户端的局域网分享，官方也提供 Web 入口；本次选择更直接匹配网页流程的 PairDrop |

## 实际调用 REA

REA CLI 6.7.0 命令（工作区根目录执行）：

```powershell
pnpm dlx rea-agents analyze-javascript-application photo-drop --source-path public/scripts/network.js --source-path server/ws-server.js --source-path public/scripts/util.js --max-semantic-nodes 2500 --max-semantic-unknowns 300 --format json
```

证据：`../research/pairdrop-rea-analysis.json`。
Evidence ID：`ev_50351a501f0e11e2d17286a3d35afa503d6162bc6cf3a6874d2dcb46f9335e4c`。

REA 完成了三份选定脚本的静态语法与关系分析，其余 497 个清单文件不在本次分析范围内。以下结论结合 REA 输出与源码阅读，静态证据不等同于运行时验证。

- `server/ws-server.js` 负责设备发现、配对、临时房间及 WebSocket 信令/转发。
- `public/scripts/network.js` 的 PeersManager 接收 files-selected 事件，原实现直接交给 requestFileTransfer；因此在此入口转换，能覆盖文件选择、拖拽和分享流程。
- 正常传输使用 RTC 数据通道；缺少 WebRTC 时可选 WSPeer。已在启动脚本启用服务器兜底。
- `public/scripts/util.js` 的 HEIC 缩略图转换在上游被注释禁用，并明确写有 iOS 18 崩溃说明。因此未使用旧 heic2any 作为新增发送转换引擎。
- 新增 PhotoConverter：默认 JPEG / 可选 PNG → 原生解码 → HEIC 专用解码器兜底 → 检查输出 Blob → 更新 MIME、后缀 → 原有传输协议。

## 已完成验证

1. JS 语法检查：转换器、传输入口通过。
2. libheif 官方 `examples/example.heic`：转换 JPEG、PNG 后文件头、MIME、后缀符合预期，均可重新解码为 1280×854。
3. 相同格式不重新编码；透明 PNG 转 JPEG 使用白底；非图片保持原样；损坏 HEIC 阻止整批发送并恢复设置控件。
4. 两个独立网页来源（127.0.0.1 / localhost）互相发现；HEIC 经本地转换，另一端收到 example.jpg（约 557 KB），发送端显示传输完成。当前内嵌浏览器实际走 WebSocket 兜底；WebRTC、真实 iOS/Android/Safari 尚未实机验证。
5. 点击保存后浏览器下载事件回执超时，未确认文件落盘，不将此项计为通过。
6. 默认桌面布局已截图；预览工具的窄屏设置未生效，手机断点尚未验证。
7. npm audit fix 更新兼容范围内锁文件后报告 0 已知依赖漏洞；同步 pnpm 锁文件。

## 部署状态

用户确认先使用局域网版本，完整本机 Node 服务运行于 19091，无需公网部署。部署到公网需要 HTTPS、支持 WebSocket 升级、长连接的运行环境，以及按网络情况配置 TURN。

HEIC 样本来源：https://github.com/strukturag/libheif/blob/master/examples/example.heic 。heic-to 来源：https://github.com/hoppergee/heic-to 。
