import { db, auth } from './firebase-config.js';
import { 
    collection, addDoc, serverTimestamp, query, where, 
    getDocs, deleteDoc, doc, getDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { 
    notify, comprimirImagen, renderAcumulado, verImagenAmpliada, 
    verNotasCompletas, drawVPDGraph, analizarVPD, MATRIZ_NUTRIENTES 
} from './herramientaslab.js';

window.vistaDiarioActual = 'seguimiento';
window.imgsDiario = [];
window.imgsAnotacion = [];
window.diarioGrupoActivo = null;

export function generarIdDiario() { return Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8); }

export function mostrarFormularioDiario() {
    window.diarioGrupoActivo = null;
    const form = document.getElementById('formulario-diario');
    if (!form) return;

    // Limpiamos los campos para evitar confusión con registros anteriores
    document.getElementById('diario-nombre').value = '';
    document.getElementById('diario-semana').value = '1';
    document.getElementById('diario-ph').value = '';
    document.getElementById('diario-ec').value = '';
    document.getElementById('diario-temp').value = '';
    document.getElementById('diario-hum').value = '';
    document.getElementById('diario-notas').value = '';
    window.imgsDiario = [];

    const fechaInput = document.getElementById('diario-fecha');
    if (fechaInput) {
        fechaInput.valueAsDate = new Date();
    }
    form.style.display = 'flex';
}

export function ocultarFormularioDiario() {
    window.diarioGrupoActivo = null;
    const form = document.getElementById('formulario-diario');
    if (!form) return;
    window.imgsDiario = [];
    form.style.display = 'none';
    const imagenesInput = document.getElementById('diario-imagenes');
    if (imagenesInput) imagenesInput.value = '';
    const preview = document.getElementById('diario-imagenes-preview');
    if (preview) preview.innerHTML = '';
}

export function handleNuevoRegistroDiario() {
    if (window.vistaDiarioActual === 'seguimiento') {
        mostrarFormularioDiario();
    } else {
        mostrarModalNuevaAnotacion();
    }
}

export async function guardarRegistroDiario() {
    const usuario = auth.currentUser;
    const nombre = document.getElementById('diario-nombre')?.value.trim() || '';
    const fechaValor = document.getElementById('diario-fecha')?.value || '';
    const semana = document.getElementById('diario-semana')?.value || '';
    const etapa = document.getElementById('diario-etapa')?.value || '';
    const ph = document.getElementById('diario-ph')?.value || '';
    const ec = document.getElementById('diario-ec')?.value || '';
    const temp = document.getElementById('diario-temp')?.value || '';
    const hum = document.getElementById('diario-hum')?.value || '';
    const notas = document.getElementById('diario-notas')?.value.trim() || '';
    const imageUrls = [...window.imgsDiario];

    if (!nombre || !fechaValor || !semana || !etapa || !ph || !ec) {
        notify('⚠️ Completa los campos obligatorios.', 'info');
        return;
    }

    const registro = {
        tipo: 'diario',
        nombre: nombre,
        fecha: new Date(fechaValor).toLocaleString(),
        semana: semana,
        etapa: etapa,
        ph: ph,
        ec: ec,
        temp: temp,
        humedad: hum,
        imageUrls: imageUrls,
        notas: notas,
        usuario: usuario?.uid || 'anon',
        usuarioNombre: usuario?.displayName || usuario?.email || 'Anon',
        timestamp: serverTimestamp()
    };
    registro.id = generarIdDiario();
    registro.grupoId = window.diarioGrupoActivo || registro.id;

    if (!usuario) {
        notify('🔒 Debes iniciar sesión para guardar.', 'info');
        return;
    }

    try {
        await addDoc(collection(db, 'seguimientos'), registro);
        notify('✅ Registro guardado en el diario.', 'success');
        ocultarFormularioDiario();
        window.diarioGrupoActivo = null;
        cargarDiarioCultivo();
    } catch (e) {
        console.error('Error guardando registro de diario:', e);
        notify('❌ Error al guardar en la nube.', 'error');
    }
}

export async function cargarDiarioCultivo() {
    const containerSeg = document.getElementById('diario-registros');
    const containerAnot = document.getElementById('diario-anotaciones');
    const sinDatos = document.getElementById('sin-datos-diario');
    if (!containerSeg || !containerAnot || !sinDatos) return;
    
    containerSeg.innerHTML = '';
    containerAnot.innerHTML = '';
    window.mostrarLoader();

    // El Diario gestiona su propio estado inicial de vistas (Modularidad)
    if (window.vistaDiarioActual) {
        sincronizarUIVistaDiario(window.vistaDiarioActual);
    }

    if (window.vistaDiarioActual === 'tabla') { window.ocultarLoader(); return; }
    const usuarioActivo = auth.currentUser?.uid;
    if (!usuarioActivo) {
        sinDatos.innerHTML = `🔒 <span onclick="ver('view-login')" style="color:var(--s); cursor:pointer; text-decoration:underline; font-weight:bold;">Inicia sesión</span> para acceder a tu diario.`;
        sinDatos.style.display = 'block';
        window.ocultarLoader();
        return;
    }
    sinDatos.style.display = 'none';
    try {
        const q = query(collection(db, "seguimientos"), where("usuario", "==", usuarioActivo));
        const querySnapshot = await getDocs(q);
        const allDocs = querySnapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
        const registros = allDocs.filter(data => data.tipo === 'diario' || !data.tipo);
        const anotaciones = allDocs.filter(data => data.tipo === 'calculo');
        registros.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));
        anotaciones.sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0));

        if (window.vistaDiarioActual === 'seguimiento') {
            containerSeg.style.display = 'grid'; containerAnot.style.display = 'none';
            if (registros.length === 0) { sinDatos.innerText = "Sin seguimientos."; sinDatos.style.display = 'block'; }
            else registros.forEach(data => renderDiarioCard(containerSeg, data));
        } else {
            containerSeg.style.display = 'none'; containerAnot.style.display = 'grid';
            if (anotaciones.length === 0) { sinDatos.innerText = "Sin notas."; sinDatos.style.display = 'block'; }
            else anotaciones.forEach(data => renderAnotacionCard(containerAnot, data));
        }
    } catch (error) { console.error(error); }
    finally { window.ocultarLoader(); }
}

function renderDiarioCard(container, data) {
    const nombrePlanta = data.nombre || 'Sin Nombre';
    const safeId = 'dossier-' + nombrePlanta.toLowerCase().replace(/[^a-z0-9]/g, '-');
    let plantCard = document.getElementById(safeId);
    const dataJson = encodeURIComponent(JSON.stringify({...data, imageUrls: []}));
    if (!plantCard) {
        plantCard = document.createElement('div');
        plantCard.id = safeId; plantCard.className = 'tarjeta-expediente';
        plantCard.innerHTML = `
            <div class="expediente-header">
                <h3 style="margin:0; color: var(--p); font-size:1rem;">🧪 SEGUIMIENTO: ${nombrePlanta.toUpperCase()}</h3>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-m btn-add-week" style="font-size:0.6rem; border-color:var(--p); color:var(--p);" onclick="window.cargarRegistroEnFormulario('${dataJson}')">AÑADIR SEMANA</button>
                    <button class="btn btn-m" style="font-size:0.6rem; border-color:#ff4444; color:#ff4444;" onclick="window.eliminarSeguimiento('${nombrePlanta.replace(/'/g, "\\'")}')">ELIMINAR TODO</button>
                </div>
            </div>
            <div style="overflow-x:auto; width:100%; border-radius:8px;"><table class="tabla-historial-diario"><thead><tr><th>FECHA</th><th>SEMANA</th><th>ETAPA</th><th>PH</th><th>EC</th><th>TEMP</th><th>HUM</th><th>FOTO</th><th>ORÁCULO</th><th>OBSERVACIONES</th><th></th></tr></thead><tbody class="plant-history-body"></tbody></table></div>`;
        container.prepend(plantCard);
    } else {
        // Si el expediente ya existe, actualizamos el botón para que use la data más reciente (incremento correcto)
        const btnAdd = plantCard.querySelector('.btn-add-week');
        if (btnAdd) btnAdd.setAttribute('onclick', `window.cargarRegistroEnFormulario('${dataJson}')`);
    }
    const tbody = plantCard.querySelector('.plant-history-body');
    const row = document.createElement('tr');
    const notasEscaped = (data.notas || '').replace(/'/g, "\\'").replace(/\n/g, ' ');
    const imgUrlsJson = JSON.stringify(data.imageUrls || []).replace(/"/g, '&quot;');

    const imgHtml = data.imageUrls?.length > 0 ? `
        <div style="position:relative; width:35px; height:35px; margin:auto;">
            <img src="${data.imageUrls[0]}" style="width:35px; height:35px; object-fit:cover; border-radius:6px; cursor:pointer;" onclick="window.verImagenAmpliada('${data.imageUrls[0]}', ${imgUrlsJson})">
            ${data.imageUrls.length > 1 ? `<span style="position:absolute; top:-5px; right:-5px; background:var(--s); color:white; font-size:9px; width:14px; height:14px; border-radius:50%; display:flex; align-items:center; justify-content:center; border:1px solid #000;">${data.imageUrls.length}</span>` : ''}
        </div>
    ` : 'N/A';

    row.innerHTML = `
        <td data-label="FECHA">${data.fecha?.split(',')[0] || '---'}</td>
        <td data-label="SEMANA">${data.semana || '1'}</td>
        <td data-label="ETAPA"><span class="badge-etapa">${data.etapa || 'VEGE'}</span></td>
        <td data-label="PH">${data.ph || '--'}</td>
        <td data-label="EC">${data.ec || '--'}</td>
        <td data-label="TEMP">${data.temp || '--'}°</td>
        <td data-label="HUM">${data.humedad || '--'}%</td>
        <td data-label="FOTO">${imgHtml}</td>
        <td data-label="ORÁCULO"><button class="btn btn-m" style="font-size:0.6rem; padding:4px; border-color:var(--p); color:var(--p);" onclick="window.abrirReporteAlquimia('${encodeURIComponent(JSON.stringify(data))}')">🔮 REPORTE</button></td>
        <td data-label="OBSERVACIONES" onclick="window.verNotasCompletas('${notasEscaped}', 'OBSERVACIONES - ${nombrePlanta.toUpperCase()}', ${imgUrlsJson})" style="font-size:0.6rem; cursor:pointer; color:var(--p); text-decoration:underline;">${data.notas || 'VER'}</td>
        <td data-label="ACCION"><button onclick="window.eliminarRegistroDiario('${data.id}', this.closest('tr'))" style="background:none; border:none; color:#ff4444; cursor:pointer;">✕ ELIMINAR</button></td>
    `;
    tbody.prepend(row); // Insertamos al inicio para que la semana más nueva sea la primera página
}

function renderAnotacionCard(container, data) {
    const card = document.createElement('div');
    card.className = 'tarjeta anotacion-card-uniform';
    card.style.borderLeft = '4px solid var(--s)';
    card.style.padding = '20px';

    const isCalc = ['Nutrición', 'Energía', 'Sustrato', 'Clima (VPD)', 'Análisis pH/EC'].includes(data.nombre);
    const displayText = data.resultado?.length > 120 ? data.resultado.substring(0, 120) + "..." : (data.resultado || "");
    
    const imgUrls = data.imageUrls || [];
    let imgPreviewHtml = "";
    if (imgUrls.length > 0) {
        imgPreviewHtml = `
            <div style="display:flex; gap:6px; margin-top:12px; flex-wrap: wrap;">
                ${imgUrls.slice(0, 4).map(url => `<img src="${url}" style="width:35px; height:35px; object-fit:cover; border-radius:6px; border:1px solid rgba(188, 19, 254, 0.2);">`).join('')}
                ${imgUrls.length > 4 ? `<div style="width:35px; height:35px; background:rgba(0,0,0,0.5); border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:0.6rem; color:var(--p); border:1px solid rgba(188, 19, 254, 0.2);">+${imgUrls.length - 4}</div>` : ''}
            </div>`;
    }

    // Hacemos que toda la tarjeta sea clickable para ver el contenido completo
    card.onclick = () => window.verNotasCompletas(data.resultado, data.nombre, data.imageUrls || []);

    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:start;">
            <div>
                <span style="color:var(--p); font-size:0.7rem; font-weight:bold;">${isCalc ? '📊 CÁLCULO' : '📝 NOTA'}</span>
                <div style="color:var(--s); font-size:0.6rem; font-weight:bold; text-transform:uppercase;">${data.nombre}</div>
                <div style="color:#555; font-size:0.55rem; margin-top:2px;">${data.fecha?.split(',')[0] || '---'}</div>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
                <!-- El botón de editar abre el modal de edición manual -->
                <button onclick="event.stopPropagation(); window.editarAnotacion('${data.id}')" style="background:none; border:none; color:var(--p); cursor:pointer; font-size: 0.9rem; padding: 0;">✏️</button>
                <!-- El botón de eliminar lleva stopPropagation para evitar que se abra la nota al borrar -->
                <button onclick="event.stopPropagation(); window.eliminarAnotacion('${data.id}')" style="background:none; border:none; color:#ff4444; cursor:pointer; font-size: 1.1rem; padding: 0;">✕</button>
            </div>
        </div>
        <div class="anotacion-content-wrapper" style="font-size:0.75rem; color:#eee; margin-top:10px;">
            <div style="white-space: pre-wrap;">${displayText}</div>
            ${imgPreviewHtml}
        </div>`;
    container.appendChild(card);
}

export async function eliminarRegistroDiario(id, rowElement) {
    if (!await window.confirmAlquimista('¿Deseas desvanecer esta semana del registro?')) return;
    rowElement.remove();
    try { await deleteDoc(doc(db, 'seguimientos', id)); } catch (e) { console.error(e); }
}

export async function eliminarSeguimiento(nombre) {
    if (!await window.confirmAlquimista(`¿Eliminar todo el expediente de "${nombre}"? Esta transmutación es irreversible.`)) return;
    const q = query(collection(db, 'seguimientos'), where('usuario', '==', auth.currentUser.uid), where('nombre', '==', nombre));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(d => deleteDoc(doc(db, 'seguimientos', d.id))));
    cargarDiarioCultivo();
}

export function cambiarVistaDiario(vista) {
    window.vistaDiarioActual = vista;
    sincronizarUIVistaDiario(vista);
    if (vista !== 'tabla') cargarDiarioCultivo();
}

// Función auxiliar interna para no repetir lógica de CSS
function sincronizarUIVistaDiario(vista) {
    const tableVista = document.getElementById('vista-seguimiento-tabla');
    const diaryVista = document.getElementById('vista-diario-cultivo');

    if (tableVista && diaryVista) {
        if (vista === 'tabla') {
            tableVista.style.setProperty('display', 'block', 'important');
            diaryVista.style.setProperty('display', 'none', 'important');
        } else {
            tableVista.style.setProperty('display', 'none', 'important');
            diaryVista.style.setProperty('display', 'block', 'important');
        }
    }
    
    // El botón global de cambio de vista solo se muestra en la sección de Seguimientos
    const btnCompactView = document.getElementById('btn-toggle-vista-compacta');
    if (btnCompactView) {
        btnCompactView.style.display = (vista === 'seguimiento') ? 'block' : 'none';
    }
    
    const menu = document.getElementById('diario-menu-desplegable');
    if (menu) menu.classList.remove('active');
    const label = document.getElementById('label-vista-activa');
    if (label) label.innerText = vista === 'tabla' ? "📊 TABLA TÉCNICA" : (vista === 'seguimiento' ? "📂 SEGUIMIENTOS" : "📝 NOTAS");
}

export function toggleMenuDiario(e) {
    e.stopPropagation();
    const menu = document.getElementById('diario-menu-desplegable');
    if (menu) menu.classList.toggle('active');
}

export function toggleVistaCompacta() {
    // Aplicamos el cambio a todas las tablas de seguimiento presentes
    const tables = document.querySelectorAll('.tabla-historial-diario');
    tables.forEach(table => table.classList.toggle('compact-view'));
}

export function mostrarModalNuevaAnotacion() { document.getElementById('modal-nueva-anotacion').style.display = 'flex'; }
export function ocultarModalNuevaAnotacion() { document.getElementById('modal-nueva-anotacion').style.display = 'none'; }

export async function previsualizarAnotacion() {
    const input = document.getElementById('anotacion-img');
    if (!input) return;
    for (const file of Array.from(input.files)) {
        const data = await comprimirImagen(file);
        if(data) imgsAnotacion.push(data);
    }
    input.value = "";
    renderAcumulado(imgsAnotacion, 'anotacion-img-preview', '--s');
}

export async function editarAnotacion(id) {
    const docRef = doc(db, 'seguimientos', id);
    try {
        const snap = await getDoc(docRef);
        if (!snap.exists()) return;
        const data = snap.data();

        // Usamos el modal de anotación manual para editar
        mostrarModalNuevaAnotacion();
        const tituloInput = document.getElementById('anotacion-titulo');
        const contenidoInput = document.getElementById('anotacion-contenido');
        
        tituloInput.value = data.nombre || '';
        contenidoInput.value = data.resultado || '';

        const btnGuardar = document.querySelector('#modal-nueva-anotacion .btn-v');
        const originalText = btnGuardar.innerText;
        
        const restaurarModal = () => {
            btnGuardar.innerText = originalText;
            btnGuardar.onclick = () => window.guardarAnotacionManual();
            ocultarModalNuevaAnotacion();
        };

        btnGuardar.innerText = "ACTUALIZAR REGISTRO";
        btnGuardar.onclick = async () => {
            const nuevoTitulo = tituloInput.value.trim();
            const nuevoContenido = contenidoInput.value.trim();
            if (!nuevoTitulo || !nuevoContenido) return notify("⚠️ Completa los campos.", "info");

            try {
                await updateDoc(docRef, {
                    nombre: nuevoTitulo,
                    resultado: nuevoContenido,
                    timestamp: serverTimestamp()
                });
                notify("✅ Registro actualizado con éxito.", "success");
                restaurarModal();
                cargarDiarioCultivo();
            } catch (err) { console.error(err); notify("❌ Error al actualizar.", "error"); }
        };

        const btnCancelar = document.querySelector('#modal-nueva-anotacion .btn-m');
        const originalCancel = btnCancelar.onclick;
        btnCancelar.onclick = () => { restaurarModal(); btnCancelar.onclick = originalCancel; };
    } catch (e) { console.error(e); }
}

export async function eliminarAnotacion(id) {
    if (!await window.confirmAlquimista("¿Deseas purgar esta anotación de tu bitácora?")) return;
    try { await deleteDoc(doc(db, 'seguimientos', id)); notify("🗑️ Registro eliminado.", "info"); cargarDiarioCultivo(); } catch (e) { console.error(e); }
}

export async function mostrarPrevisualizacionDiario() {
    const input = document.getElementById('diario-imagenes');
    for (const file of Array.from(input.files)) {
        const data = await comprimirImagen(file);
        if(data) window.imgsDiario.push(data);
    }
    input.value = ""; 
    renderAcumulado(window.imgsDiario, 'diario-imagenes-preview', '--s');
}

export function cargarRegistroEnFormulario(dataJson) {
    const r = JSON.parse(decodeURIComponent(dataJson));
    mostrarFormularioDiario();
    document.getElementById('diario-nombre').value = r.nombre || '';
    document.getElementById('diario-semana').value = (parseInt(r.semana) + 1) || '1';
    document.getElementById('diario-etapa').value = r.etapa || 'esqueje';
}

export function abrirReporteAlquimia(dataJson) {
    const data = JSON.parse(decodeURIComponent(dataJson));
    document.getElementById('modal-diagnostico').style.display = 'flex';
    history.pushState({ section: 'tablas', subLab: 'seguimiento', view: 'reporte_alquimia' }, '', '#reporte-alquimia');
    let sem = parseInt(data.semana) || 1;
    const config = MATRIZ_NUTRIENTES[sem > 12 ? 12 : sem] || MATRIZ_NUTRIENTES[1];
    document.getElementById('diag-output-modal').innerHTML = `<h4 style="color:var(--p);">SEMANA ${sem}: ${config.n}</h4><p>pH: ${data.ph} | EC: ${data.ec}</p><div style="font-family:monospace; color:var(--p);">${config.ratio}</div>`;
    const t = parseFloat(data.temp), h = parseFloat(data.humedad);
    const svp = 0.61078 * Math.exp((17.27 * t) / (t + 237.3));
    const vpd = svp * (1 - (h / 100));
    setTimeout(() => {
        drawVPDGraph(t, h, vpd, 'vpd-canvas-modal', sem > 8 ? 8 : sem);
        analizarVPD(vpd, t, h, 'res-vpd-modal', 'consejo-alquimista-modal', sem > 8 ? 8 : sem);
    }, 100);
}

export async function guardarAnotacionManual() {
    const user = auth.currentUser;
    if (!user) return notify("🔒 Inicia sesión.", "info");
    const titulo = document.getElementById('anotacion-titulo').value.trim();
    const contenido = document.getElementById('anotacion-contenido').value.trim();
    if (!titulo || !contenido) return notify("⚠️ Completa los campos.", "info");
    try {
        await addDoc(collection(db, 'seguimientos'), {
            tipo: 'calculo', nombre: titulo, resultado: contenido,
            imageUrls: [...window.imgsAnotacion], usuario: user.uid,
            fecha: new Date().toLocaleString(), timestamp: serverTimestamp()
        });
        ocultarModalNuevaAnotacion(); notify("💾 Nota guardada.", "success"); cargarDiarioCultivo();
    } catch (e) { console.error(e); }
}

window.generarIdDiario = generarIdDiario;
window.mostrarFormularioDiario = mostrarFormularioDiario;
window.ocultarFormularioDiario = ocultarFormularioDiario;
window.handleNuevoRegistroDiario = handleNuevoRegistroDiario;
window.guardarRegistroDiario = guardarRegistroDiario;
window.cargarDiarioCultivo = cargarDiarioCultivo;
window.eliminarRegistroDiario = eliminarRegistroDiario;
window.eliminarSeguimiento = eliminarSeguimiento;
window.cambiarVistaDiario = cambiarVistaDiario;
window.toggleMenuDiario = toggleMenuDiario;
window.toggleVistaCompacta = toggleVistaCompacta;
window.mostrarModalNuevaAnotacion = mostrarModalNuevaAnotacion;
window.editarAnotacion = editarAnotacion;
window.ocultarModalNuevaAnotacion = ocultarModalNuevaAnotacion;
window.previsualizarAnotacion = previsualizarAnotacion;
window.eliminarAnotacion = eliminarAnotacion;
window.mostrarPrevisualizacionDiario = mostrarPrevisualizacionDiario;
window.cargarRegistroEnFormulario = cargarRegistroEnFormulario;
window.abrirReporteAlquimia = abrirReporteAlquimia;
window.guardarAnotacionManual = guardarAnotacionManual;

window.quitarImagenAcumulada = (containerId, idx) => {
    // Esta función ahora es manejada por el despachador global en index.html
    // No es necesaria aquí.
};