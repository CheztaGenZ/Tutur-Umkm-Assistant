import assert from 'node:assert/strict';
import { escapeHtml } from '../public/escape.js';

assert.equal(escapeHtml('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
assert.equal(escapeHtml(`Tom & "Jerry" 'x'`), 'Tom &amp; &quot;Jerry&quot; &#39;x&#39;');
assert.equal(escapeHtml(null), '');
assert.equal(escapeHtml(0), '0');

console.log('escape ok');
