const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');
const statusIcon = document.getElementById('statusIcon');
const btnOpen = document.getElementById('btnOpen');
const updateSuccessCheck = document.getElementById('updateSuccessCheck');
const progressContainer = document.getElementById('progressContainer');
const progressLabel = document.getElementById('progressLabel');

// --- VARIÁVEIS DE ESTADO PORTÃO ---
let estadoAtual = "DESCONHECIDO"; 
let timerMovimento = null;
const TEMPO_CICLO = 15000; // 15 Segundos
let ultimaDirecao = "FECHANDO"; 
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
        body: JSON.stringify({ dispositivo: "portao", comando_customizado: "CHECAR_STATUS" }) 
    }).catch(e => console.log("Erro inicial"));
}

function fazerLogout() {
    localStorage.removeItem('gate_token');
    location.reload();
}

// --- CONTROLES PORTÃO ---
async function abrirPortao() {
    btnOpen.classList.add('active-power');
    if(navigator.vibrate) navigator.vibrate(50);
    setTimeout(() => btnOpen.classList.remove('active-power'), 300);

    gerenciarLogicaClique();
    
    try {
        await fetch('/api/acionar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') },
            body: JSON.stringify({ dispositivo: "portao" })
        });
    } catch (e) { showToast("Erro ao enviar comando", "error"); }
}

// --- CONTROLES BOMBA ---
async function controlarBomba(comando) {
    if(navigator.vibrate) navigator.vibrate(50);
    try {
        await fetch('/api/acionar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') },
            body: JSON.stringify({ dispositivo: "bomba", comando_customizado: comando })
        });
        showToast(comando === "LIGAR_BOMBA" ? "Ligando bomba..." : "Desligando bomba...", "info");
    } catch (e) { showToast("Erro ao comunicar com a bomba", "error"); }
}

async function solicitarUpdate(dispositivo) {
    let nomeDispositivo = dispositivo === 'portao' ? 'Portão' : 'Bomba';
    if (!confirm(`⚠️ Confirmar atualização de Firmware do ${nomeDispositivo}?`)) return;
    
    const btnId = dispositivo === 'portao' ? 'btnUpdatePortao' : 'btnUpdateBomba';
    const btn = document.getElementById(btnId);
    const textoOriginal = btn.innerHTML;
    
    btn.innerHTML = `<i class="ph ph-spinner ph-spin"></i> Enviando...`; 
    btn.disabled = true;
    
    try {
        await fetch('/api/admin/update', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') },
            body: JSON.stringify({ dispositivo: dispositivo })
        });
        showToast(`Update ${nomeDispositivo} solicitado!`, "info");
    } catch (e) { 
        btn.innerHTML = textoOriginal; 
        btn.disabled = false;
        showToast("Erro de conexão.", "error");
    }
}

// --- LÓGICA DE MOVIMENTO COM INVERSÃO PORTÃO ---
function gerenciarLogicaClique() {
    if (estadoAtual === "ABRINDO" || estadoAtual === "FECHANDO") {
        ultimaDirecao = estadoAtual;
        pararAnimacao();
    } else if (estadoAtual === "PARADO") {
        if (ultimaDirecao === "ABRINDO") iniciarAnimacao("FECHANDO");
        else iniciarAnimacao("ABRINDO");
    } else if (estadoAtual === "FECHADO") {
        iniciarAnimacao("ABRINDO");
    } else if (estadoAtual === "ABERTO") {
        iniciarAnimacao("FECHANDO");
    } else {
        iniciarAnimacao("ABRINDO");
    }
}

function iniciarAnimacao(novoEstado) {
    if (timerMovimento) clearTimeout(timerMovimento);
    
    estadoAtual = novoEstado;
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
        ultimaDirecao = "ABRINDO"; 
    } else { 
        atualizarUI("Fechado", "#10b981", "ph-lock-key"); 
        ultimaDirecao = "FECHANDO"; 
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

function reativarBotoesUpdate() {
    const btnPortao = document.getElementById('btnUpdatePortao');
    const btnBomba = document.getElementById('btnUpdateBomba');
    if (btnPortao) { btnPortao.innerHTML = `<i class="ph ph-garage"></i> Atualizar Portão`; btnPortao.disabled = false; }
    if (btnBomba) { btnBomba.innerHTML = `<i class="ph ph-drop"></i> Atualizar Bomba`; btnBomba.disabled = false; }
}

// --- SSE EVENTOS ---
function conectarSSE() {
    const evtSource = new EventSource('/events');
    evtSource.onmessage = function(event) {
        const msg = event.data;
        
        // STATUS DA BOMBA:
        if (msg === "BOMBA_LIGADA") {
            document.getElementById('bombaStatusText').innerText = "Ligada (15 min)";
            document.getElementById('bombaStatusText').style.color = "#10b981"; 
            document.getElementById('bombaIndicator').style.borderColor = "#10b981";
            document.getElementById('bombaIndicator').style.boxShadow = "0 0 20px rgba(16, 185, 129, 0.4)";
            document.getElementById('bombaIcon').style.color = "#10b981";
        }
        else if (msg === "BOMBA_DESLIGADA") {
            document.getElementById('bombaStatusText').innerText = "Desligada";
            document.getElementById('bombaStatusText').style.color = "#94a3b8"; 
            document.getElementById('bombaIndicator').style.borderColor = "#333";
            document.getElementById('bombaIndicator').style.boxShadow = "none";
            document.getElementById('bombaIcon').style.color = "#555";
        }
        
        // STATUS REAL DO PORTÃO:
        else if(msg === "ESTADO_REAL_FECHADO") {
            if (timerMovimento) clearTimeout(timerMovimento);
            finalizarEstado("FECHADO");
            verificarFimUpdate();
        } 
        else if (msg === "ESTADO_REAL_ABERTO") {
            if (timerMovimento) return; 
            if (estadoAtual !== "PARADO") finalizarEstado("ABERTO");
            verificarFimUpdate();
        }
        
        // ATUALIZAÇÃO FIRMWARE:
        else if (msg === "PORTAO_STATUS_ATUALIZANDO_SISTEMA" || msg === "STATUS_ATUALIZANDO_BOMBA") {
             emProcessoDeUpdate = true;
             progressContainer.classList.remove('hidden');
             if (progressLabel) progressLabel.innerText = msg.includes("BOMBA") ? "Baixando Firmware Bomba..." : "Baixando Firmware Portão...";
             showToast("Firmware atualizando...", "info");
        }
        else if (msg === "PORTAO_ERRO_ATUALIZACAO" || msg === "ERRO_ATUALIZACAO_BOMBA") {
            emProcessoDeUpdate = false;
            progressContainer.classList.add('hidden');
            showToast("Erro na atualização!", "error");
            reativarBotoesUpdate();
        }
    };
}

function verificarFimUpdate() {
    if (emProcessoDeUpdate) {
        emProcessoDeUpdate = false;
        showToast("Firmware atualizado!", "success");
        progressContainer.classList.add('hidden');
        reativarBotoesUpdate();
        updateSuccessCheck.classList.remove('hidden');
        setTimeout(() => updateSuccessCheck.classList.add('hidden'), 5000);
    }
}