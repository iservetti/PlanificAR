// =========================================
// STORAGE MANAGER (encapsula Firestore)
// =========================================
const StorageManager = {
    db: null,
    init(dbInstance) { this.db = dbInstance; },
    async getUser(uid) {
        const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        return await getDoc(doc(this.db, "users", uid));
    },
    async saveUser(uid, data) {
        const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        return await setDoc(doc(this.db, "users", uid), data, { merge: true });
    },
    async loadEvents(uid) {
        const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        const snapshot = await getDocs(collection(this.db, "users", uid, "events"));
        const events = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const dateKey = `${data.day}-${data.month}-${data.year}`;
            if (!events[dateKey]) events[dateKey] = [];
            events[dateKey].push({ id: doc.id, ...data });
        });
        return events;
    },
    async addEvent(uid, eventData) {
        const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        return await addDoc(collection(this.db, "users", uid, "events"), { ...eventData, createdAt: serverTimestamp() });
    },
    async updateEvent(uid, eventId, newData) {
        const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        return await updateDoc(doc(this.db, "users", uid, "events", eventId), newData);
    },
    async deleteEvent(uid, eventId) {
        const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        return await deleteDoc(doc(this.db, "users", uid, "events", eventId));
    },
    async addPlanificacion(uid, data) {
        const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        return await addDoc(collection(this.db, "users", uid, "planificaciones"), { ...data, createdAt: serverTimestamp() });
    }
};

// =========================================
// FIREBASE
// =========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyAYyYcI6lA5g_BPr54LJyklO5sXVX9LWpU",
    authDomain: "planificar-arg.firebaseapp.com",
    projectId: "planificar-arg",
    storageBucket: "planificar-arg.firebasestorage.app",
    messagingSenderId: "93716013797",
    appId: "1:93716013797:web:c864f875ddd9395402aa0c",
    measurementId: "G-CY095QXHD9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const provider = new GoogleAuthProvider();
StorageManager.init(db);

// =========================================
// ESTADO GLOBAL
// =========================================
let currentPlan = 'inicial';
let isUserLoggedIn = false;
let trialEndDate = null;
const TRIAL_DAYS = 3;
const WHATSAPP_NUMBER = "5492215555704";

const landingPage = document.getElementById('landingPage');
const appContent = document.getElementById('appContent');
const landingLoginBtn = document.getElementById('landingLoginBtn');
const appLogoutBtn = document.getElementById('appLogoutBtn');
const trialBanner = document.getElementById('trialBanner');

// =========================================
// AUTENTICACIÓN
// =========================================
async function initAuth() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            isUserLoggedIn = true;
            localStorage.setItem('userEmail', user.email);
            localStorage.setItem('userUid', user.uid);
            landingPage.style.display = 'none';
            appContent.style.display = 'block';
            await loadUserData(user.uid);
        } else {
            isUserLoggedIn = false;
            trialEndDate = null;
            currentPlan = 'inicial';
            landingPage.style.display = 'flex';
            appContent.style.display = 'none';
            updatePlanUI();
            updateTrialBanner();
            updateGenerateButtonState();
        }
    });

    landingLoginBtn.addEventListener('click', async () => {
        try { await signInWithPopup(auth, provider); }
        catch (error) { alert('Error al iniciar sesión: ' + error.message); }
    });

    appLogoutBtn.addEventListener('click', async () => { await signOut(auth); });
}

async function loadUserData(uid) {
    try {
        const docSnap = await StorageManager.getUser(uid);
        const now = new Date();
        if (docSnap.exists()) {
            const data = docSnap.data();
            currentPlan = data.plan || 'inicial';
            if (data.trialEnd) {
                trialEndDate = data.trialEnd.toDate ? data.trialEnd.toDate() : new Date(data.trialEnd);
            } else if (data.createdAt) {
                const createdAt = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
                trialEndDate = new Date(createdAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
                await StorageManager.saveUser(uid, { trialEnd: trialEndDate });
            }
        } else {
            trialEndDate = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
            currentPlan = 'inicial';
            await StorageManager.saveUser(uid, {
                email: auth.currentUser.email, plan: 'inicial',
                createdAt: serverTimestamp(), trialEnd: trialEndDate
            });
        }
        const isTrialActive = trialEndDate && now <= trialEndDate;
        const hasPaidPlan = currentPlan !== 'inicial';
        toggleFeatures(isTrialActive || hasPaidPlan);
    } catch (error) {
        console.error("Error cargando datos:", error);
        currentPlan = 'inicial';
        toggleFeatures(false);
    }
    localStorage.setItem('plan', currentPlan);
    updatePlanUI();
    updateTrialBanner();
    updateGenerateButtonState();
    await renderCalendar();
}

function toggleFeatures(enable) {
    const btn = document.getElementById('btnGenerate');
    if (btn) btn.disabled = !enable;
}

function updateGenerateButtonState() {
    const btn = document.getElementById('btnGenerate');
    if (btn) btn.disabled = false; // ← forzamos habilitado para pruebas
}

function updateTrialBanner() {
    if (!trialBanner || !isUserLoggedIn) { trialBanner.style.display = 'none'; return; }
    const now = new Date();
    if (trialEndDate && now <= trialEndDate && currentPlan === 'inicial') {
        const diff = trialEndDate - now;
        const hoursLeft = Math.ceil(diff / (1000 * 60 * 60));
        trialBanner.style.display = 'block';
        if (hoursLeft <= 24) {
            trialBanner.classList.add('urgent');
            trialBanner.innerHTML = `⏰ <strong>¡Tu prueba termina hoy!</strong> No pierdas tus datos, elegí un plan ahora.`;
        } else {
            trialBanner.classList.remove('urgent');
            const daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));
            trialBanner.innerHTML = `🎁 Te quedan <strong>${daysLeft} día(s)</strong> de prueba gratuita. Después, elegí un plan para seguir usando PlanificAR.`;
        }
    } else if (trialEndDate && now > trialEndDate && currentPlan === 'inicial') {
        trialBanner.classList.add('urgent');
        trialBanner.style.display = 'block';
        trialBanner.innerHTML = `⏰ Tu prueba gratuita finalizó. <strong>Elegí un plan pago</strong> para continuar.`;
    } else {
        trialBanner.style.display = 'none';
    }
}

// =========================================
// PLANES Y CONTACTO
// =========================================
function contactWhatsApp(plan) {
    const planNames = { maestro: 'Plan Maestro', profesor: 'Plan Profesor' };
    const message = `Hola, quiero contratar el ${planNames[plan]}. ¿Me pueden ayudar?`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank');
}

async function setPlan(plan) {
    if (plan === currentPlan) return;
    const planNames = { inicial: 'Plan Inicial', maestro: 'Plan Maestro', profesor: 'Plan Profesor' };
    currentPlan = plan;
    localStorage.setItem('plan', plan);
    const uid = localStorage.getItem('userUid');
    if (uid) {
        try { await StorageManager.saveUser(uid, { plan: plan }); }
        catch (error) { console.error("Error guardando plan:", error); }
    }
    alert(`✅ Cambiaste a ${planNames[plan]}.`);
    updatePlanUI();
    updateTrialBanner();
    updateGenerateButtonState();
}

function isPlanSufficient(requiredPlan) {
    const planOrder = { inicial: 0, maestro: 1, profesor: 2 };
    return planOrder[currentPlan] >= planOrder[requiredPlan];
}

function updatePlanUI() {
    document.querySelectorAll('.plan-card').forEach(card => {
        const planId = card.dataset.plan;
        const button = card.querySelector('.plan-btn');
        if (planId === currentPlan) {
            card.classList.add('active-plan');
            button.textContent = '✓ Actual';
            button.className = planId === 'inicial' ? 'plan-btn btn-outline' : 'plan-btn btn-filled';
        } else {
            card.classList.remove('active-plan');
            button.textContent = planId === 'inicial' ? 'Elegir' : 'Contratar';
            button.className = planId === 'inicial' ? 'plan-btn btn-outline' : 'plan-btn btn-filled';
        }
    });
    document.querySelectorAll('#headerPlanBadges .plan-badge-new').forEach(badge => {
        badge.classList.toggle('active-header', badge.dataset.plan === currentPlan);
    });
    const tipRecursos = document.getElementById('tipRecursos');
    if (tipRecursos) tipRecursos.style.display = (currentPlan === 'profesor') ? 'none' : '';
    document.querySelectorAll('[data-min-plan]').forEach(el => {
        const required = el.dataset.minPlan;
        el.classList.toggle('locked', !isPlanSufficient(required));
    });
}

function handleRestrictedClick(action) { alert('🔒 Esta función está disponible a partir del Plan Maestro.'); }

// =========================================
// MANEJO DE ARCHIVO ADJUNTO (PDF/DOC)
// =========================================
let archivoProgramaSeleccionado = null;

function toggleAdjuntarArchivo() {
    const chk = document.getElementById('chkAdjuntarArchivo');
    const field = document.getElementById('archivoProgramaField');
    const infoIA = document.getElementById('infoIA');
    if (chk.checked) {
        field.classList.add('show');
        infoIA.style.display = 'block';
        document.getElementById('jurisdiccionIA').textContent = document.getElementById('jurisdiccion').value || 'tu provincia';
        document.getElementById('nivelIA').textContent = document.getElementById('nivel').value || 'tu nivel';
        document.getElementById('chkProgramaPropio').checked = false;
        document.getElementById('programaPropioField').classList.remove('show');
    } else {
        field.classList.remove('show');
        archivoProgramaSeleccionado = null;
        document.getElementById('fileInfo').textContent = '';
        if (!document.getElementById('chkProgramaPropio').checked) {
            infoIA.style.display = 'none';
        }
    }
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
        alert('El archivo es demasiado grande. Máximo 50 MB.');
        event.target.value = '';
        return;
    }
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
        alert('Formato no soportado. Usá PDF o Word (.doc, .docx).');
        event.target.value = '';
        return;
    }
    archivoProgramaSeleccionado = file;
    document.getElementById('fileInfo').innerHTML = `✅ Archivo seleccionado: <strong>${file.name}</strong> (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
}

// =========================================
// WIZARD
// =========================================
let currentStep = 1;
const totalSteps = 4;

function updateCicloOptions() {
    const nivel = document.getElementById('nivel').value;
    const cicloSelect = document.getElementById('ciclo');
    const cicloGroup = document.getElementById('cicloGroup');
    const anioGroup = document.getElementById('anioGroup');
    cicloSelect.innerHTML = '<option value="">Seleccionar...</option>';
    document.getElementById('anio').innerHTML = '<option value="">Primero seleccioná el ciclo</option>';
    if (!nivel) { cicloGroup.style.display = 'none'; anioGroup.style.display = 'none'; return; }
    cicloGroup.style.display = 'flex';
    if (nivel === 'Primario') cicloSelect.innerHTML += `<option value="1Ciclo">1° Ciclo (1°,2°,3°)</option><option value="2Ciclo">2° Ciclo (4°,5°,6°)</option>`;
    else if (nivel === 'Secundario') cicloSelect.innerHTML += `<option value="Basico">Ciclo Básico (1°,2°,3°)</option><option value="Orientado">Ciclo Orientado (4°,5°,6°)</option>`;
    else if (nivel === 'Inicial') cicloSelect.innerHTML += '<option value="Sala">Salas (3,4,5 años)</option>';
    else cicloGroup.style.display = 'none';
}

function updateAnioOptions() {
    const nivel = document.getElementById('nivel').value;
    const ciclo = document.getElementById('ciclo').value;
    const anioSelect = document.getElementById('anio');
    const anioGroup = document.getElementById('anioGroup');
    if (!ciclo) { anioGroup.style.display = 'none'; return; }
    anioGroup.style.display = 'flex';
    anioSelect.innerHTML = '<option value="">Seleccionar...</option>';
    if (nivel === 'Primario') { const anios = ciclo === '1Ciclo' ? ['1°','2°','3°'] : ['4°','5°','6°']; anios.forEach(a => anioSelect.innerHTML += `<option value="${a}">${a} Grado</option>`); }
    else if (nivel === 'Secundario') { const anios = ciclo === 'Basico' ? ['1°','2°','3°'] : ['4°','5°','6°']; anios.forEach(a => anioSelect.innerHTML += `<option value="${a}">${a} Año</option>`); }
    else if (nivel === 'Inicial') { ['3','4','5'].forEach(a => anioSelect.innerHTML += `<option value="${a}">${a} Años</option>`); }
}

function toggleProgramaPropio() {
    const chk = document.getElementById('chkProgramaPropio');
    const field = document.getElementById('programaPropioField');
    const infoIA = document.getElementById('infoIA');
    if (!chk) return;
    if (chk.checked) {
        field.classList.add('show');
        infoIA.style.display = 'block';
        document.getElementById('jurisdiccionIA').textContent = document.getElementById('jurisdiccion').value || 'tu provincia';
        document.getElementById('nivelIA').textContent = document.getElementById('nivel').value || 'tu nivel';
        document.getElementById('chkAdjuntarArchivo').checked = false;
        document.getElementById('archivoProgramaField').classList.remove('show');
        archivoProgramaSeleccionado = null;
        document.getElementById('fileInfo').textContent = '';
    } else {
        field.classList.remove('show');
        if (!document.getElementById('chkAdjuntarArchivo').checked) {
            infoIA.style.display = 'none';
        }
    }
}

function changeStep(direction) {
    if (direction === 1 && !validateStep(currentStep)) { alert('Por favor completá los campos obligatorios (*) antes de continuar'); return; }
    document.querySelector(`.wizard-step[data-step="${currentStep}"]`).classList.remove('active');
    document.querySelector(`.step-indicator[data-step="${currentStep}"]`).classList.remove('active');
    document.querySelector(`.step-indicator[data-step="${currentStep}"]`).classList.add('completed');
    currentStep += direction;
    document.querySelector(`.wizard-step[data-step="${currentStep}"]`).classList.add('active');
    document.querySelector(`.step-indicator[data-step="${currentStep}"]`).classList.add('active');
    if (direction === 1) document.querySelector(`.step-indicator[data-step="${currentStep - 1}"] ~ .step-connector`).classList.add('completed');
    document.getElementById('btnPrev').style.visibility = currentStep === 1 ? 'hidden' : 'visible';
    if (currentStep === totalSteps) { document.getElementById('btnNext').style.display = 'none'; document.getElementById('btnGenerate').style.display = 'inline-flex'; }
    else { document.getElementById('btnNext').style.display = 'inline-flex'; document.getElementById('btnGenerate').style.display = 'none'; }
    document.querySelector('.wizard-container').scrollIntoView({ behavior: 'smooth' });
}

function validateStep(step) {
    if (step === 1) return document.getElementById('jurisdiccion').value && document.getElementById('nivel').value;
    if (step === 2) return document.getElementById('colegio').value && document.getElementById('materia').value && document.getElementById('curso').value;
    if (step === 3) return document.getElementById('tema').value;
    return true;
}

// =========================================
// LLAMADA A LA CLOUD FUNCTION (back-end interno)
// =========================================
async function generatePlanWithAI(data) {
    try {
        const generatePlan = httpsCallable(functions, 'generatePlan');
        const result = await generatePlan(data);
        return result.data;
    } catch (error) {
        console.error('Error al llamar a la Cloud Function:', error);
        return null;
    }
}

// =========================================
// GENERAR PLANIFICACIÓN (con fallback)
// =========================================
async function generatePlanning() {
    if (!isPlanSufficient('inicial')) { alert('🔒 Tu plan no permite generar planificaciones. Actualizá tu plan.'); return; }
    if (!document.getElementById('tipoPlanificacion').value) { alert('Seleccioná el tipo de planificación'); return; }
    document.getElementById('previewColegio').textContent = document.getElementById('colegio').value;
    document.getElementById('previewJurisdiccion').textContent = document.getElementById('jurisdiccion').value;
    document.getElementById('previewNivel').textContent = document.getElementById('nivel').value;
    document.getElementById('previewAnio').textContent = document.getElementById('anio').value;
    document.getElementById('previewMateria').textContent = document.getElementById('materia').value;
    document.getElementById('previewCurso').textContent = document.getElementById('curso').value;
    document.getElementById('previewCarga').textContent = document.getElementById('cargaHoraria').value || '-';
    document.getElementById('previewTema').textContent = document.getElementById('tema').value;
    const previewSection = document.getElementById('previewSection');
    previewSection.style.display = 'block';
    document.getElementById('loadingOverlay').classList.add('active');

    const formData = {
        materia: document.getElementById('materia').value,
        nivel: document.getElementById('nivel').value,
        tema: document.getElementById('tema').value,
        jurisdiccion: document.getElementById('jurisdiccion').value,
        tipo: document.getElementById('tipoPlanificacion').value
    };

    // Si hay archivo adjunto, convertirlo a base64 para enviar al backend
    if (archivoProgramaSeleccionado) {
        const reader = new FileReader();
        reader.onload = async function() {
            const base64 = reader.result.split(',')[1];
            formData.archivoBase64 = base64;
            formData.archivoMimeType = archivoProgramaSeleccionado.type;
            await processPlanning(formData);
        };
        reader.readAsDataURL(archivoProgramaSeleccionado);
    } else {
        await processPlanning(formData);
    }
}

async function processPlanning(formData) {
    // Intentar usar la Cloud Function (back-end interno)
    let planData = null;
    if (isUserLoggedIn) {
        planData = await generatePlanWithAI(formData);
    }

    document.getElementById('loadingOverlay').classList.remove('active');

    if (planData) {
        document.getElementById('previewFundamentacion').innerHTML = planData.fundamentacion;
        document.getElementById('previewObjetivos').innerHTML = planData.objetivos;
        document.getElementById('previewContenidos').innerHTML = planData.contenidos;
        document.getElementById('previewEstrategias').innerHTML = planData.estrategias;
        document.getElementById('previewEvaluacion').innerHTML = planData.evaluacion;
    } else {
        // Fallback a simulación enriquecida (cuando el backend no está disponible)
        await simulateAIContent();
    }

    const uid = localStorage.getItem('userUid');
    if (uid) {
        await StorageManager.addPlanificacion(uid, {
            colegio: document.getElementById('colegio').value,
            jurisdiccion: document.getElementById('jurisdiccion').value,
            nivel: document.getElementById('nivel').value,
            materia: document.getElementById('materia').value,
            tema: document.getElementById('tema').value,
            tipo: document.getElementById('tipoPlanificacion').value
        });
    }
    document.getElementById('previewSection').scrollIntoView({ behavior: 'smooth' });
}

// =========================================
// SIMULACIÓN ENRIQUECIDA (fallback)
// =========================================
async function simulateAIContent() {
    const materia = document.getElementById('materia').value;
    const nivel = document.getElementById('nivel').value;
    const tema = document.getElementById('tema').value;
    const jurisdiccion = document.getElementById('jurisdiccion').value;
    
    const contenidoCurricular = await obtenerContenidoCurricular(materia);
    let referenciaCurricular = '';
    if (contenidoCurricular) {
        const oraciones = contenidoCurricular.match(/[^.!?]+[.!?]+/g) || [];
        const fragmentosRelevantes = oraciones
            .filter(o => o.toLowerCase().includes(tema.toLowerCase().substring(0, 4)))
            .slice(0, 3)
            .join(' ');
        referenciaCurricular = fragmentosRelevantes || contenidoCurricular.substring(0, 500);
    }
    if (archivoProgramaSeleccionado) {
        referenciaCurricular += ` [Análisis profundo del archivo "${archivoProgramaSeleccionado.name}" - ${(archivoProgramaSeleccionado.size / 1024 / 1024).toFixed(1)} MB procesado] `;
    }

    let fundamentacion = `La enseñanza de <strong>${tema}</strong> en el área de <strong>${materia}</strong> resulta fundamental para el desarrollo integral del alumno, en concordancia con el Diseño Curricular de la Provincia de <strong>${jurisdiccion}</strong>. `;
    if (referenciaCurricular) fundamentacion += `Según el diseño curricular vigente: "${referenciaCurricular}". `;
    fundamentacion += `Esta planificación busca que el estudiante construya significados a partir de sus saberes previos, favoreciendo el pensamiento crítico y la resolución de problemas en situaciones reales.`;
    document.getElementById('previewFundamentacion').innerHTML = fundamentacion;

    let objetivos = '<ul>';
    objetivos += `<li><strong>Comprender</strong> los conceptos fundamentales relacionados con ${tema}, reconociendo su aplicación en situaciones cotidianas y escolares.</li>`;
    objetivos += `<li><strong>Aplicar</strong> procedimientos y técnicas propias de ${materia} en la resolución de problemas, utilizando lenguaje específico del área.</li>`;
    objetivos += `<li><strong>Desarrollar</strong> actitudes de responsabilidad, cooperación y respeto en el trabajo grupal, valorando la diversidad de pensamiento.</li>`;
    if (nivel === 'Primario') objetivos += `<li><strong>Utilizar</strong> el lenguaje de manera efectiva para comunicar ideas y resultados.</li>`;
    objetivos += '</ul>';
    document.getElementById('previewObjetivos').innerHTML = objetivos;

    let contenidos = `<p><strong>Conceptuales:</strong> ${tema}, sus propiedades, clasificación y características principales según el marco teórico vigente en el Diseño Curricular de ${jurisdiccion}.</p>`;
    contenidos += `<p><strong>Procedimentales:</strong> Resolución de problemas, análisis de casos, producción de textos o construcciones prácticas (según la materia). Uso de herramientas digitales y analógicas para la exploración de conceptos.</p>`;
    contenidos += `<p><strong>Actitudinales:</strong> Valoración del trabajo intelectual, interés por la indagación, participación activa y respeto por las normas de trabajo en el aula.</p>`;
    document.getElementById('previewContenidos').innerHTML = contenidos;

    let estrategias = `<p>Se implementarán estrategias activas centradas en el estudiante, promoviendo la participación y el aprendizaje significativo:</p><ul>`;
    estrategias += `<li><strong>Aprendizaje Basado en Problemas (ABP):</strong> Presentación de situaciones problemáticas contextualizadas que permitan activar saberes previos y construir nuevos conocimientos.</li>`;
    estrategias += `<li><strong>Trabajo Colaborativo:</strong> Producción grupal con roles asignados, debates guiados y puesta en común de resultados.</li>`;
    estrategias += `<li><strong>Exposición Dialogada:</strong> Espacios de intercambio donde los estudiantes expongan sus conclusiones y reciban retroalimentación.</li>`;
    estrategias += `<li><strong>Uso de TIC:</strong> Incorporación de herramientas digitales para la investigación y presentación de trabajos.</li></ul>`;
    document.getElementById('previewEstrategias').innerHTML = estrategias;

    let evaluacion = `<p><strong>Criterios de evaluación:</strong></p><ul>`;
    evaluacion += `<li>Apropiación de los contenidos conceptuales trabajados.</li>`;
    evaluacion += `<li>Correcta aplicación de procedimientos y técnicas propias del área.</li>`;
    evaluacion += `<li>Predisposición para el aprendizaje y participación en las actividades propuestas.</li>`;
    evaluacion += `<li>Capacidad para trabajar en equipo y respetar las opiniones de los demás.</li>`;
    evaluacion += `</ul><p><strong>Instrumentos:</strong> Observación directa, registros anecdóticos, pruebas escritas, producciones orales/gráficas y rúbricas de evaluación.</p>`;
    evaluacion += `<p>Se priorizará la <strong>evaluación formativa y procesual</strong> durante todo el desarrollo de la unidad, permitiendo ajustes en la enseñanza según las necesidades detectadas.</p>`;
    document.getElementById('previewEvaluacion').innerHTML = evaluacion;
}

async function obtenerContenidoCurricular(materia) {
    if (!materia) return '';
    try {
        const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        const materiaKey = materia.toLowerCase().replace(/ /g, '_').replace(/[áéíóú]/g, 'a');
        const docRef = doc(db, "contenidos_curriculares", materiaKey);
        const docSnap = await getDoc(docRef);
        return docSnap.exists ? docSnap.data().texto : '';
    } catch (error) {
        console.error("Error al obtener contenido curricular:", error);
        return '';
    }
}

// =========================================
// CALENDARIO
// =========================================
const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
let currentMonth = new Date().getMonth(), currentYear = new Date().getFullYear();
let userEvents = {}, holidays = {}, holidayCache = {}, selectedEventColor = 'var(--event-exam)';

async function fetchHolidays(year) {
    if (holidayCache[year]) return holidayCache[year];
    try {
        const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/AR`);
        const data = await response.json();
        const holidayMap = {};
        data.forEach(h => {
            const date = new Date(h.date);
            holidayMap[`${date.getDate()}-${date.getMonth() + 1}`] = h.localName;
        });
        holidayCache[year] = holidayMap;
        return holidayMap;
    } catch (e) { return {}; }
}

async function loadUserEvents() {
    const uid = localStorage.getItem('userUid');
    if (!uid) return;
    userEvents = await StorageManager.loadEvents(uid);
    checkReminders();
}

function checkReminders() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const today = new Date();
    const reminderDate = new Date(today);
    reminderDate.setDate(today.getDate() + 3);
    Object.values(userEvents).flat().forEach(evt => {
        if (!evt.imp) return;
        const evtDate = new Date(evt.year, evt.month-1, evt.day);
        if (evtDate.toDateString() === reminderDate.toDateString()) {
            new Notification("Recordatorio PlanificAR", { body: `Faltan 3 días para: ${evt.name}` });
        }
    });
}

// Modal
let selectedDate = null;
const eventModal = document.getElementById('eventModal');
const modalTitle = document.getElementById('modalTitle');
const modalEventType = document.getElementById('modalEventType');
const modalEventName = document.getElementById('modalEventName');
const modalEventImportant = document.getElementById('modalEventImportant');
const saveEventBtn = document.getElementById('saveEventBtn');
const colorPicker = document.getElementById('colorPicker');

colorPicker.addEventListener('click', (e) => {
    if (e.target.classList.contains('color-option')) {
        document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
        e.target.classList.add('selected');
        selectedEventColor = e.target.dataset.color;
    }
});

function openEventModal(day, month, year) {
    selectedDate = { day, month, year };
    modalTitle.textContent = `Nuevo evento - ${day}/${month+1}/${year}`;
    modalEventType.value = 'Evento';
    modalEventName.value = '';
    modalEventImportant.checked = false;
    selectedEventColor = 'var(--event-exam)';
    document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
    document.querySelector('.color-option[data-color="var(--event-exam)"]').classList.add('selected');
    eventModal.classList.add('show');
}

function closeEventModal() {
    eventModal.classList.remove('show');
    setTimeout(() => { selectedDate = null; }, 300);
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && eventModal.classList.contains('show')) closeEventModal(); });
eventModal.addEventListener('click', (e) => { if (e.target === eventModal) closeEventModal(); });

saveEventBtn.addEventListener('click', async () => {
    if (!selectedDate) return;
    const uid = localStorage.getItem('userUid');
    if (!uid) return;
    const eventData = {
        day: selectedDate.day, month: selectedDate.month + 1, year: selectedDate.year,
        type: modalEventType.value, name: modalEventName.value || 'Sin título',
        imp: modalEventImportant.checked, color: selectedEventColor
    };
    try {
        await StorageManager.addEvent(uid, eventData);
        closeEventModal();
        await loadUserEvents();
        await renderCalendar();
        if (modalEventImportant.checked && "Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
    } catch (error) { alert('Error al guardar el evento.'); }
});

async function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    if (!grid) return;
    let htmlBuffer = '';
    ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].forEach(d => htmlBuffer += `<div class="day-name">${d}</div>`);
    document.getElementById('displayMonthName').textContent = monthNames[currentMonth];
    document.getElementById('displayYear').textContent = currentYear;
    holidays = await fetchHolidays(currentYear);
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    let startDay = firstDay === 0 ? 6 : firstDay - 1;
    for (let i = 0; i < startDay; i++) htmlBuffer += '<div class="calendar-day empty"></div>';
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const dayOfWeek = new Date(currentYear, currentMonth, day).getDay();
        const dateKey = `${day}-${currentMonth+1}-${currentYear}`;
        const holidayKey = `${day}-${currentMonth+1}`;
        let content = `<div style="font-weight:600; margin-bottom:2px;">${day}</div>`;
        if (userEvents[dateKey]) {
            userEvents[dateKey].forEach(evt => {
                content += `<div class="event-tag-cell" draggable="true" data-id="${evt.id}" style="background: ${evt.color || 'var(--event-exam)'}">${evt.name}</div>`;
            });
        }
        let classes = 'calendar-day';
        if (!userEvents[dateKey]) classes += ' skeleton';
        if (today.getDate() === day && today.getMonth() === currentMonth && today.getFullYear() === currentYear) classes += ' today';
        if (dayOfWeek === 0 || dayOfWeek === 6) classes += ' weekend';
        if (holidays[holidayKey]) { classes += ' holiday'; content += '<div style="font-size:0.65rem; color:#6A5ACD;">🇷 Feriado</div>'; }
        htmlBuffer += `<div class="${classes}" data-date="${dateKey}">${content}</div>`;
    }
    grid.innerHTML = htmlBuffer;
    document.querySelectorAll('.calendar-day.skeleton').forEach(cell => cell.classList.remove('skeleton'));

    document.querySelectorAll('.calendar-day:not(.empty)').forEach(cell => {
        cell.addEventListener('click', (e) => {
            if (e.target.classList.contains('event-tag-cell')) return;
            const [d, m, y] = cell.dataset.date.split('-').map(Number);
            openEventModal(d, m-1, y);
        });
        cell.addEventListener('dragover', e => e.preventDefault());
        cell.addEventListener('drop', async (e) => {
            e.preventDefault();
            const eventId = e.dataTransfer.getData('text/plain');
            if (!eventId) return;
            const uid = localStorage.getItem('userUid');
            const oldDate = e.dataTransfer.getData('date').split('-');
            const newDate = cell.dataset.date.split('-');
            if (oldDate[0] === newDate[0] && oldDate[1] === newDate[1] && oldDate[2] === newDate[2]) return;
            try {
                await StorageManager.updateEvent(uid, eventId, {
                    day: parseInt(newDate[0]), month: parseInt(newDate[1]), year: parseInt(newDate[2])
                });
                await loadUserEvents();
                await renderCalendar();
            } catch (error) {
                alert('Error de conexión, no se pudo mover el evento.');
                await loadUserEvents();
                await renderCalendar();
            }
        });
    });

    document.querySelectorAll('.event-tag-cell').forEach(tag => {
        tag.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', tag.dataset.id);
            e.dataTransfer.setData('date', tag.closest('.calendar-day').dataset.date);
        });
    });

    updateWeeklyAgenda();
    updateSearchResults();
}

// Buscador
const searchInput = document.getElementById('searchEvents');
const searchResults = document.getElementById('searchResults');
searchInput.addEventListener('input', updateSearchResults);

function updateSearchResults() {
    const query = searchInput.value.toLowerCase();
    if (!query) { searchResults.style.display = 'none'; return; }
    const results = [];
    Object.entries(userEvents).forEach(([dateKey, events]) => {
        events.forEach(evt => {
            if (evt.name.toLowerCase().includes(query) || evt.type.toLowerCase().includes(query)) {
                results.push({ ...evt, date: dateKey });
            }
        });
    });
    searchResults.innerHTML = results.length ? results.map(r => `<div onclick="goToDate('${r.date}')">📅 ${r.date} - ${r.name} (${r.type})</div>`).join('') : '<div>No se encontraron eventos.</div>';
    searchResults.style.display = 'block';
}

window.goToDate = function(dateKey) {
    const [day, month, year] = dateKey.split('-').map(Number);
    currentMonth = month - 1; currentYear = year;
    loadUserEvents().then(() => renderCalendar());
    document.querySelector('#calendario').scrollIntoView({ behavior: 'smooth' });
};

// Agenda
function updateWeeklyAgenda() {
    const list = document.getElementById('weeklyList');
    if (!list) return;
    const today = new Date();
    const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - today.getDay() + 1);
    const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6);
    const weekEvents = [];
    Object.entries(userEvents).forEach(([dateKey, events]) => {
        const [d, m, y] = dateKey.split('-').map(Number);
        const eventDate = new Date(y, m-1, d);
        if (eventDate >= startOfWeek && eventDate <= endOfWeek) {
            events.forEach(evt => weekEvents.push({ date: dateKey, ...evt }));
        }
    });
    weekEvents.sort((a,b) => new Date(a.date.split('-')[2], a.date.split('-')[1]-1, a.date.split('-')[0]) - new Date(b.date.split('-')[2], b.date.split('-')[1]-1, b.date.split('-')[0]));
    list.innerHTML = weekEvents.length ? weekEvents.map(e => `<li><span>📅 ${e.date}</span> <span style="background:${e.color||'var(--event-exam)'};padding:0 6px;border-radius:4px;">${e.name}</span></li>`).join('') : '<li>No hay eventos esta semana.</li>';
}

document.getElementById('prevMonth').addEventListener('click', async () => {
    currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    await loadUserEvents(); await renderCalendar();
});
document.getElementById('nextMonth').addEventListener('click', async () => {
    currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    await loadUserEvents(); await renderCalendar();
});
const monthSelector = document.getElementById('monthSelector');
monthNames.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.className = 'month-btn' + (i === currentMonth ? ' active' : '');
    btn.textContent = m.substring(0,3);
    btn.onclick = async () => { currentMonth = i; await loadUserEvents(); await renderCalendar(); };
    monthSelector.appendChild(btn);
});

// =========================================
// EXPORTACIONES
// =========================================
document.getElementById('exportExcelBtn').addEventListener('click', () => {
    if (!isPlanSufficient('maestro')) { alert('🔒 Esta función requiere Plan Maestro o superior.'); return; }
    const uid = localStorage.getItem('userUid');
    if (!uid) return;
    const eventsArray = [];
    Object.entries(userEvents).forEach(([dateKey, events]) => {
        events.forEach(evt => eventsArray.push({
            'Fecha': dateKey, 'Tipo': evt.type, 'Nombre': evt.name, 'Importante': evt.imp ? 'Sí' : 'No'
        }));
    });
    if (eventsArray.length === 0) { alert('No hay eventos para exportar.'); return; }
    const ws = XLSX.utils.json_to_sheet(eventsArray);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Eventos");
    XLSX.writeFile(wb, `planificar_eventos_${currentMonth+1}_${currentYear}.xlsx`);
});

function exportCalendarToPDF() {
    if (!isPlanSufficient('maestro')) { alert('🔒 Esta función requiere Plan Maestro o superior.'); return; }
    const spinner = document.getElementById('pdfSpinner');
    if (spinner) spinner.style.display = 'inline';
    setTimeout(() => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(16);
        doc.text(`Calendario - ${monthNames[currentMonth]} ${currentYear}`, 14, 20);
        let y = 30;
        const events = Object.entries(userEvents).sort(([a], [b]) => {
            const [da, ma, ya] = a.split('-').map(Number);
            const [db, mb, yb] = b.split('-').map(Number);
            return new Date(ya, ma-1, da) - new Date(yb, mb-1, db);
        });
        if (events.length === 0) {
            doc.text('No hay eventos este mes.', 14, y);
        } else {
            events.forEach(([dateKey, evts]) => {
                evts.forEach(evt => {
                    if (y > 270) { doc.addPage(); y = 20; }
                    doc.setFontSize(11);
                    doc.text(`${dateKey}: ${evt.name} (${evt.type})`, 14, y);
                    y += 7;
                });
            });
        }
        doc.save(`planificar_${currentMonth+1}_${currentYear}.pdf`);
        if (spinner) spinner.style.display = 'none';
    }, 100);
}

// =========================================
// ROUTER
// =========================================
window.addEventListener('hashchange', () => {
    const sections = ['generador', 'calendario', 'recursos', 'planes'];
    const currentHash = window.location.hash.replace('#', '') || 'generador';
    sections.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.style.display = (s === currentHash) ? '' : 'none';
    });
    document.querySelectorAll('.menu-link').forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === `#${currentHash}`);
    });
});
window.addEventListener('load', () => window.dispatchEvent(new HashChangeEvent('hashchange')));

// =========================================
// MENÚ HAMBURGUESA
// =========================================
const hamburgerBtn = document.getElementById('hamburgerBtn');
const menuLinks = document.getElementById('menuLinks');
const menuOverlay = document.getElementById('menuOverlay');
hamburgerBtn.addEventListener('click', () => {
    menuLinks.classList.toggle('show');
    menuOverlay.classList.toggle('show');
});
menuOverlay.addEventListener('click', () => {
    menuLinks.classList.remove('show');
    menuOverlay.classList.remove('show');
});
document.querySelectorAll('.menu-link').forEach(link => {
    link.addEventListener('click', () => {
        menuLinks.classList.remove('show');
        menuOverlay.classList.remove('show');
    });
});

// =========================================
// EXPONER FUNCIONES AL SCOPE GLOBAL
// =========================================
window.setPlan = setPlan;
window.contactWhatsApp = contactWhatsApp;
window.toggleProgramaPropio = toggleProgramaPropio;
window.changeStep = changeStep;
window.generatePlanning = generatePlanning;
window.closeEventModal = closeEventModal;
window.handleRestrictedClick = handleRestrictedClick;
window.exportCalendarToPDF = exportCalendarToPDF;
window.toggleAdjuntarArchivo = toggleAdjuntarArchivo;
window.handleFileSelect = handleFileSelect;

// =========================================
// INICIALIZACIÓN
// =========================================
function initApp() {
    const themeToggle = document.getElementById('themeToggle');
    const htmlElement = document.documentElement;
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        htmlElement.setAttribute('data-theme', 'dark');
        themeToggle.textContent = '☀️';
    }
    themeToggle.addEventListener('click', () => {
        const currentTheme = htmlElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        htmlElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    });
    updatePlanUI();
    updateGenerateButtonState();
    document.querySelectorAll('.resource-btn, .action-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            if (this.classList.contains('locked')) {
                e.preventDefault();
                const required = this.dataset.minPlan || 'maestro';
                const planNames = { inicial: 'Plan Inicial', maestro: 'Plan Maestro (o superior)', profesor: 'Plan Profesor' };
                alert(`🔒 Esta función requiere ${planNames[required]}. Actualizá tu plan para acceder.`);
                return;
            }
            if (this.classList.contains('btn-premium') || this.onclick) return;
            const text = this.querySelector('div div')?.textContent || '';
            if (this.classList.contains('btn-offline')) alert('🎒 Plan B Offline\n\nPreparando paquete completo de la semana...');
            else if (this.classList.contains('btn-ai')) alert('✨ Función de IA del Plan Profesor\n\nGenerando recurso inteligente...');
            else if (this.classList.contains('btn-sync') || this.closest('.action-btn')) alert('🔄 Sincronizando calendario...');
            else alert(`📤 Exportando: ${text}\n\nProcesando archivo...`);
        });
    });
    loadUserEvents().then(() => renderCalendar());
    toggleProgramaPropio();
}

initAuth();
initApp();