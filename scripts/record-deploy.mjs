// Reads the latest Deploy broadcast and records the Kasauti address for the frontend and the README.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const cfg = JSON.parse(readFileSync("config/base.json", "utf8"));
const run = JSON.parse(readFileSync(`contracts/broadcast/Deploy.s.sol/${cfg.chainId}/run-latest.json`, "utf8"));
const create = run.transactions.find((t) => t.transactionType === "CREATE" && t.contractName === "Kasauti");
if (!create) throw new Error("no Kasauti CREATE in the latest broadcast");
const receipt = run.receipts.find((r) => r.transactionHash === create.hash);
if (!receipt || receipt.status !== "0x1") throw new Error("deploy transaction not confirmed");

const failed = run.receipts.filter((r) => r.status !== "0x1");
if (failed.length) throw new Error(`${failed.length} wiring transaction(s) failed: ${failed.map((r) => r.transactionHash).join(", ")}`);

const out = {
  chainId: cfg.chainId,
  kasauti: create.contractAddress,
  deployer: create.transaction.from,
  deployTx: create.hash,
  block: Number(receipt.blockNumber),
  wiringTxs: run.receipts.filter((r) => r.transactionHash !== create.hash).map((r) => r.transactionHash),
  configGeneratedAt: cfg.generatedAt,
};
mkdirSync("deployments", { recursive: true });
writeFileSync(`deployments/${cfg.chainId}.json`, JSON.stringify(out, null, 2) + "\n");

const envPath = "web/.env";
const env = readFileSync(envPath, "utf8");
const line = `VITE_KASAUTI_ADDRESS=${out.kasauti}`;
writeFileSync(envPath, /^VITE_KASAUTI_ADDRESS=.*$/m.test(env) ? env.replace(/^VITE_KASAUTI_ADDRESS=.*$/m, line) : env + `\n${line}\n`);

console.log(`Kasauti ${out.kasauti} (block ${out.block}), ${out.wiringTxs.length} wiring txs. Wrote deployments/${cfg.chainId}.json and ${envPath}.`);
