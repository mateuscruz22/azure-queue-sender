import express from "express";
import { createServer as createViteServer } from "vite";
import { ServiceBusClient } from "@azure/service-bus";
import dotenv from "dotenv";
import { QUEUE_CONFIGS } from "./queue-configs";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3001;

  app.use(express.json());

  // API: Listar filas disponíveis (sem expor connection strings)
  app.get("/api/queues", (req, res) => {
    const publicConfigs = QUEUE_CONFIGS.map(q => ({
      id: q.id,
      label: q.label,
      environment: q.environment,
    }));
    res.json(publicConfigs);
  });

  // API: Enviar mensagem para uma fila
  app.post("/api/send", async (req, res) => {
    const { queueId, payload, isBatch } = req.body;

    if (!queueId || !payload) {
      return res.status(400).json({ error: "queueId and payload are required" });
    }

    const config = QUEUE_CONFIGS.find(q => q.id === queueId);
    if (!config) {
      return res.status(404).json({ error: "Queue configuration not found" });
    }

    let sbClient: ServiceBusClient | null = null;
    try {
      sbClient = new ServiceBusClient(config.connectionString);
      const sender = sbClient.createSender(config.queueName);
      
      let messagesToSend: any[] = [];

      if (isBatch) {
        let parsedPayload = payload;
        if (typeof payload === 'string') {
          try {
            parsedPayload = JSON.parse(payload);
          } catch (e) {
            // Se não for JSON válido, trata como string única
            parsedPayload = payload;
          }
        }

        if (Array.isArray(parsedPayload)) {
          messagesToSend = parsedPayload.map(item => ({
            body: typeof item === 'string' ? item : JSON.stringify(item)
          }));
        } else {
          messagesToSend = [{ body: typeof parsedPayload === 'string' ? parsedPayload : JSON.stringify(parsedPayload) }];
        }
      } else {
        messagesToSend = [{ body: typeof payload === 'string' ? payload : JSON.stringify(payload) }];
      }
      
      // Enviar mensagens (Service Bus suporta envio de array de mensagens)
      // Para garantir ordem e evitar limites de tamanho de lote muito grandes, 
      // poderíamos enviar um por um ou em lotes menores, mas sendMessages aceita um array.
      await sender.sendMessages(messagesToSend);

      await sender.close();

      res.json({ 
        success: true, 
        message: messagesToSend.length > 1 
          ? `${messagesToSend.length} mensagens enviadas com sucesso` 
          : "Mensagem enviada com sucesso"
      });
    } catch (error: any) {
      console.error("Error sending message to Azure Service Bus:", error);
      res.status(500).json({ error: error.message || "Failed to send message" });
    } finally {
      if (sbClient) {
        await sbClient.close();
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Em produção, servir arquivos estáticos da pasta dist
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
