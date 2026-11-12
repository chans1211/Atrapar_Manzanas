/**
 * ¡ATRAPA! — versión web de un proyecto de Scratch.
 *
 * Estructura:
 *   1. CONFIG ........ todos los números del juego en un solo lugar
 *   2. Utilidades .... funciones auxiliares pequeñas
 *   3. Sprites ....... Sprite, Canasto y los objetos que caen
 *   4. Entrada ....... teclado, mouse y toque
 *   5. Vista ......... todo lo que se dibuja
 *   6. Juego ......... estado, reglas y bucle principal
 *
 * Las imágenes (SVG) vienen de assets.js. Coordenadas como en Scratch:
 * el origen (0, 0) está en el centro del escenario y Y crece hacia arriba.
 */
'use strict';

/* ============================================================
 * 1. CONFIGURACIÓN
 * ============================================================ */
const CONFIG = {
  escenario: { ancho: 480, alto: 360, escala: 2 }, // escala = nitidez del canvas
  fps: 30,

  vidasIniciales: 3,
  limiteX: 205,     // el canasto no pasa de ±205
  aparicionX: 200,  // los objetos nacen en X aleatorio entre ±200
  aparicionY: 180,  // ...arriba del escenario
  sueloY: -165,     // al pasar esta altura el objeto se perdió

  puntosPorNivel: 5,
  velocidadBase: 3, // velocidad = base + nivel

  canasto: { y: -130, pasoPorCuadro: 10, centroImagen: [55, 36] },

  manzana: { centroImagen: [20, 24], puntos: 1 },
  bomba:   { centroImagen: [24, 28], puntosMinimos: 3, espera: [1, 3] },
  dorada:  { centroImagen: [23, 26], puntosMinimos: 5, espera: [3, 6],
             esperaInicial: [2, 5], puntos: 3, velocidadExtra: 3 },

  titulo: { y: 40, centroImagen: [210, 95] },
};

/* ============================================================
 * 2. UTILIDADES
 * ============================================================ */
const enteroAleatorio = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const limitar = (valor, min, max) => Math.max(min, Math.min(max, valor));

function cargarImagen(fuente) {
  return new Promise((resolver) => {
    const imagen = new Image();
    imagen.onload = () => resolver(imagen);
    imagen.src = fuente;
  });
}

/* ============================================================
 * 3. SPRITES
 * ============================================================ */

/** Imagen con posición (en coordenadas Scratch) y colisión por píxeles. */
class Sprite {
  constructor(imagen, [centroX, centroY]) {
    this.imagen = imagen;
    this.centroX = centroX;
    this.centroY = centroY;
    this.ancho = imagen.naturalWidth;
    this.alto = imagen.naturalHeight;
    this.opacidad = Sprite.leerOpacidad(imagen);
    this.x = 0;
    this.y = 0;
    this.visible = false;
  }

  /** Guarda la transparencia de cada píxel para detectar choques exactos. */
  static leerOpacidad(imagen) {
    const lienzo = document.createElement('canvas');
    lienzo.width = imagen.naturalWidth;
    lienzo.height = imagen.naturalHeight;
    const g = lienzo.getContext('2d');
    g.drawImage(imagen, 0, 0);
    return g.getImageData(0, 0, lienzo.width, lienzo.height).data;
  }

  // Esquina superior izquierda en píxeles del canvas
  get izquierda() { return CONFIG.escenario.ancho / 2 + this.x - this.centroX; }
  get arriba()    { return CONFIG.escenario.alto / 2 - this.y - this.centroY; }

  dibujar(ctx) {
    if (this.visible) ctx.drawImage(this.imagen, this.izquierda, this.arriba);
  }

  esOpacoEn(px, py) {
    const x = Math.floor(px - this.izquierda);
    const y = Math.floor(py - this.arriba);
    const dentro = x >= 0 && y >= 0 && x < this.ancho && y < this.alto;
    return dentro && this.opacidad[(y * this.ancho + x) * 4 + 3] > 0;
  }

  /** Equivale al bloque "¿tocando…?" de Scratch. */
  toca(otro) {
    if (!this.visible || !otro.visible) return false;

    const desdeX = Math.max(this.izquierda, otro.izquierda);
    const hastaX = Math.min(this.izquierda + this.ancho, otro.izquierda + otro.ancho);
    const desdeY = Math.max(this.arriba, otro.arriba);
    const hastaY = Math.min(this.arriba + this.alto, otro.arriba + otro.alto);

    for (let y = Math.floor(desdeY); y < hastaY; y++) {
      for (let x = Math.floor(desdeX); x < hastaX; x++) {
        if (this.esOpacoEn(x, y) && otro.esOpacoEn(x, y)) return true;
      }
    }
    return false;
  }
}

class Canasto extends Sprite {
  constructor(imagen) {
    super(imagen, CONFIG.canasto.centroImagen);
    this.colocarEnInicio();
  }

  colocarEnInicio() {
    this.x = 0;
    this.y = CONFIG.canasto.y;
    this.visible = true;
  }

  moverA(x) { this.x = limitar(x, -CONFIG.limiteX, CONFIG.limiteX); }
  mover(direccion) { this.moverA(this.x + direccion * CONFIG.canasto.pasoPorCuadro); }
}

/**
 * Objeto que cae desde arriba. Fases:
 *   'inactivo'  → todavía no cumple la condición para aparecer
 *   'esperando' → oculto, contando segundos para reaparecer
 *   'cayendo'   → visible y bajando
 * Las subclases definen sus reglas con los métodos "gancho" del final.
 */
class ObjetoCayente extends Sprite {
  constructor(imagen, configuracion) {
    super(imagen, configuracion.centroImagen);
    this.fase = 'inactivo';
    this.segundosRestantes = 0;
  }

  reiniciar() {
    this.visible = false;
    this.fase = 'inactivo';
  }

  aparecer() {
    this.x = enteroAleatorio(-CONFIG.aparicionX, CONFIG.aparicionX);
    this.y = CONFIG.aparicionY;
    this.visible = true;
    this.fase = 'cayendo';
  }

  esperar([min, max]) {
    this.visible = false;
    this.fase = 'esperando';
    this.segundosRestantes = enteroAleatorio(min, max);
  }

  actualizar(juego) {
    switch (this.fase) {
      case 'inactivo':
        if (this.puedeAparecer(juego)) this.alActivarse();
        break;
      case 'esperando':
        this.segundosRestantes -= 1 / CONFIG.fps;
        if (this.segundosRestantes <= 0) this.aparecer();
        break;
      case 'cayendo':
        this.caer(juego);
        break;
    }
  }

  caer(juego) {
    this.y -= this.velocidad(juego);
    if (this.toca(juego.canasto)) this.alAtrapar(juego);
    else if (this.y < CONFIG.sueloY) this.alPerder(juego);
  }

  // --- Ganchos (las subclases los sobrescriben) ---
  puedeAparecer(juego) { return true; }
  alActivarse() { this.aparecer(); }
  velocidad(juego) { return juego.velocidad; }
  alAtrapar(juego) {}
  alPerder(juego) {}
}

class Manzana extends ObjetoCayente {
  constructor(imagen) { super(imagen, CONFIG.manzana); }

  alAtrapar(juego) { juego.puntos += CONFIG.manzana.puntos; this.aparecer(); }
  alPerder(juego)  { juego.vidas -= 1; this.aparecer(); }
}

class Bomba extends ObjetoCayente {
  constructor(imagen) { super(imagen, CONFIG.bomba); }

  puedeAparecer(juego) { return juego.puntos >= CONFIG.bomba.puntosMinimos; }
  alAtrapar(juego) { juego.vidas -= 1; this.esperar(CONFIG.bomba.espera); }
  alPerder()       { this.esperar(CONFIG.bomba.espera); }
}

class Dorada extends ObjetoCayente {
  constructor(imagen) { super(imagen, CONFIG.dorada); }

  puedeAparecer(juego) { return juego.puntos >= CONFIG.dorada.puntosMinimos; }
  alActivarse()        { this.esperar(CONFIG.dorada.esperaInicial); }
  velocidad(juego)     { return juego.velocidad + CONFIG.dorada.velocidadExtra; }
  alAtrapar(juego)     { juego.puntos += CONFIG.dorada.puntos; this.esperar(CONFIG.dorada.espera); }
  alPerder()           { this.esperar(CONFIG.dorada.espera); }
}

/* ============================================================
 * 4. ENTRADA (teclado, mouse y toque)
 * ============================================================ */
class Entrada {
  constructor(lienzo, { alIniciar }) {
    this.lienzo = lienzo;
    this.teclas = new Set();
    this.punteroX = null; // posición pedida por mouse/dedo, en coords Scratch

    addEventListener('keydown', (e) => {
      this.teclas.add(e.key.toLowerCase());
      if (['arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
      if (e.key === 'Enter' || e.key === ' ') alIniciar();
    });
    addEventListener('keyup', (e) => this.teclas.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.teclas.clear());

    lienzo.addEventListener('pointermove', (e) => this.leerPuntero(e));
    lienzo.addEventListener('pointerdown', (e) => { alIniciar(); this.leerPuntero(e); });
  }

  /** -1 = izquierda, 0 = quieto, 1 = derecha (si se pulsan ambas, se cancelan) */
  get direccion() {
    const derecha = this.teclas.has('arrowright') || this.teclas.has('d');
    const izquierda = this.teclas.has('arrowleft') || this.teclas.has('a');
    return Number(derecha) - Number(izquierda);
  }

  leerPuntero(evento) {
    const caja = this.lienzo.getBoundingClientRect();
    const { ancho } = CONFIG.escenario;
    this.punteroX = ((evento.clientX - caja.left) / caja.width) * ancho - ancho / 2;
  }

  /** Devuelve la posición del puntero una sola vez y la borra. */
  consumirPuntero() {
    const x = this.punteroX;
    this.punteroX = null;
    return x;
  }
}

/* ============================================================
 * 5. VISTA (todo lo que se dibuja)
 * ============================================================ */
class Vista {
  constructor(lienzo, imagenes) {
    const { ancho, alto, escala } = CONFIG.escenario;
    this.ancho = ancho;
    this.alto = alto;
    this.imagenes = imagenes;
    this.ctx = lienzo.getContext('2d');
    lienzo.width = ancho * escala;
    lienzo.height = alto * escala;
    this.ctx.scale(escala, escala);
  }

  dibujar(juego) {
    const { ctx } = this;
    ctx.drawImage(this.imagenes.parque, 0, 0);
    juego.sprites.forEach((sprite) => sprite.dibujar(ctx));

    if (juego.estado !== 'listo') this.dibujarMarcador(juego);
    if (juego.estado === 'listo') this.dibujarTitulo(this.imagenes.inicio, 'Enter, espacio o toca para jugar');
    if (juego.estado === 'fin') {
      this.dibujarTitulo(this.imagenes.fin, 'Enter, espacio o toca para jugar otra vez');
      this.dibujarGlobo(`Puntaje final: ${juego.puntos}`);
    }
  }

  dibujarMarcador({ puntos, vidas, nivel }) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(6, 6, 150, 62);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Puntos: ${puntos}`, 14, 20);
    ctx.fillText(`Vidas: ${'♥'.repeat(Math.max(0, vidas))}`, 14, 38);
    ctx.fillText(`Nivel: ${nivel}`, 14, 56);
  }

  dibujarTitulo(imagen, instruccion) {
    const { ctx } = this;
    const [centroX, centroY] = CONFIG.titulo.centroImagen;
    ctx.drawImage(imagen, this.ancho / 2 - centroX, this.alto / 2 - CONFIG.titulo.y - centroY);

    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#1f2a44';
    ctx.fillStyle = '#fff';
    ctx.strokeText(instruccion, this.ancho / 2, 318);
    ctx.fillText(instruccion, this.ancho / 2, 318);
  }

  /** Globo de diálogo (el bloque "decir" de Scratch). */
  dibujarGlobo(texto) {
    const { ctx } = this;
    ctx.font = 'bold 16px Arial';
    const anchoGlobo = ctx.measureText(texto).width + 28;

    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect((this.ancho - anchoGlobo) / 2, 6, anchoGlobo, 30, 14);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#222';
    ctx.textAlign = 'center';
    ctx.fillText(texto, this.ancho / 2, 22);
  }
}

/* ============================================================
 * 6. JUEGO (estado, reglas y bucle principal)
 * ============================================================ */
class Juego {
  constructor(lienzo, imagenes) {
    this.canasto = new Canasto(imagenes.canasto);
    this.manzana = new Manzana(imagenes.manzana);
    this.bomba = new Bomba(imagenes.bomba);
    this.dorada = new Dorada(imagenes.dorada);

    // Orden de dibujo (de atrás hacia adelante)
    this.sprites = [this.canasto, this.manzana, this.bomba, this.dorada];
    this.objetosCayentes = [this.manzana, this.bomba, this.dorada];

    this.vista = new Vista(lienzo, imagenes);
    this.entrada = new Entrada(lienzo, { alIniciar: () => this.iniciar() });

    this.estado = 'listo'; // 'listo' | 'jugando' | 'fin'
    this.reiniciarMarcadores();

    this.acumulado = 0;
    this.ultimoTiempo = 0;
    this.bloqueoReinicio = 0; // evita reiniciar sin querer justo al perder
  }

  reiniciarMarcadores() {
    this.puntos = 0;
    this.vidas = CONFIG.vidasIniciales;
    this.nivel = 1;
    this.velocidad = CONFIG.velocidadBase + this.nivel;
  }

  iniciar() {
    if (this.estado === 'jugando' || this.bloqueoReinicio > 0) return;
    this.reiniciarMarcadores();
    this.canasto.colocarEnInicio();
    this.objetosCayentes.forEach((objeto) => objeto.reiniciar());
    this.manzana.aparecer();
    this.estado = 'jugando';
  }

  terminar() {
    this.estado = 'fin';
    this.bloqueoReinicio = 0.6;
  }

  /** Un cuadro de lógica (se ejecuta a 30 por segundo, como Scratch). */
  actualizar() {
    if (this.bloqueoReinicio > 0) this.bloqueoReinicio -= 1 / CONFIG.fps;
    if (this.estado !== 'jugando') return;

    this.moverCanasto();
    this.actualizarNivel();
    this.objetosCayentes.forEach((objeto) => objeto.actualizar(this));

    if (this.vidas < 1) this.terminar();
  }

  moverCanasto() {
    this.canasto.mover(this.entrada.direccion);
    const punteroX = this.entrada.consumirPuntero();
    if (punteroX !== null) this.canasto.moverA(punteroX);
  }

  actualizarNivel() {
    this.nivel = 1 + Math.floor(this.puntos / CONFIG.puntosPorNivel);
    this.velocidad = CONFIG.velocidadBase + this.nivel;
  }

  /** Bucle principal: lógica a paso fijo, dibujo en cada pantalla. */
  bucle = (tiempo) => {
    const segundos = Math.min(0.25, (tiempo - this.ultimoTiempo) / 1000);
    this.ultimoTiempo = tiempo;
    this.acumulado += segundos;

    const paso = 1 / CONFIG.fps;
    while (this.acumulado >= paso) {
      this.actualizar();
      this.acumulado -= paso;
    }

    this.vista.dibujar(this);
    requestAnimationFrame(this.bucle);
  };

  comenzarBucle() {
    requestAnimationFrame((tiempo) => {
      this.ultimoTiempo = tiempo;
      this.bucle(tiempo);
    });
  }
}

/* ============================================================
 * ARRANQUE
 * ============================================================ */
async function arrancar() {
  const nombres = Object.keys(IMAGENES);
  const cargadas = await Promise.all(nombres.map((nombre) => cargarImagen(IMAGENES[nombre])));
  const imagenes = Object.fromEntries(nombres.map((nombre, i) => [nombre, cargadas[i]]));

  const lienzo = document.getElementById('juego');
  new Juego(lienzo, imagenes).comenzarBucle();
}

arrancar();
