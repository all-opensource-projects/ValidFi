import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StructuredLoggerService } from './logger.service';

describe('StructuredLoggerService', () => {
  let service: StructuredLoggerService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredLoggerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'LOG_LEVEL') return 'info';
              if (key === 'NODE_ENV') return 'test';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StructuredLoggerService>(StructuredLoggerService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should log info messages', () => {
    const spy = jest.spyOn(service.getPino(), 'info');
    service.log('Test message', { requestId: '123' });
    expect(spy).toHaveBeenCalledWith({ requestId: '123' }, 'Test message');
  });

  it('should log error messages with trace', () => {
    const spy = jest.spyOn(service.getPino(), 'error');
    service.error('Error message', 'stack trace', { requestId: '123' });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: '123' }),
      'Error message',
    );
  });

  it('should log warning messages', () => {
    const spy = jest.spyOn(service.getPino(), 'warn');
    service.warn('Warning message', { userId: 'user-1' });
    expect(spy).toHaveBeenCalledWith({ userId: 'user-1' }, 'Warning message');
  });

  it('should log debug messages', () => {
    const spy = jest.spyOn(service.getPino(), 'debug');
    service.debug('Debug message');
    expect(spy).toHaveBeenCalledWith({}, 'Debug message');
  });

  it('should create child logger with context', () => {
    const child = service.child({ requestId: 'req-123', userId: 'user-456' });
    expect(child).toBeDefined();
    expect(child).toBeInstanceOf(StructuredLoggerService);
  });

  it('should return pino instance', () => {
    const pino = service.getPino();
    expect(pino).toBeDefined();
    expect(typeof pino.info).toBe('function');
  });
});
