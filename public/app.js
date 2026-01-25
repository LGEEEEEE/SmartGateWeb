const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');
const btnOpen = document.getElementById('btnOpen');

let estadoAtual = "DESCONHECIDO"; 
let timerMovimento = null;
const TEMPO_ABERTURA = 15000; 
let ultimaDirecao = "FECHANDO"; 

const savedToken = localStorage.getItem('gate_token');
if (savedToken) mostrarApp();

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
        } else {
            errorMsg.innerText = "Senha Incorreta!";
        }
    } catch (e) { errorMsg.innerText = "Erro de conexão"; }
    btn.innerText = "ENTRAR"; btn.disabled = false;
}

function mostrarApp() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    conectarSSE();

    // >>> O TESTE AUTOMÁTICO <<<
    // Assim que a tela abre, pergunta pro ESP32: "Qual seu status real?"
    fetch('/api/acionar', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': localStorage.getItem('gate_token') 
        },
        // Envia o comando customizado que criamos no ESP32
        body: JSON.stringify({ comando_customizado: "CHECAR_STATUS" }) 
    }).catch(e => console.log("Erro ao pedir status inicial"));
}

function fazerLogout() {
    localStorage.removeItem('gate_token');
    location.reload();
}

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
    } catch (e) { console.error("Erro comando"); }
}

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

function conectarSSE() {
    const evtSource = new EventSource('/events');
    evtSource.onmessage = function(event) {
        const msg = event.data;
        const movendo = (estadoAtual === "ABRINDO" || estadoAtual === "FECHANDO");
        
        if(msg === "ESTADO_REAL_FECHADO") {
            if (timerMovimento) clearTimeout(timerMovimento);
            finalizarEstado("FECHADO");
        } 
        else if (msg === "ESTADO_REAL_ABERTO") {
            if (!movendo && estadoAtual !== "PARADO") finalizarEstado("ABERTO");
        }
        else if (msg === "STATUS_ATUALIZANDO_SISTEMA") atualizarUI("ATUALIZANDO FIRMWARE... ☁️", "#00d2ff");
    };
}

function atualizarUI(texto, cor) {
    statusText.innerText = texto; statusText.style.color = cor;
    statusIndicator.style.backgroundColor = cor; statusIndicator.style.boxShadow = `0 0 15px ${cor}`;
}

async function solicitarUpdate() {
    if (!confirm("⚠️ Atualizar Firmware OTA?\nO portão irá reiniciar.")) return;
    const btn = document.querySelector('.btn-update');
    btn.innerText = "⏳ Enviando..."; btn.disabled = true;
    try {
        await fetch('/api/admin/update', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('gate_token') }
        });
        alert("✅ Comando Enviado!");
    } catch (e) { alert("❌ Erro conexão."); }
    btn.innerText = "☁️ Instalar Atualização"; btn.disabled = false;
}