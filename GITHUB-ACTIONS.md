# GitHub Actions 发布

## 免登录网页版（新版）

`.github/workflows/pages.yml` 将 `pages/` 构建为 GitHub Pages 网站。默认分支 main 更新时先运行原文件收发测试，再发布；不需要启动 Docker 或常开电脑。访问者无需 GitHub 账号。

需要仓库允许使用 GitHub Pages，并在 Settings → Pages 设置 Source 为 GitHub Actions。公共仓库可使用 GitHub Free；私有仓库需支持 Pages 的套餐。仓库所有者已授权公开本项目，目标网址为 https://chinheki.github.io/photo-drop/ 。以 Actions 的实际部署成功结果为准，不能把构建成功当成上线成功。

网页版本地验证：`node --test tests/transfer.test.mjs`；构建：`node scripts/build-pages.mjs`，发布目录为 `pages-dist/`。依赖库随代码固定版本提交，构建不需要 npm 安装。

网页版用公共 PeerJS 信令服务建立 WebRTC 直连。GitHub Pages 仅承载静态页面；信令服务可用性和网络隔离会影响配对，不承诺离线或跨网络必达。未配置 TURN；数据不通过本站存储服务器。

参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[PeerJS 文档](https://peerjs.com/client/getting-started)。

## 原有 Node.js / Docker 版本

工作流：`.github/workflows/github-image.yml`（PhotoDrop Check and Publish）。

- push / pull_request / 手动运行：安装锁定依赖，检查自有 JS 脚本，启动 HTTP 服务验证页面和配置接口。
- 默认分支或 v 开头的标签：检查通过后构建完整 Node.js Docker 镜像，启动容器验证，再发布到 GitHub Container Registry。
- 默认分支标签为 `ghcr.io/<仓库所有者>/<仓库名>:latest`，版本标签使用对应 v 标签；同时保留完整 commit SHA 镜像。
- 每次发布任务同时提供 `photodrop-image` 下载产物（保留 30 天），内含可用 `docker load -i photodrop-image.tar.gz` 导入的完整镜像。GHCR 拒绝推送时仍提供此产物并在运行摘要中警告，不将拒绝当作镜像仓库发布成功。
- 使用 GitHub 自动提供的 GITHUB_TOKEN，无需填写个人访问令牌；仓库或组织需允许 Actions 发布 packages。
- 原上游的额外工作流改为手动触发，避免每次提交触发重复构建和旧 pairdrop-cli 发布。

工作流发布的是可运行镜像，不会自动创建常驻公网服务器。GitHub Pages 仅适用于静态内容，无法承载本应用的 Node.js/WebSocket 服务。要上线公网，需另接服务器或容器托管平台。

本机未安装 Docker，尚未执行镜像构建。真正的远程构建和发布结果必须在推送到目标仓库后检查 Actions 运行记录，不以本地配置完成替代成功发布。

官方参考：https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images

## 服务器运行

```sh
docker run -d --name photodrop --restart unless-stopped -p 19091:3000 ghcr.io/OWNER/REPOSITORY:latest
```

OWNER/REPOSITORY 需替换为实际仓库（全小写）。私有镜像需先使用有权限的账户登录 ghcr.io。局域网扫码地址在容器内可能识别为 Docker 网卡地址；正式部署时应将二维码入口配置为主机可达的 URL，不能用容器私有 IP 当成手机可达地址。
