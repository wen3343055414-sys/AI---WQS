// Addresses are editable templates. Model IDs are discovered from the account,
// never assumed from an outdated static catalog. No credentials live here.
export const PRESETS = Object.freeze([
  { id: 'deepseek', name: 'DeepSeek', region: '中国', protocol: 'openai', baseUrl: 'https://api.deepseek.com', mark: 'DS', color: '#4568e9', docs: 'https://api-docs.deepseek.com/' },
  { id: 'qwen', name: '阿里云百炼', region: '中国', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', mark: 'Q', color: '#7654cf', docs: 'https://help.aliyun.com/zh/model-studio/base-url', note: '默认提供北京按量付费地址。其他地域和业务空间请填写配套地址。' },
  { id: 'moonshot', name: '月之暗面 Kimi', region: '中国', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', mark: 'K', color: '#222c3d', docs: 'https://platform.moonshot.cn/docs/api/chat' },
  { id: 'zhipu', name: '智谱 GLM', region: '中国', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', mark: 'GL', color: '#3059ac', docs: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction' },
  { id: 'siliconflow', name: '硅基流动', region: '中国', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', mark: 'SF', color: '#7255dc', docs: 'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions' },
  { id: 'doubao', name: '火山方舟', region: '中国', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', mark: '火', color: '#3578ca', docs: 'https://console.volcengine.com/ark/region%3Acn-beijing/docs/models-api', note: '使用已开通模型的模型 ID 或推理接入点 ID。' },
  { id: 'minimax', name: 'MiniMax', region: '中国', protocol: 'openai', baseUrl: 'https://api.minimax.cn/v1', mark: 'M', color: '#cc6951', docs: 'https://platform.minimax.cn/docs/api-reference/text-openai-api', note: '默认提供中国站地址。如果模型列表不可用，可手动填写服务商提供的模型 ID。' },
  { id: 'openai', name: 'OpenAI', region: '海外', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', mark: 'O', color: '#258371', docs: 'https://platform.openai.com/docs/api-reference/chat/create' },
  { id: 'anthropic', name: 'Anthropic Claude', region: '海外', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', mark: 'A', color: '#b17657', docs: 'https://platform.claude.com/docs/en/api/messages/create' },
  { id: 'gemini', name: 'Google Gemini', region: '海外', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', mark: 'G', color: '#5482d7', docs: 'https://ai.google.dev/api/generate-content' },
  { id: 'mistral', name: 'Mistral', region: '海外', protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1', mark: 'Mi', color: '#d3852e', docs: 'https://docs.mistral.ai/api/endpoint/models' },
  { id: 'openrouter', name: 'OpenRouter', region: '海外', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', mark: 'OR', color: '#646c98', docs: 'https://openrouter.ai/docs/api/api-reference/models/get-models' },
  { id: 'ollama', name: 'Ollama 本机', region: '本地', protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', authMode: 'none', mark: 'L', color: '#53687a', docs: 'https://github.com/ollama/ollama/blob/main/docs/api/introduction.mdx' },
  { id: 'custom', name: '自定义接口', region: '自定义', protocol: 'openai', baseUrl: '', mark: '+', color: '#697a99', docs: null },
]);
export function inferPreset(baseUrl) {
  let origin;
  try { origin = new URL(baseUrl).origin; } catch { return PRESETS.at(-1); }
  return PRESETS.find(p => p.baseUrl && new URL(p.baseUrl).origin === origin) || PRESETS.at(-1);
}
