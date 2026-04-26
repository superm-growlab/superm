import { Agente } from '../agente_central.js';
import { app, db, auth, functions, ADMIN_UID } from './firebase-config.js';
import {
    collection, addDoc, serverTimestamp, query, where, orderBy,
    onSnapshot, getDocs, deleteDoc, doc, getDoc, updateDoc, arrayUnion, arrayRemove, increment, setDoc, limit 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
// 1. Matrices de datos (Sincronizadas con el conocimiento botánico de Super M)
export const MATRIZ_NUTRIENTES = {
    1: { n: "Plántula", ph: [5.5, 5.8], ec: [0.6, 0.9], ratio: "Iniciación (N-P-K 1-1-1)" },
    2: { n: "Plántula", ph: [5.5, 5.8], ec: [0.6, 0.9], ratio: "Iniciación (N-P-K 1-1-1)" },
    3: { n: "Vegetativo", ph: [5.8, 6.0], ec: [1.0, 1.4], ratio: "Crecimiento (N-P-K 3-1-2)" },
    4: { n: "Vegetativo", ph: [5.8, 6.0], ec: [1.0, 1.4], ratio: "Crecimiento (N-P-K 3-1-2)" },
    5: { n: "Pre-Flora", ph: [6.0, 6.2], ec: [1.4, 1.7], ratio: "Transición (N-P-K 2-2-2)" },
    6: { n: "Pre-Flora", ph: [6.0, 6.2], ec: [1.4, 1.7], ratio: "Transición (N-P-K 2-2-2)" },
    7: { n: "Floración Temprana", ph: [6.2, 6.3], ec: [1.6, 2.0], ratio: "Formación (Target 1.8)" },
    8: { n: "Floración Plena", ph: [6.2, 6.3], ec: [1.8, 2.2], ratio: "Producción (Target 2.0)" },
    9: { n: "Engorde Explosivo", ph: [6.3, 6.4], ec: [2.0, 2.4], ratio: "PICO DE ENGORDE (Target 2.2)" },
    10: { n: "Engorde", ph: [6.3, 6.4], ec: [1.8, 2.2], ratio: "Maduración Secundaria (Target 2.0)" },
    11: { n: "Maduración", ph: [6.4, 6.5], ec: [1.6, 1.9], ratio: "DESCENSO - Terpenos (Target 1.8)" },
    12: { n: "Lavado Final", ph: [6.0, 6.5], ec: [0.0, 0.5], ratio: "Limpieza Final (Sin Sales)" }
};

const matrizVPD = {
    1: { min: 0.4, max: 0.8, etapa: "Plántula/Esqueje" }, 2: { min: 0.4, max: 0.8, etapa: "Plántula/Esqueje" },
    3: { min: 0.8, max: 1.1, etapa: "Vegetativo" }, 4: { min: 0.8, max: 1.1, etapa: "Vegetativo" },
    5: { min: 1.1, max: 1.5, etapa: "Floración Temprana" }, 6: { min: 1.1, max: 1.5, etapa: "Floración Temprana" },
    7: { min: 1.1, max: 1.5, etapa: "Floración Tardía" }, 8: { min: 1.3, max: 1.6, etapa: "Floración Tardía/Maduración" },
    'default': { min: 0.8, max: 1.2, etapa: "General" }
};

window.mezclaActual = window.mezclaActual || [];
let scenarioAKwh = null; // Para calculadora de luz
let lastKwhCalculated = 0; // Para calculadora de luz
window.lastSustratoTipo = null; // Para calculadora de sustrato
window.bibliotecaVisual = [];

// Configuración de Rutas para el Detector (Oráculo)
const ORACULO_IMG_FALLBACK = "https://i.postimg.cc/rF9GqwGS/favicon.png";

// Estado del visor de imágenes para panning
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOffset = { x: 0, y: 0 };
let wasDragged = false;

window.app = app;
window.db = db;
window.auth = auth;
window.functions = functions;

// 2. Lógica de Navegación del Laboratorio
export function verSubSeccionLab(sub, guardar = true) {
    const parentSec = document.getElementById('tablas');
    // Si intentamos ver una subsección y la principal no está activa, la activamos primero
    if (parentSec && !parentSec.classList.contains('activa')) {
        window.ver('tablas', guardar);
    }
    if (guardar) history.pushState({ section: 'tablas', subLab: sub }, '', `#tablas/${sub}`);
    document.getElementById('lab-seguimiento').style.display = (sub === 'seguimiento') ? 'block' : 'none';
    document.getElementById('lab-calculadora').style.display = (sub === 'calculadora') ? 'block' : 'none';
    document.getElementById('lab-recetarios').style.display = (sub === 'recetarios') ? 'block' : 'none';
    
    const mapeo = { 'seguimiento': 'btn-nav-seg', 'calculadora': 'btn-nav-calc', 'recetarios': 'btn-nav-rec' };
    ['btn-nav-seg', 'btn-nav-calc', 'btn-nav-rec'].forEach(id => {
        const btn = document.getElementById(id);
        if (id === mapeo[sub]) { btn.style.background = 'var(--p)'; btn.style.color = '#000'; }
        else { btn.style.background = 'transparent'; btn.style.color = 'var(--s)'; }
    });
    
    if (sub === 'seguimiento') window.cargarDiarioCultivo();
    if (sub === 'calculadora') window.volverAlMenuCalc();
    if (sub === 'recetarios') {
        // Forzamos la ejecución de la función global
        if (typeof window.cargarRecetarios === 'function') {
            window.cargarRecetarios();
        } else {
            console.error("La función cargarRecetarios no está lista.");
        }
    }
}

// 3. Motor de Cálculo VPD
export function actualizarVPD() {
    const tInput = document.getElementById('temp-input').value;
    const hInput = document.getElementById('hum-input').value;
    const sGlobal = document.getElementById('semana-vpd').value;
    
    if (tInput === "" || hInput === "") return;
    const t = parseFloat(tInput);
    const h = parseFloat(hInput);
    let s = parseInt(sGlobal) || 1;
    
    const weekForVPD = s > 8 ? 8 : s;

    const svp = 0.61078 * Math.exp((17.27 * t) / (t + 237.3));
    const vpd = svp * (1 - (h / 100));
    
    const vpdConfig = matrizVPD[weekForVPD] || matrizVPD['default'];
    const container = document.getElementById('vpd-container');
    if (container) {
        const color = (vpd >= vpdConfig.min && vpd <= vpdConfig.max) ? '#39ff14' : '#bc13fe';
        container.style.borderColor = color;
    }

    window.drawVPDGraph(t, h, vpd, 'vpd-canvas', weekForVPD);
    window.analizarVPD(vpd, t, h, 'vpd-result', 'vpd-desc', weekForVPD);
    const btnSave = document.getElementById('btn-save-vpd');
    if(btnSave) btnSave.style.display = 'block';
}

// --- SISTEMA DE UTILIDADES MULTIMEDIA ---

/** --- SISTEMA DE NOTIFICACIONES VISUALES --- **/
export function notify(m, type = 'success') {
    const n = document.getElementById('notificacion');
    if(!n) return;
    n.innerText = m;
    n.style.display = 'block';
    
    if(type === 'error') {
        n.style.borderColor = '#ff4444';
        n.style.color = '#ff4444';
        n.style.boxShadow = '0 0 20px rgba(255, 68, 68, 0.4)';
    } else if (type === 'info') {
        n.style.borderColor = 'var(--s)';
        n.style.color = 'var(--s)';
        n.style.boxShadow = '0 0 20px rgba(188, 19, 254, 0.4)';
    } else {
        n.style.borderColor = 'var(--p)';
        n.style.color = 'var(--p)';
        n.style.boxShadow = '0 0 20px rgba(57, 255, 20, 0.4)';
    }
    
    setTimeout(() => { n.style.display = 'none'; }, 4000);
}

export const comprimirImagen = (file) => {
    return new Promise((resolve) => {
        if (!file || !file.type.startsWith('image/')) return resolve('');
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width, height = img.height, max_size = 800;
                const scale = Math.min(max_size / width, max_size / height, 1);
                canvas.width = width * scale;
                canvas.height = height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
};

export function renderAcumulado(arr, containerId, borderVar) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = arr.map((img, idx) => {
        return `
            <div style="position:relative; display:inline-block; margin-right:12px; margin-bottom:18px; vertical-align:top;">
                <img src="${img}" style="width:75px; height:75px; object-fit:cover; border-radius:10px; border:1px solid var(${borderVar}); box-shadow: 0 0 8px var(${borderVar});">
                <button onclick="window.quitarImagenAcumuladaGlobal('${containerId}', ${idx})" style="position:absolute; top:-8px; right:-8px; background:#ff3131; color:white; border:none; border-radius:50%; width:22px; height:22px; cursor:pointer; font-size:14px; font-weight:bold; display:flex; align-items:center; justify-content:center; z-index:15;">&times;</button>
            </div>`; // Se cambia para llamar a la función despachadora global
    }).join('');
}

export function verImagenAmpliada(url, lista = []) {
    const modal = document.getElementById('modal-visor-imagen');
    const img = document.getElementById('imagen-ampliada');
    if (modal && img) {
        panOffset = { x: 0, y: 0 };
        wasDragged = false;
        img.style.transform = 'translate(0px, 0px) scale(1)';
        img.classList.remove('zoomed');
        img.style.cursor = 'zoom-in';
        img.src = url;
        modal.style.display = 'flex';

        window.currentVisorImages = Array.isArray(lista) ? lista : [];
        window.currentVisorIndex = window.currentVisorImages.indexOf(url);
        const bPrev = document.getElementById('btn-prev-visor');
        const bNext = document.getElementById('btn-next-visor');
        if (window.currentVisorImages.length > 1 && window.currentVisorIndex !== -1) {
            bPrev.style.display = 'block'; bNext.style.display = 'block';
        } else {
            bPrev.style.display = 'none'; bNext.style.display = 'none';
        }
    }
}

export function navVisor(delta) {
    if (!window.currentVisorImages || window.currentVisorImages.length <= 1) return;
    
    window.currentVisorIndex = (window.currentVisorIndex + delta + window.currentVisorImages.length) % window.currentVisorImages.length;
    
    const img = document.getElementById('imagen-ampliada');
    if (img) {
        panOffset = { x: 0, y: 0 };
        img.src = window.currentVisorImages[window.currentVisorIndex];
        // Reset de zoom al cambiar de imagen
        img.classList.remove('zoomed');
        img.style.transform = 'translate(0px, 0px) scale(1)';
        img.style.cursor = 'zoom-in';
    }
}

export function toggleZoom() {
    if (wasDragged) return; // Si el usuario estaba arrastrando, no toggles el zoom
    const img = document.getElementById('imagen-ampliada');
    if (img.classList.contains('zoomed')) {
        img.classList.remove('zoomed');
        panOffset = { x: 0, y: 0 };
        img.style.transform = 'translate(0px, 0px) scale(1)';
        img.style.cursor = 'zoom-in';
    } else {
        img.classList.add('zoomed');
        img.style.transform = 'translate(0px, 0px) scale(2)';
        img.style.cursor = 'grab';
    }
}

export function verNotasCompletas(texto, titulo, imagenes = []) {
    const modal = document.getElementById('modal-visor-texto');
    const display = document.getElementById('texto-completo-visor');
    const head = document.getElementById('visor-texto-titulo');
    const imgCont = document.getElementById('visor-imagenes-contenedor');

    if (modal && display) {
        if (head && titulo) head.innerText = titulo;
        display.innerText = texto;
        if (imgCont) imgCont.innerHTML = (imagenes && imagenes.length > 0) ? window.renderGalería(imagenes) : "";
        modal.style.display = 'flex';
    }
}

// FUNCIÓN PARA RENDERIZAR GALERÍA DE IMÁGENES
export const renderGalería = (urls) => {
    if (!urls || urls.length === 0) return '';
    const urlsJson = JSON.stringify(urls).replace(/"/g, '&quot;');
    return `<div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:10px;">${urls.map(url => `<img src="${url}" style="width:100px; height:100px; object-fit:cover; border-radius:8px; border:1px solid var(--s); cursor:pointer;" onclick="window.verImagenAmpliada('${url}', ${urlsJson})">`).join('')}</div>`;
};

// 4. Gestión de Persistencia en Firebase Firestore
// 5. Funciones de Calculadoras
export function changeQtyValue(id, delta) {
    const input = document.getElementById(id);
    let val = parseFloat(input.value) || 0;
    let step = parseFloat(input.step) || 1;
    let newVal = val + (delta * step);
    if (input.min !== "" && newVal < parseFloat(input.min)) newVal = parseFloat(input.min);
    if (input.max !== "" && newVal > parseFloat(input.max)) newVal = parseFloat(input.max);
    input.value = newVal;
}

export function verCalc(id, guardar = true) {
    document.getElementById('menu-calculadoras').style.display = 'none';
    document.getElementById('visor-calculadoras').style.display = 'block';
    document.querySelectorAll('.calc-panel').forEach(p => p.style.display = 'none');
    if (guardar) history.pushState({ section: 'tablas', subLab: 'calculadora', calcId: id }, '', `#tablas/calculadora/${id}`);
    const panel = document.getElementById(id);
    if(panel) panel.style.display = 'block';
    
    if(id === 'vpd-container') {
        setTimeout(() => window.actualizarVPD(), 100); // Llama a la función expuesta globalmente
    }
    if(id === 'c-luz') window.calcLuz();
    if(id === 'c-sustrato') window.updateSustratoVolume();
}

export function calcLuz() {
    const wattsLuz = parseFloat(document.getElementById('l-watts').value) || 0;
    const factorTech = parseFloat(document.getElementById('l-tech').value) || 1;
    const horasLuz = parseFloat(document.getElementById('l-horas-fija').value) || 18;
    const meses = parseFloat(document.getElementById('l-meses').value) || 1;

    let totalKwh = (wattsLuz * factorTech * horasLuz * 30 * meses) / 1000;

    document.querySelectorAll('.row-consumo').forEach(row => {
        const w = parseFloat(row.querySelector('.sel-w').value) || 0;
        const h = parseFloat(row.querySelector('.sel-h').value) || 0;
        totalKwh += (w * h * 30 * meses) / 1000;
    });

    lastKwhCalculated = totalKwh;

    const diffContainer = document.getElementById('res-diferencia');
    if (scenarioAKwh !== null) {
        const diff = totalKwh - scenarioAKwh;
        if (diff < 0) {
            diffContainer.innerHTML = `<span class="diff-text diff-ahorro">✨ AHORRO: -${Math.abs(diff).toFixed(2)} kWh</span><br><small style="color:#888;">respecto al Escenario A</small>`;
        } else if (diff > 0) {
            diffContainer.innerHTML = `<span class="diff-text diff-exceso">⚠️ DIFERENCIA: +${diff.toFixed(2)} kWh</span><br><small style="color:#888;">respecto al Escenario A</small>`;
        } else {
            diffContainer.innerHTML = `<span class="diff-text" style="color:#888;">MISMO CONSUMO</span>`;
        }
    }

    const res = document.getElementById('res-luz');
    if(res) {
        res.style.display = 'block';
        res.innerHTML = `
            <h4 style="color:var(--p); margin-top:0;">AUDITORÍA ENERGÉTICA</h4>
            <div id="data-luz-save" style="display:none;">${totalKwh.toFixed(2)} kWh (${meses} mes/es)</div>
            <p>Consumo total estimado por ${meses} mes(es):</p>
            <div style="font-size:1.8rem; font-weight:900; color:var(--p); text-shadow: 0 0 10px var(--p); text-align:center;">
                ${totalKwh.toFixed(2)} <small style="font-size:0.8rem;">kWh</small>
            </div>
            <p style="font-size:0.7rem; color:#888; margin-top:10px; text-align:center;">
                Basado en un ciclo de ${horasLuz}h de luz y periféricos activos.
            </p>`;
    }
    const btnSave = document.getElementById('btn-save-luz');
    if(btnSave) btnSave.style.display = totalKwh > 0 ? 'block' : 'none';
}

export function drawVPDGraph(temp, hum, currentVPD, canvasId = 'vpd-canvas', weekForVPD = 'default') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth;
    const h = canvas.height = canvas.offsetHeight;
    const hMin = 20, hMax = 95, tMin = 15, tMax = 35, pad = 40; 
    const graphW = w - pad * 1.5, graphH = h - pad * 1.5;

    const vpdConfig = matrizVPD[weekForVPD] || matrizVPD['default'];
    const idealMin = vpdConfig.min;
    const idealMax = vpdConfig.max;
    
    ctx.clearRect(0, 0, w, h);
    for (let t = tMin; t <= tMax; t++) {
        for (let hu = hMin; hu <= hMax; hu++) {
            const localSvp = 0.61078 * Math.exp((17.27 * t) / (t + 237.3));
            const localVpd = localSvp * (1 - (hu / 100));
            let color = "#3c1053"; 
            if (localVpd >= idealMin && localVpd <= idealMax) color = "#1b5e20"; 
            if (localVpd > idealMax) color = "#b71c1c"; 
            const x = pad + ((hu - hMin) / (hMax - hMin)) * graphW;
            const y = (h - pad) - ((t - tMin) / (tMax - tMin)) * graphH;
            ctx.fillStyle = color;
            ctx.fillRect(x, y, graphW/(hMax-hMin) + 1, -graphH/(tMax-tMin) - 1);
        }
    }
    ctx.fillStyle = "#aaa"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    for (let i = 20; i <= 90; i += 10) { const x = pad + ((i - hMin) / (hMax - hMin)) * graphW; ctx.fillText(i, x, h - 15); }
    ctx.fillText("HUMEDAD %", w/2, h - 5);
    ctx.textAlign = "right";
    for (let i = 15; i <= 35; i += 5) { const y = (h - pad) - ((i - tMin) / (tMax - tMin)) * graphH; ctx.fillText(i + "°", pad - 5, y + 3); }

    if (temp >= tMin && temp <= tMax && hum >= hMin && hum <= hMax) {
        const px = pad + ((hum - hMin) / (hMax - hMin)) * graphW, py = (h - pad) - ((temp - tMin) / (tMax - tMin)) * graphH;
        ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h-pad); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pad, py); ctx.lineTo(w, py); ctx.stroke();
        ctx.setLineDash([]); ctx.shadowBlur = 15; ctx.shadowColor = "#39ff14"; ctx.fillStyle = "white";
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
}

export function analizarVPD(vpd, t, h, resId = 'res-vpd', consejoId = 'consejo-alquimista', weekForVPD = 'default') {
    const res = document.getElementById(resId), consejo = document.getElementById(consejoId);
    
    const vpdConfig = matrizVPD[weekForVPD] || matrizVPD['default'];
    const idealMin = vpdConfig.min;
    const idealMax = vpdConfig.max;
    const etapaNombre = vpdConfig.etapa;

    let status, msg, colorStatus;

    if (vpd < idealMin) {
        status = "⚠️ BAJO";
        colorStatus = "var(--s)";
        msg = `⚠️ *VPD Bajo (${vpd.toFixed(2)} kPa)* para la etapa de ${etapaNombre}. La baja transpiración detiene el flujo de Calcio (Ca) hacia los tejidos en crecimiento, lo que puede causar deficiencias. Además, el exceso de turgencia aumenta el riesgo de hongos y patógenos. Considera *aumentar la temperatura* o *reducir la humedad* para estimular la transpiración.`;
    } else if (vpd > idealMax) {
        status = "⚠️ ALTO";
        colorStatus = "var(--s)";
        msg = `⚠️ *VPD Alto (${vpd.toFixed(2)} kPa)* para la etapa de ${etapaNombre}. La planta experimenta estrés hídrico y cierra sus estomas para evitar la deshidratación. Esto detiene la fijación de CO2, frenando la fotosíntesis y el crecimiento. Considera *disminuir la temperatura* o *aumentar la humedad* para aliviar el estrés.`;
    } else {
        status = "✨ ÓPTIMO";
        colorStatus = "var(--p)";
        msg = `✅ *VPD Óptimo (${vpd.toFixed(2)} kPa)* para la etapa de ${etapaNombre}. Tu planta está en su pico de eficiencia fotosintética, con una transpiración ideal que maximiza la absorción de nutrientes y la fijación de CO2. ¡Excelente trabajo, Alquimista!`;
    }

    if(res) {
        res.style.display = 'block';
        res.style.borderLeftColor = colorStatus;
        res.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:5px;">
                <h4 style="color:var(--p); margin:0; font-size:0.8rem; letter-spacing:1px;">REPORTE CLIMÁTICO - ${etapaNombre.toUpperCase()}</h4>
                <span style="font-size:0.7rem; font-weight:bold; color:${colorStatus};">${status}</span>
            </div>
            <div style="text-align:center; padding: 5px 0;">
                <span style="font-size:0.75rem; color:#888;">VALOR ACTUAL:</span><br>
                <b style="color:${colorStatus}; font-size:1.8rem; text-shadow: 0 0 10px ${colorStatus}40;">${vpd.toFixed(2)} <small style="font-size:0.8rem;">kPa</small></b>
            </div>
            <div style="display:flex; justify-content:space-between; margin-top:10px; font-size:0.65rem; color:#555; text-transform:uppercase;">
                <span>Ideal para esta etapa:</span>
                <span style="color:var(--p);">${idealMin} - ${idealMax} kPa</span>
            </div>`;
    }
    if(consejo) {
        consejo.style.display = 'block';
        consejo.innerHTML = msg;
    }
}

export function toggleUnidadEC(nueva) {
    const hiddenUnidad = document.getElementById('diag-unidad');
    if (!hiddenUnidad || hiddenUnidad.value === nueva) return;
    hiddenUnidad.value = nueva;
    const input = document.getElementById('diag-ec-val');
    let val = parseFloat(input.value) || 0;
    const btnMs = document.getElementById('btn-unit-ms');
    const btnPpm = document.getElementById('btn-unit-ppm');
    const label = document.getElementById('label-ec');
    if (nueva === 'ppm') {
        input.value = Math.round(val * 500);
        input.step = 10;
        if(label) label.innerText = "CONDUCTIVIDAD (PPM)";
        if(btnPpm) { btnPpm.style.background = 'var(--p)'; btnPpm.style.color = '#000'; btnPpm.style.boxShadow = '0 0 10px var(--p)'; }
        if(btnMs) { btnMs.style.background = 'transparent'; btnMs.style.color = 'var(--s)'; btnMs.style.boxShadow = 'none'; }
    } else {
        input.value = (val / 500).toFixed(1);
        input.step = 0.1;
        if(label) label.innerText = "CONDUCTIVIDAD (mS/cm)";
        if(btnMs) { btnMs.style.background = 'var(--p)'; btnMs.style.color = '#000'; btnMs.style.boxShadow = '0 0 10px var(--p)'; }
        if(btnPpm) { btnPpm.style.background = 'transparent'; btnPpm.style.color = 'var(--s)'; btnPpm.style.boxShadow = 'none'; }
    }
    window.generarDiagnostico();
}

export function ajustarValorManual(id, direccion) {
    const el = document.getElementById(id);
    if(!el) return;
    let val = parseFloat(el.value.replace(',', '.')) || 0;
    let step = parseFloat(el.step) || 0.1;
    let nuevoVal = val + (direccion * step);
    
    el.value = step < 1 ? nuevoVal.toFixed(1) : Math.round(nuevoVal).toString();
    window.generarDiagnostico();
}

export function generarDiagnostico() {
    let semana = parseInt(document.getElementById('semana-nutrientes').value) || 1;
    let ecVal = parseFloat(document.getElementById('diag-ec-val')?.value.replace(',', '.'));
    let phVal = parseFloat(document.getElementById('diag-ph')?.value.replace(',', '.'));
    const res = document.getElementById('res-diagnostico');
    const unidadId = document.getElementById('diag-unidad')?.value;
    
    if (isNaN(ecVal) || isNaN(phVal)) {
        if(res) res.style.display = 'none';
        return;
    }

    if (unidadId === 'ppm' && !Number.isInteger(ecVal) && !isNaN(ecVal)) {
        ecVal = Math.round(ecVal);
        document.getElementById('diag-ec-val').value = ecVal;
    }

    const ec = (unidadId === 'ppm') ? ecVal / 500 : ecVal;
    const config = MATRIZ_NUTRIENTES[semana] || MATRIZ_NUTRIENTES[1];
    let dPh = "", dEc = "", alert = false;

    if (phVal > config.ph[1]) {
        dPh = "⚠️ pH ALTO (Alcalinidad): Los micronutrientes como Hierro (Fe) y Zinc (Zn) se vuelven insolubles. Riesgo de clorosis.";
        alert = true;
    } else if (phVal < config.ph[0]) {
        dPh = "⚠️ pH BAJO (Acidez): Se bloquea la absorción de Calcio (Ca) y Magnesio (Mg). Posible debilidad estructural.";
        alert = true;
    } else {
        dPh = "✅ pH en rango óptimo. Máxima estabilidad iónica.";
    }

    if (ec > config.ec[1] + 0.05) {
        dEc = "⚠️ EC ALTA (Estrés Osmótico): Concentración de sales tóxica. Las raíces pierden capacidad de hidratación.";
        alert = true;
    } else if (ec < config.ec[0] - 0.05) {
        dEc = "⚠️ EC BAJA (Inanición Mineral): La planta no recibe la presión osmótica necesaria para el transporte de nutrientes.";
        alert = true;
    } else {
        dEc = "✅ Nivel de sales balanceado para el metabolismo actual.";
    }

    const bio = (phVal >= config.ph[0] && phVal <= config.ph[1]) ? "Óptima" : "Limitada";
    
    if(res) {
        res.style.borderLeftColor = alert ? "#bc13fe" : "#39ff14";
        res.style.boxShadow = alert ? "0 0 15px rgba(188, 19, 254, 0.2)" : "0 0 15px rgba(57, 255, 20, 0.2)";
        res.style.display = 'block';

        res.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:5px;">
                <h4 style="color:var(--p); margin:0; font-size:0.8rem; letter-spacing:1px;">SEMANA ${semana}: ${config.n.toUpperCase()}</h4>
                <span style="font-size:0.7rem; font-weight:bold; color:${alert ? 'var(--s)' : 'var(--p)'};">${alert ? '⚠ AJUSTE' : '✔ OK'}</span>
            </div>
            <div style="font-size:0.8rem; line-height:1.4; color:#fff;">
                <p style="margin:8px 0; border-left: 2px solid ${phVal > config.ph[1] || phVal < config.ph[0] ? 'var(--s)' : 'var(--p)'}; padding-left:10px;">${dPh}</p>
                <p style="margin:8px 0; border-left: 2px solid ${ec > config.ec[1] + 0.05 || ec < config.ec[0] - 0.05 ? 'var(--s)' : 'var(--p)'}; padding-left:10px;">${dEc}</p>
            </div>
            <div style="margin-top:15px; padding:10px; background:rgba(0,0,0,0.4); border-radius:8px; border:1px dashed #333;">
                <div style="font-size:0.75rem; color:#888; margin-bottom:5px;"><b>ESTADO DEL RATIO:</b></div>
                <div style="font-size:0.85rem; color:var(--p); font-family:monospace;">${config.ratio}</div>
                <div style="font-size:0.75rem; color:#888; margin-top:5px;">Biodisponibilidad: <b style="color:${bio === 'Óptima' ? 'var(--p)' : 'var(--s)'}">${bio}</b></div>
            </div>
        `;
    }
    const btnSave = document.getElementById('btn-save-diag');
    if(btnSave) btnSave.style.display = 'block';
}

export async function prepararGuardadoCalculo(tipo) {
    const user = auth.currentUser;
    if (!user) return window.notify("🔒 Inicia sesión para guardar en tu diario.", "info");

    let resultado = "";
    if (tipo === 'Nutrición') {
        const litros = document.getElementById('m-litros-tacho').value;
        const tachos = document.getElementById('m-tachos').value;
        const total = document.getElementById('m-vol-total').innerText;
        resultado = `CONFIGURACIÓN: ${litros}L x ${tachos} tachos (Total: ${total})\n\nMEZCLA DE COMPUESTOS:\n` + window.mezclaActual.map(m => `- ${m.nombre}: ${m.dosis}ml/L`).join('\n');
    } else if (tipo === 'Energía') {
        const tech = document.getElementById('l-tech').options[document.getElementById('l-tech').selectedIndex].text;
        const watts = document.getElementById('l-watts').value;
        const hs = document.getElementById('l-horas-fija').value;
        const meses = document.getElementById('l-meses').value;
        const otros = Array.from(document.querySelectorAll('.row-consumo')).map(r => {
            const selW = r.querySelector('.sel-w');
            return `- ${selW.options[selW.selectedIndex].text}`;
        }).join('\n');
        resultado = `PARÁMETROS: ${tech} (${watts}W) | Ciclo: ${hs}hs | Tiempo: ${meses} mes/es\n${otros ? 'EQUIPOS EXTRA:\n' + otros + '\n' : ''}\n` + document.getElementById('res-luz').innerText;
    } else if (tipo === 'Sustrato') {
        const cap = document.getElementById('s-capacidad').value;
        const cant = document.getElementById('s-cantidad').value;
        const total = (parseFloat(cap) * parseFloat(cant)).toFixed(1);
        resultado = `CONFIGURACIÓN: ${cap}L x ${cant} maceta/s (Total a preparar: ${total}L)\n\n` + document.getElementById('res-sustrato').innerText;
    } else if (tipo === 'Clima (VPD)') {
        const sem = document.getElementById('semana-vpd').options[document.getElementById('semana-vpd').selectedIndex].text;
        const t = document.getElementById('temp-input').value;
        const h = document.getElementById('hum-input').value;
        resultado = `CONDICIONES: ${sem} | Temp: ${t}°C | Hum: ${h}%\n\n` + document.getElementById('vpd-result').innerText;
    } else if (tipo === 'Análisis pH/EC') {
        const sem = document.getElementById('semana-nutrientes').options[document.getElementById('semana-nutrientes').selectedIndex].text;
        const ec = document.getElementById('diag-ec-val').value;
        const unit = document.getElementById('diag-unidad').value.toUpperCase();
        const ph = document.getElementById('diag-ph').value;
        resultado = `ESTADO: ${sem} | EC: ${ec} ${unit} | pH: ${ph}\n\n` + document.getElementById('res-diagnostico').innerText;
    }

    try {
        await addDoc(collection(db, 'seguimientos'), {
            tipo: 'calculo',
            nombre: tipo,
            resultado: resultado,
            usuario: user.uid,
            fecha: new Date().toLocaleString(),
            timestamp: serverTimestamp()
        });
        window.notify("💾 Cálculo guardado en tu diario.", "success");
    } catch (e) {
        console.error(e);
        window.notify("❌ Error al guardar.", "error");
    }
}

export function updateMezclaVolume() {
    const litrosTacho = parseFloat(document.getElementById('m-litros-tacho')?.value) || 0;
    const cantidadTachos = parseFloat(document.getElementById('m-tachos')?.value) || 0;
    
    let presetFound = false;
    document.querySelectorAll('.quick-selector-btn').forEach(btn => {
        const btnVal = parseFloat(btn.innerText);
        if (btnVal === litrosTacho) {
            presetFound = true;
            btn.style.borderColor = 'var(--p)';
            btn.style.color = 'var(--p)';
            btn.style.boxShadow = '0 0 8px var(--p)';
        } else {
            btn.style.borderColor = 'var(--s)';
            btn.style.color = 'var(--s)';
            btn.style.boxShadow = 'none';
        }
    });

    const totalLitros = litrosTacho * cantidadTachos;
    const volTotal = document.getElementById('m-vol-total');
    if(volTotal) volTotal.innerText = `${totalLitros.toFixed(1)}L`;
    window.renderMezclaActual();
}

export function setMezclaLitros(litros) {
    const el = document.getElementById('m-litros-tacho');
    if(el) el.value = litros;
    window.updateMezclaVolume();
}

export function setSustratoLitros(litros) {
    const el = document.getElementById('s-capacidad');
    if(el) el.value = litros;
    window.updateSustratoVolume();
}

export function updateSustratoVolume() {
    const l = parseFloat(document.getElementById('s-capacidad')?.value) || 0;
    const c = parseFloat(document.getElementById('s-cantidad')?.value) || 0;
    
    document.querySelectorAll('.quick-selector-btn-s').forEach(btn => {
        const btnVal = parseFloat(btn.innerText);
        if (btnVal === l) {
            btn.style.borderColor = 'var(--p)';
            btn.style.color = 'var(--p)';
            btn.style.boxShadow = '0 0 8px var(--p)';
        } else {
            btn.style.borderColor = 'var(--s)';
            btn.style.color = 'var(--s)';
            btn.style.boxShadow = 'none';
        }
    });

    const totalLitros = l * c;
    const sVolTotal = document.getElementById('s-vol-total');
    if(sVolTotal) sVolTotal.innerText = `${totalLitros.toFixed(1)}L`;

    if (window.lastSustratoTipo) {
        window.calcSustratoReceta(window.lastSustratoTipo, true);
    }
}

export function agregarAMezclaActual() {
    const nombre = document.getElementById('m-prod-nombre')?.value.trim();
    const dosis = parseFloat(document.getElementById('m-dosis')?.value);

    if (!nombre || isNaN(dosis) || dosis <= 0) {
        return window.notify("⚠️ Ingresa un nombre y una dosis válida.", 'info');
    }

    window.mezclaActual.push({
        nombre: nombre,
        dosis: dosis
    });

    const nameInput = document.getElementById('m-prod-nombre');
    if(nameInput) nameInput.value = "";
    const dosisInput = document.getElementById('m-dosis');
    if(dosisInput) dosisInput.value = "2";
    window.renderMezclaActual();
    window.notify(`✅ ${nombre} añadido a la mezcla.`, 'success');
}

export function eliminarDeMezcla(index) {
    window.mezclaActual.splice(index, 1);
    window.renderMezclaActual();
    window.notify("🗑️ Producto eliminado de la mezcla.", 'info');
}

export function renderMezclaActual() {
    const listaContainer = document.getElementById('lista-mezcla-dinamica');
    const litrosTacho = parseFloat(document.getElementById('m-litros-tacho')?.value) || 0;
    const cantidadTachos = parseFloat(document.getElementById('m-tachos')?.value) || 0;
    const totalLitros = litrosTacho * cantidadTachos;

    if (!listaContainer) return;

    if (window.mezclaActual.length === 0) {
        listaContainer.innerHTML = '<p style="color: #555; font-size: 0.7rem; text-align: center; margin: 15px 0; font-style: italic;">Sin compuestos en el tanque...</p>';
        return;
    }
    listaContainer.innerHTML = window.mezclaActual.map((item, index) => {
        const totalMl = item.dosis * totalLitros;
        const mlPorTacho = item.dosis * litrosTacho;
        return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #222;">
            <div><b style="color:var(--p);">${item.nombre}</b><br><small style="color:#888;">Dosis: ${item.dosis.toFixed(1)} ml/L</small></div>
            <div style="text-align:right;"><span style="color:var(--s); font-weight:bold;">${totalMl.toFixed(2)} ml</span><br><small style="color:#888;">(${mlPorTacho.toFixed(2)} ml/tacho)</small></div>
            <button onclick="window.eliminarDeMezcla(${index})" style="background:none; border:none; color:#ff3131; cursor:pointer; font-size:1.2rem;">&times;</button>
        </div>`;
    }).join('');
    const btnSave = document.getElementById('btn-save-mezcla');
    if(btnSave) btnSave.style.display = 'block';
}

export function calcSustratoReceta(tipo, skipNotify = false) {
    window.lastSustratoTipo = tipo;
    const l = parseFloat(document.getElementById('s-capacidad')?.value), c = parseFloat(document.getElementById('s-cantidad')?.value);
    if(!l || !c) {
        if(!skipNotify) window.notify("⚠️ Ingresa litros y cantidad.", 'info');
        return;
    }
    const totalLitros = l * c, res = document.getElementById('res-sustrato');
    if(!res) return;
    res.style.display = 'block';
    let t_p, p_p, h_p, v_p, o_p, nombre, desc;
    if(tipo === 'estandar') {
        nombre = "⚖️ MEZCLA ESTÁNDAR"; desc = "Equilibrada para fotoperiódicas.";
        t_p = 0.50; p_p = 0.20; h_p = 0.15; v_p = 0.10; o_p = 0.05;
    } else if(tipo === 'auto') {
        nombre = "🚀 MEZCLA AUTO"; desc = "Máxima aireación radicular.";
        t_p = 0.45; p_p = 0.35; h_p = 0.10; v_p = 0.10; o_p = 0;
    } else {
        nombre = "🌿 MEZCLA BIO +"; desc = "Alta carga nutricional orgánica.";
        t_p = 0.40; p_p = 0.20; h_p = 0.25; v_p = 0.15; o_p = 0;
    }

    const row = (label, pct) => {
        if(pct === 0) return '';
        const total = (totalLitros * pct).toFixed(1);
        const perPot = (l * pct).toFixed(1);
        return `<p style="margin: 8px 0; display: flex; justify-content: space-between; border-bottom: 1px solid #222; padding-bottom: 4px; font-size: 0.8rem;">
            <span>${label}</span>
            <span style="font-family: monospace;">
                <b class="val-v">${total}L</b> 
                <small style="color:#666; margin-left:5px;">(${perPot}L/maceta)</small>
            </span>
        </p>`;
    };

    res.innerHTML = `<h4 style="color:var(--p); border-bottom:1px solid #333; padding-bottom:10px; margin:0;">${nombre}</h4>
        <p style="font-size:0.75rem; color:#888; margin:5px 0 15px 0;">${desc}</p>
        <div style="text-align:left;">
            ${row("🌿 Turba/Coco:", t_p)}
            ${row("⚪ Perlita:", p_p)}
            ${row("🪱 Humus:", h_p)}
            ${row("💎 Vermiculita:", v_p)}
            ${row("🍂 Otros:", o_p)}
        </div><div style="background:#000; padding:8px; border-radius:5px; margin-top:15px; border:1px dashed var(--s); text-align:center;">
        <span style="font-size:0.8rem; color:var(--s); font-weight:bold;">TOTAL: ${totalLitros.toFixed(1)} LITROS</span></div>`;
    const btnSave = document.getElementById('btn-save-sustrato');
    if(btnSave) btnSave.style.display = 'block';
}

export function setFaseLuz(horas, btn) {
    const hsInput = document.getElementById('l-horas-fija');
    if(hsInput) hsInput.value = horas;
    document.querySelectorAll('.calc-panel .etapa-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    window.calcLuz();
}

export function addComponenteConsumo() {
    const container = document.getElementById('container-otros-consumos');
    if(!container) return;
    const div = document.createElement('div');
    div.className = 'row-consumo';
    div.style = "display:flex; gap:5px; align-items:center; background:#111; padding:8px; border-radius:8px; border:1px solid var(--s);";
    div.innerHTML = ` 
        <select class="input-lab sel-w" style="flex:2; padding:5px; font-size:0.7rem; border-color:#333;" onchange="window.calcLuz()">
            <option value="60">Extractor (60W)</option>
            <option value="20">Ventilador de Clip (20W)</option>
            <option value="35">Humidificador (35W)</option>
            <option value="15">Aireador Hidro (15W)</option>
            <option value="800">Aire Acond. (800W)</option>
        </select>
        <select class="input-lab sel-h" style="flex:1; padding:5px; font-size:0.7rem; border-color:#333;" onchange="window.calcLuz()">
            <option value="24">24h</option>
            <option value="18">18h</option>
            <option value="12">12h</option>
        </select> 
        <button onclick="this.parentElement.remove(); window.calcLuz()" style="background:none; border:none; color:#ff4444; cursor:pointer; font-weight:bold; padding:0 5px;">&times;</button>
    `;
    container.appendChild(div);
    window.calcLuz();
}

export function fijarEscenarioA() {
    scenarioAKwh = lastKwhCalculated;
    const valEscA = document.getElementById('val-escenario-a');
    if(valEscA) valEscA.innerText = scenarioAKwh.toFixed(2) + ' kWh';
    const compCont = document.getElementById('comparativa-luz-container');
    if(compCont) compCont.style.display = 'block';
    window.calcLuz();
    window.notify("💾 Escenario A capturado en memoria.", 'info');
}

export function reiniciarComparativa() {
    scenarioAKwh = null;
    const compCont = document.getElementById('comparativa-luz-container');
    if(compCont) compCont.style.display = 'none';
    window.notify("🔄 Comparativa reiniciada.", 'info');
}

export function volverAlMenuCalc() {
    const menu = document.getElementById('menu-calculadoras');
    if(menu) menu.style.display = 'grid';
    const visor = document.getElementById('visor-calculadoras');
    if(visor) visor.style.display = 'none';
    document.querySelectorAll('.calc-panel').forEach(p => p.style.display = 'none');
}

export function nuevaFila(datos = ["", "", "", "", "", "", "", ""]) {
    const labels = ["PLANTA", "SEMANA", "PH", "EC", "TEMP °C", "HUM %", "RIEGO", "OBSERVACIONES"];
    const tr = document.createElement('tr');
    tr.innerHTML = datos.map((d, i) => `<td data-label="${labels[i]}"><input type="text" class="input-tabla" value="${d}" oninput="window.guardarTablas()"></td>`).join('');
    const tbody = document.getElementById('cuerpo-tabla');
    if(tbody) tbody.appendChild(tr);
}

export function guardarTablas() {
    const filas = [];
    document.querySelectorAll('#cuerpo-tabla tr').forEach(tr => {
        const c = Array.from(tr.querySelectorAll('input')).map(i => i.value);
        filas.push(c);
    });
    localStorage.setItem('superm_tablas', JSON.stringify(filas));
}

export function cargarTablasPersistentes() {
    const tbody = document.getElementById('cuerpo-tabla');
    if(!tbody) return;
    tbody.innerHTML = "";
    
    let datos = JSON.parse(localStorage.getItem('superm_tablas'));
    // Si no hay datos, o son los datos de ejemplo viejos (Planta A), forzamos 5 filas vacías
    if (!datos || (datos.length === 1 && datos[0][0] === "Planta A")) {
        datos = Array.from({ length: 5 }, () => ["", "", "", "", "", "", "", ""]);
    }
    datos.forEach(d => nuevaFila(d));
}

export function borrarTablas() { 
    if(confirm("¿Resetear laboratorio?")) { 
        localStorage.removeItem('superm_tablas'); 
        window.cargarTablasPersistentes(); 
    } 
}

export function descargarImagen() {
    const area = document.getElementById('area-descarga');
    if(!area) return;
    html2canvas(area, { backgroundColor: '#050505' }).then(canvas => {
        const link = document.createElement('a'); link.download = 'SuperM_Lab_Report.png';
        link.href = canvas.toDataURL(); link.click();
    });
}

/** --- LÓGICA DE RECETARIOS (MÓDULO COMPLETO) --- **/

// --- LÓGICA DEL DETECTOR HÍBRIDO (ORÁCULO v2) ---

export function cargarBibliotecaOraculo() {
    const grilla = document.getElementById('grilla-sintomas-oraculo');
    if (!grilla) return;

    // Ocultar botón de siembra si no es admin
    const btnSiembra = document.getElementById('btn-siembra-oraculo') || document.querySelector('.btn-siembra');
    if (btnSiembra) {
        const user = auth.currentUser;
        btnSiembra.style.display = (user && user.uid === ADMIN_UID) ? 'block' : 'none';
    }

    grilla.innerHTML = `<p style="grid-column: 1/-1; text-align:center; color:var(--s); font-size:0.8rem; font-family:monospace;">📡 Sincronizando Frecuencias de ADN...</p>`;
    
    const q = query(collection(db, "biblioteca_visual"), orderBy("timestamp", "desc"), limit(50));
    
    // Usamos onSnapshot para que las imágenes aparezcan apenas se guarden en Firebase
    onSnapshot(q, (snapshot) => {
        window.bibliotecaVisual = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderizarGaleriaOraculo(window.bibliotecaVisual);
    }, (error) => {
        console.error("Error Oráculo:", error);
        grilla.innerHTML = `<p style='grid-column: 1/-1; text-align:center; color:red;'>Error de frecuencia astral.</p>`;
    });
}

export function renderizarGaleriaOraculo(items = []) {
    const grilla = document.getElementById('grilla-sintomas-oraculo');
    if (!grilla) return;
    grilla.innerHTML = "";
    
    if (items.length === 0) {
        grilla.innerHTML = "<p style='grid-column: 1/-1; text-align:center; color:#555;'>No hay coincidencias.</p>";
        return;
    }

    items.forEach(item => {
        const celda = document.createElement('div');
        celda.className = 'celda-sintoma';
        celda.style.border = "1px solid #222"; // Asegura aislamiento visual
        celda.onclick = () => window.consultarMuestraOraculo(item.id, celda);
        // Mostrar la última imagen (la más reciente de Google) o el favicon de respaldo
        const mainImg = (item.imageUrls && item.imageUrls.length > 0) ? item.imageUrls[item.imageUrls.length - 1] : ORACULO_IMG_FALLBACK;
        celda.innerHTML = `
            <img src="${mainImg}" alt="${item.titulo}" style="width:100%; height:80px; object-fit:cover; border-radius:4px; display:block; filter: grayscale(0);" onerror='window.handleImageErrorOraculo(this)' loading="lazy">
            <p>${item.titulo}</p>`;
        grilla.appendChild(celda);
    });
}

window.handleImageErrorOraculo = (img) => {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = `width: 100%; height: 80px; background: #080808; border: 1px solid var(--s); display: flex; align-items: center; justify-content: center; color: var(--p); font-size: 0.4rem; text-align: center;`;
    placeholder.innerHTML = "[ ADN BLOQUEADO ]<br>CONSULTA AL ORÁCULO";
    img.parentElement.replaceChild(placeholder, img);
};

export function filtrarPorADN() {
    const busqueda = document.getElementById('search-tags-oraculo').value.toLowerCase().trim();
    const terminos = busqueda.split(/\s+/);
    const filtrados = window.bibliotecaVisual.filter(item => {
        const combined = [item.titulo, ...(item.tags || [])].join(' ').toLowerCase();
        return terminos.every(term => combined.includes(term));
    });
    renderizarGaleriaOraculo(filtrados);
}

export async function consultarMuestraOraculo(idDoc, elemento = null) {
    document.querySelectorAll('.celda-sintoma').forEach(el => el.classList.remove('seleccionada'));
    if (elemento) elemento.classList.add('seleccionada');

    const visualData = window.bibliotecaVisual.find(item => item.id === idDoc);
    if (!visualData) return;

    // Si el documento ya tiene el diagnóstico vinculado, lo usamos
    const panelRes = document.getElementById('panel-resultados-oraculo');
    if (panelRes) panelRes.scrollIntoView({ behavior: 'smooth', block: 'start' });

    window.mostrarLoader();
    const panel = document.getElementById('panel-resultados-oraculo');
    const contenido = document.getElementById('contenido-resultado-oraculo');
    panel.style.display = 'block';
    contenido.innerHTML = `<p style="text-align:center; color:var(--s); font-style:italic;">Invocando sabiduría del Oráculo...</p>`;

    try {
        let diagId = visualData.id_diagnostico || (visualData.tags?.[0]);
        let diagData = null;
        if (diagId) {
            const diagSnap = await getDoc(doc(db, "diagnosticos", diagId));
            if (diagSnap.exists()) diagData = diagSnap.data();
        }
        await window.ejecutarAgenteConsultor(visualData, diagData);
    } catch (e) { console.error(e); }
    finally { window.ocultarLoader(); }
}

export async function ejecutarAgenteConsultor(item, diagExistente) {
    const contenido = document.getElementById('contenido-resultado-oraculo');
    const initialImg = (item.imageUrls?.[0]) || item.img || ORACULO_IMG_FALLBACK;
    
    contenido.innerHTML = `
        <div class="split-diagnostico">
            <div class="col-visual">
                <img src="${initialImg}" class="img-expandida-oraculo" id="diag-img-principal-oraculo">
                <p style="font-size:0.5rem; color:#555; margin-top:10px; text-align:center;">MUESTRA: ${item.id}</p>
            </div>
            <div class="info-tecnica-oraculo">
                <h3 style="color: var(--p); margin:0; font-size:1rem;">🔮 ${item.titulo.toUpperCase()}</h3>
                <div style="background:rgba(57, 255, 20, 0.03); padding:12px; border-radius:8px; border-left: 3px solid var(--p); margin:15px 0;">
                    <p id="ai-solucion-text-oraculo" style="font-size:0.85rem; color:#ccc; line-height:1.4; margin:0;">Sincronizando dimensiones...</p>
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:0.7rem; margin-bottom:15px;">
                    <div><p style="color:var(--s); font-weight:bold; margin:0;">pH TARGET</p><p id="ai-ph-val-oraculo">--</p></div>
                    <div><p style="color:var(--s); font-weight:bold; margin:0;">EC TARGET</p><p id="ai-ec-val-oraculo">--</p></div>
                </div>
                <div id="extra-info-oraculo" style="font-size: 0.65rem; border-top: 1px solid #222; padding-top: 10px;">
                    <p style="color:var(--p); font-weight:bold; margin-bottom:5px;">Ajustes de Ambiente:</p>
                    <p id="ai-ambiente-oraculo" style="color:#888; margin-bottom:10px;">--</p>
                    <p style="color:var(--s); font-weight:bold; margin-bottom:2px;">Fuente Técnica:</p>
                    <p id="ai-fuente-oraculo" style="font-style:italic; color:#555;">--</p>
                </div>
            </div>
        </div>`;

    try {
        let hallazgo;
        if (diagExistente) {
            hallazgo = { ...diagExistente };
        } else {
            hallazgo = await Agente.servicios.firebaseFunctions.callCloudFunction('consultarOraculo', { titulo: item.titulo, tags: item.tags || [] });
            if (!hallazgo) throw new Error("El Oráculo no devolvió datos válidos.");
            
            if (auth.currentUser) {
                let diagId = item.id_diagnostico || (item.tags?.[0]) || item.id;
                await setDoc(doc(db, "diagnosticos", diagId), { ...hallazgo, timestamp: serverTimestamp() });
            }
        }
        
        // Verificación de existencia antes de asignar (Evita errores si el usuario cambió de pestaña)
        const imgPrincipal = document.getElementById('diag-img-principal-oraculo');
        if(imgPrincipal) imgPrincipal.src = hallazgo.url_imagen || initialImg;
        
        document.getElementById('ai-solucion-text-oraculo').innerText = hallazgo.solucion_alquimista;
        document.getElementById('ai-ph-val-oraculo').innerText = hallazgo.ph_rango || "N/A";
        document.getElementById('ai-ec-val-oraculo').innerText = hallazgo.ec_rango || "N/A";
        document.getElementById('ai-ambiente-oraculo').innerText = hallazgo.ambiente_detalles || "Ajustar según VPD";
        document.getElementById('ai-fuente-oraculo').innerText = hallazgo.fuente || "GrowWeedEasy / RQS Library";
        window.notify("🔮 El Oráculo ha respondido.", "success");
    } catch (e) {
        console.error("Error en el Oráculo:", e);
        document.getElementById('ai-solucion-text-oraculo').innerHTML = `<span style="color:red;">Fallo en la conexión astral: ${e.message}</span>`;
    }
}

export function resetOraculo() {
    document.getElementById('panel-resultados-oraculo').style.display = 'none';
    document.getElementById('search-tags-oraculo').value = "";
    renderizarGaleriaOraculo(window.bibliotecaVisual);
}

export function procesarImagenUsuario(event) {
    const file = event.target.files[0];
    if (!file) return;
    window.mostrarLoader();
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64Image = e.target.result;
        const panel = document.getElementById('panel-resultados-oraculo');
        const contenido = document.getElementById('contenido-resultado-oraculo');
        
        panel.style.display = 'block';
        contenido.innerHTML = `
            <div style="text-align:center; padding:20px;">
                <p style="color:var(--p); font-weight:bold; letter-spacing:2px;">🔮 EL ORÁCULO ESTÁ OBSERVANDO...</p>
                <img src="${base64Image}" style="width:120px; border-radius:10px; border:2px solid var(--s); box-shadow: 0 0 20px var(--s);">
            </div>`;

        // Llamada REAL al Agente
        Agente.servicios.visionAI.analizarCarencia(base64Image).then(resultado => {
            contenido.innerHTML = `
                <div class="lab-data-box" style="border-color:var(--p);">
                    <h4 style="color:var(--p);">DIAGNÓSTICO IA: ${resultado.diagnostico}</h4>
                    <p style="font-size:0.8rem; color:#ccc;">${resultado.accion}</p>
                    <small style="color:var(--s);">Confianza del análisis: ${resultado.seguridad}</small>
                </div>
                <button class="btn-reset-oraculo" onclick="window.resetOraculo()">NUEVA CONSULTA</button>`;
        }).catch(err => {
            contenido.innerHTML = `<p style="color:red; text-align:center;">Error en la conexión astral: ${err.message}</p>`;
        }).finally(() => {
            window.ocultarLoader();
        });
    };
    reader.readAsDataURL(file);
}

export async function sembrarBiblioteca() {
    // Usamos notify directamente ya que está en el mismo ámbito del módulo
    if (auth.currentUser?.uid !== ADMIN_UID) return notify("Acceso denegado.", "error");
    if (!confirm("¿Iniciar siembra de muestras? Se consultará al Oráculo y Google para poblar la biblioteca.")) return;

    notify("🌱 Iniciando siembra tecnológica...", "info");
    window.mostrarLoader();

    const muestrasBase = [
        { id: "nitrogeno_carencia", titulo: "Carencia de Nitrógeno", tags: ["nitrógeno", "amarilleo", "hojas"] },
        { id: "calcio_carencia", titulo: "Carencia de Calcio", tags: ["calcio", "puntos marrones", "necrosis"] },
        { id: "araña_roja", titulo: "Araña Roja", tags: ["plaga", "puntos", "telaraña"] },
        { id: "moho_blanco", titulo: "Oídio / Moho Blanco", tags: ["hongo", "polvo blanco", "humedad"] },
        { id: "fosforo_carencia", titulo: "Carencia de Fósforo", tags: ["fósforo", "morado"] },
        { id: "potasio_carencia", titulo: "Carencia de Potasio", tags: ["potasio", "quemado"] }
    ];

    try {
        for (const m of muestrasBase) {
            // 1. Consultar al Oráculo (IA + Google)
            const hallazgo = await Agente.servicios.firebaseFunctions.callCloudFunction('consultarOraculo', { titulo: m.titulo, tags: m.tags });

            if (hallazgo && hallazgo.url_imagen) {
                // 2. Guardar el Diagnóstico Técnico (Sabiduría)
                await setDoc(doc(db, "diagnosticos", m.id), {
                    ...hallazgo,
                    titulo: m.titulo,
                    timestamp: serverTimestamp()
                });

                // 3. Guardar/Actualizar la Muestra Visual (La que se ve en la grilla)
                const docRef = doc(db, "biblioteca_visual", m.id);
                await setDoc(docRef, {
                    id: m.id,
                    titulo: m.titulo,
                    tags: m.tags,
                    imageUrls: [hallazgo.url_imagen],
                    id_diagnostico: m.id, // Enlace al diagnóstico
                    timestamp: serverTimestamp()
                }, { merge: true });
                
                notify(`✅ "${m.titulo}" sincronizada.`, "success");
            }
        }
        notify("🌱 Biblioteca de ADN actualizada.", "success");
    } catch (err) {
        console.error("Error sembrando:", err);
        notify("❌ Error en la siembra.", "error");
    } finally {
        window.ocultarLoader();
    }
}

// --- PUENTE GLOBAL ---
// Exponemos las funciones al objeto window para mantener compatibilidad con los onclick del HTML
window.verSubSeccionLab = verSubSeccionLab;
window.actualizarVPD = actualizarVPD;
window.changeQtyValue = changeQtyValue;
window.verCalc = verCalc;
window.calcLuz = calcLuz;
window.drawVPDGraph = drawVPDGraph;
window.analizarVPD = analizarVPD;
window.toggleUnidadEC = toggleUnidadEC;
window.ajustarValorManual = ajustarValorManual;
window.generarDiagnostico = generarDiagnostico;
window.prepararGuardadoCalculo = prepararGuardadoCalculo;
window.updateMezclaVolume = updateMezclaVolume;
window.setMezclaLitros = setMezclaLitros;
window.setSustratoLitros = setSustratoLitros;
window.updateSustratoVolume = updateSustratoVolume;
window.agregarAMezclaActual = agregarAMezclaActual;
window.eliminarDeMezcla = eliminarDeMezcla;
window.renderMezclaActual = renderMezclaActual;
window.calcSustratoReceta = calcSustratoReceta;
window.setFaseLuz = setFaseLuz;
window.addComponenteConsumo = addComponenteConsumo;
window.fijarEscenarioA = fijarEscenarioA;
window.reiniciarComparativa = reiniciarComparativa;
window.volverAlMenuCalc = volverAlMenuCalc;
window.actualizarNutrientes = generarDiagnostico;
window.nuevaFila = nuevaFila;
window.guardarTablas = guardarTablas;
window.borrarTablas = borrarTablas;
window.descargarImagen = descargarImagen;
window.comprimirImagen = comprimirImagen;
window.renderAcumulado = renderAcumulado;
window.verImagenAmpliada = verImagenAmpliada;
window.navVisor = navVisor;
window.toggleZoom = toggleZoom;
window.verNotasCompletas = verNotasCompletas;
window.cargarTablasPersistentes = cargarTablasPersistentes;
window.renderGalería = renderGalería;
window.cargarBibliotecaOraculo = cargarBibliotecaOraculo;
window.renderizarGaleriaOraculo = renderizarGaleriaOraculo;
window.filtrarPorADN = filtrarPorADN;
window.consultarMuestraOraculo = consultarMuestraOraculo;
window.ejecutarAgenteConsultor = ejecutarAgenteConsultor;
window.resetOraculo = resetOraculo;
window.procesarImagenUsuario = procesarImagenUsuario;
window.sembrarBiblioteca = sembrarBiblioteca;
window.notify = notify;

// Carga inicial
document.addEventListener('DOMContentLoaded', () => { 
    window.cargarBibliotecaOraculo(); 
    
    // Setup de panning para el visor
    const img = document.getElementById('imagen-ampliada');
    if (img) {
        const startDrag = (e) => {
            if (!img.classList.contains('zoomed')) return;
            isPanning = true;
            wasDragged = false;
            img.style.cursor = 'grabbing';
            const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
            const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
            panStart = { x: clientX - panOffset.x, y: clientY - panOffset.y };
        };
        const doDrag = (e) => {
            if (!isPanning) return;
            e.preventDefault();
            const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
            const clientY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
            const newX = clientX - panStart.x;
            const newY = clientY - panStart.y;
            if (Math.abs(newX - panOffset.x) > 5 || Math.abs(newY - panOffset.y) > 5) wasDragged = true;
            panOffset.x = newX;
            panOffset.y = newY;
            img.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(2)`;
        };
        const endDrag = () => {
            isPanning = false;
            if (img.classList.contains('zoomed')) img.style.cursor = 'grab';
            setTimeout(() => { wasDragged = false; }, 200); // Reset para permitir clicks normales
        };
        img.addEventListener('mousedown', startDrag);
        img.addEventListener('touchstart', startDrag);
        window.addEventListener('mousemove', doDrag);
        window.addEventListener('touchmove', doDrag, { passive: false });
        window.addEventListener('mouseup', endDrag);
        window.addEventListener('touchend', endDrag);
    }
});