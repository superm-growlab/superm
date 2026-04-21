const { setGlobalOptions } = require("firebase-functions");
const { onCall } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require("firebase-functions/logger");

// Configuración global para control de costos y rendimiento
setGlobalOptions({ maxInstances: 10 });

exports.consultarOraculo = onCall({ 
    region: "us-central1",
    secrets: ["GEMINI_API_KEY", "GOOGLE_SEARCH_API_KEY", "CUSTOM_SEARCH_ID"] 
}, async (request) => {
    const { titulo, tags } = request.data;

    if (!titulo) {
        logger.error("Consulta fallida: Título ausente");
        throw new Error("El título de la muestra es obligatorio.");
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-flash-latest",
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
        
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const diagnosis = jsonMatch ? JSON.parse(jsonMatch[0]) : { error: "Respuesta ilegible" };

        // 🔎 BÚSQUEDA DINÁMICA DE IMÁGENES (Google Search API)
        let url_imagen = "https://i.postimg.cc/rF9GqwGS/favicon.png"; // Fallback por defecto
        try {
            const query = encodeURIComponent(`${titulo} cannabis leaf deficiency symptom`);
            const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_SEARCH_API_KEY}&cx=${process.env.CUSTOM_SEARCH_ID}&q=${query}&searchType=image&num=1`;
            
            const searchRes = await fetch(searchUrl);
            const searchData = await searchRes.json();
            
            if (searchData.items && searchData.items.length > 0) {
                url_imagen = searchData.items[0].link;
            }
        } catch (err) {
            logger.warn("Error en búsqueda de imágenes:", err);
        }

        return { ...diagnosis, url_imagen };

    } catch (error) {
        logger.error("Error en Gemini AI:", error);
        return {
            error: "No se pudo transmutar la información del Oráculo."
        };
    }
});
