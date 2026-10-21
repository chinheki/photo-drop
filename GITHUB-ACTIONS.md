# GitHub Actions 发布

工作流：`.github/workflows/github-image.yml`（PhotoDrop Check and Publish）。

- push / pull_request / 手动运行：安装锁定依赖，检查自有 JS 脚本，启动 HTTP 服务验证页面和配置接口。
- 默认分支或 v 开头的标签：检查通过后构建完整 Node.js Docker 镜像，启动容器验证，再发布到 GitHub Container Registry。
- 默认分支标签为 `ghcr.io/<仓库所有者>/<仓库名>:latest`，版本标签使用对应 v 标签；同时保留完整 commit SHA 镜像。
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
