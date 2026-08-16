import { spawn } from "node:child_process";

const candidates = process.platform === "win32"
  ? [["../.venv-nq-win/Scripts/python.exe", []], ["py", ["-3"]], ["python", []], ["python3", []]]
  : [["python3", []], ["python", []]];
const scriptArgs = process.argv.slice(2);

async function run(command, prefix) {
  return new Promise((resolve) => {
    const child = spawn(command, [...prefix, ...scriptArgs], { stdio: "inherit" });
    child.on("error", error => {
      if (error.code === "ENOENT") resolve(false);
      else {
        console.error(error.message);
        resolve(1);
      }
    });
    child.on("exit", code => resolve(code ?? 1));
  });
}

let lastResult = false;
for (const [command, prefix] of candidates) {
  lastResult = await run(command, prefix);
  if (lastResult === 0) process.exit(0);
  if (lastResult !== false) process.exit(Number(lastResult));
}

console.error("Python 3 was not found. Install Python 3 or activate the analysis environment.");
process.exit(1);
