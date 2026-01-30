#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <HTTPUpdate.h> 
#include "secrets.h" 

// --- CONFIGURAÇÃO OTA WEB ---
#define URL_FIRMWARE "https://raw.githubusercontent.com/LGEEEEEE/SmartGateWeb/main/ControlePortaoLG/build/esp32.esp32.esp32doit-devkit-v1/ControlePortaoLG.ino.bin"

// --- HARDWARE ---
const int PINO_RELE_REAL = 18;
const int PINO_FANTASMA = 23;     
const int PINO_SENSOR = 4;        

// --- CONFIGURAÇÃO DE REINÍCIO ---
const int MAX_TENTATIVAS_MQTT = 15;
int tentativasFalhas = 0;           

WiFiClientSecure espClient;
PubSubClient client(espClient);
bool estadoSensorAnterior = false; // false = Fechado (LOW), true = Aberto (HIGH)

// --- FUNÇÃO DE STATUS ---
void publicarEstadoInicial() {
  // Lógica: INPUT_PULLUP -> HIGH = Aberto (Sem ímã), LOW = Fechado (Com ímã)
  bool sensorAtual = digitalRead(PINO_SENSOR);

  if (sensorAtual == HIGH) {
     client.publish(MQTT_TOPIC_STATUS, "ESTADO_REAL_ABERTO", true);
     Serial.println("[STATUS] Enviado: ABERTO");
  } else {
     // REMOVIDO O FILTRO DE TEMPO! AGORA É INSTANTÂNEO.
     client.publish(MQTT_TOPIC_STATUS, "ESTADO_REAL_FECHADO", true);
     Serial.println("[STATUS] Enviado: FECHADO");
  }
}

// --- FUNÇÃO DE UPDATE ---
void realizarUpdateFirmware() {
  Serial.println("\n[UPDATE] Iniciando atualização OTA...");
  client.publish(MQTT_TOPIC_STATUS, "STATUS_ATUALIZANDO_SISTEMA", true);
  
  WiFiClientSecure clientOTA;
  clientOTA.setInsecure();
  t_httpUpdate_return ret = httpUpdate.update(clientOTA, URL_FIRMWARE);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[UPDATE] FALHA (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
      client.publish(MQTT_TOPIC_STATUS, "ERRO_ATUALIZACAO", true);
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
  Serial.println("\n\n--- INICIANDO SISTEMA SMART GATE V3.0 (INSTANT) ---");

  pinMode(PINO_RELE_REAL, INPUT);
  pinMode(PINO_FANTASMA, OUTPUT); digitalWrite(PINO_FANTASMA, LOW);
  pinMode(PINO_SENSOR, INPUT_PULLUP); 

  setup_wifi();

  espClient.setInsecure();
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

void acionarReleSeguro() {
  Serial.println("\n>>> ACIONANDO PORTÃO <<<");
  pinMode(PINO_RELE_REAL, OUTPUT);
  digitalWrite(PINO_RELE_REAL, HIGH); delay(50); 
  digitalWrite(PINO_RELE_REAL, LOW); delay(500); // Pulso de meio segundo
  digitalWrite(PINO_RELE_REAL, HIGH); delay(50); 
  pinMode(PINO_RELE_REAL, INPUT);
  Serial.println(">>> FIM DO PULSO <<<\n");
}

void callback(char* topic, byte* payload, unsigned int length) {
  String mensagem = "";
  for (int i = 0; i < length; i++) mensagem += (char)payload[i];
  
  Serial.print("[MQTT] Mensagem: ");
  Serial.println(mensagem);
  
  // --- LÓGICA DE COMANDOS ---
  if (mensagem.startsWith("ABRIR_PORTAO_AGORA")) {
    // Envia feedback visual imediato de que recebeu o comando
    if (digitalRead(PINO_SENSOR) == LOW) client.publish(MQTT_TOPIC_STATUS, "STATUS_ABRINDO", true);
    else client.publish(MQTT_TOPIC_STATUS, "STATUS_FECHANDO", true);
    acionarReleSeguro();
  }
  
  else if (mensagem.startsWith("CHECAR_STATUS")) {
    Serial.println("[CMD] Check-up solicitado.");
    publicarEstadoInicial();
  }
  
  else if (mensagem.startsWith("ATUALIZAR_FIRMWARE")) {
    realizarUpdateFirmware();
  }
}

void reconnect() {
  if (!client.connected()) {
    Serial.print("[MQTT] Reconectando...");
    String clientId = "ESP32_" + String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println(" OK!");
      tentativasFalhas = 0;
      client.subscribe(MQTT_TOPIC_COMMAND);
      publicarEstadoInicial();
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
  
  // Leitura do Sensor
  int leituraAtual = digitalRead(PINO_SENSOR);
  bool estadoLidoBool = (leituraAtual == HIGH);
  
  // Se mudou o estado físico...
  if (estadoLidoBool != estadoSensorAnterior) {
    // Delay pequeno (200ms) só pra garantir que o ímã encostou mesmo
    // Isso evita que o sensor mande 50 mensagens se o portão tremer ao bater
    delay(200); 
    
    // Confirma leitura após o delay
    if (digitalRead(PINO_SENSOR) == leituraAtual) {
      publicarEstadoInicial(); // Envia IMEDIATAMENTE
      estadoSensorAnterior = estadoLidoBool;
    }
  }
}