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
            const key = process.env.GEMINI_API_KEY?.trim();
            if (!key) throw new Error("Falta la variable GEMINI_API_KEY en los Secrets.");
            if (!key.startsWith("AIza")) throw new Error("La API Key no tiene el formato correcto (debe empezar con AIza).");
            
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });
            
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

    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key || key.length < 20 || !key.startsWith("AIza")) {
        logger.error("Clave GEMINI_API_KEY no configurada correctamente en Secrets.");
        throw new HttpsError("unauthenticated", "El Oráculo no tiene acceso a su llave de sabiduría. Verifica los Secrets de Firebase.");
    }

    const genAI = new GoogleGenerativeAI(key);
    logger.info(`Invocando Oráculo para: ${titulo}. Key inicia con: ${key.substring(0, 5)}`);

    const model = genAI.getGenerativeModel({ 
        model: "models/gemini-1.5-flash", 
        generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
        Eres el Agente Inteligente de Super M Lab, experto botánico en cultivo de cannabis.
        Analiza el siguiente síntoma: "${titulo}" con las etiquetas de ADN visual: ${Array.isArray(tags) ? tags.join(", ") : "sin etiquetas"}.
        
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
            const googleKey = process.env.GOOGLE_SEARCH_API_KEY?.trim();
            const cxId = process.env.CUSTOM_SEARCH_ID?.trim();

            if (!googleKey || !cxId || googleKey.length < 20) {
                throw new HttpsError("unauthenticated", "Faltan credenciales de búsqueda de Google (API Key o CX ID).");
            }

            const searchRes = await customsearch.cse.list({
                auth: googleKey,
                cx: cxId,
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
        logger.error("Fallo detallado del Oráculo (consultarOraculo):", {
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
 * FUNCIÓN: analizarImagenPlanta
 * Propósito: Recibir una foto en base64 y usar Gemini Vision para diagnosticar carencias.
 */
exports.analizarImagenPlanta = onCall({
    region: "us-central1",
    secrets: ["GEMINI_API_KEY"],
    cors: [ORIGIN_ALLOWED]
}, async (request) => {
    try {
        const { image, action } = request.data;
        if (action === "test") return { message: "Ojo del Oráculo Operativo" };
        if (!image) throw new HttpsError("invalid-argument", "Imagen ausente.");

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY?.trim());
        const model = genAI.getGenerativeModel({ model: "models/gemini-1.5-flash" });
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
        logger.error("Error en analizarImagenPlanta:", error);
        throw new HttpsError("internal", "Error IA: " + error.message);
    }
});

/**
 * FUNCIÓN: obtenerProductoML
 * Propósito: Proxy privado para Mercado Libre con autenticación Client Credentials.
 */
exports.obtenerProductoML = onCall({
    region: "us-central1",
    secrets: ["ML_CLIENT_ID", "ML_CLIENT_SECRET"],
    cors: [ORIGIN_ALLOWED]
}, async (request) => {
    const { url, productId, action } = request.data;

    // Modo Ping para diagnóstico del Agente
    if (action === "test") {
        try {
            // Intentamos una llamada pública rápida para verificar conectividad del servidor
            const testRes = await axios.get("https://api.mercadolibre.com/sites/MLA", { 
                timeout: 10000,
                headers: { 'User-Agent': 'SuperM-Lab-Agente/1.0' }
            });
            return { message: "Conexión con Mercado Libre Operativa", status: testRes.status };
        } catch (e) {
            const status = e.response?.status;
            const code = e.code;
            logger.error("Error en test de ML:", { status, code, message: e.message });
            
            let errorDetail = code === 'EAI_AGAIN' ? "Fallo de red DNS (común en arranques en frío o propagación de facturación)" : e.message;
            if (status === 403) errorDetail = "Acceso denegado por Mercado Libre (403)";

            throw new HttpsError("unavailable", `La API de Mercado Libre no responde: ${errorDetail}`);
        }
    }

    if (!productId && !url) {
        throw new HttpsError("invalid-argument", "Se requiere una URL o ID de producto.");
    }

    // 1. OBTENER TOKEN DE ACCESO (Client Credentials Flow)
    let accessToken = null;
    try {
        const tokenRes = await axios.post("https://api.mercadolibre.com/oauth/token", {
            grant_type: "client_credentials",
            client_id: String(process.env.ML_CLIENT_ID || "").trim(),
            client_secret: String(process.env.ML_CLIENT_SECRET || "").trim()
        }, { 
            timeout: 5000,
            headers: { 'User-Agent': 'SuperM-Lab-Agente/1.0' }
        });
        accessToken = tokenRes.data.access_token;
        logger.info("Token de ML generado con éxito.");
    } catch (e) {
        logger.error("Error obteniendo token de ML:", e.message);
        throw new HttpsError("internal", "No se pudo autenticar con Mercado Libre.");
    }

    const input = (productId || url || "").trim();
    let finalId = "";
    let permalinkToUse = "";

    try {
        let targetUrl = input;

        // 1. Identificar tipo de entrada
        if (input.includes("http")) {
            permalinkToUse = input; // Guardamos el link original (referido)
            if (input.includes("meli.la")) {
                const res = await axios.get(input, { maxRedirects: 5, headers: { 'Authorization': `Bearer ${accessToken}` } });
                targetUrl = res.request?.res?.responseUrl || res.request?._redirectable?._currentUrl || input;
            }
        } else if (input.match(/^[A-Z]{3,4}\d+$/i)) {
            finalId = input.toUpperCase();
        } else {
            // Es un código corto (ej: NG8WAT-7T61)
            permalinkToUse = `https://meli.la/${input}`;
            const res = await axios.get(permalinkToUse, { maxRedirects: 5, headers: { 'Authorization': `Bearer ${accessToken}` } });
            targetUrl = res.request?.res?.responseUrl || res.request?._redirectable?._currentUrl || permalinkToUse;
        }

        // 2. Extraer ID si no lo tenemos (soporta MLA y MLAU)
        if (!finalId) {
            const match = targetUrl.match(/(MLA|MLB|MLM|MLC|MLU|MLV|MPE|MCO|MEC|MRD|MGT|MCR|MBO|MPY|MSV|MHN|MNI|MPA)[A-Z]?(\d+)/i);
            if (match) finalId = match[0].toUpperCase();
        }

        if (!finalId) throw new Error("No se detectó un ID de producto válido.");

        logger.info(`Consultando Producto ML: ${finalId}`);

        // 2. CONSULTA AUTORIZADA
        const response = await axios.get(`https://api.mercadolibre.com/items/${finalId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'SuperM-Lab-Agente/1.0' },
            timeout: 10000
        });
        const item = response.data;

        return {
            id: item.id,
            title: item.title,
            price: item.price,
            currency_id: item.currency_id,
            pictures: item.pictures?.map(p => p.url).slice(0, 5) || [item.thumbnail],
            permalink: permalinkToUse || item.permalink,
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

/**
 * FUNCIÓN DE DEPURACIÓN: debugListarModelos
 * Propósito: Consultar a Google qué modelos están disponibles para tu API Key.
 * Útil para resolver errores 404 (Modelo no encontrado).
 */
exports.debugListarModelos = onCall({
    region: "us-central1",
    secrets: ["GEMINI_API_KEY"],
    cors: [ORIGIN_ALLOWED]
}, async (request) => {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new HttpsError("unauthenticated", "No se encontró la GEMINI_API_KEY en los Secrets.");

    try {
        // Usamos axios para consultar directamente la API de Google, saltándonos las limitaciones del SDK
        const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
            timeout: 10000
        });
        
        logger.info("Lista de modelos obtenida con éxito.");
        return response.data; 
    } catch (error) {
        const status = error.response?.status || 500;
        const msg = error.response?.data?.error?.message || error.message;
        
        logger.error("Error al listar modelos de Gemini:", msg);
        throw new HttpsError("internal", `Error de Google (Status ${status}): ${msg}`);
    }
});
