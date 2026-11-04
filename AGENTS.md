# 项目工作与保存规则

本仓库公开。每次任务开始时阅读本文件。

## 唯一代码来源与任务开始

- 本地聊天和云端聊天都在本仓库的实际 Git 工作副本中开发；默认协作与本机跟随分支为 `codex/gpt-docker-github`。
- 开始先检查 `git status`、当前分支和远端。在工作区干净时 `git fetch origin`、`git pull --ff-only origin codex/gpt-docker-github`；存在未提交修改时先保留并检查，不能 reset、覆盖或丢弃。
- 并行任务使用各自分支或 worktree，完成后审阅并整合到跟随分支，不强制推送。
- 修改应用用 `public/`、`src/`，管理服务用 `admin/`，Windows 发布与更新用 `ops/windows/`。不要修改已部署的 `releases/`、`integrated/` 或运行目录来代替源代码修改。
- 收尾前再次检查远端是否前进，解决并验证并行变更后再推送。只有 GitHub 上可读取的提交才算同步完成。

## 工作阶段结束时

1. 检查差异并执行适合本次修改的验证；项目运行验收使用 `npm test`。
2. 将本次项目需求摘要、技术决定、修改、验证结果、未完成事项写入 `docs/worklog/YYYY-MM-DD.md`，日期使用 Asia/Shanghai。仅记录适合公开的项目事实。
3. 只暂存本次任务相关文件；创建说明清楚的 Git commit，并推送到任务分支。默认分支为 main 时，先建立任务分支。
4. 已有 PR 则沿用；需要交付时创建 PR。不得自动合并 main，不得强制推送，不覆盖他人工作。
5. 最终回复提供分支、commit SHA、PR 链接和验证结果。缺少权限或网络、推送失败时明确报告“未完成远端备份”，保留本地修改。

## 公开内容边界

- 不提交聊天全文、个人资料、账号信息、凭据、API 密钥、真实 .env、上传原始附件、依赖目录或临时文件。
- 工作日志是公开项目摘要，不是逐字聊天备份。不要复制对话中的隐私信息。
- 完整聊天导出到仓库必须有用户对具体内容的明确公开授权；默认不执行。

## 自动保存能力边界

这些是代理在任务执行期间遵循的指令，不是后台服务或实时同步机制。没有运行中的任务时不会自动提交；文件保存在云端工作区也不等于已推送 GitHub。只有远端分支可读取的提交才算完成备份。

## 本机服务器

- 前端为 public/，后端为 src/，部署为 compose.yaml 的 frontend/backend 服务。数据库和备份在 Docker 持久卷，不进入代码仓库。
- 已实现独立 Windows 管理服务、真实模型调用和 Token 统计。密钥在本机 DPAPI 加密保存，工作台通过内部认证通道调用，旧演示历史保留标记。
- 后续修改运行 `npm test`、`node scripts/check-source.mjs` 和 `npm run build`。Windows 运行 `python -m unittest discover -s tests -p 'test_windows_*.py'`，Linux 运行全部 `test_*.py`；另运行 `python -m unittest discover -s admin/tests -p 'test_*.py'`。容器改动验证 Compose 与 HTTP 行为。
- 本机只跟随安装配置的分支。代码需推送或经审阅合入该分支，CI 成功后自动部署。不要声称其他分支已在本机上线。
- 数据结构变更需考虑持久化、迁移与代码回退，不自动删除数据卷或恢复旧业务数据。
- Windows 本机更新由任务计划每分钟检查，通过同一 SHA 的 push CI 后更新 Docker 前后端和独立管理服务；管理服务保留稳定的数据目录，切换失败回退代码。Linux 原有 systemd 路径继续保留，不包含 Windows DPAPI 管理服务。
- 不将未经提交的聊天代码片段当成自动同步。持续更新需要本机开机、用户登录、Docker 运行和 GitHub 可访问。
