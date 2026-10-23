import "dotenv/config";
import mysql from "mysql2/promise";
export const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "bridge_health_monitor",
  waitForConnections: true,
  connectionLimit: 8,
  timezone: "Z",
});
// mysql2's timezone formats Date values; the SQL session timezone separately
// controls CURRENT_TIMESTAMP defaults and delivery scheduling.
pool.on("connection", (connection) =>
  connection.query("SET time_zone = '+00:00'"),
);
export async function query(sql, args = []) {
  const [rows] = await pool.execute(sql, args);
  return rows;
}
