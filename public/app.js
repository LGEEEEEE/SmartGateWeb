const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');
const btnOpen = document.getElementById('btnOpen');

// --- VARIÁVEIS DE LÓGICA DO PORTÃO ---
let estadoAtual = "DESCONHECIDO"; 
let timerMovimento = null;
const TEMPO_ABERTURA = 15000; 

// MEMÓRIA DE DIREÇÃO
let ultimaDirecao = "FECHANDO"; 

// --- INICIALIZAÇÃO ---
const savedToken = localStorage.getItem('gate_token');
if (savedToken) {
    mostrarApp();
}

async function fazerLogin() {
    const password = document.getElementById('passwordInput').value;
    const btn = document.getElementById('btnLogin');
    const errorMsg = document.getElementById('loginError');

    btn.innerText = "Verificando...";
    btn.disabled = true;

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('gate_token', data.token);
            mostrarApp();
        } else {
            errorMsg.innerText = "Senha Incorreta!";
        }
    } catch (e) {
        errorMsg.innerText = "Erro de conexão";
    }
    btn.innerText = "ENTRAR";
    btn.disabled = false;
}

function mostrarApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    conectarSSE();
}

function fazerLogout() {
    localStorage.removeItem('gate_token');
    location.reload();
}

// --- COMANDO DE ACIONAMENTO ---
async function abrirPortao() {
    btnOpen.style.borderColor = "#fff";
    if(navigator.vibrate) navigator.vibrate(50);
    setTimeout(() => btnOpen.style.borderColor = "#333", 300);

    gerenciarLogicaMovimento();

    try {
        await fetch('/api/acionar', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': localStorage.getItem('gate_token') 
            }
        });
    } catch (e) {
        console.error("Erro no envio do comando");
    }
}

// --- LÓGICA INTELIGENTE ---
function gerenciarLogicaMovimento() {
    if (estadoAtual === "FECHADO") {
        iniciarAnimacao("ABRINDO");
    } 
    else if (estadoAtual === "ABERTO") {
        iniciarAnimacao("FECHANDO");
    }
    else if (estadoAtual === "ABRINDO" || estadoAtual === "FECHANDO") {
        pararAnimacao(); 
    }
    else if (estadoAtual === "PARADO") {
        if (ultimaDirecao === "ABRINDO") {
            iniciarAnimacao("FECHANDO");
        } else {
            iniciarAnimacao("ABRINDO");
        }
    }
    else {
        iniciarAnimacao("ABRINDO");
    }
}

function iniciarAnimacao(novoEstado) {
    estadoAtual = novoEstado;
    if (novoEstado === "ABRINDO" || novoEstado === "FECHANDO") {
        ultimaDirecao = novoEstado;
    }
    
    let texto = novoEstado === "ABRINDO" ? "Abrindo... 🔼" : "Fechando... 🔽";
    let cor = "#FFD700"; 
    atualizarUI(texto, cor);

    if (timerMovimento) clearTimeout(timerMovimento);

    timerMovimento = setTimeout(() => {
        if (novoEstado === "ABRINDO") {
            finalizarEstado("ABERTO");
        } else {
            finalizarEstado("FECHADO"); 
        }
    }, TEMPO_ABERTURA);
}

function pararAnimacao() {
    if (timerMovimento) clearTimeout(timerMovimento);
    ultimaDirecao = estadoAtual; 
    estadoAtual = "PARADO";
    atualizarUI("PARADO ✋", "#ff8800"); 
}

function finalizarEstado(estadoFinal) {
    estadoAtual = estadoFinal;
    if (estadoFinal === "ABERTO") {
        atualizarUI("PORTÃO ABERTO 🔓", "#ff4444"); 
        ultimaDirecao = "ABRINDO"; 
    } else {
        atualizarUI("PORTÃO FECHADO 🔒", "#4CAF50"); 
        ultimaDirecao = "FECHANDO"; 
    }
}

// --- ESCUTA DO SERVIDOR (SSE) ---
function conectarSSE() {
    const evtSource = new EventSource('/events');
    
    evtSource.onmessage = function(event) {
        const msg = event.data;
        
        const estamosMovendo = (estadoAtual === "ABRINDO" || estadoAtual === "FECHANDO");
        const estamosParados = (estadoAtual === "PARADO");

        if(msg === "ESTADO_REAL_FECHADO") {
            if (timerMovimento) clearTimeout(timerMovimento);
            finalizarEstado("FECHADO");
        } 
        else if (msg === "ESTADO_REAL_ABERTO") {
            if (!estamosMovendo && !estamosParados) {
                finalizarEstado("ABERTO");
            }
        }
        else if (msg === "STATUS_ATUALIZANDO_SISTEMA") {
             atualizarUI("ATUALIZANDO FIRMWARE... ☁️", "#00d2ff");
        }
        else if (msg === "AGUARDANDO_ATUALIZACAO") {
            if(estadoAtual === "DESCONHECIDO") {
                atualizarUI("Conectado.", "#888");
            }
        }
    };
}

function atualizarUI(texto, cor) {
    statusText.innerText = texto;
    statusText.style.color = cor;
    statusIndicator.style.backgroundColor = cor;
    statusIndicator.style.boxShadow = `0 0 15px ${cor}`;
}

// --- FUNÇÃO DE ATUALIZAÇÃO (OTA) ---
async function solicitarUpdate() {
    const confirmar = confirm(
        "⚠️ ATENÇÃO: ATUALIZAÇÃO DE SISTEMA\n\n" +
        "Isso fará o ESP32 baixar a versão mais recente do arquivo .bin no seu GitHub.\n\n" +
        "1. Você já subiu o arquivo novo?\n" +
        "2. O portão vai reiniciar sozinho.\n\n" +
        "Deseja continuar?"
    );

    if (!confirmar) return;

    const btn = document.querySelector('.btn-update');
    const textoOriginal = btn.innerText;
    
    btn.innerText = "⏳ Enviando...";
    btn.disabled = true;
    btn.style.opacity = "0.5";

    try {
        const res = await fetch('/api/admin/update', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': localStorage.getItem('gate_token') 
            }
        });
        
        const data = await res.json();
        
        if (data.success) {
            alert("✅ Comando Enviado!\n\nFique de olho no LED do ESP32 ou no status aqui no app.");
        } else {
            alert("❌ Erro: " + (data.error || "Falha desconhecida"));
        }
    } catch (e) {
        alert("❌ Erro de conexão com o servidor.");
        console.error(e);
    }

    btn.innerText = textoOriginal;
    btn.disabled = false;
    btn.style.opacity = "1";
}