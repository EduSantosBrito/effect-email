import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(fixtureRoot, "../..");
const wrangler = resolve(packageRoot, "node_modules/.bin/wrangler");
const temporaryRoot = await mkdtemp(join(tmpdir(), "effect-email-cloudflare-"));
const workers = ["root", "resend", "test"];
const nodeBuiltins = new Set(
  builtinModules.map((module) => (module.startsWith("node:") ? module.slice(5) : module)),
);
const nodeBuiltinPattern = [...nodeBuiltins]
  .sort((left, right) => right.length - left.length)
  .map((module) => module.replaceAll("/", "\\/"))
  .join("|");
const forbiddenPackageInput = /(?:^|[/\\])nodemailer(?:[/\\]|$)|(?:^|[/\\])smtp(?:\.js)?$/i;
const forbiddenOutput = [
  ["Nodemailer", /nodemailer/i],
  [
    "a Node built-in import",
    new RegExp(`(?:from\\s*|import\\s*|require\\()["'](?:node:)?(?:${nodeBuiltinPattern})["']`),
  ],
  ["Buffer-dependent code", /\bBuffer\b/],
];

const resolvesNodeOnlyInput = (input) => {
  if (forbiddenPackageInput.test(input)) return true;
  const specifier = input.startsWith("node:") ? input.slice(5) : input;
  return nodeBuiltins.has(specifier);
};

const runWrangler = (worker, outdir, metafile) => {
  const result = spawnSync(
    wrangler,
    [
      "deploy",
      join(fixtureRoot, "workers", `${worker}.ts`),
      "--config",
      join(fixtureRoot, "wrangler.jsonc"),
      "--dry-run",
      "--outdir",
      outdir,
      "--metafile",
      metafile,
    ],
    {
      cwd: packageRoot,
      env: { ...process.env, NO_COLOR: "1" },
      encoding: "utf8",
    },
  );

  assert.equal(
    result.status,
    0,
    `${worker} Wrangler dry-run failed:\n${result.stdout ?? ""}${result.stderr ?? ""}${result.error === undefined ? "" : result.error.message}`,
  );
};

try {
  for (const worker of workers) {
    const outdir = join(temporaryRoot, worker);
    const metafile = join(temporaryRoot, `${worker}.json`);
    runWrangler(worker, outdir, metafile);

    const metadata = JSON.parse(await readFile(metafile, "utf8"));
    const inputs = Object.keys(metadata.inputs ?? {});
    const packageEntrypoint = worker === "root" ? "index" : worker;
    assert.ok(
      inputs.some((input) => input === `dist/${packageEntrypoint}.js`),
      `${worker} must consume effect-email through its publish-shaped dist boundary`,
    );
    assert.equal(
      inputs.some(resolvesNodeOnlyInput),
      false,
      `${worker} resolved a Node-only SMTP or Nodemailer input`,
    );

    for (const outputFile of await readdir(outdir)) {
      const output = await readFile(join(outdir, outputFile), "utf8");
      for (const [description, pattern] of forbiddenOutput) {
        assert.equal(
          pattern.test(output),
          false,
          `${worker} bundle contains ${description}: ${outputFile}`,
        );
      }
    }
  }

  const smtpResult = spawnSync(
    "node",
    [
      "--input-type=module",
      "--eval",
      'const smtp = await import("effect-email/smtp"); if (typeof smtp.SmtpClient !== "function") process.exit(1);',
    ],
    { cwd: packageRoot, encoding: "utf8" },
  );
  assert.equal(
    smtpResult.status,
    0,
    `SMTP must remain importable in Node:\n${smtpResult.stdout}${smtpResult.stderr}`,
  );
  assert.deepEqual(workers, ["root", "resend", "test"], "SMTP must stay outside Workers fixtures");

  console.log("Cloudflare dry-runs passed for root, Resend, and Test; SMTP remains Node-only.");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
