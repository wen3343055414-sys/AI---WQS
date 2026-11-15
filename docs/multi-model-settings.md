# 多服务商 API 与模型管理

调研日期：2026-11-04 至 2026-11-05（Asia/Shanghai）。

## 参考与设计选择

用户图 1 提供现有连接表单和检测结果；图 2 提供模型列表、状态及用量信息；图 3 提供凭据生命周期与用量限制。保留智作台的浅色管理风格，将信息组织为“服务商连接 / 模型列表 / 用量与限额”。

- [Cherry Studio 服务商与模型](https://cherryai.com.cn/docs/zh-cn/mobile/providers-and-models/)：服务商与模型分层，支持模型同步、手动添加和启停。
- [Dify 模型服务商](https://github.com/langgenius/dify-docs/blob/main/en/cloud/use-dify/workspace/model-providers.mdx)：凭据集中管理，默认模型独立设置。
- [Open WebUI 多连接](https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible/)：多个云端/本机接口统一管理；列表检测与实际对话能力分别判断，不提供 `/models` 的接口可手动添加模型。

服务商列表提供搜索、地区筛选和状态；右侧展示连接、加密密钥、检测及该连接的模型。全局模型表支持显示名称、启停、默认模型和服务商筛选。用量按服务商和模型展示真实请求结果与 Token，限额明确属于本机管理规则。

## 协议与模型边界

支持文本对话：OpenAI Chat Completions 兼容接口、Anthropic Messages、Gemini generateContent。服务商预设只提供地址、协议和文档入口；模型 ID 从接口获取或手动填写，不维护可能过期的默认模型名称。图片、语音、工具调用和流式回复不在本次范围。

- [DeepSeek](https://api-docs.deepseek.com/api/list-models/)
- [阿里云百炼 Base URL](https://help.aliyun.com/zh/model-studio/base-url)
- [Kimi](https://platform.kimi.com/docs/api/chat)、[智谱 GLM](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)、[硅基流动](https://docs.siliconflow.cn/docs/api/chat-completions-post)、[火山方舟](https://console.volcengine.com/ark/region%3Acn-beijing/docs/models-api)
- [MiniMax OpenAI 兼容](https://platform.minimax.cn/docs/api-reference/text-openai-api)：中国站使用当前文档的 `api.minimax.cn/v1`，采用 `max_completion_tokens` 并拆分思考字段，仅保存文本回答。
- [Claude Messages](https://platform.claude.com/docs/en/api/messages/create) 与 [模型列表](https://platform.claude.com/docs/en/api/models)
- [Gemini 生成](https://ai.google.dev/api/generate-content) 与 [模型列表](https://ai.google.dev/api/models)
- [OpenAI Chat API](https://platform.openai.com/docs/api-reference/chat/create)
- [OpenRouter 模型](https://openrouter.ai/docs/api/api-reference/models/get-models)、[Mistral 模型](https://docs.mistral.ai/api/endpoint/models)、[Ollama](https://github.com/ollama/ollama/blob/main/docs/api/introduction.mdx)

预设地址可以修改，须与账户地域及计费方案匹配。连接检测读取模型目录，不发送工作台会话。发现的模型由管理员选择启用；当前工作台只使用文本对话模型。模型列表可访问不等于该账户有对话额度。

## 数据与调用

- 每个连接独立保存 DPAPI 加密密钥，不向浏览器回填密钥。跨域或协议变更需要重新提供凭据。
- 多服务商配置使用新表；首次升级复制既有单接口配置和密文，不要求重新输入原 DeepSeek 密钥。默认模型同步为旧接口兼容快照，方便代码回退。
- 全局默认模型由管理员设置，工作台默认跟随，也可以选择其他已启用模型。密钥和具体地址只存在服务端。
- 模型请求固定到请求中选择的模型，保持去重与异常结果保护。服务商报错由用户决定是否改用另一个连接，避免跨服务商重复计费和转发。
- 用量只记录服务商返回的 usage；Claude 缓存创建/读取计入输入，Gemini 思考 Token 计入输出。缺失或不一致的数据保留为未知，不推算费用或账户余额。
- 月 Token 限额按北京时间统计本服务收到的已报告用量；达到后拒绝新请求。进行中的请求可能超出限额，未知用量无法精确计入，因此不等价于服务商账单硬上限。

## 验收

检查旧配置和用量迁移、每连接凭据隔离、并发配置冲突、默认模型与手动选择、停用与删除、无 `/models` 的手动模型、三种协议的真实 HTTP 测试服务、Token 归一化、请求去重与限额。浏览器在隔离配置环境验收桌面及窄屏，正式更新继续依照精确提交 CI 和升级前备份流程。
