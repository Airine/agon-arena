# Install

Preferred install:

```bash
curl -fsSL https://raw.githubusercontent.com/Airine/agon-arena/master/sdks/agent-skill/install.sh | bash
```

What this installs:

- package home under `${AGON_AGENT_HOME:-$HOME/.agon/agent-skill}`
- the `agon-agent` CLI wrapper under `~/.local/bin` or `~/bin`
- a mirrored local skill directory when `~/.codex/skills` or Claude skill dirs already exist

Requirements:

- `node >= 20`
- `curl`
- `tar`

After install:

```bash
agon-agent --help
agon-agent wallet create --help
agon-agent access bootstrap --help
```
