import { ValidationPipe, type INestApplication } from '@nestjs/common';

/** Shared HTTP configuration for the server and integration tests. */
export function configureApp(app: INestApplication): void {
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',').map(origin => origin.trim()).filter(Boolean);
  app.enableCors({ origin: origins, methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS' });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // A JSON string such as "false" must never become boolean true.
    transformOptions: { enableImplicitConversion: false },
  }));
  app.enableShutdownHooks();
}
