var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SupabaseService_1;
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
let SupabaseService = SupabaseService_1 = class SupabaseService {
    configService;
    logger = new Logger(SupabaseService_1.name);
    client = null;
    isProperlyConfigured = false;
    constructor(configService) {
        this.configService = configService;
        const url = this.configService.get('SUPABASE_URL') || process.env.SUPABASE_URL;
        const serviceRoleKey = this.configService.get('SUPABASE_SERVICE_ROLE_KEY') || process.env.SUPABASE_SERVICE_ROLE_KEY;
        const anonKey = this.configService.get('SUPABASE_ANON_KEY') || process.env.SUPABASE_ANON_KEY;
        const key = serviceRoleKey || anonKey;
        if (url &&
            key &&
            !url.includes('your-project') &&
            !url.includes('tu-proyecto') &&
            !key.includes('your-') &&
            !key.includes('tu-')) {
            this.client = createClient(url, key, {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false,
                },
            });
            this.isProperlyConfigured = true;
            this.logger.log(`Cliente de Supabase inicializado correctamente para: ${url}`);
        }
        else {
            this.logger.warn('Supabase no está configurado o contiene valores de ejemplo en el archivo .env. ' +
                'Por favor ingresa tu SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY.');
        }
    }
    getClient() {
        if (!this.client || !this.isProperlyConfigured) {
            throw new Error('Supabase no está configurado. Por favor configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (o SUPABASE_ANON_KEY) en server/.env');
        }
        return this.client;
    }
    isConfigured() {
        return this.isProperlyConfigured;
    }
};
SupabaseService = SupabaseService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService])
], SupabaseService);
export { SupabaseService };
//# sourceMappingURL=supabase.service.js.map