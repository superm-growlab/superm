const { onCall, HttpsError } = require("firebase-functions/v2/https");
const axios = require("axios");

exports.obtenerProductoML = onCall({ timeoutSeconds: 60, memory: "1GiB" }, async (request) => {
    const urlInput = request.data.url;
    if (!urlInput) throw new HttpsError("invalid-argument", "URL requerida");

    try {
        console.log(`🔍 Procesando link: ${urlInput}`);
        
        // Capa 1: Buscar ID directamente en el link (MLA-123 o MLA123)
        const mlaRegex = /(MLA|MLB|MLM|MLC|MLU)[-_]?(\d{8,15})/i;
        let mlaMatch = urlInput.match(mlaRegex);
        let urlToProcess = urlInput;
        let htmlContent = null;

        // Capa 2: Si no hay ID (links cortos meli.la), navegar para encontrar el link real
        if (!mlaMatch) {
            console.log("📡 Resolviendo link corto o complejo...");
            const res = await axios.get(urlInput, {
                maxRedirects: 10,
                validateStatus: null,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
            });
            
            // Obtener la URL final después de todas las redirecciones
            urlToProcess = res.request?.res?.responseUrl || res.request?._redirectable?._currentUrl || res.config?.url || urlInput;
            mlaMatch = urlToProcess.match(mlaRegex);
            htmlContent = res.data;

            // Capa 3: Si aún no hay ID en la URL, buscar en el HTML (etiquetas canonical u og:url)
            if (!mlaMatch && typeof htmlContent === 'string') {
                console.log("🕵️ Buscando ID dentro de los metadatos del HTML...");
                const metaMatch = htmlContent.match(/property="og:url"\s+content="([^"]+)"/i) || 
                                  htmlContent.match(/rel="canonical"\s+href="([^"]+)"/i);
                if (metaMatch) mlaMatch = metaMatch[1].match(mlaRegex);
            }
        }

        if (!mlaMatch) throw new Error(`No se pudo detectar el ID en: ${urlToProcess}. Asegurate que sea un producto de Mercado Libre.`);

        const itemId = (mlaMatch[1] + mlaMatch[2]).toUpperCase();
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