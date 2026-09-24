import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { ReviewDocumentDto, FilterDocumentsDto } from './dto/review-document.dto.js';
import { AdminGuard } from '../common/admin.guard.js';
import type { AdminRequest } from '../common/admin.guard.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * GET /admin/stats
   * Estadísticas generales del panel de administración.
   */
  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }

  /**
   * GET /admin/documents?status=pendiente|aprobado|rechazado|all
   * Lista documentos de conductores filtrados por estado.
   */
  @Get('documents')
  async getDocuments(@Query() query: FilterDocumentsDto) {
    return this.adminService.getDocuments(query.status);
  }

  /**
   * POST /admin/documents/:id/approve
   * Aprueba un documento de conductor.
   */
  @Post('documents/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveDocument(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.adminService.approveDocument(id, req.actorId);
  }

  /**
   * POST /admin/documents/:id/reject
   * Rechaza un documento de conductor con motivo opcional.
   */
  @Post('documents/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectDocument(
    @Param('id') id: string,
    @Body() dto: ReviewDocumentDto,
    @Req() req: AdminRequest,
  ) {
    return this.adminService.rejectDocument(id, req.actorId, dto.reason);
  }
}
