import { ChildProcess, spawn } from "child_process";
import { EventEmitter } from "events";

/**
 * Base interface for MCP transport mechanisms
 */
export interface MCPTransport extends EventEmitter {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	send(message: any): Promise<void>;
	isConnected(): boolean;
}

/**
 * Transport implementation for MCP servers communicating via stdio
 */
export class StdioTransport extends EventEmitter implements MCPTransport {
	private process: ChildProcess | null = null;
	private connected = false;
	private messageBuffer = "";

	constructor(
		private command: string,
		private args: string[] = [],
		private env: Record<string, string> = {}
	) {
		super();
	}

	async connect(): Promise<void> {
		if (this.connected) {
			throw new Error("Transport already connected");
		}

		try {
			// Spawn the MCP server process
			this.process = spawn(this.command, this.args, {
				env: { ...process.env, ...this.env },
				stdio: ["pipe", "pipe", "pipe"],
			});

			// Handle process events
			this.process.on("error", (error) => {
				this.emit("error", error);
			});

			this.process.on("exit", (code, signal) => {
				this.connected = false;
				this.emit("disconnect", { code, signal });
			});

			// Handle stdout messages
			this.process.stdout?.on("data", (data) => {
				this.handleIncomingData(data.toString());
			});

			// Handle stderr for debugging
			this.process.stderr?.on("data", (data) => {
				this.emit("stderr", data.toString());
			});

			// Wait a bit for the process to start
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error("Connection timeout"));
				}, 5000);

				this.process?.on("spawn", () => {
					clearTimeout(timeout);
					this.connected = true;
					resolve(void 0);
				});

				this.process?.on("error", (error) => {
					clearTimeout(timeout);
					reject(error);
				});
			});

			this.emit("connect");
		} catch (error) {
			this.connected = false;
			throw error;
		}
	}

	async disconnect(): Promise<void> {
		if (!this.connected || !this.process) {
			return;
		}

		return new Promise((resolve) => {
			const cleanup = () => {
				this.connected = false;
				this.process = null;
				this.emit("disconnect");
				resolve();
			};

			// Try graceful shutdown first
			if (this.process) {
				this.process.kill("SIGTERM");

				const timeout = setTimeout(() => {
					// Force kill if graceful shutdown fails
					this.process?.kill("SIGKILL");
					cleanup();
				}, 3000);

				this.process.on("exit", () => {
					clearTimeout(timeout);
					cleanup();
				});
			} else {
				cleanup();
			}
		});
	}

	async send(message: any): Promise<void> {
		if (!this.connected || !this.process?.stdin) {
			throw new Error("Transport not connected");
		}

		const messageStr = JSON.stringify(message) + "\n";

		return new Promise((resolve, reject) => {
			this.process!.stdin!.write(messageStr, (error) => {
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			});
		});
	}

	isConnected(): boolean {
		return this.connected;
	}

	private handleIncomingData(data: string): void {
		this.messageBuffer += data;

		// Process complete messages (newline-delimited JSON)
		const lines = this.messageBuffer.split("\n");
		this.messageBuffer = lines.pop() || ""; // Keep incomplete line in buffer

		for (const line of lines) {
			if (line.trim()) {
				try {
					const message = JSON.parse(line);
					this.emit("message", message);
				} catch (error) {
					this.emit(
						"error",
						new Error(`Failed to parse message: ${line}`)
					);
				}
			}
		}
	}
}

/**
 * Transport implementation for MCP servers communicating via WebSocket
 */
export class WebSocketTransport extends EventEmitter implements MCPTransport {
	private ws: WebSocket | null = null;
	private connected = false;

	constructor(private url: string) {
		super();
	}

	async connect(): Promise<void> {
		if (this.connected) {
			throw new Error("Transport already connected");
		}

		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(this.url);

				this.ws.onopen = () => {
					this.connected = true;
					this.emit("connect");
					resolve();
				};

				this.ws.onmessage = (event) => {
					try {
						const message = JSON.parse(event.data);
						this.emit("message", message);
					} catch (error) {
						this.emit(
							"error",
							new Error(
								`Failed to parse WebSocket message: ${event.data}`
							)
						);
					}
				};

				this.ws.onclose = () => {
					this.connected = false;
					this.emit("disconnect");
				};

				this.ws.onerror = (error) => {
					this.emit("error", error);
					reject(error);
				};
			} catch (error) {
				reject(error);
			}
		});
	}

	async disconnect(): Promise<void> {
		if (this.ws && this.connected) {
			this.ws.close();
			this.connected = false;
		}
	}

	async send(message: any): Promise<void> {
		if (!this.connected || !this.ws) {
			throw new Error("Transport not connected");
		}

		this.ws.send(JSON.stringify(message));
	}

	isConnected(): boolean {
		return this.connected;
	}
}
