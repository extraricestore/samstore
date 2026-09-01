// NestJS bootstrap — thin HTTP layer over the domain services.
// In-memory repositories are wired here until DATABASE_URL is provided by the operator.

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

const PORT = Number(process.env.PORT ?? 4000);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: false,
  });
  await app.listen(PORT);
  console.log(`[sam-store] API listening on http://localhost:${PORT}`);
}

void bootstrap();