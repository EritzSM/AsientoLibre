import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

export type AiVerdict = 'aprobado' | 'rechazado' | 'revision_manual';

export interface AiRuleResult {
  ruleId: string;
  description: string;
  verdict: string;
  confidence: number;
}

export interface AiAnalysisResult {
  verdict: AiVerdict;
  reason: string;
  rules_triggered: AiRuleResult[];
  scheduled_activation?: string | null;
  raw_response?: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Analiza un documento de conductor usando Gemini Vision API
   * y aplica las reglas de negocio definidas.
   */
  async analyzeDocument(params: {
    documentType: 'licencia' | 'soat' | 'cedula' | 'foto_vehiculo' | string;
    fileUrl: string;
    conductorNationalId?: string;
    vehiclePlate?: string;
    vehicleBrand?: string;
    vehicleModel?: string;
    currentDate?: string;
  }): Promise<AiAnalysisResult> {
    const { documentType, fileUrl, conductorNationalId, vehiclePlate, vehicleBrand, vehicleModel, currentDate } = params;
    const today = currentDate ?? new Date().toISOString().split('T')[0];

    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY no configurada. Retornando revision_manual.');
      return {
        verdict: 'revision_manual',
        reason: 'La clave de API de Gemini no está configurada. Se requiere revisión manual.',
        rules_triggered: [],
      };
    }

    const prompt = this.buildPrompt(documentType, conductorNationalId, vehiclePlate, vehicleBrand, vehicleModel, today);

    let imageData: { base64: string; mimeType: string };
    try {
      imageData = await this.fetchImageAsBase64(fileUrl);
    } catch (fetchErr: any) {
      this.logger.error(`Error al descargar el archivo para análisis: ${fetchErr?.message}`);
      return {
        verdict: 'revision_manual',
        reason: `No se pudo descargar el archivo para validación: ${fetchErr?.message}. Revisión manual requerida.`,
        rules_triggered: [{ ruleId: 'IMG-01', description: 'Error al descargar archivo', verdict: 'revision_manual', confidence: 1.0 }],
      };
    }

    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'];
    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          ],
        });

        const result = await model.generateContent([
          { inlineData: { mimeType: imageData.mimeType, data: imageData.base64 } },
          { text: prompt },
        ]);

        const responseText = result.response.text();
        this.logger.log(`Gemini (${modelName}) completó análisis exitosamente para ${documentType}`);
        this.logger.debug(`Gemini response: ${responseText.substring(0, 300)}`);

        return this.parseGeminiResponse(responseText);
      } catch (err: any) {
        lastError = err;
        this.logger.warn(`Modelo ${modelName} falló (${err?.message}). Probando siguiente modelo...`);
      }
    }

    this.logger.error(`Todos los modelos de Gemini fallaron: ${lastError?.message}`);
    return {
      verdict: 'revision_manual',
      reason: `Servicio de IA temporalmente no disponible: ${lastError?.message ?? 'Error desconocido'}. Se requiere revisión manual.`,
      rules_triggered: [],
      raw_response: String(lastError?.message ?? ''),
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildPrompt(
    documentType: string,
    conductorNationalId?: string,
    vehiclePlate?: string,
    vehicleBrand?: string,
    vehicleModel?: string,
    today?: string,
  ): string {
    const base = `
Eres un sistema estricto, objetivo y lógico de validación de documentos y vehículos para una plataforma de transporte en Colombia.
Fecha actual del sistema: ${today}.
Tipo de documento esperado en esta carga: "${documentType}".
Cédula registrada del conductor: ${conductorNationalId ?? 'no disponible'}.
Placa del vehículo registrada: ${vehiclePlate ?? 'no disponible'}.
Marca registrada del vehículo: ${vehicleBrand ?? 'no disponible'}.
Modelo registrado del vehículo: ${vehicleModel ?? 'no disponible'}.

INSTRUCCIONES GENERALES FUNDAMENTALES (OBLIGATORIAS):
1. Verificación estricta del TIPO DE ARCHIVO/IMAGEN:
   - Para "foto_vehiculo": La imagen DEBE SER UNA FOTOGRAFÍA REAL DE UN VEHÍCULO AUTOMOTOR FÍSICO (carro, moto o camioneta real donde se observe la carrocería o partes del vehículo y su placa física).
     ¡ESTÁ ESTRICTAMENTE PROHIBIDO APROBAR si la imagen es un papel, documento escaneado, póliza SOAT, certificado, cédula o captura de pantalla de texto! Si en "foto_vehiculo" se sube un documento de papel o SOAT, el veredicto OBLIGATORIAMENTE debe ser "revision_manual" con motivo: "La imagen proporcionada es un documento y no una fotografía real del vehículo automotor. Se requiere revisión manual."
   - Para "soat": La imagen debe corresponder a un certificado o póliza SOAT.
   - Para "licencia": Debe corresponder a una licencia de conducción.
   - Para "cedula": Debe corresponder a una cédula de ciudadanía.
   - Si la imagen no corresponde al tipo solicitado, el veredicto debe ser "revision_manual".
2. REGLA DE CERTEZA Y REVISIÓN MANUAL:
   - Toda imagen que el sistema no sea capaz de entender con absoluta certeza, que esté borrosa, recortada, ambigua o donde los datos no sean completamente claros, DEBE SER ASIGNADA A "revision_manual" para que un administrador humano la revise personalmente.
   - Solo emite veredicto "aprobado" si estás 100% seguro de que el tipo de documento es el correcto, las fechas están vigentes y los datos coinciden plenamente.
3. Lógica matemática de fechas (OBLIGATORIO):
   - Extrae las fechas en formato YYYY-MM-DD.
   - Compara las fechas año por año, mes por mes y día por día con la fecha actual (${today}).
   - Si la fecha de vencimiento es POSTERIOR O IGUAL a ${today} (ejemplo: vencimiento 2027-09-01 y hoy ${today}): el documento está VIGENTE. ¡BAJO NINGUNA CIRCUNSTANCIA digas que está vencido si el año o fecha de vencimiento es en el futuro!
   - Solo está vencido si ${today} es estrictamente posterior a la fecha de vencimiento (${today} > fecha_vencimiento).
4. Evaluación visual y anti-fraude:
   - No confundas compresión JPEG normal o tipografías digitales con fraude.
   - Solo aplica FRA-01 si existe alteración evidente e intencional de los campos críticos.
   - Para FRA-01 e IMG-01 el veredicto SIEMPRE es "revision_manual", NUNCA "rechazado".
`;

    const rulesMap: Record<string, string> = {
      soat: `
Reglas de Negocio para SOAT:
- SOAT-01: Fecha actual (${today}) posterior a la fecha de vencimiento confirmada → verdict "rechazado". Si la fecha de vencimiento es posterior o igual a ${today}, el SOAT está VIGENTE.
- SOAT-02: Fecha de inicio de vigencia es en el futuro (posterior a ${today}) → verdict "pendiente_con_timer", con campo "scheduled_activation" con la fecha YYYY-MM-DD de inicio.
- SOAT-03: Placa visible en el SOAT es diferente a "${vehiclePlate}" → verdict "rechazado". Si coincide con "${vehiclePlate}", es válido.
- SOAT-04: Validación de Marca y Modelo del Vehículo:
  * Extrae la marca y el modelo que aparecen en el SOAT.
  * Compara con los datos del vehículo registrado en el sistema (Marca registrada: "${vehicleBrand ?? 'no disponible'}", Modelo registrado: "${vehicleModel ?? 'no disponible'}").
  * Si la marca o el modelo del vehículo en el SOAT son claramente incompatibles o diferentes con los registrados en el sistema (por ejemplo, en el sistema dice una marca/modelo y en el SOAT dice otra marca o modelo completamente diferente como "BAJAJ DISCOVER 125 ST" vs un carro, o marcas distintas) → verdict "rechazado" con motivo detallado indicando la discrepancia entre el SOAT y los datos registrados. Si el dato registrado en el sistema parece un texto genérico o no identificable, marca "revision_manual" para verificación del admin.
- FRA-01: Posible manipulación documental intencional de datos clave → verdict "revision_manual".
- IMG-01: Imagen totalmente borrosa, ilegible o no corresponde a un SOAT → verdict "revision_manual".

Responde ÚNICAMENTE en JSON con esta estructura:
{
  "extracted_start_date": "YYYY-MM-DD o null",
  "extracted_expiry_date": "YYYY-MM-DD o null",
  "extracted_plate": "cadena o null",
  "extracted_brand": "cadena o null",
  "extracted_model": "cadena o null",
  "is_valid_date": true,
  "verdict": "aprobado" | "rechazado" | "revision_manual" | "pendiente_con_timer",
  "reason": "Explicación coherente en español detallando fechas, placa, marca y modelo",
  "scheduled_activation": "YYYY-MM-DD o null",
  "rules_triggered": []
}`,
      licencia: `
Reglas de Negocio para Licencia de Conducción:
- LIC-01: Licencia vencida (fecha de vencimiento anterior a ${today}) → verdict "rechazado". Si la fecha de vencimiento es posterior o igual a ${today}, la licencia está VIGENTE.
- LIC-02: Categoría no válida para transporte de personas (requiere al menos B1, B2, C1, C2 o C3; una categoría exclusiva de moto como A1/A2 no es válida si el vehículo registrado es automóvil) → verdict "rechazado".
- FRA-01: Evidencia clara de documento manipulado → verdict "revision_manual".
- IMG-01: Imagen borrosa, ilegible o incompleta → verdict "revision_manual".

Responde ÚNICAMENTE en JSON con esta estructura:
{
  "extracted_expiry_date": "YYYY-MM-DD o null",
  "extracted_category": "cadena o null",
  "extracted_national_id": "cadena o null",
  "verdict": "aprobado" | "rechazado" | "revision_manual",
  "reason": "Explicación en español",
  "scheduled_activation": null,
  "rules_triggered": []
}`,
      cedula: `
Reglas de Negocio para Cédula de Ciudadanía:
- DOC-01: Número de cédula visible diferente a "${conductorNationalId}" o documento no corresponde a cédula → verdict "rechazado". Si coincide con "${conductorNationalId}", es válido.
- FRA-01: Documento con manipulación digital evidente → verdict "revision_manual".
- IMG-01: Imagen borrosa, incompleta o no comprensible → verdict "revision_manual".

Responde ÚNICAMENTE en JSON con esta estructura:
{
  "extracted_national_id": "cadena o null",
  "verdict": "aprobado" | "rechazado" | "revision_manual",
  "reason": "Explicación en español",
  "scheduled_activation": null,
  "rules_triggered": []
}`,
      foto_vehiculo: `
Reglas de Negocio para Foto del Vehículo:
- REQUISITO ESTRICTO: La imagen DEBE ser una fotografía real de un vehículo automotor físico.
- ¡PROHIBIDO APROBAR si la imagen es un papel, documento escaneado, certificado SOAT, licencia o texto! Si se subió un documento en papel o SOAT, verdict "revision_manual" con motivo: "La imagen es un documento en papel y no una fotografía real del vehículo automotor. Se requiere revisión manual."
- VEH-01: Placa visible en el vehículo físico diferente a "${vehiclePlate}" → verdict "revision_manual". Si la placa coincide y se aprecia el vehículo real, es válido.
- VEH-02: La marca y tipo del vehículo visible en la foto no corresponden a los registrados ("${vehicleBrand ?? ''} ${vehicleModel ?? ''}") → verdict "revision_manual".
- IMG-01: La imagen no permite entender con certeza el vehículo, no se ve la placa claramente, o la imagen no es comprensible → verdict "revision_manual".

Responde ÚNICAMENTE en JSON con esta estructura:
{
  "is_physical_vehicle_photo": true,
  "extracted_plate": "cadena o null",
  "extracted_brand": "cadena o null",
  "verdict": "aprobado" | "revision_manual" | "rechazado",
  "reason": "Explicación en español aclarando si se trata de un vehículo real y la placa observada",
  "scheduled_activation": null,
  "rules_triggered": []
}`,
    };

    return base + (rulesMap[documentType] ?? rulesMap['foto_vehiculo']);
  }

  private parseGeminiResponse(responseText: string): AiAnalysisResult {
    const cleaned = responseText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/gi, '')
      .trim();

    let parsed: any;
    try {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return {
        verdict: 'revision_manual',
        reason: 'No se pudo interpretar la respuesta del análisis automático. Revisión manual requerida.',
        rules_triggered: [],
        raw_response: responseText,
      };
    }

    const rawVerdict = String(parsed.verdict ?? '').toLowerCase();
    let verdict: AiVerdict;

    if (rawVerdict === 'rechazado') {
      verdict = 'rechazado';
    } else if (rawVerdict === 'aprobado') {
      verdict = 'aprobado';
    } else {
      // pendiente_con_timer and revision_manual both map to revision_manual
      // The scheduled_activation field handles the timer scenario
      verdict = 'revision_manual';
    }

    return {
      verdict,
      reason: String(parsed.reason ?? 'Análisis completado por IA.'),
      rules_triggered: Array.isArray(parsed.rules_triggered)
        ? parsed.rules_triggered.map((r: any) => ({
            ruleId: String(r.ruleId ?? ''),
            description: String(r.description ?? ''),
            verdict: String(r.verdict ?? 'revision_manual'),
            confidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
          }))
        : [],
      scheduled_activation: parsed.scheduled_activation ?? null,
      raw_response: responseText,
    };
  }

  private async fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
    const dataMatch = /^data:(.+?);base64,(.+)$/.exec(url);
    if (dataMatch) {
      return { mimeType: dataMatch[1], base64: dataMatch[2] };
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      throw new Error(`No se pudo descargar el archivo: ${response.status} ${response.statusText}`);
    }

    let contentType = response.headers.get('content-type') || '';
    contentType = contentType.split(';')[0].trim().toLowerCase();

    if (url.toLowerCase().endsWith('.pdf') || contentType.includes('pdf')) {
      contentType = 'application/pdf';
    } else if (!contentType || contentType === 'application/octet-stream') {
      contentType = 'image/jpeg';
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return { base64, mimeType: contentType };
  }
}
