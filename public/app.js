const status = document.querySelector('#status');
const button = document.querySelector('#check');

async function checkHealth() {
  button.disabled = true;
  status.textContent = '正在检查服务…';
  status.dataset.state = 'pending';
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.status !== 'ok' || data.app !== 'AI---WQS') throw new Error('健康检查响应不符合预期');
    status.textContent = '服务正常 · 页面与后端已连通';
    status.dataset.state = 'ok';
  } catch (error) {
    status.textContent = `连接失败：${error.message}。请确认本地服务正在运行后重试。`;
    status.dataset.state = 'error';
  } finally {
    button.disabled = false;
  }
}

button.addEventListener('click', checkHealth);
checkHealth();
