import { Global, Module } from '@nestjs/common';
import pg from 'pg';

@Global()
@Module({
  providers: [
    {
      provide: pg.Pool,
      useFactory: () =>
        new pg.Pool({
          connectionString:
            process.env.DATABASE_APP_URL ||
            'postgresql://devcore_app:devcore_app_password_dev@localhost:5433/devcore',
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        }),
    },
  ],
  exports: [pg.Pool],
})
export class DatabaseModule {}
