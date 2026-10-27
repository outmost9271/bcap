import fs from 'node:fs';

const MOUSE_ACTIONS = ['MouseUp','MouseDown','Click','ContextMenu','DblClick','Focus','Blur','TouchStart','TouchMove_Departed','TouchEnd','TouchCancel'];

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function serialize(node) {
  if (!node) return '';
  switch (node.type) {
    case 0: // Document
      return (node.childNodes || []).map(serialize).join('');
    case 1: // DocumentType
      return `<!DOCTYPE ${node.name || 'html'}>`;
    case 2: {
      const tag = node.tagName;
      const attrs = Object.entries(node.attributes || {})
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => (v === true ? k : `${k}="${esc(v)}"`))
        .join(' ');
      const open = `<${tag}${attrs ? ' ' + attrs : ''}`;
      if (VOID_TAGS.has(String(tag).toLowerCase())) return open + '/>';
      return open + '>' + (node.childNodes || []).map(serialize).join('') + `</${tag}>`;
    }
    case 3: // Text
      return esc(node.textContent || '');
    case 4: // CDATA
      return `<![CDATA[${node.textContent || ''}]]>`;
    case 5: // Comment
      return `<!--${node.textContent || ''}-->`;
    default:
      return '';
  }
}

export function loadEvents(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * 从 rrweb 事件流重建 DOM。
 * 返回 { htmlAt(time), keyframes() }
 */
export function createReplay(events) {
  const mirror = new Map();
  let root = null;

  const unindex = (node) => {
    if (node.id != null) mirror.delete(node.id);
    for (const c of node.childNodes || []) unindex(c);
  };

  const index = (node, parent) => {
    node.__parent = parent;
    if (node.id != null) mirror.set(node.id, node);
    for (const c of node.childNodes || []) index(c, node);
  };

  const applyFull = (node) => {
    for (const n of mirror.values()) delete n.__parent;
    mirror.clear();
    root = JSON.parse(JSON.stringify(node));
    index(root, null);
  };

  const applyMutation = (data) => {
    for (const r of data.removes || []) {
      const n = mirror.get(r.id);
      if (!n) continue;
      const p = n.__parent;
      if (p && p.childNodes) {
        const i = p.childNodes.indexOf(n);
        if (i >= 0) p.childNodes.splice(i, 1);
      }
      unindex(n);
    }

    for (const a of data.adds || []) {
      const parent = mirror.get(a.parentId);
      if (!parent) continue;
      const node = JSON.parse(JSON.stringify(a.node));
      index(node, parent);
      if (!parent.childNodes) parent.childNodes = [];
      if (a.nextId == null) {
        parent.childNodes.push(node);
      } else {
        const i = parent.childNodes.findIndex((c) => c.id === a.nextId);
        if (i < 0) parent.childNodes.push(node);
        else parent.childNodes.splice(i, 0, node);
      }
    }

    for (const t of data.texts || []) {
      const n = mirror.get(t.id);
      if (n) n.textContent = t.value;
    }

    for (const a of data.attributes || []) {
      const n = mirror.get(a.id);
      if (n) n.attributes = { ...(n.attributes || {}), ...a.attributes };
    }
  };

  const applyInput = (data) => {
    const n = mirror.get(data.id);
    if (!n) return;
    if (data.text != null) n.attributes = { ...(n.attributes || {}), value: data.text };
    if (data.isChecked != null) n.attributes = { ...(n.attributes || {}), checked: data.isChecked };
  };

  const htmlAt = (time = Infinity) => {
    // 每次重建都从零开始，避免上一次调用的状态泄漏
    mirror.clear();
    root = null;
    for (const e of events) {
      if (e.__t != null && e.__t > time) break;
      if (e.type === 2) applyFull(e.data.node);
      else if (e.type === 3 && e.data?.source === 0) applyMutation(e.data);
      else if (e.type === 3 && e.data?.source === 5) applyInput(e.data);
    }
    return root ? serialize(root) : '';
  };

  const keyframes = () => {
    const out = [];
    for (const e of events) {
      if (e.type === 2) out.push({ t: e.__t, kind: 'full-snapshot' });
      else if (e.type === 3 && e.data?.source === 2) {
        out.push({ t: e.__t, kind: 'mouse', action: MOUSE_ACTIONS[e.data.type] || e.data.type, nodeId: e.data.id });
      } else if (e.type === 3 && e.data?.source === 5) {
        out.push({ t: e.__t, kind: 'input', nodeId: e.data.id, text: e.data.text });
      } else if (e.type === 3 && e.data?.source === 0) {
        out.push({ t: e.__t, kind: 'mutation' });
      }
    }
    return out;
  };

  return { htmlAt, keyframes };
}
