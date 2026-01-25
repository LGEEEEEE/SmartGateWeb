#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <HTTPUpdate.h> // <--- BIBLIOTECA MÁGICA DE ATUALIZAÇÃO
#include "secrets.h" 

// --- CONFIGURAÇÃO OTA WEB ---
// Cole aqui o link DIRETO do seu arquivo .bin (Ex: GitHub Raw ou seu site)
#define URL_FIRMWARE "https://raw.githubusercontent.com/LGEEEEEE/SmartGateWeb/main/atualizacao.bin"

// --- HARDWARE ---
const int PINO_RELE_REAL = 18;    
const int PINO_FANTASMA = 23;     
const int PINO_SENSOR = 4;        

// --- CONFIGURAÇÃO DE REINÍCIO ---
const int MAX_TENTATIVAS_MQTT = 15; 
int tentativasFalhas = 0;           

WiFiClientSecure espClient;
PubSubClient client(espClient);

bool estadoSensorAnterior = false;

// --- FUNÇÃO NOVA: Realiza a atualização via Internet ---
void realizarUpdateFirmware() {
  Serial.println("\n[UPDATE] Iniciando processo de atualização OTA...");
  Serial.println("[UPDATE] Baixando firmware de: " + String(URL_FIRMWARE));
  
  // Avisa no MQTT que vai cair para atualizar
  client.publish(MQTT_TOPIC_STATUS, "STATUS_ATUALIZANDO_SISTEMA", true);
  
  // Cliente seguro para baixar de sites HTTPS (GitHub, etc)
  WiFiClientSecure clientOTA;
  clientOTA.setInsecure(); // Ignora certificado SSL para facilitar
  
  // Essa função trava o código enquanto baixa e grava. Se der certo, ele reinicia sozinho.
  t_httpUpdate_return ret = httpUpdate.update(clientOTA, URL_FIRMWARE);

  // Se chegou aqui, é porque deu erro (se der certo ele reinicia antes)
  switch (ret) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("[UPDATE] FALHA: (%d): %s\n", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
      client.publish(MQTT_TOPIC_STATUS, "ERRO_ATUALIZACAO", true);
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[UPDATE] Nenhuma atualização necessária.");
      break;
    case HTTP_UPDATE_OK:
      Serial.println("[UPDATE] Atualização OK! (Isso não deve aparecer pois ele reinicia)");
      break;
  }
}

void publicarEstadoInicial() {
  if (digitalRead(PINO_SENSOR) == HIGH) {
     client.publish(MQTT_TOPIC_STATUS, "ESTADO_REAL_ABERTO", true); 
     Serial.println("[STATUS] Enviado inicial: ABERTO");
  } else {
     client.publish(MQTT_TOPIC_STATUS, "ESTADO_REAL_FECHADO", true);
     Serial.println("[STATUS] Enviado inicial: FECHADO");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000); 
  
  Serial.println("\n\n--- INICIANDO SISTEMA SMART GATE (COM OTA WEB) ---");

  pinMode(PINO_RELE_REAL, INPUT);
  pinMode(PINO_FANTASMA, OUTPUT);
  digitalWrite(PINO_FANTASMA, LOW);
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
        Serial.println("\n[ERRO] Falha crítica no WiFi. Reiniciando...");
        ESP.restart();
    }
  }
  
  Serial.println("\n[WIFI] Conectado com Sucesso!");
  Serial.print("[WIFI] IP: ");
  Serial.println(WiFi.localIP());
}

void acionarReleSeguro() {
  Serial.println("\n>>> INICIO DA SEQUENCIA DE ABERTURA <<<");
  
  Serial.println("1. [AÇÃO] Ativando pino 18 como OUTPUT...");
  pinMode(PINO_RELE_REAL, OUTPUT);
  digitalWrite(PINO_RELE_REAL, HIGH); 
  delay(50); 

  Serial.println("2. [AÇÃO] Enviando sinal LOW (LIGAR RELÉ)...");
  digitalWrite(PINO_RELE_REAL, LOW); 
  delay(500); 

  Serial.println("3. [AÇÃO] Enviando sinal HIGH (DESLIGAR RELÉ)...");
  digitalWrite(PINO_RELE_REAL, HIGH); 
  delay(50); 

  Serial.println("4. [AÇÃO] Matando pino 18 (Voltando para INPUT)...");
  pinMode(PINO_RELE_REAL, INPUT); 
  
  Serial.println(">>> FIM DA SEQUENCIA. SISTEMA SEGURO. <<<\n");
}

void callback(char* topic, byte* payload, unsigned int length) {
  String mensagem = "";
  for (int i = 0; i < length; i++) {
    mensagem += (char)payload[i];
  }
  
  Serial.print("[MQTT] Mensagem Recebida: ");
  Serial.println(mensagem);

  // --- COMANDOS ---
  
  if (mensagem.startsWith("ABRIR_PORTAO_AGORA")) {
    if (digitalRead(PINO_SENSOR) == LOW) {
       client.publish(MQTT_TOPIC_STATUS, "STATUS_ABRINDO", true);
    } else {
       client.publish(MQTT_TOPIC_STATUS, "STATUS_FECHANDO", true);
    }
    acionarReleSeguro();
  }
  
  // >>> NOVO COMANDO PARA ATUALIZAR <<<
  else if (mensagem.startsWith("ATUALIZAR_FIRMWARE")) {
    realizarUpdateFirmware();
  }
}

void reconnect() {
  if (!client.connected()) {
    Serial.print("[MQTT] Tentando reconexão...");
    String clientId = "ESP32_Ghost_" + String(random(0xffff), HEX);
    
    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println(" CONECTADO!");
      tentativasFalhas = 0;
      client.subscribe(MQTT_TOPIC_COMMAND);
      publicarEstadoInicial();
      
    } else {
      tentativasFalhas++;
      Serial.print(" Falha. Tentativa ");
      Serial.print(tentativasFalhas);
      Serial.println("/15");

      if (tentativasFalhas >= MAX_TENTATIVAS_MQTT) {
         Serial.println("\n[CRÍTICO] Reiniciando ESP32...");
         delay(1000);
         ESP.restart(); 
      }
      delay(5000);
    }
  }
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  int leituraAtual = digitalRead(PINO_SENSOR);
  
  if (leituraAtual != estadoSensorAnterior) {
    delay(50); 
    if (digitalRead(PINO_SENSOR) == leituraAtual) {
      if (leituraAtual == HIGH) {
        Serial.println("[SENSOR] Portão detectado: ABERTO");
        client.publish(MQTT_TOPIC_STATUS, "ESTADO_REAL_ABERTO", true);
      } else {
        Serial.println("[SENSOR] Portão detectado: FECHADO");
        client.publish(MQTT_TOPIC_STATUS, "ESTADO_REAL_FECHADO", true);
      }
      estadoSensorAnterior = leituraAtual;
    }
  }
}