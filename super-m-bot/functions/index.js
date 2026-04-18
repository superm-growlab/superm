const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

exports.obtenerProductoML = onCall({ 
    region: 'us-central1',
    cors: true,
    maxInstances: 10 
}, async (request) => {
    const url = (request.data.url || "").trim();
    
    if (!url) {
        throw new HttpsError("invalid-argument", "Falta la URL del producto.");
    }

    // Extractor de ID ultra-flexible
    // Busca: MLA123..., /p/MLA123..., o bloques de 9-12 dígitos que ML usa como ID
    const patterns = [
        /(?:MLA|mla)[-_]?(\d{8,15})/i,        // Caso estándar: MLA-12345...
        /\/p\/(?:MLA|mla)?(\d{8,15})/i,      // Caso catálogo: /p/MLA12345...
        //-(?:[/?#-]|$|(?=_))/   // Caso numérico puro: .../123456789...
    ];

    let itemId = null;
    for (const p of patterns) {
        const match = url.match(p);
        if (match && match[1]) {
            itemId = `MLA${match[1]}`;
            break;
        }
    }

    if (!itemId) {
        console.error("DEBUG - URL que falló:", url);
        throw new HttpsError("invalid-argument", `No detectamos un ID válido en: ${url.substring(0, 30)}...`);
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
            id: itemId,
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