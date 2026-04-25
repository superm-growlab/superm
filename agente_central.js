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
        // Inicialización de secciones para asegurar el acceso al método privado
        this.#initTienda();
        this.#initHerramientas();
        this.#initComunidad();
        this.#initServicios();
    }

    /**
     * MÉTODO PRIVADO (#): Ejecutor maestro de consultas.
     * Centraliza la lógica de 'fetch', manejo de fallos y conversión a JSON.
     * @param {string} url - Dirección de la fuente de datos.
     * @param {object} opciones - Configuración (POST, headers, body, etc).
     * @param {any} fallback - Qué devolver si todo falla (evita que la web explote).
     */
    async #ejecutarConsulta(url, opciones = {}, fallback = null) {
        try {
            const respuesta = await fetch(url, opciones);
            
            if (!respuesta.ok) {
                throw new Error(`Servidor fuera de línea o error ${respuesta.status}`);
            }

            return await respuesta.json();
        } catch (error) {
            console.error(`🚨 Agente Central - Error en [${url}]:`, error.message);
            // Devolvemos el "salvavidas" (un objeto vacío o array vacío)
            return fallback;
        }
    }

    // --- SECCIÓN: TIENDA ---
    #initTienda() {
        this.tienda = {
            obtenerProductos: async () => {
                const datos = await this.#ejecutarConsulta('./data/inventario.json', {}, []);
                
                return datos.map(item => ({
                    id: item.id || 0,
                    nombre: item.title || "Producto sin nombre",
                    precio: item.price || 0,
                    imagen: (item.pictures && item.pictures[0]) || 'https://i.postimg.cc/rF9GqwGS/favicon.png',
                    categoria: item.category_id || 'General'
                }));
            }
        };
    }

    // --- SECCIÓN: HERRAMIENTAS ---
    #initHerramientas() {
        this.herramientas = {
            obtenerRecetarios: async () => {
                const datos = await this.#ejecutarConsulta('https://api.superm.lab/recetarios', {}, []);
                
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
            obtenerUltimosMensajes: async () => {
                const mensajes = await this.#ejecutarConsulta('https://api.superm.lab/posts', {}, []);
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
                obtenerDatosDesdeLink: async (referralLink) => {
                    const idML = referralLink.split('MLA-')[1]?.split('-')[0] || "000";
                    const data = await this.#ejecutarConsulta(`https://api.mercadolibre.com/items/MLA${idML}`, {}, null);
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
                    return await this.servicios.firebaseFunctions.callCloudFunction('obtenerProductoML', { url, productId });
                }
            },
            firebaseFunctions: {
                callCloudFunction: async (functionName, payload) => {
                    try {
                        const callable = httpsCallable(functions, functionName);
                        const response = await callable(payload);
                        return response.data;
                    } catch (e) { throw e; }
                }
            },
            visionAI: {
                analizarCarencia: async (base64Image) => {
                    const config = {
                        method: 'POST',
                        body: JSON.stringify({ image: base64Image }),
                        headers: { 'Content-Type': 'application/json' }
                    };
                    const data = await this.#ejecutarConsulta('https://api.superm.lab/vision', config, { error: true });
                    return {
                        diagnostico: data.diagnosis || "No se detectó patrón claro",
                        seguridad: (data.confidence * 100).toFixed(0) + "%",
                        accion: data.remedy || "Revisar parámetros de pH y riego."
                    };
                }
            },
            googleSheets: {
                sendToSheet: async (url, payload) => {
                    const config = { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) };
                    await fetch(url, config);
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

/**
 * NOTA PARA EL USUARIO:
 * Para usar el Agente en tus otros archivos (.js), impórtalo así:
 * import { Agente } from '../api/agente_central.js';
 * const productos = await Agente.tienda.obtenerProductos();
 */