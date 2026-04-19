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
    if (!urlInput) throw new HttpsError("invalid-argument", "URL requerida");

    try {
        // Obtener la llave maestra para esta petición
        const accessToken = await getAccessToken();

        console.log(`🔍 Procesando link: ${urlInput}`);
        
        // Capa 1: Buscar ID directamente en el link (MLA-123 o MLA123)
        const mlaRegex = /(MLA|MLB|MLM|MLC|MLU)[-_]?(\d{8,15})/i;
        let mlaMatch = urlInput.match(mlaRegex);
        let urlToProcess = urlInput;

        // Capa 2: Si no hay ID (links cortos meli.la), navegar para encontrar el link real
        if (!mlaMatch) {
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

            // Búsqueda de emergencia profunda: Escanear todo el contenido del HTML en busca de un ID
            if (!mlaMatch && res.data && typeof res.data === 'string') {
                console.log("🕵️ ID no hallado en URL. Escaneando cuerpo de la respuesta...");
                mlaMatch = res.data.match(mlaRegex);
            }
        }

        if (!mlaMatch) throw new Error(`No se detectó un ID de producto válido. Asegúrate de que sea un link directo de Mercado Libre.`);

        const itemId = (mlaMatch[1] + mlaMatch[2]).toUpperCase();
        console.log(`📡 Consultando API oficial de ML para el item: ${itemId}`);

        // 2. Llamada a la API de Mercado Libre (Híbrida: Items o Products)
        let item;
        try {
            try {
                const apiRes = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                item = apiRes.data;
                console.log("✅ Item individual hallado.");
            } catch (err) {
                // Si el item da 404, probamos si es un ID de Producto de Catálogo
                if (err.response && err.response.status === 404) {
                    console.log("⚠️ Item no hallado (404). Intentando como Producto de Catálogo...");
                    const prodRes = await axios.get(`https://api.mercadolibre.com/products/${itemId}`, {
                        headers: { 'Authorization': `Bearer ${accessToken}` }
                    });
                    item = prodRes.data;
                    console.log("✅ Producto de catálogo hallado.");
                    // Normalizamos datos de catálogo
                    item.title = item.name;
                    if (item.buy_box_winner) item.price = item.buy_box_winner.price;
                } else {
                    throw err;
                }
            }
        } catch (err) {
            console.error(`❌ Error final en APIs de ML para ID ${itemId}:`, err.response?.data || err.message);
            throw new Error(`El producto ${itemId} no es accesible. Puede ser un artículo restringido (como vaporizadores), pausado, o de una categoría protegida.`);
        }

        const nombre = item.title || item.name || "Producto Super M";
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

        return {
            id: itemId,
            title: nombre,
            price: precio,
            pictures: imagenes,
            permalink: urlInput,
            attributes: caracteristicas,
            description: textoFicha,
            category_id: categoryId,
            category_name: nombreCategoria,
            status: "Transmutación Exitosa vía API Oficial"
        };

    } catch (error) {
        console.error("Error en botTransmutar:", error.message);
        throw new HttpsError("internal", "Error al conectar con Mercado Libre: " + error.message);
    }
});