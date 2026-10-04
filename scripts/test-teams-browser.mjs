import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { directBrowserConfig } from './teams-live-config.mjs';

// Exercise the actual installed browser MCP in its own profile, never school accounts.
const directory = await mkdtemp(join(tmpdir(), 'schoolwork-browser-test-'));
process.env.SCHOOLWORK_DATA_DIR = directory;
const { noticeReader, evaluationJson } = await import('../dist/browser-notices.js');
const { discordDomReader } = await import('../dist/discord-cache-browser.js');
const { memberDirectoryReader, memberProfileReader } = await import('../dist/discord-members.js');
const { outlookInboxReader, outlookBodyReader, OutlookBrowser } = await import('../dist/outlook-browser.js');
const http = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (req.url === '/sign-in-fixture') {
    res.setHeader('Set-Cookie', 'fixture_session=synthetic; HttpOnly; Max-Age=3600; SameSite=Lax');
    res.end('<h1>Fixture sign-in complete</h1>');
  } else if (req.url === '/notice-fixture') {
    res.end('<h1>Notification fixture</h1><script>setTimeout(()=>{const n=document.createElement("div");n.setAttribute("role","alert");n.innerText="Teacher updated the deadline";document.body.append(n);setTimeout(()=>n.remove(),1000)},3000)</script>');
  } else if (req.url === '/discord-fixture') {
    res.end('<nav><div data-list-item-id="guildsnav___123456789012345678" aria-label="School"></div><a href="/channels/@me/223456789012345678">DM fixture</a></nav><h1>Homework</h1><ol data-list-id="chat-messages"><li id="chat-messages-223456789012345678-323456789012345678">Teacher: revised project brief<time datetime="2026-10-02T12:00:00Z"></time></li></ol>');
  } else if (req.url === '/discord-members-fixture') {
    res.end(`<h1>Class members fixture</h1><div role="button" aria-label="Show Member List" onclick="document.querySelector('#members').hidden=false">Members</div><div id="members" hidden data-list-id="members-fixture"><div data-list-item-id="members-fixture-1" onclick="show('Student One','m_fre')"><img alt=" "><div role="img" aria-label="student.one, Online"><img alt=" "></div>Student One</div><div data-list-item-id="members-fixture-2" onclick="show('Student Two','sk2')"><img alt=" "><img alt="student.two, Online">Student Two</div></div><script>
    function show(name,role){const d=document.createElement('div');d.setAttribute('role','dialog');const h=document.createElement('h1');h.textContent='User Profile for '+name;const ul=document.createElement('ul');ul.setAttribute('aria-label','Roles');const li=document.createElement('li');li.textContent='Class member';ul.append(li);const more=document.createElement('div');more.setAttribute('role','button');more.textContent='+1';more.onclick=()=>{const extra=document.createElement('li');extra.textContent=role;ul.append(extra);more.remove()};d.append(h,ul,more);document.body.append(d)}
    document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('[role="dialog"]')?.remove()});</script>`);
  } else if (req.url === '/outlook-fixture') {
    res.end(`<title>Mail – Fixture Student – Outlook</title><main><div data-app-section="MessageList"><div role="listbox"><div role="option" id="mail-one" data-convid="fixture-conversation" aria-label="Teacher Project Friday" aria-selected="false">AB<br>Teacher<br>Project<br>Friday<br>Preview only</div></div></div><div data-app-section="MailReadCompose"></div><button onclick="window.sent=true">Send</button></main><script>document.querySelector('[role="option"]').onclick=e=>{e.currentTarget.setAttribute('aria-selected','true');document.querySelector('[data-app-section="MailReadCompose"]').innerHTML='<h2>Project</h2><div class="allowTextSelection"><div role="document" aria-label="Text zprávy">Actual teacher requirements. Due Friday.</div></div><div role="listbox" aria-label="přílohy souborů"><div role="option" aria-label="brief.txt Open 1 kB"><div title="brief.txt">brief.txt</div><div>1 kB</div><button aria-label="Další akce" onclick="document.getElementById(&quot;download-menu&quot;).hidden=false">More</button></div></div><div id="download-menu" role="menu" hidden><a role="menuitem" href="/download">Stáhnout</a></div>'};</script>`);
  } else if (req.url === '/download') {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="brief.txt"');
    res.end('Teacher requirements: build a parser.');
  } else {
    res.end(req.headers.cookie?.includes('fixture_session=synthetic')
      ? '<h1>Fixture assignment</h1><p>Build a parser. Due Friday.</p><a href="/download">Download fixture</a>'
      : '<h1>Fixture session missing</h1>');
  }
});
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${http.address().port}`;
const config = directBrowserConfig();
const args = [...config.args];
args[args.indexOf('--user-data-dir') + 1] = join(directory, 'profile');
args[args.indexOf('--output-dir') + 1] = join(directory, 'teams-browser-output');
async function navigate(path) {
  // ponytail: separate Chrome profiles per source like production (teams/outlook
  // profiles stay apart); a prior download in one profile breaks download clicks
  // in later MCP sessions on the same profile (upstream bug), same-session is fine.
  args[args.indexOf('--user-data-dir') + 1] = join(directory, path === '/outlook-fixture' ? 'outlook-profile' : 'profile');
  args[args.indexOf('--output-dir') + 1] = join(directory, path === '/outlook-fixture' ? 'outlook-browser-output' : 'teams-browser-output');
  const client = new Client({ name: 'live-browser-fixture', version: '1' });
  const transport = new StdioClientTransport({ command: config.command, args, stderr: 'pipe' });
  transport.stderr?.resume();
  try {
    await client.connect(transport);
    const available = new Set((await client.listTools()).tools.map(t => t.name));
    assert.ok(config.tools.include.every(name => available.has(name)));
    const result = await client.callTool({ name: 'browser_navigate', arguments: { url: url + path } });
    assert.ok(!result.isError, 'Browser MCP navigation failed');
    const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} });
    assert.ok(!snapshot.isError, 'Browser MCP snapshot failed');
    const text = snapshot.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (path === '/notice-fixture') {
      await client.callTool({ name: 'browser_evaluate', arguments: { function: noticeReader } });
      await client.callTool({ name: 'browser_wait_for', arguments: { time: 5 } });
      const drained = await client.callTool({ name: 'browser_evaluate', arguments: { function: noticeReader } });
      const items = evaluationJson(drained.content.filter(c => c.type === 'text').map(c => c.text).join('\n')).items;
      assert.equal(items.length, 1, 'Transient notice must survive after its DOM element disappears');
      assert.match(items[0].text, /updated the deadline/);
    }
    if (path === '/discord-fixture') {
      const result = await client.callTool({ name: 'browser_evaluate', arguments: { function: discordDomReader } });
      const dom = evaluationJson(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
      assert.equal(dom.guilds.length, 1);
      assert.equal(dom.messages.length, 1);
      assert.match(dom.messages[0].text, /revised project brief/);
    }
    if (path === '/assignment') {
      assert.match(text, /Build a parser\. Due Friday/, 'Persistent fixture sign-in must survive Chrome shutdown');
      const ref = text.match(/link "Download fixture"[^\n]*?\[ref=([^\]]+)\]/)?.[1];
      assert.ok(ref, 'Fixture download link missing');
      const clicked = await client.callTool({ name: 'browser_click', arguments: { target: ref } });
      assert.ok(!clicked.isError, JSON.stringify(clicked));
      await client.callTool({ name: 'browser_wait_for', arguments: { time: 1 } });
    }
    if (path === '/discord-members-fixture') {
      async function evaluate(fn) {
        const result = await client.callTool({ name: 'browser_evaluate', arguments: { function: fn } });
        assert.ok(!result.isError, JSON.stringify(result.content));
        return evaluationJson(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
      }
      const ids = await evaluate(memberDirectoryReader);
      assert.equal(ids.length, 2);
      const first = await evaluate(memberProfileReader(ids[0].id));
      assert.equal(first.name, 'Student One'); assert.ok(first.roles.includes('m_fre'));
      await client.callTool({ name: 'browser_press_key', arguments: { key: 'Escape' } });
      const second = await evaluate(memberProfileReader(ids[1].id));
      assert.equal(second.name, 'Student Two'); assert.ok(second.roles.includes('sk2'));
      assert.ok(!second.roles.includes('m_fre'), 'A previous profile must never supply another member\'s roles');
    }
    if (path === '/outlook-fixture') {
      const evaluate = async fn => {
        const result = await client.callTool({ name: 'browser_evaluate', arguments: { function: fn } });
        assert.ok(!result.isError, JSON.stringify(result.content));
        return evaluationJson(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
      };
      const inbox = await evaluate(outlookInboxReader);
      assert.equal(inbox.owner, 'Fixture Student'); assert.equal(inbox.messages.length, 1);
      assert.equal(inbox.messages[0].key, 'fixture-conversation');
      assert.equal(inbox.messages[0].subject, 'Project');
      const ref = text.match(/option "Teacher Project Friday"[^\n]*?\[ref=([^\]]+)\]/)?.[1];
      assert.ok(ref);
      const result = await client.callTool({ name: 'browser_click', arguments: { target: ref } });
      assert.ok(!result.isError);
      const body = await evaluate(outlookBodyReader.replace('const expectedKey = null;', 'const expectedKey = "fixture-conversation";'));
      assert.equal(body.bodyLoaded, true); assert.equal(body.body, 'Actual teacher requirements. Due Friday.');
      const stale = await evaluate(outlookBodyReader.replace('const expectedKey = null;', 'const expectedKey = "other-conversation";'));
      assert.equal(stale.bodyLoaded, false, 'Selected identity must match; never reuse another body');
      assert.equal(await evaluate('() => !!window.sent'), false, 'No mailbox write actions');
      const reader = new OutlookBrowser();
      reader.text = async (name, arguments_ = {}) => {
        const result = await client.callTool({ name, arguments: arguments_ });
        assert.ok(!result.isError, JSON.stringify(result));
        return result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      };
      reader.collect = async () => ({ owner: inbox.owner, discovered: [], observations: [{ id: 'fixture', kind: 'email', title: 'Mail', sourceUrl: url + path, text: JSON.stringify(body) }] });
      const downloaded = await reader.downloadAttachment({ id: 'fixture', kind: 'email', title: 'Mail', intervalMs: 1 }, 'brief.txt');
      const { readBrowserDownload, removeBrowserDownload } = await import('../dist/teams-downloads.js');
      const document = await readBrowserDownload(downloaded.downloadFile, 'outlook');
      assert.match(document.parts[0].text, /Teacher requirements/);
      await removeBrowserDownload(downloaded.downloadFile, 'outlook');
    }
    return text;
  } finally {
    try { await client.callTool({ name: 'browser_close', arguments: {} }); } catch { /* Release failed transport below. */ }
    await client.close();
  }
}
try {
  assert.match(await navigate('/sign-in-fixture'), /Fixture sign-in complete/);
  // New MCP process must reuse the existing profile's synthetic session.
  assert.match(await navigate('/assignment'), /Build a parser\. Due Friday/);
  process.env.SCHOOLWORK_DATA_DIR = directory;
  const { readTeamsDownload } = await import('../dist/teams-downloads.js');
  const document = await readTeamsDownload('brief.txt');
  assert.match(document.parts[0].text, /Teacher requirements/);
  await navigate('/notice-fixture');
  await navigate('/discord-fixture');
  await navigate('/discord-members-fixture');
  await navigate('/outlook-fixture');
  console.log('Live Chrome MCP verified: persistent session, download/extraction, notification observer, Discord DOM reader and Outlook inbox/selected-body reader. Real account access is verified separately.');
} finally {
  await new Promise(resolve => http.close(resolve));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
