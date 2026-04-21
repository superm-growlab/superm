const { onCall } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inicialización de Gemini (La API Key se configura en el entorno de Firebase)
// Comando para configurar: firebase functions:secrets:set GEMINI_API_KEY

exports.consultarOraculo = onCall({ 
    region: "us-central1",
    secrets: ["GEMINI_API_KEY"] // 👈 Declaramos que esta función usará el secreto
}, async (request) => {
    const { titulo, tags } = request.data;

    if (!titulo) {
        throw new Error("El título de la muestra es obligatorio.");
    }

    // Inicializamos dentro de la función para asegurar que el secreto esté cargado en process.env
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
        
        // Limpieza de posibles etiquetas de markdown que Gemini suele incluir
        const jsonString = text.replace(/```json|```/g, "").trim();
        const jsonResponse = JSON.parse(jsonString);

        return jsonResponse;
    } catch (error) {
        console.error("Error en Gemini:", error);
        return {
            error: "No se pudo transmutar la información del Oráculo."
        };
    }
});