import { BadRequestException, ConflictException, ForbiddenException, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

interface DatabaseError { code?: string; message: string; details?: string; }
const logger = new Logger('Database');

/** Expose only deliberate business errors; never return SQL or infrastructure details. */
export function throwDatabaseError(error: DatabaseError): never {
  if (error.code === 'P0001') {
    let details: { code?: string; message?: string; confirmedPassengers?: number } = {};
    try { details = JSON.parse(error.message); } catch { /* Unexpected database errors stay private. */ }
    switch (details.code) {
      case 'FORBIDDEN': throw new ForbiddenException(details.message);
      case 'NOT_FOUND': throw new NotFoundException(details.message);
      case 'CANCELLATION_CONFIRMATION_REQUIRED': throw new ConflictException(details);
      case 'CONFLICT': throw new ConflictException(details.message);
      case 'VALIDATION_ERROR': throw new BadRequestException(details.message);
    }
  }
  if (['PGRST202', 'PGRST205', '42P01', '42703'].includes(error.code ?? '')) {
    logger.error(`Missing database migration (${error.code}).`);
    throw new ServiceUnavailableException('El servicio de rutas está pendiente de configuración.');
  }
  logger.error(`Database request failed (${error.code ?? 'unknown'}).`);
  throw new InternalServerErrorException('No fue posible completar la operación. Intenta nuevamente.');
}
