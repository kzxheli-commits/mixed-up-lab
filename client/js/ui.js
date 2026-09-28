// HUD / 大厅 / 聊天 / 结算 界面
import { QUESTS } from './level.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.h = handlers; // {onCreate,onJoin,onStart,onChat,onBack}
    this._toastTimer = null;

    $('btn-create').onclick = () => this.h.onCreate($('nick').value.trim());
    $('btn-join').onclick = () => this.h.onJoin($('nick').value.trim(), $('code').value.trim());
    $('code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.h.onJoin($('nick').value.trim(), $('code').value.trim());
    });
    $('nick').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.h.onCreate($('nick').value.trim());
    });
    $('btn-start').onclick = () => this.h.onStart();
    $('btn-report-back').onclick = () => this.h.onBack();

    const input = $('chat-input');
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = input.value.trim();
        input.value = '';
        input.hidden = true;
        if (text) this.h.onChat(text);
        this.h.onChatClosed?.();
      } else if (e.key === 'Escape') {
        input.value = '';
        input.hidden = true;
        this.h.onChatClosed?.();
      }
    });
  }

  /* ---------------- 大厅 ---------------- */

  lobbyError(msg) { $('lobby-error').textContent = msg || ''; }

  showLobby() {
    $('lobby').hidden = false;
    $('room-box').hidden = true;
    $('join-form').hidden = false;
    $('hud').hidden = true;
    $('report').hidden = true;
  }

  showRoom(code, players, hostId, myId) {
    $('report').hidden = true;
    $('lobby').hidden = false;
    $('join-form').hidden = true;
    $('room-box').hidden = false;
    $('room-code').textContent = code;
    const list = $('player-list');
    list.innerHTML = '';
    for (const p of players) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.dc ? '#556' : p.color;
      li.appendChild(dot);
      li.appendChild(document.createTextNode(p.name + (p.id === myId ? '（我）' : '') + (p.dc ? ' · 离线' : '')));
      if (p.id === hostId) {
        const h = document.createElement('span');
        h.className = 'host';
        h.textContent = '★ 房主';
        li.appendChild(h);
      }
      list.appendChild(li);
    }
    const startBtn = $('btn-start');
    startBtn.hidden = hostId !== myId;
    startBtn.disabled = players.filter((p) => !p.dc).length < 2;
    $('lobby-hint').textContent = startBtn.hidden
      ? '等待房主开始…'
      : players.filter((p) => !p.dc).length < 2 ? '还需要至少 1 名玩家' : '点击开始进入实验';
  }

  /* ---------------- HUD ---------------- */

  showHud() {
    $('lobby').hidden = true;
    $('report').hidden = true;
    $('hud').hidden = false;
    $('feed').innerHTML = '';
    $('chat-log').innerHTML = '';
    this.prompt(null);
    this.tagPanel(null);
  }

  renderQuests(puzzle, orbTaken) {
    const state = {
      chair: puzzle.chairGiven,
      orb: orbTaken || puzzle.corePowered,
      core: puzzle.corePowered,
      exit: false,
    };
    $('quests').innerHTML = QUESTS.map((q) => (
      `<li class="${state[q.id] ? 'done' : ''}">${state[q.id] ? '☑' : '☐'} ${q.text}</li>`
    )).join('');
  }

  setChaos(v, modeOn) {
    $('chaos-bar').style.width = `${v}%`;
    $('chaos-num').textContent = `${Math.round(v)}%`;
    $('hud').classList.toggle('chaosmode', !!modeOn);
  }

  // abilities: {tagRemain, morphRemain, morphing, morphRemainTotal}
  setAbilities(a) {
    const cell = (key, label, cd, extra = '') => `
      <div class="ability ${cd > 0 ? 'cd' : ''}">
        <div><span class="key">${key}</span> ${label}</div>
        <div class="cdtext">${cd > 0 ? `${(cd / 1000).toFixed(0)}s` : extra}</div>
      </div>`;
    $('abilities').innerHTML =
      cell('1-4/R/T', '标签枪', a.tagRemain)
      + cell('Z/X', '缩放枪', a.scaleRemain)
      + cell('G', '复制枪', a.copyRemain)
      + cell('F', a.morphing ? '物化中' : '物化', a.morphRemain, a.morphing ? `${(a.morphRemain / 1000).toFixed(0)}s 后恢复` : '就绪')
      + cell('E/左键', '交互/投掷', 0, '就绪');
  }

  setRoomInfo(code, players, myId) {
    const rows = players.map((p) => {
      const me = p.id === myId ? '（我）' : '';
      const dc = p.dc ? ' 💤' : '';
      const form = p.form === 'box' ? ' 📦' : '';
      return `<div style="color:${p.color}">● ${escapeHtml(p.name)}${me}${form}${dc}</div>`;
    }).join('');
    $('roominfo').innerHTML = `房间 <b>${code}</b><br>${rows}`;
  }

  prompt(html) {
    const el = $('prompt');
    if (!html) { el.classList.remove('show'); el.innerHTML = ''; return; }
    el.innerHTML = html;
    el.classList.add('show');
  }

  tagPanel(html) {
    const el = $('tagpanel');
    el.hidden = !html;
    el.innerHTML = html || '';
  }

  feed(text) {
    const box = $('feed');
    const div = document.createElement('div');
    div.className = 'item';
    div.textContent = text;
    box.appendChild(div);
    while (box.children.length > 6) box.removeChild(box.firstChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 9000);
  }

  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /* ---------------- 聊天 ---------------- */

  openChat() {
    const input = $('chat-input');
    input.hidden = false;
    input.focus();
  }

  chatFocused() {
    return !$('chat-input').hidden;
  }

  chatMsg({ from, color, text }) {
    const log = $('chat-log');
    const div = document.createElement('div');
    div.className = 'msg';
    const b = document.createElement('b');
    b.style.color = color || '#fff';
    b.textContent = `${from}: `;
    div.appendChild(b);
    div.appendChild(document.createTextNode(text));
    log.appendChild(div);
    while (log.children.length > 30) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  /* ---------------- 结算 ---------------- */

  showReport(r) {
    $('report').hidden = false;
    $('report-body').innerHTML = `
      <div class="big">${escapeHtml(r.by.name)} 按下了出口开关！</div>
      <div>⏱ 用时：<b>${r.time}</b></div>
      <div>🧩 完成谜题：<b>${r.puzzle.chairGiven + r.puzzle.corePowered + (r.puzzle.exitOpen ? 1 : 0)}/3</b></div>
      <div>🏷 标签修改：<b>${r.stats.tags}</b> 次</div>
      <div>📦 物化自己：<b>${r.stats.morphs}</b> 次</div>
      <div>🚀 高速投掷：<b>${r.stats.throws}</b> 次</div>
      <div>💥 混乱峰值：<b>${r.stats.chaosPeak}%</b></div>
      <div>🏆 本局称号：<span class="title-badge">${escapeHtml(r.title)}</span></div>
      <div style="color:#8fa3bd;font-size:13px">12 秒后自动返回大厅</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
