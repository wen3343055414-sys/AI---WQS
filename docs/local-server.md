# 智作台本机服务器

## 服务组成

| 组件 | 实现 | 保存位置 |
| --- | --- | --- |
| 前端 | Nginx，界面与同源 API 代理 | 按版本构建的前端镜像 |
| 后端 | Node.js 24，登录、数据与修订检查 | 按版本构建的后端镜像 |
| 数据库 | SQLite，WAL 与原子写入 | Docker 持久卷 /data |
| 版本 | GitHub 分支与 PR | GitHub |
| 更新服务 | Python 3 + systemd 用户定时器 | 本机用户数据目录 |
| 数据备份 | 一致性快照，保留最近 30 份 | 数据卷 /data/backups/ |

默认 Docker 项目为 ai-wqs-server，持久卷为 ai-wqs-server_workspace-data。前后端重建沿用同一持久卷。

## 安装与访问

本机安装 Git、Python 3 和 Docker Desktop for Linux，以日常用户打开 Docker Desktop，然后运行：

```bash
git clone --branch codex/gpt-docker-github https://github.com/wen3343055414-sys/AI---WQS.git
cd AI---WQS
bash scripts/install-local-server.sh --branch codex/gpt-docker-github
```

访问 http://127.0.0.1:3000，首次设置至少 10 个字符的密码。密码以加盐哈希保存，登录会话使用 HttpOnly Cookie。

默认只绑定本机。局域网访问在安装命令后加 --bind 0.0.0.0，其他设备使用本机局域网 IP 和对应端口，并输入访问密码。连接还取决于本机防火墙和局域网设置。

端口被占用时加 --port 3001。旧版手动 Compose 项目若占用 3000，可在 Docker Desktop 中停止旧项目，或使用新端口。

上面跟随开发分支，适合继续在 GPT 中修改。代码合并后可重新安装并指定 --branch main，改为跟随主分支。仓库与 Docker 引擎需与已有安装一致。

安装文件位于：

```text
~/.local/share/ai-wqs-server/
  config.json       # 仓库、分支、访问地址、Docker context
  current.json      # 当前与上一运行版本
  deployer.py       # 更新入口
  source.git/       # Git 源码缓存
  releases/<SHA>/   # 按提交隔离的代码
```

自定义 XDG_DATA_HOME 时使用对应数据目录。定时器位于用户配置目录的 systemd/user/。首次安装若检查仍在运行，会等待通过后部署；--no-systemd 是手动模式，不安装定时器。

## 自动更新与运行条件

定时器在用户服务启动后运行，每次任务结束约一分钟后再次检查。它会：

1. 取得跟随分支的提交。
2. 确认同一提交的 push 验收成功；未完成、失败或无法读取时保留当前版本。
3. 构建新镜像，备份数据库。
4. 替换前后端，等待健康并核对运行版本。
5. 成功后记录版本；启动失败则恢复上一个镜像，暂停再次部署同一个失败提交。

容器自动重启。电脑必须开机、Docker 引擎运行并能访问 GitHub。Docker Desktop 与用户登录会话有关；可在其设置中开启登录后启动。休眠、断电或退出登录期间不保证持续服务，环境恢复后继续更新。无人登录的全天候服务器应另行使用系统级 Docker Engine。

查看状态与日志：

```bash
systemctl --user status ai-wqs-update.timer
journalctl --user -u ai-wqs-update.service -n 60
python3 ~/.local/share/ai-wqs-server/deployer.py status
python3 ~/.local/share/ai-wqs-server/deployer.py update
```

## 数据保存与冲突

会话、提示词、资料、任务和设置保存在本机数据库。每次保存带基准修订号，过期修订返回 409，保护其他页面的新修改。

前端自动发送修改，未成功的内容保留在页面及可用浏览器缓存中，网络恢复后重试。冲突时选择服务器版本或保留本页内容；双方内容先在浏览器备份。

首次登录空数据库，会迁入同一站点的有效旧浏览器记录。其他设备登录后读取相同工作空间。地址和浏览器不同，初次可迁入的缓存范围也不同。

TXT、Markdown、CSV、JSON 读取 UTF-8；每个文件不超过 1 MB，正文合计不超过 150 万字符，其他格式只保存元数据。每类记录最多 1,000 条，每段会话最多 2,000 条消息，单次请求最多 16 MB。模型回复仍为演示。

## 备份、回退和停止

升级前及运行期间每天备份数据库，最近 30 份保留在数据卷中：

```bash
python3 ~/.local/share/ai-wqs-server/deployer.py backup
python3 ~/.local/share/ai-wqs-server/deployer.py rollback
```

回退先备份再切换到上一代码版本，保留业务数据库；它不会恢复过去的业务内容。被回退提交暂停自动重试，新提交仍可更新。

工作台设置中的 JSON 导出与恢复用于业务数据备份。数据库快照仍在同一电脑，需要另存备份时可将导出的 JSON 保存到其他存储位置。

```bash
# 暂停与恢复自动更新
systemctl --user stop ai-wqs-update.timer
systemctl --user start ai-wqs-update.timer
```

在 Docker Desktop 中停止 ai-wqs-server 可停止服务。长期停止时先暂停定时器。正常停止与镜像重建保留持久卷；删除持久卷会删除数据库。

## 接口

| 接口 | 作用 |
| --- | --- |
| GET /api/health | 健康状态 |
| GET /api/status | 实例、运行版本、初始化与登录状态 |
| POST /api/setup | 首次设置密码 |
| POST /api/login、POST /api/logout | 登录和退出 |
| GET /api/workspace | 读取工作空间、修订和更新时间 |
| PUT /api/workspace | 校验并按修订保存 |

工作空间接口需要登录，变更请求校验来源。数据库、配置、源码与备份不属于公开静态资源。
