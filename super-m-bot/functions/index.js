const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

// Headers optimizados para Mercado Libre - User-Agent real de navegador
const ML_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'es-AR,es;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Sec-Ch-Ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1'
};

// Función para obtener headers API con Authorization
async function getApiHeaders() {
    try {
        const configDoc = await admin.firestore()
            .collection('settings')
            .doc('mercadolibre_auth')
            .get();
        
        const accessToken = (configDoc.data()?.access_token || '').trim();
        
        const apiHeaders = {
            'Accept': 'application/json',
            'User-Agent': 'MELI-SDK-JS/1.0.0'
        };
        
        if (accessToken) apiHeaders['Authorization'] = `Bearer ${accessToken}`;
        return apiHeaders;
    } catch (error) {
        console.error("❌ Fallo al leer Firestore:", error.message);
        return { 'Accept': 'application/json', 'User-Agent': 'MELI-SDK-JS/1.0.0' };
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
            const res = await axios.get(urlInput, {
                headers: { ...ML_HEADERS, 'Referer': 'https://www.google.com/', 'Sec-Fetch-Site': 'cross-site' },
                maxRedirects: 10,
                timeout: 15000,
                validateStatus: (status) => status < 500
            });

            const finalUrl = res.request?.res?.responseUrl || res.request?.responseURL || urlInput;
            const content = typeof res.data === 'string' ? res.data : "";
            const comboMatch = (finalUrl + content).match(/MLA-?\d{8,15}/i) || 
                               content.match(/item_id":"(MLA\d+)"/i) || 
                               content.match(/id="itemId"\s+value="(MLA\d+)"/i);
            

            if (comboMatch) {
                const rawId = Array.isArray(comboMatch) ? comboMatch[1] || comboMatch[0] : comboMatch;
                itemId = rawId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
            }
        } catch (e) {
            console.error("Fallo al resolver referido:", e.message);
            const errUrl = e.response?.request?.res?.responseUrl || 
                          e.request?.res?.responseUrl ||
                          e.config?.url || 
                          "";
            const match = errUrl.match(/MLA-?\d{8,15}/i);
            if (match) itemId = match[0].replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        }
    }

    if (!itemId || !itemId.startsWith("MLA")) {
        throw new HttpsError("invalid-argument", "No se detectó un ID (MLA). Intenta con el link largo.");
    }

    console.log(`🔎 [SUPER-M-BOT] ID: ${itemId}`);

    const apiHeaders = await getApiHeaders();
    let itemData, descData;

    try {
        // 1er Intento: Con Token
        const [itemRes, descRes] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: apiHeaders }),
            axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: apiHeaders }).catch(() => ({ data: { plain_text: "" } }))
        ]);
        itemData = itemRes.data;
        descData = descRes.data;
    } catch (error) {
        const status = error.response?.status;
        console.warn(`⚠️ Error ${status} con token. Reintentando acceso público...`);

        try {
            // 2do Intento: Público
            const pubHeaders = { 'Accept': 'application/json', 'User-Agent': 'MELI-SDK-JS/1.0.0' };
            const [itemRes, descRes] = await Promise.all([
                axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: pubHeaders }),
                axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: pubHeaders }).catch(() => ({ data: { plain_text: "" } }))
            ]);
            itemData = itemRes.data;
            descData = descRes.data;
        } catch (e) {
            const finalStatus = e.response?.status || 500;
            if (finalStatus === 403) throw new HttpsError("permission-denied", "ML bloqueó el acceso (403).");
            if (finalStatus === 404) throw new HttpsError("not-found", "Producto no encontrado.");
            throw new HttpsError("internal", `Error API (Status ${finalStatus})`);
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
