import assert from 'node:assert/strict';

export function forbidNativeDialogs(page, t) {
  const unexpected = [];
  const attached = new WeakSet();
  const attach = (target) => {
    if (attached.has(target)) return;
    attached.add(target);
    target.on('dialog', async (dialog) => {
      unexpected.push(dialog.type());
      await dialog.dismiss().catch(() => {});
    });
  };
  const context = page.context();
  context.pages().forEach(attach);
  context.on('page', attach);
  t.after(() => {
    context.off('page', attach);
    assert.deepEqual(
      unexpected,
      [],
      'Locade must not invoke browser alert/confirm/prompt',
    );
  });
}

export async function decideConfirmation(page, label = '取消') {
  const confirmation = page.getByRole('alertdialog');
  await confirmation.waitFor();
  await confirmation.getByRole('button', { name: label, exact: true }).click();
  await confirmation.waitFor({ state: 'detached' });
}
