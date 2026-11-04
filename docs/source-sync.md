# 本地、云端、GitHub 与运行服务同步

## 代码流程

```text
本地 Git 工作副本 ← 拉取/推送 → GitHub codex/gpt-docker-github ← 拉取/推送 → 云端 Git 工作副本
                                      ↓ 同一提交的 push CI 成功
                               Windows 每分钟更新任务
                                      ↓ 备份、构建、健康检查
                  Docker 前端 + Docker 后端 + 独立智作台服务端
```

GitHub 是版本来源。聊天是开发入口：代理把实际修改写入仓库、验证并提交推送。聊天文字、附件和未提交的代码片段不会被后台提取或自动执行。仓库 `AGENTS.md` 要求每次开发收尾提交、推送并提供 PR；没有运行中的开发任务时，代理不会自行提交文件。

两端使用 `https://github.com/wen3343055414-sys/AI---WQS.git`，跟随分支为 `codex/gpt-docker-github`。开始先检查 `git status` 和分支；干净时执行：

```bash
git fetch origin
git switch codex/gpt-docker-github
git pull --ff-only origin codex/gpt-docker-github
```

有未提交改动时先检查和保留，再整合远端变化，不丢弃或强制覆盖。多个任务同时开发时使用任务分支或 worktree，经审阅合入跟随分支。其他分支没有合入前不会在本机部署。主分支通过 PR 审阅，不自动合并。

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

Windows 另外运行 `python -m unittest discover -s tests -p 'test_windows_*.py'`，Linux 运行所有 `test_*.py`。修改 Compose 或后端时还应验证容器 HTTP 行为。GitHub CI 包含 Linux、Windows、Docker 三部分，未通过的提交不会被本机接受。

验证后记录公开工作日志，检查差异并暂存实际源代码，创建 commit，再 `git push origin codex/gpt-docker-github`。以远端 SHA 和 CI 结果确认同步，不能只看本地文件已保存。

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
