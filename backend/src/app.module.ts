import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { redisStore } from 'cache-manager-redis-store';
import { IdentityModule } from './identity/identity.module';
import { VerificationModule } from './verification/verification.module';
import { AccessControlModule } from './access-control/access-control.module';
import { DataSharingModule } from './data-sharing/data-sharing.module';
import { AuthModule } from './auth/auth.module';
import { IpfsModule } from './ipfs/ipfs.module';
import { AiModule } from './ai/ai.module';
import { SorobanModule } from './soroban/soroban.module';
import { IndexerModule } from './indexer/indexer.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './audit/audit.module';
import { BackupModule } from './backup/backup.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { PermissionsModule } from './permissions/permissions.module';
import { CredentialVersioningModule } from './credential-versioning/credential-versioning.module';
import { CredentialsModule } from './credentials/credentials.module';
import { CredentialEventsModule } from './credentials/credential-events.module';
import { HealthAuthorityModule } from './health-authority/health-authority.module';
import { CredentialSharingHistoryModule } from './credential-sharing-history/credential-sharing-history.module';
import { CredentialExportModule } from './credential-export/credential-export.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: configService.get('NODE_ENV') === 'development',
        logging: configService.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get<number>('THROTTLE_TTL') ?? 60000,
          limit: configService.get<number>('THROTTLE_LIMIT') ?? 60,
        },
      ],
      inject: [ConfigService],
    }),
    CacheModule.registerAsync({
      imports: [ConfigModule],
      // @ts-ignore
      useFactory: (configService: ConfigService) => ({
        store: redisStore,
        host: configService.get('REDIS_HOST'),
        port: configService.get('REDIS_PORT'),
        password: configService.get('REDIS_PASSWORD'),
        ttl: 3600,
      }),
      inject: [ConfigService],
    }),
    IdentityModule,
    VerificationModule,
    AccessControlModule,
    DataSharingModule,
    AuthModule,
    IpfsModule,
    AiModule,
    SorobanModule,
    IndexerModule,
    HealthModule,
    AuditModule,
    BackupModule,
    AnalyticsModule,
    PermissionsModule,
    CredentialVersioningModule,
    CredentialsModule,
    CredentialEventsModule,
    HealthAuthorityModule,
    CredentialSharingHistoryModule,
    CredentialExportModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
