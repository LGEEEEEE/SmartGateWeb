#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <HTTPUpdate.h> 
#include "secrets.h" 

// --- CONFIGURAÇÃO OTA WEB (Ajuste a URL para o repositório da bomba) ---
#define URL_FIRMWARE "https://raw.githubusercontent.com/LGEEEEEE/SmartGateWeb/main/ControleBomba/build/esp32.esp32.esp32doit-devkit-v1/ControleBomba.ino.bin"

// --- TÓPICOS DA BOMBA ---
#define MQTT_TOPIC_COMMAND_BOMBA "projeto_LG/casa/bomba/cmd"
#define MQTT_TOPIC_STATUS_BOMBA "projeto_LG/casa/bomba/status"

// --- HARDWARE ---
const int PINO_RELE_BOMBA = 18; // Relé que aciona a contatora da bomba

// --- LÓGICA DE TEMPO DINÂMICO ---
unsigned long tempoMaximoLigada = 15UL * 60UL * 1000UL; 
int tempoMinutosAtual = 15;
unsigned long tempoInicioBomba = 0;
bool bombaLigada = false;

// --- CONFIGURAÇÃO DE REINÍCIO ---
const int MAX_TENTATIVAS_MQTT = 15;
int tentativasFalhas = 0;           

WiFiClientSecure espClient;
PubSubClient client(espClient);

// --- FUNÇÃO DE STATUS (ATUALIZADA PARA ENVIAR SEGUNDOS RESTANTES) ---
void publicarEstado() {
  if (bombaLigada) {
    unsigned long tempoDecorrido = millis() - tempoInicioBomba;
    unsigned long tempoRestanteSegundos = 0;
    
    // Calcula quantos segundos faltam, garantindo que a matemática não dê erro
    if (tempoMaximoLigada > tempoDecorrido) {
      tempoRestanteSegundos = (tempoMaximoLigada - tempoDecorrido) / 1000;
    }

    // Envia no formato: BOMBA_LIGADA|MinutosTotais|SegundosRestantes
    String payload = "BOMBA_LIGADA|" + String(tempoMinutosAtual) + "|" + String(tempoRestanteSegundos);
    client.publish(MQTT_TOPIC_STATUS_BOMBA, payload.c_str(), true);
    Serial.println("[STATUS] Enviado: " + payload);
  } else {
    client.publish(MQTT_TOPIC_STATUS_BOMBA, "BOMBA_DESLIGADA", true);
    Serial.println("[STATUS] Enviado: BOMBA_DESLIGADA");
  }
}

// --- CONTROLE DA BOMBA (COM TRAVA DE IMPEDÂNCIA) ---
void ligarBomba() {
  pinMode(PINO_RELE_BOMBA, OUTPUT); 
  digitalWrite(PINO_RELE_BOMBA, HIGH); 
  
  bombaLigada = true;
  tempoInicioBomba = millis();
  publicarEstado();
  Serial.print("\n>>> BOMBA LIGADA (Temporizador de ");
  Serial.print(tempoMinutosAtual);
  Serial.println(" min iniciado) <<<");
}

void desligarBomba() {
  digitalWrite(PINO_RELE_BOMBA, LOW); 
  pinMode(PINO_RELE_BOMBA, INPUT); 
  
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
  Serial.println("\n\n--- INICIANDO SISTEMA SMART PUMP V2.1 ---");

  pinMode(PINO_RELE_BOMBA, INPUT);
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

void callback(char* topic, byte* payload, unsigned int length) {
  String mensagem = "";
  for (int i = 0; i < length; i++) mensagem += (char)payload[i];
  
  Serial.print("[MQTT] Mensagem recebida: ");
  Serial.println(mensagem);

  // --- LÓGICA DE COMANDOS DA BOMBA ---
  if (mensagem.startsWith("LIGAR_BOMBA")) {
    int indicePipe = mensagem.indexOf('|');
    
    if (indicePipe > 0) {
      String tempoStr = mensagem.substring(indicePipe + 1);
      tempoMinutosAtual = tempoStr.toInt();
      if(tempoMinutosAtual <= 0) tempoMinutosAtual = 15; 
    } else {
      tempoMinutosAtual = 15;
    }
    
    tempoMaximoLigada = tempoMinutosAtual * 60UL * 1000UL;
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
    String clientId = "ESP32_BOMBA_" + String(random(0xffff), HEX);
    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println(" OK!");
      tentativasFalhas = 0;
      client.subscribe(MQTT_TOPIC_COMMAND_BOMBA);
      publicarEstado(); 
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

  if (bombaLigada) {
    if (millis() - tempoInicioBomba >= tempoMaximoLigada) {
      Serial.println("[TIMER] Tempo configurado atingido. Desligando bomba automaticamente.");
      desligarBomba();
    }
  }
}