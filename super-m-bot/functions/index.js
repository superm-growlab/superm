const { onCall } = require("firebase-functions/v2/https");
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
        return { error: "Falta la URL" };
    }

    try {
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' 
            }
        });

        const html = response.data;
        
        const tituloMatch = html.match(/<h1 class="ui-pdp-title">([^<]+)<\/h1>/);
        const precioMatch = html.match(/"price":\s*(\d+)/);
        const imagenMatch = html.match(/https:\/\/http2\.mlstatic\.com\/D_NQ_NP_(\d+-[A-Z]+)\d+-\d+-F\.webp/);

        return {
            n: tituloMatch ? tituloMatch[1].trim() : "Producto Super M",
            p: precioMatch ? parseInt(precioMatch[1]) : 0,
            i: imagenMatch ? [imagenMatch[0]] : [""],
            link: url
        };
    } catch (error) {
        return { error: "Error de conexión con el laboratorio" };
    }
});