import http from 'http';

import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { Channel } from '../types.js';
import { registerChannel, ChannelOpts } from './registry.js';

const envConfig = readEnvFile(['VOICE_ENABLED', 'VOICE_PORT']);
const VOICE_PORT = parseInt(
  process.env.VOICE_PORT || envConfig.VOICE_PORT || '3002',
  10,
);
const VOICE_JID = 'voice:main';
const REQUEST_TIMEOUT = 120_000;

interface PendingRequest {
  resolve: (text: string) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class VoiceChannel implements Channel {
  name = 'voice';

  private server!: http.Server;
  private connected = false;
  private opts: ChannelOpts;
  private pending: PendingRequest | null = null;

  constructor(opts: ChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) =>
        this.handleRequest(req, res),
      );
      this.server.listen(VOICE_PORT, () => {
        this.connected = true;
        this.opts.onChatMetadata(VOICE_JID, new Date().toISOString(), 'Voice', 'voice', false);
        logger.info({ port: VOICE_PORT }, 'Voice channel listening');
        resolve();
      });
    });
  }

  async sendMessage(_jid: string, text: string): Promise<void> {
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending.resolve(text);
      this.pending = null;
    } else {
      logger.debug('Voice sendMessage called with no pending request, ignoring');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('voice:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.server?.close();
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== '/message') {
      res.writeHead(404);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      let text: string;
      try {
        const parsed = JSON.parse(body);
        text = parsed.text;
        if (!text) throw new Error('Missing text field');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request — expected {"text": "..."}' }));
        return;
      }

      const id = `voice-${Date.now()}`;
      const timestamp = new Date().toISOString();

      logger.info({ id, length: text.length }, 'Voice message received');

      // Create promise that sendMessage() will resolve
      const responsePromise = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pending = null;
          reject(new Error('Timeout waiting for agent response'));
        }, REQUEST_TIMEOUT);
        this.pending = { resolve, timeout };
      });

      // Inject message into nanoclaw pipeline
      this.opts.onMessage(VOICE_JID, {
        id,
        chat_jid: VOICE_JID,
        sender: 'voice-user',
        sender_name: 'User',
        content: text,
        timestamp,
        is_from_me: true,
      });

      responsePromise
        .then((responseText) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ text: responseText }));
        })
        .catch((err) => {
          logger.error({ err }, 'Voice request failed');
          res.writeHead(504, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        });
    });
  }
}

registerChannel('voice', (opts: ChannelOpts) => {
  const enabled =
    process.env.VOICE_ENABLED || envConfig.VOICE_ENABLED;
  if (!enabled) return null;
  return new VoiceChannel(opts);
});
