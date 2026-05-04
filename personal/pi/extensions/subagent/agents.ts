/**
 * Agent discovery and configuration
 *
 * Discovery order (later sources override earlier ones by agent name):
 *   1. User dir: ~/.pi/agent/agents/
 *   2. Each registered package's pi.agents directories (from settings.json
 *      `packages` entries that point at local paths or git/npm packages with
 *      a `pi.agents` manifest field)
 *   3. Project dir: nearest .pi/agents/ walking up from cwd
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);

		if (!frontmatter.name || !frontmatter.description) {
			continue;
		}

		const tools = frontmatter.tools
			?.split(",")
			.map((t: string) => t.trim())
			.filter(Boolean);

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

/**
 * Resolve a package source entry from settings.json `packages` to its
 * on-disk root directory.
 *
 *   - Local absolute path: use as-is
 *   - Local relative path: resolved against the directory containing settings.json
 *   - Strings with a scheme/repo shorthand (git:, https://, github.com/...) are
 *     resolved under ~/.pi/agent/git/<host>/<path>
 */
function resolvePackageRoot(entry: string, agentDir: string): string | null {
	if (!entry) return null;

	if (entry.startsWith("/")) {
		return isDirectory(entry) ? entry : null;
	}

	if (entry.startsWith("~/")) {
		const home = process.env.HOME || "";
		const expanded = path.join(home, entry.slice(2));
		return isDirectory(expanded) ? expanded : null;
	}

	if (entry.startsWith("./") || entry.startsWith("../")) {
		const resolved = path.resolve(agentDir, entry);
		return isDirectory(resolved) ? resolved : null;
	}

	// Strip optional leading scheme prefix
	let spec = entry;
	for (const prefix of ["git:", "npm:", "https://", "http://", "ssh://"]) {
		if (spec.startsWith(prefix)) {
			spec = spec.slice(prefix.length);
			break;
		}
	}
	// Strip @ref suffix (e.g. github.com/user/repo@v1)
	const atIdx = spec.lastIndexOf("@");
	if (atIdx > 0 && spec.indexOf("/", atIdx) === -1) {
		spec = spec.slice(0, atIdx);
	}
	// git@github.com:user/repo -> github.com/user/repo
	const sshMatch = spec.match(/^([^@:/]+@)?([^:]+):(.+)$/);
	if (sshMatch && !spec.startsWith(sshMatch[2] + "/")) {
		spec = `${sshMatch[2]}/${sshMatch[3]}`;
	}

	const candidate = path.join(agentDir, "git", spec);
	return isDirectory(candidate) ? candidate : null;
}

/**
 * Read pi.agents directories declared in a package's package.json.
 */
function getPackageAgentDirs(packageRoot: string): string[] {
	const pkgJsonPath = path.join(packageRoot, "package.json");
	if (!fs.existsSync(pkgJsonPath)) return [];

	try {
		const raw = fs.readFileSync(pkgJsonPath, "utf-8");
		const pkg = JSON.parse(raw) as { pi?: { agents?: unknown } };
		const agentsField = pkg?.pi?.agents;
		if (!Array.isArray(agentsField)) return [];

		const dirs: string[] = [];
		for (const entry of agentsField) {
			if (typeof entry !== "string") continue;
			const resolved = path.resolve(packageRoot, entry);
			if (isDirectory(resolved)) dirs.push(resolved);
		}
		return dirs;
	} catch {
		return [];
	}
}

/**
 * Walk settings.json `packages` and return all `pi.agents` directories.
 */
function getAgentDirsFromPackages(agentDir: string): string[] {
	const settingsPath = path.join(agentDir, "settings.json");
	if (!fs.existsSync(settingsPath)) return [];

	let packages: unknown[];
	try {
		const raw = fs.readFileSync(settingsPath, "utf-8");
		const settings = JSON.parse(raw) as { packages?: unknown };
		if (!Array.isArray(settings.packages)) return [];
		packages = settings.packages;
	} catch {
		return [];
	}

	const dirs: string[] = [];
	for (const entry of packages) {
		const sourceStr = typeof entry === "string" ? entry : (entry as { source?: string })?.source;
		if (typeof sourceStr !== "string") continue;

		const root = resolvePackageRoot(sourceStr, agentDir);
		if (!root) continue;

		dirs.push(...getPackageAgentDirs(root));
	}
	return dirs;
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const agentDir = getAgentDir();
	const userDir = path.join(agentDir, "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const includeUser = scope !== "project";
	const includeProject = scope !== "user" && !!projectAgentsDir;

	const userAgents = includeUser ? loadAgentsFromDir(userDir, "user") : [];
	const packageAgents = includeUser
		? getAgentDirsFromPackages(agentDir).flatMap((dir) => loadAgentsFromDir(dir, "user"))
		: [];
	const projectAgents = includeProject ? loadAgentsFromDir(projectAgentsDir!, "project") : [];

	// Merge with later sources overriding earlier ones by agent name:
	//   user dir < package agents < project dir
	const agentMap = new Map<string, AgentConfig>();
	for (const agent of userAgents) agentMap.set(agent.name, agent);
	for (const agent of packageAgents) agentMap.set(agent.name, agent);
	for (const agent of projectAgents) agentMap.set(agent.name, agent);

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
