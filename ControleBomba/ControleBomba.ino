#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <HTTPUpdate.h> 
#include "secrets.h" 

#define URL_FIRMWARE "https://raw.githubusercontent.com/LGEEEEEE/SmartGateWeb/main/ControleBomba/build/esp32.esp32.esp32doit-devkit-v1/ControleBomba.ino.bin"
#define MQTT_TOPIC_COMMAND_BOMBA "projeto_LG/casa/bomba/cmd"
#define MQTT_TOPIC_STATUS_BOMBA "projeto_LG/casa/bomba/status"

const int PINO_RELE_BOMBA = 18; 

// --- LÓGICA DE MÁQUINA DE ESTADOS (BOMBA INTERCALADA) ---
enum EstadoBomba { PARADA, LIGADA, ESPERA };
EstadoBomba estadoAtual = PARADA;

bool modoIntercalado = false;
unsigned long tempoMaximoLigada = 0; 
unsigned long tempoMaximoDesligada = 0; 
int tempoMinutosAtual = 0;
int tempoDescansoMinutosAtual = 0;
unsigned long tempoInicioEstado = 0;

// --- CONFIGURAÇÃO DE REINÍCIO ---
const int MAX_TENTATIVAS_MQTT = 15;
int tentativasFalhas = 0;           

WiFiClientSecure espClient;
PubSubClient client(espClient);

// --- FUNÇÕES DA BOMBA ---
void publicarEstado() {
  if (estadoAtual == LIGADA) {
    unsigned long decorrido = millis() - tempoInicioEstado;
    unsigned long restante = (tempoMaximoLigada > decorrido) ? (tempoMaximoLigada - decorrido) / 1000 : 0;
    
    String payload = "BOMBA_LIGADA|" + String(tempoMinutosAtual) + "|" + String(restante);
    client.publish(MQTT_TOPIC_STATUS_BOMBA, payload.c_str(), true);
    Serial.println("[STATUS] " + payload);
    
  } else if (estadoAtual == ESPERA) {
    unsigned long decorrido = millis() - tempoInicioEstado;
    unsigned long restante = (tempoMaximoDesligada > decorrido) ? (tempoMaximoDesligada - decorrido) / 1000 : 0;
    
    String payload = "BOMBA_ESPERA|" + String(tempoDescansoMinutosAtual) + "|" + String(restante);
    client.publish(MQTT_TOPIC_STATUS_BOMBA, payload.c_str(), true);
    Serial.println("[STATUS] " + payload);
    
  } else {
    client.publish(MQTT_TOPIC_STATUS_BOMBA, "BOMBA_DESLIGADA", true);
    Serial.println("[STATUS] BOMBA_DESLIGADA");
  }
}

void acionarReleFisico(bool ligar) {
  if (ligar) {
    pinMode(PINO_RELE_BOMBA, OUTPUT); 
    digitalWrite(PINO_RELE_BOMBA, HIGH); 
  } else {
    digitalWrite(PINO_RELE_BOMBA, LOW); 
    pinMode(PINO_RELE_BOMBA, INPUT); 
  }
}

void iniciarCiclo(int minLigado, int minDesligado) {
  tempoMinutosAtual = minLigado;
  tempoMaximoLigada = minLigado * 60UL * 1000UL;
  
  if (minDesligado > 0) {
    modoIntercalado = true;
    tempoDescansoMinutosAtual = minDesligado;
    tempoMaximoDesligada = minDesligado * 60UL * 1000UL;
    Serial.printf("\n>>> MODO INTERCALADO: %d min Ligada / %d min Pausa <<<\n", minLigado, minDesligado);
  } else {
    modoIntercalado = false;
    tempoDescansoMinutosAtual = 0;
    tempoMaximoDesligada = 0;
    Serial.printf("\n>>> MODO NORMAL: %d min Ligada <<<\n", minLigado);
  }

  estadoAtual = LIGADA;
  tempoInicioEstado = millis();
  acionarReleFisico(true);
  publicarEstado();
}

void pararCicloTotalmente() {
  estadoAtual = PARADA;
  modoIntercalado = false;
  acionarReleFisico(false);
  publicarEstado();
  Serial.println("\n>>> CICLO DA BOMBA ENCERRADO <<<");
}

// --- FUNÇÃO DE UPDATE OTA ---
void realizarUpdateFirmware() {
  Serial.println("\n[UPDATE] Iniciando atualização OTA...");
  client.publish(MQTT_TOPIC_STATUS_BOMBA, "STATUS_ATUALIZANDO_BOMBA", true);
  
  WiFiClientSecure clientOTA;
  clientOTA.setInsecure();
  t_httpUpdate_return ret = httpUpdate.update(clientOTA, URL_FIRMWARE);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      client.publish(MQTT_TOPIC_STATUS_BOMBA, "ERRO_ATUALIZACAO_BOMBA", true);
      break;
    case HTTP_UPDATE_NO_UPDATES: break;
    case HTTP_UPDATE_OK: break;
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n\n--- INICIANDO SMART PUMP V3.0 (INTERCALADO) ---");

  pinMode(PINO_RELE_BOMBA, INPUT);
  setup_wifi();

  espClient.setInsecure(); 
  client.setServer(MQTT_SERVER, MQTT_PORT);
  client.setCallback(callback);
}

void setup_wifi() {
  delay(10);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int tentativasWifi = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); tentativasWifi++;
    if (tentativasWifi > 60) ESP.restart();
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  String mensagem = "";
  for (int i = 0; i < length; i++) mensagem += (char)payload[i];
  
  Serial.print("[MQTT] Mensagem: "); Serial.println(mensagem);

  // Comando chega como: LIGAR_BOMBA|60|120  (60 min ligado, 120 min descanso)
  if (mensagem.startsWith("LIGAR_BOMBA")) {
    int tLigado = 15;
    int tDesligado = 0;
    
    int idx1 = mensagem.indexOf('|');
    if (idx1 > 0) {
      int idx2 = mensagem.indexOf('|', idx1 + 1);
      if (idx2 > 0) {
        tLigado = mensagem.substring(idx1 + 1, idx2).toInt();
        tDesligado = mensagem.substring(idx2 + 1).toInt();
      } else {
        tLigado = mensagem.substring(idx1 + 1).toInt();
      }
    }
    
    if(tLigado <= 0) tLigado = 15;
    if(tDesligado < 0) tDesligado = 0;

    iniciarCiclo(tLigado, tDesligado);
  } 
  else if (mensagem == "DESLIGAR_BOMBA") {
    pararCicloTotalmente();
  }
  else if (mensagem == "CHECAR_STATUS") {
    publicarEstado();
  }
  else if (mensagem == "ATUALIZAR_FIRMWARE") {
    realizarUpdateFirmware();
  }
}

void reconnect() {
  if (!client.connected()) {
    String clientId = "ESP32_BOMBA_" + String(random(0xffff), HEX);
    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      tentativasFalhas = 0;
      client.subscribe(MQTT_TOPIC_COMMAND_BOMBA);
      publicarEstado(); 
    } else {
      tentativasFalhas++;
      if (tentativasFalhas >= MAX_TENTATIVAS_MQTT) ESP.restart();
      delay(5000);
    }
  }
}

void loop() {
  if (!client.connected()) reconnect();
  client.loop();

  // --- GERENCIADOR DO CICLO INTERCALADO ---
  if (estadoAtual == LIGADA) {
    if (millis() - tempoInicioEstado >= tempoMaximoLigada) {
      if (modoIntercalado) {
        Serial.println("[TIMER] Tempo esgotado. Entrando em modo ESPERA para resfriamento.");
        estadoAtual = ESPERA;
        tempoInicioEstado = millis();
        acionarReleFisico(false); // Corta a energia
        publicarEstado();
      } else {
        Serial.println("[TIMER] Fim do ciclo normal.");
        pararCicloTotalmente();
      }
    }
  } 
  else if (estadoAtual == ESPERA) {
    if (millis() - tempoInicioEstado >= tempoMaximoDesligada) {
      Serial.println("[TIMER] Descanso concluído. Religando a bomba automaticamente!");
      estadoAtual = LIGADA;
      tempoInicioEstado = millis();
      acionarReleFisico(true); // Liga a energia novamente
      publicarEstado();
    }
  }
}