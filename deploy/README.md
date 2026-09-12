# 线上部署

地址：https://texas.webuddy.cc
服务器：`ssh foodyouknow`
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

Nginx 配置位于 `/etc/nginx/conf.d/texas.conf`，对应本目录的 `nginx.conf`。修改后先运行 `nginx -t`，再运行 `systemctl reload nginx`。

证书由已有的 `certbot-renew.timer` 自动续期；`renew-certificate.sh` 安装在 `/etc/letsencrypt/renewal-hooks/deploy/texas-nginx.sh`，续期后重载 Nginx。

房间密码的本机副本位于 `.deployment/room-password.txt`，该目录已被 Git 忽略。后续修改线上密码时同步更新本机副本。

服务器配置了 `/var/swap-texas` 的 1 GiB 交换文件，并已写入 `/etc/fstab`，用于缓解共享主机内存压力。原 fstab 备份位于 `/opt/texas-rush/fstab.before-texas`。

DeepSeek V4 的实时出牌请求使用非思考模式，避免简短响应预算被推理文本占满而触发备用动作。
