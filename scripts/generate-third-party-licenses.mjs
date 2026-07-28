import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const output = path.join(root, "src", "generated", "third-party-licenses.json");

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const licenseOrReview = (value) => typeof value === "string" && value.trim() ? value.trim() : "需要确认";
const repositoryUrl = (value) => {
  if (typeof value === "string") return value.replace(/^git\+/, "").replace(/\.git$/, "");
  if (value && typeof value.url === "string") return value.url.replace(/^git\+/, "").replace(/\.git$/, "");
  return null;
};

function npmPackageName(lockPath) {
  const parts = lockPath.split("/").filter(Boolean);
  const index = parts.lastIndexOf("node_modules");
  if (index < 0 || !parts[index + 1]) return null;
  return parts[index + 1].startsWith("@") && parts[index + 2]
    ? `${parts[index + 1]}/${parts[index + 2]}`
    : parts[index + 1];
}

function installedNpmManifest(name) {
  try {
    return readJson(path.join(root, "node_modules", ...name.split("/"), "package.json"));
  } catch {
    return null;
  }
}

function readNpmEntries() {
  const lockPath = path.join(root, "package-lock.json");
  if (!fs.existsSync(lockPath)) return [];
  const lock = readJson(lockPath);
  return Object.entries(lock.packages ?? {})
    .filter(([key, value]) => key.startsWith("node_modules/") && value?.version)
    .map(([key, value]) => {
      const name = value.name ?? npmPackageName(key) ?? "需要确认";
      const manifest = installedNpmManifest(name);
      return {
        ecosystem: "npm",
        name,
        version: value.version,
        license: licenseOrReview(value.license ?? manifest?.license),
        source: repositoryUrl(manifest?.repository) ?? (typeof manifest?.homepage === "string" ? manifest.homepage : null),
      };
    });
}

function readCargoLockEntries() {
  const lockPath = path.join(root, "src-tauri", "Cargo.lock");
  if (!fs.existsSync(lockPath)) return [];
  const lines = fs.readFileSync(lockPath, "utf8").split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const line of lines) {
    if (line === "[[package]]") {
      if (current?.name && current.version && current.source) entries.push(current);
      current = {};
    } else {
      const match = line.match(/^(name|version|source) = "(.*)"$/);
      if (match && current) current[match[1]] = match[2];
    }
  }
  if (current?.name && current.version && current.source) entries.push(current);
  return entries;
}

function cargoManifest(name, version) {
  const cargoHome = process.env.CARGO_HOME || path.join(process.env.USERPROFILE ?? "", ".cargo");
  const sourceRoot = path.join(cargoHome, "registry", "src");
  if (!fs.existsSync(sourceRoot)) return null;
  for (const index of fs.readdirSync(sourceRoot)) {
    const manifestPath = path.join(sourceRoot, index, `${name}-${version}`, "Cargo.toml");
    if (!fs.existsSync(manifestPath)) continue;
    const text = fs.readFileSync(manifestPath, "utf8");
    const value = (key) => text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1] ?? null;
    return { license: value("license"), source: value("repository") ?? value("homepage") };
  }
  return null;
}

function readCargoEntries() {
  return readCargoLockEntries().map(({ name, version }) => {
    const manifest = cargoManifest(name, version);
    return {
      ecosystem: "Cargo",
      name,
      version,
      license: licenseOrReview(manifest?.license),
      source: manifest?.source ?? `https://crates.io/crates/${encodeURIComponent(name)}/${version}`,
    };
  });
}

function writeNotice(entries, noticePath) {
  const lines = [
    "SimpBangumi third-party open source components",
    "Generated from package-lock.json and Cargo.lock.",
    "License values marked as 需要确认 require manual verification.",
    "",
  ];
  for (const ecosystem of ["npm", "Cargo"]) {
    lines.push(`[${ecosystem}]`);
    for (const entry of entries.filter((item) => item.ecosystem === ecosystem)) {
      lines.push(`${entry.name} ${entry.version} | ${entry.license} | ${entry.source ?? "来源未声明"}`);
    }
    lines.push("");
  }
  fs.writeFileSync(noticePath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const projectPackage = readJson(path.join(root, "package.json"));
  const entries = [...readNpmEntries(), ...readCargoEntries()]
    .sort((a, b) => `${a.ecosystem}:${a.name}`.localeCompare(`${b.ecosystem}:${b.name}`));
  const manifest = {
    generatedAt: new Date().toISOString(),
    project: { name: projectPackage.name, version: projectPackage.version },
    sources: ["package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"],
    entries,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const noticeIndex = process.argv.indexOf("--notice");
  if (noticeIndex >= 0) writeNotice(entries, path.resolve(root, process.argv[noticeIndex + 1] ?? "THIRD_PARTY_LICENSES.txt"));
  console.log(`Generated ${entries.length} third-party license records.`);
}

main();