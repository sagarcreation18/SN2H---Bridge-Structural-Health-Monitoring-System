CREATE DATABASE IF NOT EXISTS bridge_health_monitor;
USE bridge_health_monitor;
CREATE TABLE IF NOT EXISTS bridges (id INT PRIMARY KEY, name VARCHAR(120) NOT NULL, location VARCHAR(160) NOT NULL);
CREATE TABLE IF NOT EXISTS devices (id VARCHAR(40) PRIMARY KEY, bridge_id INT NOT NULL, name VARCHAR(100) NOT NULL, source ENUM('simulation','hardware') NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, last_seen DATETIME(3), FOREIGN KEY (bridge_id) REFERENCES bridges(id));
CREATE TABLE IF NOT EXISTS sensor_readings (id BIGINT AUTO_INCREMENT PRIMARY KEY, device_id VARCHAR(40) NOT NULL, source ENUM('simulation','hardware') NOT NULL, timestamp DATETIME(3) NOT NULL, x DOUBLE NOT NULL,y DOUBLE NOT NULL,z DOUBLE NOT NULL,magnitude DOUBLE NOT NULL,rms DOUBLE NOT NULL,status VARCHAR(12) NOT NULL, INDEX idx_device_time(device_id,timestamp), INDEX idx_time(timestamp), FOREIGN KEY(device_id) REFERENCES devices(id));
CREATE TABLE IF NOT EXISTS alerts (id BIGINT AUTO_INCREMENT PRIMARY KEY, device_id VARCHAR(40) NOT NULL, source VARCHAR(16) NOT NULL, severity VARCHAR(12) NOT NULL, message VARCHAR(255) NOT NULL, timestamp DATETIME(3) NOT NULL, acknowledged BOOLEAN NOT NULL DEFAULT FALSE, acknowledged_at DATETIME(3), INDEX idx_alert_time(timestamp), FOREIGN KEY(device_id) REFERENCES devices(id));
CREATE TABLE IF NOT EXISTS simulation_sessions (id BIGINT AUTO_INCREMENT PRIMARY KEY, scenario VARCHAR(40) NOT NULL, started_at DATETIME(3) NOT NULL, ended_at DATETIME(3), state VARCHAR(16) NOT NULL);
CREATE TABLE IF NOT EXISTS monitoring_settings (id INT PRIMARY KEY, config JSON NOT NULL);
