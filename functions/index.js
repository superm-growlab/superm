const { setGlobalOptions } = require("firebase-functions");
const { onCall } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("firebase-functions/logger");

// Configuración global para control de costos y rendimiento
setGlobalOptions({ maxInstances: 10 });

exports.consultarOraculo = onCall({ 
    region: "us-central1",
    secrets: ["GEMINI_API_KEY"] 
}, async (request) => {
    const { titulo, tags } = request.data;

    if (!titulo) {
        logger.error("Consulta fallida: Título ausente");
        throw new Error("El título de la muestra es obligatorio.");
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
        Eres el Agente Inteligente de Super M Lab, experto botánico en cultivo de cannabis.
        Analiza el siguiente síntoma: "${titulo}" con las etiquetas de ADN visual: ${tags.join(", ")}.
        
        Tu tarea es generar un diagnóstico técnico detallado basado en literatura técnica de cultivo (GrowWeedEasy, RQS, etc.).
        
        IMPORTANTE: Responde ÚNICAMENTE en formato JSON estricto con la siguiente estructura:
        {
          "ph_rango": "rango recomendado de pH",
          "ec_rango": "rango recomendado de EC",
          "ambiente_detalles": "ajustes de humedad/temperatura (VPD)",
          "solucion_alquimista": "instrucciones técnicas paso a paso para corregir el problema",
          "fuente": "fuente técnica principal consultada"
        }
        No incluyas explicaciones fuera del JSON.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Con responseMimeType, el texto ya es un JSON válido
        return JSON.parse(text);

    } catch (error) {
        logger.error("Error en Gemini AI:", error);
        return {
            error: "No se pudo transmutar la información del Oráculo."
        };
    }
});
