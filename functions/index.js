const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { google } = require("googleapis");
const logger = require("firebase-functions/logger");
const axios = require("axios"); // Necesario para hablar con Mercado Libre

// Configuración global para control de costos y rendimiento
setGlobalOptions({ maxInstances: 10 });

const customsearch = google.customsearch("v1");
const ORIGIN_ALLOWED = "https://superm-growlab.github.io";

exports.consultarOraculo = onCall({ 
    region: "us-central1",
    secrets: ["GEMINI_API_KEY", "GOOGLE_SEARCH_API_KEY", "CUSTOM_SEARCH_ID"],
    cors: [ORIGIN_ALLOWED]
}, async (request) => {
    const { titulo, tags = [], action } = request.data;

    // Modo Ping para diagnóstico del Agente
    if (action === "test") {
        try {
            const key = process.env.GEMINI_API_KEY;
            if (!key) throw new Error("Falta la variable GEMINI_API_KEY en los Secrets.");
            if (!key.startsWith("AIza")) throw new Error("La API Key no tiene el formato correcto (debe empezar con AIza).");
            
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            // Validamos la API Key con una operación ligera que no consume cuota de generación
            await model.countTokens("ping");
            return { message: "Conexión con el Oráculo establecida y validada." };
        } catch (e) {
            logger.error("Error en validación de Oráculo:", e.message);
            throw new HttpsError("unauthenticated", "Fallo de validación Gemini: " + e.message);
        }
    }

    if (!titulo) {
        logger.error("Consulta fallida: Título ausente");
        throw new HttpsError("invalid-argument", "El título de la muestra es obligatorio.");
    }

    const key = process.env.GEMINI_API_KEY;
    if (!key || key.length < 20 || !key.startsWith("AIza")) {
        logger.error("Clave GEMINI_API_KEY no configurada correctamente en Secrets.");
        throw new HttpsError("unauthenticated", "El Oráculo no tiene acceso a su llave de sabiduría. Verifica los Secrets de Firebase.");
    }

    const tagsText = Array.isArray(tags) && tags.length > 0 ? tags.join(", ") : "sin etiquetas";
    const genAI = new GoogleGenerativeAI(key);

    // Log de seguridad para depuración (solo muestra los primeros 4 caracteres)
    const keyPrefix = key.substring(0, 4);
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
            const is404 = error.message?.includes("404") || error.status === 404;
            const msg = is404 
                ? "Modelo no encontrado o API no habilitada. Revisa la consola de Google Cloud." 
                : error.message;
            
            throw new HttpsError(is404 ? "not-found" : "internal", `Fallo del Oráculo: ${msg}`);
        }
    }
});

/**
 * FUNCIÓN: analizarCarencia
 * Propósito: Recibir una foto en base64 y usar Gemini Vision para diagnosticar carencias.
 */
exports.analizarCarencia = onCall({
    region: "us-central1",
    secrets: ["GEMINI_API_KEY"],
    cors: [ORIGIN_ALLOWED]
}, async (request) => {
    try {
        const { image, action } = request.data;
        if (action === "test") return { message: "Ojo del Oráculo Operativo" };
        if (!image) throw new HttpsError("invalid-argument", "Imagen ausente.");

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const base64Data = image.split(",")[1] || image;

        const prompt = "Analiza esta planta de cannabis. Responde en JSON puro: { \"diagnostico\": \"nombre\", \"confianza\": \"X%\", \"accion\": \"instruccion\" }";
        const result = await model.generateContent([prompt, { inlineData: { data: base64Data, mimeType: "image/jpeg" } }]);
        const text = result.response.text();
        
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            logger.error("IA devolvió texto plano en lugar de JSON:", text);
            throw new HttpsError("internal", "El Oráculo no pudo procesar la imagen.");
        }
        
        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        logger.error("Error en analizarCarencia:", error);
        throw new HttpsError("internal", "Error IA: " + error.message);
    }
});

/**
 * FUNCIÓN: getMercadoLibreData
 * Propósito: Proxy privado para Mercado Libre con autenticación Client Credentials.
 */
exports.getMercadoLibreData = onCall({
    secrets: ["ML_CLIENT_ID", "ML_CLIENT_SECRET"],
    cors: [ORIGIN_ALLOWED]
}, async (request) => {
    const { url, productId, action } = request.data;

    // Modo Ping para diagnóstico del Agente
    if (action === "test") {
        try {
            // Intentamos una llamada pública rápida para verificar conectividad del servidor
            await axios.get("https://api.mercadolibre.com/sites/MLA", { timeout: 3000 });
            return { message: "Conexión con Mercado Libre Operativa" };
        } catch (e) {
            logger.error("Error en test de ML:", e.message);
            throw new HttpsError("unavailable", "La API de Mercado Libre no responde desde el servidor de funciones.");
        }
    }

    if (!productId && !url) {
        throw new HttpsError("invalid-argument", "Se requiere una URL o ID de producto.");
    }

    // 1. OBTENER TOKEN DE ACCESO (Client Credentials Flow)
    let accessToken;
    try {
        const tokenRes = await axios.post("https://api.mercadolibre.com/oauth/token", {
            grant_type: "client_credentials",
            client_id: process.env.ML_CLIENT_ID,
            client_secret: process.env.ML_CLIENT_SECRET
        });
        accessToken = tokenRes.data.access_token;
    } catch (e) {
        logger.error("Error obteniendo token de ML:", e.message);
        throw new HttpsError("internal", "No se pudo autenticar con Mercado Libre.");
    }

    try {
        let targetUrl = url;

        // 🔗 RESOLVER LINKS ACORTADOS (meli.la/xxx)
        if (url && url.includes("meli.la")) {
            const res = await axios.get(url, { maxRedirects: 5, headers: { 'Authorization': `Bearer ${accessToken}` } });
            // Intentamos capturar la URL final de forma más robusta (para evitar 404 por redirecciones rotas)
            targetUrl = res.request?.res?.responseUrl || 
                        res.request?._redirectable?._currentUrl || 
                        res.config?.url || 
                        url;
            logger.info(`Link resuelto: ${targetUrl}`);
        }

        // Extraer el ID (MLA...) del link
        let idML = productId || (targetUrl?.match(/MLA-?(\d+)/i)?.[1] || url?.match(/MLA-?(\d+)/i)?.[1] || "");
        if (!idML) throw new Error("No se pudo extraer un ID válido de Mercado Libre.");

        // Limpiar si el usuario ya puso MLA en el ID manual
        idML = idML.toString().toUpperCase().replace(/MLA-?/g, '');

        logger.info(`Consultando producto ML: MLA${idML}`);

        // 2. CONSULTA AUTORIZADA
        const response = await axios.get(`https://api.mercadolibre.com/items/MLA${idML}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const item = response.data;

        return {
            id: item.id,
            title: item.title,
            price: item.price,
            currency_id: item.currency_id,
            pictures: item.pictures?.map(p => p.url).slice(0, 5) || [item.thumbnail],
            permalink: item.permalink,
            attributes: item.attributes?.slice(0, 5).map(a => `${a.name}: ${a.value_name}`) || [],
            debug: { api_usada: "ML-API-V1", id_procesado: item.id }
        };

    } catch (error) {
        const status = error.response?.status;
        logger.error("Error en obtenerProductoML:", { message: error.message, status });
        
        if (status === 404) {
            throw new HttpsError("not-found", "Producto no encontrado. Verifica el ID o que el link sea de un artículo activo.");
        }
        throw new HttpsError("internal", `Error de comunicación con ML: ${error.message}`);
    }
});
