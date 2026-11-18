import assert from 'node:assert/strict';
import { McpClient } from '../src/plugin-network.js';

// Public documentation only: no account token, model inference, or writes.
const client = new McpClient('https://mcp.deepwiki.com/mcp', { timeoutMs: 45000 });
const discovered = await client.connect();
const tool = discovered.tools.find(tool => tool.name === 'read_wiki_structure');
assert.ok(tool, 'Public MCP must advertise read_wiki_structure');
assert.equal(tool.inputSchema.properties.repoName.type, 'string');
let verified = false;
for (const repoName of ['github/github-mcp-server', 'modelcontextprotocol/python-sdk']) {
  const result = await client.call(tool.name, { repoName });
  const text = (result.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
  if (!result.isError && text.length > 40 && !/not found|not indexed|no wiki|error fetching/i.test(text)) {
    console.log(JSON.stringify({ service: 'DeepWiki public MCP', protocol: client.version,
      tools: discovered.tools.map(tool => tool.name), calledTool: tool.name, publicRepository: repoName,
      returnedCharacters: text.length, preview: text.slice(0, 180) }));
    verified = true; break;
  }
}
assert.equal(verified, true, 'Live public MCP must return actual repository documentation');
const github = new McpClient('https://api.githubcopilot.com/mcp/', { github: true, timeoutMs: 30000 });
await assert.rejects(github.connect(), error => error.code === 'plugin_auth');
console.log('GitHub official MCP reached and correctly requires its own authorization; no personal account connection claimed.');
