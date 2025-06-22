#!/usr/bin/env node

/**
 * Simple test script to verify MCP client implementation
 * This runs outside the Obsidian environment to test basic functionality
 */

const { spawn } = require("child_process");
const { EventEmitter } = require("events");

// Simple MCP client implementation for testing
class TestMCPClient extends EventEmitter {
	constructor(command, args = []) {
		super();
		this.command = command;
		this.args = args;
		this.process = null;
		this.connected = false;
		this.requestId = 0;
		this.pendingRequests = new Map();
		this.messageBuffer = "";
	}

	async connect() {
		console.log(
			`🚀 Starting MCP server: ${this.command} ${this.args.join(" ")}`
		);

		this.process = spawn(this.command, this.args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.process.on("error", (error) => {
			console.error("❌ Process error:", error.message);
			this.emit("error", error);
		});

		this.process.on("exit", (code, signal) => {
			console.log(
				`📤 Process exited with code ${code}, signal ${signal}`
			);
			this.connected = false;
		});

		this.process.stdout.on("data", (data) => {
			this.handleIncomingData(data.toString());
		});

		this.process.stderr.on("data", (data) => {
			console.log("📝 Server stderr:", data.toString().trim());
		});

		// Wait for process to start
		await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Connection timeout"));
			}, 10000);

			this.process.on("spawn", () => {
				clearTimeout(timeout);
				this.connected = true;
				console.log("✅ Process spawned successfully");
				resolve();
			});

			this.process.on("error", (error) => {
				clearTimeout(timeout);
				reject(error);
			});
		});

		// Initialize MCP session
		console.log("🔧 Initializing MCP session...");
		const initResult = await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: { tools: {} },
			clientInfo: { name: "test-client", version: "1.0.0" },
		});

		console.log(
			"✅ MCP session initialized:",
			JSON.stringify(initResult, null, 2)
		);

		// Send initialized notification
		await this.notify("initialized", {});
		console.log("✅ Initialization complete");
	}

	async request(method, params) {
		const id = ++this.requestId;
		const message = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		};

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request timeout: ${method}`));
			}, 30000);

			this.pendingRequests.set(id, { resolve, reject, timeout });

			const messageStr = JSON.stringify(message) + "\n";
			this.process.stdin.write(messageStr, (error) => {
				if (error) {
					this.pendingRequests.delete(id);
					clearTimeout(timeout);
					reject(error);
				}
			});
		});
	}

	async notify(method, params) {
		const message = {
			jsonrpc: "2.0",
			method,
			params,
		};

		const messageStr = JSON.stringify(message) + "\n";
		return new Promise((resolve, reject) => {
			this.process.stdin.write(messageStr, (error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}

	handleIncomingData(data) {
		this.messageBuffer += data;

		const lines = this.messageBuffer.split("\n");
		this.messageBuffer = lines.pop() || "";

		for (const line of lines) {
			if (line.trim()) {
				try {
					const message = JSON.parse(line);
					console.log(
						"📨 Received message:",
						JSON.stringify(message, null, 2)
					);
					this.handleMessage(message);
				} catch (error) {
					console.error("❌ Failed to parse message:", line);
				}
			}
		}
	}

	handleMessage(message) {
		if ("id" in message) {
			// Response to a request
			const pending = this.pendingRequests.get(message.id);
			if (pending) {
				this.pendingRequests.delete(message.id);
				clearTimeout(pending.timeout);

				if (message.error) {
					pending.reject(new Error(message.error.message));
				} else {
					pending.resolve(message.result);
				}
			}
		}
	}

	async disconnect() {
		if (this.process) {
			this.process.kill("SIGTERM");
			this.connected = false;
		}
	}
}

async function runTest() {
	console.log("🧪 Starting MCP Client Test");

	const client = new TestMCPClient("npx", [
		"@modelcontextprotocol/server-everything",
	]);

	try {
		await client.connect();

		// Test tool listing
		console.log("🔧 Testing tool discovery...");
		const tools = await client.request("tools/list");
		console.log(`✅ Discovered ${tools.tools?.length || 0} tools:`);
		if (tools.tools) {
			tools.tools.forEach((tool) => {
				console.log(`  - ${tool.name}: ${tool.description}`);
			});
		}

		console.log("🎉 Test completed successfully!");
	} catch (error) {
		console.error("❌ Test failed:", error.message);
		process.exit(1);
	} finally {
		await client.disconnect();
		process.exit(0);
	}
}

runTest();
