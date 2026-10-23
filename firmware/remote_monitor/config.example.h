#pragma once
// Copy to config.h. Never commit network credentials or tokens.
const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* INGEST_URL = "https://your-monitor.example/api/remote/batch";
const char* DEVICE_TOKEN = "COPY_ROTATED_PER_DEVICE_CREDENTIAL";
const char* DEVICE_ID = "esp32-01"; // Match the registered sensor ID in Devices.
// Replace with the CA certificate for your HTTPS endpoint. Verification stays enabled.
const char* ROOT_CA = R"EOF(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_YOUR_TRUSTED_CA
-----END CERTIFICATE-----
)EOF";


