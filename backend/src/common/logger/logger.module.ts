import { Module, Global } from '@nestjs/common';
import { StructuredLoggerService } from './logger.service';
import { RequestContextMiddleware } from './logger.middleware';

@Global()
@Module({
  providers: [StructuredLoggerService, RequestContextMiddleware],
  exports: [StructuredLoggerService, RequestContextMiddleware],
})
export class LoggerModule {}
