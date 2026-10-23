import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function signatureDetails(text) {
  return {
    kind: /^Signature=adhoc$/m.test(text)
      ? 'ad-hoc'
      : /^Authority=/m.test(text)
        ? 'certificate'
        : 'unknown',
    identifier: text.match(/^Identifier=(.+)$/m)?.[1] || null,
    // Do not copy certificate subject names or local signing identities into reports.
    hardenedRuntime: /^CodeDirectory\b.*flags=.*\bruntime\b/m.test(text),
  };
}

export function policyStatus(result) {
  if (result.ok) return 'accepted';
  if (
    !result.signal &&
    (result.code === 3 ||
      /(?:^|\n).*: rejected(?:\n|$)/.test(result.output || ''))
  )
    return 'rejected';
  return 'unavailable';
}

export async function readCommand(command, args) {
  try {
    const { stdout, stderr } = await exec(command, args, {
      timeout: 20000,
      maxBuffer: 128 * 1024,
    });
    return { ok: true, code: 0, signal: null, output: stdout + stderr };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? null,
      signal: error.signal ?? null,
      output: (error.stdout || '') + (error.stderr || ''),
    };
  }
}
