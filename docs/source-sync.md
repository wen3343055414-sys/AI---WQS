# 本地、云端、GitHub 与运行服务同步

## 代码流程

```text
本地 / 云端任务分支 → 验证并推送 → GitHub PR 审阅 → main
                                                    ↓ 同一提交的 push CI 成功
                                           Windows 每分钟更新任务
                                                    ↓ 备份、构建、健康检查
                                Docker 前端 + Docker 后端 + 独立智作台服务端
```

GitHub 是版本来源。聊天是开发入口：代理把实际修改写入仓库、验证并提交推送。聊天文字、附件和未提交的代码片段不会被后台提取或自动执行。仓库 `AGENTS.md` 要求每次开发收尾提交、推送并提供 PR；没有运行中的开发任务时，代理不会自行提交文件。

两端使用 `https://github.com/wen3343055414-sys/AI---WQS.git`，本机发布跟随分支为 `main`。开始先检查 `git status` 和分支；干净时更新主分支：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
```

有未提交改动时先检查和保留，再整合远端变化，不丢弃或强制覆盖。从最新 `main` 创建任务分支或 worktree 开发，完成后通过 PR 审阅。其他分支没有合入 `main` 前不会在本机部署，不自动合并主分支。

本地聊天应使用 Git 工作副本；云端选择绑定此仓库、基线为 `main` 的环境。每条云端任务有自己的工作空间，恢复历史聊天时仍需重新核对远端与分支，不能认为另一个聊天已经更新过，当前工作副本就会自动更新。并行聊天分别使用任务分支或 worktree，避免相互覆盖。[Codex Cloud 官方说明](https://learn.chatgpt.com/docs/cloud)及 [worktree 官方说明](https://learn.chatgpt.com/docs/environments/git-worktrees)描述了这些工作空间边界。

## 修改、验证与保存

| 内容 | 源代码目录 |
| --- | --- |
| 工作台前端 | `public/` |
| 数据与模型调用后端 | `src/` |
| 独立管理服务与界面 | `admin/` |
| Windows 更新器、模型 Compose 配置 | `ops/windows/` |
| Linux 安装与更新 | `scripts/` |

使用 Node.js 24.10+，没有第三方生产依赖。常规检查：

```bash
npm ci
npm test
node scripts/check-source.mjs
npm run build
python -m unittest discover -s admin/tests -p 'test_*.py'
```

Windows 另外运行 `python -m unittest discover -s tests -p 'test_windows_*.py'`，Linux 运行所有 `test_*.py`。修改 Compose 或后端时还应验证容器 HTTP 行为。GitHub CI 包含 Linux、Windows、Docker 与登录浏览器验收，未通过的提交不会被本机接受。

验证后记录公开工作日志，检查差异并暂存实际源代码，创建 commit，推送当前任务分支并创建或更新 PR。以远端 SHA 和 CI 结果确认代码保存；正式部署还需 PR 合入 `main` 后该 SHA 的 push CI 成功。

收尾核验分四步，报告时保留各自状态：

1. **远端备份**：本次 commit 可在 GitHub 任务分支读取，与本地提交一致。云端工作空间中的未推送提交也需完成这一步。
2. **主分支整合**：PR 已审阅合入 `main`，保留其他聊天已经合入的变更。只推送任务分支不会直接发布。
3. **发布验收**：合并后 `main` 上同一 SHA 的 push CI 成功；任务分支或 PR 的 CI 不能代替它。
4. **本机部署**：前端容器、后端容器和独立服务端都实际运行该提交，并且管理服务验证完成。网络等待、CI 等待和构建中均属于待部署，不能报告为已更新。

源码包含 `public/`、`src/`、`admin/` 与部署脚本；只发布静态前端不能同步后端和模型服务。已经部署的配置、数据库、密钥和业务数据由原有运行目录与持久卷保留。普通聊天里没有落入仓库的代码块，须先在开发任务中实施、验证和推送，不扫描或执行历史聊天文字。

## Windows 更新与数据保留

已安装运行目录由两个相邻目录构成，位置由安装配置决定：

```text
<runtime>/AI-WQS-local/
  config.json                 仓库、跟随分支、端口、Docker/Python 路径
  update-windows.py            稳定入口，加载已接受提交中的更新器
  legacy-updater.py            首次过渡及旧版本回退支持
  current.json                 当前、上一提交及验证状态
  releases/<sha>/              从 GitHub 获取的不可变源码
  integration/                仅用于旧版本回退的本地补丁
<runtime>/AI-WQS-admin/
  config.json                 端口、Node/Python 路径
  scripts/launcher.py          稳定启动与切换入口
  data/admin.sqlite           本机管理账号、会话、加密配置、用量和操作记录
  data/model-bridge-token     只读挂载给后端的内部认证文件
  data/backups/               升级前的管理数据库一致性快照
  data/runtime.json           管理服务实际运行提交、PID 与切换结果
```

`AI-WQS Local Server Update` 任务每分钟检查配置分支。只接受与 SHA 一致且 `.github/workflows/ci.yml` 的 **push** 工作流成功的提交；拒绝分支倒退或分叉。下载源码后先校验文件和归档路径，再构建新镜像。切换前备份工作台与管理数据库；使用原有 Docker 项目和持久卷。

稳定入口 `ops/windows/updater-bootstrap.py` 同时负责 GitHub 网络访问，不修改已接受发布目录中的源码。已验证的原生发布在维护阶段原子刷新安装目录的 `update-windows.py`，后续进程从已接受版本加载核心与网络逻辑；待验证或旧版发布不会刷新入口。需要手动修复入口时，先备份原入口、配置和任务定义，再使用已接受版本的文件；任务名称、参数和业务数据目录保持原样。

入口优先采用明确设置的代理环境变量；没有 HTTP/HTTPS/ALL 代理时读取 Windows 已启用的 Internet 代理设置，`NO_PROXY` 单独存在不会阻止读取系统代理。不改变系统代理。TLS 协商异常允许一次 TLS 1.2 重试，始终验证证书。

REST 查询通过 Git 的 `credential fill` 非交互复用当前用户已有的 GitHub 登录；禁用终端、askpass 和 GCM 登录提示，没有可用登录时继续使用公开接口。凭据仅保留在检查进程内存中，通过标准输入传给 curl，只发往 `api.github.com`，API 不跟随重定向；凭据不进入命令参数、配置、状态文件或日志。不会创建或更改 Git 凭据。已有登录被 GitHub 拒绝时报告 HTTP 401，需要通过原来的 Git 登录方式更新授权。

安装配置可用 `git` 指定已存在的 Git 可执行文件。此时每分钟用 `ls-remote` 读取精确分支，分支未变化不消耗 REST API 额度；只有发现新提交才查询版本比较与 CI。未配置 Git 或 Git 请求失败时使用 REST，每五分钟最多开始一轮查询，健康维护与备份仍按每分钟任务执行。匿名 REST 的共享出口额度可能被其他应用耗尽：遇到 `403` 配额归零或 `429` 时遵守 `X-RateLimit-Reset`/`Retry-After`，把等待时间持久化到安装目录的 `github-network.json`，后续任务到期再试，不立即重复失败请求。普通权限错误仍报告失败。等待期间保留当前健康版本，不能以网络恢复代替 CI 成功。

明确的匿名主配额耗尽（HTTP 403、剩余额度为零、有效重置时间且没有 `Retry-After`）只限制匿名预算，可以使用已有登录的独立预算。HTTP 429、`Retry-After`、无法确定原因的旧冷却记录以及已认证限流均继续等待，不通过切换认证方式提前重试。参见 [GitHub 官方限流说明](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)。

这是持续自动更新，检查间隔约一分钟，还需要 CI、构建及健康检查时间，不保证提交后立即上线。GitHub 不可访问、CI 失败或服务主动停止时保留当前版本，后续检查重试。

项目网络显式启用 IPv4、关闭 IPv6，以匹配后端 `0.0.0.0` 监听和 Windows 模型桥接。这样新建网络不会因 Docker Desktop 的 IPv6-only 默认设置导致 Nginx 连接 IPv6 后端失败。需要 Compose 2.33.1+，参数说明见 [Docker 官方网络文档](https://docs.docker.com/reference/compose-file/networks/#enable_ipv4)。不修改主机或其他 Docker 项目的网络设置。

原安装曾跟随 `codex/gpt-docker-github`。首次切换到 `main`，先整合主分支登录功能与原部署分支的独立服务端、模型及局域网管理，再通过 PR 以保留提交历史的合并方式合入；不能直接指向缺少这些源码的旧 `main`，也不绕过分叉检查。主分支精确提交 CI 成功后，备份本机配置并仅将配置的 `branch` 改为 `main`，运行原更新任务验收三个服务同一 SHA。配置、密钥及数据库不上传仓库。

新版本携带 `ops/windows/release.json`，直接构建仓库源代码，不再重复应用旧模型补丁。前后端通过健康检查后更新提交指针，独立管理启动器在没有管理任务或模型请求执行时切换到该提交的 `admin/`。`AI_WQS_ADMIN_HOME` 指向稳定运行目录，配置、DPAPI 凭据、账号和统计不会搬入发布快照。由管理页面发起更新时先完成操作任务，再由启动器切换，后续定时检查完成版本确认，避免父进程等待自身任务造成死锁。

旧版本兼容补丁的公开源码另存于 `ops/windows/legacy-integration/`，供追溯和隔离重建使用；当前原生发布不加载这份归档。

管理服务也必须通过对应 SHA 的健康检查，最终 `current.json` 的 `verification` 为 `verified`。管理服务拒绝新版本时恢复上一代码和容器；标记失败提交，等待新的修复提交，不无限重试。回退不恢复或覆盖业务数据库。涉及未来数据库结构改动时，开发者仍需设计兼容迁移。

更新后在“版本与更新”核对 Docker 与服务端提交一致，也可查看：

- `http://127.0.0.1:3000/api/status` 的 `version`，模型桥接版本带 `-models-v1` 后缀。
- `http://127.0.0.1:3100/api/health` 的 `revision`。
- 本机 `current.json`、`data/runtime.json` 与 `update.log`。

运行期间需要电脑开机、当前用户登录、Docker Desktop 引擎运行，以及 GitHub 可访问。任务被暂停或工作台被主动停止时不会继续发布；可在管理页面恢复。浏览器检测新工作台版本后在没有未保存输入或模型请求时刷新。

## 不进入公开仓库的内容

真实 `.env`、运行配置、密码和密钥、内部令牌、SQLite 数据库、备份、聊天全文、上传附件、日志、截图、依赖和发布目录不提交。`.gitignore` 与源码检查提供误提交防护，但不能代替审查差异。API 密钥只在用户本机保存，不能为了“同步”而提交。

Linux 原有安装器及 systemd 更新保持可用，发布工作台前后端；Windows 独立管理服务依赖 Windows DPAPI 和任务计划，不自动安装为 Linux 服务。GitHub Pages 静态站点不提供本机数据后端或模型密钥桥接。
