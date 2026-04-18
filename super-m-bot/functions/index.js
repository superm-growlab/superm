const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

exports.obtenerProductoML = onCall({ 
    region: 'us-central1',
    cors: true,
    maxInstances: 10 
}, async (request) => {
    const url = request.data.url;
    
    if (!url) {
        throw new HttpsError("invalid-argument", "Falta la URL del producto.");
    }

    const mlaMatch = url.match(/MLA[-_]?(\d+)/i);
    const itemId = mlaMatch ? `MLA${mlaMatch[1]}` : null;

    if (!itemId) {
        throw new HttpsError("invalid-argument", "No se pudo identificar un ID de Mercado Libre válido (MLA) en el enlace.");
    }

    try {
        const [itemRes, descRes] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/items/${itemId}`),
            axios.get(`https://api.mercadolibre.com/items/${itemId}/description`).catch(() => ({ data: { plain_text: "" } }))
        ]);

        const item = itemRes.data;

        const caracteristicas = item.attributes 
            ? item.attributes.map(attr => `${attr.name}: ${attr.value_name}`).slice(0, 10) 
            : ["Calidad Super M Growlab"];

        const textoFicha = caracteristicas.map(c => "• " + c).join("\n");

        return {
            n: item.title,
            p: item.price || 0,
            i: item.pictures && item.pictures.length > 0 ? [item.pictures[0].secure_url] : [item.thumbnail],
            desc: descRes.data.plain_text || "Producto verificado por Super M Lab.",
            specs: caracteristicas,
            texto: textoFicha, 
            link: url
        };
    } catch (error) {
        console.error("ML API Error:", error.message);
        throw new HttpsError("internal", "Error de comunicación con la API de Mercado Libre. Verifica el link.");
    }
});