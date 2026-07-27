# AIDR Linux TAR 安装说明

## 1. 安装包说明

AIDR Linux 当前提供两个 TAR 安装包：

| 安装包 | 安装位置 | 用途 |
| --- | --- | --- |
| `aidr-endpoint-linux.tar.gz` | 需要保护的 Linux 终端 | 识别 AI Agent，采集会话与运行行为，执行本地策略并向统一控制台上报 |
| `aidr-server-linux.tar.gz` | 集中管理服务器 | 提供 Endpoint 注册、数据接收、统一 API 和 Web 管理控制台 |

单机试用时可以在同一台 Linux 主机安装两者。生产环境建议将 AIDR Server
部署在独立管理服务器，各受保护终端只安装 AIDR Endpoint。

## 2. 系统要求

### 支持范围

- CPU 架构：`x86_64`、`arm64`
- 使用 `systemd` 的 Linux 发行版
- Node.js 20 或更高版本
- Endpoint 依赖基础命令：`ps`、`ss`
- 安装账户必须具有 `root` 权限，或能够使用 `sudo`

当前主要面向 Ubuntu、Debian、RHEL、Rocky Linux、AlmaLinux 和 openEuler
等主流服务器发行版。Alpine Linux、非 systemd 系统和精简容器镜像尚未作为
正式支持目标。

### 默认端口

| 组件 | 端口 | 监听范围 |
| --- | --- | --- |
| AIDR Endpoint 本地 API | TCP `8788` | 本机 |
| AIDR Server/统一控制台 | TCP `8888` | 安装后为 `0.0.0.0` |

生产环境应通过主机防火墙限制 TCP `8888`，并在服务端前配置 HTTPS 反向代理。

## 3. 推荐部署顺序

1. 安装 AIDR Server。
2. 保存 Server 安装程序输出的注册令牌。
3. 确认 Endpoint 可以访问 Server TCP `8888`。
4. 使用 Server 地址和注册令牌安装各个 Endpoint。
5. 登录统一控制台确认 Endpoint 在线及数据上报状态。

## 4. 安装 AIDR Server

解压并安装：

```bash
tar -xzf aidr-server-linux.tar.gz
cd aidr-server-linux
sudo bash ./install.sh
```

安装程序将自动：

- 创建低权限系统账户 `aidr`
- 安装程序到 `/opt/aidr-server`
- 创建运行数据目录 `/var/lib/aidr-server`
- 创建配置文件 `/etc/aidr/server.env`
- 注册并启动 `aidr-server.service`
- 设置服务开机自启动
- 生成 Endpoint 注册令牌

安装结束时会输出类似信息：

```text
AIDR unified control plane installed on port 8888.
Enrollment token: <TOKEN>
```

请妥善保存该令牌。统一控制台地址：

```text
http://<SERVER_IP>:8888/console
```

检查服务：

```bash
sudo systemctl status aidr-server
sudo journalctl -u aidr-server -f
```

运行安装后健康检查：

```bash
cd /opt/aidr-server
sudo -u aidr npm run health-check -- http://127.0.0.1:8888
```

健康检查会验证控制台、Endpoint、Agent、会话、事件、策略和行为原子接口。
尚未注册 Endpoint 时，Endpoint 与 Agent 检查可能显示 `degraded`，这不表示
Server 安装失败。

## 5. 安装 AIDR Endpoint

### 接入统一控制台

```bash
tar -xzf aidr-endpoint-linux.tar.gz
cd aidr-endpoint-linux
sudo bash ./install.sh \
  --server http://<SERVER_IP>:8888 \
  --enrollment-token "<TOKEN>"
```

`--server` 和 `--enrollment-token` 必须同时提供。注册成功后，每台 Endpoint
会获得独立身份和上报令牌，凭据保存在：

```text
/var/lib/aidr/data/policy.json
```

### 独立运行模式

不接入统一控制台时：

```bash
sudo bash ./install.sh
```

独立模式保留本地采集、分析、策略和 API 能力，但不会出现在集中管理控制台中。

### 安装结果

Endpoint 程序目录：

```text
/opt/aidr/agent
```

Endpoint 运行数据：

```text
/var/lib/aidr
```

检查服务：

```bash
sudo systemctl status aidr-endpoint
sudo journalctl -u aidr-endpoint -f
```

## 6. 防火墙配置示例

只允许 Endpoint 网段访问 Server：

```bash
# firewalld 示例
sudo firewall-cmd --permanent \
  --add-rich-rule='rule family="ipv4" source address="10.0.0.0/8" port protocol="tcp" port="8888" accept'
sudo firewall-cmd --reload
```

不要直接将未启用 TLS 的 TCP `8888` 暴露到公网。

## 7. 配置文件

Server 配置：

```text
/etc/aidr/server.env
```

主要配置项：

```ini
AIDR_SERVER_HOST=0.0.0.0
PORT=8888
AIDR_SERVER_DATA_DIR=/var/lib/aidr-server
AIDR_CONSOLE_UI_DIR=/opt/aidr-server/aidr-endpoint/ui
AIDR_ENROLLMENT_TOKEN=<TOKEN>
```

修改配置后重启：

```bash
sudo systemctl restart aidr-server
```

Endpoint 策略和接入配置：

```text
/var/lib/aidr/data/policy.json
```

该文件包含 Endpoint 上报凭据，权限应保持为 `0600`，不要上传到代码仓库或发送给
无关人员。

## 8. 升级

升级前建议备份：

```bash
sudo cp -a /var/lib/aidr /var/lib/aidr.backup
sudo cp -a /var/lib/aidr-server /var/lib/aidr-server.backup
sudo cp -a /etc/aidr /etc/aidr.backup
```

解压新安装包并重新执行对应的 `install.sh`。Endpoint 安装脚本会保留已有
`/var/lib/aidr/data/policy.json`；Server 升级前仍建议保留独立数据备份。

## 9. 卸载

卸载 Endpoint：

```bash
cd aidr-endpoint-linux
sudo bash ./uninstall.sh
```

卸载 Server：

```bash
cd aidr-server-linux
sudo bash ./uninstall.sh
```

卸载脚本默认移除 systemd 服务，但保留运行数据和 Server 配置，便于审计、恢复
或重新安装。确认不再需要后再人工清理：

```bash
sudo rm -rf /var/lib/aidr /var/lib/aidr-server
sudo rm -rf /opt/aidr /opt/aidr-server
sudo rm -rf /etc/aidr
```

## 10. 常见问题

### Endpoint 无法注册

检查：

```bash
curl -I http://<SERVER_IP>:8888/console
sudo journalctl -u aidr-server -n 100 --no-pager
sudo journalctl -u aidr-endpoint -n 100 --no-pager
```

确认 Server 地址可达、注册令牌正确，并且 Server 防火墙允许 Endpoint 来源地址。

### 服务无法启动

确认 Node.js 版本：

```bash
node --version
```

要求为 Node.js 20 或更高版本。然后查看：

```bash
sudo systemctl status aidr-server --no-pager
sudo systemctl status aidr-endpoint --no-pager
sudo journalctl -xeu aidr-server
sudo journalctl -xeu aidr-endpoint
```

### 控制台没有 Endpoint

确认 Endpoint 使用带 `--server` 和 `--enrollment-token` 的命令安装，并检查
Endpoint 日志中是否存在注册失败、鉴权失败或网络连接错误。
