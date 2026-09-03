/**
 * Publish the static export in out/ to the gh-pages branch.
 *
 * Deploying from a branch rather than GitHub Actions because pushing a workflow file
 * needs the `workflow` OAuth scope, which a default `gh auth login` does not grant.
 * `.github/workflows/deploy.yml` is in the repo for whenever that scope is added.
 *
 * Uses a detached worktree so the working tree is never touched — no stashing, no risk
 * of publishing uncommitted source.
 */
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BRANCH = "gh-pages";
const WORKTREE = ".gh-pages-worktree";
const OUT = "out";

const git = (...args) => execFileSync("git", args, { stdio: "pipe" }).toString().trim();
const gitLoud = (...args) => execFileSync("git", args, { stdio: "inherit" });

if (!existsSync(OUT) || readdirSync(OUT).length === 0) {
  console.error(`${OUT}/ is empty — run the build first.`);
  process.exit(1);
}

// A stale worktree from an interrupted run would block the checkout below.
if (existsSync(WORKTREE)) {
  try {
    git("worktree", "remove", "--force", WORKTREE);
  } catch {
    rmSync(WORKTREE, { recursive: true, force: true });
  }
}

let branchExists = true;
try {
  git("rev-parse", "--verify", `refs/heads/${BRANCH}`);
} catch {
  branchExists = false;
}

if (branchExists) {
  git("worktree", "add", WORKTREE, BRANCH);
} else {
  // Orphan: the published site shares no history with the source branch.
  git("worktree", "add", "--detach", WORKTREE);
  execFileSync("git", ["checkout", "--orphan", BRANCH], { cwd: WORKTREE, stdio: "pipe" });
  execFileSync("git", ["rm", "-rf", "--quiet", "."], { cwd: WORKTREE, stdio: "pipe" });
}

// Clear everything except .git, then copy the fresh build in.
for (const entry of readdirSync(WORKTREE)) {
  if (entry !== ".git") rmSync(join(WORKTREE, entry), { recursive: true, force: true });
}
cpSync(OUT, WORKTREE, { recursive: true });

const opts = { cwd: WORKTREE, stdio: "pipe" };
execFileSync("git", ["add", "-A"], opts);

const dirty = execFileSync("git", ["status", "--porcelain"], opts).toString().trim();
if (!dirty) {
  console.log("No changes to publish.");
} else {
  execFileSync("git", ["commit", "-m", `Publish site ${new Date().toISOString()}`], opts);
  execFileSync("git", ["push", "origin", BRANCH], { cwd: WORKTREE, stdio: "inherit" });
  console.log(`Published to ${BRANCH}.`);
}

gitLoud("worktree", "remove", "--force", WORKTREE);
