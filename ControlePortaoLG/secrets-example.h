/*
  ARQUIVO: secrets.h (Template)
  Renomeie para "secrets.h" e preencha com seus dados.
*/

#ifndef SECRETS_H
#define SECRETS_H

// --- CREDENCIAIS WI-FI ---
const char* WIFI_SSID     = "NOME_DO_SEU_WIFI";
const char* WIFI_PASSWORD = "SENHA_DO_SEU_WIFI";

// --- CREDENCIAIS MQTT (HiveMQ) ---
const char* MQTT_SERVER   = "seu-cluster.s1.eu.hivemq.cloud";
const int   MQTT_PORT     = 8883; // Porta segura (SSL/TLS)
const char* MQTT_USER     = "seu_usuario_mqtt";
const char* MQTT_PASS     = "sua_senha_mqtt";

// --- TOPICOS MQTT ---
const char* MQTT_TOPIC_COMMAND = "projeto_LG/casa/portao";
const char* MQTT_TOPIC_STATUS  = "projeto_LG/casa/portao/status";

// --- CERTIFICADO SSL (ISRG Root X1) ---
// Necessário para conexão segura com HiveMQ Cloud
const char* HIVEMQ_CERT_CA = \
"-----BEGIN CERTIFICATE-----\n" \
"MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw\n" \
"TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh\n" \
"cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4\n" \
"WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu\n" \
"ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY\n" \
"MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3uleqGksS8q87G43XC\n" \
"WAtenxB31Gho3uQsRyVIag80YtDkW6VMk/Mny6a53XlIKP84zSPfB6FCIWH5XySh\n" \
"Czp8yaOXD+eQA39zCq29UZB45kslr27pXlG94ZUeFdsItL2tYA99GazbeANTyxXG\n" \
"1I+3yHg80xr83tX2OHxpx+M/T1WTeRNsq976dnjO17Ar+tbg8q31tQ7X1ZLQC0e+\n" \
"z60FqP1MME7zX9uzOCvULe4E34YYL8s8px76pDzw7sYkyE5ZMUB+eZDsTEK0VR8P\n" \
"a+h+x9M95X7EPdrJOkN11VlZ39r47e5pL2S7ckB0YszFPCuxdF6WSkjo2L38A/qD\n" \
"2r15200QIq5Q2NCtq0rS5vI4cW1w7nOL76s50a30jTV5/684YWre0F6gR8hSwxi6\n" \
"B24j2o8E2c7wK8j10AZv4o4h50JzX1az6fO987O5jN1G9O/X6pU3q4Q04q02q5k6\n" \
"n6kP7iG+t1sIC7JvO4t/f2wJ26t1t/j33y6r8g2v0Eigp9/6Gk37i45/h1i81W16\n" \
"17e76oY62O5r1j4009N/a8+5c7iY1g45kCQ8lSS6z4sB8y9s2joG8p8p1FqU9O/T\n" \
"6Q2+j+4hD4r8m5g+o6+6\n" \
"-----END CERTIFICATE-----\n";

#endif