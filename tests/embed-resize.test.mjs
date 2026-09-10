import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('iframe resize accepts only the matching window and origin, with bounded heights', async () => {
  const code = await readFile(new URL('../public/resize.js', import.meta.url), 'utf8');
  const events = {};
  const frame = { src: 'https://widgets.example/embed/one', style: {}, contentWindow: { postMessage() {} }, addEventListener() {} };
  const context = {
    window: { addEventListener: (type, handler) => { events[type] = handler; } },
    document: { readyState: 'complete', querySelectorAll: () => [frame] },
    location: { href: 'https://client.example/' }, URL,
  };
  runInNewContext(code, context);
  const message = { data: { type: 'nexo-instagram:resize', height: 740 }, source: frame.contentWindow, origin: 'https://widgets.example' };
  events.message({ ...message, origin: 'https://unrelated.example' });
  events.message({ ...message, source: {} });
  for (const height of [0, -1, '740', 20000, 740.5]) events.message({ ...message, data: { ...message.data, height } });
  assert.equal(frame.style.height, undefined);
  events.message(message);
  assert.equal(frame.style.height, '740px');
  events.message({ ...message, data: { ...message.data, height: 400 } });
  assert.equal(frame.style.height, '400px');
  const handler = events.message;
  runInNewContext(code, context);
  assert.equal(events.message, handler, 'multiple snippets should reuse a single listener');
});
