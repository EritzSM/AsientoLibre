import {
  Controller,
  Delete,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { ReviewDocumentDto, FilterDocumentsDto } from './dto/review-document.dto.js';
import { AdminGuard } from '../common/admin.guard.js';
import type { AdminRequest } from '../common/admin.guard.js';
import { CreatePromotionDto } from './dto/promotion.dto.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** GET /admin/stats */
  @Get('stats')
  async getStats() {
    return this.adminService.getStats();
  }

  /** GET /admin/documents?status=... */
  @Get('documents')
  async getDocuments(@Query() query: FilterDocumentsDto) {
    return this.adminService.getDocuments(query.status);
  }

  /** POST /admin/documents/:id/approve */
  @Post('documents/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveDocument(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.adminService.approveDocument(id, req.actorId);
  }

  /** POST /admin/documents/:id/reject */
  @Post('documents/:id/reject')
  @HttpCode(HttpStatus.OK)
  async rejectDocument(
    @Param('id') id: string,
    @Body() dto: ReviewDocumentDto,
    @Req() req: AdminRequest,
  ) {
    return this.adminService.rejectDocument(id, req.actorId, dto.reason);
  }

  /** POST /admin/documents/:id/manual-review */
  @Post('documents/:id/manual-review')
  @HttpCode(HttpStatus.OK)
  async markForManualReview(
    @Param('id') id: string,
    @Body() dto: ReviewDocumentDto,
    @Req() req: AdminRequest,
  ) {
    return this.adminService.markForManualReview(id, req.actorId, dto.reason);
  }

  /** POST /admin/documents/:id/ai-review */
  @Post('documents/:id/ai-review')
  @HttpCode(HttpStatus.OK)
  async aiReview(@Param('id') id: string, @Req() req: AdminRequest) {
    return this.adminService.analyzeDocumentWithAi(id, req.actorId);
  }

  @Get('promotions')
  async getPromotions() {
    return this.adminService.getPromotions();
  }

  @Post('promotions')
  @HttpCode(HttpStatus.CREATED)
  async createPromotion(@Body() dto: CreatePromotionDto, @Req() req: AdminRequest) {
    return this.adminService.createPromotion(dto, req.actorId);
  }

  @Put('promotions/:id')
  async updatePromotion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreatePromotionDto,
  ) {
    return this.adminService.updatePromotion(id, dto);
  }

  @Delete('promotions/:id')
  @HttpCode(HttpStatus.OK)
  async deletePromotion(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.adminService.deletePromotion(id);
  }

  /** GET /admin/users */
  @Get('users')
  async getUsers(
    @Query('search') search?: string,
    @Query('role') role?: string,
  ) {
    return this.adminService.getUsers(search, role);
  }

  /** POST /admin/users/:id/block */
  @Post('users/:id/block')
  @HttpCode(HttpStatus.OK)
  async blockUser(
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return this.adminService.blockUser(id, reason);
  }

  /** POST /admin/users/:id/unblock */
  @Post('users/:id/unblock')
  @HttpCode(HttpStatus.OK)
  async unblockUser(@Param('id') id: string) {
    return this.adminService.unblockUser(id);
  }

  /** GET /admin/appeals */
  @Get('appeals')
  async getAppeals() {
    return this.adminService.getAppeals();
  }

  /** POST /admin/appeals/:id/resolve */
  @Post('appeals/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolveAppeal(
    @Param('id') id: string,
    @Body('action') action: 'approve' | 'reject',
    @Body('note') note: string,
    @Req() req: AdminRequest,
  ) {
    return this.adminService.resolveAppeal(id, action, note, req.actorId);
  }
}
