import * as p from "@clack/prompts";
import { isCancel } from "@clack/prompts";
import pc from "picocolors";
import { runPreflightOrExit } from "./preflight";

// If someone runs via non-interactive shell (CI), degrade gracefully
const isTTY = process.stdout.isTTY && process.stdin.isTTY;

async function pressEnterToContinue(message = "Press Enter to continue") {
  const res = await p.text({
    message: pc.dim(message),
    placeholder: "",
    initialValue: "",
  });
  if (isCancel(res)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }
}

async function main() {
  if (isTTY) {
    p.intro(
      pc.cyan(
        pc.bold(
          "🛠️  Welcome to the Pocket Gateway Installer (Shannon Protocol)"
        )
      )
    );
    p.log.message(
      "This CLI will guide you through creating your Gateway and Application wallets,\n" +
        "staking them, and deploying both the PATH backend and the Portal frontend."
    );

    // 🔽 Pause here until the user presses Enter
    await pressEnterToContinue();

    await runPreflightOrExit();

    p.outro(pc.dim("That’s all for now — exiting."));
  } else {
    // Non-TTY fallback (e.g., piping or CI)
    console.log(
      "🛠️  Welcome to the Pocket Gateway Installer (Shannon Protocol)\n\n" +
        "This CLI will guide you through creating your Gateway and Application wallets,\n" +
        "staking them, and deploying both the PATH backend and the Portal frontend.\n"
    );
  }

  process.exit(0);
}

main().catch((err) => {
  p.cancel("Unexpected error.");
  // Show a terse error; avoid noisy stack for end users
  console.error(pc.red(String(err?.message || err)));
  process.exit(1);
});
