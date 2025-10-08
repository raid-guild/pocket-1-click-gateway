import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Network, WalletSetupResult } from "./types";

/** Basic POKT address shape check */
function isPoktAddress(val: string) {
  const v = val.trim();
  return /^pokt1[0-9a-z]{20,90}$/.test(v);
}

async function writeSecureJson(relPath: string, data: unknown) {
  const filePath = path.resolve(process.cwd(), relPath);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true, mode: 0o700 }).catch(() => {});
  try {
    await fs.chmod(dir, 0o700);
  } catch {}

  const tmpFile = filePath + ".tmp";
  const json = JSON.stringify(data, null, 2);

  await fs.writeFile(tmpFile, json, { mode: 0o600 });
  await fs.rename(tmpFile, filePath);

  return filePath;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const mod = await import("clipboardy").catch(() => null as any);
    if (!mod || !mod.default) return false;
    await mod.default.write(text);
    return true;
  } catch {
    return false;
  }
}

/** Detect if the user's SHELL looks like fish. */
function looksLikeFishShell(): boolean {
  const sh = process.env.SHELL || "";
  return /fish/i.test(sh);
}

/** Build snippets for creating /tmp staking config files. */
function buildConfigFileSnippets(kind: "heredoc" | "printf") {
  if (kind === "printf") {
    return {
      gw: `printf 'stake_amount: 5000000000upokt\\n' > /tmp/stake_gateway_config.yaml`,
      app: `printf 'stake_amount: 1000000000upokt\\nservice_ids:\\n  - "anvil"\\n' > /tmp/stake_app_config.yaml`,
    };
  }
  // default heredoc
  return {
    gw: `cat <<EOF > /tmp/stake_gateway_config.yaml
stake_amount: 5000000000upokt
EOF`,
    app: `cat <<EOF > /tmp/stake_app_config.yaml
stake_amount: 1000000000upokt
service_ids:
  - "anvil"
EOF`,
  };
}

/** Join command lines with a backslash newline, stripping trailing spaces on each line. */
function formatMultiline(lines: string[]): string {
  return lines.map((l) => l.replace(/\s+$/g, "")).join(" \\\n");
}

export async function runWalletSetup(
  network: Network
): Promise<WalletSetupResult | null> {
  p.intro(pc.cyan("Wallet Setup · Create Gateway & Application wallets"));
  p.note(
    `Using previously selected network: ${pc.bold(
      network
    )}\n(You can change this by re-running the metadata step.)`,
    "Network"
  );

  // Gateway wallet
  p.log.step(
    [
      "🔑 Let's create your Gateway wallet.",
      "",
      "Run this in another terminal:",
      pc.magenta("pocketd keys add gateway"),
      "",
      "You will paste the resulting address below (looks like pokt1...):",
    ].join("\n")
  );

  const gatewayName = (await p.text({
    message: "Gateway account name (for your reference only):",
    initialValue: "my-gateway",
    validate: (v) =>
      !v?.trim()
        ? "Please enter an account name (e.g., my-gateway)"
        : undefined,
  })) as string | symbol;
  if (p.isCancel(gatewayName)) {
    p.cancel("Wallet setup cancelled.");
    return null;
  }

  const gatewayAddress = (await p.text({
    message: "Gateway address (pokt1…):",
    placeholder: "pokt1abc…",
    validate: (v) => {
      if (!v?.trim()) return "Please paste the address from pocketd.";
      if (!isPoktAddress(v))
        return "That doesn't look like a valid pokt1… address.";
      return undefined;
    },
  })) as string | symbol;
  if (p.isCancel(gatewayAddress)) {
    p.cancel("Wallet setup cancelled.");
    return null;
  }

  // Application wallet
  p.log.step(
    [
      "🔑 Now create your Application wallet.",
      "",
      "Run:",
      pc.magenta("pocketd keys add application"),
      "",
      "You will paste the resulting address below:",
    ].join("\n")
  );

  const applicationName = (await p.text({
    message: "Application account name:",
    initialValue: "my-app",
    validate: (v) =>
      !v?.trim() ? "Please enter an account name (e.g., my-app)" : undefined,
  })) as string | symbol;
  if (p.isCancel(applicationName)) {
    p.cancel("Wallet setup cancelled.");
    return null;
  }

  const applicationAddress = (await p.text({
    message: "Application address (pokt1…):",
    placeholder: "pokt1def…",
    validate: (v) => {
      if (!v?.trim()) return "Please paste the address from pocketd.";
      if (!isPoktAddress(v))
        return "That doesn't look like a valid pokt1… address.";
      if (v.trim() === (gatewayAddress as string).trim())
        return "Application and Gateway addresses must be different.";
      return undefined;
    },
  })) as string | symbol;
  if (p.isCancel(applicationAddress)) {
    p.cancel("Wallet setup cancelled.");
    return null;
  }

  // Optional: offer to copy both addresses to clipboard
  const copyConfirm = await p.confirm({
    message: "Copy both addresses to clipboard for safekeeping?",
    initialValue: false,
  });
  if (!p.isCancel(copyConfirm) && copyConfirm) {
    const text = `Gateway (${gatewayName}): ${gatewayAddress}\nApplication (${applicationName}): ${applicationAddress}`;
    const copied = await copyToClipboard(text);
    if (copied) p.note("Addresses copied to clipboard.", "Copied");
    else
      p.note(
        [
          "Could not access clipboard automatically.",
          "You can copy this instead:",
          "",
          text,
        ].join("\n"),
        "Copy manually"
      );
  }

  // === Funding step ===
  const faucetUrl = "https://faucet.beta.testnet.pokt.network/";
  if (network === "testnet") {
    p.log.step(
      [
        "🚰 Fund your testnet accounts via the faucet before staking.",
        "",
        pc.bold("Faucet:"),
        faucetUrl,
        "",
        pc.bold("Addresses to fund:"),
        `• Gateway:     ${gatewayAddress}`,
        `• Application: ${applicationAddress}`,
        "",
        pc.dim(
          "Tip: request enough to cover staking amounts and transaction fees."
        ),
      ].join("\n")
    );

    const funded = await p.confirm({
      message: "Have you funded BOTH addresses via the faucet?",
      initialValue: true,
    });
    if (p.isCancel(funded) || !funded) {
      p.cancel("Please fund your testnet accounts, then re-run this step.");
      return null;
    }
  } else {
    p.log.step(
      [
        "💰 Mainnet requires real POKT.",
        "",
        "Make sure BOTH accounts are funded with sufficient POKT to cover your planned",
        "stake amounts plus transaction fees before proceeding.",
        "",
        pc.bold("Addresses:"),
        `• Gateway:     ${gatewayAddress}`,
        `• Application: ${applicationAddress}`,
      ].join("\n")
    );

    const funded = await p.confirm({
      message: "Are BOTH mainnet addresses funded with sufficient POKT?",
      initialValue: true,
    });
    if (p.isCancel(funded) || !funded) {
      p.cancel("Please fund your mainnet accounts, then re-run this step.");
      return null;
    }
  }

  // === Balance check step ===
  const netFlag = network === "testnet" ? "beta" : "main";
  const cmdGateway = `pocketd query bank balances ${gatewayAddress} --network=${netFlag}`;
  const cmdApplication = `pocketd query bank balances ${applicationAddress} --network=${netFlag}`;

  p.log.step(
    [
      "🧮 Verify funding by querying on-chain balances for both wallets.",
      "",
      pc.bold("Run these in another terminal:"),
      pc.magenta(cmdGateway),
      pc.magenta(cmdApplication),
      "",
      pc.dim("Proceed once both balances show a non-zero amount."),
    ].join("\n")
  );

  const copyBalCmds = await p.confirm({
    message: "Copy both balance commands to clipboard?",
    initialValue: false,
  });
  if (!p.isCancel(copyBalCmds) && copyBalCmds) {
    const copied = await copyToClipboard(`${cmdGateway}\n${cmdApplication}`);
    if (copied) p.note("Balance commands copied to clipboard.", "Copied");
    else
      p.note(
        `Copy manually:\n${cmdGateway}\n${cmdApplication}`,
        "Copy manually"
      );
  }

  const sawNonZero = await p.confirm({
    message: "Did BOTH balances show > 0?",
    initialValue: true,
  });
  if (p.isCancel(sawNonZero) || !sawNonZero) {
    p.cancel(
      "Fund the accounts until both balances are > 0, then re-run this step."
    );
    return null;
  }

  // === Create staking config files ===
  const isFish = looksLikeFishShell();
  const defaultSnippetKind: "heredoc" | "printf" = isFish
    ? "printf"
    : "heredoc";
  const choice = (await p.select({
    message: isFish
      ? "Detected fish shell. Use fish-safe commands to create config files?"
      : "Choose how to create the staking config files:",
    initialValue: defaultSnippetKind,
    options: [
      { label: "Heredoc (bash/zsh/sh)", value: "heredoc" },
      { label: "printf (compatible with fish/bash/zsh/sh)", value: "printf" },
    ],
  })) as "heredoc" | "printf" | symbol;

  if (p.isCancel(choice)) {
    p.cancel("Wallet setup cancelled.");
    return null;
  }

  const { gw: cfgGw, app: cfgApp } = buildConfigFileSnippets(
    choice as "heredoc" | "printf"
  );

  p.log.step(
    [
      "🛠 Create the Gateway staking config file:",
      "",
      pc.magenta(cfgGw),
      "",
      "Then create the Application staking config file:",
      "",
      pc.magenta(cfgApp),
      "",
      pc.dim(
        "These write /tmp/stake_gateway_config.yaml and /tmp/stake_app_config.yaml."
      ),
    ].join("\n")
  );

  const copyCfg = await p.confirm({
    message: "Copy BOTH config-file commands to clipboard?",
    initialValue: true,
  });
  if (!p.isCancel(copyCfg) && copyCfg) {
    const copied = await copyToClipboard(`${cfgGw}\n\n${cfgApp}`);
    if (copied) p.note("Config-file commands copied to clipboard.", "Copied");
    else p.note(`Copy manually:\n${cfgGw}\n\n${cfgApp}`, "Copy manually");
  }

  const madeFiles = await p.confirm({
    message: "Did you create BOTH config files in /tmp?",
    initialValue: true,
  });
  if (p.isCancel(madeFiles) || !madeFiles) {
    p.cancel("Create the config files first, then re-run this step.");
    return null;
  }

  const stakeGatewayCmd = formatMultiline([
    "pocketd tx gateway stake-gateway",
    "--config=/tmp/stake_gateway_config.yaml",
    `--from=${gatewayAddress}`,
    `--network=${netFlag}`,
    "--gas=auto",
    "--gas-prices=10upokt",
    "--gas-adjustment=1.5",
    "--yes",
  ]);

  const stakeAppCmd = formatMultiline([
    "pocketd tx application stake-application",
    "--config=/tmp/stake_app_config.yaml",
    `--from=${applicationAddress}`,
    `--network=${netFlag}`,
    "--gas=auto",
    "--gas-prices=10upokt",
    "--gas-adjustment=1.5",
    "--yes",
  ]);

  p.log.step(
    ["💸 Stake the Gateway first:", "", pc.magenta(stakeGatewayCmd)].join("\n")
  );

  const copyStakeGw = await p.confirm({
    message: "Copy Gateway staking command to clipboard?",
    initialValue: true,
  });
  if (!p.isCancel(copyStakeGw) && copyStakeGw) {
    const copied = await copyToClipboard(stakeGatewayCmd);
    if (copied) p.note("Gateway staking command copied.", "Copied");
    else p.note(`Copy manually:\n${stakeGatewayCmd}`, "Copy manually");
  }

  const gwStaked = await p.confirm({
    message: "Did the Gateway stake transaction succeed?",
    initialValue: true,
  });
  if (p.isCancel(gwStaked) || !gwStaked) {
    p.cancel("Complete the Gateway staking, then re-run this step.");
    return null;
  }

  p.log.step(
    ["Now stake the Application:", "", pc.magenta(stakeAppCmd)].join("\n")
  );

  const copyStakeApp = await p.confirm({
    message: "Copy Application staking command to clipboard?",
    initialValue: true,
  });
  if (!p.isCancel(copyStakeApp) && copyStakeApp) {
    const copied = await copyToClipboard(stakeAppCmd);
    if (copied) p.note("Application staking command copied.", "Copied");
    else p.note(`Copy manually:\n${stakeAppCmd}`, "Copy manually");
  }

  const appStaked = await p.confirm({
    message: "Did the Application stake transaction succeed?",
    initialValue: true,
  });
  if (p.isCancel(appStaked) || !appStaked) {
    p.cancel("Complete the Application staking, then re-run this step.");
    return null;
  }

  // === Delegate application to gateway ===
  const delegateCmd = formatMultiline([
    `pocketd tx application delegate-to-gateway ${gatewayAddress}`,
    `--from=${applicationAddress}`,
    `--network=${netFlag}`,
    "--gas=auto",
    "--gas-prices=10upokt",
    "--gas-adjustment=1.5",
    "--yes",
  ]);

  p.log.step(
    [
      "🔗 Delegate the Application to your Gateway:",
      "",
      pc.magenta(delegateCmd),
    ].join("\n")
  );

  const copyDelegate = await p.confirm({
    message: "Copy delegation command to clipboard?",
    initialValue: true,
  });
  if (!p.isCancel(copyDelegate) && copyDelegate) {
    const copied = await copyToClipboard(delegateCmd);
    if (copied) p.note("Delegation command copied.", "Copied");
    else p.note(`Copy manually:\n${delegateCmd}`, "Copy manually");
  }

  const proceed = await p.confirm({
    message: "Did the delegation transaction succeed?",
    initialValue: true,
  });
  if (p.isCancel(proceed) || !proceed) {
    p.cancel("Complete delegation, then re-run this step.");
    return null;
  }

  // Export minimal, secure temp JSON (no private keys)
  const payload: WalletSetupResult = {
    network,
    gateway: {
      name: gatewayName as string,
      address: (gatewayAddress as string).trim(),
    },
    application: {
      name: applicationName as string,
      address: (applicationAddress as string).trim(),
    },
    exportPath: ".tmp/keys.json",
    funded: true,
    fundedAtIso: new Date().toISOString(),
  };

  const s = p.spinner();
  s.start("Exporting to .tmp/keys.json (secure temp)...");
  const written = await writeSecureJson(payload.exportPath, {
    network: payload.network,
    gateway: payload.gateway,
    application: payload.application,
    funded: payload.funded,
    fundedAtIso: payload.fundedAtIso,
    ...(network === "testnet" ? { faucetUrl } : {}),
    createdAtIso: new Date().toISOString(),
    hostname: os.hostname(),
  });
  s.stop("Exported.");

  p.note(
    [
      pc.bold("Path: ") + written,
      "",
      "This file contains ONLY addresses and labels (no private keys).",
      "Ensure `.tmp/` is in your .gitignore. Permissions are restricted to the current user.",
    ].join("\n"),
    "Export to .tmp/keys.json"
  );

  p.outro(pc.green("Wallet setup complete."));
  return payload;
}
