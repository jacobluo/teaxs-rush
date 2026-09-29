# 线上部署

地址：https://texas.webuddy.cc
服务器：`ssh allinone`
目录：`/opt/texas-rush`

游戏通过 Docker Compose 运行，监听 `127.0.0.1:8084`，Nginx 提供 HTTPS 和 WebSocket 代理。单进程保存当前牌局，重启会结束进行中的牌局；模型与牌桌配置通过 `data/` 持久化。

## 配置与更新

服务器 `.env` 保存 `DeepSeekKey`（也支持 `DEEPSEEK_API_KEY`）、`GAME_PASSWORD` 和 `JWT_SECRET`。它与 `data/` 都不进入 Git 或镜像。不要输出 `docker compose config` 的完整结果，以免显示环境中的密钥。

上传应用源文件后，在服务器运行：

```sh
cd /opt/texas-rush
docker compose -f compose.production.yml build --build-arg PYTHON_IMAGE=mirror.ccs.tencentyun.com/library/python:3.11-slim
docker compose -f compose.production.yml up -d
docker compose -f compose.production.yml ps
```

仅更新配色或顶部导航时，可沿用线上镜像中的运行依赖。先将当前镜像保存为带日期的备份标签，再构建前端更新镜像：

```sh
docker image tag texas-rush:production texas-rush:before-ui-release
docker build -f deploy/Dockerfile.ui --build-arg RUNTIME_IMAGE=texas-rush:before-ui-release -t texas-rush:production .
docker compose -f compose.production.yml up -d
```

此方式只更新 `style.css`、`index.html`、`app.js`、`table_view.js` 和牌桌纹理素材。其他应用代码的更新使用上面的完整构建流程。将配置、数据和旧版静态文件备份保存在 `/opt/texas-rush-backups/`，避免进入镜像构建目录。

Nginx 配置位于 `/etc/nginx/conf.d/texas.conf`，对应本目录的 `nginx.conf`。修改后先运行 `nginx -t`，再运行 `systemctl reload nginx`。

证书由已有的 `certbot-renew.timer` 自动续期；`renew-certificate.sh` 安装在 `/etc/letsencrypt/renewal-hooks/deploy/texas-nginx.sh`，续期后重载 Nginx。

房间密码的本机副本位于 `.deployment/room-password.txt`，该目录已被 Git 忽略。后续修改线上密码时同步更新本机副本。

服务器配置了 `/var/swap-texas` 的 1 GiB 交换文件，并已写入 `/etc/fstab`，用于缓解共享主机内存压力。原 fstab 备份位于 `/opt/texas-rush/fstab.before-texas`。

DeepSeek V4 的实时出牌请求使用非思考模式，避免简短响应预算被推理文本占满而触发备用动作。
