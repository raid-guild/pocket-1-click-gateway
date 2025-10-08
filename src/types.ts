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

export interface WalletSetupResult {
  network: Network;
  gateway: { name: string; address: string };
  application: { name: string; address: string };
  exportPath: string; // .tmp/keys.json
  funded: boolean;
  fundedAtIso?: string;
}
