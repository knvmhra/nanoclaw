---
name: add-push-to-talk
description: Add a voice channel for push-to-talk interaction. Accepts transcript text via HTTP and returns agent responses. Works with the voice-bridge server for STT/TTS.
---

# Add Push-to-Talk Voice Channel

Adds a voice channel to NanoClaw that accepts text via HTTP and returns agent responses. Designed to work with a voice bridge server that handles speech-to-text and text-to-speech externally.

No authentication, no SDK — just a localhost HTTP endpoint.

## Phase 1: Pre-flight

Check if `src/channels/voice.ts` already exists. If it does, skip to Phase 3 (Configure).

## Phase 2: Apply Code Changes

### Copy the channel implementation

```bash
cp "${CLAUDE_SKILL_DIR}/voice.ts" src/channels/voice.ts
```

### Register in the barrel file

Append the voice import to `src/channels/index.ts`:

```typescript
import './voice.js';
```

Add it after the existing channel imports, with a `// voice` comment matching the pattern of other channels.

### Build and verify

```bash
npm run build
```

Build must succeed before proceeding.

## Phase 3: Configure

### Enable the voice channel

Add to `.env`:

```
VOICE_ENABLED=true
```

Optionally, set a custom port (default is 3002):

```
VOICE_PORT=3002
```

### Sync environment to container

```bash
mkdir -p data/env && cp .env data/env/env
```

## Phase 4: Register Group

```bash
npx tsx setup/index.ts --step register \
  --jid "voice:main" \
  --name "Voice" \
  --folder "voice_main" \
  --trigger "@Andy" \
  --channel voice \
  --is-main \
  --no-trigger-required
```

## Phase 5: Verify

### Build and restart

```bash
npm run build
```

Restart the service:

```bash
# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux (systemd)
systemctl --user restart nanoclaw

# Or run directly
npm run dev
```

### Test the endpoint

```bash
curl -s -X POST http://localhost:3002/message \
  -H 'Content-Type: application/json' \
  -d '{"text": "hello"}'
```

Should return a JSON response with the agent's reply: `{"text": "..."}`.

### Connect the voice bridge

Tell the user:

> The voice channel is ready. To connect your voice bridge, set this environment variable in the voice bridge's shell:
>
> ```bash
> export NANOCLAW_URL=http://localhost:3002/message
> ```
>
> Then restart the voice bridge server.

## Troubleshooting

### Channel not starting

1. Check `VOICE_ENABLED=true` is in `.env`
2. Check port 3002 is not in use: `lsof -i :3002`
3. Check logs: `tail -f logs/nanoclaw.log | grep -i voice`

### No response from endpoint

1. Verify the voice group is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid = 'voice:main'"`
2. Check that nanoclaw is running and the message loop is active
3. The first request may take 10-15s (container cold start). Subsequent requests within 30min are faster.

## Removal

1. Delete `src/channels/voice.ts`
2. Remove `import './voice.js'` from `src/channels/index.ts`
3. Remove `VOICE_ENABLED` and `VOICE_PORT` from `.env`
4. Remove voice group: `sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'voice:%'"`
5. Rebuild and restart: `npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS) or `npm run build && systemctl --user restart nanoclaw` (Linux)
