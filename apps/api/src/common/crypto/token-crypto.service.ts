import { Injectable, Logger } from '@nestjs/common';
import crypto from 'node:crypto';

/**
 * Envelope / authenticated encryption (AES-256-GCM) para tokens OAuth do Google Drive.
 * Os tokens nunca são armazenados em texto plano no PostgreSQL.
 */
@Injectable()
export class TokenCryptoService {
  private readonly logger = new Logger(TokenCryptoService.name);
  private readonly key: Buffer;

  constructor() {
    const rawKey = process.env.ENCRYPTION_MASTER_KEY?.trim();
    if (rawKey && /^[0-9a-fA-F]{64}$/.test(rawKey)) {
      this.key = Buffer.from(rawKey, 'hex');
    } else {
      if (!rawKey) {
        this.logger.warn(
          'ENCRYPTION_MASTER_KEY não definida; usando chave derivada de desenvolvimento. Configure uma chave hex de 64 caracteres em produção.',
        );
      }
      const seed = rawKey || 'devcore-local-dev-encryption-key-change-me';
      this.key = crypto.createHash('sha256').update(seed).digest();
    }
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    const [version, ivB64, tagB64, dataB64] = parts;
    if (parts.length !== 4 || version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('Formato de token criptografado inválido.');
    }
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(dataB64, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
