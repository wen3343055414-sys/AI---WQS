# 网站公网通道

> 此文描述旧版可选公网通道。1.5 版默认采用 [工作台局域网部署](domain-access.md)，管理界面已移除独立静态建站编辑器；旧通道不会在本地模式自动恢复。

网站访客服务使用独立的本机端口，默认 `127.0.0.1:3200`。公网通道只转发此端口，不转发管理端口 `3100` 或工作台端口 `3000`。网站草稿、管理接口、数据库和本机文件不会作为访客静态文件提供。

## 安装和连接

在已安装的稳定管理目录准备通道程序，例如：

```powershell
python C:\path\to\AI-WQS\admin\scripts\install-website-tunnel.py --root C:\path\to\AI-WQS-admin
```

`--root` 必须指向包含现有 `config.json` 的稳定安装目录；脚本拒绝 Git 工作副本及不可变的 `releases/`、`integrated/` 目录。安装脚本从 Cloudflare 官方 GitHub Release 下载适合当前 Windows 或 Linux 的独立程序，按照 GitHub asset digest 或发布说明中的 SHA256 校验后原子替换。校验缺失或不匹配时拒绝安装。可使用 `--version YYYY.M.N` 固定版本。

安装后，在网站管理中开启公网通道。页面只有在程序报告已注册连接后才显示公网地址；申请到域名但尚未连通、网络断线或程序退出都不会显示为已连接。管理服务保存是否启用通道，正常重启后重新申请地址。停止通道会取消下次重启时的自动连接。

`websiteTunnelExecutable` 可在管理端本机配置中指定已安装 `cloudflared` 的绝对路径，默认使用稳定管理目录中的 `tools/cloudflared.exe`（Linux 为 `tools/cloudflared`）。此字段只由本机配置提供，不接受浏览器传入程序路径或命令参数。进程使用固定的本机网站端口、独立空配置和 HTTP/2 连接，并清除继承的其他通道环境设置，避免意外使用已有隧道的路由或凭据。

## 地址与可用性

Cloudflare Quick Tunnel 提供真实的公网 HTTPS 入口；知道链接的人可以访问已发布网站，无需 Cloudflare 账号。它使用随机 `trycloudflare.com` 域名，每次新建连接地址可能变化，停止程序后原地址失效。此服务没有运行时间保证，最多支持 200 个进行中的请求，不支持 SSE。电脑关机、休眠、断网或管理进程停止时网站不能通过此入口访问。

需要固定域名和持续对外服务时，应配置正式的 Cloudflare Named Tunnel 或其他受管理托管入口，将其源站指向同一个网站访客端口。Quick Tunnel 不等于固定域名托管，页面不会将临时地址描述为永久部署。

参考：[Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)、[运行参数](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)、[官方发行版](https://github.com/cloudflare/cloudflared/releases)。
