const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

exports.obtenerProductoML = onCall({ 
    region: 'us-central1',
    cors: true,
    maxInstances: 10 
}, async (request) => {
    const input = (request.data.url || "").trim();
    
    if (!input) {
        throw new HttpsError("invalid-argument", "Falta el link o ID del producto.");
    }

    const extractId = (text) => {
        const patterns = [
            /(?:MLA|mla)[-_]?(\d{8,15})/i,        // MLA-123...
            /\/p\/([A-Z0-9-]+)/i,                // /p/NG8WAT-S7G4 o /p/MLA123...
            /^([A-Z0-9-]{8,20})$/i                // ID puro (NG8WAT-S7G4)
        ];
        for (const p of patterns) {
            const match = text.match(p);
            if (match && match[1]) return match[1].toUpperCase().startsWith('MLA') ? match[1].toUpperCase().replace('-', '') : match[1].toUpperCase();
        }
        return null;
    };

    let itemId = extractId(input);

    // Soporte para links cortos (meli.la o /s/): Resolvemos la redirección para hallar el ID
    if (!itemId && (input.includes("meli.la") || input.includes("/s/"))) {
        try {
            const res = await axios.get(input, { maxRedirects: 5 });
            itemId = extractId(res.request.res.responseUrl || res.config.url);
        } catch (e) { console.error("Error siguiendo link corto:", e.message); }
    }

    if (!itemId) {
        console.error("DEBUG - Entrada que falló:", input);
        throw new HttpsError("invalid-argument", `No detectamos un ID válido en la entrada.`);
    }

    try {
        let itemData, descText = "";

        // Intentamos primero como ITEM (MLA...)
        try {
            const [itemRes, descRes] = await Promise.all([
                axios.get(`https://api.mercadolibre.com/items/${itemId}`),
                axios.get(`https://api.mercadolibre.com/items/${itemId}/description`).catch(() => ({ data: { plain_text: "" } }))
            ]);
            itemData = itemRes.data;
            descText = descRes.data.plain_text;
        } catch (e) {
            // Si falla o es un PID, intentamos como PRODUCTO (Catálogo)
            const prodRes = await axios.get(`https://api.mercadolibre.com/products/${itemId}`);
            itemData = prodRes.data;
            descText = "Producto de catálogo verificado por Super M.";
        }

        const item = itemData;
        const caracteristicas = item.attributes 
            ? item.attributes.map(attr => `${attr.name}: ${attr.value_name}`).slice(0, 10) 
            : ["Calidad Super M Growlab"];

        const textoFicha = caracteristicas.map(c => "• " + c).join("\n");

        return {
            id: itemId,
            n: item.title,
            p: item.price || (item.buy_box_winner ? item.buy_box_winner.price : 0),
            i: item.pictures && item.pictures.length > 0 ? [item.pictures[0].secure_url] : [item.thumbnail],
            desc: descText || "Producto verificado por Super M Lab.",
            specs: caracteristicas,
            texto: textoFicha, 
            link: item.permalink || input
        };
    } catch (error) {
        console.error("ML API Error completo:", error.response?.data || error.message);
        throw new HttpsError("internal", "Error de comunicación con la API de Mercado Libre. Verifica el link.");
    }
});