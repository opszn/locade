import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, urlKey } from '../server/store.js';
import { directoryKey } from '../server/identity.js';

const directory = (name) => ({
  directory: `/fixture/${name}`,
  key: directoryKey(`/fixture/${name}`),
  source: 'auto',
  available: true,
});
const identity = directory('project');
const canonical = 'http://127.0.0.1:3000/';
const found = (overrides = {}) => ({
  url: canonical,
  title: 'A controlled local project',
  identity,
  observation: '101:unchanged-start-time',
  ...overrides,
});

// Only exercise in-memory matching: no filesystem, project HTTP, process scan or browser.
function setup() {
  const store = new Store('/fixture/not-written');
  const scan = (results) => {
    for (const project of store.state.projects) {
      project.online = false;
      for (const endpoint of project.endpoints) endpoint.online = false;
    }
    return results.map((result) => store.upsert(result, false, results));
  };
  return { store, scan };
}

function remember(project) {
  Object.assign(project, {
    name: 'My original project',
    renamed: true,
    favorite: true,
    screenshot: '2026-10-21T00:00:00.000Z',
    lastOpened: '2026-10-21T01:00:00.000Z',
  });
  return {
    id: project.id,
    name: project.name,
    favorite: project.favorite,
    screenshot: project.screenshot,
    lastOpened: project.lastOpened,
  };
}

function assertRemembered(project, expected) {
  for (const [field, value] of Object.entries(expected))
    assert.equal(project[field], value, `${field} stays with the same project`);
}

test('same canonical address and unchanged observation enrich a missing directory without duplicating the project', () => {
  const { store, scan } = setup();
  const original = scan([
    found({ url: 'http://localhost:3000/', identity: null }),
  ])[0];
  const remembered = remember(original);
  const recovered = scan([found()])[0];
  assert.equal(store.state.projects.length, 1);
  assert.equal(recovered.id, original.id);
  assertRemembered(recovered, remembered);
  assert.equal(recovered.identity.key, identity.key);
  assert.equal(recovered.identity.source, 'auto');
  assert.equal(urlKey(recovered.url), canonical);
  assert.equal(recovered.addressReused, false);
});

test('repeated metadata loss and recovery has bounded records and never loses the known project', () => {
  const { store, scan } = setup();
  const original = scan([found()])[0];
  const remembered = remember(original);
  const counts = [store.state.projects.length];
  for (let cycle = 0; cycle < 6; cycle++) {
    const weak = scan([
      found({
        url: cycle % 2 ? canonical : 'http://localhost:3000/',
        identity: null,
        observation: null,
      }),
    ])[0];
    if (weak.id !== original.id) {
      assert.equal(weak.favorite, false);
      assert.equal(weak.screenshot, null);
    }
    counts.push(store.state.projects.length);
    const recovered = scan([found()])[0];
    assert.equal(recovered.id, original.id);
    assertRemembered(recovered, remembered);
    counts.push(store.state.projects.length);
  }
  assert.ok(
    Math.max(...counts) <= 2,
    `metadata uncertainty must not produce a fresh persistent project each cycle: ${counts.join(' -> ')}`,
  );
});

test('a changed observation without directory evidence cannot inherit the original cover or favorites', () => {
  const { store, scan } = setup();
  const original = scan([found()])[0];
  const remembered = remember(original);
  const replacement = scan([
    found({ identity: null, observation: '202:different-start-time' }),
  ])[0];
  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.favorite, false);
  assert.equal(replacement.screenshot, null);
  assertRemembered(original, remembered);
  assert.equal(original.online, false);
  assert.equal(original.addressReused, true);
});

test('matching process observation never merges explicitly different automatic directories', () => {
  const { store, scan } = setup();
  const original = scan([found()])[0];
  const remembered = remember(original);
  const otherIdentity = directory('other-project');
  const replacement = scan([found({ identity: otherIdentity })])[0];
  assert.notEqual(replacement.id, original.id);
  assert.equal(store.state.projects.length, 2);
  assert.equal(replacement.identity.key, otherIdentity.key);
  assert.equal(replacement.favorite, false);
  assert.equal(replacement.screenshot, null);
  assertRemembered(original, remembered);
  assert.equal(original.addressReused, true);
});

test('a legacy record without observation is not upgraded by matching URL and title alone', () => {
  const { store, scan } = setup();
  const legacy = scan([found({ identity: null, observation: null })])[0];
  const remembered = remember(legacy);
  legacy.seenSession = 'previous-session-with-no-process-evidence';
  const current = scan([found()])[0];
  assert.notEqual(current.id, legacy.id);
  assert.equal(store.state.projects.length, 2);
  assert.equal(current.favorite, false);
  assert.equal(current.screenshot, null);
  assertRemembered(legacy, remembered);
});
