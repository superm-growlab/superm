const { setGlobalOptions } = require("firebase-functions");
const { onCall } = require("firebase-functions/v2/https");
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
        throw new Error("El título de la muestra es obligatorio.");
    }

    const tagsText = Array.isArray(tags) && tags.length > 0 ? tags.join(", ") : "sin etiquetas";
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-flash-latest",
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
        No incluyas explicaciones fuera del JSON ni bloques de código markdown. No devuelvas ningún enlace web o URL estática en los campos del JSON.
    `;

    try {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.length < 10) {
            throw new Error("La clave GEMINI_API_KEY no está configurada o es demasiado corta.");
        }

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        let diagnosis;
        try {
            diagnosis = JSON.parse(text);
        } catch (e) {
            throw new Error("El Oráculo devolvió un formato de datos ilegible.");
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
            if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.CUSTOM_SEARCH_ID) {
                throw new Error("Faltan credenciales de búsqueda (Key o CX).");
            }

            // Refinamos la búsqueda: Quitamos términos que puedan confundir y usamos un formato más global
            const queryLimpia = titulo.replace(/Carencia de /gi, "").replace(/Exceso de /gi, "");
            
            const searchRes = await customsearch.cse.list({
                auth: process.env.GOOGLE_SEARCH_API_KEY,
                cx: process.env.CUSTOM_SEARCH_ID,
                q: `${queryLimpia} cannabis leaf deficiency symptoms technical guide`,
                searchType: "image",
                num: 1,
                safe: "active",
                imgSize: "medium",
                imgType: "photo"
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
        logger.error("Fallo crítico en el Oráculo:", error);
        return {
            error: `Error de transmutación: ${error.message}`
        };
    }
});
