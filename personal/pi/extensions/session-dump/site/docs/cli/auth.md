# quick auth

Authenticate with Google OAuth. Required before using `quick mcp`.

## Usage

```bash
quick auth
```

## What It Does

1. Opens your browser for Google OAuth flow
2. Exchanges the authorization code for tokens
3. Saves credentials to `~/.config/quick/credentials.json`

## When You Need This

- Before running `quick mcp <site>` for the first time
- If your cached credentials have expired

## Credentials

Stored at `~/.config/quick/credentials.json`. These are used by `quick mcp` to generate IAP tokens for authenticating with Quick's API.
