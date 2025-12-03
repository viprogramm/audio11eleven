const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const https = require("https");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const { Bot, webhookCallback } = require("grammy");

const app = express();
const port = process.env.PORT || 3001;

// Initialize Telegram Bot
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g., https://your-domain.com/telegram-webhook

const bot = BOT_TOKEN ? new Bot(BOT_TOKEN) : null;

// Setup multer for temporary file uploads
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Initialize ElevenLabs client
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const elevenlabs = ELEVENLABS_API_KEY
  ? new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY })
  : null;

app.use(express.json());

// Telegram Bot Logic
if (bot) {
  // Handle voice messages and audio files
  bot.on("message:voice", async (ctx) => {
    try {
      console.log("=== EVENT: Voice Message Received ===");
      console.log("User ID:", ctx.from?.id);
      console.log("Username:", ctx.from?.username || "N/A");
      
      await ctx.reply("🎤 Обрабатываю голосовое сообщение...");
      
      const voice = ctx.message.voice;
      const fileId = voice.file_id;
      
      // Get file from Telegram
      const file = await ctx.api.getFile(fileId);
      const filePath = file.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
      
      // Download and process as stream
      const transcription = await processAudioFromUrl(fileUrl, 'audio/ogg');
      
      // Send transcription back to user
      if (transcription && transcription.text) {
        await ctx.reply(`📝 Транскрипция:\n\n${transcription.text}`);
      } else {
        await ctx.reply("❌ Не удалось распознать аудио.");
      }
      
    } catch (error) {
      console.error("Error processing voice message:", error);
      await ctx.reply("❌ Произошла ошибка при обработке аудио.");
    }
  });

  bot.on("message:audio", async (ctx) => {
    try {
      console.log("=== EVENT: Audio File Received ===");
      console.log("User ID:", ctx.from?.id);
      console.log("Username:", ctx.from?.username || "N/A");
      
      await ctx.reply("🎵 Обрабатываю аудио файл...");
      
      const audio = ctx.message.audio;
      const fileId = audio.file_id;
      
      // Get file from Telegram
      const file = await ctx.api.getFile(fileId);
      const filePath = file.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
      
      // Determine MIME type from file extension
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.mp3': 'audio/mp3',
        '.wav': 'audio/wav',
        '.m4a': 'audio/m4a',
        '.ogg': 'audio/ogg'
      };
      const mimeType = mimeTypes[ext] || 'audio/mpeg';
      
      // Download and process as stream
      const transcription = await processAudioFromUrl(fileUrl, mimeType);
      
      // Send transcription back to user
      if (transcription && transcription.text) {
        await ctx.reply(`📝 Транскрипция:\n\n${transcription.text}`);
      } else {
        await ctx.reply("❌ Не удалось распознать аудио.");
      }
      
    } catch (error) {
      console.error("Error processing audio message:", error);
      await ctx.reply("❌ Произошла ошибка при обработке аудио.");
    }
  });

  // Handle video notes (video circles)
  bot.on("message:video_note", async (ctx) => {
    try {
      console.log("=== EVENT: Video Note Received ===");
      console.log("User ID:", ctx.from?.id);
      console.log("Username:", ctx.from?.username || "N/A");
      
      await ctx.reply("🎥 Обрабатываю видео кружок...");
      
      const videoNote = ctx.message.video_note;
      const fileId = videoNote.file_id;
      
      // Get file from Telegram
      const file = await ctx.api.getFile(fileId);
      const filePath = file.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
      
      // Download and process as stream
      const transcription = await processAudioFromUrl(fileUrl, 'video/mp4');
      
      // Send transcription back to user
      if (transcription && transcription.text) {
        await ctx.reply(`📝 Транскрипция:\n\n${transcription.text}`);
      } else {
        await ctx.reply("❌ Не удалось распознать аудио из видео.");
      }
      
    } catch (error) {
      console.error("Error processing video note:", error);
      await ctx.reply("❌ Произошла ошибка при обработке видео кружка.");
    }
  });

  bot.command("start", (ctx) => {
    console.log("=== EVENT: /start Command ===");
    console.log("User ID:", ctx.from?.id);
    console.log("Username:", ctx.from?.username || "N/A");
    return ctx.reply("👋 Привет! Отправь мне голосовое сообщение, аудио файл или видео кружок, и я преобразую его в текст.");
  });

  // Error handler for the bot
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof Error) {
      console.error("Error name:", e.name);
      console.error("Error message:", e.message);
      console.error("Error stack:", e.stack);
    } else {
      console.error("Unknown error:", e);
    }
  });
}

// Helper function to download file from URL as buffer
function downloadFileAsBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      
      response.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      response.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      
      response.on('error', (err) => {
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Helper function to process audio from URL (streaming)
async function processAudioFromUrl(fileUrl, mimeType) {
  try {
    if (!elevenlabs) {
      throw new Error("ElevenLabs API key not configured");
    }

    console.log("=== Processing Audio from URL ===");
    console.log("URL:", fileUrl);
    console.log("MIME type:", mimeType);

    // Download file as buffer
    const audioBuffer = await downloadFileAsBuffer(fileUrl);
    
    console.log("File size:", audioBuffer.length, "bytes");
    
    const audioBlob = new Blob([audioBuffer], { type: mimeType });
    
    console.log("Sending to ElevenLabs API...");
    
    const transcription = await elevenlabs.speechToText.convert({
      file: audioBlob,
      modelId: "scribe_v1",
      tagAudioEvents: true,
      languageCode: null,
      diarize: true
    });

    console.log("=== ElevenLabs Response ===");
    console.log("Transcription text:", transcription.text);
    console.log("Language detected:", transcription.languageCode);
    console.log("Language probability:", transcription.languageProbability);

    return transcription;
  } catch (error) {
    console.error("=== Error in processAudioFromUrl ===");
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    throw error;
  }
}

// Telegram webhook endpoint
if (bot) {
  app.use("/telegram-webhook", webhookCallback(bot, "express"));
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Express error:");
  console.error("Error name:", err.name);
  console.error("Error message:", err.message);
  console.error("Error stack:", err.stack);
  console.error("Request URL:", req.url);
  console.error("Request method:", req.method);
  res.status(500).json({ error: "Internal server error" });
});

// Main page
app.get("/", (req, res) => res.type('html').send(html));

// Handle file upload
app.post("/upload", upload.single("audioFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    if (!elevenlabs) {
      return res.status(500).json({ error: "ElevenLabs API key not configured" });
    }

    const filePath = req.file.path;
    const audioBuffer = fs.readFileSync(filePath);
    
    // Determine MIME type based on file extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    const mimeTypes = {
      '.mp3': 'audio/mp3',
      '.wav': 'audio/wav',
      '.m4a': 'audio/m4a',
      '.ogg': 'audio/ogg',
      '.webm': 'audio/webm'
    };
    const mimeType = mimeTypes[ext] || 'audio/mpeg';

    console.log(`Processing audio file: ${req.file.originalname}`);

    const audioBlob = new Blob([audioBuffer], { type: mimeType });
    
    const transcription = await elevenlabs.speechToText.convert({
      file: audioBlob,
      modelId: "scribe_v1",
      tagAudioEvents: true,
      languageCode: null,
      diarize: true
    });

    // Clean up temporary file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      filename: req.file.originalname,
      transcription: transcription
    });

  } catch (error) {
    console.error("Error processing audio:", error);
    // Clean up file on error
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: "Error processing audio file" });
  }
});

const server = app.listen(port, async () => {
  console.log(`Example app listening on port ${port}!`);
  
  // Set webhook for Telegram bot
  if (bot && WEBHOOK_URL) {
    try {
      await bot.api.setWebhook(`${WEBHOOK_URL}/telegram-webhook`);
      console.log(`Telegram webhook set to: ${WEBHOOK_URL}/telegram-webhook`);
    } catch (error) {
      console.error("Error setting webhook:");
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
  }
});

// Handle server errors
server.on('error', (error) => {
  console.error("Server error:");
  console.error("Error code:", error.code);
  console.error("Error message:", error.message);
  console.error("Error stack:", error.stack);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error("Uncaught Exception:");
  console.error("Error name:", error.name);
  console.error("Error message:", error.message);
  console.error("Error stack:", error.stack);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error("Unhandled Rejection at:", promise);
  console.error("Reason:", reason);
});

server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>Hello from Render!</title>
    <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.5.1/dist/confetti.browser.min.js"></script>
    <script>
      setTimeout(() => {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          disableForReducedMotion: true
        });
      }, 500);
    </script>
    <style>
      @import url("https://p.typekit.net/p.css?s=1&k=vnd5zic&ht=tk&f=39475.39476.39477.39478.39479.39480.39481.39482&a=18673890&app=typekit&e=css");
      @font-face {
        font-family: "neo-sans";
        src: url("https://use.typekit.net/af/00ac0a/00000000000000003b9b2033/27/l?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3") format("woff2"), url("https://use.typekit.net/af/00ac0a/00000000000000003b9b2033/27/d?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3") format("woff"), url("https://use.typekit.net/af/00ac0a/00000000000000003b9b2033/27/a?primer=7cdcb44be4a7db8877ffa5c0007b8dd865b3bbc383831fe2ea177f62257a9191&fvd=n7&v=3") format("opentype");
        font-style: normal;
        font-weight: 700;
      }
      html {
        font-family: neo-sans;
        font-weight: 700;
        font-size: calc(62rem / 16);
      }
      body {
        background: white;
      }
      section {
        border-radius: 1em;
        padding: 1em;
        position: absolute;
        top: 50%;
        left: 50%;
        margin-right: -50%;
        transform: translate(-50%, -50%);
      }
    </style>
  </head>
  <body>
    <section>
      <h1>Audio to Text Transcription</h1>
      <div id="uploadSection">
        <input type="file" id="audioFile" accept="audio/*" />
        <button onclick="uploadFile()">Upload Audio File</button>
      </div>
      <div id="resultSection" style="display:none; margin-top: 20px;">
        <h3>Transcription Result:</h3>
        <p id="transcriptionText"></p>
      </div>
      <div id="loadingSection" style="display:none;">
        <p>Processing audio...</p>
      </div>
      <div id="errorSection" style="display:none; color: red;">
        <p id="errorText"></p>
      </div>
    </section>
    <script>
      async function uploadFile() {
        const fileInput = document.getElementById('audioFile');
        const file = fileInput.files[0];

        if (!file) {
          alert('Please select an audio file');
          return;
        }

        const formData = new FormData();
        formData.append('audioFile', file);

        // Show loading state
        document.getElementById('loadingSection').style.display = 'block';
        document.getElementById('resultSection').style.display = 'none';
        document.getElementById('errorSection').style.display = 'none';

        try {
          const response = await fetch('/upload', {
            method: 'POST',
            body: formData
          });

          const data = await response.json();

          if (response.ok) {
            // Display the transcription text from the response
            const transcriptionText = data.success && data.transcription?.text 
              ? data.transcription.text 
              : JSON.stringify(data.transcription, null, 2);
            document.getElementById('transcriptionText').innerText = transcriptionText;
            document.getElementById('resultSection').style.display = 'block';
            fileInput.value = ''; // Clear file input
          } else {
            throw new Error(data.error || 'Unknown error');
          }
        } catch (error) {
          document.getElementById('errorText').innerText = 'Error: ' + error.message;
          document.getElementById('errorSection').style.display = 'block';
        } finally {
          document.getElementById('loadingSection').style.display = 'none';
        }
      }
    </script>
    <style>
      #uploadSection {
        margin: 20px 0;
      }
      input[type="file"] {
        padding: 10px;
        margin-right: 10px;
      }
      button {
        padding: 10px 20px;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
      }
      button:hover {
        background-color: #0056b3;
      }
    </style>
  </body>
</html>
`
