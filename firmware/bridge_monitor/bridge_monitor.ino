// PREPARATION ONLY: not compiled or tested against physical components.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <time.h>
#include "config.h"

constexpr uint8_t ADXL=0x53, GREEN_LED=18, RED_LED=19, BUZZER=23;
constexpr unsigned long SAMPLE_MS=50, SEND_MS=200;
// Fixed mounting baseline. Calibrate offsets before any hardware demonstration.
float offsetX=0, offsetY=0, offsetZ=0;
float squares[25]={0}; uint8_t position=0, count=0;
unsigned long lastSample=0,lastSend=0,lastReconnect=0;
bool sensorReady=false;

bool writeRegister(uint8_t address,uint8_t value){Wire.beginTransmission(ADXL);Wire.write(address);Wire.write(value);return Wire.endTransmission()==0;}
bool readAcceleration(float &x,float &y,float &z){
 Wire.beginTransmission(ADXL);Wire.write(0x32);if(Wire.endTransmission(false)!=0)return false;
 if(Wire.requestFrom(ADXL,(uint8_t)6)!=(uint8_t)6)return false;
 int16_t values[3];for(int i=0;i<3;i++){uint8_t lo=Wire.read(),hi=Wire.read();values[i]=(int16_t)((hi<<8)|lo);}
 x=values[0]*0.0039f-offsetX;y=values[1]*0.0039f-offsetY;z=values[2]*0.0039f-offsetZ;return true;
}
void setup(){
 Serial.begin(115200);Wire.begin(21,22);Wire.setClock(100000);
 pinMode(GREEN_LED,OUTPUT);pinMode(RED_LED,OUTPUT);pinMode(BUZZER,OUTPUT);
 digitalWrite(BUZZER,LOW);
 // Full resolution ±16 g; 100 Hz sensor output. Software sampling is 20 Hz.
 sensorReady=writeRegister(0x31,0x0B)&&writeRegister(0x2C,0x0A)&&writeRegister(0x2D,0x08);
 WiFi.mode(WIFI_STA);WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
 configTime(0,0,"pool.ntp.org","time.nist.gov");
}
void loop(){
 unsigned long now=millis();
 if(WiFi.status()!=WL_CONNECTED&&now-lastReconnect>10000){lastReconnect=now;WiFi.reconnect();}
 if(now-lastSample<SAMPLE_MS)return;lastSample=now;
 float x,y,z;if(!sensorReady||!readAcceleration(x,y,z)){digitalWrite(GREEN_LED,LOW);digitalWrite(RED_LED,HIGH);digitalWrite(BUZZER,LOW);return;}
 float dynamicSquared=x*x+y*y+(z-1)*(z-1);squares[position]=dynamicSquared;position=(position+1)%25;if(count<25)count++;
 float sum=0;for(int i=0;i<count;i++)sum+=squares[i];float rms=sqrtf(sum/count);
 // Local DEMO thresholds; independently configured from backend settings.
 digitalWrite(GREEN_LED,rms<0.15f);digitalWrite(RED_LED,rms>=0.15f);digitalWrite(BUZZER,rms>=0.35f);
 if(WiFi.status()!=WL_CONNECTED||now-lastSend<SEND_MS)return;lastSend=now;
 if(time(nullptr)<1700000000)return; // Wait for clock sync before TLS validation.
 WiFiClientSecure client;client.setCACert(ROOT_CA);HTTPClient http;
 http.setTimeout(1500);if(!http.begin(client,INGEST_URL))return;
 http.addHeader("Content-Type","application/json");http.addHeader("Authorization",String("Bearer ")+DEVICE_TOKEN);
 String payload="{\"device_id\":\""+String(DEVICE_ID)+"\",\"x\":"+String(x,5)+",\"y\":"+String(y,5)+",\"z\":"+String(z,5)+",\"health\":{\"rssi\":"+String(WiFi.RSSI())+",\"uptimeMs\":"+String(millis())+",\"firmware\":\"sn2h-preparation-2\"}}";
 int code=http.POST(payload);Serial.printf("Ingest response: %d; local demo RMS %.4f g\n",code,rms);http.end();
}
