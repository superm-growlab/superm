const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

// Configuración de Headers globales para engañar a los filtros de ML
const ML_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
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

    // 1. Identificación robusta del ID (Regex)
    const match = urlInput.match(/(MLA-?\d{8,15})/i);
    const itemId = match ? match[1].replace(/-/g, "").toUpperCase() : null;

    if (!itemId) {
        throw new HttpsError("invalid-argument", "Link no válido. No se detectó un ID de Mercado Libre (MLA).");
    }

    try {
        // 2. Llamada a API en paralelo
        const [itemRes, descRes] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: ML_HEADERS }),
            axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: ML_HEADERS }).catch(() => ({ data: { plain_text: "" } }))
        ]);

        const item = itemRes.data;
        const rawDescription = descRes.data.plain_text || "Sin descripción disponible.";

        // 3. Ficha Técnica (Atributos)
        const specs = (item.attributes || []).map(attr => `${attr.name}: ${attr.value_name}`);
        
        // Formato con bullets solicitado: • Atributo: Valor\n
        const textoFicha = specs.map(s => `• ${s}`).join("\n");

        // 4. Retorno de Datos con estructura exacta
        return {
            n: item.title,
            p: item.price || (item.buy_box_winner ? item.buy_box_winner.price : 0),
            i: (item.pictures && item.pictures.length > 0) ? [item.pictures[0].secure_url] : [item.thumbnail],
            desc: rawDescription,
            specs: specs,
            texto: textoFicha, // CAMPO VITAL
            link: item.permalink || urlInput
        };

    } catch (error) {
        console.error("Error en obtenerProductoML:", error.message);
        const status = error.response ? error.response.status : 500;
        throw new HttpsError("internal", `Mercado Libre respondió con error (${status}). Revisa el ID.`);
    }
});