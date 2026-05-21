#!/usr/bin/env node

const { spawn } = require("child_process");
const https = require("https");
const { readFileSync, existsSync } = require("fs");
const { homedir } = require("os");
const { join } = require("path");

// ─── Config ────────────────────────────────────────────────────────────────
const CONFIG_PATH = join(homedir(), ".aitermrc.json");

function loadConfig() {
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function getApiKey() {
  const config = loadConfig();
  return (
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    config.OPENAI_API_KEY ||
    config.ANTHROPIC_API_KEY ||
    null
  );
}

function getProvider() {
  const config = loadConfig();
  if (process.env.ANTHROPIC_API_KEY || config.ANTHROPIC_API_KEY)
    return "anthropic";
  return "openai";
}

// ─── AI Request ────────────────────────────────────────────────────────────
function aiRequest(provider, apiKey, systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    let options, body;

    if (provider === "anthropic") {
      options = {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      };
      body = JSON.stringify({
        model: "claude-haiku-4-20250414",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });
    } else {
      options = {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      };
      body = JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      });
    }

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(json.error?.message || `HTTP ${res.statusCode}`));
            return;
          }
          const text =
            provider === "anthropic"
              ? json.content?.[0]?.text
              : json.choices?.[0]?.message?.content;
          resolve(text?.trim() || "");
        } catch (e) {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Prompts ───────────────────────────────────────────────────────────────
const EXPLAIN_SYSTEM = `You are a terminal expert. The user ran a command that produced output (possibly an error). Explain what happened concisely.

Rules:
- If it's an error: explain the cause, then give the fix command
- If it's normal output: briefly explain what it means
- Use bullet points for multiple issues
- Keep it SHORT — max 5 lines unless complex
- Include the fix command in a code block if applicable
- Don't repeat the error text back verbatim`;

const SUGGEST_SYSTEM = `You are a terminal command expert. The user describes what they want to do. Suggest the exact command(s).

Rules:
- Output the command(s) in a code block
- Add a ONE-LINE explanation after each command
- If multiple steps needed, number them
- Prefer standard tools (coreutils, git, etc.) over obscure ones
- Include common flags that help (e.g., -v for verbose)`;

const EXPLAIN_CMD_SYSTEM = `You are a terminal command explainer. Break down the given command into parts and explain what each does.

Rules:
- Explain each flag and argument
- Note any side effects or dangers
- If destructive, add a WARNING
- Keep explanations to one line per flag/part
- Use a table format: | Part | Meaning |`;

// ─── Commands ──────────────────────────────────────────────────────────────

// Run a command and explain errors
async function runCmd(cmdArgs) {
  const command = cmdArgs.join(" ");
  if (!command) {
    console.error("Usage: aiterm run <command>");
    process.exit(1);
  }

  const shell = process.env.SHELL || "/bin/bash";

  return new Promise((resolve) => {
    const child = spawn(shell, ["-c", command], {
      stdio: ["inherit", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", async (code) => {
      if (code !== 0 && (stderr || stdout)) {
        const apiKey = getApiKey();
        if (!apiKey) {
          console.error(
            "\n\x1b[2mSet OPENAI_API_KEY or ANTHROPIC_API_KEY for AI error explanations.\x1b[0m"
          );
          resolve();
          return;
        }

        const provider = getProvider();
        const output = stderr || stdout;

        console.log("\n\x1b[36m━━━ AI Explanation ━━━\x1b[0m");

        try {
          const explanation = await aiRequest(
            provider,
            apiKey,
            EXPLAIN_SYSTEM,
            `Command: ${command}\nExit code: ${code}\nOutput:\n${output.slice(0, 4000)}`
          );
          console.log(explanation);
          console.log("\x1b[36m━━━━━━━━━━━━━━━━━━━━━\x1b[0m");
        } catch (err) {
          console.error(`AI error: ${err.message}`);
        }
      }
      resolve();
    });
  });
}

// Explain piped input or last command output
async function explainCmd(args) {
  let input = "";

  // Check for piped input
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    input = Buffer.concat(chunks).toString().trim();
  } else if (args.length > 0) {
    input = args.join(" ");
  }

  if (!input) {
    console.error("Usage: aiterm explain <text>\n       some_command 2>&1 | aiterm explain");
    process.exit(1);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("No API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
    process.exit(1);
  }

  const provider = getProvider();
  process.stderr.write("\x1b[2mThinking...\x1b[0m\n");

  const explanation = await aiRequest(
    provider,
    apiKey,
    EXPLAIN_SYSTEM,
    `Terminal output to explain:\n${input.slice(0, 6000)}`
  );
  console.log(explanation);
}

// Suggest a command from natural language
async function suggestCmd(args) {
  const description = args.join(" ");
  if (!description) {
    console.error('Usage: aiterm suggest "find large files over 100MB"');
    process.exit(1);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("No API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
    process.exit(1);
  }

  const provider = getProvider();
  process.stderr.write("\x1b[2mThinking...\x1b[0m\n");

  const suggestion = await aiRequest(
    provider,
    apiKey,
    SUGGEST_SYSTEM,
    `OS: ${process.platform}\nShell: ${process.env.SHELL || "bash"}\nTask: ${description}`
  );
  console.log(suggestion);
}

// Explain what a command does
async function whatCmd(args) {
  const command = args.join(" ");
  if (!command) {
    console.error('Usage: aiterm what "find . -name *.log -mtime +30 -delete"');
    process.exit(1);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("No API key found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.");
    process.exit(1);
  }

  const provider = getProvider();
  process.stderr.write("\x1b[2mThinking...\x1b[0m\n");

  const explanation = await aiRequest(
    provider,
    apiKey,
    EXPLAIN_CMD_SYSTEM,
    `Explain this command: ${command}`
  );
  console.log(explanation);
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(`
  aiterm - AI-powered terminal assistant. Run commands, explain errors, suggest fixes.

  COMMANDS:
    aiterm run <command>        Run command, auto-explain errors with AI
    aiterm explain <text>       Explain terminal output or error
    aiterm suggest <task>       Get command suggestion from description
    aiterm what <command>       Explain what a command does

  PIPE MODE:
    some_command 2>&1 | aiterm explain
    cat error.log | aiterm explain

  EXAMPLES:
    aiterm run "npm install"                    # Run and auto-explain any errors
    aiterm explain "ECONNREFUSED 127.0.0.1:5432"  # Explain an error
    aiterm suggest "find files larger than 1GB"    # Get the command
    aiterm what "tar -xzvf archive.tar.gz"         # Explain a command

  SETUP:
    export OPENAI_API_KEY="sk-..."
    # or
    export ANTHROPIC_API_KEY="sk-ant-..."
`);
    process.exit(0);
  }

  try {
    switch (command) {
      case "run":
      case "r":
        await runCmd(args.slice(1));
        break;
      case "explain":
      case "e":
        await explainCmd(args.slice(1));
        break;
      case "suggest":
      case "s":
        await suggestCmd(args.slice(1));
        break;
      case "what":
      case "w":
        await whatCmd(args.slice(1));
        break;
      default:
        // If no subcommand, treat entire args as explain
        await explainCmd(args);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
