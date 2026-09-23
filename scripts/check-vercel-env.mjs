// TEMPORARY build-time diagnostic. Reports presence/length only — never prints values.
// Remove this script and revert the "build" script in package.json once the Vercel
// build-log investigation is done.
const vars = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];

console.log("=== check-vercel-env: build-time process.env diagnostic ===");
for (const name of vars) {
  const val = process.env[name];
  const exists = typeof val === "string" && val.length > 0;
  console.log(`${name}: exists=${exists} length=${val ? val.length : 0}`);
}
console.log("=== end check-vercel-env ===");
