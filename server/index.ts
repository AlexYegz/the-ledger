import "dotenv/config";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "node:http";
import { storage } from "./storage";

const app = express();
const httpServer = createServer(app);

// Railway puts a reverse proxy in front of us. Trust it so req.ip reflects
// the real client (used for rate limiting) and rate-limit headers work.
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Body size limit raised to 50mb so the ledger can accept long PDFs
// (folios, intros, AAC statements). Default is 100kb which rejects
// anything past a couple of pages with "request entity too large".
app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "50mb" }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Request logger.
// We intentionally do NOT log response bodies — they contain PII (names,
// email addresses, parsed email content). Method + path + status + duration
// is enough to debug without leaking user data into Railway logs.
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  // Trash auto-purge: items soft-deleted more than 30 days ago are hard-deleted.
  // Runs once at boot and then every 6 hours.
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const runPurge = () => {
    try {
      const n = storage.purgeOldTrash(THIRTY_DAYS);
      if (n > 0) log(`purged ${n} item(s) from trash (>30d old)`);
    } catch (err) {
      console.error("trash purge failed:", err);
    }
  };
  runPurge();
  setInterval(runPurge, 6 * 60 * 60 * 1000);
})();
