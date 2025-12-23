const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');

// --- VARIÁVEIS DE ESTADO ---
let timerInterval = null;
let estadoAtual = "DESCONHECIDO"; // FECHADO, ABRINDO, ABERTO, PARADO, FECHANDO
let tempoDecorrido = 0;
const TEMPO_TOTAL = 11000; // 11 segundos (Um pouco a mais por segurança)

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
    conectarSSE(); // Liga a "escuta" do status
}

function fazerLogout() {
    localStorage.removeItem('gate_token');
    fetch('/api/logout', { 
        method: 'POST', 
        headers: { 'Authorization': localStorage.getItem('gate_token') } 
    });
    location.reload();
}

// --- LÓGICA DO BOTÃO INTELIGENTE ---
async function interagirPortao() {
    const btn = document.getElementById('btnOpen');
    if(navigator.vibrate) navigator.vibrate(50); // Vibra celular

    // 1. Envia comando físico (Sempre o mesmo pulso)
    enviarComando();

    // 2. Atualiza a Interface (Adivinhando o que vai acontecer)
    if (estadoAtual === "FECHADO" || estadoAtual === "FECHANDO") {
        iniciarTimer("ABRINDO");
    } 
    else if (estadoAtual === "ABRINDO") {
        pararTimer("PARADO"); // Parou no meio
    } 
    else if (estadoAtual === "PARADO") {
        iniciarTimer("FECHANDO"); // Volta a fechar
    }
    else if (estadoAtual === "ABERTO") {
        iniciarTimer("FECHANDO");
    }
}

async function enviarComando() {
    const token = localStorage.getItem('gate_token');
    try {
        await fetch('/api/acionar', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': token 
            }
        });
    } catch (e) { console.error("Erro ao enviar comando"); }
}

// --- TIMER E BARRA DE PROGRESSO ---
function iniciarTimer(novoEstado) {
    estadoAtual = novoEstado;
    atualizarInterfaceBtn();

    const bar = document.getElementById('progressBar');
    const container = document.getElementById('progressContainer');
    
    container.classList.remove('hidden');
    
    // Reseta ou continua dependendo da lógica (aqui simplificado para reiniciar)
    tempoDecorrido = 0;
    bar.style.width = "0%";

    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        tempoDecorrido += 100;
        const porcentagem = (tempoDecorrido / TEMPO_TOTAL) * 100;
        bar.style.width = `${porcentagem}%`;

        // Se passar do tempo, assume que chegou no fim
        if (tempoDecorrido >= TEMPO_TOTAL) {
            clearInterval(timerInterval);
            finalizarMovimento();
        }
    }, 100);
}

function pararTimer(novoEstado) {
    if (timerInterval) clearInterval(timerInterval);
    estadoAtual = novoEstado;
    atualizarInterfaceBtn();
    
    // Muda cor da barra para Laranja (Pausa)
    document.getElementById('progressBar').style.backgroundColor = "#FFA500"; 
}

function finalizarMovimento() {
    document.getElementById('progressContainer').classList.add('hidden');
    
    if (estadoAtual === "ABRINDO") {
        estadoAtual = "ABERTO";
        atualizarStatus("PORTÃO ABERTO (Tempo Finalizado)", "#ff4444");
    } else {
        estadoAtual = "FECHADO";
    }
    atualizarInterfaceBtn();
}

// --- ATUALIZA O VISUAL DO BOTÃO ---
function atualizarInterfaceBtn() {
    const btn = document.getElementById('btnOpen');
    const label = document.getElementById('btnLabel');
    const icon = document.getElementById('iconBtn');

    // Remove todas as classes de cor
    btn.className = ""; 

    if (estadoAtual === "ABRINDO") {
        label.innerText = "Abrindo... Toque para PARAR";
        icon.innerText = "⏸"; // Ícone de Pause
        btn.classList.add('btn-opening');
    } else if (estadoAtual === "PARADO") {
        label.innerText = "Parado. Toque para FECHAR";
        icon.innerText = "🔽"; // Ícone para baixo
        btn.classList.add('btn-stopped');
    } else if (estadoAtual === "ABERTO") {
        label.innerText = "Aberto. Toque para FECHAR";
        icon.innerText = "🔽";
        btn.classList.add('btn-open');
    } else { // FECHADO
        label.innerText = "Toque para ABRIR";
        icon.innerText = "⚡";
    }
}

// --- CONEXÃO SSE (A VERDADE DO SENSOR) ---
function conectarSSE() {
    const evtSource = new EventSource('/events');
    
    evtSource.onmessage = function(event) {
        const msg = event.data;
        
        // Se o sensor magnético falar, ele manda mais que o timer
        if(msg === "ESTADO_REAL_FECHADO") {
            // Só sobrescreve se a gente não estiver no meio da contagem de abertura
            // Isso evita "piscadas" se o sensor tremer
            if (estadoAtual !== "ABRINDO") { 
                estadoAtual = "FECHADO";
                atualizarInterfaceBtn();
                document.getElementById('progressContainer').classList.add('hidden');
                atualizarStatus("PORTÃO FECHADO 🔒", "#4CAF50");
            }
        } 
        else if (msg === "ESTADO_REAL_ABERTO") {
            atualizarStatus("PORTÃO ABERTO 🔓", "#ff4444");
            
            // Se o app achava que estava fechado, mas o sensor disse aberto (alguém usou controle remoto)
            if (estadoAtual === "FECHADO") {
                estadoAtual = "ABERTO";
                atualizarInterfaceBtn();
            }
        }
        else if (msg.includes("STATUS_ABRINDO")) {
            // Feedback do ESP32 que recebeu comando
            console.log("ESP32 confirmou comando de abertura");
        }
    };
}

function atualizarStatus(texto, cor) {
    statusText.innerText = texto;
    statusText.style.color = cor;
    statusIndicator.style.backgroundColor = cor;
    statusIndicator.style.boxShadow = `0 0 15px ${cor}`;
}