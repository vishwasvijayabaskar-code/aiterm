# aiterm 🤖

> AI-powered terminal assistant. Run commands, auto-explain errors, suggest fixes. Zero dependencies.

```bash
$ aiterm run "docker compose up"
# ... error output ...
#
# ━━━ AI Explanation ━━━
# The Docker daemon isn't running. Start it with:
#
#   sudo systemctl start docker
#
# Or on macOS, open Docker Desktop.
# ━━━━━━━━━━━━━━━━━━━━━
```

## Install

```bash
npm install -g aiterm

# Or clone and link
git clone https://github.com/vishwasvijayabaskar-code/aiterm.git
cd aiterm && npm link
```

## Setup

```bash
export OPENAI_API_KEY="sk-..."
# or
export ANTHROPIC_API_KEY="sk-ant-..."
```

## Commands

### `aiterm run` — Run command, auto-explain errors

```bash
aiterm run "npm install"
# Runs the command normally. If it fails, AI explains why and how to fix it.

aiterm run "python train.py"
# CUDA out of memory? AI tells you to reduce batch size.

aiterm run "git push origin main"
# Rejected? AI explains you need to pull first.
```

### `aiterm explain` — Explain any output

```bash
# Direct text
aiterm explain "ECONNREFUSED 127.0.0.1:5432"
# → PostgreSQL isn't running on port 5432. Start it with:
#   brew services start postgresql

# Pipe mode
cat crash.log | aiterm explain
npm test 2>&1 | aiterm explain
kubectl logs pod-xyz | aiterm explain
```

### `aiterm suggest` — Describe what you want, get the command

```bash
aiterm suggest "find all Python files modified in the last week"
# → find . -name "*.py" -mtime -7

aiterm suggest "compress this folder but exclude node_modules"
# → tar -czf archive.tar.gz --exclude='node_modules' .

aiterm suggest "kill whatever is using port 3000"
# → lsof -ti:3000 | xargs kill -9
```

### `aiterm what` — Explain what a command does

```bash
aiterm what "find . -name '*.log' -mtime +30 -delete"
# | Part           | Meaning                              |
# |----------------|--------------------------------------|
# | find .         | Search from current directory         |
# | -name '*.log'  | Match files ending in .log           |
# | -mtime +30     | Modified more than 30 days ago       |
# | -delete        | ⚠️ DELETE matching files              |
# WARNING: This permanently deletes files. Test with -print first.
```

## Features

- **Auto-explain** — wraps any command, explains errors when they happen
- **Pipe-friendly** — `command 2>&1 | aiterm explain`
- **Command suggestions** — describe tasks in plain English
- **Command breakdown** — understand complex commands flag by flag
- **Zero dependencies** — just Node.js 18+
- **Multi-provider** — OpenAI or Anthropic, auto-detected

## License

MIT
