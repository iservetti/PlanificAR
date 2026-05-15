const functions = require('firebase-functions');
const admin = require('firebase-admin');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

admin.initializeApp();
const db = admin.firestore();

// =========================================
// 1. DETECCIÓN DE SIMILITUD ENTRE PLANIFICACIONES
// =========================================
function calcularSimilitud(texto1, texto2) {
    const palabras1 = new Set(texto1.toLowerCase().split(/\s+/).filter(p => p.length > 3));
    const palabras2 = new Set(texto2.toLowerCase().split(/\s+/).filter(p => p.length > 3));
    const interseccion = [...palabras1].filter(p => palabras2.has(p)).length;
    const union = new Set([...palabras1, ...palabras2]).size;
    return union === 0 ? 0 : interseccion / union;
}

exports.checkSimilarPlan = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { texto, materia } = data;
    const uid = context.auth.uid;
    const snapshot = await db.collection('users').doc(uid).collection('planificaciones')
        .where('materia', '==', materia).limit(10).get();
    let maxSimilitud = 0;
    snapshot.forEach(doc => {
        const existente = `${doc.data().tema || ''} ${doc.data().fundamentacion || ''}`;
        const sim = calcularSimilitud(texto, existente);
        if (sim > maxSimilitud) maxSimilitud = sim;
    });
    return { similitud: maxSimilitud, alerta: maxSimilitud > 0.7 };
});

// =========================================
// 2. SISTEMA DE RECOMENDACIÓN DE TEMAS
// =========================================
exports.suggestNextTopic = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { materia } = data;
    const uid = context.auth.uid;
    const snapshot = await db.collection('users').doc(uid).collection('planificaciones')
        .where('materia', '==', materia).orderBy('createdAt', 'desc').limit(5).get();
    const temas = [];
    snapshot.forEach(doc => temas.push(doc.data().tema));
    const conteo = {};
    snapshot.forEach(doc => {
        const palabras = (doc.data().tema || '').toLowerCase().split(/\s+/).filter(p => p.length > 3);
        palabras.forEach(p => { conteo[p] = (conteo[p] || 0) + 1; });
    });
    const sugeridas = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    return { temasAnteriores: temas, palabrasClave: sugeridas };
});

// =========================================
// 3. GENERADOR DE EXÁMENES
// =========================================
exports.generateExam = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { tema, contenidos, cantidad = 5 } = data;
    const conceptos = (contenidos || tema).split(/[.,;:]/).filter(c => c.trim().length > 10);
    const preguntas = [];
    for (let i = 0; i < Math.min(cantidad, conceptos.length); i++) {
        const tipo = i % 3;
        if (tipo === 0) preguntas.push({
            tipo: 'multiple_choice',
            pregunta: `¿Cuál de las siguientes opciones es correcta respecto a "${conceptos[i].trim().substring(0, 50)}..."?`,
            opciones: ['Opción A', 'Opción B', 'Opción C', 'Opción D'],
            respuesta: 0
        });
        else if (tipo === 1) preguntas.push({
            tipo: 'verdadero_falso',
            pregunta: `"${conceptos[i].trim().substring(0, 60)}..." ¿Es verdadero o falso?`,
            respuesta: true
        });
        else preguntas.push({
            tipo: 'desarrollo',
            pregunta: `Desarrollá el siguiente concepto: ${conceptos[i].trim().substring(0, 60)}...`
        });
    }
    return { tema, preguntas, total: preguntas.length };
});

// =========================================
// 4. DISTRIBUCIÓN HORARIA
// =========================================
exports.calculateHourDistribution = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { contenidos, cargaHoraria } = data;
    const items = contenidos.filter(c => c && c.trim().length > 5);
    if (items.length === 0 || !cargaHoraria) return { distribucion: [] };
    const horasPorItem = Math.floor(cargaHoraria / items.length);
    const resto = cargaHoraria % items.length;
    return {
        distribucion: items.map((item, i) => ({
            contenido: item,
            horas: horasPorItem + (i < resto ? 1 : 0)
        })),
        totalHoras: cargaHoraria
    };
});

// =========================================
// 5. HISTORIAL DE VERSIONES (se activa solo con onWrite)
// =========================================
exports.trackPlanVersion = functions.firestore
    .document('users/{userId}/planificaciones/{planId}')
    .onWrite(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();
        if (!before || !after) return;
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        await db.collection('users').doc(context.params.userId)
            .collection('planificaciones').doc(context.params.planId)
            .collection('versions').add({
                data: before,
                changedAt: admin.firestore.FieldValue.serverTimestamp()
            });
    });

// =========================================
// 6. CONSOLIDACIÓN DE PLANIFICACIONES
// =========================================
exports.consolidatePlans = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { planIds } = data;
    const uid = context.auth.uid;
    const documentos = [];
    for (const id of planIds) {
        const doc = await db.collection('users').doc(uid).collection('planificaciones').doc(id).get();
        if (doc.exists) documentos.push(doc.data());
    }
    if (documentos.length === 0) throw new functions.https.HttpsError('not-found', 'No se encontraron planificaciones.');
    const consolidado = {
        fundamentacion: documentos.map(d => d.fundamentacion || '').join('\n\n'),
        objetivos: documentos.map(d => d.objetivos || '').join('\n'),
        contenidos: documentos.map(d => d.contenidos || '').join('\n'),
        estrategias: documentos.map(d => d.estrategias || '').join('\n'),
        evaluacion: documentos.map(d => d.evaluacion || '').join('\n'),
        fuenteIds: planIds,
        tipo: 'Consolidado',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    const docRef = await db.collection('users').doc(uid).collection('planificaciones').add(consolidado);
    return { id: docRef.id, message: 'Planificación consolidada creada correctamente.' };
});

// =========================================
// 7. VALIDACIÓN DE COHERENCIA CURRICULAR
// =========================================
exports.validateCurriculumCoherence = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { materia, contenidos } = data;
    const materiaKey = materia.toLowerCase().replace(/ /g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const docRef = db.collection('contenidos_curriculares').doc(materiaKey);
    const docSnap = await docRef.get();
    if (!docSnap.exists) return { cumple: false, mensaje: 'No hay diseño curricular cargado para esta materia.' };
    const curricular = docSnap.data().texto.toLowerCase();
    const palabrasPlan = (contenidos || '').toLowerCase().split(/\s+/).filter(p => p.length > 4);
    const faltantes = palabrasPlan.filter(p => !curricular.includes(p));
    return {
        cumple: faltantes.length < palabrasPlan.length * 0.3,
        palabrasFaltantes: faltantes.slice(0, 10),
        mensaje: faltantes.length < palabrasPlan.length * 0.3 ? 'La planificación es coherente con el diseño curricular.' : 'Se detectaron palabras que no aparecen en el diseño curricular oficial.'
    };
});

// =========================================
// 8. RECORDATORIOS INTERNOS (sin FCM)
// =========================================
exports.generateInternalReminders = functions.pubsub.schedule('every 6 hours').onRun(async (context) => {
    const now = admin.firestore.Timestamp.now();
    const threeDaysLater = new Date(now.toDate().getTime() + 3 * 24 * 60 * 60 * 1000);
    const usersSnapshot = await db.collection('users').get();
    for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;
        const eventsSnapshot = await db.collection('users').doc(uid).collection('events')
            .where('imp', '==', true).get();
        for (const eventDoc of eventsSnapshot.docs) {
            const evt = eventDoc.data();
            const eventDate = new Date(evt.year, evt.month - 1, evt.day);
            if (eventDate.toDateString() === threeDaysLater.toDateString()) {
                await db.collection('users').doc(uid).collection('notifications').add({
                    title: 'Recordatorio',
                    body: `Faltan 3 días para: ${evt.name}`,
                    eventId: eventDoc.id,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    read: false
                });
            }
        }
    }
});

// =========================================
// 9. LIMPIEZA AUTOMÁTICA
// =========================================
exports.cleanOldData = functions.pubsub.schedule('0 3 * * 0').onRun(async (context) => {
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const usersSnapshot = await db.collection('users').get();
    for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;
        const backupsSnapshot = await db.collection('users').doc(uid).collection('backups')
            .where('backupDate', '<=', sixMonthsAgo).get();
        for (const backupDoc of backupsSnapshot.docs) {
            await backupDoc.ref.delete();
        }
        const notifSnapshot = await db.collection('users').doc(uid).collection('notifications')
            .where('createdAt', '<=', sixMonthsAgo).get();
        for (const notifDoc of notifSnapshot.docs) {
            await notifDoc.ref.delete();
        }
    }
});

// =========================================
// 10. EXPORTACIÓN A PDF DESDE EL BACKEND
// =========================================
exports.generatePlanPDF = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { planificacionId } = data;
    const uid = context.auth.uid;
    const docSnap = await db.collection('users').doc(uid).collection('planificaciones').doc(planificacionId).get();
    if (!docSnap.exists) throw new functions.https.HttpsError('not-found', 'Planificación no encontrada.');
    const plan = docSnap.data();
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', async () => {
        const base64 = Buffer.concat(chunks).toString('base64');
        await db.collection('users').doc(uid).collection('exports').add({
            planificacionId,
            pdfBase64: base64,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    });
    doc.fontSize(16).text(`Planificación de ${plan.materia} - ${plan.tema}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Fundamentación: ${plan.fundamentacion || ''}`);
    doc.text(`Objetivos: ${plan.objetivos || ''}`);
    doc.text(`Contenidos: ${plan.contenidos || ''}`);
    doc.text(`Estrategias: ${plan.estrategias || ''}`);
    doc.text(`Evaluación: ${plan.evaluacion || ''}`);
    doc.end();
    return { message: 'PDF generado y guardado en exports.' };
});

// =========================================
// 11. ANÁLISIS DE SENTIMIENTO
// =========================================
exports.analyzeSentiment = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { texto } = data;
    const positivas = ['bien', 'excelente', 'bueno', 'motivador', 'positivo', 'creativo', 'innovador', 'colaborativo'];
    const negativas = ['mal', 'deficiente', 'problema', 'dificultad', 'repetitivo', 'aburrido', 'forzado'];
    let score = 0;
    const palabras = texto.toLowerCase().split(/\s+/);
    palabras.forEach(p => { if (positivas.includes(p)) score++; if (negativas.includes(p)) score--; });
    return { score, sentimiento: score > 0 ? 'positivo' : score < 0 ? 'negativo' : 'neutro' };
});

// =========================================
// 12. DUPLICACIÓN INTELIGENTE
// =========================================
exports.duplicatePlanForYear = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { planificacionId, newYear } = data;
    const uid = context.auth.uid;
    const docSnap = await db.collection('users').doc(uid).collection('planificaciones').doc(planificacionId).get();
    if (!docSnap.exists) throw new functions.https.HttpsError('not-found', 'Planificación no encontrada.');
    const original = docSnap.data();
    const duplicated = { ...original, year: newYear, duplicatedFrom: planificacionId, createdAt: admin.firestore.FieldValue.serverTimestamp() };
    const newDoc = await db.collection('users').doc(uid).collection('planificaciones').add(duplicated);
    return { id: newDoc.id, message: 'Planificación duplicada para el año ' + newYear };
});

// =========================================
// 13. ESTADÍSTICAS AVANZADAS
// =========================================
exports.getAdvancedStats = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const uid = context.auth.uid;
    const plansSnapshot = await db.collection('users').doc(uid).collection('planificaciones').get();
    const porMes = {};
    const porMateria = {};
    let totalEdiciones = 0;
    for (const planDoc of plansSnapshot.docs) {
        const plan = planDoc.data();
        const mes = plan.createdAt?.toDate ? plan.createdAt.toDate().getMonth() : new Date().getMonth();
        porMes[mes] = (porMes[mes] || 0) + 1;
        porMateria[plan.materia] = (porMateria[plan.materia] || 0) + 1;
        const versionesSnapshot = await db.collection('users').doc(uid)
            .collection('planificaciones').doc(planDoc.id).collection('versions').get();
        totalEdiciones += versionesSnapshot.size;
    }
    return { porMes, porMateria, totalPlanificaciones: plansSnapshot.size, totalEdiciones };
});

// =========================================
// 14. SISTEMA DE ETIQUETAS
// =========================================
exports.addTagToPlan = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { planificacionId, tag } = data;
    const uid = context.auth.uid;
    await db.collection('users').doc(uid).collection('planificaciones').doc(planificacionId).update({
        tags: admin.firestore.FieldValue.arrayUnion(tag)
    });
    return { success: true };
});

exports.removeTagFromPlan = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { planificacionId, tag } = data;
    const uid = context.auth.uid;
    await db.collection('users').doc(uid).collection('planificaciones').doc(planificacionId).update({
        tags: admin.firestore.FieldValue.arrayRemove(tag)
    });
    return { success: true };
});

exports.getPlansByTag = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { tag } = data;
    const uid = context.auth.uid;
    const snapshot = await db.collection('users').doc(uid).collection('planificaciones')
        .where('tags', 'array-contains', tag).get();
    const resultados = [];
    snapshot.forEach(doc => resultados.push({ id: doc.id, ...doc.data() }));
    return resultados;
});

// =========================================
// 15. COPIA DE SEGURIDAD BAJO DEMANDA
// =========================================
exports.manualBackup = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const uid = context.auth.uid;
    const eventsSnapshot = await db.collection('users').doc(uid).collection('events').get();
    const plansSnapshot = await db.collection('users').doc(uid).collection('planificaciones').get();
    const backup = {
        events: eventsSnapshot.docs.map(d => ({ id: d.id, ...d.data() })),
        planificaciones: plansSnapshot.docs.map(d => ({ id: d.id, ...d.data() })),
        backupDate: admin.firestore.FieldValue.serverTimestamp(),
        tipo: 'manual'
    };
    const docRef = await db.collection('users').doc(uid).collection('backups').add(backup);
    return { id: docRef.id, message: 'Backup manual creado correctamente.' };
});

// =========================================
// FUNCIONES ANTERIORES (se mantienen)
// =========================================
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
    } catch (error) { return ''; }
}

async function obtenerContenidoCurricular(materia) {
    if (!materia) return '';
    const materiaKey = materia.toLowerCase().replace(/ /g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const docSnap = await db.collection('contenidos_curriculares').doc(materiaKey).get();
    return docSnap.exists ? docSnap.data().texto : '';
}

function buscarFragmentosRelevantes(texto, tema, max = 5) {
    if (!texto || !tema) return '';
    const palabras = tema.toLowerCase().split(' ').filter(p => p.length > 3);
    const parrafos = texto.split(/\n\s*\n/).filter(p => p.trim().length > 50);
    const puntuados = parrafos.map(p => {
        let score = 0;
        palabras.forEach(w => { const regex = new RegExp(w, 'g'); score += (p.match(regex) || []).length; });
        return { texto: p.trim(), score };
    });
    puntuados.sort((a, b) => b.score - a.score);
    return puntuados.slice(0, max).map(p => p.texto.substring(0, 600)).join('\n\n');
}

function generarPlanificacionProfesional(datos, textoArchivo, contenidoCurricular) {
    const { materia, nivel, tema, jurisdiccion, tipo } = datos;
    let fragmentos = '';
    if (textoArchivo) fragmentos = buscarFragmentosRelevantes(textoArchivo, tema);
    if (!fragmentos && contenidoCurricular) fragmentos = buscarFragmentosRelevantes(contenidoCurricular, tema);
    return {
        fundamentacion: `<p>La enseñanza de <strong>${tema}</strong> en <strong>${materia}</strong> es fundamental según el Diseño Curricular de ${jurisdiccion}. ${fragmentos ? '<p>"' + fragmentos.substring(0, 500) + '"</p>' : ''}</p>`,
        objetivos: `<ul><li>Comprender conceptos de ${tema}.</li><li>Aplicar procedimientos de ${materia}.</li><li>Desarrollar actitudes de cooperación.</li></ul>`,
        contenidos: `<p><strong>Conceptuales:</strong> ${tema}.</p><p><strong>Procedimentales:</strong> Resolución de problemas.</p><p><strong>Actitudinales:</strong> Valoración del trabajo.</p>`,
        estrategias: `<ul><li>ABP</li><li>Trabajo colaborativo</li><li>Exposición dialogada</li></ul>`,
        evaluacion: `<p>Criterios: conceptual, procedimental, actitudinal.</p><p>Instrumentos: observación, pruebas, rúbricas.</p>`
    };
}

exports.generatePlan = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { materia, nivel, tema, jurisdiccion, tipo, archivoBase64, archivoMimeType } = data;
    if (!materia || !nivel || !tema) throw new functions.https.HttpsError('invalid-argument', 'Faltan datos.');
    let textoArchivo = '';
    if (archivoBase64 && archivoMimeType) textoArchivo = await extractTextFromBase64(archivoBase64, archivoMimeType);
    const contenido = await obtenerContenidoCurricular(materia);
    return generarPlanificacionProfesional({ materia, nivel, tema, jurisdiccion, tipo }, textoArchivo, contenido);
});

exports.uploadContenidoCurricular = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { materia, texto } = data;
    if (!materia || !texto) throw new functions.https.HttpsError('invalid-argument', 'Faltan datos.');
    const key = materia.toLowerCase().replace(/ /g, '_').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    await db.collection('contenidos_curriculares').doc(key).set({ materia, texto, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { success: true };
});

exports.generateRubric = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { materia, tema, criterios } = data;
    return {
        criterios: criterios.map(c => ({
            nombre: c,
            niveles: ['Excelente', 'Muy Bueno', 'Bueno', 'Regular'].map((n, i) => ({ nivel: n, puntaje: 10 - i * 2, descripcion: `${n} en ${c}` }))
        }))
    };
});

exports.generateShareLink = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { planificacionId, method } = data;
    const uid = context.auth.uid;
    const doc = await db.collection('users').doc(uid).collection('planificaciones').doc(planificacionId).get();
    if (!doc.exists) throw new functions.https.HttpsError('not-found', 'No encontrada.');
    const p = doc.data();
    return { shareText: method === 'whatsapp' ? `*${p.materia} - ${p.tema}*\n${p.colegio}\nGenerada con PlanificAR` : `Planificación de ${p.materia} - ${p.tema}` };
});

exports.getUserStats = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const uid = context.auth.uid;
    const plans = await db.collection('users').doc(uid).collection('planificaciones').get();
    const events = await db.collection('users').doc(uid).collection('events').get();
    const materias = {};
    plans.forEach(d => { const m = d.data().materia; materias[m] = (materias[m] || 0) + 1; });
    return { totalPlans: plans.size, totalEvents: events.size, topMaterias: Object.entries(materias).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, c]) => ({ nombre: n, count: c })) };
});

exports.syncEventToGoogleCalendar = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    return { success: true, message: 'Sincronización simulada (requiere OAuth configurado).' };
});

exports.createRecurringEvent = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const { eventData, recurrence } = data;
    const uid = context.auth.uid;
    const created = [];
    const base = new Date(eventData.year, eventData.month - 1, eventData.day);
    for (let i = 0; i < recurrence.count; i++) {
        const d = new Date(base);
        if (recurrence.type === 'weekly') d.setDate(base.getDate() + i * 7);
        else if (recurrence.type === 'monthly') d.setMonth(base.getMonth() + i);
        else d.setFullYear(base.getFullYear() + i);
        const ref = await db.collection('users').doc(uid).collection('events').add({
            day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear(),
            type: eventData.type, name: eventData.name, imp: eventData.imp, color: eventData.color,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        created.push({ id: ref.id });
    }
    return { success: true, events: created };
});

exports.getResourceLibrary = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const snapshot = await db.collection('recursos').get();
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
});

exports.uploadResource = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const ref = await db.collection('recursos').add({ ...data, uploadedBy: context.auth.uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return { id: ref.id };
});

exports.createWeeklyBackup = functions.pubsub.schedule('0 0 * * 0').onRun(async (context) => {
    const users = await db.collection('users').get();
    for (const u of users.docs) {
        const events = await db.collection('users').doc(u.id).collection('events').get();
        const plans = await db.collection('users').doc(u.id).collection('planificaciones').get();
        await db.collection('users').doc(u.id).collection('backups').add({
            events: events.docs.map(d => d.data()),
            planificaciones: plans.docs.map(d => d.data()),
            backupDate: admin.firestore.FieldValue.serverTimestamp()
        });
    }
});

exports.getWeeklyProductivity = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const uid = context.auth.uid;
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const plans = await db.collection('users').doc(uid).collection('planificaciones').where('createdAt', '>=', weekAgo).get();
    const events = await db.collection('users').doc(uid).collection('events').where('createdAt', '>=', weekAgo).get();
    return { plansThisWeek: plans.size, eventsThisWeek: events.size };
});

exports.generateYearBackup = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debe iniciar sesión.');
    const uid = context.auth.uid;
    const year = data.year || new Date().getFullYear();
    const plans = await db.collection('users').doc(uid).collection('planificaciones').where('year', '==', year).get();
    return { year, plans: plans.docs.map(d => ({ id: d.id, ...d.data() })) };
});