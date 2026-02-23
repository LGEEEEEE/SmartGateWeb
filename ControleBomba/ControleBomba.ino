/*
  ARQUIVO: ControleBomba.ino
  DESCRIÇÃO: Firmware SmartPump com Captive Portal, Relé Seguro, OTA e WatchDog Lógico.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <esp_task_wdt.h>
#include <DNSServer.h> 
#include <HTTPUpdate.h> 
#include "secrets.h" 

// --- CONFIGURAÇÃO OTA WEB ---
#define URL_FIRMWARE_BOMBA "https://raw.githubusercontent.com/LGEEEEEE/SmartGateWeb/main/ControleBomba/build/esp32.esp32.esp32doit-devkit-v1/ControleBomba.ino.bin"

// --- CONFIGURAÇÃO WATCHDOG HARDWARE ---
#define WDT_TIMEOUT 15 // 15 Segundos para o WDT interno

// --- LÓGICA DE REINÍCIO (WATCHDOG DE CONEXÃO) ---
const int MAX_TENTATIVAS_MQTT = 15;
int tentativasFalhas = 0;

// --- HARDWARE DA BOMBA ---
const int PINO_RELE_REAL = 18;  
const int PINO_FANTASMA = 23;   
const int PINO_LED = 2;         
const int PINO_RESET_CONFIG = 0;

// --- OBJETOS DE REDE ---
WebServer server(80);
DNSServer dnsServer;
const byte DNS_PORT = 53;

Preferences preferences;
WiFiClientSecure espClient;
PubSubClient client(espClient);

// --- VARIÁVEIS DO SISTEMA ---
String ssid_str = "";
String pass_str = "";
bool emModoConfig = false;

// Tópicos MQTT 
const char* TOPIC_COMMAND_BOMBA = "projeto_LG/casa/bomba/cmd";
const char* TOPIC_STATUS = "projeto_LG/casa/bomba/status";

// --- CONTROLE DA BOMBA ---
unsigned long tempoInicioBomba = 0;
const unsigned long TEMPO_MAX_LIGADA = 15 * 60 * 1000; 
bool bombaLigada = false;

String getDeviceID() {
  uint64_t chipid = ESP.getEfuseMac();
  uint16_t chip = (uint16_t)(chipid >> 32);
  char hex[13];
  snprintf(hex, 13, "%04X%08X", chip, (uint32_t)chipid);
  return String(hex);
}
String deviceID;

void publicarStatusBomba() {
    if (bombaLigada) {
        client.publish(TOPIC_STATUS, "BOMBA_LIGADA", true);
        Serial.println("[STATUS] Enviado: LIGADA");
    } else {
        client.publish(TOPIC_STATUS, "BOMBA_DESLIGADA", true);
        Serial.println("[STATUS] Enviado: DESLIGADA");
    }
}

void controlarBomba(bool ligar) {
    if (ligar && !bombaLigada) {
        Serial.println("\n>>> LIGANDO BOMBA (15 MIN) <<<");
        pinMode(PINO_RELE_REAL, OUTPUT);
        digitalWrite(PINO_RELE_REAL, HIGH); 
        delay(50);
        digitalWrite(PINO_RELE_REAL, LOW);
        
        bombaLigada = true;
        tempoInicioBomba = millis();
        publicarStatusBomba();
    } 
    else if (!ligar && bombaLigada) {
        Serial.println("\n>>> DESLIGANDO BOMBA <<<");
        digitalWrite(PINO_RELE_REAL, HIGH);
        delay(50);
        pinMode(PINO_RELE_REAL, INPUT);     
        
        bombaLigada = false;
        tempoInicioBomba = 0;
        publicarStatusBomba();
    }
}

void realizarUpdateFirmwareBomba() {
  Serial.println("\n[UPDATE] Iniciando atualização OTA da Bomba...");
  client.publish(TOPIC_STATUS, "STATUS_ATUALIZANDO_BOMBA", true);
  
  WiFiClientSecure clientOTA;
  clientOTA.setInsecure();
  t_httpUpdate_return ret = httpUpdate.update(clientOTA, URL_FIRMWARE_BOMBA);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[UPDATE] FALHA (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
      client.publish(TOPIC_STATUS, "ERRO_ATUALIZACAO_BOMBA", true);
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[UPDATE] Nenhuma atualização necessária.");
      break;
    case HTTP_UPDATE_OK:
      Serial.println("[UPDATE] OK! Reiniciando...");
      break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n\n--- INICIANDO SMART PUMP V3.1 (WATCHDOG) ---");
  deviceID = "Bomba_" + getDeviceID();
  Serial.printf("[SYSTEM] Device ID: %s\n", deviceID.c_str());
  
  pinMode(PINO_RELE_REAL, INPUT);
  pinMode(PINO_FANTASMA, OUTPUT); 
  digitalWrite(PINO_FANTASMA, LOW); 
  
  pinMode(PINO_LED, OUTPUT);
  pinMode(PINO_RESET_CONFIG, INPUT_PULLUP);

  preferences.begin("pump_config", false);

  if (digitalRead(PINO_RESET_CONFIG) == LOW) {
    Serial.println("[RESET] Botão BOOT detectado! Limpando Wi-Fi...");
    for(int i=0; i<5; i++) { digitalWrite(PINO_LED, !digitalRead(PINO_LED)); delay(100); }
    preferences.clear();
    ESP.restart();
  }

  ssid_str = preferences.getString("ssid", "");
  pass_str = preferences.getString("pass", "");
  
  if (ssid_str == "") {
      Serial.println("[MODE] Nenhuma rede configurada. Entrando em Modo AP.");
      setupModoConfiguracao();
  } else {
      Serial.println("[MODE] Rede encontrada. Conectando...");
      setupModoOperacao();
  }

  esp_task_wdt_config_t wdt_config = { .timeout_ms = WDT_TIMEOUT * 1000, .idle_core_mask = 0, .trigger_panic = true };
  esp_task_wdt_deinit(); 
  esp_task_wdt_init(&wdt_config); 
  esp_task_wdt_add(NULL); 
}

void loop() {
  esp_task_wdt_reset();
  
  if (digitalRead(PINO_RESET_CONFIG) == LOW) {
    unsigned long tempoInicio = millis();
    bool resetar = true;
    while (millis() - tempoInicio < 5000) {
      if (digitalRead(PINO_RESET_CONFIG) == HIGH) { resetar = false; break; }
      digitalWrite(PINO_LED, !digitalRead(PINO_LED)); delay(100); 
      esp_task_wdt_reset();
    }
    if (resetar) { preferences.clear(); ESP.restart(); }
  }

  if (emModoConfig) {
    dnsServer.processNextRequest(); 
    server.handleClient();
  } else {
    // Se estiver em modo operação, tenta manter conectado
    if (!client.connected()) reconnectMQTT();
    client.loop();
    
    if (bombaLigada) {
        if (millis() - tempoInicioBomba >= TEMPO_MAX_LIGADA) {
            Serial.println("[AVISO] Tempo máximo de 15 min atingido. Desligando bomba.");
            controlarBomba(false);
        }
    }
  }
}

void setupModoOperacao() {
  emModoConfig = false;
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid_str.c_str(), pass_str.c_str());

  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 25) { 
    delay(500); Serial.print("."); tentativas++; esp_task_wdt_reset(); 
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Conectado!");
    digitalWrite(PINO_LED, HIGH);
    
    espClient.setInsecure();
    client.setServer(MQTT_SERVER_DEFAULT, 8883); 
    client.setCallback(callbackMQTT);
  } else {
    Serial.println("\n[WIFI] Falha na conexão. Voltando para Modo AP.");
    setupModoConfiguracao();
  }
}

void reconnectMQTT() {
  // Se o Wi-Fi caiu, não adianta tentar conectar no MQTT. O loop vai continuar chamando.
  if (WiFi.status() != WL_CONNECTED) return; 

  static unsigned long lastMqttAttempt = 0;
  // Tenta reconectar a cada 5 segundos
  if (millis() - lastMqttAttempt < 5000) return; 
  lastMqttAttempt = millis();

  Serial.println("[MQTT] Tentando conectar...");
  
  String clientIdStr = "ESP32_Bomba_" + String(random(0xffff), HEX);
  if (client.connect(clientIdStr.c_str(), MQTT_USER_DEFAULT, MQTT_PASS_DEFAULT)) {
      Serial.println("[MQTT] SUCESSO!");
      tentativasFalhas = 0; // Zerou as falhas ao conectar com sucesso
      client.subscribe(TOPIC_COMMAND_BOMBA);
      publicarStatusBomba();
  } else {
      tentativasFalhas++; // Soma mais uma falha
      Serial.print("[MQTT] Falha: ");
      Serial.print(client.state());
      Serial.print(" | Tentativas: ");
      Serial.println(tentativasFalhas);

      // Gatilho do WatchDog Lógico
      if (tentativasFalhas >= MAX_TENTATIVAS_MQTT) {
          Serial.println("\n[ERRO CRÍTICO] Falhas sucessivas no servidor. Reiniciando a placa...\n");
          delay(1000); 
          ESP.restart(); // Renova todo o sistema para limpar memória
      }
  }
}

void callbackMQTT(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for(int i=0; i<length; i++) msg += (char)payload[i];
  
  Serial.print("[MQTT RX] Comando recebido: ");
  Serial.println(msg);
  if (msg.startsWith("LIGAR_BOMBA")) {
      controlarBomba(true);
  } 
  else if (msg.startsWith("DESLIGAR_BOMBA")) {
      controlarBomba(false);
  }
  else if (msg.startsWith("ATUALIZAR_FIRMWARE")) {
      realizarUpdateFirmwareBomba();
  }
}

void setupModoConfiguracao() {
  emModoConfig = true;
  WiFi.disconnect(true); delay(100);
  WiFi.mode(WIFI_AP);
  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));
  WiFi.softAP("SmartPump_Config", "12345678"); 
  
  dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());
  auto pageHandler = []() {
    int n = WiFi.scanNetworks();
    String opcoesWifi = (n == 0) ? "<option value=''>Nenhuma rede encontrada</option>" : "";
    for (int i = 0; i < n; ++i) {
        opcoesWifi += "<option value='" + WiFi.SSID(i) + "'>" + WiFi.SSID(i) + " (" + String(WiFi.RSSI(i)) + "dBm)</option>";
    }
    
    String html = R"rawliteral(
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Configurar Bomba</title>
  <style>
    body { background: #0f172a; color: white; font-family: sans-serif; display: flex; justify-content: center; padding: 20px; }
    .container { background: #1e293b; padding: 30px; border-radius: 12px; width: 100%; max-width: 350px; text-align: center; }
    h2 { color: #3b82f6; }
    label { display: block; margin: 15px 0 5px; text-align: left; }
    select, input { width: 100%; padding: 10px; border-radius: 8px; border: none; outline: none; box-sizing: border-box; }
    button { margin-top: 25px; width: 100%; background: #3b82f6; color: white; padding: 12px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h2>SmartPump Wi-Fi</h2>
    <form action="/save" method="POST">
      <label>1. Selecione a Rede</label>
      <select name="ssid" required>%WIFI_OPTIONS%</select>
      <label>2. Senha do Wi-Fi</label>
      <input type="password" name="pass" placeholder="Senha da internet">
      <button type="submit">SALVAR E CONECTAR</button>
    </form>
  </div>
</body>
</html>
)rawliteral";

    html.replace("%WIFI_OPTIONS%", opcoesWifi);
    server.send(200, "text/html", html);
  };

  server.on("/", HTTP_GET, pageHandler);
  server.on("/generate_204", HTTP_GET, pageHandler);
  server.on("/hotspot-detect.html", HTTP_GET, pageHandler);
  
  server.onNotFound([=]() {
    if (server.hostHeader() == WiFi.softAPIP().toString()) pageHandler();
    else { server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString(), true); server.send(302, "text/plain", ""); }
  });

  server.on("/save", HTTP_POST, []() {
    if (server.arg("ssid").length() > 0) {
      preferences.putString("ssid", server.arg("ssid"));
      preferences.putString("pass", server.arg("pass"));
      server.send(200, "text/html", "<html><body style='background:#0f172a;color:#10b981;text-align:center;margin-top:20vh;'><h2>Salvo! A placa vai reiniciar.</h2></body></html>");
      delay(2000); ESP.restart();
    }
  });
  
  server.begin();
}