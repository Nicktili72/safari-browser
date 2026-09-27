import { defineContentScript } from '#imports';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  world: 'MAIN',
  allFrames: true,
  main() {
    if (window.__sbfContent) return;
    window.__sbfContent = true;

    const registry = new Map<string, Element>(); // '@eN' -> Element
    const elToKey = new Map<Element, string>(); // Element -> '@eN'
    let nextRef = 0;

    // ---------------------------------------------------------------- helpers
    function isClickable(el) {
      if (el.tagName === 'INPUT' && ['hidden', 'submit', 'reset', 'button', 'image'].includes(el.type)) return true;
      if (el.tagName === 'BUTTON') return true;
      if (el.tagName === 'A' && el.getAttribute('href')) return true;
      const role = el.getAttribute('role');
      if (['button', 'link', 'menuitem', 'tab'].includes(role)) return true;
      const cs = getComputedStyle(el);
      if (cs.pointerEvents !== 'none' && el.onclick) return true;
      const ta = el.closest('textarea');
      if (ta) return false;
      const ig = el.closest('[contenteditable]');
      if (ig) return false;
      return false;
    }

    function isInteractive(el) {
      const tag = el.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag)) return true;
      if (el.getAttribute('contenteditable') === 'true') return true;
      const role = el.getAttribute('role');
      if (['textbox', 'combobox', 'listbox', 'option', 'button', 'link'].includes(role)) return true;
      return false;
    }

    function isIgnored(el) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') return true;
      if (el.closest('[contenteditable]')) return false;
      const tag = el.tagName;
      return tag === 'STYLE' || tag === 'SCRIPT' || tag === 'NOSCRIPT' || tag === 'SVG';
    }

    function getRole(el) {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'BUTTON') return 'button';
      if (tag === 'A' && el.getAttribute('href')) return 'link';
      if (tag === 'INPUT') { const t = el.type; if (['checkbox', 'radio'].includes(t)) return t; if (['text', 'search', 'password'].includes(t)) return 'textbox'; return 'button'; }
      if (tag === 'SELECT') return 'listbox';
      if (tag === 'TEXTAREA') return 'textbox';
      const cs = getComputedStyle(el);
      if (cs.display === 'block' && ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag)) return 'heading';
      return null;
    }

    function getAria(el) {
      const parts = [];
      const val = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
      if (val) parts.push('aria-label=' + (val.startsWith('#') ? '...' : val));
      const desc = el.getAttribute('aria-describedby');
      if (desc) parts.push('aria-describedby=' + desc);
      const state = el.getAttribute('aria-expanded');
      if (state !== null) parts.push('aria-expanded=' + state);
      const checked = el.getAttribute('aria-checked');
      if (checked !== null) parts.push('aria-checked=' + checked);
      const pressed = el.getAttribute('aria-pressed');
      if (pressed !== null) parts.push('aria-pressed=' + pressed);
      return parts;
    }

    function getSelector(el) {
      const parts = [];
      while (el && el.nodeType === 1 && el.tagName) {
        let tag = el.tagName.toLowerCase();
        if (el.id) { tag += '#' + el.id; parts.unshift(tag); break; }
        const parent = el.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(el) + 1;
            tag += `:nth-of-type(${idx})`;
          }
        }
        parts.unshift(tag);
        el = el.parentElement;
        if (parts.length > 5) break;
      }
      return parts.join(' > ');
    }

    function getText(el, maxLen) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'INPUT') {
        return el.value ? `${el.type} value="${el.value.substring(0, 100)}"` : el.type;
      }
      if (tag === 'TEXTAREA') {
        return `textarea value="${el.value.substring(0, 100)}"`;
      }
      if (tag === 'SELECT') {
        const sel = el.options[el.selectedIndex];
        if (sel) return `select value="${sel.text.substring(0, 100)}"`;
      }
      const texts = [];
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) {
          const t = n.textContent.trim();
          if (t) texts.push(t);
        }
      });
      return texts.slice(0, 3).join(' ').substring(0, maxLen || 50);
    }

    function snapshot(maxChars) {
      registry.clear();
      elToKey.clear();
      nextRef = 0;
      document.querySelectorAll('[data-sbf-ref]').forEach((n) => n.removeAttribute('data-sbf-ref'));

      const lines = [];
      const addRef = (el) => {
        let key = elToKey.get(el);
        if (!key) {
          nextRef += 1;
          key = '@e' + nextRef;
          registry.set(key, el);
          elToKey.set(el, key);
          el.setAttribute('data-sbf-ref', String(nextRef));
        }
        return key;
      };

      const walk = (el) => {
        if (!el || !el.shadowRoot && !el.parentElement) {
          lines.push(`<${el?.tagName?.toLowerCase() || 'root'} .../>`);
          return;
        }
        if (isIgnored(el)) return;

        let depth = 0;
        let parent = el;
        while (parent && parent !== document) { depth++; parent = parent.parentElement; }

        let attrs = '';
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
          const t = el.getAttribute('type') || 'text';
          const p = ['type', 'name', 'placeholder', 'id', 'required', 'disabled', 'checked', 'value'];
          p.forEach((a) => { if (el.hasAttribute(a)) attrs += ` ${a}="${String(el.getAttribute(a)).substring(0, 50)}"`; });
        } else {
          const p = ['id', 'name', 'role', 'class', 'href', 'src', 'data-sbf-ref'];
          p.forEach((a) => { if (el.hasAttribute(a) && el.getAttribute(a).length < 100) attrs += ` ${a}="${el.getAttribute(a)}"`; });
        }

        const clickable = isClickable(el) ? addRef(el) : null;
        const interactive = isInteractive(el) && !clickable ? addRef(el) : null;
        const aria = getAria(el).join(' ');

        const tag = el.tagName.toLowerCase();
        const clickableStr = clickable ? ` @e${clickable.slice(1)}` : '';
        const interactiveStr = interactive ? ` @e${interactive.slice(1)}` : '';
        const refStr = (clickable || interactive) ? ` @e${(clickable || interactive).slice(1)}` : '';

        const text = getText(el, 50);
        let line = `<${tag}${refStr}${attrs}${aria}${clickableStr}${interactiveStr}${text ? ` "${text}"` : ''}/>`;
        if (text && text.length > 40) line += '...';
        lines.push(line);

        if (el.shadowRoot && el.shadowRoot.children) {
          Array.from(el.shadowRoot.children).forEach((c) => {
            line += `\n  [shadow]`;
            walk(c);
          });
        } else if (el.childNodes && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') {
          const maxChildren = 10;
          let children = Array.from(el.childNodes);
          if (children.length > maxChildren) {
            children = children.slice(0, maxChildren);
            lines.push(`  ...(${el.childNodes.length - maxChildren} more children)`);
          }
          children.forEach((c) => {
            if (c.nodeType === 3 && c.textContent.trim()) {
              const txt = c.textContent.trim();
              if (txt.length < 200) lines.push(`  ${txt}`);
              else lines.push(`  ${txt.substring(0, 200)}...`);
            }
            if (c.nodeType === 1) walk(c);
          });
        }
      };

      walk(document.body);
      let result = lines.join('\n');
      if (result.length > maxChars) result = result.substring(0, maxChars) + `\n...(truncated, ${result.length} chars total)`;
      return result;
    }

    function handleCommand(op, args) {
      const ref = args.ref;
      if (ref) {
        const target = registry.get(ref);
        if (!target) return { ok: false, error: `ref ${ref} not found in snapshot` };
        switch (op) {
          case 'click': {
            target.scrollIntoView?.({ block: 'center', inline: 'center' });
            target.click();
            const form = target.closest('form');
            if (form) {
              const submitBtn = form.querySelector('[type="submit"]');
              if (submitBtn) { submitBtn.click(); return { ok: true }; }
              form.requestSubmit?.();
              return { ok: true };
            }
            if (target.tagName === 'A' && target.getAttribute('href') && !target.getAttribute('href')?.startsWith('#') && !target.getAttribute('href')?.startsWith('javascript:')) {
              window.location.assign(target.getAttribute('href'));
            }
            return { ok: true };
          }
          case 'fill': {
            target.focus();
            if (target.tagName === 'SELECT') {
              target.value = args.value;
              target.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            }
            if (target.isContentEditable) {
              target.textContent = args.value;
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            }
            if (target.value !== undefined) {
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (nativeInputValueSetter) { nativeInputValueSetter.call(target, args.value); }
              else target.value = args.value;
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return { ok: true };
          }
          case 'value': {
            if (target.isContentEditable) return { ok: true, value: target.textContent };
            if (target.value !== undefined) return { ok: true, value: target.value };
            return { ok: false, error: 'no value for element' };
          }
          case 'select': {
            if (target.tagName === 'SELECT') {
              target.value = args.value;
              target.dispatchEvent(new Event('change', { bubbles: true }));
              return { ok: true };
            }
            return { ok: false, error: 'not a SELECT element' };
          }
          case 'press': {
            if (args.ref) {
              target.focus();
              if (typeof target.setSelectionRange === 'function') {
                target.setSelectionRange(0, target.value?.length || 0);
              }
            }
            const el = args.ref ? registry.get(args.ref) : document.activeElement;
            if (el) {
              el.dispatchEvent(new KeyboardEvent('keydown', { key: args.key, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keypress', { key: args.key, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { key: args.key, bubbles: true }));
              return { ok: true };
            }
            return { ok: false, error: 'no target for key press' };
          }
          case 'scroll': {
            const dx = args.dx || 0;
            const dy = args.dy || 0;
            target.scrollBy?.({ left: dx, top: dy, behavior: 'smooth' });
            target.scrollIntoView?.({ block: 'center', inline: 'center' });
            return { ok: true };
          }
          default:
            return { ok: false, error: `unknown op: ${op}` };
        }
      }
      return { ok: false, error: 'no ref specified' };
    }

    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.__sbf !== 'cmd') return;
      (async () => {
        try {
          let r;
          switch (msg.op) {
            case 'snapshot': r = snapshot(msg.maxChars); break;
            default: r = handleCommand(msg.op, msg);
          }
          sendResponse(r);
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
      })();
      return true; // async response
    });
  },
});
