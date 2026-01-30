const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');
const statusIcon = document.getElementById('statusIcon');
const btnOpen = document.getElementById('btnOpen');
const updateSuccessCheck = document.getElementById('updateSuccessCheck');
const progressContainer = document.getElementById('progressContainer');

// --- VARIÁVEIS DE ESTADO ---
let estadoAtual = "DESCONHECIDO"; 
let timerMovimento = null;
const TEMPO_CICLO = 15000; // 15 Segundos
let ultimaDirecao = "FECHANDO"; // Memória para saber para onde inverter
let emProcessoDeUpdate = false; 

// --- INICIALIZAÇÃO ---
const savedToken = localStorage.getItem('gate_token');
const savedName = localStorage.getItem('gate_username');

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
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3500);
}

// --- LOGIN ---
async function fazerLogin() {
    const name = document.getElementById('nameInput').value.trim();
    const password = document.getElementById('passwordInput').value;
    const btn = document.getElementById('btnLogin');
    const errorMsg = document.getElementById('loginError');

    if (!name) { errorMsg.innerText = "Por favor, digite seu nome."; return; }

    btn.innerHTML = `<i class="ph ph-spinner ph-spin"></i> Verificando...`; btn.disabled = true;
    try {
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, name })
        });
        const data = await res.json();
        if (data.success) {
            localStorage.setItem('gate_token', data.token);
            localStorage.setItem('gate_username', name);
            mostrarApp();
            showToast(`Bem-vindo, ${name}!`, "success");
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
    fetch('/api/acionar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') },
        body: JSON.stringify({ comando_customizado: "CHECAR_STATUS" }) 
    }).catch(e => console.log("Erro inicial"));
}

function fazerLogout() {
    localStorage.removeItem('gate_token');
    location.reload();
}

// --- COMANDO ---
async function abrirPortao() {
    btnOpen.classList.add('active-power');
    if(navigator.vibrate) navigator.vibrate(50);
    setTimeout(() => btnOpen.classList.remove('active-power'), 300);

    // Aplica a lógica visual corrigida
    gerenciarLogicaClique();
    
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
        await fetch('/api/admin/update', { method: 'POST', headers: { 'Authorization': localStorage.getItem('gate_token') } });
        showToast("Update solicitado!", "info");
    } catch (e) { 
        btn.innerHTML = `<i class="ph ph-cloud-arrow-up"></i> Atualizar Firmware`; btn.disabled = false;
        showToast("Erro de conexão.", "error");
    }
}

// ==========================================================
// LÓGICA DE MOVIMENTO COM INVERSÃO (O PULO DO GATO)
// ==========================================================

function gerenciarLogicaClique() {
    // 1. Se está MOVENDO -> Vira PARADO
    if (estadoAtual === "ABRINDO" || estadoAtual === "FECHANDO") {
        // Salva a direção que estava indo antes de parar
        ultimaDirecao = estadoAtual;
        pararAnimacao();
    }
    
    // 2. Se está PARADO -> INVERTE a última direção
    else if (estadoAtual === "PARADO") {
        if (ultimaDirecao === "ABRINDO") {
            iniciarAnimacao("FECHANDO"); // Se estava abrindo, agora fecha
        } else {
            iniciarAnimacao("ABRINDO"); // Se estava fechando, agora abre
        }
    }
    
    // 3. Extremos (Fechado/Aberto)
    else if (estadoAtual === "FECHADO") {
        iniciarAnimacao("ABRINDO");
    }
    else if (estadoAtual === "ABERTO") {
        iniciarAnimacao("FECHANDO");
    }
    
    // Fallback (primeiro uso)
    else {
        iniciarAnimacao("ABRINDO");
    }
}

function iniciarAnimacao(novoEstado) {
    if (timerMovimento) clearTimeout(timerMovimento);
    
    estadoAtual = novoEstado;
    // Atualiza a ultimaDirecao agora também, para garantir sincronia
    ultimaDirecao = novoEstado; 
    
    let texto = novoEstado === "ABRINDO" ? "Abrindo... (15s)" : "Fechando... (15s)";
    let cor = "#f59e0b"; // Laranja
    let icone = novoEstado === "ABRINDO" ? "ph-arrows-out-line-vertical" : "ph-arrows-in-line-vertical";
    
    atualizarUI(texto, cor, icone, true);
    
    timerMovimento = setTimeout(() => {
        if (novoEstado === "ABRINDO") finalizarEstado("ABERTO");
        else if (novoEstado === "FECHANDO") finalizarEstado("FECHADO");
    }, TEMPO_CICLO);
}

function pararAnimacao() {
    if (timerMovimento) clearTimeout(timerMovimento);
    estadoAtual = "PARADO";
    atualizarUI("Parado ✋", "#94a3b8", "ph-hand-palm", false);
}

function finalizarEstado(estadoFinal) {
    estadoAtual = estadoFinal;
    if (estadoFinal === "ABERTO") { 
        atualizarUI("Aberto", "#ef4444", "ph-lock-open"); 
        ultimaDirecao = "ABRINDO"; // Garante que se clicar, vai fechar
    } else { 
        atualizarUI("Fechado", "#10b981", "ph-lock-key"); 
        ultimaDirecao = "FECHANDO"; // Garante que se clicar, vai abrir
    }
}

function atualizarUI(texto, cor, iconeNome, pulsando = false) {
    statusText.innerText = texto; 
    statusText.style.color = cor;
    statusIndicator.style.borderColor = cor;
    statusIndicator.style.boxShadow = `0 0 20px ${cor}40`;
    statusIcon.className = `ph ${iconeNome}`;
    statusIcon.style.color = cor;
    
    if (pulsando) statusIndicator.classList.add('pulsing');
    else statusIndicator.classList.remove('pulsing');
}

// --- SSE (IGNORANDO "ABERTO" ENQUANTO ANIMA) ---
function conectarSSE() {
    const evtSource = new EventSource('/events');
    evtSource.onmessage = function(event) {
        const msg = event.data;
        
        // STATUS REAL:
        if(msg === "ESTADO_REAL_FECHADO") {
            // Se o imã colou, fechou mesmo. Respeitamos.
            if (timerMovimento) clearTimeout(timerMovimento);
            finalizarEstado("FECHADO");
            verificarFimUpdate();
        } 
        else if (msg === "ESTADO_REAL_ABERTO") {
            // SE ESTAMOS CONTANDO TEMPO (ANIMANDO), IGNORAMOS O SENSOR ABERTO
            // (Porque o sensor solta logo no início, mas queremos ver a animação até o fim ou parar)
            if (timerMovimento) {
                return; 
            }
            
            // Se não estamos animando (ex: atualizou a pagina), aceitamos que está aberto
            // Mas só se não estivermos no estado PARADO (para não sobrescrever a parada manual)
            if (estadoAtual !== "PARADO") {
                finalizarEstado("ABERTO");
            }
            verificarFimUpdate();
        }
        
        else if (msg === "STATUS_ATUALIZANDO_SISTEMA") {
             emProcessoDeUpdate = true;
             progressContainer.classList.remove('hidden');
             showToast("Firmware atualizando...", "info");
             atualizarUI("Atualizando...", "#00d2ff", "ph-cloud-arrow-down", true);
        }
        else if (msg === "ERRO_ATUALIZACAO") {
            emProcessoDeUpdate = false;
            progressContainer.classList.add('hidden');
            showToast("Erro na atualização!", "error");
            document.querySelector('.btn-update').disabled = false;
        }
    };
}

function verificarFimUpdate() {
    if (emProcessoDeUpdate) {
        emProcessoDeUpdate = false;
        showToast("Firmware atualizado!", "success");
        progressContainer.classList.add('hidden');
        document.querySelector('.btn-update').disabled = false;
        document.querySelector('.btn-update').innerHTML = `<i class="ph ph-cloud-arrow-up"></i> Atualizar Firmware`;
        updateSuccessCheck.classList.remove('hidden');
        setTimeout(() => updateSuccessCheck.classList.add('hidden'), 5000);
    }
}