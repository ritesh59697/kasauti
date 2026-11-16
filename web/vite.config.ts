import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, getAddress, http, isHash, type Address } from "viem";
import { base } from "viem/chains";

/**
 * Dev-server only: deploy.html posts the deploy tx hash here. The hash is checked onchain (contract
 * creation, wiring matches config) before the address is written to deployments/ and web/.env.
 */
function recordDeploy(rpc: string): Plugin {
  const root = path.resolve(__dirname, "..");
  return {
    name: "kasauti-record-deploy",
    apply: "serve",
    configureServer(server) {
      // mirror Vercel's cleanUrls in dev: /app serves app.html
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/app" || req.url?.startsWith("/app?")) req.url = req.url.replace("/app", "/app.html");
        next();
      });
      server.middlewares.use("/__kasauti/record", (req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          try {
            const { hash } = JSON.parse(body);
            if (!isHash(hash)) throw new Error("bad hash");
            const cfg = JSON.parse(readFileSync(path.join(root, "config/base.json"), "utf8"));
            const abi = JSON.parse(readFileSync(path.join(root, "contracts/out/Kasauti.sol/Kasauti.json"), "utf8")).abi;
            const client = createPublicClient({ chain: base, transport: http(rpc) });
            const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.waitForTransactionReceipt({ hash })]);
            if (tx.to !== null || receipt.status !== "success" || !receipt.contractAddress) throw new Error("not a successful contract creation");
            const k = getAddress(receipt.contractAddress);
            const read = (functionName: string, args: unknown[] = []) => client.readContract({ address: k, abi, functionName, args });
            const eq = (a: unknown, b: string) => getAddress(a as Address) === getAddress(b);

            if (!eq(await read("registry"), cfg.oracleRegistry)) throw new Error("registry does not match config");
            for (const f of cfg.clFactories) if (!(await read("allowedFactory", [f]))) throw new Error(`factory ${f} not allowed`);
            const [qFeed] = (await read("quoteFeed", [cfg.quote.address])) as [string, number];
            if (!eq(qFeed, cfg.quote.feed.address)) throw new Error("quote feed does not match config");
            for (const s of cfg.stocks) if (!eq(await read("stockFeed", [s.address]), s.feed.address)) throw new Error(`${s.symbol} feed not wired`);

            const out = {
              chainId: cfg.chainId,
              kasauti: k,
              owner: getAddress((await read("owner")) as Address),
              deployTx: hash,
              block: Number(receipt.blockNumber),
              configGeneratedAt: cfg.generatedAt,
            };
            mkdirSync(path.join(root, "deployments"), { recursive: true });
            writeFileSync(path.join(root, `deployments/${cfg.chainId}.json`), JSON.stringify(out, null, 2) + "\n");

            const envPath = path.join(__dirname, ".env");
            const env = readFileSync(envPath, "utf8");
            const line = `VITE_KASAUTI_ADDRESS=${k}`;
            writeFileSync(envPath, /^VITE_KASAUTI_ADDRESS=.*$/m.test(env) ? env.replace(/^VITE_KASAUTI_ADDRESS=.*$/m, line) : `${env}\n${line}\n`);

            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ kasauti: k, block: out.block, stocksChecked: cfg.stocks.length }));
          } catch (e) {
            res.statusCode = 400;
            res.end(e instanceof Error ? e.message : String(e));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  return {
    plugins: [react(), tailwindcss(), recordDeploy(env.VITE_BASE_RPC_URL)],
    resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
    // Only the landing and the app ship. deploy.html is local-only and stays out of the build.
    build: { rollupOptions: { input: { index: path.resolve(__dirname, "index.html"), app: path.resolve(__dirname, "app.html") } } },
  };
});
