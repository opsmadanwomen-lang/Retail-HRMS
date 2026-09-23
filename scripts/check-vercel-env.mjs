// TEMPORARY build-time diagnostic. Reports presence/length/context only — never prints values.
// Compares raw process.env against Vite's own loadEnv() to distinguish:
//   A) Vercel not exposing the var to the build process at all (both would show exists=false), vs
//   B) Vercel exposing it, but Vite's own env-loading step failing to pick it up
//      (process.env would show exists=true, loadEnv would show exists=false).
// Remove this script and revert the "build" script in package.json once reviewed.
import { loadEnv } from "vite";

const mode = process.env.VITE_MODE || "production";
const cwd = process.cwd();
const fileEnv = loadEnv(mode, cwd, "");

const keys = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

console.log("=== check-vercel-env: build-time diagnostic ===");
console.log(`mode: ${mode}`);
console.log(`cwd: ${cwd}`);
console.log(`NODE_ENV: ${process.env.NODE_ENV ?? "(unset)"}`);
console.log(`VERCEL: ${process.env.VERCEL ?? "(unset)"}`);
console.log(`VERCEL_ENV: ${process.env.VERCEL_ENV ?? "(unset)"}`);

for (const key of keys) {
  const procVal = process.env[key];
  const fileVal = fileEnv[key];
  const procExists = typeof procVal === "string" && procVal.length > 0;
  const fileExists = typeof fileVal === "string" && fileVal.length > 0;
  console.log(`${key}:`);
  console.log(`  process.env : exists=${procExists} length=${procVal ? procVal.length : 0}`);
  console.log(`  loadEnv()   : exists=${fileExists} length=${fileVal ? fileVal.length : 0}`);
}
console.log("=== end check-vercel-env ===");
