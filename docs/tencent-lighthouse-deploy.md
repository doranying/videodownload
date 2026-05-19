# 腾讯云轻量服务器部署说明

适用环境：腾讯云轻量应用服务器，中国香港，Ubuntu 22.04 / 24.04。

## 需要准备

- 服务器公网 IP
- SSH 登录方式：密码或 SSH 密钥
- 域名，例如 `example.com`
- GitHub 仓库：`https://github.com/doranying/videodownload`

## 服务器安全组

在腾讯云控制台放行这些端口：

- `22`：SSH 登录
- `80`：HTTP
- `443`：HTTPS

## 第一次部署

登录服务器：

```bash
ssh root@你的服务器公网IP
```

安装基础环境：

```bash
curl -fsSL https://raw.githubusercontent.com/doranying/videodownload/main/scripts/setup-server.sh | bash
```

拉取项目：

```bash
cd /opt
git clone https://github.com/doranying/videodownload.git
cd videodownload
```

安装项目依赖：

```bash
npm install --omit=dev
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip yt-dlp
```

启动服务：

```bash
pm2 start server.js --name videodownload --env production
pm2 save
pm2 startup
```

此时可以先用下面地址测试：

```text
http://你的服务器公网IP:4174
```

## 绑定域名

在域名 DNS 控制台添加：

```text
A 记录
主机记录：@ 或你想用的子域名，例如 video
记录值：你的服务器公网 IP
```

例如：

```text
video.example.com -> 你的服务器公网 IP
```

## Nginx 反向代理

创建配置：

```bash
sudo nano /etc/nginx/sites-available/videodownload
```

填入：

```nginx
server {
    listen 80;
    server_name 你的域名;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:4174;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/videodownload /etc/nginx/sites-enabled/videodownload
sudo nginx -t
sudo systemctl reload nginx
```

## HTTPS

域名解析生效后执行：

```bash
sudo certbot --nginx -d 你的域名
```

## 后续更新

```bash
cd /opt/videodownload
git pull
npm install --omit=dev
.venv/bin/python -m pip install --upgrade yt-dlp
pm2 restart videodownload
```

## 常用命令

查看服务：

```bash
pm2 status
```

查看日志：

```bash
pm2 logs videodownload
```

重启：

```bash
pm2 restart videodownload
```

检查下载工具：

```bash
/opt/videodownload/.venv/bin/yt-dlp --version
```

