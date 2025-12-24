const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');
const btnOpen = document.getElementById('btnOpen');

// --- VARIÁVEIS DE LÓGICA DO PORTÃO ---
let estadoAtual = "DESCONHECIDO"; // 'FECHADO', 'ABRINDO', 'ABERTO', 'FECHANDO', 'PARADO'
let timerMovimento = null;
const TEMPO_ABERTURA = 15000; // 15 segundos

// MEMÓRIA DE DIREÇÃO: Começamos assumindo que a última coisa que ele fez foi fechar
// Assim, o próximo comando lógico será ABRIR.
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
    // Efeito visual imediato
    btnOpen.style.borderColor = "#fff";
    if(navigator.vibrate) navigator.vibrate(50);
    setTimeout(() => btnOpen.style.borderColor = "#333", 300);

    // LÓGICA DE PREVISÃO (Aqui está a correção)
    gerenciarLogicaMovimento();

    // Envia comando ao servidor
    try {
        await fetch('/api/acionar', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': localStorage.getItem('gate_token') 
            }
        });
    } catch (e) {
        // Se der erro de rede, volta o status para erro mas não para a lógica visual 
        // (pois o relé pode ter acionado mesmo sem resposta HTTP)
        console.error("Erro no envio do comando");
    }
}

// --- LÓGICA INTELIGENTE (CÉREBRO DO APP) ---
function gerenciarLogicaMovimento() {
    // 1. Se estiver totalmente FECHADO -> Abre
    if (estadoAtual === "FECHADO") {
        iniciarAnimacao("ABRINDO");
    } 
    // 2. Se estiver totalmente ABERTO -> Fecha
    else if (estadoAtual === "ABERTO") {
        iniciarAnimacao("FECHANDO");
    }
    // 3. Se estiver SE MOVENDO -> PARA
    else if (estadoAtual === "ABRINDO" || estadoAtual === "FECHANDO") {
        pararAnimacao(); // Vai para estado PARADO
    }
    // 4. Se estiver PARADO -> INVERTE a direção anterior
    else if (estadoAtual === "PARADO") {
        if (ultimaDirecao === "ABRINDO") {
            // Se estava abrindo antes de parar, agora FECHA
            iniciarAnimacao("FECHANDO");
        } else {
            // Se estava fechando antes de parar, agora ABRE
            iniciarAnimacao("ABRINDO");
        }
    }
    // Caso de segurança (Desconhecido) -> Tenta abrir
    else {
        iniciarAnimacao("ABRINDO");
    }
}

function iniciarAnimacao(novoEstado) {
    estadoAtual = novoEstado;
    
    // Atualiza a memória de direção
    if (novoEstado === "ABRINDO" || novoEstado === "FECHANDO") {
        ultimaDirecao = novoEstado;
    }
    
    let texto = novoEstado === "ABRINDO" ? "Abrindo... 🔼" : "Fechando... 🔽";
    let cor = "#FFD700"; // Amarelo
    atualizarUI(texto, cor);

    // Cancela timer anterior se houver
    if (timerMovimento) clearTimeout(timerMovimento);

    // Inicia contagem de 15s
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
    
    // Antes de mudar para PARADO, salvamos o que ele estava fazendo
    // (Isso já é feito no iniciarAnimacao, mas reforçamos aqui se necessário)
    // O estadoAtual aqui ainda é "ABRINDO" ou "FECHANDO" antes de mudar a linha abaixo
    ultimaDirecao = estadoAtual; 

    estadoAtual = "PARADO";
    atualizarUI("PARADO ✋", "#ff8800"); // Laranja
}

function finalizarEstado(estadoFinal) {
    estadoAtual = estadoFinal;
    if (estadoFinal === "ABERTO") {
        atualizarUI("PORTÃO ABERTO 🔓", "#ff4444"); // Vermelho
        ultimaDirecao = "ABRINDO"; // Garante memória
    } else {
        atualizarUI("PORTÃO FECHADO 🔒", "#4CAF50"); // Verde
        ultimaDirecao = "FECHANDO"; // Garante memória
    }
}

// --- ESCUTA DO SERVIDOR (SSE) ---
function conectarSSE() {
    const evtSource = new EventSource('/events');
    
    evtSource.onmessage = function(event) {
        const msg = event.data;
        
        // Proteção para não quebrar a animação de 15s
        const estamosMovendo = (estadoAtual === "ABRINDO" || estadoAtual === "FECHANDO");
        const estamosParados = (estadoAtual === "PARADO");

        if(msg === "ESTADO_REAL_FECHADO") {
            // O sensor físico manda mais que qualquer lógica
            if (timerMovimento) clearTimeout(timerMovimento);
            finalizarEstado("FECHADO");
        } 
        else if (msg === "ESTADO_REAL_ABERTO") {
            // Só aceita "Aberto" do servidor se não estivermos no meio de uma lógica manual
            // Ou se o app acabou de abrir ("DESCONHECIDO" ou "AGUARDANDO")
            if (!estamosMovendo && !estamosParados) {
                finalizarEstado("ABERTO");
            }
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