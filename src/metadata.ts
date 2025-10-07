import * as p from "@clack/prompts";
import { isCancel } from "@clack/prompts";

export type Network = "mainnet" | "testnet";
export type DeploymentType = "vps" | "local";
export type FrontendHosting = "same-vps" | "vercel" | "skip";
export type Integration = "stripe" | "auth";

export interface ProjectMetadata {
  projectName: string;
  network: Network;
  deploymentType: DeploymentType;
  frontendHosting: FrontendHosting;
  domain?: string | null;
  integrations: Integration[];
  createdAtIso: string;
}

// ---------- helpers ----------
const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

function normalizeDomain(input: string | null | undefined) {
  if (!input) return null;
  let t = input.trim().toLowerCase();
  // strip scheme, trailing slashes
  t = t.replace(/^\s*https?:\/\//, "").replace(/\/+$/, "");
  return t || null;
}

function domainLooksValid(val: string) {
  // Accepts FQDNs and localhost[:port]
  const re = /^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/i;
  const localhostRe = /^(localhost|localhost:\d{2,5})$/i;
  return re.test(val) || localhostRe.test(val);
}

function formatSummary(meta: ProjectMetadata) {
  return [
    `Project name:        ${meta.projectName}`,
    `Network:             ${meta.network}`,
    `Deployment type:     ${
      meta.deploymentType === "vps" ? "Hosted VPS" : "Local only"
    }`,
    `Frontend hosting:    ${
      meta.frontendHosting === "same-vps"
        ? "Same VPS"
        : meta.frontendHosting === "vercel"
        ? "Vercel"
        : "Skip"
    }`,
    `Domain:              ${meta.domain || "—"}`,
    `Integrations:        ${
      meta.integrations.length ? meta.integrations.join(", ") : "—"
    }`,
  ].join("\n");
}

function normalizeFrontendHosting(meta: ProjectMetadata) {
  // If they switched to local-only, "same-vps" no longer makes sense
  if (meta.deploymentType === "local" && meta.frontendHosting === "same-vps") {
    meta.frontendHosting = "vercel";
  }
}

// ---------- main prompts ----------
async function askAll(): Promise<ProjectMetadata | null> {
  const result = await p.group(
    {
      projectName: () =>
        p.text({
          message: "Project name",
          placeholder: "my-pokt-gateway",
          validate(v) {
            if (!v?.trim()) return "Please enter a project name.";
            if (v.length > 64) return "Keep it under 64 characters.";
          },
        }),

      network: () =>
        p.select({
          message: "Network",
          options: [
            { value: "mainnet", label: "mainnet" },
            { value: "testnet", label: "testnet" },
          ],
          initialValue: "testnet",
        }),

      deploymentType: () =>
        p.select({
          message: "Deployment type",
          options: [
            { value: "vps", label: "Hosted VPS (DigitalOcean)" },
            { value: "local", label: "Local only (dev/test)" },
          ],
          initialValue: "vps",
        }),

      frontendHosting: ({ results }) =>
        p.select({
          message: "Frontend hosting",
          options:
            results.deploymentType === "local"
              ? [
                  { value: "vercel", label: "Deploy separately to Vercel" },
                  { value: "skip", label: "Skip for now" },
                ]
              : [
                  { value: "same-vps", label: "Deploy to same VPS" },
                  { value: "vercel", label: "Deploy separately to Vercel" },
                  { value: "skip", label: "Skip for now" },
                ],
          initialValue:
            results.deploymentType === "local" ? "vercel" : "same-vps",
        }),

      domain: () =>
        p.text({
          message: "Domain name (optional, for HTTPS setup)",
          placeholder: "api.example.com (or leave blank)",
          validate(v) {
            const t = normalizeDomain(v);
            if (!t) return; // optional, blank OK
            if (!domainLooksValid(t)) {
              return "Please enter a valid domain (e.g., api.example.com) or leave blank.";
            }
          },
        }),

      integrations: () =>
        p.multiselect({
          message:
            "Optional integrations (Use ↑/↓ to move, Space to toggle, Enter to confirm)",
          options: [
            { value: "stripe", label: "Stripe billing" },
            { value: "auth", label: "Auth modules" },
          ],
          required: false,
        }),
    },
    { onCancel: () => p.cancel("Setup cancelled.") }
  );

  if (isCancel(result)) return null;

  const meta: ProjectMetadata = {
    projectName: String(result.projectName).trim(),
    network: result.network as Network,
    deploymentType: result.deploymentType as DeploymentType,
    frontendHosting: result.frontendHosting as FrontendHosting,
    domain: normalizeDomain(result.domain),
    integrations: (result.integrations as Integration[]) ?? [],
    createdAtIso: new Date().toISOString(),
  };

  normalizeFrontendHosting(meta);
  return meta;
}

async function editLoop(
  meta: ProjectMetadata
): Promise<"confirm" | "start-over" | "cancel"> {
  while (true) {
    p.note(formatSummary(meta), "Review configuration");
    const choice = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "confirm", label: "Confirm & continue" },
        { value: "edit", label: "Edit a field" },
        { value: "start-over", label: "Start over" },
        { value: "cancel", label: "Cancel setup" },
      ],
      initialValue: "confirm",
    });
    if (isCancel(choice)) return "cancel";

    if (choice === "confirm") return "confirm";
    if (choice === "start-over") return "start-over";
    if (choice === "cancel") return "cancel";

    // Edit a single field
    const field = await p.select({
      message: "Pick a field to edit",
      options: [
        { value: "projectName", label: "Project name" },
        { value: "network", label: "Network" },
        { value: "deploymentType", label: "Deployment type" },
        { value: "frontendHosting", label: "Frontend hosting" },
        { value: "domain", label: "Domain" },
        { value: "integrations", label: "Integrations" },
      ],
    });
    if (isCancel(field)) continue;

    if (field === "projectName") {
      const v = await p.text({
        message: "Project name",
        initialValue: meta.projectName,
        validate(v) {
          if (!v?.trim()) return "Please enter a project name.";
          if (v.length > 64) return "Keep it under 64 characters.";
        },
      });
      if (!isCancel(v)) meta.projectName = v.trim();
    } else if (field === "network") {
      const v = await p.select({
        message: "Network",
        options: [
          { value: "mainnet", label: "mainnet" },
          { value: "testnet", label: "testnet" },
        ],
        initialValue: meta.network,
      });
      if (!isCancel(v)) meta.network = v as Network;
    } else if (field === "deploymentType") {
      const v = await p.select({
        message: "Deployment type",
        options: [
          { value: "vps", label: "Hosted VPS (DigitalOcean)" },
          { value: "local", label: "Local only (dev/test)" },
        ],
        initialValue: meta.deploymentType,
      });
      if (!isCancel(v)) {
        meta.deploymentType = v as DeploymentType;
        normalizeFrontendHosting(meta);
      }
    } else if (field === "frontendHosting") {
      const options =
        meta.deploymentType === "local"
          ? [
              { value: "vercel", label: "Deploy separately to Vercel" },
              { value: "skip", label: "Skip for now" },
            ]
          : [
              { value: "same-vps", label: "Deploy to same VPS" },
              { value: "vercel", label: "Deploy separately to Vercel" },
              { value: "skip", label: "Skip for now" },
            ];
      const v = await p.select({
        message: "Frontend hosting",
        options,
        initialValue:
          meta.deploymentType === "local" && meta.frontendHosting === "same-vps"
            ? "vercel"
            : meta.frontendHosting,
      });
      if (!isCancel(v)) meta.frontendHosting = v as FrontendHosting;
    } else if (field === "domain") {
      const v = await p.text({
        message: "Domain (blank to clear)",
        initialValue: meta.domain ?? "",
        validate(val) {
          const t = normalizeDomain(val);
          if (!t) return; // blank is ok
          if (!domainLooksValid(t)) {
            return "Please enter a valid domain or leave blank.";
          }
        },
      });
      if (!isCancel(v)) meta.domain = normalizeDomain(v) ?? null;
    } else if (field === "integrations") {
      const v = await p.multiselect({
        message:
          "Optional integrations (Use ↑/↓ to move, Space to toggle, Enter to confirm)",
        options: [
          { value: "stripe", label: "Stripe billing" },
          { value: "auth", label: "Auth modules" },
        ],
        initialValues: meta.integrations,
        required: false,
      });
      if (!isCancel(v)) meta.integrations = (v as Integration[]) ?? [];
    }
  }
}

// ---------- exported entry ----------
export async function collectProjectMetadata(): Promise<ProjectMetadata | null> {
  p.intro("Let’s grab a few details for your gateway setup.");
  p.note(
    "Use ↑/↓ to move, Enter to confirm. For checkboxes, Space toggles items.",
    "Controls"
  );

  while (true) {
    const meta = await askAll();
    if (!meta) return null;

    const next = await editLoop(meta);
    if (next === "confirm") {
      p.outro("Configuration captured in memory.");
      return meta;
    }
    if (next === "cancel") {
      p.cancel("Setup cancelled.");
      return null;
    }
    // otherwise "start-over" — loop around and re-ask everything
  }
}
