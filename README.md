# 🏠 Smart Gate Pro v2.1

> **Sistema de Controle de Portão Residencial via Web (PWA)**

O **Smart Gate Pro** é uma solução IoT robusta para controle de portões eletrônicos residenciais. Focado em estabilidade e experiência do usuário, ele combina um firmware ESP32 com "Filtro de Ruído" (para evitar leituras falsas de sensores), uma interface Web/PWA responsiva com atualizações em tempo real (SSE) e notificações push inteligentes.

![Status](https://img.shields.io/badge/Status-Stable-success)
![Stack](https://img.shields.io/badge/Stack-NodeJS%20|%20ESP32%20|%20MQTT-blue)

## ✨ Diferenciais e Funcionalidades

* **⚡ Real-Time Feedback:** Usa *Server-Sent Events (SSE)* para mostrar o status do portão (Abrindo/Fechando/Aberto) instantaneamente na tela do celular, sem "refresh".
* **🔔 Notificações Inteligentes:** Integração nativa com **Ntfy.sh** para alertar quando o portão abre, informando *quem* abriu (Usuário Web, Controle Físico, etc.).
* **🛡️ Filtro de Ruído (Anti-Bouncing):** Algoritmo no firmware que ignora oscilações do sensor magnético causadas pela vibração do motor durante o curso.
* **☁️ Atualização OTA:** Permite atualizar o código do ESP32 remotamente clicando em um botão no painel web.
* **📱 PWA Ready:** Pode ser instalado no Android/iOS como um aplicativo nativo.

## 🏗️ Arquitetura

1.  **Hardware (ESP32):** Controla o relé e lê o sensor magnético. Comunica-se via MQTT (TLS) com a nuvem.
2.  **Servidor (Node.js):** Atua como "cérebro", autenticando usuários, servindo a interface web e enviando notificações push.
3.  **Broker (HiveMQ):** Canal seguro de troca de mensagens.

---

## 🚀 Instalação e Configuração

### 1. Configuração do Servidor (Backend)

Este servidor Node.js serve tanto a API quanto a interface visual.

1.  **Instale as dependências:**
    ```bash
    npm install
    ```
2.  **Configure o ambiente:**
    Renomeie o arquivo `.env.example` para `.env` e preencha suas credenciais MQTT e senha de acesso.
3.  **Inicie o servidor:**
    ```bash
    npm start
    ```
    *O sistema rodará na porta definida (padrão 3000).*

### 2. Configuração do Hardware (ESP32)

1.  Abra o arquivo `ControlePortaoLG.ino` na Arduino IDE.
2.  Instale as bibliotecas necessárias:
    * `PubSubClient` (Nick O'Leary)
    * `WiFi` e `WiFiClientSecure` (Nativas ESP32)
3.  **Segredos:** Renomeie `secrets-example.h` para `secrets.h` e insira suas credenciais Wi-Fi e MQTT.
4.  **Upload:** Carregue o código na sua placa ESP32.
5.  **Hardware:**
    * Pino **18**: Relé (Acionamento)
    * Pino **4**: Sensor Magnético (Fim de curso fechado)

---

## 🛠️ Variáveis de Ambiente e Segredos

O sistema exige dois arquivos de configuração sensíveis que não devem ser versionados.

### Backend (`.env`)
Define a conexão com o Broker MQTT e a senha de acesso ao painel web.

### Firmware (`secrets.h`)
Define as credenciais Wi-Fi e MQTT hardcoded no chip para garantir reconexão automática.

---

## 📱 Como usar (PWA)

1.  Acesse o IP/URL do seu servidor pelo navegador do celular (Chrome/Safari).
2.  No Android: Toque em "Instalar App" ou "Adicionar à Tela Inicial".
3.  No iOS: Toque em "Compartilhar" > "Adicionar à Tela de Início".
4.  O ícone do **Smart Gate** aparecerá no seu menu como um app nativo.

## 📄 Licença

Projeto desenvolvido para uso pessoal/residencial.