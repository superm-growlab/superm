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

// Función para renovar el token usando el refresh_token
async function refreshMLToken() {
    const configRef = admin.firestore().collection('settings').doc('mercadolibre_auth');
    const configDoc = await configRef.get();
    const data = configDoc.data();

    if (!data?.refresh_token) throw new Error("No se encontró refresh_token en Firestore.");

    const clientId = data.client_id || '4527719550878051'; // Fallback al ID que me pasaste
    const clientSecret = data.client_secret;

    if (!clientId || !clientSecret) throw new Error("MISSING_CLIENT_CREDENTIALS");

    console.log("🔄 Renovando Access Token...");
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('refresh_token', data.refresh_token);

    const response = await axios.post('https://api.mercadolibre.com/oauth/token', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!response.data.access_token) {
        throw new Error("La respuesta de ML no incluyó un access_token.");
    }

    console.log("✅ [ML-AUTH] Token renovado exitosamente.");
    const newAuth = {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await configRef.update(newAuth);
    return response.data.access_token;
}

// Función auxiliar para intentar petición pública si el token falla
async function fetchPublico(itemId) {
    console.log(`🌐 [PLAN B] Intentando acceso público para ${itemId}...`);
    try {
        const [itemRes, descRes] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: ML_HEADERS }),
            axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: ML_HEADERS }).catch(() => ({ data: { plain_text: "" } }))
        ]);
        return { item: itemRes.data, desc: descRes.data };
    } catch (e) {
        console.error("❌ [PLAN B] También falló el acceso público:", e.message);
        throw e;
    }
}

exports.obtenerProductoML = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
    const urlInput = request.data.url;
    let itemId = "";
    
    // 1. Obtener Token de Firestore inmediatamente para usarlo en todo el proceso
    const configDoc = await admin.firestore().collection('settings').doc('mercadolibre_auth').get();
    const configData = configDoc.data();
    let accessToken = configData?.access_token || "";
    const authHeaders = { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' };

    if (urlInput.includes("MLA")) {
        const match = urlInput.match(/MLA-?\d{8,15}/i);
        if (match) itemId = match[0].replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    } else {
        try {
            // Intentamos resolver el link corto usando los headers identificados para evitar bloqueos
            const res = await axios.get(urlInput, {
                headers: { ...ML_HEADERS, ...authHeaders, 'Referer': 'https://www.google.com/' },
                maxRedirects: 10,
                timeout: 10000
            });
            const content = typeof res.data === 'string' ? res.data : "";
            const comboMatch = content.match(/item_id":"(MLA\d+)"/i) || content.match(/id="itemId"\s+value="(MLA\d+)"/i);
            if (comboMatch) itemId = comboMatch[1];
        } catch (e) {
            console.error("❌ Fallo al resolver link con token, reintentando anónimo:", e.message);
        }
    }

    if (!itemId) throw new HttpsError("invalid-argument", "No se detectó un ID (MLA).");

    let itemData, descData;

    try {
        // 2. Intento Principal: API de Mercado Libre con Token
        console.log(`📡 Solicitando item ${itemId} con token...`);
        const [itemRes, descRes] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: authHeaders }),
            axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: authHeaders }).catch(() => ({ data: { plain_text: "" } }))
        ]);
        itemData = itemRes.data;
        descData = descRes.data;
    } catch (error) {
        const status = error.response?.status || error.status;
        if (status === 401 || status === 403) {
            try {
                console.log(`🔑 [ML-AUTH] Error ${status}. Intentando refrescar token...`);
                const newToken = await refreshMLToken();
                
                const [itemRes, descRes] = await Promise.all([
                    axios.get(`https://api.mercadolibre.com/items/${itemId}`, { 
                        headers: { 'Authorization': `Bearer ${newToken}`, 'Accept': 'application/json' } 
                    }),
                    axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { 
                        headers: { 'Authorization': `Bearer ${newToken}`, 'Accept': 'application/json' } 
                    }).catch(() => ({ data: { plain_text: "" } }))
                ]);
                itemData = itemRes.data;
                descData = descRes.data;
            } catch (retryError) {
                console.warn("⚠️ [ML-AUTH] Falló el token y el refresh. Ejecutando Plan B...");
                const publicData = await fetchPublico(itemId).catch(() => {
                    throw new HttpsError("permission-denied", "ML bloqueó el acceso (403). Verifica que tu App sea de Producción y tus llaves sean nuevas.");
                });
                itemData = publicData.item;
                descData = publicData.desc;
            }
        } else {
            throw new HttpsError("internal", `Error de comunicación con ML: ${error.message}`);
        }
    }

    // Procesamiento de Ficha Técnica
    const specs = (itemData.attributes || []).map(a => `${a.name}: ${a.value_name}`).slice(0, 10);
    const textoFicha = specs.map(s => `• ${s}`).join('\n');

    return {
        id: itemData.id,
        n: itemData.title,
        p: itemData.price || 0,
        i: (itemData.pictures && itemData.pictures.length > 0) 
            ? itemData.pictures.slice(0, 3).map(pic => pic.secure_url) 
            : [itemData.thumbnail],
        desc: descData.plain_text || "Sin descripción.",
        specs: specs,
        texto: textoFicha,
        link: itemData.permalink || urlInput
    };
});
