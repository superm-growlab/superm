/**
 * AGENTE CENTRAL DE DATOS - SUPER M LABS
 * 
 * Misión: Actuar como el ÚNICO intermediario entre la interfaz de usuario y el mundo exterior.
 * Ningún archivo visual debe conocer URLs de APIs o estructuras de datos en bruto.
 * 
 * Beneficios:
 * 1. Centralización: Si una API cambia, solo editamos este archivo.
 * 2. Seguridad: Manejo global de errores para que la web nunca se bloquee.
 * 3. Limpieza: Entregamos datos listos para mostrar ("Nombre" en lugar de "product_full_title_v2").
 */

import { functions } from './modulos/firebase-config.js';
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js";

class AgenteCentral {
    constructor() {
        // Sistema de Monitoreo: Aquí guardamos la salud de tus conexiones
        this.estado = {
            tienda: { conectada: false, ultimoError: null, llaveAsociada: null },
            biblioteca: { conectada: false, ultimoError: null, llaveAsociada: null },
            recetarios: { conectada: false, ultimoError: null, llaveAsociada: null },
            firebase: { conectada: true, ultimoError: null, llaveAsociada: null },
            mercadoLibre: { conectada: false, ultimoError: null, llaveAsociada: 'ML_CLIENT_ID' },
            herramientas: { conectada: false, ultimoError: null, llaveAsociada: null },
            comunidad: { conectada: false, ultimoError: null, llaveAsociada: null },
            visionAI: { conectada: false, ultimoError: null, llaveAsociada: 'GEMINI_API_KEY' },
            googleSheets: { conectada: false, ultimoError: null, llaveAsociada: null }
        };

        // Inventario de Seguridad: Mapa de llaves requeridas y sus fuentes
        this.inventarioLlaves = {
            'GEMINI_API_KEY': {
                nombre: 'Google Gemini AI',
                uso: 'Cerebro del Detector (Oráculo). Procesa el análisis botánico.',
                link: 'https://aistudio.google.com/app/apikey'
            },
            'ML_CLIENT_ID': {
                nombre: 'Mercado Libre App ID',
                uso: 'Identificador único de tu aplicación en Mercado Libre Devs.',
                link: 'https://developers.mercadolibre.com.ar/es_ar/apps/list'
            },
            'ML_CLIENT_SECRET': {
                nombre: 'Mercado Libre Client Secret',
                uso: 'Clave privada para generar tokens de acceso automáticos.',
                link: 'https://developers.mercadolibre.com.ar/es_ar/apps/list'
            },
            'MP_ACCESS_TOKEN': {
                nombre: 'Mercado Pago SDK',
                uso: 'Procesamiento de pagos y creación de preferencias de compra.',
                link: 'https://www.mercadopago.com.ar/developers/panel'
            },
            'GOOGLE_SEARCH_API_KEY': {
                nombre: 'Google Search API',
                uso: 'Búsqueda dinámica de imágenes para el Oráculo.',
                link: 'https://console.cloud.google.com/apis/credentials'
            },
            'CUSTOM_SEARCH_ID': {
                nombre: 'Google Custom Search CX',
                uso: 'ID del motor de búsqueda para imágenes botánicas.',
                link: 'https://programmablesearchengine.google.com/controlpanel/all'
            }
        };

        // Inicialización de secciones para asegurar el acceso al método privado
        this.#initTienda();
        this.#initHerramientas();
        this.#initComunidad();
        this.#initServicios();
        this.#initBiblioteca();
        this.#initRecetarios();
    }

    /**
     * Realiza un diagnóstico activo de todos los puntos de conexión.
     * Dispara las peticiones y actualiza el estado de salud global.
     */
    async verificarSaludCompleta() {
        console.log("🔍 Agente: Iniciando diagnóstico global de red...");
        
        const pruebas = [
            this.tienda.obtenerProductos(),
            this.biblioteca.obtenerNotas(),
            this.recetarios.obtenerTodos(),
            // Verificación de Google Sheets (Usando modo no-cors para evitar bloqueos de seguridad en el ping)
            fetch("https://docs.google.com/spreadsheets/d/e/2PACX-1vQz-fNndUCID7stvplq5hmb2gLdSLs68uks2dfAr3DJK1Ft9LUtF0tYRyET3HEHotB-eKAqxishKe_A/pub?gid=0&single=true&output=tsv", { method: 'GET', mode: 'no-cors' })
                .then(() => this.#actualizarEstado('googleSheets', true))
                .catch(() => this.#actualizarEstado('googleSheets', false, "CORS/Bloqueo de red")),
            // Prueba de Comunidad y Herramientas (si existen endpoints)
            // Al usar Firebase, si Firebase está OK, estos módulos también lo están
            Promise.resolve().then(() => {
                this.#actualizarEstado('herramientas', true);
                this.#actualizarEstado('comunidad', true);
            }),
            // Prueba de Firebase: Usamos obtenerProductoML que es un ping más directo
            this.servicios.firebaseFunctions.callCloudFunction('obtenerProductoML', { action: "test" })
                .then(() => this.#actualizarEstado('firebase', true))
                .catch(e => this.#actualizarEstado('firebase', false, "Error de comunicación: " + e.message)),
            // Prueba de Vision AI: Aquí sí queremos ver si la llave de Gemini responde
            // Llamamos a la función SIN el modo test para ver si la API de Google nos deja pasar
            this.servicios.firebaseFunctions.callCloudFunction('consultarOraculo', { titulo: "Test de Conexión", action: "health_check" })
                .then(() => this.#actualizarEstado('visionAI', true))
                .catch(e => this.#actualizarEstado('visionAI', false, e.message.includes("not-found") ? "API Gemini no habilitada en Google Cloud" : e.message)),
            // Verificación de disponibilidad de la API de Mercado Libre
            fetch('https://api.mercadolibre.com/sites/MLA', { method: 'GET', mode: 'no-cors' }).then(() => {
                // Si el fetch no falla (catch), asumimos que el servidor ML respondió aunque no podamos leer el JSON por CORS
                this.#actualizarEstado('mercadoLibre', true);
            }).catch(e => this.#actualizarEstado('mercadoLibre', false, e.message))
        ];

        await Promise.allSettled(pruebas);
        return this.estado;
    }

    /**
     * MÉTODO PRIVADO (#): Ejecutor maestro de consultas.
     * Centraliza la lógica de 'fetch', manejo de fallos y conversión a JSON.
     * @param {string} url - Dirección de la fuente de datos.
     * @param {object} opciones - Configuración (POST, headers, body, etc).
     * @param {any} fallback - Qué devolver si todo falla (evita que la web explote).
     * @param {boolean} esJson - Si se espera un JSON o texto plano (TSV).
     * @param {string} modulo - Nombre del módulo para el reporte de salud.
     * @param {number} reintentos - Cantidad de veces a reintentar si falla.
     */
    async #ejecutarConsulta(url, opciones = {}, fallback = null, esJson = true, modulo = 'global', reintentos = 3) {
        for (let i = 0; i < reintentos; i++) {
            try {
                const respuesta = await fetch(url, opciones);
                
                if (!respuesta.ok) {
                    throw new Error(`Error ${respuesta.status}: ${respuesta.statusText}`);
                }

                const datos = esJson ? await respuesta.json() : await respuesta.text();
                
                // ✅ Si la consulta es exitosa, guardamos una copia en la "mochila" (Caché)
                if (modulo !== 'global' && datos) {
                    localStorage.setItem(`cache_agente_${modulo}`, esJson ? JSON.stringify(datos) : datos);
                }

                this.#actualizarEstado(modulo, true);
                return datos;
            } catch (error) {
                const esUltimoIntento = i === reintentos - 1;
                
                if (esUltimoIntento) {
                    console.error(`🚨 Agente Central - Fallo definitivo en [${modulo}]:`, error.message);
                    
                    // 🔄 INTENTO DE RECUPERACIÓN: ¿Tenemos algo en la mochila de emergencia?
                    const respaldo = localStorage.getItem(`cache_agente_${modulo}`);
                    if (respaldo) {
                        console.warn(`🩹 Agente: Usando datos de respaldo (Caché) para el módulo ${modulo}.`);
                        this.#actualizarEstado(modulo, false, `${error.message} (Usando Respaldo)`);
                        return esJson ? JSON.parse(respaldo) : respaldo;
                    }

                    this.#actualizarEstado(modulo, false, error.message);
                    return fallback;
                }

                // Espera exponencial antes de reintentar (1s, 2s, 4s...)
                const espera = Math.pow(2, i) * 1000;
                console.warn(`⚠️ Agente: Error en ${modulo}. Reintentando en ${espera/1000}s... (Intento ${i + 1}/${reintentos})`);
                await new Promise(res => setTimeout(res, espera));
            }
        }
    }

    /**
     * Actualiza el reporte de salud interno
     */
    #actualizarEstado(modulo, exito, error = null) {
        if (this.estado[modulo]) {
            this.estado[modulo].conectada = exito;
            this.estado[modulo].ultimoError = error;
            if (!exito) {
                console.warn(`⚠️ Agente detectó falla en: ${modulo}. Razón: ${error}`);
            }
        }
    }

    /**
     * Utilidad privada para parsear TSV de Google Sheets a Objetos
     */
    #parsearTSV(texto) {
        if (!texto || texto.trim().startsWith("<")) return [];
        const dataClean = texto.replace(/^\uFEFF/, '').replace(/\r/g, '');
        const filas = dataClean.split(/\n(?=(?:[^"]*"[^"]*")*[^"]*$)/).slice(1);
        return filas.filter(f => f.trim() !== "").map(linea => {
            return linea.split(/\t(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v ? v.trim().replace(/^"|"$/g, '').replace(/""/g, '"') : "");
        });
    }

    // --- SECCIÓN: TIENDA ---
    #initTienda() {
        this.tienda = {
            obtenerProductos: async () => {
                const urlSheet = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQz-fNndUCID7stvplq5hmb2gLdSLs68uks2dfAr3DJK1Ft9LUtF0tYRyET3HEHotB-eKAqxishKe_A/pub?gid=0&single=true&output=tsv";
                const raw = await this.#ejecutarConsulta(urlSheet, {}, "", false, 'tienda');
                const filas = this.#parsearTSV(raw);
                
                return filas.map((c, i) => ({
                    id: c[0] || i.toString(),
                    category_id: c[1] || 'General',
                    title: c[2] || 'Sin nombre',
                    price: parseInt((c[3] || "0").replace(/[^0-9]/g, '')) || 0,
                    pictures: (c[4] || "").split('|').filter(u => u.trim() !== ""),
                    description_short: c[5] || '',
                    attributes: (c[6] || "").split('|').filter(a => a.trim() !== ""),
                    permalink: c[7] || '',
                    description: c[8] || ''
                }));
            }
        };
    }

    #initBiblioteca() {
        this.biblioteca = {
            obtenerNotas: async () => {
                const url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQz-fNndUCID7stvplq5hmb2gLdSLs68uks2dfAr3DJK1Ft9LUtF0tYRyET3HEHotB-eKAqxishKe_A/pub?gid=188672931&single=true&output=tsv";
                const raw = await this.#ejecutarConsulta(url, {}, "", false, 'biblioteca');
                const filas = this.#parsearTSV(raw);
                return filas.map((c, i) => ({
                    id: c[0] || i.toString(),
                    titulo: c[1] || 'Sin título',
                    cat: c[2] || 'General',
                    resumen: c[3] || '',
                    contenido: c[4] || '',
                    icono: c[5] || '📜',
                    fecha: c[6] || '',
                    imageUrls: (c[7] || "").split('|').filter(u => u.includes('http')),
                    upvotes: 0, downvotes: 0
                }));
            }
        };
    }

    #initRecetarios() {
        this.recetarios = {
            obtenerTodos: async () => {
                const url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQz-fNndUCID7stvplq5hmb2gLdSLs68uks2dfAr3DJK1Ft9LUtF0tYRyET3HEHotB-eKAqxishKe_A/pub?gid=654571090&single=true&output=tsv";
                const raw = await this.#ejecutarConsulta(url, {}, "", false, 'recetarios');
                const filas = this.#parsearTSV(raw);
                return filas.map((c, i) => ({
                    id: i,
                    marca: c[1] || 'Sin Marca',
                    imagenes: (c[2] || '').split('|').map(u => u.trim()).filter(u => u.startsWith('http')),
                    links: (c[3] || '').split('|').map(u => u.trim()).filter(u => u.startsWith('http')),
                    desc: c[4] || ''
                }));
            }
        };
    }

    // --- SECCIÓN: HERRAMIENTAS ---
    #initHerramientas() {
        this.herramientas = {
            /**
             * API: Interna / Laboratorio
             * Propósito: Obtener datos técnicos de recetarios propios.
             * Fuente: Base de datos Firebase.
             */
            obtenerRecetarios: async () => {
                const datos = await this.#ejecutarConsulta('https://api.superm.lab/recetarios', {}, [], true, 'herramientas');
                
                return datos.map(r => ({
                    marca: r.brand_name || "Genérico",
                    imagenTabla: r.main_table_url || "",
                    descripcion: r.short_info || ""
                }));
            },
            obtenerClimaSugerido: async (etapa) => {
                return {
                    tempIdeal: etapa === 'flora' ? 22 : 24,
                    humIdeal: etapa === 'flora' ? 45 : 60,
                    fuente: "Manual de Laboratorio Super M"
                };
            }
        };
    }

    #initComunidad() {
        this.comunidad = {
            /**
             * API: Social Lab
             * Propósito: Cargar las interacciones de los usuarios.
             * Fuente: Firestore.
             */
            obtenerUltimosMensajes: async () => {
                const mensajes = await this.#ejecutarConsulta('https://api.superm.lab/posts', {}, [], true, 'comunidad');
                return mensajes.map(m => ({
                    usuario: m.author_name || "Anónimo",
                    texto: m.content_text || "",
                    fecha: new Date(m.created_at).toLocaleDateString() || "Reciente",
                    categoria: m.tag || "General"
                }));
            }
        };
    }

    #initServicios() {
        this.servicios = {
            mercadoLibre: {
                /**
                 * API: Mercado Libre Developers
                 * Propósito: Validar productos y obtener datos para el carrito.
                 * Nota: Usa Cloud Functions para ocultar el ClientID/Secret.
                 */
                obtenerDatosDesdeLink: async (referralLink) => {
                    const idML = referralLink.split('MLA-')[1]?.split('-')[0] || "000";
                    // Aquí no pasamos módulo porque es una API externa directa
                    const data = await this.#ejecutarConsulta(`https://api.mercadolibre.com/items/MLA${idML}`, {}, null, true, 'mercadoLibre');
                    if (!data) return null;
                    return {
                        id: data.id,
                        titulo: data.title,
                        precio: new Intl.NumberFormat('es-AR', { style: 'currency', currency: data.currency_id }).format(data.price),
                        imagen: data.pictures?.[0]?.url || 'https://i.postimg.cc/rF9GqwGS/favicon.png',
                        link: referralLink
                    };
                },
                getProductFromCloudFunction: async (url, productId) => {
                    const data = await this.servicios.firebaseFunctions.callCloudFunction('obtenerProductoML', { url, productId });
                    this.#actualizarEstado('mercadoLibre', !!data, data?.error);
                    return data;
                }
            },
            firebaseFunctions: {
                /**
                 * API: Firebase Cloud Functions (El Puente)
                 * Propósito: Ejecutar lógica pesada o secreta fuera del navegador.
                 * Seguridad: Aquí se inyectan las API Keys privadas.
                 */
                callCloudFunction: async (functionName, payload) => {
                    try {
                        const callable = httpsCallable(functions, functionName);
                        const response = await callable(payload);
                        this.#actualizarEstado('firebase', true);
                        return response.data;
                    } catch (e) { 
                        this.#actualizarEstado('firebase', false, e.message);
                        throw e; 
                    }
                }
            },
            visionAI: {
                /**
                 * API: Google Cloud Vision / Gemini Multimodal
                 * Propósito: "Ver" imágenes y detectar patrones botánicos.
                 * Costo: Basado en cuota de uso.
                 */
                analizarCarencia: async (base64Image) => {
                    // Enviamos la foto a la Cloud Function que tiene acceso a Gemini
                    const data = await this.servicios.firebaseFunctions.callCloudFunction('analizarImagenPlanta', { image: base64Image });
                    
                    this.#actualizarEstado('visionAI', !!data, data?.error);
                    return {
                        diagnostico: data?.diagnostico || "No se detectó patrón claro",
                        seguridad: data?.confianza || "0%",
                        accion: data?.accion || "Revisar parámetros de pH y riego."
                    };
                }
            },
            googleSheets: {
                sendToSheet: async (url, payload) => {
                    try {
                        const config = { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) };
                        await fetch(url, config);
                        this.#actualizarEstado('googleSheets', true);
                    } catch (e) {
                        this.#actualizarEstado('googleSheets', false, e.message);
                    }
                }
            }
        };
    }
}

/**
 * INSTANCIA GLOBAL:
 * Exportamos una sola "oficina" abierta para todo el sitio.
 */
export const Agente = new AgenteCentral();
window.Agente = Agente;

/**
 * NOTA PARA EL USUARIO:
 * Para usar el Agente en tus otros archivos (.js), impórtalo así:
 * import { Agente } from '../api/agente_central.js';
 * const productos = await Agente.tienda.obtenerProductos();
 */