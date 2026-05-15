const functions = require('firebase-functions');
const admin = require('firebase-admin');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

admin.initializeApp();
const db = admin.firestore();

async function extractTextFromBase64(base64Data, mimeType) {
    try {
        const buffer = Buffer.from(base64Data, 'base64');
        if (mimeType === 'application/pdf') {
            const data = await pdf(buffer);
            return data.text;
        } else if (mimeType === 'application/msword' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        }
        return '';
    } catch (error) {
        console.error('Error extrayendo texto del archivo:', error);
        return '';
    }
}

async function obtenerContenidoCurricular(materia) {
    if (!materia) return '';
    try {
        const materiaKey = materia.toLowerCase().replace(/ /g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const docRef = db.collection('contenidos_curriculares').doc(materiaKey);
        const docSnap = await docRef.get();
        return docSnap.exists ? docSnap.data().texto : '';
    } catch (error) {
        console.error('Error al obtener contenido curricular:', error);
        return '';
    }
}

function buscarFragmentosRelevantes(texto, tema, maxFragmentos = 5) {
    if (!texto || !tema) return '';
    const textoNormalizado = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const palabrasClave = tema.toLowerCase().split(' ').filter(p => p.length > 3);
    const parrafos = texto.split(/\n\s*\n/).filter(p => p.trim().length > 50);
    const fragmentosPuntuados = parrafos.map(parrafo => {
        let puntuacion = 0;
        const parrafoNormalizado = parrafo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        palabrasClave.forEach(palabra => {
            const regex = new RegExp(palabra, 'g');
            puntuacion += (parrafoNormalizado.match(regex) || []).length;
        });
        return { texto: parrafo.trim(), puntuacion };
    });
    fragmentosPuntuados.sort((a, b) => b.puntuacion - a.puntuacion);
    return fragmentosPuntuados.slice(0, maxFragmentos).map(f => f.texto.substring(0, 600)).join('\n\n');
}

function generarPlanificacionProfesional(datos, textoArchivo, contenidoCurricular) {
    const { materia, nivel, tema, jurisdiccion, tipo } = datos;
    let contextoCurricular = '';
    if (textoArchivo && textoArchivo.length > 100) {
        contextoCurricular += textoArchivo.substring(0, 8000);
    }
    if (contenidoCurricular) {
        contextoCurricular += '\n' + contenidoCurricular.substring(0, 5000);
    }
    let fragmentosTema = '';
    if (textoArchivo) fragmentosTema = buscarFragmentosRelevantes(textoArchivo, tema);
    if (!fragmentosTema && contenidoCurricular) fragmentosTema = buscarFragmentosRelevantes(contenidoCurricular, tema);

    let fundamentacion = `<p>La enseñanza de <strong>${tema}</strong> en el área de <strong>${materia}</strong> resulta fundamental para el desarrollo integral del alumno, en concordancia con el Diseño Curricular de la Provincia de <strong>${jurisdiccion}</strong>.</p>`;
    if (fragmentosTema) {
        fundamentacion += `<p>Según el Diseño Curricular vigente:</p><p style="font-style:italic; border-left:3px solid var(--accent-primary); padding-left:1rem;">${fragmentosTema.split('\n\n').slice(0,2).join('</p><p>')}</p>`;
    }
    fundamentacion += `<p>Esta planificación busca que el estudiante construya significados a partir de sus saberes previos, favoreciendo el pensamiento crítico y la resolución de problemas en situaciones reales.</p>`;

    let objetivos = '<ul>';
    objetivos += `<li><strong>Comprender</strong> los conceptos fundamentales relacionados con ${tema}, reconociendo su aplicación en situaciones cotidianas y escolares.</li>`;
    objetivos += `<li><strong>Aplicar</strong> procedimientos y técnicas propias de ${materia} en la resolución de problemas, utilizando lenguaje específico del área.</li>`;
    objetivos += `<li><strong>Desarrollar</strong> actitudes de responsabilidad, cooperación y respeto en el trabajo grupal.</li>`;
    if (nivel === 'Primario') objetivos += `<li><strong>Utilizar</strong> el lenguaje de manera efectiva para comunicar ideas.</li>`;
    if (tipo === 'Proyecto') objetivos += `<li><strong>Diseñar</strong> un proyecto integrador que vincule los contenidos con situaciones reales.</li>`;
    objetivos += '</ul>';

    let contenidos = `<p><strong>Conceptuales:</strong> ${tema}, sus propiedades, clasificación y características principales.</p>`;
    contenidos += `<p><strong>Procedimentales:</strong> Resolución de problemas, análisis de casos, producciones escritas o digitales.</p>`;
    contenidos += `<p><strong>Actitudinales:</strong> Valoración del trabajo intelectual, interés por la indagación, participación activa.</p>`;

    let estrategias = `<ul>`;
    estrategias += `<li><strong>ABP:</strong> Situaciones problemáticas contextualizadas.</li>`;
    estrategias += `<li><strong>Trabajo Colaborativo:</strong> Producción grupal con roles asignados.</li>`;
    estrategias += `<li><strong>Exposición Dialogada:</strong> Puesta en común de resultados.</li>`;
    estrategias += `<li><strong>Uso de TIC:</strong> Herramientas digitales para investigación y presentación.</li>`;
    if (tipo === 'Anual') estrategias += `<li><strong>Proyectos trimestrales:</strong> Actividades integradoras.</li>`;
    estrategias += `</ul>`;

    let evaluacion = `<p><strong>Criterios:</strong></p><ul>`;
    evaluacion += `<li>Apropiación de contenidos conceptuales.</li>`;
    evaluacion += `<li>Aplicación de procedimientos específicos.</li>`;
    evaluacion += `<li>Participación y trabajo en equipo.</li></ul>`;
    evaluacion += `<p><strong>Instrumentos:</strong> Observación directa, registros, pruebas escritas, rúbricas.</p>`;
    evaluacion += `<p>Se priorizará la evaluación formativa y procesual.</p>`;

    return { fundamentacion, objetivos, contenidos, estrategias, evaluacion };
}

exports.generatePlan = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { materia, nivel, tema, jurisdiccion, tipo, archivoBase64, archivoMimeType } = data;
    if (!materia || !nivel || !tema) throw new functions.https.HttpsError('invalid-argument', 'Faltan datos obligatorios.');

    let textoArchivo = '';
    if (archivoBase64 && archivoMimeType) {
        textoArchivo = await extractTextFromBase64(archivoBase64, archivoMimeType);
    }
    const contenidoCurricular = await obtenerContenidoCurricular(materia);
    return generarPlanificacionProfesional({ materia, nivel, tema, jurisdiccion, tipo }, textoArchivo, contenidoCurricular);
});

exports.uploadContenidoCurricular = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { materia, texto } = data;
    if (!materia || !texto) throw new functions.https.HttpsError('invalid-argument', 'Faltan datos.');
    const materiaKey = materia.toLowerCase().replace(/ /g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    await db.collection('contenidos_curriculares').doc(materiaKey).set({
        materia, texto, updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true };
});