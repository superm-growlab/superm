const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { google } = require("googleapis");
const logger = require("firebase-functions/logger");

// Configuración global para control de costos y rendimiento
setGlobalOptions({ maxInstances: 10 });

const customsearch = google.customsearch("v1");

exports.consultarOraculo = onCall({ 
    region: "us-central1",
    secrets: ["GEMINI_API_KEY", "GOOGLE_SEARCH_API_KEY", "CUSTOM_SEARCH_ID"] 
}, async (request) => {
    const { titulo, tags = [] } = request.data;

    if (!titulo) {
        logger.error("Consulta fallida: Título ausente");
        throw new HttpsError("invalid-argument", "El título de la muestra es obligatorio.");
    }

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 20) {
        throw new HttpsError("unauthenticated", "La clave GEMINI_API_KEY no está configurada o es inválida.");
    }

    const tagsText = Array.isArray(tags) && tags.length > 0 ? tags.join(", ") : "sin etiquetas";
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    // Log de seguridad para depuración (solo muestra los primeros 4 caracteres)
    const keyPrefix = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 4) : "null";
    logger.info(`Invocando Oráculo. Prefijo de Key: ${keyPrefix}`);

    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
        Eres el Agente Inteligente de Super M Lab, experto botánico en cultivo de cannabis.
        Analiza el siguiente síntoma: "${titulo}" con las etiquetas de ADN visual: ${tagsText}.
        
        Tu tarea es generar un diagnóstico técnico detallado basado en literatura técnica de cultivo (GrowWeedEasy, RQS, etc.).
        
        Responde con un objeto JSON siguiendo esta estructura:
        {
          "ph_rango": "rango recomendado de pH",
          "ec_rango": "rango recomendado de EC",
          "ambiente_detalles": "ajustes de humedad/temperatura (VPD)",
          "solucion_alquimista": "instrucciones técnicas paso a paso para corregir el problema",
          "fuente": "fuente técnica principal consultada"
        }
        IMPORTANTE: Devuelve ÚNICAMENTE el objeto JSON puro. No incluyas bloques de código markdown.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        logger.info(`Respuesta del Oráculo para ${titulo}:`, text);

        // Extracción robusta de JSON mediante Regex para evitar texto basura de la IA
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        let diagnosis;

        if (!jsonMatch) {
            throw new HttpsError("internal", "Formato de datos ilegible.");
        }
        
        try {
            diagnosis = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
            logger.error("Error parseando JSON de la IA:", text);
            throw new HttpsError("internal", "Error en la estructura de datos del Oráculo.");
        }

        // Limpieza de campos para evitar undefined en el cliente
        diagnosis.ph_rango = diagnosis.ph_rango || "6.0 - 6.5";
        diagnosis.ec_rango = diagnosis.ec_rango || "1.2 - 1.8 mS";
        diagnosis.ambiente_detalles = diagnosis.ambiente_detalles || "Ajustar según VPD";
        diagnosis.solucion_alquimista = diagnosis.solucion_alquimista || "Revisar equilibrio de nutrientes.";
        diagnosis.fuente = diagnosis.fuente || "GrowWeedEasy / RQS Technical Library";

        // 🔎 BÚSQUEDA DINÁMICA DE IMÁGENES (Google Search API)
        let url_imagen = "https://i.postimg.cc/rF9GqwGS/favicon.png"; // Imagen genérica de respaldo
        try {
            if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.CUSTOM_SEARCH_ID || process.env.GOOGLE_SEARCH_API_KEY.length < 20) {
                throw new HttpsError("unauthenticated", "Faltan credenciales de búsqueda de Google (API Key o CX ID).");
            }

            const searchRes = await customsearch.cse.list({
                auth: process.env.GOOGLE_SEARCH_API_KEY,
                cx: process.env.CUSTOM_SEARCH_ID,
                q: `${titulo} cannabis deficiency leaf symptom`,
                searchType: "image",
                num: 1,
                safe: "high",
            });

            if (searchRes.data.items && searchRes.data.items.length > 0) {
                url_imagen = searchRes.data.items[0].link;
                logger.info(`Imagen dinámica encontrada para ${titulo}: ${url_imagen}`);
            } else {
                logger.warn(`Google no encontró imágenes para: ${titulo}`);
            }
        } catch (err) {
            logger.error("Fallo la API de Google Search. Verifica la API KEY y el CX ID en los Secrets de Firebase.", err);
        }

        return { ...diagnosis, url_imagen };

    } catch (error) {
        logger.error("Fallo detallado del Oráculo:", {
            message: error.message,
            status: error.status,
            stack: error.stack
        });
        
        if (error.status === 404 || error.message?.includes("404") || error.message?.includes("not found")) {
            throw new HttpsError("not-found", `El Oráculo no encontró el modelo. Verifica que la clave GEMINI_API_KEY sea correcta (debe empezar con 'AIza') y que la 'Generative Language API' esté habilitada.`);
        }

        if (error instanceof HttpsError) {
            throw error; // Propagar HttpsError directamente al cliente
        } else {
            // Para errores inesperados, devolver un HttpsError genérico
            throw new HttpsError("internal", `Un error inesperado ocurrió en el Oráculo: ${error.message}`);
        }
    }
});
