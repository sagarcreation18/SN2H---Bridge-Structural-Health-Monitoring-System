#pragma once
// Persistent bounded queue. Preparation only: power-loss behavior requires bench tests.
#include <LittleFS.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
struct SampleRecord { uint64_t measuredMs; uint64_t boot; uint32_t sequence; float x,y,z; };
struct QueueState { uint32_t magic=0x534E3248, head=0, count=0; };
constexpr uint32_t QUEUE_CAPACITY=1024;
SemaphoreHandle_t queueMutex=nullptr;
QueueState queueState;
uint32_t droppedSamples=0;
bool queueAvailable=false;
bool saveQueueState(){
  File file=LittleFS.open("/queue-state.tmp","w");if(!file)return false;
  bool ok=file.write((uint8_t*)&queueState,sizeof(queueState))==sizeof(queueState);file.flush();file.close();
  return ok&&LittleFS.rename("/queue-state.tmp","/queue-state.bin");
}
bool startOutbox(){
  queueMutex=xSemaphoreCreateMutex();
  if(!queueMutex||!LittleFS.begin(false))return false;
  if(LittleFS.exists("/queue-state.bin")){
    File file=LittleFS.open("/queue-state.bin","r");
    bool ok=file&&file.size()==sizeof(queueState)&&file.read((uint8_t*)&queueState,sizeof(queueState))==sizeof(queueState);file.close();
    if(!ok||queueState.magic!=0x534E3248||queueState.head>=QUEUE_CAPACITY||queueState.count>QUEUE_CAPACITY)return false;
  }
  if(!LittleFS.exists("/queue-data.bin")){File file=LittleFS.open("/queue-data.bin","w");if(!file)return false;file.close();}
  queueAvailable=true;return true;
}
bool enqueueSample(const SampleRecord &record){
  if(!queueAvailable){droppedSamples++;return false;}
  xSemaphoreTake(queueMutex,portMAX_DELAY);bool ok=false;
  if(queueState.count<QUEUE_CAPACITY){
    File file=LittleFS.open("/queue-data.bin","r+");uint32_t slot=(queueState.head+queueState.count)%QUEUE_CAPACITY;
    if(file&&file.seek(slot*sizeof(record))&&file.write((const uint8_t*)&record,sizeof(record))==sizeof(record)){
      file.flush();queueState.count++;ok=saveQueueState();if(!ok)queueState.count--;
    }file.close();
  }
  if(!ok)droppedSamples++;
  xSemaphoreGive(queueMutex);return ok;
}
int peekBatch(SampleRecord *records,int maximum){
  if(!queueAvailable)return 0;xSemaphoreTake(queueMutex,portMAX_DELAY);
  File file=LittleFS.open("/queue-data.bin","r");int count=0;
  for(uint32_t i=0;file&&i<queueState.count&&count<maximum;i++){
    SampleRecord record;uint32_t slot=(queueState.head+i)%QUEUE_CAPACITY;
    if(!file.seek(slot*sizeof(record))||file.read((uint8_t*)&record,sizeof(record))!=sizeof(record))break;
    if(count&&record.boot!=records[0].boot)break;records[count++]=record;
  }file.close();xSemaphoreGive(queueMutex);return count;
}
bool acknowledgeBatch(uint32_t count){
  xSemaphoreTake(queueMutex,portMAX_DELAY);QueueState old=queueState;
  if(count>queueState.count){xSemaphoreGive(queueMutex);return false;}
  queueState.head=(queueState.head+count)%QUEUE_CAPACITY;queueState.count-=count;
  bool ok=saveQueueState();if(!ok)queueState=old;
  xSemaphoreGive(queueMutex);return ok;
}
