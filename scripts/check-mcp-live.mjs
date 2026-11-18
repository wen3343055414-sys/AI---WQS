import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { McpClient } from '../src/plugin-network.js';
import { WorkspaceStore } from '../src/store.js';
import { PluginService } from '../src/plugins.js';

// Public documentation only: no account token, model inference, or writes.
const directory = await mkdtemp(path.join(os.tmpdir(), 'wqs-mcp-live-'));
const workspace = new WorkspaceStore(directory);
try {
  const owner = workspace.setup(randomBytes(24).toString('hex'));
  const plugins = new PluginService(workspace);
  const connection = await plugins.connect(owner.id, { name: 'DeepWiki public MCP', kind: 'custom',
    endpoint: 'https://mcp.deepwiki.com/mcp', authMode: 'none', token: '' });
  assert.equal(connection.status, 'connected');
  const tool = connection.tools.find(tool => tool.name === 'read_wiki_structure');
  assert.ok(tool, 'Public MCP must advertise read_wiki_structure');
  assert.equal(tool.inputSchema.properties.repoName.type, 'string');
  let verified = false;
  for (const [index, repoName] of ['github/github-mcp-server', 'modelcontextprotocol/python-sdk'].entries()) {
    const call = await plugins.invoke(owner.id, connection.id, tool.name, { repoName }, 'invoke_live_public_' + index, connection.revision);
    const result = call.result, text = (result?.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
    if (call.status === 'success' && text.length > 40 && !/not found|not indexed|no wiki|error fetching/i.test(text)) {
      const repeat = await plugins.invoke(owner.id, connection.id, tool.name, { repoName }, 'invoke_live_public_' + index, connection.revision);
      assert.deepEqual(repeat, call);
      console.log(JSON.stringify({ service: connection.name, connection: connection.status, toolCount: connection.toolCount,
        calledTool: tool.name, callStatus: call.status, publicRepository: repoName, returnedCharacters: text.length, preview: text.slice(0, 180) }));
      verified = true; break;
    }
  }
  assert.equal(verified, true, 'Live public MCP must return actual repository documentation');
  const github = new McpClient('https://api.githubcopilot.com/mcp/', { github: true, timeoutMs: 30000 });
  await assert.rejects(github.connect(), error => error.code === 'plugin_auth');
  console.log('GitHub official MCP reached and correctly requires its own authorization; no personal account connection claimed.');
} finally { workspace.close(); await rm(directory, { recursive: true, force: true }); }
