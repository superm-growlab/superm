const { onCall, HttpsError } = require("firebase-functions/v2/https");
const axios = require("axios");

exports.obtenerProductoML = onCall({ timeoutSeconds: 60, memory: "1GiB" }, async (request) => {
    const urlInput = request.data.url;
    if (!urlInput) throw new HttpsError("invalid-argument", "URL requerida");

    try {
        let urlToProcess = urlInput;
        let mlaMatch = urlToProcess.match(/MLA[-_]?(\d+)/i);

        // 1. RESOLVER LINKS CORTOS (meli.la, mpago.la, etc)
        if (!mlaMatch) {
            console.log(`🔍 Resolviendo link corto: ${urlInput}`);
            const res = await axios.get(urlInput, {
                maxRedirects: 5,
                validateStatus: null,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
            });
            
            // Buscamos la URL final en la respuesta de la redirección
            urlToProcess = res.request?.res?.responseUrl || res.request?._redirectable?._currentUrl || urlInput;
            mlaMatch = urlToProcess.match(/MLA[-_]?(\d+)/i);
        }

        if (!mlaMatch) throw new Error("No se detectó un ID de Mercado Libre válido (ej: MLA-...). Por favor usa el link completo del producto.");

        const itemId = mlaMatch[0].replace("-", "").toUpperCase();
        console.log(`📡 Consultando API oficial de ML para el item: ${itemId}`);

        // 2. Llamada a la API de Mercado Libre (Sin proxies intermedios)
        const apiRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`);
        const item = apiRes.data;

        const nombre = item.title || "Producto Super M";
        const precio = item.price || 0;
        
        console.log(`💎 [BOT] Título: ${nombre} | Precio: ${precio}`);

        // 3. Extraer Imágenes (URLs de alta calidad)
        const imagenes = item.pictures 
            ? item.pictures.slice(0, 10).map(p => p.secure_url || p.url) 
            : ["🌿"];

        // 4. La "Ficha Técnica" (Atributos)
        const caracteristicas = [];
        if (item.attributes) {
            item.attributes.forEach(attr => {
                if (attr.name && attr.value_name) {
                    caracteristicas.push(`${attr.name}: ${attr.value_name}`);
                }
            });
        }

        // 5. Intentar obtener descripción de texto si no hay atributos
        let textoFicha = "";
        if (caracteristicas.length === 0) {
            try {
                const descRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}/description`);
                textoFicha = descRes.data.plain_text || "";
            } catch (e) {
                console.log("No se pudo obtener descripción de texto.");
            }
        }

        return {
            id: itemId,
            n: nombre,
            p: precio,
            i: imagenes,
            link: urlInput,
            specs: caracteristicas,
            texto: textoFicha,
            status: "Transmutación Exitosa vía API Oficial"
        };

    } catch (error) {
        console.error("Error en botTransmutar:", error.message);
        throw new HttpsError("internal", "Error al conectar con Mercado Libre: " + error.message);
    }
});