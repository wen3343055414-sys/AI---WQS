import { HttpError } from './store.js';

// Generated pages remain drafts. They are validated by WebsiteStore before saving.
export async function generateWebsite(gateway, current, input) {
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 6000)
    throw new HttpError(400, '请填写 1–6000 个字符的网站需求。');
  if (input.revision !== current.revision) throw new HttpError(409, '网站已被其他页面修改，请重新加载后再生成。');
  const textFiles = current.files.filter(file => file.encoding !== 'base64');
  const context = JSON.stringify(textFiles);
  if (context.length + input.prompt.length > 48000) throw new HttpError(400, '网站文本内容较大，请直接编辑文件，或精简后再使用 AI（当前文件与需求合计最多 48000 字符）。');
  const response = await gateway.chat({
    requestId: input.requestId, assistant: 'coding', ...(input.modelKey ? { modelKey: input.modelKey } : {}),
    messages: [{ role: 'user', content: `你在编辑一个真实发布的静态网站。根据需求生成完整可运行的 HTML、CSS、JavaScript 文件。网站名：${current.name}。\n只输出一个 JSON 对象，不要 Markdown 或解释：{"files":[{"path":"index.html","content":"完整代码","encoding":"utf8"}]}。必须包含 index.html；只输出本次网站所需的文本文件，文件之间使用相对 URL，不能使用以 / 开头的站内资源路径。使用原生浏览器功能，无需 npm、服务器端代码或编译。不要放入 API 密钥、虚假接口、无法实现的按钮或虚构的业务数据；表单需要真实接收端才能提交。不要自动发布。保留已有二进制资源的相对路径。\n需求：${input.prompt.trim()}\n当前网站文本文件：${context}` }],
  }, 'website');
  if (response.finishReason === 'length') throw new HttpError(502, '模型输出未完成，草稿未修改。请缩小需求后重试。');
  let result;
  try { result = JSON.parse(String(response.content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new HttpError(502, '模型未返回有效的网站文件，草稿未修改。请调整需求后重试。'); }
  if (!result || !Array.isArray(result.files) || !result.files.length || result.files.some(file => !file || typeof file.path !== 'string' || typeof file.content !== 'string') || !result.files.some(file => file.path === 'index.html'))
    throw new HttpError(502, '模型输出缺少 index.html，草稿未修改。');
  if (result.files.some(file => file.encoding && file.encoding !== 'utf8')) throw new HttpError(502, '模型返回了不支持的文件格式，草稿未修改。');
  const names = new Set(result.files.map(file => file.path));
  const binaries = current.files.filter(file => file.encoding === 'base64' && !names.has(file.path));
  return { files: [...result.files, ...binaries], model: response.model, requestId: response.requestId };
}
