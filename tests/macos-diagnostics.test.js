import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signatureDetails,
  policyStatus,
  readCommand,
} from '../tools/macos-diagnostics.js';

test('macOS diagnosis separates intact ad-hoc signatures from execution policy and never records signing subject names', () => {
  assert.deepEqual(
    signatureDetails(
      'Identifier=local.locade.prototype\nCodeDirectory v=20400 flags=0x2(adhoc)\nSignature=adhoc\n',
    ),
    {
      kind: 'ad-hoc',
      identifier: 'local.locade.prototype',
      hardenedRuntime: false,
    },
  );
  const signed = signatureDetails(
    'Identifier=locade\nAuthority=Developer ID Application: Private Name\nCodeDirectory v=20500 flags=0x10000(runtime)\n',
  );
  assert.equal(signed.kind, 'certificate');
  assert.equal(signed.hardenedRuntime, true);
  assert.ok(!JSON.stringify(signed).includes('Private Name'));
  assert.equal(policyStatus({ ok: true, code: 0 }), 'accepted');
  assert.equal(policyStatus({ ok: false, code: 3, signal: null }), 'rejected');
  assert.equal(
    policyStatus({ ok: false, code: 'ENOENT', signal: null }),
    'unavailable',
  );
  assert.equal(
    policyStatus({
      ok: false,
      code: 1,
      signal: null,
      output: 'internal error',
    }),
    'unavailable',
  );
  assert.equal(
    policyStatus({ ok: false, code: null, signal: 'SIGTERM' }),
    'unavailable',
  );
});

test('diagnostic commands capture failure as evidence rather than claiming success', async () => {
  const result = await readCommand(process.execPath, [
    '-e',
    'console.error("test failure"); process.exit(3)',
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.code, 3);
  assert.match(result.output, /test failure/);
});
