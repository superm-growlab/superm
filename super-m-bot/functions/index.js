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
    'Sec-Ch-Ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
};

// Función para obtener headers API con Authorization
async function getApiHeaders() {
    try {
        const configDoc = await admin.firestore()
            .collection('settings')
            .doc('mercadolibre_auth')
            .get();
        
        const accessToken = configDoc.data()?.access_token || '';
        
        const apiHeaders = {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        };
        
        if (accessToken) {
            apiHeaders['Authorization'] = `Bearer ${accessToken.trim()}`;
        } else {
            console.warn("⚠️ Sin access_token en Firestore");
        }
        
        return apiHeaders;
    } catch (error) {
        console.error("❌ Error obteniendo access token:", error.message);
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
    maxInstances: 10,
    timeoutSeconds: 60
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
            // meli.la bloquea peticiones HEAD. Usamos GET con headers de navegación limpia.
            const res = await axios.get(urlInput, {
                headers: { ...ML_HEADERS, 'Referer': 'https://www.mercadolibre.com.ar/' },
                maxRedirects: 10,
                timeout: 15000,
                validateStatus: (status) => status < 500
            });

            const finalUrl = res.request?.res?.responseUrl || res.request?.responseURL || urlInput;
            
            // Buscamos el ID en la URL final o en el cuerpo de la página (a veces está en un script)
            const content = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
            const comboMatch = (finalUrl + content).match(/MLA-?\d{8,15}/i) || content.match(/item_id":"(MLA\d+)"/i);
            
            if (comboMatch) {
                const rawId = Array.isArray(comboMatch) ? comboMatch[1] || comboMatch[0] : comboMatch;
                itemId = rawId.replace(/-/g, "").toUpperCase();
            }
        } catch (e) {
            console.error("Fallo al resolver referido:", e.message);
            // Intento de rescate: buscar ID en la URL del error (redirección bloqueada pero URL visible)
            const errUrl = e.response?.request?.res?.responseUrl || 
                          e.request?.res?.responseUrl ||
                          e.config?.url || 
                          "";
            const match = errUrl.match(/MLA-?\d{8,15}/i);
            if (match) itemId = match[0].replace(/-/g, "").toUpperCase();
        }
    }

    if (!itemId || !itemId.startsWith("MLA")) {
        throw new HttpsError("invalid-argument", "Error de transmutación: El link de referido no reveló un ID (MLA). Prueba pegando el link largo.");
    }

    console.log(`🔎 ID detectado: ${itemId}. Solicitando datos...`);

    const apiHeaders = await getApiHeaders();
    let itemData, descData;

    try {
        // 1er Intento: Con Token de Firestore
        const [itemRes, descRes] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: apiHeaders }),
            axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: apiHeaders }).catch(() => ({ data: { plain_text: "" } }))
        ]);
        itemData = itemRes.data;
        descData = descRes.data;
    } catch (error) {
        const status = error.response?.status;
        console.warn(`⚠️ Error ${status} con token. Reintentando acceso público...`);

        // 2do Intento: Acceso Público (Sin Token) con User-Agent simplificado
        try {
            const publicHeaders = { 'User-Agent': apiHeaders['User-Agent'], 'Accept': 'application/json' };
            const [itemRes, descRes] = await Promise.all([
                axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: publicHeaders }),
                axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: publicHeaders }).catch(() => ({ data: { plain_text: "" } }))
            ]);
            itemData = itemRes.data;
            descData = descRes.data;
        } catch (fallbackError) {
            const finalStatus = fallbackError.response?.status || 500;
            console.error(`❌ Fallo total API ML (${finalStatus}):`, fallbackError.message);
            
            if (finalStatus === 404 || status === 404) {
                throw new HttpsError("not-found", "Producto no encontrado en ML.");
            } else {
                throw new HttpsError("internal", `ML bloqueó el acceso (Error ${finalStatus}). Intenta más tarde o pega el link largo.`);
            }
        }
    }

    // 3. Extracción Avanzada de Ficha Técnica
    // Filtramos atributos irrelevantes como 'Condición del ítem' o 'Marca' si ya están en el título
    const excluidos = ["ITEM_CONDITION", "MARKET_PRICE"];
    
    const specs = (itemData.attributes || [])
        .filter(attr => attr.value_name && attr.name && !excluidos.includes(attr.id))
        .map(attr => `${attr.name}: ${attr.value_name}`);

    // Generamos el campo 'texto' que el Changuito usa para la previsualización
    const textoFicha = specs.length > 0 
        ? specs.map(s => `• ${s}`).join("\n") 
        : `• Origen: ${itemData.listing_type_id}\n• Calidad: Super M Lab`;

    return {
        id: itemId,
        n: itemData.title,
        p: itemData.price || 0,
        // Traemos hasta 3 fotos para tener variedad
        i: (itemData.pictures && itemData.pictures.length > 0) 
            ? itemData.pictures.slice(0, 3).map(pic => pic.secure_url) 
            : [(itemData.thumbnail || "").replace("-I.jpg", "-O.jpg")],
        desc: descData.plain_text || "Sin descripción disponible.",
        specs: specs,
        texto: textoFicha,
        link: itemData.permalink || urlInput
    };
});
