import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { query } from "./db.js";
import { range, fail } from "./validation.js";
export async function pdfReport(req, res) {
  const f = range(req.query),
    source = req.query.source || "simulation";
  if (!["simulation", "hardware"].includes(source))
    throw fail("Choose simulation or hardware");
  const args = [f.from, f.to, source];
  let where = "timestamp BETWEEN ? AND ? AND source=?";
  if (req.query.device_id) {
    where += " AND device_id=?";
    args.push(String(req.query.device_id));
  }
  const [summary] = await query(
    `SELECT COUNT(*) samples,AVG(rms) average,MAX(rms) maximum FROM sensor_readings WHERE ${where}`,
    args,
  );
  const readings = (
    await query(
      `SELECT timestamp,rms FROM sensor_readings WHERE ${where} ORDER BY timestamp DESC,id DESC LIMIT 1000`,
      args,
    )
  ).reverse();
  const events = await query(
    `SELECT timestamp,severity,device_id,message FROM alerts WHERE ${where} ORDER BY timestamp DESC,id DESC LIMIT 24`,
    args,
  );
  const counts = await query(
    `SELECT severity,COUNT(*) count FROM alerts WHERE ${where} GROUP BY severity`,
    args,
  );
  const doc = new PDFDocument({
    size: "A4",
    margin: 44,
    bufferPages: true,
    info: {
      Title: "SN²H - Vibration Monitoring Report",
      Author: "SN²H Team",
      Subject: `${source.toUpperCase()} database observations`,
    },
  });
  res.attachment(`sn2h-${source}-report.pdf`).type("pdf");
  doc.pipe(res);
  doc.on("error", (e) => {
    console.error("PDF generation:", e.message);
    if (!res.headersSent) res.status(500);
    res.end();
  });
  const regular = process.env.PDF_FONT_REGULAR || "C:/Windows/Fonts/arial.ttf",
    bold = process.env.PDF_FONT_BOLD || "C:/Windows/Fonts/arialbd.ttf";
  doc.registerFont("body", existsSync(regular) ? regular : "Helvetica");
  doc.registerFont("heading", existsSync(bold) ? bold : "Helvetica-Bold");
  const width = doc.page.width,
    height = doc.page.height,
    left = 44,
    right = width - 44,
    contentWidth = right - left;
  function page(title) {
    doc.rect(0, 0, width, height).fill("#F8F6EC");
    doc.fillColor("#151515");
    const logo = fileURLToPath(
      new URL("../public/assets/images/sn2h-logo.png", import.meta.url),
    );
    doc.image(logo, right - 64, 32, { width: 64, height: 64 });
    doc.font("heading").fontSize(27).text("SN²H.", left, 40, { width: 340 });
    doc
      .font("body")
      .fontSize(10)
      .fillColor("#69665c")
      .text("We Sense What Eyes Can't See.", left, 77, { width: 370 });
    doc
      .strokeColor("#D9D4C8")
      .lineWidth(0.6)
      .moveTo(left, 110)
      .lineTo(right, 110)
      .stroke();
    doc
      .fillColor("#151515")
      .font("heading")
      .fontSize(20)
      .text(title, left, 133, { width: contentWidth });
  }
  const val = (v) => (v === null ? "No data" : Number(v).toFixed(4) + " g");
  page("Vibration observation report");
  doc
    .font("body")
    .fontSize(10)
    .fillColor("#69665c")
    .text(
      `DATA SOURCE: ${source.toUpperCase()}${req.query.device_id ? " / " + String(req.query.device_id) : ""}`,
      left,
      170,
      { width: contentWidth },
    );
  doc
    .fontSize(9)
    .text(
      `From ${f.from.toISOString()}\nTo     ${f.to.toISOString()}\nGenerated ${new Date().toISOString()} (UTC)`,
      left,
      192,
      { lineGap: 5, width: contentWidth },
    );
  const metrics = [
    ["STORED SAMPLES", Number(summary.samples).toLocaleString("en-US")],
    ["AVERAGE RMS", val(summary.average)],
    ["MAXIMUM RMS", val(summary.maximum)],
  ];
  metrics.forEach(([label, value], i) => {
    const x = left + (i * contentWidth) / 3;
    doc
      .strokeColor("#D9D4C8")
      .rect(x, 264, contentWidth / 3, 79)
      .stroke();
    doc
      .font("body")
      .fillColor("#69665c")
      .fontSize(8)
      .text(label, x + 12, 279, { width: contentWidth / 3 - 20 });
    doc
      .font("heading")
      .fontSize(17)
      .fillColor("#151515")
      .text(value, x + 12, 302, { width: contentWidth / 3 - 20 });
  });
  doc.font("heading").fontSize(12).text("Rolling RMS history", left, 370);
  doc
    .font("body")
    .fontSize(8)
    .fillColor("#69665c")
    .text(
      `Newest ${readings.length} stored readings in the selected range. Summary uses all matching records.`,
      left,
      391,
      { width: contentWidth },
    );
  const top = 427,
    bottom = 613,
    chartLeft = left + 45,
    chartRight = right,
    max = Math.max(0.01, ...readings.map((r) => r.rms)) * 1.15;
  for (let i = 0; i <= 4; i++) {
    const y = bottom - ((bottom - top) * i) / 4;
    doc
      .strokeColor("#D9D4C8")
      .lineWidth(0.5)
      .moveTo(chartLeft, y)
      .lineTo(chartRight, y)
      .stroke();
    doc
      .fontSize(8)
      .fillColor("#69665c")
      .text(((max * i) / 4).toFixed(3) + " g", left, y - 4, {
        width: 40,
        align: "right",
      });
  }
  if (readings.length > 1) {
    const first = +new Date(readings[0].timestamp),
      span = Math.max(1, +new Date(readings.at(-1).timestamp) - first);
    doc.strokeColor("#151515").lineWidth(1.2);
    readings.forEach((r, i) => {
      const x =
          chartLeft +
          ((+new Date(r.timestamp) - first) / span) * (chartRight - chartLeft),
        y = bottom - (r.rms / max) * (bottom - top);
      if (i === 0) doc.moveTo(x, y);
      else doc.lineTo(x, y);
    });
    doc.stroke();
    doc
      .fontSize(8)
      .text(
        new Date(readings[0].timestamp).toISOString().slice(11, 19) + " UTC",
        chartLeft,
        bottom + 10,
        { width: 150 },
      );
    doc.text(
      new Date(readings.at(-1).timestamp).toISOString().slice(11, 19) + " UTC",
      chartRight - 150,
      bottom + 10,
      { width: 150, align: "right" },
    );
  } else
    doc
      .font("body")
      .fontSize(11)
      .text(
        "Not enough stored observations to draw a trend.",
        chartLeft,
        top + 70,
        { width: chartRight - chartLeft, align: "center" },
      );
  doc
    .font("body")
    .fontSize(9)
    .fillColor("#69665c")
    .text(
      "Demonstration thresholds only. Accelerometer data alone does not establish structural safety. Simulation and hardware are reported separately.",
      left,
      666,
      { width: contentWidth, lineGap: 5 },
    );
  doc.addPage();
  page("Alert register");
  doc
    .font("body")
    .fontSize(10)
    .fillColor("#69665c")
    .text(
      counts.length
        ? counts
            .map((c) => `${c.severity.toUpperCase()}: ${c.count}`)
            .join("     ")
        : "No alert events in this period.",
      left,
      174,
      { width: contentWidth },
    );
  doc
    .fontSize(8)
    .text(
      "Newest 24 matching events. Times are UTC. Acknowledgment state is available in the application.",
      left,
      199,
      { width: contentWidth },
    );
  let y = 235;
  for (const e of events) {
    const message = `${new Date(e.timestamp).toISOString().slice(0, 19).replace("T", " ")} UTC | ${e.severity.toUpperCase()} | ${e.device_id}\n${e.message}`;
    doc.font("body").fontSize(9);
    const h =
      doc.heightOfString(message, { width: contentWidth - 20, lineGap: 3 }) +
      20;
    if (y + h > 735) {
      doc.addPage();
      page("Alert register - continued");
      y = 183;
    }
    doc.strokeColor("#D9D4C8").rect(left, y, contentWidth, h).stroke();
    doc.fillColor("#151515").text(message, left + 10, y + 9, {
      width: contentWidth - 20,
      lineGap: 3,
    });
    y += h;
  }
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.strokeColor("#D9D4C8").moveTo(left, 775).lineTo(right, 775).stroke();
    doc
      .font("body")
      .fontSize(8)
      .fillColor("#69665c")
      .text("SN²H Team | Academic monitoring demonstration", left, 786, {
        width: contentWidth - 70,
      });
    doc.text(`${i + 1} / ${pages.count}`, right - 60, 786, {
      width: 60,
      align: "right",
    });
  }
  doc.end();
}
