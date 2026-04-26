import { app, db, auth, ADMIN_UID } from './firebase-config.js';
import { 
    comprimirImagen, 
    renderAcumulado,
    notify
} from './herramientaslab.js';
import { 
    collection, addDoc, serverTimestamp, setDoc,
    getDocs, updateDoc, doc, getDoc, 
    arrayUnion, arrayRemove, increment, 
    query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { Agente } from '../agente_central.js';

window.notasDinamicas = [];
window.notasCargadasInicialmente = false; // Nuevo flag para controlar el estado de carga
window.cargandoNotasLock = false; // Evita colisiones de carga
window.imgsNota = [];

/** --- LÓGICA DE CARGA Y RENDERIZADO (SHEETS) --- **/

// Función auxiliar para decodificar HTML (convertir &lt; en <)
const decodificarHTML = (str) => { 
    const e = document.createElement('textarea'); 
    e.innerHTML = str; 
    return e.value; 
};

export async function cargarNotasDesdeSheet() {
    // Si ya estamos cargando o ya cargamos, no hacemos nada
    if (window.cargandoNotasLock) return;
    
    // Si ya tenemos las notas del Sheet, solo intentamos sincronizar votos de Firebase y salimos
    if (window.notasDinamicas && window.notasDinamicas.length > 0) {
        return await sincronizarVotosNotas();
    }
    
    window.cargandoNotasLock = true;

    try {
        // El Agente resuelve el conflicto de la API y el parseo
        const notasMapeadas = await Agente.biblioteca.obtenerNotas();
        
        window.notasDinamicas = notasMapeadas.map(n => ({
            ...n,
            contenido: decodificarHTML(n.contenido)
        }));

        // Liberamos la interfaz inmediatamente con los datos de Sheets
        window.notasCargadasInicialmente = true;
        renderFiltrosNotas();
        renderMenuNotas('todas');
        
        // --- CONEXIÓN A FIREBASE (VOTOS) ---
        await sincronizarVotosNotas();

        if (window.notasDinamicas.length === 0) {
            console.warn("❌ El Sheet de Notas se leyó pero no se encontraron filas válidas.");
            notify("⚠️ La biblioteca parece estar vacía.", "info");
        }
    } catch (e) { 
        console.error("Error cargando notas:", e); 
        notify("❌ Error Alquimia: " + e.message, "error");
    } finally {
        window.notasCargadasInicialmente = true; 
        window.cargandoNotasLock = false;
        renderFiltrosNotas(); // Siempre renderizamos filtros
        renderMenuNotas('todas'); // Siempre renderizamos el menú para reflejar el estado final
    }
}

export async function sincronizarVotosNotas() {
    if (!db || !window.notasDinamicas || window.notasDinamicas.length === 0) return;
    try {
        const q = query(collection(db, 'stats_notas'));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const statsMap = {};
            snap.forEach(d => {
                statsMap[d.id] = { 
                    up: d.data().upvotes || 0, 
                    down: d.data().downvotes || 0 
                };
            });
            window.notasDinamicas.forEach(n => {
                if (statsMap[n.id]) {
                    n.upvotes = statsMap[n.id].up;
                    n.downvotes = statsMap[n.id].down;
                }
            });
            renderMenuNotas('todas');
        }
    } catch (err) {
        if (err.code === 'permission-denied') {
            console.log("ℹ️ Notas: Los votos no se sincronizaron. Verifica que las reglas de Firestore permitan la lectura pública de 'stats_notas'.");
        } else {
            console.warn("⚠️ Error en sincronización de votos:", err.message);
        }
    }
}

export function renderFiltrosNotas() {
    const container = document.getElementById('notas-filtros-chips');
    if (!container) return;
    const cats = ['todas', ...new Set(window.notasDinamicas.map(n => n.cat))];
    container.innerHTML = cats.map(c => `
        <div class="chip-filtro" onclick="window.renderMenuNotas('${c}')">${c.toUpperCase()}</div>
    `).join('');
}

export function renderMenuNotas(cat = 'todas') {
    const container = document.getElementById('menu-notas');
    if (!container) return;

    // Si la biblioteca está vacía o cargando, mostramos un estado de espera
    // Solo mostramos "Sincronizando" si la carga inicial aún no ha terminado.
    if (!window.notasCargadasInicialmente) {
        container.innerHTML = `<p style="text-align:center; color:var(--s); grid-column:1/-1; padding:40px; font-family:monospace;">📡 Sincronizando biblioteca de notas...</p>`;
        return;
    }

    // Al cambiar categoría, cerramos el visor si estaba abierto
    const visor = document.getElementById('visor-notas');
    if (visor) visor.style.display = 'none';
    
    const fil = (cat === 'todas' || !cat) ? window.notasDinamicas : window.notasDinamicas.filter(n => n.cat === cat);
    if (fil.length === 0) {
        container.innerHTML = "<p style='text-align:center; color:#555; grid-column:1/-1; padding:40px;'>No hay notas disponibles en esta categoría.</p>";
    } else {
        container.innerHTML = fil.map(n => getNotaCardHTML(n)).join('');
    }

    // Feedback visual en chips
    document.querySelectorAll('#notas-filtros-chips .chip-filtro').forEach(chip => {
        chip.classList.toggle('active', chip.innerText.toLowerCase() === cat.toLowerCase());
    });
}

export function getNotaCardHTML(n) {
    return `
        <div class="tarjeta nota-card" onclick="window.verNotaDinamica('${n.id}')" style="position:relative;">
            <div class="card-header">
                <span class="nota-icon">${n.icono}</span>
                <h3 class="nota-title">${n.titulo}</h3>
            </div>
            <div class="card-meta">
                <span class="nota-category">${n.cat}</span>
                <span class="nota-date">${n.fecha}</span>
            </div>
            <p class="nota-summary">${n.resumen}</p>
            
            <!-- Sistema de Votación en Tarjeta -->
            <div class="card-actions">
                <button onclick="event.stopPropagation(); window.votarNota('${n.id}', 'up')" 
                    style="background:rgba(57, 255, 20, 0.05); border:1px solid #333; color:#888; border-radius:6px; padding:2px 10px; font-size:0.7rem; cursor:pointer; transition:0.3s;"
                    onmouseover="this.style.borderColor='var(--p)'; this.style.color='var(--p)'"
                    onmouseout="this.style.borderColor='#333'; this.style.color='#888'">
                    👍 <span id="up-count-${n.id}">${n.upvotes || 0}</span>
                </button>
                <button onclick="event.stopPropagation(); window.votarNota('${n.id}', 'down')" 
                    style="background:rgba(255, 49, 49, 0.05); border:1px solid #333; color:#888; border-radius:6px; padding:2px 10px; font-size:0.7rem; cursor:pointer; transition:0.3s;"
                    onmouseover="this.style.borderColor='#ff3131'; this.style.color='#ff3131'"
                    onmouseout="this.style.borderColor='#333'; this.style.color='#888'">
                    👎 <span id="down-count-${n.id}">${n.downvotes || 0}</span>
                </button>
            </div>            
        </div>
    `;
}

/** --- VISUALIZACIÓN DE CONTENIDO --- **/

export function verNotaDinamica(id, guardar = true) {
    const n = window.notasDinamicas.find(x => x.id === id);
    if (!n) return;
    if (guardar) history.pushState({ section: 'info', notaId: id }, '', `#info/${id}`);
    
    document.getElementById('visor-notas').style.display = 'flex'; // Mostrar como modal
    
    let cuerpo = n.contenido;
    const urls = n.imageUrls || [];
    let indicesUsados = new Set();

    // Reemplazar tags numerados [FOTO1], [FOTO2], etc. (Insensible a mayúsculas)
    urls.forEach((url, i) => {
        const tag = `[FOTO${i+1}]`;
        const regex = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const imgHtml = `<img src="${url}" class="img-real" style="margin:20px 0; border-radius:12px; border:1px solid var(--s); cursor:pointer;">`;
        const nuevoCuerpo = cuerpo.replace(regex, imgHtml);
        if (nuevoCuerpo !== cuerpo) {
            cuerpo = nuevoCuerpo;
            indicesUsados.add(i);
        }
    });
    
    // Fallback para [FOTO] genérico (Insensible a mayúsculas)
    const regexGen = /\[FOTO\]/gi;
    if (regexGen.test(cuerpo) && urls[0]) {
        const imgHtml = `<img src="${urls[0]}" class="img-real" style="margin:20px 0; border-radius:12px; border:1px solid var(--s); cursor:pointer;">`;
        regexGen.lastIndex = 0; // Reset para el replace
        cuerpo = cuerpo.replace(regexGen, imgHtml);
        indicesUsados.add(0);
    }

    // Anexar imágenes restantes no ubicadas en el texto
    urls.forEach((url, i) => {
        if (!indicesUsados.has(i)) {
            cuerpo += `\n<img src="${url}" class="img-real" style="margin:20px 0; border-radius:12px; border:1px solid var(--s); cursor:pointer;">`;
        }
    });

    const contentEl = document.getElementById('contenido-nota');
    contentEl.innerHTML = `
        <h2 style="color:var(--p); font-size:2rem; margin-bottom:10px;">${n.titulo}</h2>
        <div style="color:var(--s); font-size:0.7rem; font-weight:bold; text-transform:uppercase; margin-bottom:20px; letter-spacing:1px;">Categoría: ${n.cat}</div>
        <div class="lab-data-box" style="line-height:1.8; font-family:'Segoe UI', sans-serif;">${cuerpo}</div>
    `;

    // Vincular todas las imágenes encontradas en el contenido con el visor global
    const imgs = Array.from(contentEl.querySelectorAll('img'));
    const srcs = imgs.map(img => img.src);
    imgs.forEach(img => {
        img.onclick = () => window.verImagenAmpliada(img.src, srcs);
    });

    window.scrollTo(0,0);
}

export function cerrarNota() {
    document.getElementById('visor-notas').style.display = 'none'; // Cerrar modal
    if(window.location.hash.includes('/')) history.pushState({ section: 'info' }, '', '#info');
}

/** --- INTERACCIONES Y VOTOS (FIREBASE) --- **/

export function abrirModalProponerNota() {
    const user = auth.currentUser;
    if (!user) return notify("🔒 Debes iniciar sesión para proponer una nota.", 'info');
    window.imgsNota = [];
    const preview = document.getElementById('prop-img-preview');
    if (preview) preview.innerHTML = '';
    document.getElementById('modal-proponer-nota').style.display = 'flex';
    history.pushState({ section: 'info', view: 'propuesta' }, '', '#proponer-nota');
}

export async function enviarPropuestaNota() {
    const user = auth.currentUser;
    const titulo = document.getElementById('prop-titulo').value.trim();
    const cat = document.getElementById('prop-cat').value.trim();
    const resumen = document.getElementById('prop-resumen').value.trim();
    const contenido = document.getElementById('prop-contenido').value.trim();
    if (!titulo || !contenido) return notify("⚠️ El título y contenido son obligatorios.", 'info');
    
    try {
        await addDoc(collection(db, 'sugerencias_notas'), {
            titulo, cat, resumen, contenido, imageUrls: [...window.imgsNota],
            usuarioId: user.uid, usuarioNombre: user.displayName || user.email,
            status: 'pendiente', fecha: new Date().toLocaleString(), timestamp: serverTimestamp()
        });
        document.getElementById('modal-proponer-nota').style.display = 'none';
        window.imgsNota = [];
        notify("📜 Propuesta enviada con éxito.", "success");
        if(window.crearNotificacion) window.crearNotificacion(ADMIN_UID, `Nueva propuesta: ${titulo}`, `view-admin`);
    } catch (e) { console.error(e); notify("❌ Error al enviar.", 'error'); }
}

export async function votarNota(id, tipo) {
    const user = auth.currentUser;
    if (!user) return notify("🔒 Debes iniciar sesión para votar.", 'info');

    try {
        const docRef = doc(db, 'stats_notas', id);
        const snap = await getDoc(docRef);
        const data = snap.exists() ? snap.data() : { upvotes: 0, downvotes: 0, votosUp: [], votosDown: [] };
        const uid = user.uid;
        
        let update = {};
        const vUp = data.votosUp || [];
        const vDown = data.votosDown || [];

        if (tipo === 'up') {
            if (vUp.includes(uid)) {
                update.votosUp = arrayRemove(uid);
                update.upvotes = increment(-1);
            } else {
                update.votosUp = arrayUnion(uid);
                update.upvotes = increment(1);
                if (vDown.includes(uid)) {
                    update.votosDown = arrayRemove(uid);
                    update.downvotes = increment(-1);
                }
                if(typeof window.crearNotificacion === 'function') window.crearNotificacion(ADMIN_UID, `👍 Voto en nota: ${id}`, `info#${id}`);
            }
        } else {
            if (vDown.includes(uid)) {
                update.votosDown = arrayRemove(uid);
                update.downvotes = increment(-1);
            } else {
                update.votosDown = arrayUnion(uid);
                update.downvotes = increment(1);
                if (vUp.includes(uid)) {
                    update.votosUp = arrayRemove(uid);
                    update.upvotes = increment(-1);
                }
            }
        }

        await setDoc(docRef, update, { merge: true });

        // Actualizar contador en la interfaz
        const updatedSnap = await getDoc(docRef);
        const freshData = updatedSnap.data();
        if (freshData) {
            if (document.getElementById(`up-count-${id}`)) document.getElementById(`up-count-${id}`).innerText = freshData.upvotes || 0;
            if (document.getElementById(`down-count-${id}`)) document.getElementById(`down-count-${id}`).innerText = freshData.downvotes || 0;
        }
        notify("✅ Gracias por tu valoración.", "success");
    } catch (e) { console.error("Error al votar nota:", e); }
}

export async function aprobarPropuestaNota(id) {
    if(!await window.confirmAlquimista("¿Confirmas la aprobación de este conocimiento para la biblioteca pública?")) return;
    try {
        await updateDoc(doc(db, 'sugerencias_notas', id), { status: 'aprobado' });
        notify("✅ Nota marcada como aprobada.", "success");
        // Refrescar lista de moderación si el panel está abierto
        if(window.cargarModeracion) window.cargarModeracion('sugerencias_notas');
    } catch(e) { console.error(e); notify("❌ Error al actualizar estado.", "error"); }
}

export function insertarEtiquetaFoto(idx) {
    const area = document.getElementById('prop-contenido');
    if(!area) return;
    const tag = idx ? `[FOTO${idx}]` : '[FOTO]';
    const start = area.selectionStart, end = area.selectionEnd, text = area.value;
    area.value = text.substring(0, start) + tag + text.substring(end);
    area.focus(); area.selectionStart = area.selectionEnd = start + tag.length;
}

export async function mostrarPrevisualizacionPropuestaNota() {
    const input = document.getElementById('prop-img');
    const btnTag = document.getElementById('btn-insertar-tag');
    if (!input) return;
    for (const file of Array.from(input.files)) {
        const data = await window.comprimirImagen(file);
        if(data) window.imgsNota.push(data);
    }
    input.value = "";
    window.renderAcumulado(window.imgsNota, 'prop-img-preview', '--p'); // Se elimina la llamada duplicada
    if (btnTag) btnTag.style.display = window.imgsNota.length > 0 ? 'block' : 'none';
}

export function leerPropuestaAdmin(id) {
    const data = window._moderacionCache[id];
    if (!data) return;
    
    let cuerpo = data.contenido || '';
    const urls = data.imageUrls || (data.imageUrl ? [data.imageUrl] : []);
    let indicesUsados = new Set();

    // Reemplazar tags numerados [FOTO1], [FOTO2], etc. (Insensible a mayúsculas)
    urls.forEach((url, i) => {
        const tag = `[FOTO${i + 1}]`;
        const regex = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const imgHtml = `<img src="${url}" style="max-width:100%; height:auto; border-radius:8px; margin:15px auto; display:block; border:1px solid var(--s); cursor:pointer;">`;
        const nuevoCuerpo = cuerpo.replace(regex, imgHtml);
        if (nuevoCuerpo !== cuerpo) {
            cuerpo = nuevoCuerpo;
            indicesUsados.add(i);
        }
    });

    // Anexar imágenes restantes no ubicadas
    urls.forEach((url, i) => {
        if (!indicesUsados.has(i)) {
            cuerpo += `\n<img src="${url}" style="max-width:100%; height:auto; border-radius:8px; margin:15px auto; display:block; border:1px solid var(--s); cursor:pointer;">`;
        }
    });

    const modalHtml = `
        <div id="modal-leer-admin" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.95); z-index: 20000; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(10px); padding: 20px;">
            <div class="form-box" style="border-color: var(--p); max-width: 700px; width: 100%; max-height: 90vh; overflow-y: auto;">
                <h3 style="color: var(--p); text-align: center;">${data.titulo}</h3>
                <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--s); font-weight: bold; margin-bottom: 15px; border-bottom: 1px solid #333; padding-bottom: 10px; gap: 10px;">
                    <span>CATEGORÍA: ${(data.cat || 'General').toUpperCase()}</span>
                    <span>AUTOR: ${data.usuarioNombre || 'Anónimo'}</span>
                </div>
                <div class="lab-data-box" id="admin-propuesta-content" style="background: #000; padding: 20px; border-radius: 10px; border-left: 4px solid var(--p); line-height: 1.6; color: #eee; font-family: 'Courier New', monospace; white-space: pre-wrap;">${cuerpo}</div>
                <div style="display: flex; gap: 10px; margin-top: 25px;">
                    <button class="btn btn-m" style="flex: 1;" onclick="document.getElementById('modal-leer-admin').remove()">CERRAR</button>
                    ${data.status === 'pendiente' ? `<button class="btn btn-v" style="flex: 1;" onclick="document.getElementById('modal-leer-admin').remove(); window.aprobarPropuestaNota('${id}')">APROBAR AHORA</button>` : ''}
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Vincular imágenes en el visor admin para permitir vista previa con visor
    const container = document.getElementById('admin-propuesta-content');
    if (container) {
        const imgs = Array.from(container.querySelectorAll('img'));
        const srcs = imgs.map(img => img.src);
        imgs.forEach(img => {
            img.onclick = () => window.verImagenAmpliada(img.src, srcs);
        });
    }
}

// Exponer a window para compatibilidad con HTML
window.cargarNotasDesdeSheet = cargarNotasDesdeSheet;
window.renderFiltrosNotas = renderFiltrosNotas;
window.renderMenuNotas = renderMenuNotas;
window.getNotaCardHTML = getNotaCardHTML;
window.verNotaDinamica = verNotaDinamica;
window.sincronizarVotosNotas = sincronizarVotosNotas;
window.cerrarNota = cerrarNota;
window.votarNota = votarNota;
window.aprobarPropuestaNota = aprobarPropuestaNota;
window.abrirModalProponerNota = abrirModalProponerNota;
window.enviarPropuestaNota = enviarPropuestaNota;
window.insertarEtiquetaFoto = insertarEtiquetaFoto;
window.mostrarPrevisualizacionPropuestaNota = mostrarPrevisualizacionPropuestaNota;
window.leerPropuestaAdmin = leerPropuestaAdmin; // Esta función no necesita cambios

// Puente para búsqueda
window.verNotaDesdeBusqueda = (id) => { window.verNotaDinamica(id); };