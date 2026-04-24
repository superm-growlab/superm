import { db, auth, ADMIN_UID } from './firebase-config.js';
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { notify } from './herramientaslab.js';
import { crearNotificacion } from './comunidad.js';

const URL_SHEET_RECETARIOS = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQz-fNndUCID7stvplq5hmb2gLdSLs68uks2dfAr3DJK1Ft9LUtF0tYRyET3HEHotB-eKAqxishKe_A/pub?gid=654571090&single=true&output=tsv";

let recetarios = [];
window.recetarioStates = {};

export async function cargarRecetarios() {
    const grid = document.getElementById('grid-recetarios');
    if (!grid) return;

    // Si ya hay datos, renderizamos y salimos
    if (recetarios && recetarios.length > 0) return renderRecetarios();

    // Feedback visual de carga
    grid.innerHTML = `<p style="text-align:center; color:var(--s); grid-column:1/-1; font-family:monospace;">🔍 Sincronizando Recetarios con la Nube...</p>`;

    try {
        const r = await fetch(URL_SHEET_RECETARIOS);
        if (!r.ok) throw new Error(`Error HTTP: ${r.status}`);
        
        const text = await r.text();
        
        // Verificamos si Google devolvió HTML (error de permisos/publicación) o texto
        if (text.trim().startsWith("<") || text.includes("<!DOCTYPE html>")) {
            console.error("Respuesta inesperada de Google (HTML):", text.substring(0, 200));
            throw new Error("Google Sheets no entregó los datos. Verifica en 'Archivo > Compartir > Publicar en la web' que el formato sea 'Valores separados por tabuladores (.tsv)' y que la URL coincida.");
        }

        const dataClean = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
        // Split robusto para TSV que permite saltos de línea dentro de las celdas (como en la descripción)
        const rows = dataClean.split(/\n(?=(?:[^"]*"[^"]*")*[^"]*$)/).slice(1);
        
        recetarios = rows.filter(row => row && row.trim() !== "").map((linea, index) => {
            // Split avanzado para TSV que respeta comillas
            const c = linea.split(/\t(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v ? v.trim().replace(/^"|"$/g, '') : "");

            // Mapeo según tu planilla: 0:ID, 1:Marca, 2:Imagen, 3:Link, 4:Descripcion
            return { 
                id: index, 
                marca: c[1] || 'Sin Marca', 
                imagenes: (c[2] || '').split('|').map(u => u.trim()).filter(u => u.startsWith('http')), 
                links: (c[3] || '').split('|').map(u => u.trim()).filter(u => u.startsWith('http')), 
                desc: c[4] || '' 
            };
        });

        window.recetarios_data = [...recetarios]; // Clonamos para el buscador global
        renderRecetarios();
    } catch (e) { 
        console.error("Error recetarios:", e);
        grid.innerHTML = `<p style="text-align:center; color:#ff4444; grid-column:1/-1;">⚠️ Error de conexión: ${e.message}</p>`;
    }
}

function renderRecetarios() {
    const grid = document.getElementById('grid-recetarios');
    if(!grid) return;
    
    if (recetarios.length === 0) {
        grid.innerHTML = `<p style="text-align:center; color:#555; grid-column:1/-1;">No se encontraron tablas de cultivo.</p>`;
        return;
    }

    grid.innerHTML = recetarios.map(r => {
        const mainImg = (r.imagenes && r.imagenes.length > 0) ? r.imagenes[0] : "";
        const imgListJson = JSON.stringify(r.imagenes).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const marcaEscaped = (r.marca || '').replace(/'/g, "\\'"); 

        const imgHtml = mainImg ? `<img id="img-recetario-${r.id}" src="${mainImg}" class="img-real" onclick="window.verImagenAmpliada(this.src, ${imgListJson})">` : `<div class="img-placeholder">🌿</div>`;
        return `
            <div class="tarjeta nota-card" style="border-color: var(--p); height: auto;">
                <div class="contenedor-img" style="position:relative;">
                    ${imgHtml}
                    ${r.imagenes.length > 1 ? `<button onclick="event.stopPropagation(); window.navRecetario(${r.id}, 1)" style="position:absolute; right:5px; top:50%; background:rgba(0,0,0,0.4); color:var(--p); border:none; border-radius:50%; width:30px; height:30px; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center; z-index:5;">❯</button>` : ''}
                </div>
                <div style="padding:15px; text-align:center;">
                    <h3 style="color: var(--p); margin-bottom: 5px;">${r.marca}</h3>
                    <button class="btn btn-v" style="width: 100%;" onclick="window.descargarRecetarioActual(${r.id}, '${marcaEscaped}')">📥 Descargar Tabla</button>
                </div>
            </div>`;
    }).join('');
}

export function descargarTablaDirecta(url, nombreMarca) {
    try {
        fetch(url).then(response => response.blob()).then(blob => {
            const urlBlob = window.URL.createObjectURL(blob);
            const a = document.createElement('a'); a.style.display = 'none';
            a.href = urlBlob; a.download = `Tabla_Cultivo_${nombreMarca}_SuperM.jpg`;
            document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(urlBlob);
            notify("Descargando Tabla de " + nombreMarca);
        });
    } catch (e) { window.open(url, '_blank'); }
}

export function abrirModalSolicitarTabla() { 
    if(!auth.currentUser) return notify("🔒 Inicia sesión.", "info"); 
    document.getElementById('modal-solicitar-tabla').style.display = 'flex'; 
}

export async function enviarSolicitudTabla() {
    const marca = document.getElementById('sol-marca').value.trim();
    if (!marca) return notify("⚠️ Ingresa la marca.", "info");
    await addDoc(collection(db, 'solicitudes_tablas'), { marca, usuarioId: auth.currentUser.uid, status: 'pendiente', timestamp: serverTimestamp() });
    
    // Notificar al Admin de la solicitud
    crearNotificacion(ADMIN_UID, `📑 Nueva solicitud de tabla: ${marca}`, 'view-admin');
    
    document.getElementById('modal-solicitar-tabla').style.display = 'none';
    notify("📑 Solicitud enviada.", "success");
}

// --- PUENTE GLOBAL ---
window.cargarRecetarios = cargarRecetarios;
window.navRecetario = (id, delta) => {
    const r = recetarios.find(x => x.id == id);
    if (!r || !r.imagenes || r.imagenes.length === 0) return;
    const newState = ( (window.recetarioStates[id] || 0) + delta + r.imagenes.length) % r.imagenes.length;
    window.recetarioStates[id] = newState;
    const imgEl = document.getElementById(`img-recetario-${id}`);
    if (imgEl) imgEl.src = r.imagenes[newState];
};
window.descargarRecetarioActual = (id, marca) => {
    const r = recetarios.find(x => x.id == id);
    const idx = window.recetarioStates[id] || 0;
    const downloadUrl = (r && r.links && r.links[idx]) ? r.links[idx] : (r ? r.imagenes[idx] : null);
    if (downloadUrl) descargarTablaDirecta(downloadUrl, marca);
    else notify("No se encontró archivo para descargar.", "error");
};
window.enviarSolicitudTabla = enviarSolicitudTabla;
window.abrirModalSolicitarTabla = abrirModalSolicitarTabla;