#!/usr/bin/env bash
# Repo health checks. Prints one PASS/FAIL line per check; exits 0 only when all pass.
set -u
cd "$(dirname "$0")"

failures=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; failures=$((failures + 1)); }

# (a) typecheck
if out=$(npm run typecheck 2>&1); then
  pass "typecheck"
else
  fail "typecheck"
  echo "$out" | grep -E "error|Error" | sed 's/^/      /'
fi

# (b) unit tests
if out=$(npm test 2>&1); then
  pass "unit tests ($(echo "$out" | grep -E '^ +Tests' | sed -E 's/^ +Tests +//'))"
else
  fail "unit tests"
  echo "$out" | tail -40 | sed 's/^/      /'
fi

# (c) secret scan over tracked files
secret_patterns=(
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'sk-(ant-|proj-)?[A-Za-z0-9_-]{32,}'
  'AKIA[0-9A-Z]{16}'
  'gh[pousr]_[A-Za-z0-9]{36,}'
  'xox[abprs]-[A-Za-z0-9-]{20,}'
  'EAA[A-Za-z0-9]{60,}'
  'pat[A-Za-z0-9]{14}\.[a-f0-9]{64}'
  '(api[_-]?key|secret|token|password|passwd)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_+/=-]{32,}["'"'"']'
)
secret_args=()
for p in "${secret_patterns[@]}"; do secret_args+=(-e "$p"); done
secret_hits=$(git grep -n -I -i -E "${secret_args[@]}" -- . \
  ':(exclude)package-lock.json' ':(exclude)**/package-lock.json' \
  ':(exclude)**/worker-configuration.d.ts' ':(exclude)**/migrations/meta/**' 2>/dev/null)
if [ -z "$secret_hits" ]; then
  pass "secret scan"
else
  fail "secret scan"
  echo "$secret_hits" | cut -c1-160 | sed 's/^/      /'
fi

# (d) personal-info scan: absolute home paths and personal mail addresses
home_path='/Use''rs/'
mail_domain='@gmail''\.com'
pii_hits=$( { git grep -n -I -E -e "$home_path" -- . ; git grep -n -I -i -E -e "$mail_domain" -- . ; } 2>/dev/null)
if [ -z "$pii_hits" ]; then
  pass "personal-info scan"
else
  fail "personal-info scan"
  echo "$pii_hits" | cut -c1-160 | sed 's/^/      /'
fi

# (e) no new npm script may reach production
guard_out=$(node --input-type=module -e '
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
const allowed = {
  "package.json": ["dev", "deploy", "import"],
  "backend/package.json": ["dev", "deploy", "db:migrate"],
  "scripts/package.json": ["import"],
}
const bad = /--remote\b|wrangler\s+deploy\b/
const files = execSync("git ls-files \"package.json\" \"*/package.json\"", { encoding: "utf8" }).split("\n").filter(Boolean)
const hits = []
for (const file of files) {
  const scripts = JSON.parse(readFileSync(file, "utf8")).scripts ?? {}
  for (const [name, command] of Object.entries(scripts)) {
    if (bad.test(command) && !(allowed[file] ?? []).includes(name)) hits.push(`${file} ${name}: ${command}`)
  }
}
const local = execSync("git ls-files \"backend/scripts/local-*.mjs\"", { encoding: "utf8" }).split("\n").filter(Boolean)
for (const file of local) {
  if (bad.test(readFileSync(file, "utf8"))) hits.push(`${file} contains a production flag`)
}
console.log(hits.join("\n"))
' 2>&1)
if [ $? -eq 0 ] && [ -z "$guard_out" ]; then
  pass "no new npm script uses --remote or wrangler deploy"
else
  fail "no new npm script uses --remote or wrangler deploy"
  echo "$guard_out" | sed 's/^/      /'
fi

if [ "$failures" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
fi
echo "$failures CHECK(S) FAILED"
exit 1
