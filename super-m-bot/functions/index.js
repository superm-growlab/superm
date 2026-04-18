const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

// Configuración de Headers globales para engañar a los filtros de ML
const ML_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'es-AR,es;q=0.9',
    'Connection': 'keep-alive'
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
            // Usamos headers de navegador (HTML) para resolver el link corto
            const res = await axios.get(urlInput, { 
                headers: { ...ML_HEADERS, 'Accept': 'text/html' }, 
                maxRedirects: 10, 
                timeout: 8000 
            });
            
            const finalUrl = res.request?.res?.responseUrl || res.request?.responseURL || res.config?.url || "";
            
            // Buscamos el ID en la URL final o en el cuerpo del HTML (canonical/meta tags)
            const comboMatch = (finalUrl + res.data).match(/(MLA|mla)-?\d{8,15}/i);
            if (comboMatch) {
                itemId = comboMatch[0].replace(/-/g, "").toUpperCase();
            }
        } catch (e) { console.error("Fallo al resolver referido:", e.message); }
    }

    if (!itemId) {
        throw new HttpsError("invalid-argument", "Error de transmutación: El link de referido no reveló un ID (MLA). Prueba pegando el link largo.");
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
        const textoFicha = specs.length > 0 ? specs.map(s => `• ${s}`).join("\n") : "• Calidad: Super M Lab";

        // 4. Retorno de Datos con estructura exacta
        return {
            id: itemId, // Para que el editor use el MLA real como ID del documento
            n: item.title,
            p: item.price || (item.buy_box_winner ? item.buy_box_winner.price : 0),
            i: (item.pictures && item.pictures.length > 0) ? [item.pictures[0].secure_url] : [item.thumbnail.replace("-I.jpg", "-O.jpg")],
            desc: rawDescription,
            specs: specs, // Para el campo de chips en el editor
            texto: textoFicha, // CAMPO VITAL
            link: item.permalink || urlInput
        };

    } catch (error) {
        console.error("Error en obtenerProductoML:", error.message);
        const status = error.response ? error.response.status : 500;
        throw new HttpsError("internal", `Error de transmutación: Verifica el ID o Link (ML Error ${status})`);
    }
});