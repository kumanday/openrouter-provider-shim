import type { ShimConfig } from "../config.js";

export interface LogEntry {
  level: "error" | "info" | "debug";
  timestamp: string;
  message: string;
  [key: string]: unknown;
}

export interface Logger {
  info(obj: Record<string, unknown>, message: string): void;
  error(obj: Record<string, unknown>, message: string): void;
  debug(obj: Record<string, unknown>, message: string): void;
}

class ConsoleLogger implements Logger {
  private level: string;

  constructor(config: ShimConfig) {
    this.level = config.log_level;
  }

  private shouldLog(level: string): boolean {
    const levels = ["silent", "error", "info", "debug"];
    const configIndex = levels.indexOf(this.level);
    const logIndex = levels.indexOf(level);
    return configIndex >= 0 && logIndex >= 0 && logIndex <= configIndex;
  }

  private log(level: "error" | "info" | "debug", obj: Record<string, unknown>, message: string): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message,
      ...obj,
    };

    const output = JSON.stringify(entry);
    if (level === "error") {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  info(obj: Record<string, unknown>, message: string): void {
    this.log("info", obj, message);
  }

  error(obj: Record<string, unknown>, message: string): void {
    this.log("error", obj, message);
  }

  debug(obj: Record<string, unknown>, message: string): void {
    this.log("debug", obj, message);
  }
}

export function makeLogger(config: ShimConfig): Logger {
  return new ConsoleLogger(config);
}
