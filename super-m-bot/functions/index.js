const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

/**
 * Obtiene un Access Token válido desde Firestore o lo renueva si expiró.
 */
async function getAccessToken() {
    const tokenRef = db.collection("settings").doc("mercadolibre_auth");
    const doc = await tokenRef.get();

    if (!doc.exists) {
        throw new Error("No se encontró la configuración de Mercado Libre en Firestore (settings/mercadolibre_auth)");
    }

    const data = doc.data();
    const now = Date.now();

    // Convertimos expires_at a milisegundos si es un Timestamp de Firestore o lo usamos como número
    let expiresAt = data.expires_at;
    if (expiresAt && typeof expiresAt.toMillis === 'function') {
        expiresAt = expiresAt.toMillis();
    }

    // Validamos que exista el token y que no haya expirado (con margen de 5 min)
    if (data.access_token && expiresAt && expiresAt > (now + 300000)) {
        return data.access_token;
    }

    console.log("🔄 El Access Token expiró o no existe. Renovando...");

    // Si expiró, usamos el refresh_token para obtener uno nuevo
    try {
        const params = new URLSearchParams();
        params.append("grant_type", "refresh_token");
        params.append("client_id", data.client_id);
        params.append("client_secret", data.client_secret);
        params.append("refresh_token", data.refresh_token);

        const res = await axios.post("https://api.mercadolibre.com/oauth/token", params);
        const nuevoToken = res.data;

        const updates = {
            access_token: nuevoToken.access_token,
            refresh_token: nuevoToken.refresh_token, // ML suele dar uno nuevo
            expires_at: Date.now() + (nuevoToken.expires_in * 1000),
            user_id: nuevoToken.user_id || data.user_id // Mantenemos el user_id en el registro
        };

        await tokenRef.update(updates);
        return nuevoToken.access_token;
    } catch (error) {
        console.error("❌ Error renovando el token:", error.response?.data || error.message);
        throw new Error("Fallo en la autenticación con Mercado Libre. Revisa el refresh_token.");
    }
}

exports.obtenerProductoML = onCall({ timeoutSeconds: 60, memory: "1GiB" }, async (request) => {
    const urlInput = request.data.url;
    const productIdInput = request.data.productId;

    // Modo prueba de conexión
    if (request.data.action === "test") {
        const token = await getAccessToken();
        return { status: "success", message: "Conexión con Mercado Libre exitosa. Llaves activas.", token: token.substring(0, 15) + "..." };
    }

    if (!urlInput && !productIdInput) throw new HttpsError("invalid-argument", "Se requiere URL o ID de producto");

    try {
        // Obtener la llave maestra para esta petición
        const accessToken = await getAccessToken();

        console.log(`🔍 Procesando link: ${urlInput} | ID Manual: ${productIdInput}`);
        
        // Capa 1: Buscar ID directamente en el link (MLA-123 o MLA123)
        const mlaRegex = /(MLAU|MLA|MLB|MLM|MLC|MLU)[-_]?(\d{8,15})\b/i;
        const catalogIdRegex = /\b([A-Z0-9]{5,12}-[A-Z0-9]{4,12})\b/i;

        let mlaMatch = urlInput.match(mlaRegex);
        let catalogMatch = urlInput.match(catalogIdRegex);
        let urlToProcess = urlInput;

        // Capa 2: Si no hay ID detectado y parece ser un link, intentamos resolverlo
        if (!mlaMatch && !catalogMatch && urlInput && urlInput.toLowerCase().startsWith("http")) {
            console.log("📡 Resolviendo link corto o complejo...");
            const res = await axios.get(urlInput, {
                maxRedirects: 15,
                timeout: 20000,
                validateStatus: (status) => status < 500, 
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language': 'es-AR,es;q=0.8,en-US;q=0.5,en;q=0.3',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Referer': 'https://www.google.com/'
                }
            });
            
            if (res.status === 404) {
                throw new Error("Mercado Libre devolvió 404 al intentar resolver el link. El producto podría no estar disponible o el link es inválido.");
            }

            // Obtener la URL final después de todas las redirecciones
            urlToProcess = res.request?.res?.responseUrl || res.request?._redirectable?._currentUrl || res.config?.url || urlInput;
            console.log(`📍 URL final resuelta: ${urlToProcess}`);
            
            mlaMatch = urlToProcess.match(mlaRegex);
            catalogMatch = urlToProcess.match(catalogIdRegex);

            // Búsqueda de emergencia profunda: Escanear metadatos específicos del HTML
            if (!mlaMatch && !catalogMatch && res.data && typeof res.data === 'string') {
                console.log("🕵️ ID no hallado en URL. Escaneando metadatos del producto...");
                // Intentamos buscar en los tags de URL canónica u og:url que son mucho más fiables
                const metaIdMatch = res.data.match(/property="og:url"\s+content="[^"]*?([A-Z0-9]{5,12}-[A-Z0-9]{4,12}|MLA[U]?[-_]?\d{8,15})[^"]*?"/i) ||
                                   res.data.match(/rel="canonical"\s+href="[^"]*?([A-Z0-9]{5,12}-[A-Z0-9]{4,12}|MLA[U]?[-_]?\d{8,15})[^"]*?"/i);
                
                if (metaIdMatch) {
                    const found = metaIdMatch[1];
                    console.log(`📌 ID extraído de metadatos: ${found}`);
                    catalogMatch = found.match(catalogIdRegex);
                    mlaMatch = found.match(mlaRegex);
                }

                // Si falla, escaneo global (último recurso)
                if (!mlaMatch && !catalogMatch) {
                    catalogMatch = res.data.match(catalogIdRegex);
                    mlaMatch = res.data.match(mlaRegex);
                }
            }
        }

        if (!mlaMatch && !catalogMatch) throw new Error(`No se detectó un ID de producto válido. Asegúrate de que sea un link directo de Mercado Libre.`);

        // SELECCIÓN DE ID CON PRIORIDAD ABSOLUTA
        let itemId = null;

        if (productIdInput) {
            // 1. Prioridad máxima al ID manual ingresado por el usuario
            itemId = productIdInput.toUpperCase();
            console.log(`🎯 Usando ID manual: ${itemId}`);
        } else if (catalogMatch) {
            // 2. Si no hay manual, buscamos IDs de catálogo en el link
            const possibleId = catalogMatch[0].toUpperCase();
            if (possibleId !== "ASSETS-PREFIX" && possibleId !== "IMAGE-SIZE") {
                itemId = possibleId;
            }
        }
        
        // 3. Por último, usamos el ID MLA/MLAU del link
        if (!itemId && mlaMatch) {
            itemId = (mlaMatch[1] + mlaMatch[2]).toUpperCase();
        }

        if (!itemId) throw new Error("No se pudo determinar un ID de producto válido tras el escaneo.");

        console.log(`📡 Consultando API oficial de ML para el item: ${itemId}`);

        // 2. Llamada a la API de Mercado Libre (Híbrida: Items o Products)
        let item;
        const catalogIdRegexStrict = /\b([A-Z0-9]{5,12}-[A-Z0-9]{4,12})\b/i;
        const isCatalogID = catalogIdRegexStrict.test(itemId) || itemId.startsWith("MLAU");

        // Función interna para normalizar datos de producto a item
        const normalizeProduct = (data) => {
            data.title = data.name || data.title;
            if (data.buy_box_winner) data.price = data.buy_box_winner.price;
            return data;
        };

        try {
            if (isCatalogID) {
                try {
                    console.log("📦 Intentando API /products...");
                    var usedApi = "/products";
                    const res = await axios.get(`https://api.mercadolibre.com/products/${itemId}`, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                    item = normalizeProduct(res.data);
                } catch (e) {
                    if (e.response?.status === 404) {
                        console.log("🔄 No hallado en products. Reintentando en /items...");
                        usedApi = "/items (fallback)";
                        const res = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        item = res.data;
                    } else throw e;
                }
            } else {
                try {
                    console.log("🏷️ Intentando API /items...");
                    usedApi = "/items";
                    const res = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                    item = res.data;
                } catch (e) {
                    if (e.response?.status === 404) {
                        console.log("🔄 No hallado en items. Reintentando en /products...");
                        usedApi = "/products (fallback)";
                        const res = await axios.get(`https://api.mercadolibre.com/products/${itemId}`, {
                            headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        item = normalizeProduct(res.data);
                    } else throw e;
                }
            }
        } catch (err) {
            const status = err.response?.status || "unknown";
            console.error(`❌ Error final [${status}] para ID ${itemId}:`, err.response?.data || err.message);
            throw new Error(`El producto ${itemId} devolvió error ${status}. Puede estar pausado o ser de una categoría restringida.`);
        }

        const nombre = item.title || "Producto Super M";
        const precio = item.price || 0;
        const categoryId = item.category_id;
        let nombreCategoria = "General";

        // 2.5 Consultar el nombre de la categoría (La "planilla" de categorías de ML)
        try {
            if (categoryId) {
                const catRes = await axios.get(`https://api.mercadolibre.com/categories/${categoryId}`);
                nombreCategoria = catRes.data.name;
                console.log(`📂 Categoría detectada: ${nombreCategoria} (${categoryId})`);
            }
        } catch (catErr) {
            console.log("No se pudo obtener el nombre de la categoría.");
        }
        
        console.log(`💎 [BOT] Título: ${nombre} | Precio: ${precio}`);

        // 3. Extraer Imágenes (URLs de alta calidad)
        const imagenes = item.pictures 
            ? item.pictures.slice(0, 10).map(p => p.secure_url || p.url) 
            : (item.thumbnail ? [item.thumbnail.replace("-I.jpg", "-O.jpg")] : ["🌿"]);

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
                const descRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}/description`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                textoFicha = descRes.data.plain_text || "";
            } catch (e) {
                console.log("No se pudo obtener descripción de texto.");
            }
        }

        // Si el usuario pegó solo el ID, generamos un permalink válido de ML como respaldo
        const hasUrl = urlInput && urlInput.toLowerCase().startsWith("http");
        const finalPermalink = hasUrl ? urlInput : `https://articulo.mercadolibre.com.ar/${itemId}`;

        return {
            id: itemId,
            title: nombre,
            price: precio,
            pictures: imagenes,
            permalink: finalPermalink,
            attributes: caracteristicas,
            description: textoFicha,
            category_id: categoryId,
            category_name: nombreCategoria,
            status: "Transmutación Exitosa",
            debug: {
                api_usada: usedApi,
                id_procesado: itemId,
                token_valido: true
            }
        };

    } catch (error) {
        console.error("Error en botTransmutar:", error.message);
        throw new HttpsError("internal", "Error al conectar con Mercado Libre: " + error.message);
    }
});