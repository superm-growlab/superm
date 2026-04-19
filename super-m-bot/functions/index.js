// 4. Ficha Técnica (Especificaciones)
const caracteristicas = [];

        // Intento 1: Tabla de especificaciones (Andes o UI PDP)
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
@@ -87,7 +97,7 @@ exports.obtenerProductoML = onCall({
}
}

        // Intento 2: Bullet points de resumen (ui-pdp-features__item)
        // Intento 3: Bullet points de resumen (ui-pdp-features__item)
const caracMatches = html.matchAll(/<li[^>]+class="ui-pdp-features__item"[^>]*>([\s\S]*?)<\/li>/gi);
for (const match of caracMatches) {
const texto = match[1].replace(/<[^>]+>/g, '').trim();