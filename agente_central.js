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
            tienda: { conectada: false, ultimoError: null },
            biblioteca: { conectada: false, ultimoError: null },
            recetarios: { conectada: false, ultimoError: null },
            firebase: { conectada: true, ultimoError: null }, // Firebase inicia con el SDK
            mercadoLibre: { conectada: false, ultimoError: null },
            herramientas: { conectada: false, ultimoError: null },
            comunidad: { conectada: false, ultimoError: null },
            visionAI: { conectada: false, ultimoError: null },
            googleSheets: { conectada: false, ultimoError: null }
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
                this.#actualizarEstado(modulo, true);
                return datos;
            } catch (error) {
                const esUltimoIntento = i === reintentos - 1;
                
                if (esUltimoIntento) {
                    this.#actualizarEstado(modulo, false, error.message);
                    console.error(`🚨 Agente Central - Fallo definitivo en [${modulo}]:`, error.message);
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
                    const config = {
                        method: 'POST',
                        body: JSON.stringify({ image: base64Image }),
                        headers: { 'Content-Type': 'application/json' }
                    };
                    const data = await this.#ejecutarConsulta('https://api.superm.lab/vision', config, { error: true }, true, 'visionAI');
                    this.#actualizarEstado('visionAI', !!data && !data.error, data?.error);
                    return {
                        diagnostico: data.diagnosis || "No se detectó patrón claro",
                        seguridad: (data.confidence * 100).toFixed(0) + "%",
                        accion: data.remedy || "Revisar parámetros de pH y riego."
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