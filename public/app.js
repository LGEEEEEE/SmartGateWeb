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
const TEMPO_CICLO = 15000;  
let ultimaDirecao = "FECHANDO"; 
let emProcessoDeUpdate = false; 

// --- VARIÁVEIS DE ESTADO BOMBA ---
let bombaCountdownTimer = null;
let tempoRestanteBomba = 0; 
let tipoContagemAtual = "LIGADA"; // Pode ser "LIGADA" ou "ESPERA"

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
    }).catch(e => console.log("Erro inicial portão"));

    fetch('/api/acionar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') },
        body: JSON.stringify({ dispositivo: "bomba", comando_customizado: "CHECAR_STATUS" }) 
    }).catch(e => console.log("Erro inicial bomba"));
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

// --- CONTROLES DA BOMBA E CONTAGEM REGRESSIVA ---
function toggleModoBomba() {
    const modo = document.querySelector('input[name="modoBomba"]:checked').value;
    const divDescanso = document.getElementById('divTempoDescanso');
    if(modo === 'intercalado') {
        divDescanso.style.display = 'block';
    } else {
        divDescanso.style.display = 'none';
    }
}

async function controlarBomba(comandoBase) {
    if(navigator.vibrate) navigator.vibrate(50);
    
    let comandoFinal = comandoBase;
    
    if (comandoBase === "LIGAR_BOMBA") {
        const tempoLigado = document.getElementById('tempoBomba').value;
        const modo = document.querySelector('input[name="modoBomba"]:checked').value;
        
        if (modo === "intercalado") {
            const tempoDesligado = document.getElementById('tempoDescanso').value;
            comandoFinal = `LIGAR_BOMBA|${tempoLigado}|${tempoDesligado}`;
            showToast("Iniciando ciclo intercalado...", "info");
        } else {
            comandoFinal = `LIGAR_BOMBA|${tempoLigado}|0`;
            showToast("Ligando bomba...", "info");
        }
    } else {
        showToast("Encerrando ciclo da bomba...", "info");
    }

    try {
        await fetch('/api/acionar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') },
            body: JSON.stringify({ dispositivo: "bomba", comando_customizado: comandoFinal })
        });
    } catch (e) { showToast("Erro ao comunicar com a bomba", "error"); }
}

function iniciarContagemBomba(segundosRestantes, tipo = "LIGADA") {
    if (bombaCountdownTimer) clearInterval(bombaCountdownTimer);
    
    tempoRestanteBomba = segundosRestantes; 
    tipoContagemAtual = tipo;
    atualizarTextoContagem(); 
    
    bombaCountdownTimer = setInterval(() => {
        tempoRestanteBomba--;
        if (tempoRestanteBomba <= 0) {
            clearInterval(bombaCountdownTimer);
            document.getElementById('bombaStatusText').innerText = "Alternando...";
        } else {
            atualizarTextoContagem();
        }
    }, 1000);
}

function atualizarTextoContagem() {
    const min = Math.floor(tempoRestanteBomba / 60);
    const seg = tempoRestanteBomba % 60;
    const tempoFormatado = `${min.toString().padStart(2, '0')}:${seg.toString().padStart(2, '0')}`;
    
    if (tipoContagemAtual === "ESPERA") {
        document.getElementById('bombaStatusText').innerText = `Em Pausa (${tempoFormatado})`;
    } else {
        document.getElementById('bombaStatusText').innerText = `Ligada (${tempoFormatado})`;
    }
}

function pararContagemBomba() {
    if (bombaCountdownTimer) clearInterval(bombaCountdownTimer);
    document.getElementById('bombaStatusText').innerText = "Desligada (Ciclo Parado)";
    document.getElementById('bombaStatusText').style.color = "#94a3b8"; 
    document.getElementById('bombaIndicator').style.borderColor = "#333";
    document.getElementById('bombaIndicator').style.boxShadow = "none";
    document.getElementById('bombaIcon').className = "ph ph-power";
    document.getElementById('bombaIcon').style.color = "#555";
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
    let cor = "#f59e0b"; 
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
        
        // STATUS DA BOMBA (LIGADA):
        if (msg.startsWith("BOMBA_LIGADA")) {
            let tempoAtivo = "15"; 
            let segundosRestantes = null;

            if (msg.includes("|")) {
                let partes = msg.split("|");
                tempoAtivo = partes[1]; 
                if (partes.length > 2) { segundosRestantes = parseInt(partes[2]); }
            }
            
            let segundosParaContar = segundosRestantes !== null ? segundosRestantes : parseInt(tempoAtivo) * 60;
            iniciarContagemBomba(segundosParaContar, "LIGADA");
            
            document.getElementById('bombaStatusText').style.color = "#10b981"; // Verde
            document.getElementById('bombaIndicator').style.borderColor = "#10b981";
            document.getElementById('bombaIndicator').style.boxShadow = "0 0 20px rgba(16, 185, 129, 0.4)";
            document.getElementById('bombaIcon').className = "ph ph-drop";
            document.getElementById('bombaIcon').style.color = "#10b981";
            verificarFimUpdate();
        }
        
        // STATUS DA BOMBA (EM ESPERA / PAUSA PARA DESCANSAR):
        else if (msg.startsWith("BOMBA_ESPERA")) {
            let tempoPausa = "60"; 
            let segundosRestantes = null;

            if (msg.includes("|")) {
                let partes = msg.split("|");
                tempoPausa = partes[1]; 
                if (partes.length > 2) { segundosRestantes = parseInt(partes[2]); }
            }
            
            let segundosParaContar = segundosRestantes !== null ? segundosRestantes : parseInt(tempoPausa) * 60;
            iniciarContagemBomba(segundosParaContar, "ESPERA");
            
            document.getElementById('bombaStatusText').style.color = "#f59e0b"; // Amarelo
            document.getElementById('bombaIndicator').style.borderColor = "#f59e0b";
            document.getElementById('bombaIndicator').style.boxShadow = "0 0 20px rgba(245, 158, 11, 0.4)";
            document.getElementById('bombaIcon').className = "ph ph-timer";
            document.getElementById('bombaIcon').style.color = "#f59e0b";
            verificarFimUpdate();
        }
        
        // STATUS DA BOMBA (TOTALMENTE DESLIGADA):
        else if (msg === "BOMBA_DESLIGADA") {
            pararContagemBomba();
            verificarFimUpdate(); 
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