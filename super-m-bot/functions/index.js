const { onCall, HttpsError } = require("firebase-functions/v2/https");
const axios = require("axios");

exports.obtenerProductoML = onCall({ timeoutSeconds: 60, memory: "1GiB" }, async (request) => {
    const urlInput = request.data.url;
    if (!urlInput) throw new HttpsError("invalid-argument", "URL requerida");

    try {
        // 1. Extraer el ID del producto (MLA...)
        const mlaMatch = urlInput.match(/MLA[-_]?(\d+)/i);
        if (!mlaMatch) throw new Error("No se detectó un ID de Mercado Libre válido.");
        const itemId = mlaMatch[0].replace("-", "");

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