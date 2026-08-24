import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { StructuredLoggerService } from './common/logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const logger = app.get(StructuredLoggerService);

  app.useLogger(logger);

  const port = configService.get<number>('PORT') ?? 3001;
  const apiPrefix = configService.get<string>('API_PREFIX') ?? 'api/v1';
  const nodeEnv = configService.get<string>('NODE_ENV') ?? 'development';

  app.setGlobalPrefix(apiPrefix);

  app.enableCors({
    origin: configService.get<string>('CORS_ORIGIN') ?? true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('ValidFi API')
      .setDescription(
        'Decentralised identity verification and selective data-sharing API built on Stellar Soroban',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'jwt',
      )
      .addTag('auth', 'Wallet-based authentication')
      .addTag('identities', 'DID identity management')
      .addTag('verification', 'Credential verification')
      .addTag('access-control', 'Grantor/grantee access policies')
      .addTag('data-sharing', 'Encrypted document sharing')
      .addTag('indexer', 'On-chain event indexer status')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(port);
  logger.log(`API server started`, {
    port,
    apiPrefix: `http://localhost:${port}/${apiPrefix}`,
    environment: nodeEnv,
  });
  if (nodeEnv !== 'production') {
    logger.log(`Swagger docs available`, {
      docsUrl: `http://localhost:${port}/docs`,
    });
  }
}

bootstrap();
