import { spawn } from "node:child_process";

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: environment },
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`El comando ${command} terminó con ${signal ?? `código ${code}`}.`));
    });
  });
}

if (!process.env.npm_execpath) throw new Error("No se encontró el ejecutable de npm para el build de prueba.");

await run(process.execPath, [process.env.npm_execpath, "run", "build"], "production");
await run(process.execPath, ["--test"], "development");
