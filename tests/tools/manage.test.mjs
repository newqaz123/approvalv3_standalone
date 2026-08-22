import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("envDoctor creates a production env file from the template when missing", async () => {
	const { envDoctor } = await import("../../tools/manage.mjs");
	const root = await mkdtemp(path.join(os.tmpdir(), "approval-manager-"));
	const paths = {
		root,
		envExample: path.join(root, ".env.example"),
		envProduction: path.join(root, ".env.production"),
	};

	await writeFile(
		paths.envExample,
		[
			'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"',
			'NEXTAUTH_URL="http://localhost:3000"',
		].join("\n"),
	);

	await envDoctor({
		paths,
		ask: async () => {
			throw new Error("prompt should not be called when creating the file");
		},
		log: () => {},
	});

	const created = await readFile(paths.envProduction, "utf8");
	assert.match(created, /DATABASE_URL=/);
	assert.match(created, /NEXTAUTH_URL=/);
});

test("envDoctor backs up and appends missing keys when confirmed", async () => {
	const { envDoctor } = await import("../../tools/manage.mjs");
	const root = await mkdtemp(path.join(os.tmpdir(), "approval-manager-"));
	const paths = {
		root,
		envExample: path.join(root, ".env.example"),
		envProduction: path.join(root, ".env.production"),
	};

	await writeFile(
		paths.envExample,
		[
			'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"',
			'NEXTAUTH_URL="http://localhost:3000"',
			'NEXTAUTH_SECRET="secret"',
		].join("\n"),
	);
	await writeFile(
		paths.envProduction,
		'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"\n',
	);

	await envDoctor({
		paths,
		ask: async () => "y",
		log: () => {},
	});

	const updated = await readFile(paths.envProduction, "utf8");
	assert.match(updated, /NEXTAUTH_URL=/);
	assert.match(updated, /NEXTAUTH_SECRET=/);

	const files = await readdir(root);
	assert.equal(
		files.some((name) => name.startsWith(".env.production.backup.")),
		true,
	);
});

test("envDoctor does not overwrite an existing backup path collision", async () => {
	const { envDoctor } = await import("../../tools/manage.mjs");
	const root = await mkdtemp(path.join(os.tmpdir(), "approval-manager-"));
	const paths = {
		root,
		envExample: path.join(root, ".env.example"),
		envProduction: path.join(root, ".env.production"),
	};
	const fixedStamp = "20260614-120000.123";
	const collidingBackup = `${paths.envProduction}.backup.${fixedStamp}`;
	const originalProduction =
		'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"\n';

	await writeFile(
		paths.envExample,
		[
			'DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"',
			'NEXTAUTH_URL="http://localhost:3000"',
		].join("\n"),
	);
	await writeFile(paths.envProduction, originalProduction);
	await writeFile(collidingBackup, "existing-backup\n");

	await envDoctor({
		paths,
		ask: async () => "y",
		log: () => {},
		timestampFn: () => fixedStamp,
	});

	const existingBackup = await readFile(collidingBackup, "utf8");
	const nextBackup = await readFile(`${collidingBackup}.1`, "utf8");

	assert.equal(existingBackup, "existing-backup\n");
	assert.equal(nextBackup, originalProduction);
});

test("updateExistingInstall delegates the complete update to deploy.sh once", async () => {
	const { updateExistingInstall } = await import("../../tools/manage.mjs");
	const paths = { scripts: { deploy: "/repo/scripts/deploy.sh" } };
	const calls = [];

	await updateExistingInstall({
		paths,
		log: () => {},
		run: async (script, args, options) =>
			calls.push({ script, args, paths: options.paths }),
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0].script, "/repo/scripts/deploy.sh");
	assert.deepEqual(calls[0].args, []);
	assert.equal(calls[0].paths, paths);
});

test("restoreBackup cancels when the database backup path is blank", async () => {
	const { restoreBackup } = await import("../../tools/manage.mjs");
	const prompts = [];

	await restoreBackup({
		paths: { scripts: { restore: "/tmp/restore.sh" } },
		ask: async (question) => {
			prompts.push(question);
			return "";
		},
		log: () => {},
		run: async () => {
			throw new Error("restore script should not run");
		},
	});

	assert.deepEqual(prompts, ["Database backup path: "]);
});

test("formatBackupChoice shows size and user rows for restore selection", async () => {
	const { formatBackupChoice } = await import("../../tools/manage.mjs");

	const result = formatBackupChoice({
		path: "backups/db_20260615_155300.sql",
		sizeBytes: 69632,
		userRows: 6,
	});

	assert.equal(result, "backups/db_20260615_155300.sql (68 KB, users: 6)");
});

test("deploy script pulls main with fast-forward-only updates", async () => {
	const deployScript = await readFile("scripts/deploy.sh", "utf8");

	assert.match(deployScript, /CURRENT_BRANCH=.*rev-parse --abbrev-ref HEAD/);
	assert.match(deployScript, /\[ "\$CURRENT_BRANCH" = main \]/);
	assert.match(deployScript, /Online deployment must run from branch main/);
});

test("deploy script warns when post-deploy user count is zero", async () => {
	const deployScript = await readFile("scripts/deploy.sh", "utf8");

	assert.match(deployScript, /USERS_AFTER_DEPLOY=/);
	assert.match(deployScript, /WARNING: Database has 0 users after deploy/);
});

test("backup script keeps more backups and warns about empty user data", async () => {
	const backupScript = await readFile("scripts/backup.sh", "utf8");

	assert.match(backupScript, /RETENTION_COUNT=10/);
	assert.match(backupScript, /USERS_COUNT=/);
	assert.match(backupScript, /WARNING: Database backup contains 0 users/);
	assert.match(backupScript, /enforce_retention/);
});

test("restore script performs a clean schema restore through named container support", async () => {
	const restoreScript = await readFile("scripts/restore.sh", "utf8");

	assert.match(restoreScript, /DB_CONTAINER="\$\{DB_CONTAINER:-approval-db\}"/);
	assert.match(
		restoreScript,
		/drop schema public cascade; create schema public;/,
	);
	assert.match(restoreScript, /Restored users:/);
});

test("manage cli renders menu and exits on option 8", async () => {
	const stdout = await new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["tools/manage.mjs"], {
			cwd: process.cwd(),
			stdio: ["pipe", "pipe", "pipe"],
		});
		let output = "";

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});

		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve(output);
			} else {
				reject(new Error(`cli exited with code ${code}\n${output}`));
			}
		});

		child.stdin.end("8\n");
	});

	assert.match(stdout, /Approval App Manager/);
});

test("updateExistingInstall pauses the prompt while deploy.sh owns the terminal", async () => {
	const { updateExistingInstall } = await import("../../tools/manage.mjs");
	const paths = { scripts: { deploy: "/repo/scripts/deploy.sh" } };
	const events = [];

	await updateExistingInstall({
		paths,
		log: () => {},
		io: {
			pause: () => events.push("pause"),
			resume: () => events.push("resume"),
		},
		run: async () => events.push("run"),
	});

	assert.deepEqual(events, ["pause", "run", "resume"]);
});

test("updateExistingInstall resumes the prompt even when deploy.sh fails", async () => {
	const { updateExistingInstall } = await import("../../tools/manage.mjs");
	const events = [];

	await assert.rejects(
		updateExistingInstall({
			paths: { scripts: { deploy: "/repo/scripts/deploy.sh" } },
			log: () => {},
			io: {
				pause: () => events.push("pause"),
				resume: () => events.push("resume"),
			},
			run: async () => {
				events.push("run");
				throw new Error("deploy failed");
			},
		}),
		/deploy failed/,
	);

	assert.deepEqual(events, ["pause", "run", "resume"]);
});

test("rollback pauses the prompt while rollback.sh owns the terminal", async () => {
	const { rollback } = await import("../../tools/manage.mjs");
	const events = [];

	await rollback({
		paths: { scripts: { rollback: "/repo/scripts/rollback.sh" } },
		log: () => {},
		io: {
			pause: () => events.push("pause"),
			resume: () => events.push("resume"),
		},
		run: async () => events.push("run"),
	});

	assert.deepEqual(events, ["pause", "run", "resume"]);
});

test("createPrompt exposes pause and resume for interactive child scripts", async () => {
	const { createPrompt } = await import("../../tools/manage.mjs");
	const prompt = createPrompt();
	try {
		assert.equal(typeof prompt.pause, "function");
		assert.equal(typeof prompt.resume, "function");
	} finally {
		prompt.close();
	}
});

test("suspendTerminalInput restores canonical mode for interactive children", async () => {
	const { suspendTerminalInput, restoreTerminalInput } = await import(
		"../../tools/manage.mjs"
	);
	const calls = [];
	const fakeTty = {
		isTTY: true,
		isRaw: true,
		setRawMode(mode) {
			this.isRaw = mode;
			calls.push(`raw:${mode}`);
		},
		pause() {
			calls.push("pause");
		},
		resume() {
			calls.push("resume");
		},
	};

	const state = suspendTerminalInput(fakeTty);
	assert.deepEqual(calls, ["raw:false", "pause"]);
	assert.equal(fakeTty.isRaw, false);

	restoreTerminalInput(fakeTty, state);
	assert.deepEqual(calls, ["raw:false", "pause", "resume", "raw:true"]);
	assert.equal(fakeTty.isRaw, true);
});

test("suspendTerminalInput does not force raw mode on non-tty or non-raw stdin", async () => {
	const { suspendTerminalInput, restoreTerminalInput } = await import(
		"../../tools/manage.mjs"
	);
	const calls = [];
	const fakePipe = {
		isTTY: false,
		pause() {
			calls.push("pause");
		},
		resume() {
			calls.push("resume");
		},
	};

	const state = suspendTerminalInput(fakePipe);
	assert.deepEqual(calls, ["pause"]);

	restoreTerminalInput(fakePipe, state);
	assert.deepEqual(calls, ["pause", "resume"]);
});
