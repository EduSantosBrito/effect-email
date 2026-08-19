import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const effectVersion = "4.0.0-rc.110";
const typescriptVersion = "6.0.3";
const registry = "https://registry.npmjs.org/";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: "inherit",
  });

  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed${result.error === undefined ? "" : `: ${result.error.message}`}`,
  );
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const temporaryRoot = await mkdtemp(join(tmpdir(), "effect-email-package-smoke-"));

try {
  assert.equal(
    temporaryRoot.startsWith(`${packageRoot}/`),
    false,
    "the package consumer must be outside the workspace",
  );

  run("npm", ["pack", "--pack-destination", temporaryRoot], packageRoot);

  const tarballs = (await readdir(temporaryRoot)).filter((file) => file.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, "npm pack must create exactly one publishable tarball");

  const tarball = join(temporaryRoot, tarballs[0]);
  assert.ok((await stat(tarball)).size > 0, "the publishable tarball must not be empty");

  const consumerRoot = join(temporaryRoot, "consumer");
  await cp(fixtureRoot, consumerRoot, { recursive: true });
  await writeFile(
    join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "effect-email-package-consumer",
        private: true,
        type: "module",
        packageManager: "bun@1.3.13",
        dependencies: {
          effect: effectVersion,
          "effect-email": `file:${tarball}`,
        },
        devDependencies: {
          typescript: typescriptVersion,
        },
      },
      null,
      2,
    )}\n`,
  );

  run(
    "bun",
    [
      "install",
      "--registry",
      registry,
      "--backend",
      "copyfile",
      "--linker",
      "hoisted",
      "--cache-dir",
      join(temporaryRoot, "cache"),
    ],
    consumerRoot,
  );

  const lockfile = await readFile(join(consumerRoot, "bun.lock"), "utf8");
  assert.equal(
    lockfile.includes("workspace:"),
    false,
    "consumer lockfile must not use workspace links",
  );
  assert.match(lockfile, /effect@4\.0\.0-rc\.110/);

  const installedPackageRoot = join(consumerRoot, "node_modules", "effect-email");
  assert.equal(existsSync(installedPackageRoot), true, "the packed package must be installed");
  assert.equal(
    realpathSync(installedPackageRoot).startsWith(`${packageRoot}/`),
    false,
    "the installed package must not resolve to the workspace checkout",
  );

  const manifest = await readJson(join(installedPackageRoot, "package.json"));
  assert.deepEqual(manifest.peerDependencies, { effect: effectVersion });
  assert.equal(manifest.dependencies.effect, undefined, "Effect must not be a private dependency");

  const expectedEntrypoints = {
    ".": "index",
    "./resend": "resend",
    "./smtp": "smtp",
    "./test": "test",
  };
  assert.deepEqual(Object.keys(manifest.exports).sort(), Object.keys(expectedEntrypoints).sort());

  for (const [subpath, stem] of Object.entries(expectedEntrypoints)) {
    assert.deepEqual(manifest.exports[subpath], {
      types: `./dist/${stem}.d.ts`,
      import: `./dist/${stem}.js`,
    });
    for (const target of Object.values(manifest.exports[subpath])) {
      assert.equal(
        existsSync(join(installedPackageRoot, target)),
        true,
        `${subpath} must publish ${target}`,
      );
    }
  }

  assert.equal(existsSync(join(installedPackageRoot, "src")), false, "source files must not leak");
  for (const file of ["CHANGELOG.md", "LICENSE", "README.md"]) {
    assert.equal(existsSync(join(installedPackageRoot, file)), true, `${file} must be published`);
  }

  const tsc = join(consumerRoot, "node_modules", ".bin", "tsc");
  const typecheckArgs = [
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "false",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ESNext",
    "--lib",
    "ESNext,DOM,DOM.Iterable",
  ];
  run(tsc, [...typecheckArgs, "consumer.ts"], consumerRoot);
  run(tsc, [...typecheckArgs, "smtp-consumer.ts"], consumerRoot);

  run("node", ["consumer.mjs"], consumerRoot);
  run("node", ["smtp-consumer.mjs"], consumerRoot);

  console.log(`Package smoke passed with ${tarballs[0]} and one Effect ${effectVersion} identity.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
