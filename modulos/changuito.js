import { db, functions } from './firebase-config.js';
import { 
    doc, 
    setDoc 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { notify } from './herramientaslab.js';
import { obtenerImagenHTML } from './tienda.js'; // Reutilizamos la función de tienda.js
import { Agente } from '../agente_central.js'; // Importamos el Agente Central

// Variable global para guardar los datos temporales mientras editas
let productoTemporal = null;

// URL del Google Apps Script para Sheets (se mantiene aquí ya que es una URL específica de este módulo)
const URL_GAS = "https://script.google.com/macros/s/AKfycbzk6fUHwGdI4wCgL_ZPBuV_pXFuWiLsSRo3TxPKs_KCWRBzaU4-Aw8B0emmy7OBg9A/exec";

export function actualizarMesaInspeccion() {
    if (!productoTemporal) return;
    
    const n = document.getElementById('edit-n').value;
    const p = parseFloat(document.getElementById('edit-p').value) || 0;
    const cat = document.getElementById('edit-cat').value;
    const texto = document.getElementById('edit-texto').value;
    const link = document.getElementById('link-referido').value;

    // Actualizar Previsualización de Fila
    document.getElementById('row-preview-titulo').innerText = n;
    document.getElementById('row-preview-precio').innerText = "$" + p.toLocaleString();
    document.getElementById('row-preview-cat').innerText = cat.replace('cat-', '').toUpperCase();
    document.getElementById('row-preview-link').innerText = link.substring(0, 30) + "...";

    // Actualizar Mini Tarjeta (HTML real que vería el usuario)
    const miniCard = document.getElementById('mini-card-preview');
    miniCard.innerHTML = `
        <div class="tarjeta">
            <div class="contenedor-img">${obtenerImagenHTML(productoTemporal.pictures)}</div>
            <div class="tarjeta-body">
                <h3 style="margin: 0 0 10px 0; font-size: 0.9rem; color: #ccc;">${n}</h3>
                <div style="color: var(--p); font-size: 1.4rem; font-weight: 600;">$${p.toLocaleString()}</div>
                ${texto ? `<button class="btn-m" style="width:100%; margin-top:10px;">📄 FICHA TÉCNICA</button>` : ''}
            </div>
        </div>
    `;
}

export async function probarConexionLlaves() {
    const status = document.getElementById('status-bot');
    status.innerText = "⏳ VERIFICANDO LLAVES EN FIRESTORE...";
    try {
        // Usamos el Agente Central para llamar a la Cloud Function
        const res = await Agente.servicios.firebaseFunctions.callCloudFunction('obtenerProductoML', { action: "test" });
        status.innerText = "✅ " + res.message;
        status.style.color = "var(--p)";
    } catch (e) {
        status.innerText = "❌ ERROR DE LLAVES: " + e.message;
        status.style.color = "#ff3131";
    }
}

export async function botTransmutar() {
    const linkReferido = document.getElementById('link-referido').value.trim();
    const idManual = document.getElementById('id-producto-manual').value.trim();
    const status = document.getElementById('status-bot');
    const editor = document.getElementById('editor-producto');

    if (!linkReferido) {
        status.innerText = "⚠️ INGRESA UN LINK PARA COMENZAR.";
        return;
    }

    status.innerText = "🔮 DESCIFRANDO DIMENSIONES DEL LINK...";
    status.style.color = "var(--s)";

    try {
        // Usamos el Agente Central para obtener el producto de Mercado Libre
        const data = await Agente.servicios.mercadoLibre.getProductFromCloudFunction(linkReferido, idManual);

        if (data.error) throw new Error(data.error);

        // Preparamos los datos temporales
        productoTemporal = {
            id: data.id || Date.now().toString(),
            pictures: data.pictures,
            title: data.title, 
            attributes: (data.attributes && data.attributes.length > 0) ? data.attributes : ["Calidad Super M"],
            permalink: data.permalink
        };

        // LLENADO DE FORMULARIO
        document.getElementById('edit-n').value = data.title || "";
        document.getElementById('edit-p').value = data.price || 0;
        
        // Combinamos specs y texto para la ficha técnica
        const fichaFormateada = (data.attributes && data.attributes.length > 0) ? data.attributes.join("\n") : (data.description || "");
        document.getElementById('edit-texto').value = fichaFormateada;
        
        // Evitamos cargar el emoji como URL para prevenir el error 404
        const imgUrl = (data.pictures && data.pictures[0] && data.pictures[0].includes('http')) ? data.pictures[0] : '';
        if (imgUrl) {
            document.getElementById('edit-preview-img').src = imgUrl;
        } else {
            document.getElementById('edit-preview-img').src = "https://i.postimg.cc/rF9GqwGS/favicon.png";
        }

        status.innerHTML = `✨ TRANSMUTADO: [${data.category_name || 'General'}]<br>
                           <small style="font-size:0.6rem; opacity:0.7;">API: ${data.debug?.api_usada} | ID: ${data.debug?.id_procesado}</small>`;
        status.style.color = "var(--p)";
        actualizarMesaInspeccion();

        editor.style.display = 'block';
        editor.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        console.error("Error completo en Alchemist Bot:", e);
        const code = e.code || "unknown";
        const message = e.message || "Error interno del servidor";
        alert(`❌ FALLO DE CONEXIÓN [${code}]: ${message}`);
        status.innerText = `❌ ERROR [${code}]: ${message}`;
    }
}

export async function cargarAFirebase() {
    if (!productoTemporal) return;
    const status = document.getElementById('status-bot');
    const linkFinal = document.getElementById('link-referido').value;

    // Tomamos los valores actualizados del editor
    const dataFinal = {
        id: productoTemporal.id,
        category_id: document.getElementById('edit-cat').value,
        title: document.getElementById('edit-n').value,
        price: parseFloat(document.getElementById('edit-p').value),
        pictures: productoTemporal.pictures,
        description_short: productoTemporal.title || document.getElementById('edit-n').value,
        attributes: Array.isArray(productoTemporal.attributes) ? productoTemporal.attributes : ["Calidad Super M"],
        permalink: linkFinal,
        description: document.getElementById('edit-texto').value
    };

    try {
        status.innerText = "🚀 SUBIENDO A LA NUBE...";
        // IMPORTANTE: Sincronizado con la colección que usa index.html
        await setDoc(doc(db, "productos_tienda", dataFinal.id), dataFinal);
        
        renderizar(dataFinal);
        
        // Reset
        status.innerText = "✨ PRODUCTO CARGADO EXITOSAMENTE.";
        document.getElementById('editor-producto').style.display = 'none';
        document.getElementById('link-referido').value = "";
        productoTemporal = null;
        
    } catch (e) {
        status.innerText = "❌ ERROR AL SUBIR: " + e.message;
    }
}

export async function enviarASheetsDirecto() {
    if (!productoTemporal) return;
    const status = document.getElementById('status-bot');
    const linkFinal = document.getElementById('link-referido').value;
    
    const payload = {
        id: productoTemporal.id,
        titulo: document.getElementById('edit-n').value,
        precio: document.getElementById('edit-p').value,
        categoria: document.getElementById('edit-cat').value,
        link: linkFinal,
        timestamp: new Date().toLocaleString()
    };

    status.innerText = "📡 ENVIANDO A PLANILLA...";
    try {
        // Usamos el Agente Central para enviar a Google Sheets
        await Agente.servicios.googleSheets.sendToSheet(URL_GAS, payload);
        notify("📊 DATOS ENVIADOS A SHEETS");
        status.innerText = "✨ CARGA EN PLANILLA EXITOSA.";
    } catch (e) {
        status.innerText = "❌ ERROR AL ENVIAR A SHEETS.";
    }
}

export function cancelarEdicion() {
    document.getElementById('editor-producto').style.display = 'none';
    document.getElementById('status-bot').innerText = "OPERACIÓN CANCELADA.";
    productoTemporal = null;
}

export function renderizar(p) {
    const hist = document.getElementById('historial-bot');
    const csvRow = `${p.id};${p.category_id};${p.title};${p.price};${p.pictures.join('|')};${p.description_short};${p.attributes};${p.permalink};${p.description};`;

    // HTML Snippet idéntico al que genera el renderGrid de index.html
    const htmlSnippet = `<div class="tarjeta" onclick="window.irAProducto('${p.id}')" style="display:flex; flex-direction:column;">
        <div class="contenedor-img">${obtenerImagenHTML(p.pictures)}</div>
        <h3 style="margin: 10px 0; text-align: center;">${p.title}</h3>
        <div id="stars-grid-${p.id}" style="text-align:center; font-size:0.8rem; margin-bottom:5px;"></div>
        <div style="text-align: center; color: var(--p); font-weight: bold;">$${p.price.toLocaleString()}</div>
        ${p.description ? `<button class="btn btn-m" style="font-size: 0.65rem; padding: 6px; margin-top: 15px; border-color:var(--s); color:var(--s);" onclick="event.stopPropagation(); window.verNotasCompletas(decodeURIComponent('${encodeURIComponent(p.description)}'), '📖 FICHA TÉCNICA')">📄 FICHA TÉCNICA</button>` : ''}
    </div>`;

    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = "40px";
    wrapper.style.gridColumn = "span 1";
    
    wrapper.innerHTML = `
        <div class="tarjeta">
            <div class="contenedor-img">${obtenerImagenHTML(p.pictures)}</div>
            <h3 style="margin: 10px 0; text-align: center; font-size:1rem;">${p.title}</h3>
            <div style="text-align: center; color: var(--p); font-weight: bold; margin-bottom:10px;">$${p.price.toLocaleString()}</div>
        </div>
        <div style="margin-top:15px;">
            <span class="label-edit">CSV PARA GOOGLE SHEETS</span>
            <div class="csv-row" onclick="navigator.clipboard.writeText(this.innerText); notify('Fila CSV copiada!')">${csvRow}</div>
            <span class="label-edit" style="margin-top:10px;">SNIPPET HTML PARA INDEX.HTML</span>
            <div class="html-snippet" onclick="navigator.clipboard.writeText(this.innerText); notify('Snippet HTML copiado!')">${htmlSnippet.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </div>
    `;
    
    hist.prepend(wrapper);
}

// Exponer funciones al objeto window para que puedan ser llamadas desde el HTML
window.actualizarMesaInspeccion = actualizarMesaInspeccion;
window.probarConexionLlaves = probarConexionLlaves;
window.botTransmutar = botTransmutar;
window.cargarAFirebaseChanguito = cargarAFirebase;
window.enviarASheetsChanguito = enviarASheetsDirecto;
window.cancelarEdicionChanguito = cancelarEdicion;
window.renderizar = renderizar;