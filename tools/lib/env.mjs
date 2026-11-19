import { readFileSync } from "node:fs";

export const REQUIRED_PRODUCTION_KEYS = [
	"DATABASE_URL",
	"AUTH_URL",
	"AUTH_TRUST_HOST",
	"NEXTAUTH_URL",
	"NEXTAUTH_SECRET",
	"NEXT_PUBLIC_APP_URL",
	"UPLOAD_DIR",
	"CRON_SECRET",
	"POSTGRES_USER",
	"POSTGRES_PASSWORD",
	"POSTGRES_DB",
];

export const OPTIONAL_PRODUCTION_KEYS = [
	"SMTP_HOST",
	"SMTP_PORT",
	"SMTP_USER",
	"SMTP_PASS",
	"SMTP_FROM",
	"ARCHIVE_AFTER_DAYS",
	"PUPPETEER_EXECUTABLE_PATH",
];

export function parseEnvText(text) {
	const result = {};

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const equalsIndex = line.indexOf("=");
		if (equalsIndex === -1) continue;

		const key = line.slice(0, equalsIndex).trim();
		let value = line.slice(equalsIndex + 1).trim();

		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		if (key) result[key] = value;
	}

	return result;
}

function postgresIdentityIssues({ POSTGRES_USER, POSTGRES_DB }) {
	const issues = [];
	// libpq expands connection strings supplied as database arguments, even when quoted.
	if (/[=\0]|^postgres(?:ql)?:\/\//.test(POSTGRES_DB ?? "")) {
		issues.push("POSTGRES_DB must be a literal database name, not a connection string");
	}
	// Bash would silently drop NUL when capturing a file-derived identity.
	if (POSTGRES_USER?.includes("\0")) {
		issues.push("POSTGRES_USER must not contain a NUL byte");
	}
	return issues;
}

export function readPostgresIdentity(envFile) {
	const missingIdentity = "Cannot read POSTGRES_USER and POSTGRES_DB from the production environment file";
	let current;
	try {
		current = parseEnvText(readFileSync(envFile, "utf8"));
	} catch {
		throw new Error(missingIdentity);
	}
	const [issue] = postgresIdentityIssues(current);
	if (issue) throw new Error(issue);
	if (!current.POSTGRES_USER || !current.POSTGRES_DB) throw new Error(missingIdentity);
	return [current.POSTGRES_USER, current.POSTGRES_DB];
}

export function normalizeOrigin(value) {
	if (!value) return null;
	try {
		const url = new URL(value);
		return `${url.protocol}//${url.host}`;
	} catch {
		return null;
	}
}

export function createOriginReport(current) {
	const entries = ["AUTH_URL", "NEXTAUTH_URL", "NEXT_PUBLIC_APP_URL"].map(
		(key) => [key, normalizeOrigin(current[key])],
	);
	const issues = [];
	for (const [key, origin] of entries) {
		if (!origin) {
			issues.push(`${key} must be a valid absolute URL`);
		} else if (/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) {
			issues.push(`${key} must not use localhost in production`);
		} else if (!origin.startsWith("https://")) {
			issues.push(`${key} must use HTTPS in production`);
		}
	}
	const distinct = new Set(entries.map(([, origin]) => origin).filter(Boolean));
	if (distinct.size > 1)
		issues.push(
			"AUTH_URL, NEXTAUTH_URL, and NEXT_PUBLIC_APP_URL must use the same origin",
		);
	if (current.AUTH_TRUST_HOST !== "true")
		issues.push(
			"AUTH_TRUST_HOST=true is required behind the production reverse proxy",
		);
	return { origin: distinct.size === 1 ? [...distinct][0] : null, issues };
}

const SECRET_PLACEHOLDERS = new Set([
	"changeme",
	"generate-with-openssl-rand-base64-32",
	"generate-a-random-secret",
]);

export function createRuntimeReport(current) {
	const issues = postgresIdentityIssues(current);
	const warnings = [];

	if (current.UPLOAD_DIR !== "/app/uploads") {
		issues.push("UPLOAD_DIR must equal /app/uploads for Docker production");
	}

	let databaseUrl = null;
	try {
		databaseUrl = new URL(current.DATABASE_URL);
	} catch {
		issues.push("DATABASE_URL must be a valid PostgreSQL URL");
	}

	if (databaseUrl) {
		if (
			databaseUrl.protocol !== "postgresql:" &&
			databaseUrl.protocol !== "postgres:"
		) {
			issues.push(
				"DATABASE_URL must use a PostgreSQL scheme (postgresql: or postgres:)",
			);
		}
		const databaseName = databaseUrl.pathname.replace(/^\//, "");
		if (databaseUrl.hostname !== "db")
			issues.push("DATABASE_URL must use host db");
		if (decodeURIComponent(databaseUrl.username) !== current.POSTGRES_USER) {
			issues.push("DATABASE_URL user must match POSTGRES_USER");
		}
		if (
			decodeURIComponent(databaseUrl.password) !== current.POSTGRES_PASSWORD
		) {
			issues.push("DATABASE_URL password must match POSTGRES_PASSWORD");
		}
		if (databaseName !== current.POSTGRES_DB) {
			issues.push("DATABASE_URL database name must match POSTGRES_DB");
		}
	}

	for (const key of ["NEXTAUTH_SECRET", "CRON_SECRET"]) {
		if (SECRET_PLACEHOLDERS.has(current[key])) {
			issues.push(`${key} still uses a placeholder value`);
		}
	}

	if ((current.POSTGRES_PASSWORD ?? "").length < 16) {
		warnings.push(
			"POSTGRES_PASSWORD is shorter than 16 characters; rotate it with a coordinated database credential change",
		);
	}

	return { issues, warnings };
}

export function createEnvReport({ current, template }) {
	const templateKeys = Object.keys(template);
	const missingRequired = REQUIRED_PRODUCTION_KEYS.filter(
		(key) => !current[key],
	);
	const missingOptional = templateKeys
		.filter((key) => OPTIONAL_PRODUCTION_KEYS.includes(key))
		.filter((key) => !(key in current));
	const runtime = createRuntimeReport(current);

	return {
		missingRequired,
		missingOptional,
		unknownKeys: Object.keys(current).filter(
			(key) => !templateKeys.includes(key),
		),
		presentRequired: REQUIRED_PRODUCTION_KEYS.filter((key) => current[key]),
		originIssues: createOriginReport(current).issues,
		runtimeIssues: runtime.issues,
		runtimeWarnings: runtime.warnings,
	};
}

export function mergeMissingEnvKeys({ currentText, templateText }) {
	const current = parseEnvText(currentText);
	const templateLines = templateText.split(/\r?\n/);
	const missingLines = [];

	for (const line of templateLines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const equalsIndex = trimmed.indexOf("=");
		if (equalsIndex === -1) continue;

		const key = trimmed.slice(0, equalsIndex).trim();
		if (key && !(key in current)) {
			missingLines.push(trimmed);
		}
	}

	if (missingLines.length === 0) return currentText;

	const separator = currentText.endsWith("\n") ? "\n" : "\n\n";
	return `${currentText}${separator}# Added by Approval App Manager\n${missingLines.join("\n")}\n`;
}
