INSERT IGNORE INTO bridges VALUES (1,'SN²H Demonstration Bridge','Demonstration structure · Sector 04');
INSERT IGNORE INTO devices(id,bridge_id,name,source) VALUES ('sim-adxl345',1,'ADXL345 simulator','simulation'),('esp32-01',1,'ESP32 / ADXL345 · untested','hardware');
INSERT IGNORE INTO monitoring_settings VALUES (1,'{"warning":0.15,"critical":0.35,"samplingMs":50,"offlineMs":5000,"sound":false,"autoStart":true}');
