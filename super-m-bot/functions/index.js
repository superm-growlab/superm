const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const { MercadoPagoConfig, Items } = require('mercadopago');

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
        
        const data = configDoc.data();
        const accessToken = (data?.access_token || '').trim();

        if (accessToken) {
            console.log(`🔑 [ML-AUTH] Token detectado en Firestore (Inicia con: ${accessToken.substring(0, 10)}...)`);
        } else {
            console.warn("⚠️ [ML-AUTH] No se encontró access_token en Firestore.");
        }

        const apiHeaders = {
            ...ML_HEADERS,
            'Accept': 'application/json',
        };
        
        if (accessToken) apiHeaders['Authorization'] = `Bearer ${accessToken}`;
        return apiHeaders;
    } catch (error) {
        console.error("❌ Fallo al leer Firestore:", error.message);
        return { ...ML_HEADERS, 'Accept': 'application/json' };
    }
}

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

    const newAuth = {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
    };

    await configRef.update(newAuth);
    return response.data.access_token;
}

exports.obtenerProductoML = onCall({ region: 'us-central1', timeoutSeconds: 30 }, async (request) => {
    const urlInput = request.data.url;
    let itemId = "";

    if (urlInput.includes("MLA")) {
        const match = urlInput.match(/MLA-?\d{8,15}/i);
        if (match) itemId = match[0].replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    } else {
        try {
            const res = await axios.get(urlInput, {
                headers: { ...ML_HEADERS, 'Referer': 'https://www.google.com/' },
                maxRedirects: 10,
                timeout: 10000
            });
            const content = typeof res.data === 'string' ? res.data : "";
            const comboMatch = content.match(/item_id":"(MLA\d+)"/i) || content.match(/id="itemId"\s+value="(MLA\d+)"/i);
            if (comboMatch) itemId = comboMatch[1];
        } catch (e) {
            console.error("Fallo al resolver link:", e.message);
        }
    }

    if (!itemId) throw new HttpsError("invalid-argument", "No se detectó un ID (MLA).");

    // 1. Obtener Token de Firestore e inicializar SDK de Mercado Pago
    const configDoc = await admin.firestore().collection('settings').doc('mercadolibre_auth').get();
    const configData = configDoc.data();
    let accessToken = configData?.access_token || "";

    let client = new MercadoPagoConfig({ accessToken: accessToken });
    let itemsClient = new Items(client);

    let itemData, descData;

    try {
        // 2. Intento Principal: Usando el SDK Items
        itemData = await itemsClient.get({ id: itemId });
        
        // La descripción requiere axios (el SDK de MP no maneja el endpoint de catálogo /description)
        const descRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }).catch(() => ({ data: { plain_text: "" } }));
        descData = descRes.data;
    } catch (error) {
        // 3. Manejo de errores de autenticación con Refresco automático
        const status = error.status || error.response?.status;
        if (status === 401 || status === 403) {
            try {
                accessToken = await refreshMLToken();
                client = new MercadoPagoConfig({ accessToken: accessToken });
                itemsClient = new Items(client);
                
                itemData = await itemsClient.get({ id: itemId });
                const descRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                }).catch(() => ({ data: { plain_text: "" } }));
                descData = descRes.data;
            } catch (retryError) {
                throw new HttpsError("permission-denied", "Token expirado y no se pudo renovar.");
            }
        } else {
            // Plan B: Intento público via Axios si el SDK falla por otras razones
            try {
                const [itemRes, descRes] = await Promise.all([
                    axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: { ...ML_HEADERS, 'Accept': 'application/json' } }),
                    axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: { ...ML_HEADERS, 'Accept': 'application/json' } }).catch(() => ({ data: { plain_text: "" } }))
                ]);
                itemData = itemRes.data;
                descData = descRes.data;
            } catch (e) {
                throw new HttpsError("internal", "Error crítico de conexión con Mercado Libre.");
            }
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
