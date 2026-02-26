#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <HTTPUpdate.h> 
#include "secrets.h" 

// --- CONFIGURAÇÃO OTA WEB (Ajuste a URL para o repositório da bomba) ---
#define URL_FIRMWARE "https://raw.githubusercontent.com/LGEEEEEE/SmartGateWeb/main/ControleBomba/build/esp32.esp32.esp32doit-devkit-v1/ControleBomba.ino.bin"

// --- TÓPICOS DA BOMBA ---
// Definidos aqui para não precisar alterar o secrets.h do portão
#define MQTT_TOPIC_COMMAND_BOMBA "projeto_LG/casa/bomba/cmd"
#define MQTT_TOPIC_STATUS_BOMBA "projeto_LG/casa/bomba/status"

// --- HARDWARE ---
const int PINO_RELE_BOMBA = 18; // Relé que aciona a contatora da bomba

// --- LÓGICA DE TEMPO ---
const unsigned long TEMPO_MAXIMO_LIGADA = 15UL * 60UL * 1000UL; // 15 minutos em milissegundos
unsigned long tempoInicioBomba = 0;
bool bombaLigada = false;

// --- CONFIGURAÇÃO DE REINÍCIO ---
const int MAX_TENTATIVAS_MQTT = 15;
int tentativasFalhas = 0;           

WiFiClientSecure espClient;
PubSubClient client(espClient);

// --- FUNÇÃO DE STATUS ---
void publicarEstado() {
  if (bombaLigada) {
    client.publish(MQTT_TOPIC_STATUS_BOMBA, "BOMBA_LIGADA", true);
    Serial.println("[STATUS] Enviado: BOMBA_LIGADA");
  } else {
    client.publish(MQTT_TOPIC_STATUS_BOMBA, "BOMBA_DESLIGADA", true);
    Serial.println("[STATUS] Enviado: BOMBA_DESLIGADA");
  }
}

// --- CONTROLE DA BOMBA ---
void ligarBomba() {
  digitalWrite(PINO_RELE_BOMBA, HIGH); // Ajuste para LOW se seu relé for ativo em nível baixo
  bombaLigada = true;
  tempoInicioBomba = millis();
  publicarEstado();
  Serial.println("\n>>> BOMBA LIGADA (Temporizador de 15 min iniciado) <<<");
}

void desligarBomba() {
  digitalWrite(PINO_RELE_BOMBA, LOW); // Ajuste para HIGH se seu relé for ativo em nível baixo
  bombaLigada = false;
  publicarEstado();
  Serial.println("\n>>> BOMBA DESLIGADA <<<");
}

// --- FUNÇÃO DE UPDATE ---
void realizarUpdateFirmware() {
  Serial.println("\n[UPDATE] Iniciando atualização OTA da Bomba...");
  client.publish(MQTT_TOPIC_STATUS_BOMBA, "STATUS_ATUALIZANDO_BOMBA", true);
  
  WiFiClientSecure clientOTA;
  clientOTA.setInsecure();
  t_httpUpdate_return ret = httpUpdate.update(clientOTA, URL_FIRMWARE);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[UPDATE] FALHA (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
      client.publish(MQTT_TOPIC_STATUS_BOMBA, "ERRO_ATUALIZACAO_BOMBA", true);
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
  Serial.println("\n\n--- INICIANDO SISTEMA SMART PUMP V1.0 ---");

  pinMode(PINO_RELE_BOMBA, OUTPUT);
  digitalWrite(PINO_RELE_BOMBA, LOW); // Garante que inicie desligada

  setup_wifi();

  espClient.setInsecure(); // MANDATÓRIO PARA O HIVEMQ
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
}

void setup_wifi() {
  delay(10);
  Serial.println();
  Serial.print("[WIFI] Conectando a: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int tentativasWifi = 0;
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    tentativasWifi++;
    if (tentativasWifi > 60) { 
        Serial.println("\n[ERRO] WiFi timeout. Reiniciando...");
        ESP.restart();
    }
  }
  Serial.println("\n[WIFI] Conectado!");
  Serial.print("[WIFI] IP: ");
  Serial.println(WiFi.localIP());
}

void callback(char* topic, byte* payload, unsigned int length) {
  String mensagem = "";
  for (int i = 0; i < length; i++) mensagem += (char)payload[i];
  
  Serial.print("[MQTT] Mensagem recebida: ");
  Serial.println(mensagem);

  // --- LÓGICA DE COMANDOS DA BOMBA ---
  if (mensagem == "LIGAR_BOMBA") {
    ligarBomba();
  } 
  else if (mensagem == "DESLIGAR_BOMBA") {
    desligarBomba();
  }
  else if (mensagem == "CHECAR_STATUS") {
    Serial.println("[CMD] Check-up solicitado.");
    publicarEstado();
  }
  else if (mensagem == "ATUALIZAR_FIRMWARE") {
    realizarUpdateFirmware();
  }
}

void reconnect() {
  if (!client.connected()) {
    Serial.print("[MQTT] Reconectando...");
    // Importante: Prefixo diferente do portão para evitar conflito no HiveMQ
    String clientId = "ESP32_BOMBA_" + String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println(" OK!");
      tentativasFalhas = 0;
      client.subscribe(MQTT_TOPIC_COMMAND_BOMBA);
      publicarEstado(); // Atualiza o dashboard logo que conecta
    } else {
      tentativasFalhas++;
      Serial.print(" Falha. ");
      if (tentativasFalhas >= MAX_TENTATIVAS_MQTT) {
         Serial.println("Reiniciando ESP32...");
         delay(1000); ESP.restart();
      }
      delay(5000);
    }
  }
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  // --- CONTROLE DE TEMPO (15 MINUTOS) ---
  if (bombaLigada) {
    // Usa millis() para não travar o código com delay()
    if (millis() - tempoInicioBomba >= TEMPO_MAXIMO_LIGADA) {
      Serial.println("[TIMER] Tempo máximo atingido. Desligando bomba automaticamente.");
      desligarBomba();
    }
  }
}