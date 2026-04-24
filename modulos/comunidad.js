import { app, db, auth, ADMIN_UID } from './firebase-config.js';
import { 
    notify, 
    comprimirImagen, 
    renderAcumulado, 
    renderGalería 
} from './herramientaslab.js';
import { 
    collection, 
    query, 
    where, 
    orderBy, 
    limit, 
    onSnapshot, 
    addDoc, 
    serverTimestamp,
    doc,
    getDoc,
    updateDoc,
    setDoc,
    increment,
    arrayUnion,
    arrayRemove,
    getDocs,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// CONFIGURACIÓN MAESTRA DE COMUNIDAD
const CONFIG_COMUNIDAD = {
    'general': { n: 'General', i: '📝', c: '#a0a0a0' },
    'consulta': { n: 'Consulta Técnica', i: '🧪', c: '#39ff14' },
    'sugerencia': { n: 'Sugerencia', i: '💡', c: '#bc13fe' },
    'producto': { n: 'Opinión Producto', i: '🛒', c: '#00f2ff' },
    'plaga': { n: 'Alerta de Plaga', i: '⚠️', c: '#ff3131' },
    'logro': { n: 'Logro/Cosecha', i: '🏆', c: '#ffd700' },
    'tabla': { n: 'Pedido de Tabla', i: '📊', c: '#ff00ff' }
};

// --- SISTEMA DE ACUMULACIÓN DE IMÁGENES ---
window.imgsComunidad = [];
window.imgsRespuesta = [];
let comunidadUnsubscribe = null;
let reviewsUnsubscribe = null;
let notificacionesUnsubscribe = null;
let currentReplyId = null;
let editingTarget = null;

// --- SISTEMA DE NOTIFICACIONES ---
export async function crearNotificacion(paraUid, mensaje, link) {
    const user = auth.currentUser;
    if (!paraUid || !user || paraUid === user.uid) return;
    try {
        await addDoc(collection(db, 'notificaciones'), {
            paraUid: paraUid, 
            mensaje: mensaje, 
            link: link || '',
            leido: false, 
            timestamp: serverTimestamp()
        });
    } catch (e) { console.error("Error al crear notificación:", e); }
}

export async function leerNotificacion(id, link) {
    try {
        await updateDoc(doc(db, 'notificaciones', id), { leido: true });
        if (link) {
            const [path, anchor] = link.split('#');
            window.ejecutarNavegacionConScroll(path, anchor);
        }
    } catch (e) { console.error(e); }
}

export async function limpiarNotificacionesRelacionadas(targetId) {
    try {
        const q = query(collection(db, 'notificaciones'));
        const snap = await getDocs(q);
        const batchDeletes = snap.docs.filter(d => (d.data().link || "").includes(targetId)).map(d => deleteDoc(doc(db, 'notificaciones', d.id)));
        await Promise.all(batchDeletes);
    } catch (e) { console.error(e); }
}

export function ejecutarNavegacionConScroll(path, anchor) {
    if (path.startsWith('tienda:')) {
        const pId = path.split(':')[1];
        window.irAProducto(pId);
    } else {
        window.ver(path, true, true);
    }
    if (anchor) {
        document.querySelectorAll('.noti-target-highlight').forEach(el => el.classList.remove('noti-target-highlight'));
        let intentos = 0;
        const intentarScroll = setInterval(() => {
            const el = document.getElementById(anchor);
            if (el) {
                clearInterval(intentarScroll);
                setTimeout(() => {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('noti-target-highlight');
                    setTimeout(() => el.classList.remove('noti-target-highlight'), 3000);
                }, 600);
            }
            if (++intentos > 20) clearInterval(intentarScroll);
        }, 500);
    }
}

export function toggleNotificaciones(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('noti-dropdown');
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

export function escucharNotificaciones() {
    const user = auth.currentUser;
    if (!user) {
        if (notificacionesUnsubscribe) notificacionesUnsubscribe();
        document.getElementById('noti-count').style.display = 'none';
        document.getElementById('noti-list').innerHTML = '<div class="noti-empty">Inicia sesión para ver notificaciones.</div>';
        return;
    }

    if (notificacionesUnsubscribe) notificacionesUnsubscribe(); // Detener escucha anterior

    const q = query(collection(db, 'notificaciones'), where('paraUid', '==', user.uid), orderBy('timestamp', 'desc'), limit(10));
    notificacionesUnsubscribe = onSnapshot(q, (snapshot) => {
        const notiList = document.getElementById('noti-list');
        const notiCount = document.getElementById('noti-count');
        let unreadCount = 0;
        let html = '';

        if (snapshot.empty) {
            html = '<div class="noti-empty">No tienes notificaciones.</div>';
            notiCount.style.display = 'none';
        } else {
            snapshot.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (!data.leido) unreadCount++;
                html += `
                    <div class="noti-item ${data.leido ? '' : 'unread'}" onclick="window.leerNotificacion('${docSnap.id}', '${data.link}')">
                        ${data.mensaje}
                    </div>
                `;
            });
            if (unreadCount > 0) {
                notiCount.innerText = unreadCount;
                notiCount.style.display = 'block';
            } else {
                notiCount.style.display = 'none';
            }
        }
        notiList.innerHTML = html;
    }, (error) => {
        console.error("Error escuchando notificaciones:", error);
        document.getElementById('noti-list').innerHTML = '<div class="noti-empty">Error al cargar notificaciones.</div>';
    });
}

// --- FUNCIONES DE COMUNIDAD ---
export function seleccionarCategoriaComunidad(id) {
    document.getElementById('nuevo-comentario-cat-id').value = id;
    document.querySelectorAll('.cat-sel-btn').forEach(btn => {
        const catId = btn.getAttribute('data-id');
        const color = CONFIG_COMUNIDAD[catId].c;
        if(catId === id) {
            btn.style.background = color;
            btn.style.color = '#000';
            btn.style.boxShadow = `0 0 15px ${color}`;
        } else {
            btn.style.background = 'transparent';
            btn.style.color = color;
            btn.style.boxShadow = 'none';
        }
    });
}

export function renderSelectoresComunidad() {
    const container = document.getElementById('selector-categoria-comunidad');
    if(!container) return;
    container.innerHTML = Object.entries(CONFIG_COMUNIDAD).map(([id, data]) => ` 
        <div class="cat-sel-btn" data-id="${id}" onclick="window.seleccionarCategoriaComunidad('${id}')" 
             style="border: 1px solid ${data.c}; color: ${data.c}; padding: 8px; border-radius: 8px; font-size: 0.7rem; font-weight: bold; cursor: pointer; text-align: center; transition: 0.3s;">
            ${data.i} ${data.n.toUpperCase()}
        </div>
    `).join('');
    seleccionarCategoriaComunidad('general'); // Default
}

export function renderFiltrosComunidad(activo = 'todas') {
    const container = document.getElementById('comunidad-filtros-chips');
    if(!container) return;
    let html = `<div class="chip-filtro ${activo === 'todas' ? 'active' : ''}" onclick="window.cargarComentarios('todas')">TODOS</div>`;
    html += Object.entries(CONFIG_COMUNIDAD).map(([id, data]) => `
        <div class="chip-filtro ${activo === id ? 'active' : ''}" onclick="window.cargarComentarios('${id}')">${data.i} ${data.n.toUpperCase()}</div>
    `).join('');
    container.innerHTML = html;
}

export async function enviarComentario() {
    const user = auth.currentUser;
    const text = document.getElementById('nuevo-comentario-txt').value.trim();
    const cat = document.getElementById('nuevo-comentario-cat-id').value;
    
    if (!text) return notify("✍️ Escribe algo antes de publicar.", 'info');
    
    const imageUrls = [...window.imgsComunidad];

    try {
        await addDoc(collection(db, 'comentarios'), {
            texto: text,
            categoria: cat,
            usuarioNombre: user.displayName || user.email.split('@')[0],
            usuarioId: user.uid,
            fotoURL: user.photoURL || null,
            imageUrls: imageUrls,
            fecha: new Date().toLocaleString(),
            timestamp: serverTimestamp(),
            upvotes: 0,
            downvotes: 0,
            votosUp: [],
            votosDown: [],
            respuestas: []
        });
        document.getElementById('nuevo-comentario-txt').value = "";
        const preview = document.getElementById('nuevo-comentario-img-preview');
        if (preview) preview.innerHTML = "";

        window.imgsComunidad = [];
        notify("✅ Mensaje enviado a la comunidad.", 'success');
    } catch (e) {
        console.error("Error al publicar:", e);
        notify("❌ Error al publicar mensaje.", 'error');
    }
}

export async function mostrarPrevisualizacionComunidad() {
    const input = document.getElementById('nuevo-comentario-img');
    if (!input) return;
    const files = Array.from(input.files);
    for (const file of files) {
        const compressedData = await comprimirImagen(file);
        if(compressedData) window.imgsComunidad.push(compressedData);
    }
    input.value = ""; 
    renderAcumulado(window.imgsComunidad, 'nuevo-comentario-img-preview', '--s');
}

export async function mostrarPrevisualizacionRespuesta() {
    const input = document.getElementById('reply-img');
    if (!input) return;
    const files = Array.from(input.files);
    for (const file of files) {
        const compressedData = await comprimirImagen(file);
        if(compressedData) window.imgsRespuesta.push(compressedData);
    }
    input.value = "";
    renderAcumulado(window.imgsRespuesta, 'reply-img-preview', '--p');
}

export function filtrarComentariosUI() {
    const term = document.getElementById('search-comunidad')?.value.toLowerCase() || "";
    const cards = document.querySelectorAll('#lista-comentarios .comunidad-card');
    cards.forEach(card => {
        const text = card.innerText.toLowerCase();
        card.style.display = text.includes(term) ? 'block' : 'none';
    });
}

export async function cargarComentarios(filtro = 'todas') {
    const lista = document.getElementById('lista-comentarios');
    if (!lista) return;

    lista.innerHTML = '<p style="text-align: center; color: #555; grid-column: 1 / -1;">Sintonizando con el laboratorio...</p>';

    window.mostrarLoader();
    renderFiltrosComunidad(filtro);
    if (comunidadUnsubscribe) comunidadUnsubscribe();
    
    try {
        let q = query(collection(db, 'comentarios'), orderBy('timestamp', 'desc'), limit(50));
        if (filtro !== 'todas') {
            q = query(collection(db, 'comentarios'), where('categoria', '==', filtro), orderBy('timestamp', 'desc'), limit(50));
        }

        comunidadUnsubscribe = onSnapshot(q, (querySnapshot) => {
            window.ocultarLoader();
            if (querySnapshot.empty) {
                lista.innerHTML = `<p style="text-align:center; color:#555; grid-column: 1 / -1;">No hay mensajes en esta frecuencia de radio...</p>`;
                return;
            }
            
            const html = querySnapshot.docs.map(doc => {
                const user = auth.currentUser;
                const data = doc.data();
                const catInfo = CONFIG_COMUNIDAD[data.categoria] || { n: 'General', i: '📝', c: '#a0a0a0' };
                const avatar = data.fotoURL || "https://api.dicebear.com/7.x/bottts/svg?seed=" + data.usuarioId;
                
                const esAutor = (user && data.usuarioId === user.uid) || (user && user.uid === ADMIN_UID);
                const btnAcciones = esAutor ? `
                    <div style="position: absolute; top: 12px; right: 12px; display: flex; gap: 8px; z-index: 10;">
                        <button onclick='window.editarComentario("${doc.id}", ${JSON.stringify({texto: data.texto}).replace(/"/g, '&quot;')})' style="background: none; border: none; cursor: pointer; color: var(--p); font-size: 1rem; opacity: 0.7; transition: 0.3s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'" title="Editar">✏️</button> 
                        <button onclick="window.eliminarComentario('${doc.id}')" style="background: none; border: none; cursor: pointer; color: #ff3131; font-size: 1rem; opacity: 0.7; transition: 0.3s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'" title="Eliminar">🗑️</button>
                    </div>` : '';

                const hasVotedUp = user && data.votosUp && data.votosUp.includes(user.uid);
                const hasVotedDown = user && data.votosDown?.includes(user.uid);

                let respuestasHtml = "";
                if (data.respuestas && data.respuestas.length > 0) {
                    respuestasHtml = `
                        <div class="respuesta-thread">
                            ${data.respuestas.map(r => {
                                const rId = r.id || r.fecha;
                                const rVotedUp = user && r.votosUp?.includes(user.uid);
                                const rVotedDown = user && r.votosDown?.includes(user.uid);
                                const esAutorR = user && r.usuarioId === user.uid;
                                const btnEditarR = esAutorR ? `<span onclick="window.editarRespuesta('${doc.id}', '${rId}')" style="color:var(--p); cursor:pointer; font-size:0.6rem; margin-left:5px;">(editar)</span>` : '';

                                return `
                                <div style="font-size: 0.75rem; margin-bottom: 12px; border-bottom: 1px solid #222; padding-bottom: 12px;">
                                    <div style="margin-bottom: 8px;">
                                        <span style="color: var(--p); font-weight: bold;">${r.usuario}:</span> 
                                        <span style="color: #ccc;">${r.texto}</span>
                                        ${btnEditarR}
                                    </div>
                                    ${renderGalería(r.imageUrls || (r.imageUrl ? [r.imageUrl] : []))}
                                    <div style="display: flex; gap: 8px; align-items: center;">
                                        <button onclick="window.votarRespuesta('${doc.id}', '${rId}', 'up')" 
                                            style="background: ${rVotedUp ? 'rgba(57, 255, 20, 0.15)' : 'transparent'}; border: 1px solid ${rVotedUp ? '#39ff14' : '#333'}; color:${rVotedUp ? '#39ff14' : '#666'}; cursor:pointer; border-radius:4px; font-size:0.6rem; padding: 2px 8px;">
                                            👍 ${r.upvotes || 0}</button>
                                        <button onclick="window.votarRespuesta('${doc.id}', '${rId}', 'down')" 
                                            style="background: ${rVotedDown ? 'rgba(255, 49, 49, 0.1)' : 'transparent'}; border: 1px solid ${rVotedDown ? '#ff3131' : '#333'}; color:${rVotedDown ? '#ff3131' : '#666'}; cursor:pointer; border-radius:4px; font-size:0.6rem; padding: 2px 8px;">
                                            👎 ${r.downvotes || 0}</button>
                                    <span style="color: #444; font-size: 0.55rem; margin-left: auto;">${r.fecha}</span>
                                    </div>
                                </div>
                            `;}).join('')}
                        </div>
                    `;
                }

                return `
                    <div id="comment-${doc.id}" class="comunidad-card" style="position: relative; border-left: 4px solid ${catInfo.c}; box-shadow: 0 8px 32px 0 rgba(0,0,0,0.3), 0 0 15px ${catInfo.c}22;">
                        ${btnAcciones}
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <img src="${avatar}" style="width: 40px; height: 40px; border-radius: 50%; border: 2px solid ${catInfo.c}; object-fit: cover;">
                            <div style="flex: 1; overflow: hidden;">
                                <div style="color: #fff; font-weight: bold; font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${data.usuarioNombre.toUpperCase()}</div>
                                <div style="color: #666; font-size: 0.6rem;">${data.fecha}</div>
                            </div>
                            <span style="background: ${catInfo.c}22; color: ${catInfo.c}; border: 1px solid ${catInfo.c}; padding: 2px 6px; border-radius: 6px; font-size: 0.55rem; font-weight: 900; text-transform: uppercase;">
                                ${catInfo.i} ${catInfo.n}
                            </span>
                        </div>
                        <p style="margin: 15px 0 0 0; color: #eee; font-size: 0.9rem; line-height: 1.6; word-wrap: break-word; font-family: 'Courier New', monospace;">${data.texto}</p>
                        ${renderGalería(data.imageUrls || (data.imageUrl ? [data.imageUrl] : []))}
                        
                        ${respuestasHtml}

                        <div style="display: flex; gap: 10px; margin-top: 15px; align-items: center; border-top: 1px solid #222; padding-top: 12px;">
                            <button onclick="window.votarComentario('${doc.id}', 'up')" 
                                style="background: ${hasVotedUp ? 'rgba(57, 255, 20, 0.2)' : 'transparent'}; 
                                       border: 1px solid ${hasVotedUp ? '#39ff14' : '#333'}; 
                                       color: ${hasVotedUp ? '#39ff14' : '#888'}; 
                                       border-radius: 6px; padding: 4px 12px; font-size: 0.75rem; cursor: pointer; transition: 0.3s; 
                                       box-shadow: ${hasVotedUp ? '0 0 15px rgba(57, 255, 20, 0.4)' : 'none'}; font-weight: bold;">
                                👍 ${data.upvotes || 0}
                            </button>
                            <button onclick="window.votarComentario('${doc.id}', 'down')" 
                                style="background: ${hasVotedDown ? 'rgba(255, 49, 49, 0.15)' : 'transparent'}; 
                                       border: 1px solid ${hasVotedDown ? '#ff3131' : '#333'}; 
                                       color: ${hasVotedDown ? '#ff3131' : '#888'}; 
                                       border-radius: 6px; padding: 4px 12px; font-size: 0.75rem; cursor: pointer; transition: 0.3s; 
                                       box-shadow: ${hasVotedDown ? '0 0 15px rgba(255, 49, 49, 0.3)' : 'none'}; font-weight: bold;">
                                👎 ${data.downvotes || 0}
                            </button>
                            <button onclick="window.responderComentario('${doc.id}')" 
                                style="background: transparent; border: 1px solid var(--s); color: var(--s); 
                                       border-radius: 6px; padding: 4px 12px; font-size: 0.7rem; cursor: pointer; 
                                       transition: 0.3s; font-weight: bold; margin-left: auto;
                                       box-shadow: 0 0 5px rgba(188, 19, 254, 0.2);"
                                onmouseover="this.style.boxShadow='0 0 12px var(--s)'; this.style.background='rgba(188, 19, 254, 0.1)';"
                                onmouseout="this.style.boxShadow='0 0 5px rgba(188, 19, 254, 0.2)'; this.style.background='transparent';">
                                🌱 RESPONDER
                            </button>
                        </div>
                        <div id="reply-container-${doc.id}"></div>
                    </div>
                `;
            }).join('');

            lista.innerHTML = html;
            filtrarComentariosUI();

            if(filtro !== 'todas') lista.scrollIntoView({ behavior: 'smooth', block: 'start' });

        }, (error) => {
            window.ocultarLoader();
            console.error("Error técnico de Firestore:", error);
            
            const link = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
            
            lista.innerHTML = `<p style="color: var(--s); text-align: center; grid-column: 1 / -1; padding: 20px; border: 1px dashed var(--s); border-radius: 10px;">
                ${link 
                    ? `⚠️ <b>Falta un Índice en Firebase:</b> Los filtros por categoría requieren una configuración adicional en tu base de datos.<br><br>
                       <a href="${link[0]}" target="_blank" style="background:var(--p); color:#000; padding:10px 20px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block; border: 2px solid #fff;">✅ HACER CLIC AQUÍ PARA REPARAR</a><br><br>
                       <small style="color: #888;">(Se abrirá tu consola de Firebase. Presiona el botón "Crear índice" y espera 1-2 minutos a que se procese)</small>` 
                    : `❌ <b>Error de comunicación:</b> ${error.code === 'permission-denied' ? 'No tienes permisos suficientes.' : 'No se pudo cargar el filtro.'}<br><br>
                       <small style="color: #888;">Asegúrate de haber creado el índice compuesto para 'categoria' y 'timestamp' en Firestore.</small>`
                }
            </p>`;
        });
    } catch (e) {
        console.error("Error cargando comentarios:", e);
        lista.innerHTML = `<p style="color: var(--s); text-align: center; grid-column: 1 / -1;">Error al sintonizar con la comunidad.</p>`;
    }
}

export async function votarComentario(id, tipo) {
    const user = auth.currentUser;
    if (!user) return notify("🔒 Inicia sesión para votar.", 'info');

    try {
        const docRef = doc(db, 'comentarios', id);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return;

        const data = docSnap.data();
        const vUp = data.votosUp || [];
        const vDown = data.votosDown || [];
        const uid = user.uid;
        let update = {};

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
            }
            if (tipo === 'up' && !vUp.includes(uid)) crearNotificacion(data.usuarioId, `${user.displayName || 'Un alquimista'} indicó que tu mensaje le sirve.`, `view-comunidad#comment-${id}`);
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
            if (tipo === 'down' && !vDown.includes(uid)) crearNotificacion(data.usuarioId, `${user.displayName || 'Un alquimista'} indicó que tu mensaje no le sirve.`, `view-comunidad#comment-${id}`);
        }
        await updateDoc(docRef, update);
    } catch (e) {
        console.error("Error al votar:", e);
    }
}

export async function votarRespuesta(comentarioId, respuestaId, tipo) {
    const user = auth.currentUser;
    if (!user) return notify("🔒 Inicia sesión para votar.", 'info');

    try {
        const docRef = doc(db, 'comentarios', comentarioId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return;

        const data = docSnap.data();
        const respuestas = [...(data.respuestas || [])];
        const rIndex = respuestas.findIndex(r => (r.id === respuestaId) || (r.fecha === respuestaId));
        
        if (rIndex === -1) return;

        const r = respuestas[rIndex];
        r.votosUp = r.votosUp || [];
        r.votosDown = r.votosDown || [];
        r.upvotes = r.upvotes || 0;
        r.downvotes = r.downvotes || 0;
        const uid = user.uid;

        if (tipo === 'up') {
            if (r.votosUp.includes(uid)) {
                r.votosUp = r.votosUp.filter(id => id !== uid);
                r.upvotes--;
            } else {
                r.votosUp.push(uid);
                r.upvotes++;
                if (r.votosDown.includes(uid)) {
                    r.votosDown = r.votosDown.filter(id => id !== uid);
                    r.downvotes--;
                }
            }
            if (tipo === 'up' && r.votosUp.includes(uid)) crearNotificacion(r.usuarioId, `${user.displayName || 'Alquimista'} indicó que tu respuesta le sirve.`, `view-comunidad#comment-${comentarioId}`);
        } else {
            if (r.votosDown.includes(uid)) {
                r.votosDown = r.votosDown.filter(id => id !== uid);
                r.downvotes--;
            } else {
                r.votosDown.push(uid);
                r.downvotes++;
                if (r.votosUp.includes(uid)) {
                    r.votosUp = r.votosUp.filter(id => id !== uid);
                    r.upvotes--;
                }
            }
            if (tipo === 'down' && r.votosDown.includes(uid)) crearNotificacion(r.usuarioId, `${user.displayName || 'Alquimista'} indicó que tu respuesta no le sirve.`, `view-comunidad#comment-${comentarioId}`);
        }
        await updateDoc(docRef, { respuestas: respuestas });
    } catch (e) { console.error("Error al votar respuesta:", e); }
}

export function responderComentario(id) {
    const user = auth.currentUser;
    if (!user) return notify("🔒 Inicia sesión para responder.", 'info');
    currentReplyId = id;
    document.getElementById('reply-text-area').value = "";
    const imgInput = document.getElementById('reply-img');
    if (imgInput) imgInput.value = "";
    const preview = document.getElementById('reply-img-preview');
    if (preview) preview.innerHTML = "";
    document.getElementById('modal-respuesta').style.display = 'flex';
}

export function setupResponderComentarioHandler() {
    const btnConfirmarRespuesta = document.getElementById('btn-confirmar-respuesta');
    if (btnConfirmarRespuesta) {
        btnConfirmarRespuesta.onclick = async () => {
            const user = auth.currentUser;
            const texto = document.getElementById('reply-text-area').value.trim();

            if (!texto) return notify("✍️ Escribe algo antes de responder.", 'info');

            const imageUrls = [...window.imgsRespuesta];

            try {
                const parentSnap = await getDoc(doc(db, 'comentarios', currentReplyId));
                const parentData = parentSnap.data();

                await updateDoc(doc(db, 'comentarios', currentReplyId), {
                    respuestas: arrayUnion({
                        id: window.generarIdDiario(),
                        texto: texto,
                        imageUrls: imageUrls,
                        usuario: user.displayName || user.email.split('@')[0],
                        usuarioId: user.uid,
                        fecha: new Date().toLocaleString(),
                        upvotes: 0,
                        downvotes: 0,
                        votosUp: [],
                        votosDown: []
                    })
                });
                
                crearNotificacion(parentData.usuarioId, `${user.displayName || 'Alquimista'} respondió a tu mensaje en la comunidad.`, `view-comunidad#comment-${currentReplyId}`);

                document.getElementById('modal-respuesta').style.display = 'none';
                window.imgsRespuesta = [];
                notify("✅ Respuesta enviada.", 'success');
            } catch (e) {
                console.error("Error al responder:", e);
                notify("❌ Error al enviar respuesta.", 'error');
            }
        };
    }
}

export function editarComentario(id, data) {
    editingTarget = { type: 'comment', id };
    document.getElementById('edit-comment-txt').value = data.texto;
    document.getElementById('modal-editar-comentario').style.display = 'flex';
}

export async function editarRespuesta(commentId, replyId) {
    try {
        const docSnap = await getDoc(doc(db, 'comentarios', commentId));
        if (!docSnap.exists()) return;
        const reply = docSnap.data().respuestas.find(r => r.id === replyId);
        if (!reply) return;
        editingTarget = { type: 'reply', commentId, replyId };
        document.getElementById('edit-comment-txt').value = reply.texto;
        document.getElementById('modal-editar-comentario').style.display = 'flex';
    } catch (e) { console.error(e); }
}

export function setupEditarComentarioHandler() {
    const btnGuardarEdicion = document.getElementById('btn-guardar-edicion');
    if (btnGuardarEdicion) {
        btnGuardarEdicion.onclick = async () => {
            if (!editingTarget) return;
            const txt = document.getElementById('edit-comment-txt').value.trim();
            if (!txt) return notify("✍️ El texto no puede estar vacío.", 'info');

            try {
                if (editingTarget.type === 'comment') {
                    await updateDoc(doc(db, 'comentarios', editingTarget.id), { texto: txt });
                } else {
                    const docRef = doc(db, 'comentarios', editingTarget.commentId);
                    const snap = await getDoc(docRef);
                    const resps = [...snap.data().respuestas];
                    const idx = resps.findIndex(r => r.id === editingTarget.replyId);
                    if (idx !== -1) {
                        resps[idx].texto = txt;
                        await updateDoc(docRef, { respuestas: resps });
                    }
                }
                document.getElementById('modal-editar-comentario').style.display = 'none';
                notify("✅ Protocolo actualizado.", 'success');
            } catch (e) { console.error(e); notify("❌ Error al actualizar.", 'error'); }
        };
    }
}

export async function eliminarComentario(id) {
    if (!confirm("🔮 ¿Estás seguro de que deseas desvanecer este mensaje del laboratorio?")) return;
    
    try {
        await deleteDoc(doc(db, 'comentarios', id));
        await limpiarNotificacionesRelacionadas(id);
        notify("🧹 Comentario eliminado.", 'info');
    } catch (e) {
        console.error("Error al eliminar:", e);
        notify("❌ No se pudo eliminar el mensaje.", 'error');
    }
}

// --- LÓGICA DE MODERACIÓN ---
export async function cargarModeracion(coleccion) {
    const list = document.getElementById('admin-list');
    if (!list) return;

    const mapeo = { 
        'todos': 'btn-mod-todos', 
        'comentarios': 'btn-mod-comentarios', 
        'reseñas_productos': 'btn-mod-reseñas_productos',
        'sugerencias_notas': 'btn-mod-sugerencias_notas',
        'solicitudes_tablas': 'btn-mod-solicitudes'
    };
    Object.values(mapeo).forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (id === mapeo[coleccion]) { 
            btn.style.background = 'var(--p)'; btn.style.color = '#000'; 
        } else { 
            btn.style.background = 'transparent'; btn.style.color = 'var(--s)'; 
        }
    });

    list.innerHTML = '<p style="text-align:center;">Sintonizando registros...</p>';
    
    window._moderacionCache = {};

    try {
        let items = [];
        if (coleccion === 'todos') {
            const colecciones = ['comentarios', 'reseñas_productos', 'sugerencias_notas', 'solicitudes_tablas'];
            const fetchPromises = colecciones.map(async (colName) => {
                try {
                    const q = query(collection(db, colName), orderBy('timestamp', 'desc'), limit(30));
                    const snap = await getDocs(q);
                    snap.docs.forEach(doc => {
                        const data = doc.data();
                        if (colName === 'sugerencias_notas' && data.origen === 'sheet_override') return;
                        items.push({ id: doc.id, col: colName, ...data });
                    });
                } catch (err) {
                    console.warn(`Error cargando canal ${colName}:`, err);
                }
            });
            await Promise.all(fetchPromises);
            items.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
        } else {
            const q = query(collection(db, coleccion), orderBy('timestamp', 'desc'), limit(50));
            const snap = await getDocs(q);
            snap.docs.forEach(doc => {
                const data = doc.data();
                if (data.origen !== 'sheet_override') items.push({ id: doc.id, col: coleccion, ...data });
            });
        }
        
        items.forEach(d => window._moderacionCache[d.id] = d);

        list.innerHTML = items.map(d => {
            let tag = "OTRO";
            let color = "var(--p)";
            if(d.col === 'comentarios') { tag = "COMUNIDAD"; color = "var(--p)"; }
            else if(d.col === 'reseñas_productos') { tag = "RESEÑA"; color = "var(--s)"; }
            else if(d.col === 'sugerencias_notas') { tag = "NOTA"; color = "#00f2ff"; }
            else if(d.col === 'solicitudes_tablas') { tag = "SOLICITUD"; color = "#ff00ff"; }

            const prodIdParam = d.productId ? `'${d.productId}'` : 'null';
            
            let extraBtns = "";
            if (d.col === 'sugerencias_notas' && d.status === 'pendiente') {
                extraBtns = `<button class="btn" style="background:var(--p); color:black; font-size:0.7rem; padding: 5px 15px;" 
                             onclick="window.aprobarPropuestaNota('${d.id}')">APROBAR</button>`;
            }
            else if (d.col === 'solicitudes_tablas') {
                extraBtns = `<button class="btn" style="background:var(--p); color:black; font-size:0.7rem; padding: 5px 15px;" 
                             onclick="window.procesarSolicitudAdmin('${d.id}')">PROCESAR</button>`;
            }

            let mainText = d.texto || d.resumen || '<i>Contenido multimedia o valoración</i>';
            if (d.col === 'sugerencias_notas') {
                mainText = `
                    <div style="color:var(--p); font-weight:900; font-size:0.9rem; margin-bottom:3px; display:flex; align-items:center;">${(d.titulo || 'Sin Título').toUpperCase()}</div>
                    <div style="color:var(--s); font-size:0.65rem; font-weight:bold; letter-spacing:1px; margin-bottom:8px;">CATEGORÍA: ${(d.cat || 'General').toUpperCase()}</div>
                    <div style="color:#ccc; font-style:italic; line-height:1.4; border-left: 2px solid #333; padding-left:10px;">${d.resumen || 'Sin resumen proporcionado.'}</div>
                    <div style="margin-top:8px;"><small style="color:#555; font-size:0.6rem;">ESTADO: ${(d.status || 'pendiente').toUpperCase()}</small></div>`;
            }
            else if (d.col === 'solicitudes_tablas') {
                mainText = `
                    <div style="color:var(--p); font-weight:900; font-size:0.9rem; margin-bottom:3px;">MARCA: ${(d.marca || 'N/A').toUpperCase()}</div>
                    <div style="color:#ccc; font-size:0.75rem; margin-bottom:5px;">Línea: ${d.linea || 'No especificada'}</div>
                    <div style="color:var(--s); font-size:0.65rem;">Contacto: ${d.contacto || 'N/A'}</div>`;
            }

            let viewBtn = "";
            if (d.col === 'sugerencias_notas') {
                viewBtn = `<button class="btn" style="background:transparent; border:1px solid var(--p); color:var(--p); font-size:0.7rem; padding: 5px 15px;" 
                          onclick="window.leerPropuestaAdmin('${d.id}')">LEER</button>`;
            } else if (d.col !== 'solicitudes_tablas') {
                viewBtn = `<button class="btn" style="background:transparent; border:1px solid var(--p); color:var(--p); font-size:0.7rem; padding: 5px 15px;" 
                          onclick="window.irAInteraccion('${d.col}', '${d.id}', ${prodIdParam})">VER</button>`;
            }

            return `
            <div id="admin-item-${d.id}" class="comunidad-card" style="display:flex; justify-content:space-between; align-items:center; gap:20px; border: 1px solid #222; background: #0a0a0a;">
                <div style="flex:1;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                        <small style="color:${color}; font-weight:bold; letter-spacing:1px;">[${tag}] DE ${(d.usuarioNombre || 'Anon').toUpperCase()}</small>
                        <small style="color:#666; font-size:0.7rem;">${d.fecha || ''}</small>
                    </div>
                    <div style="margin:5px 0; font-size:0.85rem; font-family:monospace; color:#ccc;">${mainText}</div>
                </div>
                <div style="display:flex; gap:10px;">
                    ${extraBtns}
                    ${viewBtn}
                    <button class="btn" style="background:#ff3131; color:white; font-size:0.7rem; padding: 5px 15px;" 
                        onclick="window.borrarComoAdmin('${d.col}', '${d.id}', ${prodIdParam})">ELIMINAR</button>
                </div>
            </div>`;
        }).join('');
    } catch (e) { console.error(e); list.innerHTML = "Error al cargar datos."; }
}

export async function procesarSolicitudAdmin(id) {
    try {
        await deleteDoc(doc(db, 'solicitudes_tablas', id));
        notify("✅ Solicitud procesada y removida.", "success");
        cargarModeracion('solicitudes_tablas');
    } catch (e) { console.error(e); }
}

export async function borrarComoAdmin(coleccion, id, productId) {
    if (!confirm("⚠️ ¿ALQUIMISTA, estás seguro? Esta transmutación es irreversible. El mensaje desaparecerá para siempre.")) return;
    try {
        await deleteDoc(doc(db, coleccion, id));
        await limpiarNotificacionesRelacionadas(id);
        if (coleccion === 'reseñas_productos' && productId) {
            if (window.cargarRatingPromedio) window.cargarRatingPromedio(productId, `stars-grid-${productId}`);
            if (window.cargarRatingPromedio) window.cargarRatingPromedio(productId, `stars-search-${productId}`);
        }
        notify("🧹 Contenido purgado con éxito.", "info");
        cargarModeracion(coleccion);
    } catch (e) { notify("❌ Error al purgar.", "error"); }
}

export function irAInteraccion(coleccion, id, productId) {
    let path = "";
    let anchor = "";

    if (coleccion === 'comentarios') {
        path = 'view-comunidad';
        anchor = `comment-${id}`;
    } else if (coleccion === 'reseñas_productos') {
        path = `tienda:${productId}`;
        anchor = `review-${id}`;
    }

    if (path) {
        if (path.startsWith('tienda:')) {
            const pId = path.split(':')[1];
            window.irAProducto(pId);
        } else {
            window.ver(path, true, true);
        }

        if (anchor) {
            let intentos = 0;
            const intentarScroll = setInterval(() => {
                const el = document.getElementById(anchor);
                intentos++;
                if (el) {
                    clearInterval(intentarScroll);
                    setTimeout(() => {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('noti-target-highlight');
                        setTimeout(() => el.classList.remove('noti-target-highlight'), 3000);
                    }, 600);
                }
                if (intentos > 20) clearInterval(intentarScroll);
            }, 500);
        }
    }
}

// Exponer a window para compatibilidad con HTML y otros módulos
window.crearNotificacion = crearNotificacion;
window.leerNotificacion = leerNotificacion;
window.limpiarNotificacionesRelacionadas = limpiarNotificacionesRelacionadas;
window.ejecutarNavegacionConScroll = ejecutarNavegacionConScroll;
window.toggleNotificaciones = toggleNotificaciones;
window.escucharNotificaciones = escucharNotificaciones;

window.seleccionarCategoriaComunidad = seleccionarCategoriaComunidad;
window.renderSelectoresComunidad = renderSelectoresComunidad;
window.renderFiltrosComunidad = renderFiltrosComunidad;
window.enviarComentario = enviarComentario;
window.mostrarPrevisualizacionComunidad = mostrarPrevisualizacionComunidad;
window.mostrarPrevisualizacionRespuesta = mostrarPrevisualizacionRespuesta;
window.filtrarComentariosUI = filtrarComentariosUI;
window.cargarComentarios = cargarComentarios;
window.votarComentario = votarComentario;
window.votarRespuesta = votarRespuesta;
window.responderComentario = responderComentario;
window.editarComentario = editarComentario;
window.editarRespuesta = editarRespuesta;
window.eliminarComentario = eliminarComentario;
window.cargarModeracion = cargarModeracion;
window.procesarSolicitudAdmin = procesarSolicitudAdmin;
window.borrarComoAdmin = borrarComoAdmin;
window.irAInteraccion = irAInteraccion;

// Setup handlers for buttons that are outside the scope of direct function calls
document.addEventListener('DOMContentLoaded', () => {
    setupResponderComentarioHandler();
    setupEditarComentarioHandler();
});