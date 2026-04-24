import { app, db, auth, MI_NUMERO, ADMIN_UID } from './firebase-config.js';
import { 
    notify, 
    renderAcumulado,
    renderGalería, 
    verImagenAmpliada, 
    verNotasCompletas 
} from './herramientaslab.js';
import { 
    collection, 
    query, 
    where, 
    orderBy, 
    onSnapshot, 
    addDoc, 
    serverTimestamp,
    doc,
    getDoc,
    updateDoc,
    increment,
    arrayUnion,
    arrayRemove,
    getDocs,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { crearNotificacion } from './comunidad.js';

const URL_SHEET_PRODUCTOS = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQz-fNndUCID7stvplq5hmb2gLdSLs68uks2dfAr3DJK1Ft9LUtF0tYRyET3HEHotB-eKAqxishKe_A/pub?gid=0&single=true&output=tsv"; // Hoja 1: inventario (TSV)

// --- SISTEMA DE ACUMULACIÓN DE IMÁGENES ---
let carrito = JSON.parse(localStorage.getItem('superm_cart')) || [];
let contextoEnvio = null;
window.productos = [];
window.imgsReseña = [];
window.currentProductImageIndex = 0;
window.currentProductImages = [];

let reviewsUnsubscribe = null;

// --- CONFIGURACIÓN DE CATEGORÍAS ---
const categorias = [
    { id: 'cat-carpas', n: 'Carpas', i: '⛺' },
    { id: 'cat-iluminacion', n: 'Iluminación', i: '💡' },
    { id: 'cat-nutricion', n: 'Nutrientes', i: '🧪' },
    { id: 'cat-sustratos', n: 'Sustratos', i: '📦' },
    { id: 'cat-control', n: 'Clima y Control', i: '🌡️' },
    { id: 'cat-hidro', n: 'Hidroponía', i: '🌊' },
    { id: 'cat-semillas', n: 'Semillas', i: '🌱' }
];

/** --- LÓGICA DE CARGA DE INVENTARIO (SHEETS) --- **/

export async function cargarInventario() {
    window.productos = [];
    // 1. Cargar desde Google Sheets
    try {
        const response = await fetch(URL_SHEET_PRODUCTOS);
        const text = await response.text();
        
        if (text.trim().startsWith("<") || text.includes("<!DOCTYPE html>")) {
            throw new Error("Google Sheets no entregó datos (HTML detectado).");
        }
        const dataClean = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
        const rows = dataClean.split(/\n(?=(?:[^"]*"[^"]*")*[^"]*$)/).slice(1);
        const sheetProds = rows.filter(r => r.trim() !== "").map((row, index) => {
            const c = row.split(/\t(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v ? v.trim().replace(/^"|"$/g, '').replace(/""/g, '"') : "");
            return {
                id: c[0] || index.toString(),
                category_id: c[1] || 'General', 
                title: c[2] || 'Producto sin título',  
                price: parseInt((c[3] || "0").replace(/[^0-9]/g, '')) || 0,
                pictures: (c[4] || "").split('|').filter(u => u.trim() !== "") || ['🌿'], 
                description_short: c[5] || '', 
                attributes: (c[6] || "").split('|').filter(a => a.trim() !== ""),
                permalink: c[7] || '',
                description: c[8] || ''
            };
        });
        window.productos = [...sheetProds];
    } catch (e) { console.error("Error cargando inventario desde Sheets:", e); }

    // 2. Cargar y Sincronizar desde Firebase (Independiente del Sheet)
    try {
        const querySnapshot = await getDocs(collection(db, 'productos_tienda'));
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (!window.productos.find(p => String(p.id) === String(doc.id))) {
                window.productos.push({
                    id: String(doc.id),
                    category_id: data.category_id || data.cat || 'General',
                    title: data.title || data.n || 'Producto sin nombre',
                    price: parseInt(String(data.price || data.p || 0).replace(/[^0-9]/g, '')),
                    pictures: Array.isArray(data.pictures || data.i) ? (data.pictures || data.i) : [data.thumbnail || data.i || '🌿'],
                    description_short: data.description_short || data.desc || '',
                    attributes: data.attributes || data.specs || [],
                    permalink: data.permalink || '',
                    description: data.description || data.fichaTecnica || data.texto || ''
                });
            }
        });
    } catch (err) { console.warn("Firebase Sync Error:", err); }

    console.log("Inventario cargado:", window.productos.length, "productos.");
    if (window.location.hash.includes('tienda')) mostrarCategorias();
}

export function mostrarCategorias() {
    const grid = document.getElementById('grid-p');
    const detalle = document.getElementById('detalle-p');
    const titulo = document.getElementById('titulo-tienda');
    const aviso = document.getElementById('aviso-laboratorio-tienda');

    if (!grid) return;
    detalle.style.display = 'none';
    grid.style.display = 'grid';
    titulo.innerText = "Categorías";
    if (aviso) aviso.style.display = 'block';

    grid.innerHTML = categorias.map(c => {
        // Filtrado flexible: acepta ID técnico o Nombre descriptivo
        const total = (window.productos || []).filter(p => {
            const pCat = String(p.category_id || "").toLowerCase().trim();
            return pCat === c.id.toLowerCase().trim() || pCat === c.n.toLowerCase().trim();
        }).length;

        return `
        <div class="tarjeta" onclick="window.filtrarProductos('${c.id}', '${c.n}')">
            <div class="contenedor-img" style="font-size:3.5rem;">${c.i}</div>
            <h3 style="text-align:center; margin-bottom: 5px;">${c.n}</h3>
            <div style="text-align:center; font-size:0.75rem; color:var(--p); font-weight:bold; opacity:0.8;">${total} Productos</div>
        </div>`;
    }).join('');
}

export function filtrarProductos(catId, nombre, guardar = true) {
    if (guardar) history.pushState({ section: 'tienda', sub: 'category', catId, nombre }, '', `#tienda/${catId}`);
    document.getElementById('titulo-tienda').innerText = nombre;
    document.getElementById('detalle-p').style.display = 'none';
    document.getElementById('grid-p').style.display = 'grid';
    const aviso = document.getElementById('aviso-laboratorio-tienda');
    if (aviso) aviso.style.display = 'none';

    const fil = window.productos.filter(p => {
        const pCatId = String(p.category_id || "").toLowerCase().trim();
        return pCatId === catId.toLowerCase().trim() || pCatId === nombre.toLowerCase().trim();
    });
    renderGrid(fil);
}

function renderGrid(lista) {
    const grid = document.getElementById('grid-p');
    if (!lista || lista.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px; color: #555;">
                <p>No se encontraron productos en esta categoría.</p>
            </div>`;
        return;
    }
    grid.innerHTML = lista.map(p => `
        <div class="tarjeta" onclick="window.verProducto('${p.id}')">
            <div class="contenedor-img">${obtenerImagenHTML(p.pictures)}</div>
            <div class="tarjeta-body">
                <h3 style="margin: 0 0 10px 0; font-size: 0.9rem; color: #ccc; font-weight: 400; line-height: 1.2;">${p.title}</h3>
                <div id="stars-grid-${p.id}" style="font-size:0.7rem; margin-bottom:8px;"></div>
                <div style="color: var(--p); font-size: 1.4rem; font-weight: 600; margin-top: auto;">$${p.price.toLocaleString()}</div>
                ${p.description ? `<button class="btn btn-m" style="font-size: 0.6rem; padding: 5px; margin-top: 10px; border-color:var(--s); color:var(--s); width:100%;" onclick="event.stopPropagation(); window.verNotasCompletas(decodeURIComponent('${encodeURIComponent(p.description)}'), '📖 FICHA TÉCNICA')">VER FICHA TÉCNICA</button>` : ''}
            </div>
        </div>`).join('');
    
    lista.forEach(p => window.cargarRatingPromedio(p.id, `stars-grid-${p.id}`));
}

function obtenerImagenHTML(dato) {
    // dato puede ser un array ahora
    const img = Array.isArray(dato) ? dato[0] : dato;
    if (img && (img.includes("http") || img.startsWith("data:image"))) {
        return `<img src="${img}" class="img-real" onerror="this.style.opacity='0.5';">`;
    }
    return `<div class="img-placeholder">${img || "🌿"}</div>`;
}

export function comprarDirecto(id) {
    const p = window.productos.find(x => x.id === id);
    if (!p) return;
    if (p.permalink) {
        window.open(p.permalink, '_blank');
    } else {
        const msgWA = encodeURIComponent(`¡Hola! Me interesa adquirir este producto: ${p.title}`);
        window.open(`https://wa.me/${MI_NUMERO}?text=${msgWA}`, '_blank');
    }
}

export function addToCart(id) {
    const p = window.productos.find(x => x.id === id);
    if (!p) return;
    
    // Accedemos al carrito global
    let carrito = JSON.parse(localStorage.getItem('superm_cart')) || [];
    const ex = carrito.find(i => i.id === id);
    
    if(!ex) {
        // Guardamos el permalink para que el carrito sepa a dónde redirigir
        carrito.push({id: p.id, title: p.title, price: p.price, link: p.permalink});
        localStorage.setItem('superm_cart', JSON.stringify(carrito));
        updateCartUI();
        notify(`🧪 Añadido ${p.title} a tu selección`, 'success');
    } else {
        notify(`ℹ️ El producto ya está en tu lista.`, 'info');
    }
}

// --- SISTEMA DE GALERÍA DE PRODUCTOS (Nivel Superior para evitar ReferenceError) ---

export function renderProductGallery(imageUrls) {
    if (!imageUrls || imageUrls.length === 0) {
        return `<div class="contenedor-img" style="height:350px"><div class="img-placeholder">🌿</div></div>`;
    }

    // Filtra los elementos que son URLs de imagen para las miniaturas
    const actualImageUrls = imageUrls.filter(url => url && typeof url === 'string' && url.includes("http"));
    
    window.currentProductImages = actualImageUrls;

    // El primer elemento puede ser una URL o un ícono
    const mainDisplayItem = imageUrls[0]; 

    let mainImageHtml;
    if (mainDisplayItem && typeof mainDisplayItem === 'string' && mainDisplayItem.includes("http")) {
        mainImageHtml = `<img id="main-product-image" src="${mainDisplayItem}" class="img-real" 
                             onclick="window.verImagenAmpliada(this.src, window.currentProductImages)" 
                             alt="Imagen principal del producto">`;
    } else {
        mainImageHtml = `<div class="img-placeholder" id="main-product-image">${mainDisplayItem || "🌿"}</div>`;
    }

    let thumbnailsHtml = '';
    if (actualImageUrls.length > 1) { // Solo muestra miniaturas si hay más de una imagen real
        thumbnailsHtml = `
            <div style="display:flex; gap:10px; margin-top:15px; overflow-x:auto; padding-bottom:10px;">
                ${actualImageUrls.map((url, index) => `
                    <img src="${url}" 
                         class="product-thumbnail" 
                         data-full-src="${url}"
                         onclick="window.changeMainProductImage('${url}')"
                         alt="Miniatura ${index + 1}">
                `).join('')}
            </div>
        `;
    }

    return `
        <div class="contenedor-img" style="height:350px; margin-bottom:0; position:relative;">
            ${mainImageHtml}
            ${actualImageUrls.length > 1 ? `
                <button onclick="window.navGallery(-1)" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); background:rgba(0,0,0,0.4); color:var(--p); border:none; border-radius:50%; width:35px; height:35px; cursor:pointer; font-size:20px; z-index:5; display:flex; align-items:center; justify-content:center;">❮</button>
                <button onclick="window.navGallery(1)" style="position:absolute; right:10px; top:50%; transform:translateY(-50%); background:rgba(0,0,0,0.4); color:var(--p); border:none; border-radius:50%; width:35px; height:35px; cursor:pointer; font-size:20px; z-index:5; display:flex; align-items:center; justify-content:center;">❯</button>
            ` : ''}
        </div>
        ${thumbnailsHtml}
    `;
}

export function changeMainProductImage(newSrc) {
    const mainImgElement = document.getElementById('main-product-image');
    if (mainImgElement) {
        if (mainImgElement.tagName === 'IMG') { 
            mainImgElement.src = newSrc; 
        } else { 
            const newImg = document.createElement('img'); 
            newImg.id = 'main-product-image'; 
            newImg.src = newSrc; 
            newImg.className = 'img-real'; 
            newImg.onclick = () => window.verImagenAmpliada(newSrc); 
            mainImgElement.parentNode.replaceChild(newImg, mainImgElement); 
        }
    }
    if (window.currentProductImages) {
        const idx = window.currentProductImages.indexOf(newSrc);
        if (idx !== -1) window.currentProductImageIndex = idx;
    }
}

export function navGallery(dir) {
    if (!window.currentProductImages || window.currentProductImages.length <= 1) return;
    window.currentProductImageIndex = (window.currentProductImageIndex + dir + window.currentProductImages.length) % window.currentProductImages.length;
    window.changeMainProductImage(window.currentProductImages[window.currentProductImageIndex]);
}

export function verProducto(id, guardar = true) {
    const p = window.productos.find(x => x.id === id);
    if (!p) return window.notify("❌ No se encontró el producto.", 'error');
    if (guardar) history.pushState({ section: 'tienda', sub: 'product', id }, '', `#tienda/producto/${id}`);
    
    document.getElementById('grid-p').style.display = 'none';
    document.getElementById('detalle-p').style.display = 'block';
    const aviso = document.getElementById('aviso-laboratorio-tienda');
    if(aviso) aviso.style.display = 'none';

    // Inicializar navegación de imágenes del producto
    window.currentProductImageIndex = 0;
    window.currentProductImages = [];

    const btnMP = `<button class="btn btn-mp" style="width:100%; margin-top:10px" onclick="window.comprarDirecto('${p.id}')">VER EN MERCADO LIBRE 🔗</button>`;
    const btnFicha = (p.description) ? `<button class="btn btn-m" style="width:100%; margin-top:10px; border-color:var(--s); color:var(--s);" onclick="event.stopPropagation(); verNotasCompletas(decodeURIComponent('${encodeURIComponent(p.description)}'), '📖 FICHA TÉCNICA')">📄 FICHA TÉCNICA</button>` : '';
    
    document.getElementById('detalle-p').innerHTML = `
        <div class="producto-detalle">
            <div class="det-media-col"> 
                ${window.renderProductGallery(p.pictures)}
                <div id="avg-rating-display" style="margin-top: 20px;"></div>
                
                <!-- El selector de estrellas ahora vive bajo el resumen de calificación -->
                <div id="user-rating-input" style="display: none; align-items: center; justify-content: space-between; background: rgba(188, 19, 254, 0.05); padding: 12px; border-radius: 10px; border: 1px dashed var(--s); margin-top: 10px;">
                    <span style="font-size: 0.7rem; color: var(--s); font-weight: bold; letter-spacing: 1px;">TU CALIFICACIÓN:</span>
                    <div id="star-selector" style="font-size: 1.5rem; cursor: pointer; display: flex; gap: 5px;">
                        <span class="star-btn" data-val="1">☆</span>
                        <span class="star-btn" data-val="2">☆</span>
                        <span class="star-btn" data-val="3">☆</span>
                        <span class="star-btn" data-val="4">☆</span>
                        <span class="star-btn" data-val="5">☆</span>
                    </div>
                </div>
            </div>

            <div class="det-info">
                <h2 style="margin-top: 0;">${p.title}</h2>
                <p>${p.description_short}</p>
                <div class="det-ficha">
                    <strong>ESPECIFICACIONES:</strong>
                    <ul style="color:var(--p);">
                        ${Array.isArray(p.attributes) ? p.attributes.map(s => `<li>${s}</li>`).join('') : `<li>${p.attributes || 'Calidad Super M'}</li>`}
                    </ul>
                </div>
                <div class="det-precio">$${p.price.toLocaleString()}</div>
                
                <div style="display:flex; gap:15px; flex-direction:column; margin-top:10px;">
                    <button class="btn btn-v" style="width:100%; height:45px;" onclick="window.addToCart('${p.id}')">Añadir a mi selección</button>

                    ${btnMP} 
                    ${btnFicha}
                    <span class="aviso-logistica-txt" style="text-align:center; display:block;">⚠️ Logística: Envío a convenir</span>
                </div>
            </div>
        </div>
        
        <div id="seccion-reseñas-producto" style="margin-top: 50px; border-top: 1px solid #333; padding-top: 30px;">
            <h3 style="color: var(--p); letter-spacing: 2px;">🛡️ RESEÑAS DE ALQUIMISTAS</h3>
            
            <div id="form-review-producto-container">
                <!-- Se llena dinámicamente según login -->
            </div>

            <div id="lista-reseñas-producto" style="display: flex; flex-direction: column; gap: 20px; margin-top: 30px;">
                <p style="text-align: center; color: #555;">Consultando registros del producto...</p>
            </div>
        </div>`;

    // Inicializar sistema de comentarios para este producto
    if (window.initReseñasProducto) {
        window.initReseñasProducto(p.id);
    }
}

// --- SISTEMA DE CARRITO Y PEDIDOS ---

export function updateCartUI() {
    const carrito = JSON.parse(localStorage.getItem('superm_cart')) || [];
    const totalItems = carrito.length; // Ahora contamos items únicos, no cantidades
    const cartCount = document.getElementById('cart-count');
    if (cartCount) {
        cartCount.innerText = totalItems;
        // Disparar animación de feedback
        cartCount.classList.remove('cart-bump');
        void cartCount.offsetWidth; // Forzar reflow para reiniciar animación
        cartCount.classList.add('cart-bump');
    }
}

export function renderCarrito() {
    const lista = document.getElementById('lista-carrito');
    const totalTxt = document.getElementById('total-carrito');
    const carrito = JSON.parse(localStorage.getItem('superm_cart')) || [];

    if (!lista) return;

    if (carrito.length === 0) {
        lista.innerHTML = `<p style="text-align:center; color:#555; padding: 20px;">Tu laboratorio de compras está vacío.</p>`;
        return;
    }

    lista.innerHTML = carrito.map(item => {
        return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid #222; padding-bottom:10px;">
            <div style="flex:1;">
                <div style="font-weight:bold; color:var(--p); font-size:0.9rem; margin-bottom:5px;">${item.title}</div>
                <a href="${item.link}" target="_blank" style="color:var(--s); font-size:0.7rem; text-decoration:none; border:1px solid var(--s); padding:2px 8px; border-radius:4px;">VER EN MERCADO LIBRE 🔗</a>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
                <button onclick="window.quitar('${item.id}')" style="background:none; border:none; color:#ff3131; cursor:pointer; font-size:1.2rem;">&times;</button>
            </div>
        </div>`;
    }).join('');
}

export function ajustarCarrito(id, d) {
    let carrito = JSON.parse(localStorage.getItem('superm_cart')) || [];
    const item = carrito.find(x => x.id === id);
    if (item) {
        item.q += d;
        if (item.q <= 0) return quitar(id);
        localStorage.setItem('superm_cart', JSON.stringify(carrito));
        renderCarrito();
        updateCartUI();
    }
}

export function inputCarrito(id, val) {
    let carrito = JSON.parse(localStorage.getItem('superm_cart')) || [];
    const item = carrito.find(x => x.id === id);
    if (item) {
        item.q = parseInt(val) || 1;
        if (item.q <= 0) item.q = 1;
        localStorage.setItem('superm_cart', JSON.stringify(carrito));
        renderCarrito();
        updateCartUI();
    }
}

export function quitar(id) {
    let carrito = JSON.parse(localStorage.getItem('superm_cart')) || [];
    carrito = carrito.filter(x => x.id !== id);
    localStorage.setItem('superm_cart', JSON.stringify(carrito));
    renderCarrito();
    updateCartUI();
    notify("Producto removido.", "info");
}

export function abrirEnlacesML() {
    const carrito = JSON.parse(localStorage.getItem('superm_cart')) || [];
    if (carrito.length === 0) return;

    notify("🚀 Abriendo enlaces en Mercado Libre...", "success");
    
    carrito.forEach((item, index) => {
        if (item.link) {
            // Usamos un pequeño delay para intentar engañar a los bloqueadores de popups
            setTimeout(() => {
                window.open(item.link, '_blank');
            }, index * 300);
        }
    });
}

export function vaciarCarrito() {
    localStorage.removeItem('superm_cart');
    updateCartUI();
    renderCarrito();
}

// --- SISTEMA DE RESEÑAS PARA PRODUCTOS ---

export function initReseñasProducto(productId) {
    window.userExistingReviewId = null;
    window.userExistingReviewText = "";
    window.selectedStars = 0;
    const user = auth.currentUser;
    const formContainer = document.getElementById('form-review-producto-container');
    
    if (!user) {
        formContainer.innerHTML = `
            <div style="text-align:center; padding: 20px; border: 1px dashed var(--s); border-radius: 12px;">
                <p style="color: #888; font-size: 0.85rem;">Para compartir tu experiencia con este producto, debes iniciar sesión.</p>
                <button class="btn btn-m" onclick="window.ver('view-login')">Ir al Acceso</button>
            </div>`;
    } else {
        const ratingInput = document.getElementById('user-rating-input');
        if (ratingInput) {
            ratingInput.style.display = 'flex';
            window.selectedStars = 0;
            document.querySelectorAll('#star-selector .star-btn').forEach(btn => {
                btn.onclick = (e) => {
                    window.selectedStars = parseInt(e.target.dataset.val);
                    document.querySelectorAll('#star-selector .star-btn').forEach((s, idx) => {
                        s.innerHTML = (idx < window.selectedStars) ? '★' : '☆';
                        s.style.color = (idx < window.selectedStars) ? '#ffd700' : '#444';
                    });
                    const btnEnviar = document.querySelector('#form-review-producto-container .btn-v');
                    if (btnEnviar) {
                        if (window.selectedStars > 0) {
                            btnEnviar.innerText = window.userExistingReviewId ? "ACTUALIZAR RESEÑA" : "PUBLICAR RESEÑA";
                        } else {
                            btnEnviar.innerText = "PUBLICAR MENSAJE";
                        }
                    }
                };
            });
        }

        formContainer.innerHTML = `
            <div class="comunidad-card" style="border-color: var(--p); background: rgba(0,0,0,0.2);">
                <h4 style="color: var(--p); margin-top: 0; font-size: 0.8rem;">ESCRIBIR RESEÑA</h4>
                <textarea id="nueva-reseña-txt" class="input-lab" rows="2" placeholder="Escribe un comentario técnico o tu reseña..." style="width: 100%; box-sizing: border-box; margin-bottom: 10px;"></textarea>
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <input type="file" id="nueva-reseña-img" class="input-lab" accept="image/*" multiple style="font-size: 0.7rem; background: transparent; border-color: #333; flex: 1;" onchange="window.previsualizarReseña()">
                    <button class="btn btn-v" style="padding: 8px 20px;" onclick="window.enviarReseñaProducto('${productId}')">Publicar</button>
                </div>
                <div id="preview-reseña-img" style="margin-top: 10px;"></div>
            </div>`;
    }
    cargarReseñasProducto(productId);
}

export async function previsualizarReseña() {
    const input = document.getElementById('nueva-reseña-img');
    const preview = document.getElementById('preview-reseña-img');
    if (!input || !preview) return;
    const files = Array.from(input.files);
    for (const file of files) {
        const data = await comprimirImagen(file);
        if(data) window.imgsReseña.push(data);
    }
    input.value = "";
    renderAcumulado(window.imgsReseña, 'preview-reseña-img', '--p');
}

export async function enviarReseñaProducto(productId) {
    const user = auth.currentUser;
    const text = document.getElementById('nueva-reseña-txt').value.trim();
    const imgInput = document.getElementById('nueva-reseña-img');
    const stars = window.selectedStars || 0;

    if (!text && stars === 0) return notify("✍️ Escribe un mensaje o selecciona estrellas.", 'info');
    const imageUrls = [...window.imgsReseña];

    try {
        if (stars > 0) {
            const reviewData = {
                rating: stars,
                fecha: new Date().toLocaleString(),
                timestamp: serverTimestamp(),
                tipo: 'reseña'
            };
            
            if (text) reviewData.texto = text;
            if (imageUrls && imageUrls.length > 0) reviewData.imageUrls = imageUrls;

            if (window.userExistingReviewId) {
                const existingReviewRef = doc(db, 'reseñas_productos', window.userExistingReviewId);
                const existingReviewSnap = await getDoc(existingReviewRef);
                const existingReviewData = existingReviewSnap.data();

                const oldText = existingReviewData.texto || "";
                const oldImageUrls = existingReviewData.imageUrls || (existingReviewData.imageUrl ? [existingReviewData.imageUrl] : []);
                const newTextFromForm = text;
                const newImageUrlsFromForm = imageUrls;

                if (newTextFromForm !== oldText || JSON.stringify(newImageUrlsFromForm) !== JSON.stringify(oldImageUrls)) {
                    await addDoc(collection(db, 'reseñas_productos'), {
                        texto: oldText,
                        rating: existingReviewData.rating || 0,
                        tipo: 'comentario',
                        productId: productId,
                        usuarioNombre: existingReviewData.usuarioNombre,
                        usuarioId: existingReviewData.usuarioId,
                        imageUrls: oldImageUrls,
                        fecha: existingReviewData.fecha,
                        timestamp: existingReviewData.timestamp,
                        upvotes: existingReviewData.upvotes || 0,
                        downvotes: existingReviewData.downvotes || 0,
                        votosUp: existingReviewData.votosUp || [],
                        votosDown: existingReviewData.votosDown || [],
                        respuestas: existingReviewData.respuestas || []
                    });
                }

                const updateFields = {
                    rating: stars,
                    fecha: new Date().toLocaleString(),
                    timestamp: serverTimestamp(),
                    tipo: 'reseña',
                    texto: newTextFromForm,
                    imageUrls: newImageUrlsFromForm
                };

                await updateDoc(doc(db, 'reseñas_productos', window.userExistingReviewId), updateFields);
                notify("✅ Reseña actualizada.", 'success');
            } else {
                await addDoc(collection(db, 'reseñas_productos'), {
                    ...reviewData,
                    texto: text || "Sin comentario",
                    productId: productId,
                    usuarioNombre: user.displayName || user.email.split('@')[0],
                    usuarioId: user.uid,
                    imageUrls: imageUrls || [],
                    upvotes: 0,
                    downvotes: 0,
                    votosUp: [],
                    votosDown: [],
                    respuestas: []
                });
                notify("✅ Reseña publicada.", 'success');
            }
            // Notificar al Admin de la nueva valoración
            crearNotificacion(ADMIN_UID, `⭐ Nueva reseña en ${productId} (${stars} estrellas)`, `tienda:${productId}`);
        } else {
            await addDoc(collection(db, 'reseñas_productos'), {
                texto: text,
                rating: 0,
                tipo: 'comentario',
                productId: productId,
                usuarioNombre: user.displayName || user.email.split('@')[0],
                usuarioId: user.uid,
                imageUrls: imageUrls || [],
                fecha: new Date().toLocaleString(),
                timestamp: serverTimestamp(),
                upvotes: 0,
                downvotes: 0,
                votosUp: [],
                votosDown: [],
                respuestas: []
            });
            notify("💬 Comentario enviado.", 'success');
            // Notificar al Admin del nuevo comentario técnico
            crearNotificacion(ADMIN_UID, `💬 Nuevo comentario técnico en ${productId}`, `tienda:${productId}`);
        }

        document.getElementById('nueva-reseña-txt').value = "";
        if(imgInput) imgInput.value = "";
        window.selectedStars = 0;
        window.imgsReseña = [];
        document.getElementById('preview-reseña-img').innerHTML = "";
        document.querySelectorAll('#star-selector .star-btn').forEach(s => {
            s.innerHTML = '☆'; s.style.color = '#444';
        });
    } catch (e) { console.error(e); notify("❌ Error al procesar reseña.", 'error'); }
}

export function cargarReseñasProducto(productId) {
    const lista = document.getElementById('lista-reseñas-producto');
    if (reviewsUnsubscribe) reviewsUnsubscribe();

    const q = query(collection(db, 'reseñas_productos'), where('productId', '==', productId), orderBy('timestamp', 'desc'));
    
    reviewsUnsubscribe = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            lista.innerHTML = '<p style="text-align:center; color:#444; font-size:0.8rem;">Aún no hay reseñas de este producto. ¡Sé el primero!</p>';
            return;
        }
        
        let totalStars = 0;
        let reviewCountForAvg = 0;
        let countPerStar = {5:0, 4:0, 3:0, 2:0, 1:0};
        let userReviewData = null;
        const currentUser = auth.currentUser;

        const reviewsHtmlArr = snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            const rating = data.rating || 0;
            const esReseña = data.tipo === 'reseña' || (!data.tipo && rating > 0);

            if (esReseña) {
                totalStars += rating;
                reviewCountForAvg++;
                if (countPerStar[rating] !== undefined) countPerStar[rating]++;
                if (currentUser && data.usuarioId === currentUser.uid) {
                    userReviewData = { id: docSnap.id, ...data };
                }
            }

            const docId = docSnap.id;
            const esAutor = currentUser && data.usuarioId === currentUser.uid;
            const votedUp = currentUser && data.votosUp?.includes(currentUser.uid);
            const votedDown = currentUser && data.votosDown?.includes(currentUser.uid);

            let starsHtml = esReseña 
                ? '<span style="color:#ffd700;">' + '★'.repeat(rating) + '</span><span style="color:#444;">' + '☆'.repeat(5 - rating) + '</span>'
                : '<span style="color:var(--p); font-size:0.65rem; letter-spacing:1px; font-weight:bold; border: 1px solid var(--p); padding: 2px 5px; border-radius: 4px; background: rgba(57, 255, 20, 0.05);">🟢 COMENTARIO TÉCNICO</span>';

            let respuestasHtml = "";
            if (data.respuestas && data.respuestas.length > 0) {
                respuestasHtml = `
                    <div class="respuesta-thread">
                        ${data.respuestas.map(r => { const rId = r.id || r.fecha;
                            const rVotedUp = currentUser && r.votosUp?.includes(currentUser.uid);
                            const rVotedDown = currentUser && r.votosDown?.includes(currentUser.uid);
                            return `
                            <div style="font-size: 0.75rem; margin-bottom: 12px; border-bottom: 1px solid #222; padding-bottom: 12px;">
                                <div style="margin-bottom: 8px;"><b style="color: var(--p);">${r.usuario}:</b> <span style="color: #ccc;">${r.texto}</span></div>
                                ${window.renderGalería(r.imageUrls || (r.imageUrl ? [r.imageUrl] : []))}
                                <div style="display: flex; gap: 8px; align-items: center;">
                                    <button onclick="votarRespuestaReview('${docId}', '${rId}', 'up')" 
                                        style="background: ${rVotedUp ? 'rgba(57, 255, 20, 0.15)' : 'transparent'}; border: 1px solid ${rVotedUp ? 'var(--p)' : '#333'}; color:${rVotedUp ? 'var(--p)' : '#666'}; cursor:pointer; border-radius:4px; font-size:0.6rem; padding: 2px 8px;">
                                        👍 ${r.upvotes || 0}</button>
                                    <button onclick="window.votarRespuestaReview('${docId}', '${rId}', 'down')" 
                                        style="background: ${rVotedDown ? 'rgba(255, 49, 49, 0.1)' : 'transparent'}; border: 1px solid ${rVotedDown ? '#ff3131' : '#333'}; color:${rVotedDown ? '#ff3131' : '#666'}; cursor:pointer; border-radius:4px; font-size:0.6rem; padding: 2px 8px;">
                                        👎 ${r.downvotes || 0}</button>
                                    <span style="color: #444; font-size: 0.55rem; margin-left: auto;">${r.fecha}</span>
                                </div>
                            </div>`;}).join('')}
                    </div>`;
            }

            return `
                <div id="review-${docId}" class="comunidad-card" style="margin-bottom: 0; background: rgba(255,255,255,0.02); border-left: 2px solid ${esReseña ? '#ffd700' : 'var(--p)'};">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            <div style="font-size: 0.75rem; color: var(--s); font-weight: bold;">${data.usuarioNombre.toUpperCase()}</div>
                            <div style="font-size: 0.8rem;">${starsHtml}</div>
                        </div>
                        <div style="font-size: 0.6rem; color: #555;">${data.fecha}</div>
                    </div>
                    <p style="font-size: 0.85rem; margin: 10px 0; font-family: 'Courier New', monospace;">${data.texto}</p>
                    ${renderGalería(data.imageUrls || (data.imageUrl ? [data.imageUrl] : []))}
                    
                    ${respuestasHtml}

                    <div style="display: flex; gap: 10px; margin-top: 15px; border-top: 1px solid #222; padding-top: 10px;">
                        <button onclick="votarReview('${docId}', 'up')" style="background:transparent; border:1px solid ${votedUp ? 'var(--p)' : '#333'}; color:${votedUp ? 'var(--p)' : '#888'}; cursor:pointer; border-radius:4px; font-size:0.7rem;">👍 ${data.upvotes || 0}</button>
                        <button onclick="votarReview('${docId}', 'down')" style="background:transparent; border:1px solid ${votedDown ? '#ff3131' : '#333'}; color:${votedDown ? '#ff3131' : '#888'}; cursor:pointer; border-radius:4px; font-size:0.7rem;">👎 ${data.downvotes || 0}</button>
                        <button onclick="responderReview('${docId}')" style="background:transparent; border:1px solid var(--s); color:var(--s); cursor:pointer; border-radius:4px; font-size:0.65rem; margin-left:auto;">REPLICAR</button>
                        ${esAutor ? `<button onclick="window.eliminarReview('${docId}', '${productId}')" style="background:transparent; border:none; color:#ff3131; cursor:pointer; font-size:0.8rem;">🗑️</button>` : ''}
                    </div>
                </div>`;
        });

        lista.innerHTML = reviewsHtmlArr.join('');

        const ratingInput = document.getElementById('user-rating-input');
        const btnEnviar = document.querySelector('#form-review-producto-container .btn-v');

        if (userReviewData) {
            window.userExistingReviewId = userReviewData.id;
            window.userExistingReviewText = userReviewData.texto;
            if (ratingInput) ratingInput.style.display = 'flex'; 
            
            if (btnEnviar) btnEnviar.innerText = "PUBLICAR MENSAJE";
        } else {
            window.userExistingReviewId = null;
            if (ratingInput) ratingInput.style.display = 'flex';
            if (btnEnviar) btnEnviar.innerText = "PUBLICAR";
        }

        const avg = reviewCountForAvg > 0 ? (totalStars / reviewCountForAvg).toFixed(1) : "0.0";
        const avgNum = parseFloat(avg);
        const avgContainer = document.getElementById('avg-rating-display');
        if (avgContainer) {
            avgContainer.innerHTML = `
                <div style="display: flex; align-items: center; gap: 20px; background: rgba(0,0,0,0.3); padding: 20px; border-radius: 15px; margin-bottom: 20px; border: 1px solid #222;">
                    <div style="text-align: center;">
                        <div style="font-size: 3rem; font-weight: bold; color: #fff;">${avg}</div>
                        <div style="color: #ffd700; font-size: 1rem;">${'★'.repeat(Math.round(avgNum))}${'☆'.repeat(5 - Math.round(avgNum))}</div>
                        <div style="font-size: 0.7rem; color: #666; margin-top: 5px;">${reviewCountForAvg} valoraciones</div>
                    </div>
                    <div style="flex: 1;">
                        ${[5,4,3,2,1].map(s => {
                            const percent = reviewCountForAvg > 0 ? (countPerStar[s] / reviewCountForAvg * 100) : 0;
                            return `
                                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                                    <span style="font-size: 0.7rem; color: #888; width: 10px;">${s}</span>
                                    <div style="flex: 1; height: 8px; background: #222; border-radius: 4px; overflow: hidden;">
                                        <div style="width: ${percent}%; height: 100%; background: var(--p);"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>`;
        }

    }, (error) => {
        console.error("Error reviews:", error);
        lista.innerHTML = `<p style="color:var(--s); font-size:0.7rem; text-align:center;">Falta configurar índice en Firebase para reseñas.</p>`;
    });
}

export async function votarReview(id, tipo) {
    const user = auth.currentUser;
    if (!user) return notify("🔒 Inicia sesión.", 'info');
    try {
        const docRef = doc(db, 'reseñas_productos', id);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return;
        const data = snap.data();
        const uid = user.uid;
        const vUp = data.votosUp || [];
        const vDown = data.votosDown || [];
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
                window.crearNotificacion(data.usuarioId, `${user.displayName || 'Alquimista'} indicó que tu comentario de un producto le sirve.`, `tienda:${data.productId}#review-${id}`);
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
                window.crearNotificacion(data.usuarioId, `${user.displayName || 'Alquimista'} indicó que tu comentario de un producto no le sirve.`, `tienda:${data.productId}#review-${id}`);
            }
        }
        await updateDoc(docRef, update);
    } catch (e) { console.error("Error al votar reseña:", e); }
}

export async function votarRespuestaReview(reviewId, replyId, tipo) {
    const user = auth.currentUser;
    if (!user) return notify("🔒 Inicia sesión.", 'info');
    const docRef = doc(db, 'reseñas_productos', reviewId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const resps = [...(data.respuestas || [])];
    const idx = resps.findIndex(r => (r.id === replyId) || (r.fecha === replyId));
    if (idx === -1) return;
    const r = resps[idx];
    r.votosUp = r.votosUp || []; r.votosDown = r.votosDown || []; r.upvotes = r.upvotes || 0; r.downvotes = r.downvotes || 0;
    const uid = user.uid;

    if (tipo === 'up') {
        if (r.votosUp.includes(uid)) { r.votosUp = r.votosUp.filter(i => i !== uid); r.upvotes--; }
        else { r.votosUp.push(uid); r.upvotes++; if (r.votosDown.includes(uid)) { r.votosDown = r.votosDown.filter(i => i !== uid); r.downvotes--; } }
        if (r.votosUp.includes(uid)) window.crearNotificacion(r.usuarioId, `${user.displayName || 'Alquimista'} indicó que tu respuesta le sirve.`, `tienda:${data.productId}#review-${reviewId}`);
    } else {
        if (r.votosDown.includes(uid)) { r.votosDown = r.votosDown.filter(i => i !== uid); r.downvotes--; }
        else { r.votosDown.push(uid); r.downvotes++; if (r.votosUp.includes(uid)) { r.votosUp = r.votosUp.filter(i => i !== uid); r.upvotes--; } }
        if (r.votosDown.includes(uid)) window.crearNotificacion(r.usuarioId, `${user.displayName || 'Alquimista'} indicó que tu respuesta no le sirve.`, `tienda:${data.productId}#review-${reviewId}`);
    }
    await updateDoc(docRef, { respuestas: resps });
}

export async function cargarRatingPromedio(productId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    try {
        const q = query(collection(db, 'reseñas_productos'), where('productId', '==', productId));
        const snap = await getDocs(q);
        if (snap.empty) {
            container.innerHTML = '';
            return;
        }
        let total = 0;
        let count = 0;
        snap.forEach(d => {
            const data = d.data();
            const esReseña = data.tipo === 'reseña' || (!data.tipo && (data.rating || 0) > 0);
            if (esReseña) {
                total += (data.rating || 0);
                count++;
            }
        });

        if (count > 0) {
            const avg = (total / count).toFixed(1);
            container.innerHTML = `<span style="color:#ffd700;">★ ${avg}</span> <small style="color:#666">(${count})</small>`;
        } else {
            container.innerHTML = '';
        }
    } catch (e) { console.error("Error loading rating for grid:", e); }
}

export async function eliminarReview(id, productId) {
    if (!confirm("¿Eliminar reseña?")) return;
    try {
        await deleteDoc(doc(db, 'reseñas_productos', id));
        // Asumiendo que limpiarNotificacionesRelacionadas está en comunidad.js y expuesto a window
        if (window.limpiarNotificacionesRelacionadas) await window.limpiarNotificacionesRelacionadas(id);
        if (productId) {
            cargarRatingPromedio(productId, `stars-grid-${productId}`);
            cargarRatingPromedio(productId, `stars-search-${productId}`);
        }
        notify("Reseña eliminada.", 'info');
    } catch (e) { console.error(e); }
}

// Exponer a window para compatibilidad con HTML y otros módulos
window.cargarInventario = cargarInventario;
window.mostrarCategorias = mostrarCategorias;
window.filtrarProductos = filtrarProductos;
window.comprarDirecto = comprarDirecto;
window.verProducto = verProducto;
window.addToCart = addToCart;
window.obtenerImagenHTML = obtenerImagenHTML;
window.renderProductGallery = renderProductGallery;
window.changeMainProductImage = changeMainProductImage;
window.navGallery = navGallery;
window.updateCartUI = updateCartUI;
window.renderCarrito = renderCarrito;
window.quitar = quitar;
window.abrirEnlacesML = abrirEnlacesML;
window.vaciarCarrito = vaciarCarrito;

window.initReseñasProducto = initReseñasProducto;
window.previsualizarReseña = previsualizarReseña;
window.enviarReseñaProducto = enviarReseñaProducto;
window.cargarReseñasProducto = cargarReseñasProducto;
window.votarReview = votarReview;
window.votarRespuestaReview = votarRespuestaReview;
window.cargarRatingPromedio = cargarRatingPromedio;
window.eliminarReview = eliminarReview;
window.MI_NUMERO = MI_NUMERO; // Exponer MI_NUMERO para uso global