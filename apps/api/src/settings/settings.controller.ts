import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { addApiKeySchema, type AddApiKeyDto } from '@reader/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SettingsService } from './settings.service';

@UseGuards(JwtAuthGuard)
@Controller('settings/api-keys')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Masked list of the user's configured keys (may be several per provider). */
  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.settings.listKeys(user.id);
  }

  /** Add a new key for a provider. A provider may hold multiple keys (rotated). */
  @Post()
  add(
    @CurrentUser() user: JwtUser,
    @Body(new ZodValidationPipe(addApiKeySchema)) dto: AddApiKeyDto,
  ) {
    return this.settings.addKey(user.id, dto);
  }

  /** Remove a single key by id. */
  @Delete(':id')
  async remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    await this.settings.deleteKey(user.id, id);
    return { ok: true };
  }
}
