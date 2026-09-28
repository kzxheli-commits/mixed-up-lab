// WebSocket 封装：连接、发送、按类型分发
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
    this.myId = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = window.__WS_URL__ || `${proto}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => { this.connected = true; resolve(); };
      this.ws.onerror = () => reject(new Error('无法连接服务器'));
      this.ws.onclose = () => {
        this.connected = false;
        this._emit('close', {});
      };
      this.ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'hello') { this.myId = m.id; this.build = m.build || '?'; }
        this._emit(m.t, m);
      };
    });
  }

  _emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) {
      try { fn(msg); } catch (e) { console.error(`[net:${type}]`, e); }
    }
    for (const fn of this.handlers.get('*') || []) {
      try { fn(msg); } catch (e) { console.error('[net:*]', e); }
    }
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}
