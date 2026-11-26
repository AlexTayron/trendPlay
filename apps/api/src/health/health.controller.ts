import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import pg from 'pg';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly pgPool: pg.Pool) {}

  @Get()
  async check() {
    try {
      await this.pgPool.query('SELECT 1');
      return { status: 'ok', service: 'api', database: 'ok' };
    } catch (error) {
      const details =
        error instanceof AggregateError
          ? error.errors
              .map((item) => (item instanceof Error ? item.message : String(item)))
              .join(' | ')
          : error instanceof Error
            ? error.message
            : String(error);
      this.logger.error(
        `Health check do PostgreSQL falhou: ${details}`,
      );
      throw new ServiceUnavailableException({
        status: 'degraded',
        service: 'api',
        database: 'unavailable',
      });
    }
  }
}
