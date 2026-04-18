const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

// Configuración de Headers globales para engañar a los filtros de ML
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'es-AR,es;q=0.9',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none'
};

const API_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json'
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
            // Usamos headers de navegador para resolver el link corto
            const res = await axios.get(urlInput, {
                headers: BROWSER_HEADERS,
                maxRedirects: 10,
                timeout: 8000,
                validateStatus: (status) => status < 500
            });
            
            const finalUrl = res.request?.res?.responseUrl || res.request?.responseURL || res.config?.url || "";
            const content = typeof res.data === 'string' ? res.data : "";
            
            const comboMatch = (finalUrl + content).match(/MLA-?\d{8,15}/i);
            if (comboMatch) {
                itemId = comboMatch[0].replace(/-/g, "").toUpperCase();
            }
        } catch (e) {
            console.error("Fallo al resolver referido:", e.message);
            // Intento de rescate: buscar ID en la URL del error (redirección parcial)
            const errUrl = e.response?.request?.res?.responseUrl || e.config?.url || "";
            const match = errUrl.match(/MLA-?\d{8,15}/i);
            if (match) itemId = match[0].replace(/-/g, "").toUpperCase();
        }
    }

    if (!itemId) {
        throw new HttpsError("invalid-argument", "Error de transmutación: El link de referido no reveló un ID (MLA). Prueba pegando el link largo.");
    }

    try {
        // 2. Llamada a API en paralelo (Usamos headers más limpios para la API)
        const [itemRes, descRes] = await Promise.all([
            axios.get(`https://api.mercadolibre.com/items/${itemId}`, { headers: API_HEADERS }),
            axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, { headers: API_HEADERS }).catch(() => ({ data: { plain_text: "" } }))
        ]);

        const item = itemRes.data;
        const rawDescription = descRes.data.plain_text || "Sin descripción disponible.";

        // 3. Ficha Técnica (Atributos)
        const specs = (item.attributes || []).map(attr => `${attr.name}: ${attr.value_name}`);
        const textoFicha = specs.length > 0 ? specs.map(s => `• ${s}`).join("\n") : "• Calidad: Super M Lab";

        // 4. Retorno de Datos con estructura exacta
        return {
            id: itemId,
            n: item.title,
            p: item.price || (item.buy_box_winner ? item.buy_box_winner.price : 0),
            i: (item.pictures && item.pictures.length > 0) ? [item.pictures[0].secure_url] : [(item.thumbnail || "").replace("-I.jpg", "-O.jpg")],
            desc: rawDescription,
            specs: specs,
            texto: textoFicha,
            link: item.permalink || urlInput
        };

    } catch (error) {
        console.error("Error en obtenerProductoML:", error.message);
        const status = error.response ? error.response.status : 500;
        throw new HttpsError("internal", `Error de transmutación: Verifica el ID o Link (ML Error ${status})`);
    }
});