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

// Función para obtener headers API con Authorization
async function getApiHeaders() {
    try {
        const configDoc = await admin.firestore()
            .collection('settings')
            .doc('mercadolibre_auth')
            .get();
        
        const accessToken = configDoc.data()?.access_token || '';
        
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'es-AR,es;q=0.9'
        };
        
        if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
        }
        
        return headers;
    } catch (error) {
        console.error("Error obteniendo access token:", error.message);
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'es-AR,es;q=0.9'
        };
    }
}

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
        // 2. Obtener headers con Authorization (Access Token desde Firestore)
        const apiHeaders = await getApiHeaders();
        
        // 3. Llamada a API en paralelo con autenticación
        const [itemRes, descRes] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: apiHeaders }),
            axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: apiHeaders }).catch(() => ({ data: { plain_text: "" } }))
        ]);

        const item = itemRes.data;
        const rawDescription = descRes.data.plain_text || "Sin descripción disponible.";

        // 4. Ficha Técnica (Atributos) - Extracción completa
        const specs = (item.attributes || [])
            .filter(attr => attr.value_name) // Solo atributos con valor
            .map(attr => `${attr.name}: ${attr.value_name}`);
        
        const textoFicha = specs.length > 0 
            ? specs.map(s => `• ${s}`).join("\n") 
            : "• Calidad: Super M Lab";

        // 5. Retorno de Datos con estructura exacta para changuito.html
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
        
        // Si hay error 401 (no autorizado), el token puede estar vencido
        if (error.response && error.response.status === 401) {
            console.error("❌ Token de Mercado Libre inválido o vencido. Revisa Firestore.");
            throw new HttpsError("permission-denied", "Error de Autenticación: El token de ML no es válido. Contacta al administrador.");
        }
        
        // Si todo falla, lanzamos el error
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
