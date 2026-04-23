const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

function parseArgs(argv) {
  const separatorIndex = argv.indexOf("--");
  if (separatorIndex === -1) {
    throw new Error("Expected '--' before the command to run.");
  }

  const optionArgs = argv.slice(0, separatorIndex);
  const commandArgs = argv.slice(separatorIndex + 1);
  const options = {
    name: "",
    conflicts: [],
  };

  for (const arg of optionArgs) {
    if (arg.startsWith("--name=")) {
      options.name = arg.slice("--name=".length);
      continue;
    }

    if (arg.startsWith("--conflicts=")) {
      options.conflicts = arg
        .slice("--conflicts=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }
  }

  if (!options.name) {
    throw new Error("Missing required --name option.");
  }

  if (commandArgs.length === 0) {
    throw new Error("Missing command to run.");
  }

  if (options.conflicts.length === 0) {
    options.conflicts = [options.name];
  }

  return { options, commandArgs };
}

function workspaceLockDir() {
  const workspaceId = crypto
    .createHash("sha1")
    .update(path.resolve(process.cwd()))
    .digest("hex");

  return path.join(os.tmpdir(), "referal-system-locks", workspaceId);
}

function lockPathFor(name) {
  return path.join(workspaceLockDir(), `${name}.json`);
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLock(name) {
  const filePath = lockPathFor(name);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (isProcessAlive(content.pid)) {
      return content;
    }
  } catch {
    // Treat broken lock files as stale.
  }

  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore cleanup failures for stale locks.
  }

  return null;
}

function writeLock(name, commandArgs) {
  const filePath = lockPathFor(name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        name,
        pid: process.pid,
        cwd: process.cwd(),
        command: commandArgs.join(" "),
        startedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );

  return () => {
    try {
      if (fs.existsSync(filePath)) {
        const current = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (current.pid === process.pid) {
          fs.unlinkSync(filePath);
        }
      }
    } catch {
      // Best-effort cleanup only.
    }
  };
}

function quoteForShell(arg) {
  if (/[\s"]/u.test(arg)) {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return arg;
}

function main() {
  const { options, commandArgs } = parseArgs(process.argv.slice(2));
  const blockers = [];

  for (const name of options.conflicts) {
    const activeLock = readLock(name);
    if (activeLock) {
      blockers.push(activeLock);
    }
  }

  if (blockers.length > 0) {
    const blocker = blockers[0];
    console.error(
      `[run-single-instance] Refusing to start '${options.name}' because '${blocker.name}' is already running (pid ${blocker.pid}).`
    );
    console.error(
      "[run-single-instance] Stop the existing dev process before starting a new one."
    );
    process.exit(1);
  }

  const cleanupLock = writeLock(options.name, commandArgs);
  let cleanedUp = false;

  const cleanup = () => {
    if (!cleanedUp) {
      cleanedUp = true;
      cleanupLock();
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  const command = commandArgs.map(quoteForShell).join(" ");
  const child = spawn(command, {
    cwd: process.cwd(),
    env: process.env,
    shell: true,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    cleanup();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    cleanup();
    console.error(`[run-single-instance] Failed to start command: ${error.message}`);
    process.exit(1);
  });
}

main();
