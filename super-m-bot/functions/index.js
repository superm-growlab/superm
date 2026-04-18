const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

// Headers optimizados para Mercado Libre - User-Agent real de navegador
const ML_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0'
};

const API_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'es-AR,es;q=0.9'
};

exports.obtenerProductoML = onCall({
    region: 'us-central1',
    cors: true,
    maxInstances: 10
}, async (request) => {
    const urlInput = (request.data.url || "").trim();

    if (!urlInput) {
        throw new HttpsError("invalid-argument", "No se proporcionó un link o ID.");
    }

    let itemId = null;

    // 1. Radar Maestro de IDs (Fase 1: Extracción directa)
    const directMatch = urlInput.match(/(MLA|mla)-?\d{8,15}/i);
    if (directMatch) {
        itemId = directMatch[0].replace(/-/g, "").toUpperCase();
    } 
    // 1b. Soporte para IDs escritos a mano (solo números)
    else if (/^\d{8,15}$/.test(urlInput)) {
        itemId = "MLA" + urlInput;
    }
    // 1c. Fase 2: Resolución de links cortos/referidos (meli.la)
    else if (urlInput.startsWith("http")) {
        try {
            // Primero usamos HEAD para obtener la URL expandida sin descargar todo el contenido
            const headRes = await axios.head(urlInput, {
                headers: ML_HEADERS,
                maxRedirects: 10,
                timeout: 8000,
                validateStatus: (status) => status < 500
            });
            
            // Obtenemos la URL final después de redirecciones
            let finalUrl = headRes.request?.res?.responseUrl || 
                          headRes.request?.responseURL || 
                          headRes.config?.url || 
                          "";
            
            // Si el HEAD no resolvió, intentamos con GET
            if (!finalUrl.includes("MLA")) {
                const getRes = await axios.get(urlInput, {
                    headers: ML_HEADERS,
                    maxRedirects: 10,
                    timeout: 8000,
                    validateStatus: (status) => status < 500
                });
                
                finalUrl = getRes.request?.res?.responseUrl || 
                          getRes.request?.responseURL || 
                          finalUrl;
                
                const content = typeof getRes.data === 'string' ? getRes.data : "";
                const comboMatch = (finalUrl + content).match(/MLA-?\d{8,15}/i);
                if (comboMatch) {
                    itemId = comboMatch[0].replace(/-/g, "").toUpperCase();
                }
            } else {
                // El HEAD ya nos dio la URL con el ID
                const match = finalUrl.match(/MLA-?\d{8,15}/i);
                if (match) {
                    itemId = match[0].replace(/-/g, "").toUpperCase();
                }
            }
        } catch (e) {
            console.error("Fallo al resolver referido:", e.message);
            // Intento de rescate: buscar ID en la URL del error (redirección parcial)
            const errUrl = e.response?.request?.res?.responseUrl || 
                          e.config?.url || 
                          "";
            const match = errUrl.match(/MLA-?\d{8,15}/i);
            if (match) itemId = match[0].replace(/-/g, "").toUpperCase();
        }
    }

    if (!itemId) {
        throw new HttpsError("invalid-argument", "Error de transmutación: El link de referido no reveló un ID (MLA). Prueba pegando el link largo.");
    }

    try {
        // 2. Llamada a API en paralelo (Usamos headers más limpios para la API)
        const [itemRes, descRes] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: API_HEADERS }),
            axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: API_HEADERS }).catch(() => ({ data: { plain_text: "" } }))
        ]);

        const item = itemRes.data;
        const rawDescription = descRes.data.plain_text || "Sin descripción disponible.";

        // 3. Ficha Técnica (Atributos)
        const specs = (item.attributes || []).map(attr => `${attr.name}: ${attr.value_name}`);
        const textoFicha = specs.length > 0 ? specs.map(s => `• ${s}`).join("\n") : "• Calidad: Super M Lab";

        // 4. Retorno de Datos con estructura exacta
        return {
            id: itemId,
            n: item.title,
            p: item.price || (item.buy_box_winner ? item.buy_box_winner.price : 0),
            i: (item.pictures && item.pictures.length > 0) ? [item.pictures[0].secure_url] : [(item.thumbnail || "").replace("-I.jpg", "-O.jpg")],
            desc: rawDescription,
            specs: specs,
            texto: textoFicha,
            link: item.permalink || urlInput
        };

    } catch (error) {
        console.error("Error en obtenerProductoML:", error.message);
        
        // TÉCNICA DE RESPALDO DE ID: Si la API oficial da 403, intentamos ruta alternativa
        if (error.response && error.response.status === 403) {
            console.log("🔄 Intentando ruta de respaldo para itemId:", itemId);
            
            try {
                // API pública sin headers complejos - solo User-Agent básico
                const simpleRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36'
                    },
                    timeout: 5000
                });
                
                const item = simpleRes.data;
                return {
                    id: itemId,
                    n: item.title || "Producto Mercado Libre",
                    p: item.price || 0,
                    i: (item.pictures && item.pictures.length > 0) ? [item.pictures[0].secure_url] : ["🌿"],
                    desc: "Descripción no disponible (API bloqueada)",
                    specs: [],
                    texto: "• Ficha técnica no disponible (ML bloqueó acceso parcial)",
                    link: item.permalink || urlInput
                };
            } catch (respaldoError) {
                console.error("Ruta de respaldo también falló:", respaldoError.message);
            }
        }
        
        // Si todo falla, devolvemos objeto con campos vacíos pero con el ID extraído
        // Esto permite que el changuito.html abra el editor para carga manual
        if (itemId) {
            console.log("⚠️ Devolviendo objeto vacío con ID:", itemId);
            return {
                id: itemId,
                n: "Producto Super M (Editar manualmente)",
                p: 0,
                i: ["🌿"],
                desc: "Los datos no pudieron ser extraídos. Completar manualmente.",
                specs: [],
                texto: "• Producto sin ficha técnica. Completar manualmente.",
                link: urlInput
            };
        }
        
        // Error fatal - no hay ID extraído
        if (error.response) {
            const status = error.response.status;
            if (status === 404) {
                throw new HttpsError("not-found", "Error de Laboratorio: El producto no existe en Mercado Libre. Verifica el ID.");
            } else if (status === 429) {
                throw new HttpsError("resource-exhausted", "Error de Laboratorio: Demasiadas peticiones. Espera un momento.");
            } else {
                throw new HttpsError("internal", `Error de Laboratorio: ML respondió con código ${status}. Verifica el ID o link.`);
            }
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
            throw new HttpsError("unavailable", "Error de Laboratorio: No se pudo conectar con ML. Verifica tu conexión.");
        } else {
            throw new HttpsError("internal", "Error de Laboratorio: ML bloqueó el acceso o el ID es inválido. Intenta con otro link.");
        }
    }
});
