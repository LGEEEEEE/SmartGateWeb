const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const statusText = document.getElementById('statusText');
const statusIndicator = document.getElementById('statusIndicator');

// --- VERIFICA SESSÃO AO ABRIR ---
// Se já tiver token salvo, pula o login
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
            // SALVA A SESSÃO NO CELULAR
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
    conectarSSE(); // Inicia a escuta do status
}

function fazerLogout() {
    localStorage.removeItem('gate_token'); // Apaga a sessão
    // Avisa o servidor (opcional)
    fetch('/api/logout', { 
        method: 'POST', 
        headers: { 'Authorization': localStorage.getItem('gate_token') } 
    });
    location.reload(); // Recarrega a página para voltar pro login
}

async function abrirPortao() {
    const btn = document.getElementById('btnOpen');
    
    // Efeito visual de clique
    btn.style.borderColor = "#4CAF50";
    if(navigator.vibrate) navigator.vibrate(100);

    const token = localStorage.getItem('gate_token');

    try {
        const res = await fetch('/api/acionar', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': token // ENVIA O TOKEN, NÃO A SENHA
            }
        });

        if (res.status === 403) {
            alert("Sessão expirada!");
            fazerLogout();
        } else if (res.ok) {
            console.log("Comando enviado");
        }
    } catch (e) {
        alert("Erro de conexão");
    }

    setTimeout(() => btn.style.borderColor = "#333", 500);
}

// --- STATUS EM TEMPO REAL ---
function conectarSSE() {
    const evtSource = new EventSource('/events');
    
    evtSource.onmessage = function(event) {
        const msg = event.data;
        
        if(msg === "STATUS_ABRINDO") {
            atualizarStatus("Abrindo... 🔼", "#FFD700");
        } else if(msg === "STATUS_FECHANDO") {
            atualizarStatus("Fechando... 🔽", "#FFD700");
        } else if(msg === "ESTADO_REAL_ABERTO") {
            atualizarStatus("PORTÃO ABERTO 🔓", "#ff4444");
        } else if(msg === "ESTADO_REAL_FECHADO") {
            atualizarStatus("PORTÃO FECHADO 🔒", "#4CAF50");
        }
    };
}

function atualizarStatus(texto, cor) {
    statusText.innerText = texto;
    statusText.style.color = cor;
    statusIndicator.style.backgroundColor = cor;
    statusIndicator.style.boxShadow = `0 0 15px ${cor}`;
}