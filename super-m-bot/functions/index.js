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

    const extractId = (text) => {
        const patterns = [
            /(?:MLA|mla)[-_]?(\d{8,15})/i,        // MLA-123...
            /\/p\/(?:MLA|mla)?(\d{8,15})/i       // /p/MLA123...
        ];
        for (const p of patterns) {
            const match = text.match(p);
            if (match && match[1]) return `MLA${match[1]}`;
        }
        return null;
    };

    let itemId = extractId(url);

    // Soporte para links cortos (meli.la o /s/): Resolvemos la redirección para hallar el ID
    if (!itemId && (url.includes("meli.la") || url.includes("/s/"))) {
        try {
            const res = await axios.get(url, { maxRedirects: 5 });
            itemId = extractId(res.request.res.responseUrl || res.config.url);
        } catch (e) { console.error("Error siguiendo link corto:", e.message); }
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
            link: item.permalink || url
        };
    } catch (error) {
        console.error("ML API Error:", error.message);
        throw new HttpsError("internal", "Error de comunicación con la API de Mercado Libre. Verifica el link.");
    }
});