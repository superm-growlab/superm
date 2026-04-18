const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();

exports.obtenerProductoML = onCall({ 
    region: 'us-central1',
    cors: true,
    maxInstances: 10 
}, async (request) => {
    const url = request.data.url;
    
    if (!url) {
        throw new HttpsError("invalid-argument", "Falta la URL del producto.");
    }

    // Intentar extraer el ID de Mercado Libre (MLA...)
    const mlaMatch = url.match(/MLA[-_]?(\d+)/i);
    const itemId = mlaMatch ? `MLA${mlaMatch[1]}` : null;

    if (itemId) {
        try {
            // Consultar la API oficial de Mercado Libre para obtener datos precisos
            const [itemRes, descRes] = await Promise.all([
                axios.get(`https://api.mercadolibre.com/items/${itemId}`),
                axios.get(`https://api.mercadolibre.com/items/${itemId}/description`).catch(() => ({ data: { plain_text: "" } }))
            ]);

            const item = itemRes.data;
            const specs = item.attributes ? item.attributes.map(attr => `${attr.name}: ${attr.value_name}`) : [];
            
            return {
                n: item.title,
                p: item.price || 0,
                i: item.pictures && item.pictures.length > 0 ? item.pictures.map(p => p.secure_url) : [""],
                desc: descRes.data.plain_text || "Producto seleccionado por Super M.",
                specs: specs.length > 0 ? specs : ["Calidad Super M Growlab"],
                texto: specs.map(s => "• " + s).join("\n") || descRes.data.plain_text,
                link: url
            };
        } catch (apiError) {
            console.error("ML API Error, intentando scraping manual...", apiError.message);
        }
    }

    try {
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8'
            }
        });

        const html = response.data;
        
        // 1. Título: og:title o H1
        const tituloMatch = html.match(/property="og:title"\s+content="([^"]+)"/i) || 
                           html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        let titulo = tituloMatch ? tituloMatch[1].replace(/&quot;/g, '"').split('|')[0].trim() : "Producto Super M";

        // 2. Precio: Parser robusto para formatos regionales
        let precio = 0;
        const parsePrecio = (val) => {
            if (!val) return 0;
            let s = val.toString().trim().replace(/[^0-9,.]/g, '');
            // Formato AR: 1.500,50 -> Si tiene punto y coma, el punto es miles y la coma es decimal
            if (s.includes('.') && s.includes(',')) {
                s = s.replace(/\./g, '').replace(',', '.');
            } 
            // Si solo tiene coma (ej: 1500,50)
            else if (s.includes(',')) {
                s = s.replace(',', '.');
            }
            // Si solo tiene punto y parece miles (ej: 15.000)
            else if (s.includes('.') && /\.\d{3}$/.test(s)) {
                s = s.replace(/\./g, '');
            }
            return Math.round(parseFloat(s)) || 0;
        };

        const schemaMatch = html.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/i);
        if (schemaMatch) {
            try {
                const schema = JSON.parse(schemaMatch[1]);
                const item = Array.isArray(schema) ? schema.find(s => s.offers) : schema;
                const offers = item?.offers;
                if (offers && offers.price) precio = parsePrecio(offers.price);
            } catch (e) {}
        }

        if (!precio) {
            const precioMatch = html.match(/property="product:price:amount"[^>]*?content="([\d.,]+)"/i) || 
                               html.match(/itemprop="price"[^>]*?content="([\d.,]+)"/i) ||
                               html.match(/class="andes-money-amount__fraction"[^>]*?>([\d.]+)</i);
            
            if (precioMatch) precio = parsePrecio(precioMatch[1]);
        }

        // 3. Imagen
        const imagenMatch = html.match(/property="og:image"\s+content="([^"]+)"/i) || 
                           html.match(/https:\/\/http2\.mlstatic\.com\/D_NQ_NP_[^"']+\.webp/i);
        let imagen = imagenMatch ? (imagenMatch[1] || imagenMatch[0]) : "";

        // 4. Ficha Técnica (Especificaciones)
        const caracteristicas = [];

        // Intento 1: Nuevo selector de ML para especificaciones (ui-pdp-specs__table__column)
        const specsMatches = html.matchAll(/<th[^>]*class="ui-pdp-specs__table__column"[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*class="ui-pdp-specs__table__column"[^>]*>([\s\S]*?)<\/td>/gi);
        for (const match of specsMatches) {
            const key = match[1].replace(/<[^>]+>/g, '').trim();
            const val = match[2].replace(/<[^>]+>/g, '').trim();
            if (key && val && !caracteristicas.some(c => c.toLowerCase().includes(key.toLowerCase()))) {
                caracteristicas.push(`${key}: ${val}`);
            }
        }

        // Intento 2: Tabla de especificaciones (Andes o UI PDP)
        const tableMatches = html.matchAll(/<tr[^>]*class="[^"]*(?:ui-pdp-table__row|andes-table__row)[^"]*"[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<t[db][^>]*>([\s\S]*?)<\/t[db]>/gi);
        for (const match of tableMatches) {
            const key = match[1].replace(/<[^>]+>/g, '').trim();
            const val = match[2].replace(/<[^>]+>/g, '').replace(/<span[^>]*>|<\/span>/gi, '').trim();
            if (key && val && !caracteristicas.some(c => c.toLowerCase().includes(key.toLowerCase()))) {
                caracteristicas.push(`${key}: ${val}`);
            }
        }

        // Intento 3: Bullet points de resumen (ui-pdp-features__item)
        const caracMatches = html.matchAll(/<li[^>]+class="ui-pdp-features__item"[^>]*>([\s\S]*?)<\/li>/gi);
        for (const match of caracMatches) {
            const texto = match[1].replace(/<[^>]+>/g, '').trim();
            if (texto && !caracteristicas.includes(texto)) caracteristicas.push(texto);
        }

        // 5. Descripción (Filtro de seguridad)
        let descripcion = "";
        if (schemaMatch) {
            try {
                const schema = JSON.parse(schemaMatch[1]);
                const item = Array.isArray(schema) ? schema[0] : schema;
                if (item.description && !item.description.includes("Visita la página")) {
                    descripcion = item.description;
                }
            } catch (e) {}
        }

        if (!descripcion) {
            const descMatch = html.match(/property="og:description"\s+content="([^"]+)"/i) ||
                             html.match(/name="description"\s+content="([^"]+)"/i);
            
            if (descMatch) {
                let d = descMatch[1].replace(/&quot;/g, '"');
                if (d.includes("Visita la página") || d.includes("en un solo lugar") || d.includes("NICOLASMARVEGGIO")) {
                    descripcion = ""; 
                } else {
                    descripcion = d.split('✓')[0].trim();
                }
            }
        }

        // 6. Limpieza profunda de marketing y frases genéricas
        const frasesLimpieza = [
            /Envíos gratis en el día/gi, /Comprá online de forma segura/gi, /Cuotas sin interés/gi,
            /Conocé los tiempos y las formas de envío/gi, /Mercado Puntos/gi, /Devolución gratis/gi,
            /Vendido por/gi, /Garantía de fábrica/gi, /Visita la página/gi
        ];
        
        descripcion = descripcion;
        frasesLimpieza.forEach(regex => { descripcion = descripcion.replace(regex, ''); });
        descripcion = descripcion.trim();

        const textoFicha = caracteristicas.map(c => "• " + c).join("\n");
        const descFinal = descripcion || "Producto seleccionado y verificado por el laboratorio Super M.";

        return {
            n: titulo,
            p: precio || 0,
            i: imagen ? [imagen] : [""],
            desc: descFinal,
            specs: caracteristicas.length > 0 ? caracteristicas : ["Calidad Super M Growlab"],
            texto: textoFicha || descFinal,
            link: url
        };
    } catch (error) {
        console.error("Scraping error detalle:", error.response?.status, error.message);
        const detail = error.response ? `(ML Status: ${error.response.status})` : error.message;
        throw new HttpsError("internal", "Error de conexión con el laboratorio: " + detail);
    }
});