import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private apiKey: string | null = null;
  private senderEmail: string;
  private senderName: string;
  private frontendUrl: string;
  private backendUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.senderEmail =
      this.configService.get<string>('BREVO_SENDER_EMAIL') ||
      process.env.BREVO_SENDER_EMAIL ||
      '';

    this.senderName =
      this.configService.get<string>('BREVO_SENDER_NAME') ||
      process.env.BREVO_SENDER_NAME ||
      'Asiento Libre';

    this.frontendUrl = (
      this.configService.get<string>('FRONTEND_URL') ||
      process.env.FRONTEND_URL ||
      'http://localhost:5173'
    ).replace(/\/$/, '');

    this.backendUrl = (
      this.configService.get<string>('BACKEND_URL') ||
      process.env.BACKEND_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  /**
   * Obtiene la API Key actual de Brevo
   */
  private getApiKey(): string | null {
    const key =
      this.configService.get<string>('BREVO_API_KEY') ||
      process.env.BREVO_API_KEY ||
      this.apiKey;

    if (
      key &&
      key.trim() !== '' &&
      key !== 'xkeysib-tu_api_key_aqui' &&
      !key.startsWith('your_')
    ) {
      return key.trim();
    }
    return null;
  }

  /**
   * Envía el correo de activación con el enlace de verificación usando Brevo API v3
   */
  async sendActivationEmail(
    toEmail: string,
    firstName: string,
    token: string,
  ): Promise<{ success: boolean; messageId?: string }> {
    const verificationUrl = `${this.backendUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
    const safeFirstName = escapeHtml(firstName || 'viajero/a');
    const safeVerificationUrl = escapeHtml(verificationUrl);
    const currentApiKey = this.getApiKey();
    const currentSenderEmail =
      this.configService.get<string>('BREVO_SENDER_EMAIL') ||
      process.env.BREVO_SENDER_EMAIL ||
      this.senderEmail;
    const currentSenderName =
      this.configService.get<string>('BREVO_SENDER_NAME') ||
      process.env.BREVO_SENDER_NAME ||
      this.senderName;

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verifica tu cuenta — Asiento Libre</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #F4F7FB;
      margin: 0;
      padding: 0;
      color: #1E293B;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #F4F7FB;
      padding: 40px 15px;
    }
    .email-container {
      max-width: 580px;
      margin: 0 auto;
      background: #FFFFFF;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(11, 30, 59, 0.08);
      border: 1px solid #E2E8F0;
    }
    .header {
      background: linear-gradient(135deg, #0B1E3B 0%, #15325E 100%);
      padding: 32px 30px;
      text-align: center;
    }
    .header h1 {
      color: #FFFFFF;
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .header .accent {
      color: #17BFAC;
    }
    .content {
      padding: 36px 32px 30px 32px;
    }
    .content h2 {
      color: #0B1E3B;
      font-size: 20px;
      margin-top: 0;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .content p {
      font-size: 15px;
      line-height: 1.6;
      color: #475569;
      margin-bottom: 24px;
    }
    .btn-container {
      text-align: center;
      margin: 32px 0;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #17BFAC 0%, #109D8D 100%);
      color: #FFFFFF !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 16px;
      padding: 14px 34px;
      border-radius: 10px;
      box-shadow: 0 4px 14px rgba(23, 191, 172, 0.35);
    }
    .info-box {
      background: #F8FAFC;
      border-left: 4px solid #17BFAC;
      padding: 14px 16px;
      border-radius: 6px;
      font-size: 13.5px;
      color: #64748B;
      margin-bottom: 24px;
    }
    .footer {
      background-color: #F8FAFC;
      border-top: 1px solid #E2E8F0;
      padding: 24px 32px;
      text-align: center;
      font-size: 12.5px;
      color: #94A3B8;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="email-container">
      <div class="header">
        <h1>Asiento <span class="accent">Libre</span> 🚗</h1>
      </div>
      <div class="content">
        <h2>¡Hola, ${safeFirstName}! 👋</h2>
        <p>Gracias por unirte a <strong>Asiento Libre</strong>, la comunidad para compartir viajes y moverte de forma más económica, segura y sostenible.</p>
        <p>Para activar tu cuenta y comenzar a publicar rutas o reservar asientos, por favor confirma tu dirección de correo haciendo clic en el siguiente botón:</p>

        <div class="btn-container">
          <a href="${safeVerificationUrl}" class="btn" target="_blank">Verificar mi correo electrónico</a>
        </div>

        <div class="info-box">
          ⏱️ <strong>Importante:</strong> Este enlace de activación es válido durante las próximas <strong>24 horas</strong>. Si no creaste una cuenta en Asiento Libre, puedes ignorar este mensaje con tranquilidad.
        </div>

        <p style="font-size: 13px; color: #94A3B8; word-break: break-all;">
          ¿El botón no funciona? Copia y pega este enlace en tu navegador:<br>
          <a href="${safeVerificationUrl}" style="color: #17BFAC;">${safeVerificationUrl}</a>
        </p>
      </div>
      <div class="footer">
        © ${new Date().getFullYear()} Asiento Libre. Todos los derechos reservados.<br>
        Plataforma comunitaria de viajes compartidos.
      </div>
    </div>
  </div>
</body>
</html>
    `;

    // Si Brevo API Key está configurada, enviar vía Brevo REST API v3
    if (currentApiKey) {
      try {
        const payload = {
          sender: {
            name: currentSenderName,
            email: currentSenderEmail || undefined,
          },
          to: [
            {
              email: toEmail,
              name: firstName || undefined,
            },
          ],
          subject: '🚗 Activa tu cuenta en Asiento Libre',
          htmlContent: htmlContent,
        };

        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': currentApiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          const errMsg = data?.message || response.statusText || 'Error desconocido de Brevo';
          this.logger.error(`Error al enviar correo vía Brevo a ${toEmail} [Status ${response.status}]: ${errMsg}`);
          this.logger.warn(
            `\n======================================================\n` +
            `⚠️ [FALLBACK - BREVO NO PUDO ENVIAR AL CORREO]\n` +
            `Detalle: ${errMsg}\n` +
            `Para: ${toEmail}\n` +
            `Token: ${token}\n` +
            `Enlace de Verificación Directo:\n${verificationUrl}\n` +
            `======================================================\n`
          );
          return { success: false };
        }

        const messageId = data?.messageId;
        this.logger.log(`Correo de verificación enviado exitosamente vía Brevo a ${toEmail} (ID: ${messageId})`);
        return { success: true, messageId };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Excepción al enviar correo vía Brevo a ${toEmail}: ${msg}`);
        this.logger.warn(
          `\n======================================================\n` +
          `⚠️ [FALLBACK - EXCEPCIÓN EN BREVO]\n` +
          `Para: ${toEmail}\n` +
          `Token: ${token}\n` +
          `Enlace de Verificación Directo:\n${verificationUrl}\n` +
          `======================================================\n`
        );
        return { success: false };
      }
    } else {
      // Modo desarrollo / sin API key: log en consola
      this.logger.warn(
        `\n======================================================\n` +
        `📨 [SIMULACIÓN EMAIL VERIFICACIÓN - BREVO NO CONFIGURADO]\n` +
        `Para: ${toEmail}\n` +
        `Nombre: ${firstName}\n` +
        `Token: ${token}\n` +
        `Enlace de Verificación Directo:\n${verificationUrl}\n` +
        `======================================================\n`
      );
      return { success: true };
    }
  }

  /**
   * Envía el correo con el código de 6 dígitos para validar el cambio de correo electrónico
   */
  async sendEmailChangeCode(
    toEmail: string,
    firstName: string,
    code: string,
  ): Promise<{ success: boolean; messageId?: string }> {
    const safeFirstName = escapeHtml(firstName || 'viajero/a');
    const safeEmail = escapeHtml(toEmail);
    const currentApiKey = this.getApiKey();
    const currentSenderEmail =
      this.configService.get<string>('BREVO_SENDER_EMAIL') ||
      process.env.BREVO_SENDER_EMAIL ||
      this.senderEmail;
    const currentSenderName =
      this.configService.get<string>('BREVO_SENDER_NAME') ||
      process.env.BREVO_SENDER_NAME ||
      this.senderName;

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Código de verificación de cambio de correo — Asiento Libre</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #F4F7FB;
      margin: 0;
      padding: 0;
      color: #1E293B;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #F4F7FB;
      padding: 40px 15px;
    }
    .email-container {
      max-width: 580px;
      margin: 0 auto;
      background: #FFFFFF;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 10px 30px rgba(11, 30, 59, 0.08);
      border: 1px solid #E2E8F0;
    }
    .header {
      background: linear-gradient(135deg, #0B1E3B 0%, #15325E 100%);
      padding: 32px 30px;
      text-align: center;
    }
    .header h1 {
      color: #FFFFFF;
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .header .accent {
      color: #17BFAC;
    }
    .content {
      padding: 36px 32px 30px 32px;
      text-align: center;
    }
    .content h2 {
      color: #0B1E3B;
      font-size: 20px;
      margin-top: 0;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .content p {
      font-size: 15px;
      line-height: 1.6;
      color: #475569;
      margin-bottom: 24px;
      text-align: left;
    }
    .code-box {
      background: #F1F5F9;
      border: 2px dashed #17BFAC;
      border-radius: 12px;
      padding: 20px;
      margin: 28px 0;
      letter-spacing: 8px;
      font-size: 34px;
      font-weight: 800;
      color: #0B1E3B;
      user-select: all;
    }
    .info-box {
      background: #F8FAFC;
      border-left: 4px solid #17BFAC;
      padding: 14px 16px;
      border-radius: 6px;
      font-size: 13.5px;
      color: #64748B;
      margin-bottom: 24px;
      text-align: left;
    }
    .footer {
      background-color: #F8FAFC;
      border-top: 1px solid #E2E8F0;
      padding: 24px 32px;
      text-align: center;
      font-size: 12.5px;
      color: #94A3B8;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="email-container">
      <div class="header">
        <h1>Asiento <span class="accent">Libre</span> 🚗</h1>
      </div>
      <div class="content">
        <h2>Verificación de nuevo correo 🔐</h2>
        <p>¡Hola, ${safeFirstName}! 👋</p>
        <p>Has solicitado cambiar tu correo electrónico en <strong>Asiento Libre</strong> a esta dirección (<code>${safeEmail}</code>).</p>
        <p>Introduce el siguiente código de 6 dígitos en tu perfil para confirmar el cambio:</p>

        <div class="code-box">${code}</div>

        <div class="info-box">
          ⏱️ <strong>Seguridad:</strong> Este código expira en <strong>15 minutos</strong>. Si tú no solicitaste este cambio, puedes ignorar este mensaje o cancelar la solicitud desde tu perfil.
        </div>
      </div>
      <div class="footer">
        © ${new Date().getFullYear()} Asiento Libre. Todos los derechos reservados.<br>
        Plataforma comunitaria de viajes compartidos.
      </div>
    </div>
  </div>
</body>
</html>
    `;

    if (currentApiKey) {
      try {
        const payload = {
          sender: {
            name: currentSenderName,
            email: currentSenderEmail || undefined,
          },
          to: [
            {
              email: toEmail,
              name: firstName || undefined,
            },
          ],
          subject: `🔐 Tu código de verificación de cambio de correo: ${code}`,
          htmlContent: htmlContent,
        };

        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'api-key': currentApiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          const errMsg = data?.message || response.statusText || 'Error desconocido de Brevo';
          this.logger.error(`Error al enviar código vía Brevo a ${toEmail} [Status ${response.status}]: ${errMsg}`);
          this.logger.warn(
            `\n======================================================\n` +
            `⚠️ [FALLBACK - CÓDIGO CAMBIO DE CORREO]\n` +
            `Para: ${toEmail}\n` +
            `Código: ${code} (Expira en 15 minutos)\n` +
            `======================================================\n`
          );
          return { success: false };
        }

        const messageId = data?.messageId;
        this.logger.log(`Código de cambio de correo enviado exitosamente vía Brevo a ${toEmail} (ID: ${messageId})`);
        return { success: true, messageId };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Excepción al enviar código vía Brevo a ${toEmail}: ${msg}`);
        this.logger.warn(
          `\n======================================================\n` +
          `⚠️ [FALLBACK - CÓDIGO CAMBIO DE CORREO]\n` +
          `Para: ${toEmail}\n` +
          `Código: ${code} (Expira en 15 minutos)\n` +
          `======================================================\n`
        );
        return { success: false };
      }
    } else {
      this.logger.warn(
        `\n======================================================\n` +
        `📨 [SIMULACIÓN CÓDIGO CAMBIO DE CORREO - BREVO NO CONFIGURADO]\n` +
        `Para: ${toEmail}\n` +
        `Nombre: ${firstName}\n` +
        `Código: ${code} (Expira en 15 minutos)\n` +
        `======================================================\n`
      );
      return { success: true };
    }
  }
}
