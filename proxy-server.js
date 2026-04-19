const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const app = express();
const PORT = 3000;

// Ruta de verificación para evitar el "Cannot GET /"
app.get('/', (req, res) => {
    res.send('🧪 EL PROXY ALQUIMISTA ESTÁ ONLINE. Changuito Bot puede pasar por aquí.');
});

app.get('/transmutar', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Falta la URL');

    console.log(`📡 Changuito Bot solicitando: ${targetUrl}`);
    
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: true, // "new" ya es el estándar en versiones nuevas
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Opcional: usa tu Chrome real si falla
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        
        // Simulamos ser un usuario real de Argentina
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 45000 });
        
        // Obtenemos el HTML completo después de que cargue el JS de ML
        const html = await page.content();
        
        await browser.close();
        res.send(html);
    } catch (error) {
        console.error(`❌ Error extrayendo ${targetUrl}:`, error.message);
        if (browser) await browser.close();
        res.status(500).send(`Error en el Proxy Alquimista: ${error.message}`);
    }
});

app.listen(PORT, () => {
    console.log(`🧪 PROXY ALQUIMISTA LISTO`);
    console.log(`🔗 Local: http://localhost:${PORT}/transmutar?url=...`);
});