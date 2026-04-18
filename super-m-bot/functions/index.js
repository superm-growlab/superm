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
    const input = (request.data.url || "").trim();
    
    if (!input) {
        throw new HttpsError("invalid-argument", "Falta el link o ID del producto.");
    }

    const extractId = (text) => {
        const patterns = [
            /((?:MLA|mla)[-_]?\d{8,15})/i,        // MLA-123... (Captura completa)
            /\/p\/(MLA\d{8,15})/i,                // /p/MLA123...
            /\/p\/([A-Z0-9-]+)/i,                 // /p/NG8WAT-S7G4
            /^([A-Z0-9-]{8,20})$/i,               // ID puro (NG8WAT...)
            /MLA(\d+)/i                           // Fallback MLA puro
        ];
        for (const p of patterns) {
            const match = text.match(p);
            if (match && match[1]) {
                let id = match[1].toUpperCase();
                // Limpiamos todos los guiones para el ID de la API
                if (id.includes('MLA')) return id.replace(/-/g, '');
                // Si son solo números de 8 a 15 dígitos, le ponemos el prefijo de Argentina
                if (/^\d{8,15}$/.test(id)) return `MLA${id}`;
                return id;
            }
        }
        return null;
    };

    let itemId = extractId(input);

    // Soporte para links cortos (meli.la o /s/): Resolvemos la redirección para hallar el ID
    if (!itemId && (input.includes("meli.la") || input.includes("/s/"))) {
        try {
            const res = await axios.get(input, { maxRedirects: 5, headers: ML_HEADERS });
            itemId = extractId(res.request.res.responseUrl || res.config.url);
        } catch (e) { console.error("Error siguiendo link corto:", e.message); }
    }

    if (!itemId) {
        console.error("DEBUG - Entrada que falló:", input);
        throw new HttpsError("invalid-argument", `No detectamos un ID válido en la entrada.`);
    }

    console.log("DEBUG - Procesando itemId:", itemId);

    try {
        let itemData, descText = "";

        // --- ESTRATEGIA DE BÚSQUEDA EN CASCADA ---
        try {
            // 1. Intentar como ITEM (MLA...)
            const [itemRes, descRes] = await Promise.all([
                axios.get(`https://api.mercadolibre.com/items/${itemId}`, { timeout: 8000, headers: ML_HEADERS }),
                axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { timeout: 8000, headers: ML_HEADERS }).catch(() => ({ data: { plain_text: "" } }))
            ]);
            itemData = itemRes.data;
            descText = descRes.data.plain_text;
        } catch (e) {
            try {
                // 2. Intentar como PRODUCTO (Catálogo)
                const prodRes = await axios.get(`https://api.mercadolibre.com/products/${itemId}`, { timeout: 8000, headers: ML_HEADERS });
                itemData = prodRes.data;
                descText = "Producto de catálogo verificado por Super M.";
            } catch (e2) {
                // 3. Fallback: Búsqueda por código (Resuelve IDs alfanuméricos como NG8WAT...)
                const searchRes = await axios.get(`https://api.mercadolibre.com/sites/MLA/search?q=${itemId}`, { timeout: 8000, headers: ML_HEADERS });
                if (searchRes.data.results && searchRes.data.results.length > 0) {
                    const firstMatch = searchRes.data.results[0];
                    // Re-intentamos fetch completo con el ID real encontrado en la búsqueda
                    const [itemResF, descResF] = await Promise.all([
                        axios.get(`https://api.mercadolibre.com/items/${firstMatch.id}`, { timeout: 8000, headers: ML_HEADERS }),
                        axios.get(`https://api.mercadolibre.com/items/${firstMatch.id}/description`, { timeout: 8000, headers: ML_HEADERS }).catch(() => ({ data: { plain_text: "" } }))
                    ]);
                    itemData = itemResF.data;
                    descText = descResF.data.plain_text;
                    itemId = firstMatch.id;
                } else {
                    throw new HttpsError("not-found", `No se encontró información para el código: ${itemId}`);
                }
            }
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
            i: item.pictures && item.pictures.length > 0 ? [item.pictures[0].secure_url || item.pictures[0].url] : [item.thumbnail],
            desc: descText || "Producto verificado por Super M Lab.",
            specs: caracteristicas,
            texto: textoFicha, 
            link: item.permalink || input
        };
    } catch (error) {
        console.error("ML API Error completo:", error.response?.data || error.message);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("internal", "Error de comunicación con la API de Mercado Libre. Verifica el link.");
    }
});