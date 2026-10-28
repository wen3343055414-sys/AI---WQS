# AI---WQS

AI 大模型工作台。当前版本先建立可启动、可验证的本地项目入口：浏览器首页、静态资源和健康检查接口。

## 技术栈与依赖

- Node.js 24 LTS（24.10.0 或以上的 24.x 版本），npm 随 Node.js 安装。
- 后端：Node.js 内置 `node:http`；前端：HTML、CSS、原生 JavaScript。
- 零第三方运行时和开发依赖，无需数据库、API 密钥或构建步骤。
- 使用 Node.js 自带的 `.env` 加载、开发监听和测试工具，减少初始配置，便于快速迭代。

此阶段未接入模型服务；页面上的“服务正常”仅表示当前本地 HTTP 服务可达。

## 目录与入口

```text
AI---WQS/
├── .env.example         # 可复制的本地环境配置
├── .gitignore           # 保留原规则，追加 Node.js 与 .env 忽略规则
├── .nvmrc               # Node.js 主版本 24
├── package.json         # 启动、开发、验收命令
├── package-lock.json    # npm 项目元数据，当前无第三方依赖
├── README.md
├── src/
│   └── server.js        # 服务入口：配置、路由、静态资源、退出处理
├── public/
│   ├── index.html       # 页面入口
│   ├── app.js           # 请求健康接口并显示成功/失败状态
│   └── styles.css       # 基础样式
└── tests/
    └── smoke.test.js    # 启动真实服务进程并执行 HTTP 验收
```

## 快速启动

先安装 [Node.js 24 LTS](https://nodejs.org/en/download)，确认 `node --version` 为符合要求的 24.x。

从仓库获取：

```bash
git clone https://github.com/wen3343055414-sys/AI---WQS.git
cd AI---WQS
```

如果使用生成的源码包，解压后进入其中的 `AI---WQS` 目录；源码包中的文件需先落入仓库，远端旧版本才会具备以下命令。

macOS / Linux：

```bash
cp .env.example .env
npm start
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
npm start
```

当前没有第三方依赖，因此启动无需执行 `npm install`。需要检查锁文件安装流程时可执行 `npm ci`。

打开 <http://127.0.0.1:3000>，页面应显示“服务正常 · 页面与后端已连通”。点击“重新检查”会再次请求服务。按 Ctrl+C 停止。

开发时运行：

```bash
npm run dev
```

修改服务入口会自动重启；修改 `public/` 文件后刷新浏览器即可。修改 `.env` 后需手动重启命令。

## 环境变量

`.env.example` 内容：

```dotenv
HOST=127.0.0.1
PORT=3000
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 默认仅本机可访问；需要局域网访问时显式改为 `0.0.0.0` |
| `PORT` | `3000` | 常用配置为 1–65535 的未占用端口；0 用于测试自动分配端口 |

启动脚本要求 `.env` 存在。系统中已设置的同名环境变量优先于文件内容。`.env` 已被忽略，提交 `.env.example` 即可。

## 验收

自动验收不要求事先启动服务，也不读取个人 `.env`：

```bash
npm test
```

测试使用 `.env.example` 与随机本地端口启动真实服务，检查首页、JS/CSS、健康响应、404、405、HEAD 和敏感路径不可访问，并自动结束进程。

服务运行时也可手动验证（PowerShell 可用 `curl.exe`）：

```bash
curl http://127.0.0.1:3000/api/health
```

预期 HTTP 200，响应：

```json
{"status":"ok","app":"AI---WQS"}
```

| 路由 | 预期 |
| --- | --- |
| `GET /` | HTML 首页，200 |
| `GET /api/health` | JSON 健康状态，200 |
| `GET /missing` | JSON 错误，404 |
| `POST /api/health` | JSON 错误，405 |

## 常见问题

- 提示找不到 `.env`：先复制 `.env.example`，并在项目根目录运行命令。
- 提示 `EADDRINUSE`：在 `.env` 中将 `PORT` 改为其他未占用端口，重启并使用新地址。
- 页面显示连接失败：查看终端是否仍有服务进程，确认浏览器地址和端口，再点击“重新检查”。
- 提示不支持 `--env-file` 等参数：检查 Node.js 版本和实际使用的可执行文件路径。

## 下一步扩展顺序

1. 将此骨架提交到工作分支，在干净环境重复启动与 `npm test`；再将相同验收命令加入 CI。
2. 确定第一个具体使用场景及输入、输出与完成标准，形成一条可验收的用户流程。
3. 确定模型服务与凭据方案后，增加一个服务端调用接口；先实现输入校验、超时和错误返回，再接页面表单。
4. 根据实际使用反馈决定是否引入框架、持久化或部署配置；逐项提供可重复验收方式。

Copilot 可辅助编辑和补充测试，不属于项目运行依赖。

## 运行边界

当前为本地开发骨架，未包含鉴权或面向公网部署的配置。没有多模型、会话管理、插件或模拟模型回答。

技术参考：[Node.js 命令行文档](https://nodejs.org/docs/latest-v24.x/api/cli.html) · [版本支持状态](https://nodejs.org/en/about/previous-releases)

## GitHub 保存工作流

仓库根目录的 `AGENTS.md` 要求代理在每个工作阶段结束后，验证修改、更新 `docs/worklog/` 中的公开摘要、提交并推送任务分支。代码和日志只有推送到远端后才算完成备份。此规则需要运行中的代理任务、仓库写入权限和可用网络；它不是实时同步或后台定时服务。

仓库保持公开。默认不上传聊天全文、个人资料、原始附件或密钥。完整聊天与工作摘要不同；只有对具体内容取得明确公开授权后，才可另行导出并提交。

合并配置 PR 后，请从连接本仓库的云端环境启动后续任务；最终回复应给出提交 SHA 和 PR 链接，以便核实保存结果。
