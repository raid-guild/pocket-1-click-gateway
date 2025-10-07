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

function normalizeDomain(input: string | null | undefined) {
  if (!input) return null;
  let t = input.trim().toLowerCase();
  // strip scheme, trailing slashes
  t = t.replace(/^\s*https?:\/\//, "").replace(/\/+$/, "");
  return t || null;
}

function domainLooksValid(val: string) {
  // Accepts FQDNs (labels: start/end with alphanumeric, may contain hyphens)
  const re = /^(?!-)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
  const localhostRe = /^(localhost|localhost:\d{1,5})$/i;
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

// Prompt factories for reuse in askAll and editLoop
const prompts = {
  projectName: (initialValue?: string) =>
    p.text({
      message: "Project name",
      placeholder: "my-pokt-gateway",
      initialValue,
      validate(v) {
        if (!v?.trim()) return "Please enter a project name.";
        if (v.length > 64) return "Keep it under 64 characters.";
      },
    }),

  network: (initialValue?: Network) =>
    p.select({
      message: "Network",
      options: [
        { value: "mainnet", label: "mainnet" },
        { value: "testnet", label: "testnet" },
      ],
      initialValue: initialValue ?? "testnet",
    }),

  deploymentType: (initialValue?: DeploymentType) =>
    p.select({
      message: "Deployment type",
      options: [
        { value: "vps", label: "Hosted VPS (DigitalOcean)" },
        { value: "local", label: "Local only (dev/test)" },
      ],
      initialValue: initialValue ?? "vps",
    }),

  frontendHosting: (
    deploymentType: DeploymentType,
    initialValue?: FrontendHosting
  ) => {
    const options =
      deploymentType === "local"
        ? [
            { value: "vercel", label: "Deploy separately to Vercel" },
            { value: "skip", label: "Skip for now" },
          ]
        : [
            { value: "same-vps", label: "Deploy to same VPS" },
            { value: "vercel", label: "Deploy separately to Vercel" },
            { value: "skip", label: "Skip for now" },
          ];
    return p.select({
      message: "Frontend hosting",
      options,
      initialValue:
        initialValue ?? (deploymentType === "local" ? "vercel" : "same-vps"),
    });
  },

  domain: (initialValue?: string | null) =>
    p.text({
      message:
        initialValue === undefined
          ? "Domain name (optional, for HTTPS setup)"
          : "Domain (blank to clear)",
      placeholder:
        initialValue === undefined ? "api.example.com (or leave blank)" : "",
      initialValue: initialValue ?? "",
      validate(v) {
        const t = normalizeDomain(v);
        if (!t) return; // optional, blank OK
        if (!domainLooksValid(t)) {
          return "Please enter a valid domain (e.g., api.example.com) or leave blank.";
        }
      },
    }),

  integrations: (initialValues?: Integration[]) =>
    p.multiselect({
      message:
        "Optional integrations (Use ↑/↓ to move, Space to toggle, Enter to confirm)",
      options: [
        { value: "stripe", label: "Stripe billing" },
        { value: "auth", label: "Auth modules" },
      ],
      initialValues,
      required: false,
    }),
};

// ---------- main prompts ----------
async function askAll(): Promise<ProjectMetadata | null> {
  const result = await p.group(
    {
      projectName: () => prompts.projectName(),

      network: () => prompts.network(),

      deploymentType: () => prompts.deploymentType(),

      frontendHosting: ({ results }) =>
        prompts.frontendHosting(results.deploymentType as DeploymentType),

      domain: () => prompts.domain(),

      integrations: () => prompts.integrations(),
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
      const v = await prompts.projectName(meta.projectName);
      if (!isCancel(v)) meta.projectName = v.trim();
    } else if (field === "network") {
      const v = await prompts.network(meta.network);
      if (!isCancel(v)) meta.network = v as Network;
    } else if (field === "deploymentType") {
      const v = await prompts.deploymentType(meta.deploymentType);
      if (!isCancel(v)) {
        meta.deploymentType = v as DeploymentType;
        normalizeFrontendHosting(meta);
      }
    } else if (field === "frontendHosting") {
      const v = await prompts.frontendHosting(
        meta.deploymentType,
        meta.deploymentType === "local" && meta.frontendHosting === "same-vps"
          ? "vercel"
          : meta.frontendHosting
      );
      if (!isCancel(v)) meta.frontendHosting = v as FrontendHosting;
    } else if (field === "domain") {
      const v = await prompts.domain(meta.domain);
      if (!isCancel(v)) meta.domain = normalizeDomain(v);
    } else if (field === "integrations") {
      const v = await prompts.integrations(meta.integrations);
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
