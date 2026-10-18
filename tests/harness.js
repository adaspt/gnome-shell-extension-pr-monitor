const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export function assertEqual(actual, expected, message = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected: ${e}\n  actual:   ${a}`);
}

export async function run() {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      print(`ok   ${name}`);
    } catch (e) {
      failed++;
      print(`FAIL ${name}: ${e.message}`);
    }
  }
  print(`\n${tests.length - failed}/${tests.length} passed`);
  return failed;
}
