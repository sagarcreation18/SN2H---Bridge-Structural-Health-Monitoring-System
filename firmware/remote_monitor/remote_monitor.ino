// PREPARATION ONLY: not compiled or validated with physical sensors.
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <time.h>
#include <sys/time.h>
#include "config.h"
#include "outbox.h"
constexpr uint8_t ADXL=0x53,GREEN_LED=18,RED_LED=19,BUZZER=23;
constexpr unsigned long SAMPLE_MS=50;
float offsetX=0,offsetY=0,offsetZ=0,squares[25]={0};
uint8_t position=0,count=0;
uint64_t bootId;uint32_t sequenceNo=0;unsigned long lastSample=0;
bool sensorReady=false;
bool writeRegister(uint8_t address,uint8_t value){Wire.beginTransmission(ADXL);Wire.write(address);Wire.write(value);return Wire.endTransmission()==0;}
bool readAcceleration(float &x,float &y,float &z){
  Wire.beginTransmission(ADXL);Wire.write(0x32);if(Wire.endTransmission(false)!=0)return false;
  if(Wire.requestFrom(ADXL,(uint8_t)6)!=6)return false;
  int16_t v[3];for(int i=0;i<3;i++){uint8_t lo=Wire.read(),hi=Wire.read();v[i]=(int16_t)((hi<<8)|lo);}
  x=v[0]*.0039f-offsetX;y=v[1]*.0039f-offsetY;z=v[2]*.0039f-offsetZ;return true;
}
String utcTimestamp(uint64_t milliseconds){
  time_t seconds=milliseconds/1000;struct tm utc;gmtime_r(&seconds,&utc);
  char date[32],value[40];strftime(date,sizeof(date),"%Y-%m-%dT%H:%M:%S",&utc);
  snprintf(value,sizeof(value),"%s.%03uZ",date,(unsigned)(milliseconds%1000));return String(value);
}
void uploadTask(void*){
  unsigned long lastReconnect=0;SampleRecord records[20];
  for(;;){
    if(WiFi.status()!=WL_CONNECTED){if(millis()-lastReconnect>10000){lastReconnect=millis();WiFi.reconnect();}vTaskDelay(pdMS_TO_TICKS(500));continue;}
    if(time(nullptr)<1700000000){vTaskDelay(pdMS_TO_TICKS(1000));continue;}
    int n=peekBatch(records,20);if(!n){vTaskDelay(pdMS_TO_TICKS(200));continue;}
    char boot[24];snprintf(boot,sizeof(boot),"%016llx",(unsigned long long)records[0].boot);
    String payload="{\"device_id\":\""+String(DEVICE_ID)+"\",\"boot_id\":\""+String(boot)+"\",\"samples\":[";
    for(int i=0;i<n;i++){
      if(i)payload+=",";
      const auto &s=records[i];payload+="{\"sequence\":"+String(s.sequence)+",\"measured_at\":\""+utcTimestamp(s.measuredMs)+"\",\"x\":"+String(s.x,5)+",\"y\":"+String(s.y,5)+",\"z\":"+String(s.z,5)+"}";
    }payload+="],\"health\":{\"rssi\":"+String(WiFi.RSSI())+",\"uptimeMs\":"+String(millis())+",\"firmware\":\"sn2h-remote-preparation-3\"}}";
    WiFiClientSecure client;client.setCACert(ROOT_CA);HTTPClient http;http.setTimeout(5000);
    if(!http.begin(client,INGEST_URL)){vTaskDelay(pdMS_TO_TICKS(2000));continue;}
    http.addHeader("Content-Type","application/json");http.addHeader("Authorization",String("Bearer ")+DEVICE_TOKEN);
    int code=http.POST(payload);http.end();
    if(code>=200&&code<300)acknowledgeBatch(n);
    else if(code==400)Serial.println("Batch rejected: inspect clock/schema. Queue retained; operator action needed.");
    Serial.printf("Remote response %d; batch %d; dropped %lu\n",code,n,(unsigned long)droppedSamples);
    vTaskDelay(pdMS_TO_TICKS(code>=200&&code<300?100:5000));
  }
}
void setup(){
  Serial.begin(115200);Wire.begin(21,22);Wire.setClock(100000);
  pinMode(GREEN_LED,OUTPUT);pinMode(RED_LED,OUTPUT);pinMode(BUZZER,OUTPUT);digitalWrite(BUZZER,LOW);
  sensorReady=writeRegister(0x31,0x0B)&&writeRegister(0x2C,0x0A)&&writeRegister(0x2D,0x08);
  bootId=((uint64_t)esp_random()<<32)|esp_random();
  if(!startOutbox())Serial.println("LittleFS queue unavailable. Provision LittleFS once; existing data is never auto-formatted.");
  WiFi.mode(WIFI_STA);WiFi.begin(WIFI_SSID,WIFI_PASSWORD);configTime(0,0,"pool.ntp.org","time.nist.gov");
  if(xTaskCreate(uploadTask,"sn2h-upload",16384,nullptr,1,nullptr)!=pdPASS)Serial.println("Upload task could not start");
}
void loop(){
  unsigned long now=millis();if(now-lastSample<SAMPLE_MS){delay(1);return;}lastSample=now;
  float x,y,z;if(!sensorReady||!readAcceleration(x,y,z)){digitalWrite(GREEN_LED,LOW);digitalWrite(RED_LED,HIGH);digitalWrite(BUZZER,LOW);delay(20);return;}
  squares[position]=x*x+y*y+(z-1)*(z-1);position=(position+1)%25;if(count<25)count++;
  float sum=0;for(int i=0;i<count;i++)sum+=squares[i];float rms=sqrtf(sum/count);
  digitalWrite(GREEN_LED,rms<.15f);digitalWrite(RED_LED,rms>=.15f);digitalWrite(BUZZER,rms>=.35f);
  struct timeval tv;gettimeofday(&tv,nullptr);
  if(tv.tv_sec>=1700000000){SampleRecord sample={(uint64_t)tv.tv_sec*1000+(uint64_t)tv.tv_usec/1000,bootId,sequenceNo++,x,y,z};enqueueSample(sample);}
  else droppedSamples++;
}


