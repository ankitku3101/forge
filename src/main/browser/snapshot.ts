/**
 * In-page script that produces a compact, model-readable snapshot of the current page and tags
 * interactive elements with `data-aiw-ref` so tools can target them by ref.
 *
 * Kept as a plain string: bundlers (esbuild keepNames) inject helpers into functions, which
 * breaks `page.evaluate(fn)`.
 *
 * Secrets: password and captcha inputs only ever report "(filled)" or "(empty)".
 */
export const SNAPSHOT_SCRIPT = String.raw`(() => {
  const MAX = 12000;
  let n = 0;
  document.querySelectorAll('[data-aiw-ref]').forEach((e) => e.removeAttribute('data-aiw-ref'));
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'meta', 'link']);
  const BLOCK = new Set(['div','main','header','nav','section','article','aside','footer','form','table','thead','tbody','tfoot','tr','ul','ol','li','p','h1','h2','h3','h4','h5','h6','dl','dt','dd','fieldset','label','body']);
  const isInteractive = (el) => el.matches('a[href], button, input:not([type=hidden]), select, textarea, [role=button]');
  const visible = (el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  };
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const isSecret = (el) => el.type === 'password' || /captcha/i.test(el.name || '') || /captcha/i.test(el.id || '');
  const labelFor = (el) => {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) return clean(l.textContent);
    }
    const parentLabel = el.closest('label');
    if (parentLabel) return clean(parentLabel.textContent);
    return el.getAttribute('placeholder') || el.name || '';
  };
  const describe = (el) => {
    const ref = 'e' + (++n);
    el.setAttribute('data-aiw-ref', ref);
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      const dl = el.hasAttribute('download') ? ' download' : '';
      return '[link "' + clean(el.textContent) + '" ref=' + ref + ' href=' + href + dl + ']';
    }
    if (tag === 'button' || el.getAttribute('role') === 'button' || (tag === 'input' && (el.type === 'submit' || el.type === 'button'))) {
      return '[button "' + clean(el.textContent || el.value) + '" ref=' + ref + ']';
    }
    if (tag === 'select') {
      const opts = Array.from(el.options).map((o) => (o.selected ? '*' : '') + clean(o.textContent)).join(', ');
      return '[select "' + labelFor(el) + '" ref=' + ref + ' options: ' + opts + ']';
    }
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
      return '[' + el.type + ' "' + labelFor(el) + '" ref=' + ref + (el.checked ? ' checked' : '') + ']';
    }
    const kind = el.type === 'password' ? 'password' : 'textbox';
    const value = isSecret(el)
      ? (el.value ? ' (filled; value hidden)' : ' (empty)') + (/captcha/i.test((el.name || '') + (el.id || '')) ? ' captcha' : '')
      : el.value ? ' value="' + el.value + '"' : ' (empty)';
    return '[' + kind + ' "' + labelFor(el) + '" ref=' + ref + value + ']';
  };
  const inline = (el) => {
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) out += node.textContent;
      else if (node.nodeType === 1) {
        const tag = node.tagName.toLowerCase();
        if (tag === 'svg') {
          const labelled = node.closest('[aria-label]');
          out += ' [image' + (labelled ? ' "' + labelled.getAttribute('aria-label') + '"' : '') + ' (not readable as text)]';
          continue;
        }
        if (SKIP.has(tag) || !visible(node)) continue;
        out += ' ' + (isInteractive(node) ? describe(node) : inline(node)) + ' ';
      }
    }
    return clean(out);
  };
  const lines = [];
  const hasBlockChild = (el) => Array.from(el.children).some((c) => BLOCK.has(c.tagName.toLowerCase()) || isInteractive(c));
  const walk = (el, depth) => {
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase();
      if (SKIP.has(tag) && tag !== 'svg') continue;
      if (!visible(child)) continue;
      const pad = '  '.repeat(depth);
      if (tag === 'svg') {
        const label = child.closest('[aria-label]');
        lines.push(pad + '[image' + (label ? ' "' + label.getAttribute('aria-label') + '"' : '') + ' (not readable as text)]');
        continue;
      }
      if (tag === 'label') continue; // inputs carry their label
      if (isInteractive(child)) { lines.push(pad + describe(child)); continue; }
      if (/^h[1-6]$/.test(tag)) { lines.push(pad + 'heading "' + inline(child) + '"'); continue; }
      if (tag === 'tr') {
        const cells = Array.from(child.children).map((c) => inline(c));
        lines.push(pad + '| ' + cells.join(' | ') + ' |');
        continue;
      }
      if (tag === 'dt') {
        const dd = child.nextElementSibling;
        lines.push(pad + inline(child) + ': ' + (dd && dd.tagName.toLowerCase() === 'dd' ? inline(dd) : ''));
        continue;
      }
      if (tag === 'dd') continue;
      const role = child.getAttribute('role');
      if (role === 'alert' || role === 'status') { lines.push(pad + '[' + role + '] ' + inline(child)); continue; }
      if (hasBlockChild(child)) { walk(child, tag === 'body' ? depth : depth + 1); continue; }
      const t = inline(child);
      if (t) lines.push(pad + t);
    }
  };
  walk(document.body, 0);
  let text = lines.join('\n');
  if (text.length > MAX) text = text.slice(0, MAX) + '\n[snapshot truncated]';
  return text;
})()`
