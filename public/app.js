const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');
const statusIcon = document.getElementById('statusIcon');
const btnOpen = document.getElementById('btnOpen');
const updateSuccessCheck = document.getElementById('updateSuccessCheck');
const lastUserText = document.getElementById('lastUserText');

// --- ESTADO ---
let estadoAtual = "DESCONHECIDO"; 
let timerMovimento = null;
const TEMPO_ABERTURA = 15000; 
let ultimaDirecao = "FECHANDO"; 
let emProcessoDeUpdate = false; 

// --- INICIALIZAÇÃO ---
const savedToken = localStorage.getItem('gate_token');
const savedName = localStorage.getItem('gate_username');

// Preenche o nome se já tiver salvo
if (savedName) document.getElementById('nameInput').value = savedName;

if (savedToken) mostrarApp();

// --- TOASTS ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = type === 'success' ? 'ph-check-circle' : (type === 'error' ? 'ph-warning' : 'ph-info');
    toast.innerHTML = `<i class="ph ${icon}"></i> <span>${message}</span>`;
    
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// --- LOGIN COM NOME ---
async function fazerLogin() {
    const name = document.getElementById('nameInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const btn = document.getElementById('btnLogin');
    const errorMsg = document.getElementById('loginError');

    if (!name) {
        errorMsg.innerText = "Por favor, digite seu nome.";
        return;
    }

    btn.innerHTML = `<i class="ph ph-spinner ph-spin"></i> Verificando...`; btn.disabled = true;
    
    try {
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, name }) // Envia o NOME
        });
        const data = await res.json();
        
        if (data.success) {
            localStorage.setItem('gate_token', data.token);
            localStorage.setItem('gate_username', name); // Salva o nome pra próxima
            mostrarApp();
        } else {
            errorMsg.innerText = "Senha Incorreta!";
            showToast("Senha incorreta", "error");
        }
    } catch (e) { 
        errorMsg.innerText = "Erro de conexão";
    }
    btn.innerHTML = `ENTRAR <i class="ph ph-arrow-right"></i>`; btn.disabled = false;
}

function mostrarApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    conectarSSE();
    
    // Checagem inicial
    fetch('/api/acionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') },
        body: JSON.stringify({ comando_customizado: "CHECAR_STATUS" }) 
    }).catch(e => console.log("Erro inicial"));
}

function fazerLogout() {
    localStorage.removeItem('gate_token');
    location.reload();
}

// --- COMANDOS ---
async function abrirPortao() {
    // Feedback visual no botão power
    btnOpen.classList.add('active-power');
    if(navigator.vibrate) navigator.vibrate(50);
    setTimeout(() => btnOpen.classList.remove('active-power'), 300);

    gerenciarLogicaMovimento();
    
    try {
        await fetch('/api/acionar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') }
        });
    } catch (e) { showToast("Erro ao enviar comando", "error"); }
}

async function solicitarUpdate() {
    if (!confirm("⚠️ Confirmar atualização de Firmware?")) return;
    const btn = document.querySelector('.btn-update');
    btn.innerHTML = `<i class="ph ph-spinner ph-spin"></i> Enviando...`; btn.disabled = true;
    
    try {
        await fetch('/api/admin/update', {
            method: 'POST', headers: { 'Authorization': localStorage.getItem('gate_token') }
        });
        showToast("Comando enviado!", "info");
    } catch (e) { 
        btn.innerHTML = `<i class="ph ph-cloud-arrow-up"></i> Atualizar Firmware`; btn.disabled = false;
    }
}

// --- LÓGICA VISUAL ---
function gerenciarLogicaMovimento() {
    if (estadoAtual === "FECHADO") iniciarAnimacao("ABRINDO");
    else if (estadoAtual === "ABERTO") iniciarAnimacao("FECHANDO");
    else if (estadoAtual === "PARADO") (ultimaDirecao === "ABRINDO") ? iniciarAnimacao("FECHANDO") : iniciarAnimacao("ABRINDO");
    else iniciarAnimacao("ABRINDO");
}

function iniciarAnimacao(novoEstado) {
    estadoAtual = novoEstado;
    if (novoEstado === "ABRINDO" || novoEstado === "FECHANDO") ultimaDirecao = novoEstado;
    
    let texto = novoEstado === "ABRINDO" ? "Abrindo..." : "Fechando...";
    let cor = "#f59e0b"; // Laranja Warning
    let icone = novoEstado === "ABRINDO" ? "ph-arrows-out-line-vertical" : "ph-arrows-in-line-vertical";
    
    atualizarUI(texto, cor, icone, true);
    
    if (timerMovimento) clearTimeout(timerMovimento);
    timerMovimento = setTimeout(() => {
        (novoEstado === "ABRINDO") ? finalizarEstado("ABERTO") : finalizarEstado("FECHADO"); 
    }, TEMPO_ABERTURA);
}

function pararAnimacao() {
    if (timerMovimento) clearTimeout(timerMovimento);
    ultimaDirecao = estadoAtual; estadoAtual = "PARADO";
    atualizarUI("Parado", "#f59e0b", "ph-hand-palm"); 
}

function finalizarEstado(estadoFinal) {
    estadoAtual = estadoFinal;
    if (estadoFinal === "ABERTO") { 
        atualizarUI("Aberto", "#ef4444", "ph-lock-open"); // Vermelho = Atenção, está aberto
        ultimaDirecao = "ABRINDO"; 
    } else { 
        atualizarUI("Fechado", "#10b981", "ph-lock-key"); // Verde = Seguro
        ultimaDirecao = "FECHANDO"; 
    }
}

function atualizarUI(texto, cor, iconeNome, pulsando = false) {
    statusText.innerText = texto; 
    statusText.style.color = cor;
    
    statusIndicator.style.borderColor = cor;
    statusIndicator.style.boxShadow = `0 0 20px ${cor}40`; // 40 = transparencia
    
    statusIcon.className = `ph ${iconeNome}`;
    statusIcon.style.color = cor;
    
    if (pulsando) statusIndicator.classList.add('pulsing'); // Adicionar no CSS se quiser animar
    else statusIndicator.classList.remove('pulsing');
}

// --- SSE ---
function conectarSSE() {
    const evtSource = new EventSource('/events');
    evtSource.onmessage = function(event) {
        const msg = event.data;
        
        if(msg === "ESTADO_REAL_FECHADO") {
            if (timerMovimento) clearTimeout(timerMovimento);
            finalizarEstado("FECHADO");
        } 
        else if (msg === "ESTADO_REAL_ABERTO") {
            if (timerMovimento) clearTimeout(timerMovimento);
            finalizarEstado("ABERTO");
        }
        else if (msg === "STATUS_ATUALIZANDO_SISTEMA") {
             emProcessoDeUpdate = true;
             atualizarUI("Atualizando...", "#00d2ff", "ph-cloud-arrow-down");
        }
    };
}