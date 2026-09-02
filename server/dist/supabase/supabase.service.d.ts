import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
export declare class SupabaseService {
    private readonly configService;
    private readonly logger;
    private client;
    private isProperlyConfigured;
    constructor(configService: ConfigService);
    getClient(): SupabaseClient;
    isConfigured(): boolean;
}
