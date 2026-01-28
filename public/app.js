const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');
const btnOpen = document.getElementById('btnOpen');
const updateSuccessCheck = document.getElementById('updateSuccessCheck');

// --- VARIÁVEIS DE ESTADO ---
let estadoAtual = "DESCONHECIDO"; 
let timerMovimento = null;
const TEMPO_ABERTURA = 15000; 
let ultimaDirecao = "FECHANDO"; 
let emProcessoDeUpdate = false; // Flag para saber se estamos atualizando

const savedToken = localStorage.getItem('gate_token');
if (savedToken) mostrarApp();

// --- SISTEMA DE TOASTS (NOTIFICAÇÕES) ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Ícone baseado no tipo
    let icon = '';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '❌';
    else icon = 'ℹ️';

    toast.innerHTML = `<span>${icon} ${message}</span>`;
    container.appendChild(toast);

    // Remove após 3.5 segundos
    setTimeout(() => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove());
    }, 3500);
}

// --- LÓGICA DE LOGIN ---
async function fazerLogin() {
    const password = document.getElementById('passwordInput').value;
    const btn = document.getElementById('btnLogin');
    const errorMsg = document.getElementById('loginError');

    btn.innerText = "Verificando..."; btn.disabled = true;
    try {
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (data.success) {
            localStorage.setItem('gate_token', data.token);
            mostrarApp();
            showToast("Login realizado com sucesso!", "success");
        } else {
            errorMsg.innerText = "Senha Incorreta!";
            showToast("Senha incorreta", "error");
        }
    } catch (e) { 
        errorMsg.innerText = "Erro de conexão";
        showToast("Erro ao conectar com servidor", "error");
    }
    btn.innerText = "ENTRAR"; btn.disabled = false;
}

function mostrarApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    conectarSSE();

    // Teste inicial silencioso
    fetch('/api/acionar', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': localStorage.getItem('gate_token') 
        },
        body: JSON.stringify({ comando_customizado: "CHECAR_STATUS" }) 
    }).catch(e => console.log("Erro ao pedir status inicial"));
}

function fazerLogout() {
    localStorage.removeItem('gate_token');
    location.reload();
}

// --- COMANDOS ---
async function abrirPortao() {
    btnOpen.style.borderColor = "#fff";
    if(navigator.vibrate) navigator.vibrate(50);
    setTimeout(() => btnOpen.style.borderColor = "#333", 300);
    gerenciarLogicaMovimento();
    try {
        await fetch('/api/acionar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') }
        });
    } catch (e) { 
        console.error("Erro comando");
        showToast("Erro ao enviar comando", "error");
    }
}

// --- ATUALIZAÇÃO FIRMWARE (OTA) ---
async function solicitarUpdate() {
    if (!confirm("⚠️ Confirmar atualização?\n\nO portão irá reiniciar para baixar a versão mais recente do GitHub.")) return;
    
    const btn = document.querySelector('.btn-update');
    btn.innerText = "⏳ Enviando..."; btn.disabled = true;
    
    try {
        const res = await fetch('/api/admin/update', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') }
        });
        const data = await res.json();
        
        if (data.success) {
            showToast("Comando enviado! Aguarde o reinício...", "info");
        } else {
            showToast("Erro: " + data.error, "error");
            btn.innerText = "☁️ Instalar Atualização"; btn.disabled = false;
        }
    } catch (e) { 
        showToast("Erro de conexão.", "error");
        btn.innerText = "☁️ Instalar Atualização"; btn.disabled = false;
    }
}

// --- LÓGICA DE MOVIMENTO (SIMULAÇÃO VISUAL) ---
function gerenciarLogicaMovimento() {
    if (estadoAtual === "FECHADO") iniciarAnimacao("ABRINDO");
    else if (estadoAtual === "ABERTO") iniciarAnimacao("FECHANDO");
    else if (estadoAtual === "ABRINDO" || estadoAtual === "FECHANDO") pararAnimacao(); 
    else if (estadoAtual === "PARADO") (ultimaDirecao === "ABRINDO") ? iniciarAnimacao("FECHANDO") : iniciarAnimacao("ABRINDO");
    else iniciarAnimacao("ABRINDO");
}

function iniciarAnimacao(novoEstado) {
    estadoAtual = novoEstado;
    if (novoEstado === "ABRINDO" || novoEstado === "FECHANDO") ultimaDirecao = novoEstado;
    let texto = novoEstado === "ABRINDO" ? "Abrindo... 🔼" : "Fechando... 🔽";
    let cor = "#FFD700"; 
    atualizarUI(texto, cor);
    if (timerMovimento) clearTimeout(timerMovimento);
    timerMovimento = setTimeout(() => {
        (novoEstado === "ABRINDO") ? finalizarEstado("ABERTO") : finalizarEstado("FECHADO"); 
    }, TEMPO_ABERTURA);
}

function pararAnimacao() {
    if (timerMovimento) clearTimeout(timerMovimento);
    ultimaDirecao = estadoAtual; estadoAtual = "PARADO";
    atualizarUI("PARADO ✋", "#ff8800"); 
}

function finalizarEstado(estadoFinal) {
    estadoAtual = estadoFinal;
    if (estadoFinal === "ABERTO") { atualizarUI("PORTÃO ABERTO 🔓", "#ff4444"); ultimaDirecao = "ABRINDO"; } 
    else { atualizarUI("PORTÃO FECHADO 🔒", "#4CAF50"); ultimaDirecao = "FECHANDO"; }
}

// --- SSE (Ouvindo o Servidor) ---
function conectarSSE() {
    const evtSource = new EventSource('/events');
    evtSource.onmessage = function(event) {
        const msg = event.data;
        const movendo = (estadoAtual === "ABRINDO" || estadoAtual === "FECHANDO");
        
        // 1. Recebemos status normal (Aberto/Fechado)
        if(msg === "ESTADO_REAL_FECHADO" || msg === "ESTADO_REAL_ABERTO") {
            
            // LÓGICA DE SUCESSO DO UPDATE
            // Se estávamos atualizando e agora recebemos um estado real, significa que o ESP voltou!
            if (emProcessoDeUpdate) {
                emProcessoDeUpdate = false;
                showToast("Firmware atualizado com sucesso!", "success");
                
                // Restaura botão e mostra check verde
                const btn = document.querySelector('.btn-update');
                btn.innerText = "☁️ Instalar Atualização"; btn.disabled = false;
                updateSuccessCheck.classList.remove('hidden');
                
                // Esconde o check depois de 10s
                setTimeout(() => updateSuccessCheck.classList.add('hidden'), 10000);
            }

            if(msg === "ESTADO_REAL_FECHADO") {
                if (timerMovimento) clearTimeout(timerMovimento);
                finalizarEstado("FECHADO");
            } 
            else if (msg === "ESTADO_REAL_ABERTO") {
                if (!movendo && estadoAtual !== "PARADO") finalizarEstado("ABERTO");
            }
        }
        
        // 2. Recebemos aviso que está atualizando
        else if (msg === "STATUS_ATUALIZANDO_SISTEMA") {
             emProcessoDeUpdate = true;
             atualizarUI("ATUALIZANDO FIRMWARE... ☁️", "#00d2ff");
             showToast("Download iniciado no Portão...", "info");
        }
        
        else if (msg === "ERRO_ATUALIZACAO") {
            emProcessoDeUpdate = false;
            showToast("Falha na atualização do Firmware!", "error");
            const btn = document.querySelector('.btn-update');
            btn.innerText = "☁️ Tentar Novamente"; btn.disabled = false;
        }
    };
    
    evtSource.onerror = function() {
        // Se cair a conexão (comum durante restart do ESP se o server depender dele)
        console.log("Conexão SSE oscilou...");
    };
}

function atualizarUI(texto, cor) {
    statusText.innerText = texto; statusText.style.color = cor;
    statusIndicator.style.backgroundColor = cor; statusIndicator.style.boxShadow = `0 0 15px ${cor}`;
}