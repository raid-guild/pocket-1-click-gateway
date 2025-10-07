import * as p from "@clack/prompts";
import { isCancel } from "@clack/prompts";
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

type Ok = {
  ok: true;
  name: string;
  version?: string;
  required: boolean;
};

type Fail = {
  ok: false;
  name: string;
  reason: string; // concise, no links here
  required: boolean;
  helpUrl?: string; // rendered once in the outro
  hint?: string; // extra guidance, no links
};

type CheckResult = Ok | Fail;

const MIN_NODE = "18.0.0";

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function getCmdVersion(cmd: string, args = ["--version"]): string | null {
  const tryArgs = [args, ["-v"], ["version"]];
  for (const a of tryArgs) {
    try {
      const out = execFileSync(cmd, a, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      // tolerant: 1–4 segments like 24.0.6 or 2.46.2.windows.1 → 2.46.2
      const m = out.match(/\d+(?:\.\d+){0,3}/);
      return m?.[0] ?? out;
    } catch {
      // try next flag
    }
  }
  return null;
}

function checkNode(required = true): CheckResult {
  const current = process.versions.node;
  if (compareSemver(current, MIN_NODE) < 0) {
    return {
      ok: false,
      name: "Node.js",
      required,
      reason: `Detected ${current}, requires >= ${MIN_NODE}`,
      hint: "Install/update Node 18+ (LTS recommended).",
      helpUrl: "https://nodejs.org/",
    };
  }
  return { ok: true, name: "Node.js", version: current, required };
}

function checkGit(required = true): CheckResult {
  const v = getCmdVersion("git");
  return v
    ? { ok: true, name: "Git", version: v, required }
    : {
        ok: false,
        name: "Git",
        required,
        reason: "Not found",
        hint: "Install Git and re-run 1-Click Gateway in your terminal.",
        helpUrl: "https://git-scm.com/downloads",
      };
}

function checkDocker(required = true): CheckResult {
  const v = getCmdVersion("docker", ["--version"]);
  if (!v) {
    return {
      ok: false,
      name: "Docker",
      required,
      reason: "CLI not found",
      hint: "Install Docker Desktop (or dockerd/colima) and ensure it’s running.",
      helpUrl: "https://docs.docker.com/get-docker/",
    };
  }

  // Is the daemon reachable?
  const res = spawnSync("docker", ["info"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (res.status !== 0) {
    const platformHint =
      process.platform === "win32"
        ? "Open Docker Desktop and wait until it shows ‘Running’."
        : "Start Docker (Docker Desktop, dockerd, or colima) and ensure the daemon is running.";

    return {
      ok: false,
      name: "Docker",
      required,
      reason: "Docker CLI found but the daemon isn’t reachable",
      hint: platformHint,
      helpUrl: "https://docs.docker.com/desktop/",
    };
  }

  return { ok: true, name: "Docker", version: v, required };
}

function checkPocketd(required = true): CheckResult {
  const v =
    getCmdVersion("pocketd", ["--version"]) ??
    getCmdVersion("pocketd", ["version"]);

  return v
    ? { ok: true, name: "pocketd", version: v, required }
    : {
        ok: false,
        name: "pocketd",
        required,
        reason: "Not found in PATH",
        hint: "Install the Pocketd CLI, then re-run 1-Click Gateway in your terminal.",
        helpUrl:
          "https://dev.poktroll.com/explore/account_management/pocketd_cli",
      };
}

export async function runPreflightOrExit(): Promise<void> {
  const s = p.spinner();
  p.note(
    "We’ll quickly verify your environment: Node.js, Git, Docker, and pocketd.",
    "Preflight checks"
  );

  s.start("Checking Node.js");
  const node = checkNode(true);
  s.stop(node.ok ? `Node.js ✓ (${node.version})` : "Node.js ✗");

  s.start("Checking Git");
  const git = checkGit(true);
  s.stop(git.ok ? `Git ✓ (${git.version})` : "Git ✗");

  s.start("Checking Docker");
  const docker = checkDocker(false);
  s.stop(docker.ok ? `Docker ✓ (${docker.version})` : "Docker ✗");

  s.start("Checking pocketd");
  const pd = checkPocketd(true);
  s.stop(pd.ok ? `pocketd ✓ (${pd.version})` : "pocketd ✗");

  const results = [node, git, docker, pd];
  const failures = results.filter((r) => !r.ok) as Fail[];
  if (failures.length === 0) {
    p.log.message("All requirements satisfied. Onward!");
    return;
  }

  // Collate a single, clean outro with optional links rendered ONCE.
  const lines: string[] = ["Some required tools are missing or not ready:", ""];
  for (const f of failures) {
    lines.push(`• ${f.name}: ${f.reason}`);
    if (f.hint) lines.push(`  - ${f.hint}`);
    if (f.helpUrl) lines.push(`  - ${f.helpUrl}`);
    lines.push(""); // blank line between items
  }

  p.outro(lines.join("\n"));

  const anyRequired = failures.some((f) => f.required);
  if (anyRequired) {
    p.cancel("Please resolve the above and re-run the installer.");
    process.exit(1);
  }

  const cont = await p.confirm({
    message: "Only recommended checks failed. Continue anyway?",
    initialValue: false,
  });

  if (isCancel(cont) || !cont) {
    p.cancel("Aborted.");
    process.exit(1);
  }
}
