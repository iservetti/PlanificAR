// =========================================
// FUNCIÓN DE SANITIZACIÓN (contra XSS)
// =========================================
function sanitizarHTML(texto) {
    if (!texto) return '';
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// =========================================
// STORAGE MANAGER (sin imports dinámicos)
// =========================================
const StorageManager = {
    db: null,
    init(dbInstance) { this.db = dbInstance; },
    async getUser(uid) {
        return await getDoc(doc(this.db, "users", uid));
    },
    async saveUser(uid, data) {
        return await setDoc(doc(this.db, "users", uid), data, { merge: true });
    },
    async loadEvents(uid) {
        const snapshot = await getDocs(collection(this.db, "users", uid, "events"));
        const events = {};
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const dateKey = `${data.day}-${data.month}-${data.year}`;
            if (!events[dateKey]) events[dateKey] = [];
            events[dateKey].push({ id: docSnap.id, ...data });
        });
        return events;
    },
    async addEvent(uid, eventData) {
        return await addDoc(collection(this.db, "users", uid, "events"), { ...eventData, createdAt: serverTimestamp() });
    },
    async updateEvent(uid, eventId, newData) {
        return await updateDoc(doc(this.db, "users", uid, "events", eventId), newData);
    },
    async deleteEvent(uid, eventId) {
        return await deleteDoc(doc(this.db, "users", uid, "events", eventId));
    },
    async addPlanificacion(uid, data) {
        return await addDoc(collection(this.db, "users", uid, "planificaciones"), { ...data, createdAt: serverTimestamp() });
    }
};

// =========================================
// FIREBASE (imports estáticos completos)
// =========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
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
let ultimaPlanificacionId = null;
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
            if (data.trialEnd) trialEndDate = data.trialEnd.toDate ? data.trialEnd.toDate() : new Date(data.trialEnd);
        } else {
            trialEndDate = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
            currentPlan = 'inicial';
            await StorageManager.saveUser(uid, { email: auth.currentUser.email, plan: 'inicial', createdAt: serverTimestamp(), trialEnd: trialEndDate });
        }
        const isTrialActive = trialEndDate && now <= trialEndDate;
        const hasPaidPlan = currentPlan !== 'inicial';
        toggleFeatures(isTrialActive || hasPaidPlan);
    } catch (error) {
        console.error("Error cargando datos desde Firestore. Usando datos locales.", error);
        const savedPlan = localStorage.getItem('plan');
        currentPlan = savedPlan || 'inicial';
        trialEndDate = null;
        toggleFeatures(currentPlan !== 'inicial');
        if (trialBanner) {
            trialBanner.style.display = 'block';
            trialBanner.innerHTML = '⚠️ Error de conexión. Mostrando datos locales. Algunas funciones pueden estar limitadas.';
            trialBanner.classList.add('urgent');
        }
    }
    localStorage.setItem('plan', currentPlan);
    updatePlanUI();
    updateTrialBanner();
    updateGenerateButtonState();
    await renderCalendar();
}

function toggleFeatures(enable) { const btn = document.getElementById('btnGenerate'); if (btn) btn.disabled = !enable; }

// =========================================
// ESTADO DEL BOTÓN GENERAR (CORREGIDO)
// =========================================
function updateGenerateButtonState() {
    const btn = document.getElementById('btnGenerate');
    if (!btn) return;
    const now = new Date();
    const isTrialActive = trialEndDate && now <= trialEndDate;
    const hasPaidPlan = currentPlan !== 'inicial';
    btn.disabled = !(isTrialActive || hasPaidPlan);
}

function updateTrialBanner() {
    if (!trialBanner || !isUserLoggedIn) { trialBanner.style.display = 'none'; return; }
    const now = new Date();
    if (trialEndDate && now <= trialEndDate && currentPlan === 'inicial') {
        const diff = trialEndDate - now;
        const hoursLeft = Math.ceil(diff / (1000 * 60 * 60));
        trialBanner.style.display = 'block';
        if (hoursLeft <= 24) { trialBanner.classList.add('urgent'); trialBanner.innerHTML = `⏰ <strong>¡Tu prueba termina hoy!</strong>`; }
        else { trialBanner.classList.remove('urgent'); trialBanner.innerHTML = `🎁 Te quedan <strong>${Math.ceil(diff / 86400000)} día(s)</strong> de prueba gratuita.`; }
    } else if (trialEndDate && now > trialEndDate && currentPlan === 'inicial') {
        trialBanner.classList.add('urgent'); trialBanner.style.display = 'block';
        trialBanner.innerHTML = `⏰ Tu prueba gratuita finalizó. <strong>Elegí un plan pago</strong> para continuar.`;
    } else { trialBanner.style.display = 'none'; }
}

// =========================================
// PLANES Y CONTACTO
// =========================================
function contactWhatsApp(plan) {
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hola, quiero contratar el ${plan === 'maestro' ? 'Plan Maestro' : 'Plan Profesor'}.`)}`, '_blank');
}
async function setPlan(plan) {
    if (plan === currentPlan) return;
    currentPlan = plan; localStorage.setItem('plan', plan);
    const uid = localStorage.getItem('userUid');
    if (uid) { try { await StorageManager.saveUser(uid, { plan }); } catch (error) {} }
    alert(`✅ Cambiaste a ${plan === 'inicial' ? 'Plan Inicial' : plan === 'maestro' ? 'Plan Maestro' : 'Plan Profesor'}.`);
    updatePlanUI(); updateTrialBanner(); updateGenerateButtonState();
}
function isPlanSufficient(requiredPlan) { return { inicial: 0, maestro: 1, profesor: 2 }[currentPlan] >= { inicial: 0, maestro: 1, profesor: 2 }[requiredPlan]; }

function updatePlanUI() {
    document.querySelectorAll('.plan-card').forEach(card => {
        const planId = card.dataset.plan;
        const button = card.querySelector('.plan-btn');
        if (planId === currentPlan) { card.classList.add('active-plan'); button.textContent = '✓ Actual'; button.className = planId === 'inicial' ? 'plan-btn btn-outline' : 'plan-btn btn-filled'; }
        else { card.classList.remove('active-plan'); button.textContent = planId === 'inicial' ? 'Elegir' : 'Contratar'; button.className = planId === 'inicial' ? 'plan-btn btn-outline' : 'plan-btn btn-filled'; }
    });
    document.querySelectorAll('#headerPlanBadges .plan-badge-new').forEach(badge => badge.classList.toggle('active-header', badge.dataset.plan === currentPlan));
    const tipRecursos = document.getElementById('tipRecursos'); if (tipRecursos) tipRecursos.style.display = (currentPlan === 'profesor') ? 'none' : '';
    document.querySelectorAll('[data-min-plan]').forEach(el => el.classList.toggle('locked', !isPlanSufficient(el.dataset.minPlan)));
}

function handleRestrictedClick(action) { alert('🔒 Esta función está disponible a partir del Plan Maestro.'); }

// =========================================
// MANEJO DE ARCHIVO ADJUNTO
// =========================================
let archivoProgramaSeleccionado = null;

function toggleAdjuntarArchivo() {
    const chk = document.getElementById('chkAdjuntarArchivo');
    const field = document.getElementById('archivoProgramaField');
    const infoIA = document.getElementById('infoIA');
    if (chk.checked) {
        field.classList.add('show'); infoIA.style.display = 'block';
        document.getElementById('jurisdiccionIA').textContent = document.getElementById('jurisdiccion').value || 'tu provincia';
        document.getElementById('nivelIA').textContent = document.getElementById('nivel').value || 'tu nivel';
        document.getElementById('chkProgramaPropio').checked = false;
        document.getElementById('programaPropioField').classList.remove('show');
    } else { field.classList.remove('show'); archivoProgramaSeleccionado = null; document.getElementById('fileInfo').textContent = ''; if (!document.getElementById('chkProgramaPropio').checked) infoIA.style.display = 'none'; }
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { alert('El archivo es demasiado grande. Máximo 50 MB.'); event.target.value = ''; return; }
    if (!['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type)) { alert('Formato no soportado.'); event.target.value = ''; return; }
    archivoProgramaSeleccionado = file;
    document.getElementById('fileInfo').innerHTML = `✅ Archivo seleccionado: <strong>${sanitizarHTML(file.name)}</strong> (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
}

// =========================================
// WIZARD
// =========================================
let currentStep = 1;
const totalSteps = 4;

function updateCicloOptions() {
    const nivel = document.getElementById('nivel').value;
    const cicloSelect = document.getElementById('ciclo');
    document.getElementById('cicloGroup').style.display = nivel ? 'flex' : 'none';
    document.getElementById('anioGroup').style.display = 'none';
    cicloSelect.innerHTML = '<option value="">Seleccionar...</option>';
    document.getElementById('anio').innerHTML = '<option value="">Primero seleccioná el ciclo</option>';
    if (!nivel) return;
    if (nivel === 'Primario') cicloSelect.innerHTML += '<option value="1Ciclo">1° Ciclo (1°,2°,3°)</option><option value="2Ciclo">2° Ciclo (4°,5°,6°)</option>';
    else if (nivel === 'Secundario') cicloSelect.innerHTML += '<option value="Basico">Ciclo Básico (1°,2°,3°)</option><option value="Orientado">Ciclo Orientado (4°,5°,6°)</option>';
    else if (nivel === 'Inicial') cicloSelect.innerHTML += '<option value="Sala">Salas (3,4,5 años)</option>';
}

function updateAnioOptions() {
    const nivel = document.getElementById('nivel').value;
    const ciclo = document.getElementById('ciclo').value;
    const anioSelect = document.getElementById('anio');
    document.getElementById('anioGroup').style.display = ciclo ? 'flex' : 'none';
    if (!ciclo) return;
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
    if (chk.checked) { field.classList.add('show'); infoIA.style.display = 'block'; document.getElementById('chkAdjuntarArchivo').checked = false; document.getElementById('archivoProgramaField').classList.remove('show'); archivoProgramaSeleccionado = null; document.getElementById('fileInfo').textContent = ''; }
    else { field.classList.remove('show'); if (!document.getElementById('chkAdjuntarArchivo').checked) infoIA.style.display = 'none'; }
}

function changeStep(direction) {
    if (direction === 1 && !validateStep(currentStep)) { alert('Por favor completá los campos obligatorios (*)'); return; }
    document.querySelector(`.wizard-step[data-step="${currentStep}"]`).classList.remove('active');
    document.querySelector(`.step-indicator[data-step="${currentStep}"]`).classList.add('completed');
    currentStep += direction;
    document.querySelector(`.wizard-step[data-step="${currentStep}"]`).classList.add('active');
    document.querySelector(`.step-indicator[data-step="${currentStep}"]`).classList.add('active');
    document.getElementById('btnPrev').style.visibility = currentStep === 1 ? 'hidden' : 'visible';
    if (currentStep === totalSteps) { document.getElementById('btnNext').style.display = 'none'; document.getElementById('btnGenerate').style.display = 'inline-flex'; }
    else { document.getElementById('btnNext').style.display = 'inline-flex'; document.getElementById('btnGenerate').style.display = 'none'; }
}

function validateStep(step) {
    if (step === 1) return document.getElementById('jurisdiccion').value && document.getElementById('nivel').value;
    if (step === 2) return document.getElementById('colegio').value && document.getElementById('materia').value && document.getElementById('curso').value;
    if (step === 3) return document.getElementById('tema').value;
    return true;
}

// =========================================
// GENERAR PLANIFICACIÓN (con feedback mejorado)
// =========================================
async function generatePlanWithAI(data) {
    try { const generatePlan = httpsCallable(functions, 'generatePlan'); const result = await generatePlan(data); return result.data; }
    catch (error) { console.error('Error Cloud Function:', error); return null; }
}

async function generatePlanning() {
    if (!document.getElementById('tipoPlanificacion').value) { alert('Seleccioná el tipo de planificación'); return; }
    document.getElementById('previewColegio').textContent = document.getElementById('colegio').value;
    document.getElementById('previewJurisdiccion').textContent = document.getElementById('jurisdiccion').value;
    document.getElementById('previewNivel').textContent = document.getElementById('nivel').value;
    document.getElementById('previewAnio').textContent = document.getElementById('anio').value;
    document.getElementById('previewMateria').textContent = document.getElementById('materia').value;
    document.getElementById('previewCurso').textContent = document.getElementById('curso').value;
    document.getElementById('previewCarga').textContent = document.getElementById('cargaHoraria').value || '-';
    document.getElementById('previewTema').textContent = document.getElementById('tema').value;
    document.getElementById('previewSection').style.display = 'block';
    document.getElementById('loadingOverlay').classList.add('active');
    const formData = { materia: document.getElementById('materia').value, nivel: document.getElementById('nivel').value, tema: document.getElementById('tema').value, jurisdiccion: document.getElementById('jurisdiccion').value, tipo: document.getElementById('tipoPlanificacion').value };
    if (archivoProgramaSeleccionado) {
        const reader = new FileReader();
        reader.onload = async function() { formData.archivoBase64 = reader.result.split(',')[1]; formData.archivoMimeType = archivoProgramaSeleccionado.type; await processPlanning(formData); };
        reader.readAsDataURL(archivoProgramaSeleccionado);
    } else { await processPlanning(formData); }
}

async function processPlanning(formData) {
    let planData = isUserLoggedIn ? await generatePlanWithAI(formData) : null;
    document.getElementById('loadingOverlay').classList.remove('active');
    if (planData) {
        document.getElementById('previewFundamentacion').innerHTML = planData.fundamentacion;
        document.getElementById('previewObjetivos').innerHTML = planData.objetivos;
        document.getElementById('previewContenidos').innerHTML = planData.contenidos;
        document.getElementById('previewEstrategias').innerHTML = planData.estrategias;
        document.getElementById('previewEvaluacion').innerHTML = planData.evaluacion;
    } else {
        const banner = document.getElementById('trialBanner');
        if (banner) {
            banner.style.display = 'block';
            banner.innerHTML = '⚠️ El asistente de IA no está disponible en este momento. Te generamos una estructura de ejemplo para que puedas trabajar.';
            banner.classList.add('urgent');
            setTimeout(() => { banner.style.display = 'none'; }, 5000);
        }
        await simulateAIContent();
    }
    const uid = localStorage.getItem('userUid');
    if (uid) {
        const docRef = await StorageManager.addPlanificacion(uid, { colegio: document.getElementById('colegio').value, jurisdiccion: document.getElementById('jurisdiccion').value, nivel: document.getElementById('nivel').value, materia: document.getElementById('materia').value, tema: document.getElementById('tema').value, tipo: document.getElementById('tipoPlanificacion').value });
        ultimaPlanificacionId = docRef.id;
    }
    document.getElementById('previewSection').scrollIntoView({ behavior: 'smooth' });
}

async function simulateAIContent() {
    const materia = sanitizarHTML(document.getElementById('materia').value);
    const nivel = sanitizarHTML(document.getElementById('nivel').value);
    const tema = sanitizarHTML(document.getElementById('tema').value);
    const jurisdiccion = sanitizarHTML(document.getElementById('jurisdiccion').value);
    document.getElementById('previewFundamentacion').innerHTML = `<p>La enseñanza de <strong>${tema}</strong> en <strong>${materia}</strong> es fundamental según el Diseño Curricular de ${jurisdiccion}. Esta planificación busca que el estudiante construya significados desde sus saberes previos, fomentando el pensamiento crítico.</p>`;
    document.getElementById('previewObjetivos').innerHTML = `<ul><li>Comprender los conceptos fundamentales de ${tema}.</li><li>Aplicar procedimientos propios de ${materia}.</li><li>Desarrollar actitudes de responsabilidad y cooperación.</li></ul>`;
    document.getElementById('previewContenidos').innerHTML = `<p><strong>Conceptuales:</strong> ${tema}, propiedades y clasificación.</p><p><strong>Procedimentales:</strong> Resolución de problemas, análisis de casos.</p><p><strong>Actitudinales:</strong> Valoración del trabajo intelectual.</p>`;
    document.getElementById('previewEstrategias').innerHTML = `<ul><li><strong>ABP:</strong> Situaciones problemáticas contextualizadas.</li><li><strong>Trabajo Colaborativo:</strong> Producción grupal con roles.</li></ul>`;
    document.getElementById('previewEvaluacion').innerHTML = `<p><strong>Criterios:</strong> Apropiación conceptual, aplicación de procedimientos, participación.</p><p><strong>Instrumentos:</strong> Observación, registros, pruebas escritas, rúbricas.</p>`;
}

// =========================================
// COMPARTIR PLANIFICACIÓN
// =========================================
async function shareCurrentPlanification(method) {
    if (!ultimaPlanificacionId) { alert('Primero generá una planificación.'); return; }
    try {
        const generateLink = httpsCallable(functions, 'generateShareLink');
        const result = await generateLink({ planificacionId: ultimaPlanificacionId, method });
        if (method === 'whatsapp') window.open(`https://wa.me/?text=${encodeURIComponent(result.data.shareText)}`, '_blank');
        else if (method === 'email') window.location.href = `mailto:?subject=Planificación&body=${encodeURIComponent(result.data.shareText)}`;
    } catch (error) { alert('Error al compartir.'); }
}

// =========================================
// GOOGLE CALENDAR
// =========================================
async function connectGoogleCalendar() {
    alert('🔗 Para conectar Google Calendar, configurá OAuth en Google Cloud Console.');
}

async function syncWithGoogleCalendar() {
    if (!isPlanSufficient('maestro')) { alert('🔒 Requiere Plan Maestro o superior.'); return; }
    const uid = localStorage.getItem('userUid'); if (!uid) return;
    const events = Object.values(userEvents).flat();
    let count = 0;
    for (const event of events) {
        if (!event.googleCalendarEventId) {
            try {
                const syncEvent = httpsCallable(functions, 'syncEventToGoogleCalendar');
                await syncEvent({ eventId: event.id, action: 'create', eventData: { name: event.name, type: event.type, year: event.year, month: event.month, day: event.day } });
                count++;
            } catch (e) {}
        }
    }
    alert(`✅ Se sincronizaron ${count} eventos con Google Calendar.`);
}

// =========================================
// CALENDARIO
// =========================================
const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
let currentMonth = new Date().getMonth(), currentYear = new Date().getFullYear();
let userEvents = {}, holidays = {}, holidayCache = {}, selectedEventColor = 'var(--event-exam)';

async function fetchHolidays(year) {
    if (holidayCache[year]) return holidayCache[year];
    try { const r = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/AR`); const d = await r.json(); const m = {}; d.forEach(h => { const dt = new Date(h.date); m[`${dt.getDate()}-${dt.getMonth()+1}`] = h.localName; }); holidayCache[year] = m; return m; }
    catch (e) { return {}; }
}

async function loadUserEvents() { const uid = localStorage.getItem('userUid'); if (!uid) return; userEvents = await StorageManager.loadEvents(uid); checkReminders(); }

function checkReminders() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const today = new Date(); const reminderDate = new Date(today); reminderDate.setDate(today.getDate() + 3);
    Object.values(userEvents).flat().forEach(evt => { if (!evt.imp) return; if (new Date(evt.year, evt.month-1, evt.day).toDateString() === reminderDate.toDateString()) new Notification("Recordatorio PlanificAR", { body: `Faltan 3 días para: ${sanitizarHTML(evt.name)}` }); });
}

let selectedDate = null;
const eventModal = document.getElementById('eventModal');
const modalTitle = document.getElementById('modalTitle');
const modalEventType = document.getElementById('modalEventType');
const modalEventName = document.getElementById('modalEventName');
const modalEventImportant = document.getElementById('modalEventImportant');
const modalEventRepeat = document.getElementById('modalEventRepeat');
const modalRepeatCount = document.getElementById('modalRepeatCount');
const repeatCountField = document.getElementById('repeatCountField');
const saveEventBtn = document.getElementById('saveEventBtn');

document.getElementById('colorPicker').addEventListener('click', (e) => {
    if (e.target.classList.contains('color-option')) { document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected')); e.target.classList.add('selected'); selectedEventColor = e.target.dataset.color; }
});

modalEventRepeat.addEventListener('change', () => { repeatCountField.style.display = modalEventRepeat.value !== 'none' ? 'block' : 'none'; });

function openEventModal(day, month, year) {
    selectedDate = { day, month, year };
    modalTitle.textContent = `Nuevo evento - ${day}/${month+1}/${year}`;
    modalEventType.value = 'Evento'; modalEventName.value = ''; modalEventImportant.checked = false;
    modalEventRepeat.value = 'none'; modalRepeatCount.value = 4; repeatCountField.style.display = 'none';
    selectedEventColor = 'var(--event-exam)';
    document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
    document.querySelector('.color-option[data-color="var(--event-exam)"]').classList.add('selected');
    eventModal.classList.add('show');
}

function closeEventModal() { eventModal.classList.remove('show'); setTimeout(() => { selectedDate = null; }, 300); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && eventModal.classList.contains('show')) closeEventModal(); });
eventModal.addEventListener('click', (e) => { if (e.target === eventModal) closeEventModal(); });

saveEventBtn.addEventListener('click', async () => {
    if (!selectedDate) return;
    const uid = localStorage.getItem('userUid'); if (!uid) return;
    const eventData = { day: selectedDate.day, month: selectedDate.month + 1, year: selectedDate.year, type: modalEventType.value, name: sanitizarHTML(modalEventName.value) || 'Sin título', imp: modalEventImportant.checked, color: selectedEventColor };
    
    if (modalEventRepeat.value !== 'none') {
        try { const createRecurring = httpsCallable(functions, 'createRecurringEvent'); await createRecurring({ eventData, recurrence: { type: modalEventRepeat.value, count: parseInt(modalRepeatCount.value) } }); }
        catch (error) { alert('Error al crear eventos recurrentes.'); }
    } else {
        try { await StorageManager.addEvent(uid, eventData); } catch (error) { alert('Error al guardar el evento.'); }
    }
    closeEventModal(); await loadUserEvents(); await renderCalendar();
    if (modalEventImportant.checked && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
});

async function renderCalendar() {
    const grid = document.getElementById('calendarGrid'); if (!grid) return;
    let html = '';
    ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].forEach(d => html += `<div class="day-name">${d}</div>`);
    document.getElementById('displayMonthName').textContent = monthNames[currentMonth];
    document.getElementById('displayYear').textContent = currentYear;
    holidays = await fetchHolidays(currentYear);
    const firstDay = new Date(currentYear, currentMonth, 1).getDay(), daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    let startDay = firstDay === 0 ? 6 : firstDay - 1;
    for (let i = 0; i < startDay; i++) html += '<div class="calendar-day empty"></div>';
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const dayOfWeek = new Date(currentYear, currentMonth, day).getDay(), dateKey = `${day}-${currentMonth+1}-${currentYear}`, holidayKey = `${day}-${currentMonth+1}`;
        let content = `<div style="font-weight:600; margin-bottom:2px;">${day}</div>`;
        if (userEvents[dateKey]) userEvents[dateKey].forEach(evt => content += `<div class="event-tag-cell" draggable="true" data-id="${evt.id}" style="background: ${evt.color || 'var(--event-exam)'}">${sanitizarHTML(evt.name)}</div>`);
        let classes = 'calendar-day';
        if (!userEvents[dateKey]) classes += ' skeleton';
        if (today.getDate() === day && today.getMonth() === currentMonth && today.getFullYear() === currentYear) classes += ' today';
        if (dayOfWeek === 0 || dayOfWeek === 6) classes += ' weekend';
        if (holidays[holidayKey]) { classes += ' holiday'; content += '<div style="font-size:0.65rem; color:#6A5ACD;">🇷 Feriado</div>'; }
        html += `<div class="${classes}" data-date="${dateKey}">${content}</div>`;
    }
    grid.innerHTML = html;
    document.querySelectorAll('.calendar-day.skeleton').forEach(c => c.classList.remove('skeleton'));
    document.querySelectorAll('.calendar-day:not(.empty)').forEach(cell => {
        cell.addEventListener('click', (e) => { if (e.target.classList.contains('event-tag-cell')) return; const [d, m, y] = cell.dataset.date.split('-').map(Number); openEventModal(d, m-1, y); });
        cell.addEventListener('dragover', e => e.preventDefault());
        cell.addEventListener('drop', async (e) => {
            e.preventDefault(); const eventId = e.dataTransfer.getData('text/plain'); if (!eventId) return;
            const uid = localStorage.getItem('userUid'); const oldDate = e.dataTransfer.getData('date').split('-'), newDate = cell.dataset.date.split('-');
            if (oldDate[0] === newDate[0] && oldDate[1] === newDate[1] && oldDate[2] === newDate[2]) return;
            try { await StorageManager.updateEvent(uid, eventId, { day: parseInt(newDate[0]), month: parseInt(newDate[1]), year: parseInt(newDate[2]) }); await loadUserEvents(); await renderCalendar(); }
            catch (error) { alert('Error de conexión.'); await loadUserEvents(); await renderCalendar(); }
        });
    });
    document.querySelectorAll('.event-tag-cell').forEach(tag => { tag.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', tag.dataset.id); e.dataTransfer.setData('date', tag.closest('.calendar-day').dataset.date); }); });
    updateWeeklyAgenda(); updateSearchResults();
}

const searchInput = document.getElementById('searchEvents'), searchResults = document.getElementById('searchResults');
searchInput.addEventListener('input', updateSearchResults);
function updateSearchResults() {
    const query = searchInput.value.toLowerCase();
    if (!query) { searchResults.style.display = 'none'; return; }
    const results = [];
    Object.entries(userEvents).forEach(([dateKey, events]) => events.forEach(evt => { if (sanitizarHTML(evt.name).toLowerCase().includes(query) || sanitizarHTML(evt.type).toLowerCase().includes(query)) results.push({ ...evt, date: dateKey }); }));
    searchResults.innerHTML = results.length ? results.map(r => `<div onclick="goToDate('${r.date}')">📅 ${r.date} - ${sanitizarHTML(r.name)} (${sanitizarHTML(r.type)})</div>`).join('') : '<div>No se encontraron eventos.</div>';
    searchResults.style.display = 'block';
}
window.goToDate = function(dateKey) { const [day, month, year] = dateKey.split('-').map(Number); currentMonth = month - 1; currentYear = year; loadUserEvents().then(() => renderCalendar()); document.querySelector('#calendario').scrollIntoView({ behavior: 'smooth' }); };
function updateWeeklyAgenda() {
    const list = document.getElementById('weeklyList'); if (!list) return;
    const today = new Date(), startOfWeek = new Date(today); startOfWeek.setDate(today.getDate() - today.getDay() + 1);
    const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6);
    const weekEvents = [];
    Object.entries(userEvents).forEach(([dateKey, events]) => { const [d, m, y] = dateKey.split('-').map(Number); const eventDate = new Date(y, m-1, d); if (eventDate >= startOfWeek && eventDate <= endOfWeek) events.forEach(evt => weekEvents.push({ date: dateKey, ...evt })); });
    weekEvents.sort((a,b) => new Date(a.date.split('-')[2], a.date.split('-')[1]-1, a.date.split('-')[0]) - new Date(b.date.split('-')[2], b.date.split('-')[1]-1, b.date.split('-')[0]));
    list.innerHTML = weekEvents.length ? weekEvents.map(e => `<li><span>📅 ${e.date}</span> <span style="background:${e.color||'var(--event-exam)'};padding:0 6px;border-radius:4px;">${sanitizarHTML(e.name)}</span></li>`).join('') : '<li>No hay eventos esta semana.</li>';
}
document.getElementById('prevMonth').addEventListener('click', async () => { currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; } await loadUserEvents(); await renderCalendar(); });
document.getElementById('nextMonth').addEventListener('click', async () => { currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; } await loadUserEvents(); await renderCalendar(); });
const monthSelector = document.getElementById('monthSelector');
monthNames.forEach((m, i) => { const btn = document.createElement('button'); btn.className = 'month-btn' + (i === currentMonth ? ' active' : ''); btn.textContent = m.substring(0,3); btn.onclick = async () => { currentMonth = i; await loadUserEvents(); await renderCalendar(); }; monthSelector.appendChild(btn); });

// =========================================
// EXPORTACIONES
// =========================================
document.getElementById('exportExcelBtn').addEventListener('click', () => {
    if (!isPlanSufficient('maestro')) { alert('🔒 Requiere Plan Maestro.'); return; }
    const eventsArray = [];
    Object.entries(userEvents).forEach(([dateKey, events]) => events.forEach(evt => eventsArray.push({ 'Fecha': dateKey, 'Tipo': sanitizarHTML(evt.type), 'Nombre': sanitizarHTML(evt.name), 'Importante': evt.imp ? 'Sí' : 'No' })));
    if (eventsArray.length === 0) { alert('No hay eventos.'); return; }
    const ws = XLSX.utils.json_to_sheet(eventsArray), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Eventos"); XLSX.writeFile(wb, `planificar_eventos_${currentMonth+1}_${currentYear}.xlsx`);
});
function exportCalendarToPDF() {
    if (!isPlanSufficient('maestro')) { alert('🔒 Requiere Plan Maestro.'); return; }
    const spinner = document.getElementById('pdfSpinner'); if (spinner) spinner.style.display = 'inline';
    setTimeout(() => {
        const { jsPDF } = window.jspdf; const doc = new jsPDF(); doc.setFontSize(16); doc.text(`Calendario - ${monthNames[currentMonth]} ${currentYear}`, 14, 20);
        let y = 30;
        const events = Object.entries(userEvents).sort(([a], [b]) => { const [da, ma, ya] = a.split('-').map(Number), [db, mb, yb] = b.split('-').map(Number); return new Date(ya, ma-1, da) - new Date(yb, mb-1, db); });
        if (events.length === 0) doc.text('No hay eventos este mes.', 14, y);
        else events.forEach(([dateKey, evts]) => evts.forEach(evt => { if (y > 270) { doc.addPage(); y = 20; } doc.setFontSize(11); doc.text(`${dateKey}: ${sanitizarHTML(evt.name)} (${sanitizarHTML(evt.type)})`, 14, y); y += 7; }));
        doc.save(`planificar_${currentMonth+1}_${currentYear}.pdf`); if (spinner) spinner.style.display = 'none';
    }, 100);
}

// =========================================
// ESTADÍSTICAS
// =========================================
async function loadUserStats() {
    try { const getStats = httpsCallable(functions, 'getUserStats'); const result = await getStats(); return result.data; }
    catch (error) { return null; }
}
if (document.getElementById('statsContainer')) {
    loadUserStats().then(stats => {
        if (stats) document.getElementById('statsContainer').innerHTML = `<p>📊 <strong>Planificaciones:</strong> ${stats.totalPlans}</p><p>📅 <strong>Eventos:</strong> ${stats.totalEvents}</p><p>🏆 <strong>Materias principales:</strong> ${stats.topMaterias.map(m => sanitizarHTML(m.nombre)).join(', ') || 'Ninguna aún'}</p>`;
        else document.getElementById('statsContainer').innerHTML = '<p>No se pudieron cargar las estadísticas.</p>';
    });
}

// =========================================
// ROUTER Y MENÚ
// =========================================
window.addEventListener('hashchange', () => {
    ['generador', 'calendario', 'recursos', 'planes'].forEach(s => { const el = document.getElementById(s); if (el) el.style.display = (s === (window.location.hash.replace('#', '') || 'generador')) ? '' : 'none'; });
    document.querySelectorAll('.menu-link').forEach(link => link.classList.toggle('active', link.getAttribute('href') === `#${window.location.hash}` || (!window.location.hash && link.getAttribute('href') === '#generador')));
});
window.addEventListener('load', () => window.dispatchEvent(new HashChangeEvent('hashchange')));
document.getElementById('hamburgerBtn').addEventListener('click', () => { document.getElementById('menuLinks').classList.toggle('show'); document.getElementById('menuOverlay').classList.toggle('show'); });
document.getElementById('menuOverlay').addEventListener('click', () => { document.getElementById('menuLinks').classList.remove('show'); document.getElementById('menuOverlay').classList.remove('show'); });
document.querySelectorAll('.menu-link').forEach(link => link.addEventListener('click', () => { document.getElementById('menuLinks').classList.remove('show'); document.getElementById('menuOverlay').classList.remove('show'); }));

// =========================================
// EXPONER AL SCOPE GLOBAL
// =========================================
window.setPlan = setPlan; window.contactWhatsApp = contactWhatsApp;
window.toggleProgramaPropio = toggleProgramaPropio; window.changeStep = changeStep;
window.generatePlanning = generatePlanning; window.closeEventModal = closeEventModal;
window.handleRestrictedClick = handleRestrictedClick; window.exportCalendarToPDF = exportCalendarToPDF;
window.toggleAdjuntarArchivo = toggleAdjuntarArchivo; window.handleFileSelect = handleFileSelect;
window.shareCurrentPlanification = shareCurrentPlanification;
window.syncWithGoogleCalendar = syncWithGoogleCalendar;
window.connectGoogleCalendar = connectGoogleCalendar;
window.exportYearBackup = exportYearBackup;

async function exportYearBackup() {
    if (!isPlanSufficient('profesor')) { alert('🔒 Requiere Plan Profesor.'); return; }
    try {
        const generateBackup = httpsCallable(functions, 'generateYearBackup');
        const result = await generateBackup({ year: currentYear });
        const blob = new Blob([JSON.stringify(result.data.plans, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `planificar_backup_${currentYear}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) { alert('Error al generar el backup.'); }
}

// =========================================
// INICIALIZACIÓN
// =========================================
function initApp() {
    const themeToggle = document.getElementById('themeToggle'), htmlElement = document.documentElement;
    const savedTheme = localStorage.getItem('theme'), prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) { htmlElement.setAttribute('data-theme', 'dark'); themeToggle.textContent = '☀️'; }
    themeToggle.addEventListener('click', () => { const ct = htmlElement.getAttribute('data-theme'), nt = ct === 'dark' ? 'light' : 'dark'; htmlElement.setAttribute('data-theme', nt); localStorage.setItem('theme', nt); themeToggle.textContent = nt === 'dark' ? '☀️' : '🌙'; });
    updatePlanUI(); updateGenerateButtonState();
    loadUserEvents().then(() => renderCalendar()); toggleProgramaPropio();
}
initAuth(); initApp();