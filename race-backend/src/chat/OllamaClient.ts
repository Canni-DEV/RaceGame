import http from "http";
import https from "https";

export type OllamaChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OllamaChatOptions = {
  temperature?: number;
  top_p?: number;
  num_predict?: number;
};

type OllamaChatResponse = {
  message?: {
    role?: string;
    content?: string;
  };
  error?: string;
};

export class OllamaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly options: OllamaChatOptions
  ) {}

  async chat(messages: OllamaChatMessage[]): Promise<string> {
    const payload = {
      model: this.model,
      messages,
      stream: false,
      options: this.options
    };

    const response = await this.postJson("/api/chat", payload);
    if (response?.error) {
      throw new Error(response.error);
    }

    const content = response?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Invalid Ollama response");
    }

    return content;
  }

  private postJson(path: string, payload: unknown): Promise<OllamaChatResponse> {
    const url = new URL(path, this.baseUrl);
    const body = JSON.stringify(payload);
    const isHttps = url.protocol === "https:";

    const requestOptions: http.RequestOptions = {
      method: "POST",
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    return new Promise((resolve, reject) => {
      const request = (isHttps ? https : http).request(requestOptions, (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          if (!res.statusCode || res.statusCode >= 300) {
            reject(new Error(`Ollama HTTP ${res.statusCode ?? 0}: ${data.slice(0, 200)}`));
            return;
          }

          try {
            const parsed = JSON.parse(data) as OllamaChatResponse;
            resolve(parsed);
          } catch (error) {
            reject(error instanceof Error ? error : new Error("Invalid Ollama response"));
          }
        });
      });

      request.on("error", (error) => {
        reject(error);
      });

      request.setTimeout(this.timeoutMs, () => {
        request.destroy(new Error("Ollama request timed out"));
      });

      request.write(body);
      request.end();
    });
  }
}
